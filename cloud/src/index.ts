import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type {
    Env,
    MetadataKind,
    MetadataSnapshotRequest,
    PresignRequest,
    PresignResponse,
    SyncPushRequest,
    SyncPullResponse
} from './types';
import { verifyJWT, extractBearerToken } from './auth';
import { upsertEntity, getEntitiesSince, ensureUser } from './db';

const SERVICE_NAME = 'grok-r2-backup';
const PRESIGN_EXPIRY_SECONDS = 3600;

const METADATA_FILENAMES: Record<Exclude<MetadataKind, 'backfillManifest'>, string> = {
    savedPrompts: 'saved-prompts.latest.json',
    promptHistory: 'prompt-history.latest.json',
    processedIds: 'processed-ids.latest.json'
};

const ALLOWED_METADATA_KINDS = new Set<MetadataKind>([
    'savedPrompts',
    'promptHistory',
    'processedIds',
    'backfillManifest'
]);

function corsHeaders(): HeadersInit {
    return {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET,POST,OPTIONS',
        'access-control-allow-headers': 'Content-Type,x-gpt-api-key,Authorization'
    };
}

function jsonResponse(data: unknown, status = 200): Response {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            'content-type': 'application/json; charset=utf-8',
            ...corsHeaders()
        }
    });
}

function errorResponse(message: string, status = 400): Response {
    return jsonResponse({ ok: false, error: message }, status);
}

function sanitizePathSegment(value: string): string {
    const cleaned = value
        .replace(/\.{2,}/g, '')
        .replace(/\//g, '_')
        .replace(/\\/g, '_')
        .replace(/[^a-zA-Z0-9._-]/g, '_')
        .replace(/_{2,}/g, '_')
        .replace(/^_+|_+$/g, '');

    return cleaned || 'unknown';
}

function sanitizeKeyPrefix(keyPrefix: string | undefined): string {
    const normalized = String(keyPrefix || 'grok-powertools/v1')
        .trim()
        .replace(/^\/+/, '')
        .replace(/\/+$/, '');

    return normalized || 'grok-powertools/v1';
}

function isValidObjectKey(objectKey: string, keyPrefix: string): boolean {
    if (!objectKey || objectKey.length > 1024) return false;
    if (objectKey.includes('..')) return false;
    if (objectKey.startsWith('/')) return false;
    return objectKey.startsWith(`${keyPrefix}/users/`);
}

function metadataObjectKey(keyPrefix: string, userId: string, kind: MetadataKind, timestamp: number): string {
    const safeUserId = sanitizePathSegment(userId);

    if (kind === 'backfillManifest') {
        return `${keyPrefix}/users/${safeUserId}/metadata/backfill-manifest.${timestamp}.json`;
    }

    return `${keyPrefix}/users/${safeUserId}/metadata/${METADATA_FILENAMES[kind]}`;
}

async function parseJson<T>(request: Request): Promise<T> {
    const body = await request.json();
    return body as T;
}

function assertAuthorized(request: Request, env: Env): string | null {
    const provided = request.headers.get('x-gpt-api-key') || '';
    if (!env.CLIENT_API_KEY || provided !== env.CLIENT_API_KEY) {
        return 'Unauthorized';
    }
    return null;
}

function buildS3Client(env: Env): S3Client {
    if (!env.R2_ACCOUNT_ID || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY) {
        throw new Error('Missing required R2 signing credentials in worker env.');
    }

    return new S3Client({
        region: 'auto',
        endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
        credentials: {
            accessKeyId: env.R2_ACCESS_KEY_ID,
            secretAccessKey: env.R2_SECRET_ACCESS_KEY
        }
    });
}

async function handlePresign(request: Request, env: Env): Promise<Response> {
    let payload: PresignRequest;
    try {
        payload = await parseJson<PresignRequest>(request);
    } catch (e) {
        return errorResponse('Invalid JSON payload.', 400);
    }

    const keyPrefix = sanitizeKeyPrefix(env.KEY_PREFIX);
    if (!isValidObjectKey(payload.objectKey, keyPrefix)) {
        return errorResponse('Invalid object key.', 400);
    }

    const contentType = String(payload.contentType || '').trim() || 'application/octet-stream';
    const contentLength = Number(payload.contentLength || 0);
    if (!Number.isFinite(contentLength) || contentLength <= 0) {
        return errorResponse('contentLength must be a positive number.', 400);
    }

    if (!env.R2_BUCKET_NAME) {
        return errorResponse('R2_BUCKET_NAME is not configured.', 500);
    }

    try {
        const client = buildS3Client(env);

        const command = new PutObjectCommand({
            Bucket: env.R2_BUCKET_NAME,
            Key: payload.objectKey,
            ContentType: contentType,
            ContentLength: contentLength
        });

        const uploadUrl = await getSignedUrl(client, command, {
            expiresIn: PRESIGN_EXPIRY_SECONDS
        });

        const response: PresignResponse = {
            uploadUrl,
            method: 'PUT',
            headers: {
                'Content-Type': contentType
            },
            expiresAt: new Date(Date.now() + PRESIGN_EXPIRY_SECONDS * 1000).toISOString()
        };

        return jsonResponse(response, 200);
    } catch (e) {
        const message = e instanceof Error ? e.message : 'Unknown presign error';
        return errorResponse(message, 500);
    }
}

async function handleMetadataSnapshot(request: Request, env: Env): Promise<Response> {
    let payload: MetadataSnapshotRequest;
    try {
        payload = await parseJson<MetadataSnapshotRequest>(request);
    } catch (e) {
        return errorResponse('Invalid JSON payload.', 400);
    }

    const kind = payload.kind;
    if (!ALLOWED_METADATA_KINDS.has(kind)) {
        return errorResponse('Unsupported metadata kind.', 400);
    }

    const userId = String(payload.userId || '').trim();
    if (!userId) {
        return errorResponse('userId is required.', 400);
    }

    if (!payload.payload || typeof payload.payload !== 'object') {
        return errorResponse('payload is required.', 400);
    }

    if (payload.payload.schemaVersion !== 1) {
        return errorResponse('schemaVersion must be 1.', 400);
    }

    const keyPrefix = sanitizeKeyPrefix(env.KEY_PREFIX);
    const objectKey = metadataObjectKey(keyPrefix, userId, kind, Date.now());

    try {
        await env.R2_BUCKET.put(objectKey, JSON.stringify(payload.payload, null, 2), {
            httpMetadata: {
                contentType: 'application/json; charset=utf-8'
            }
        });

        return jsonResponse({ ok: true, objectKey }, 200);
    } catch (e) {
        const message = e instanceof Error ? e.message : 'Failed to write snapshot';
        return errorResponse(message, 500);
    }
}

// --- Sync Endpoints (JWT auth) ---

async function assertSyncAuth(request: Request, env: Env): Promise<{ userId: string; email: string; name: string } | Response> {
    const token = extractBearerToken(request);
    if (!token) return errorResponse('Missing Authorization header', 401);

    if (!env.SYNC_SECRET) return errorResponse('SYNC_SECRET not configured', 500);

    const payload = await verifyJWT(token, env.SYNC_SECRET);
    if (!payload || !payload.sub) return errorResponse('Invalid or expired token', 401);

    return {
        userId: payload.sub,
        email: payload.email || '',
        name: payload.name || '',
    };
}

async function handleSyncPush(request: Request, env: Env): Promise<Response> {
    const authResult = await assertSyncAuth(request, env);
    if (authResult instanceof Response) return authResult;

    const { userId, email, name } = authResult;

    let payload: SyncPushRequest;
    try {
        payload = await parseJson<SyncPushRequest>(request);
    } catch {
        return errorResponse('Invalid JSON payload.', 400);
    }

    await ensureUser(env.DB, userId, email, name, '');

    if (payload.collections) {
        for (const col of payload.collections) {
            await upsertEntity(env.DB, 'collections', {
                id: col.id,
                user_id: userId,
                data: col.data,
                updated_at: col.updatedAt,
                deleted_at: col.deletedAt ?? null,
            });
        }
    }

    if (payload.movies) {
        for (const movie of payload.movies) {
            await upsertEntity(env.DB, 'movies', {
                id: movie.id,
                user_id: userId,
                data: movie.data,
                updated_at: movie.updatedAt,
                deleted_at: movie.deletedAt ?? null,
            });
        }
    }

    return jsonResponse({ ok: true, syncedAt: new Date().toISOString() });
}

async function handleSyncPull(request: Request, env: Env): Promise<Response> {
    const authResult = await assertSyncAuth(request, env);
    if (authResult instanceof Response) return authResult;

    const { userId } = authResult;
    const url = new URL(request.url);
    const since = url.searchParams.get('since') || new Date(0).toISOString();

    const collections = await getEntitiesSince(env.DB, 'collections', userId, since);
    const movies = await getEntitiesSince(env.DB, 'movies', userId, since);

    const response: SyncPullResponse = {
        collections: collections.map((c) => ({
            id: c.id,
            data: c.data,
            updatedAt: c.updated_at,
            deletedAt: c.deleted_at,
        })),
        movies: movies.map((m) => ({
            id: m.id,
            data: m.data,
            updatedAt: m.updated_at,
            deletedAt: m.deleted_at,
        })),
        syncedAt: new Date().toISOString(),
    };

    return jsonResponse(response);
}

export default {
    async fetch(request: Request, env: Env): Promise<Response> {
        if (request.method === 'OPTIONS') {
            return new Response(null, {
                status: 204,
                headers: corsHeaders()
            });
        }

        const url = new URL(request.url);

        // Sync endpoints use JWT auth (separate from extension API key auth)
        if (url.pathname.startsWith('/v1/sync/')) {
            if (request.method === 'POST' && url.pathname === '/v1/sync/push') {
                return handleSyncPush(request, env);
            }
            if (request.method === 'GET' && url.pathname === '/v1/sync/pull') {
                return handleSyncPull(request, env);
            }
            return errorResponse('Not found', 404);
        }

        // Health check — no auth required
        if (request.method === 'GET' && url.pathname === '/health') {
            return jsonResponse({ ok: true, service: SERVICE_NAME, now: new Date().toISOString() });
        }

        // Extension endpoints use API key auth
        const authError = assertAuthorized(request, env);
        if (authError) {
            return errorResponse(authError, 401);
        }

        if (request.method === 'POST' && url.pathname === '/v1/presign') {
            return handlePresign(request, env);
        }

        if (request.method === 'POST' && url.pathname === '/v1/metadata/snapshot') {
            return handleMetadataSnapshot(request, env);
        }

        return errorResponse('Not found', 404);
    }
};
