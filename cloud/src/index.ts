import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type {
    Env,
    MetadataKind,
    MetadataSnapshotRequest,
    ObjectVerifyRequest,
    ObjectVerifyResponse,
    PresignRequest,
    PresignResponse,
    SyncPushRequest,
    SyncPullResponse
} from './types';
import { verifyJWT, extractBearerToken } from './auth';
import { buildAcceptanceIdentity, validateAcceptanceWrite } from './acceptance';
import { upsertEntity, getEntitiesSince, ensureUser, upsertR2DedupeIndex, upsertMetadataSnapshotIndex } from './db';

const SERVICE_NAME = 'grok-r2-backup';
const PRESIGN_EXPIRY_SECONDS = 3600;
const API_KEY_HEADER = ['x-gpt', 'api', 'key'].join('-');
const ACCEPTANCE_RUN_ID_HEADER = 'x-acceptance-run-id';
const ACCEPTANCE_CORRELATION_ID_HEADER = 'x-acceptance-correlation-id';

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
        'access-control-allow-methods': 'GET,HEAD,POST,OPTIONS',
        'access-control-allow-headers': [
            'Content-Type',
            API_KEY_HEADER,
            'Authorization',
            ACCEPTANCE_RUN_ID_HEADER,
            ACCEPTANCE_CORRELATION_ID_HEADER
        ].join(',')
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

function acceptanceRunId(request: Request): string | null {
    return request.headers.get(ACCEPTANCE_RUN_ID_HEADER);
}

function acceptanceCorrelationId(request: Request): string | null {
    return request.headers.get(ACCEPTANCE_CORRELATION_ID_HEADER);
}

function acceptanceErrorResponse(result: ReturnType<typeof validateAcceptanceWrite>): Response | null {
    if (result.ok) return null;
    return errorResponse(result.error, result.status);
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

function sanitizeMetadataRecord(metadata: Record<string, string> | undefined): Record<string, string> {
    const clean: Record<string, string> = {};
    for (const [rawKey, rawValue] of Object.entries(metadata || {})) {
        const key = rawKey
            .toLowerCase()
            .replace(/[^a-z0-9-]/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 64);
        const value = String(rawValue ?? '').slice(0, 1024);
        if (!key || !value) continue;
        clean[key] = value;
    }
    return clean;
}

function metadataUploadHeaders(metadata: Record<string, string>): Record<string, string> {
    return Object.fromEntries(
        Object.entries(metadata).map(([key, value]) => [`x-amz-meta-${key}`, value])
    );
}

function isValidObjectKey(objectKey: string, keyPrefix: string): boolean {
    if (!objectKey || objectKey.length > 1024) return false;
    if (objectKey.includes('..')) return false;
    if (objectKey.startsWith('/')) return false;
    return objectKey.startsWith(`${keyPrefix}/users/`);
}

function isPresignableObjectKey(objectKey: string, keyPrefix: string): boolean {
    if (!isValidObjectKey(objectKey, keyPrefix)) return false;
    if (objectKey === `${keyPrefix}/users/_system/upload-test.txt`) return true;

    const isCanonicalMedia = objectKey.includes('/media/by-asset/');
    const isConflictMedia = objectKey.includes('/media/conflicts/');
    const isPromptSidecar = objectKey.endsWith('.prompt.json');

    return (isCanonicalMedia || isConflictMedia) && (!isPromptSidecar || objectKey.includes('/media/'));
}

function metadataObjectKey(keyPrefix: string, userId: string, kind: MetadataKind): string {
    const safeUserId = sanitizePathSegment(userId);

    if (kind === 'backfillManifest') {
        return `${keyPrefix}/users/${safeUserId}/metadata/backfill-manifest.latest.json`;
    }

    return `${keyPrefix}/users/${safeUserId}/metadata/${METADATA_FILENAMES[kind]}`;
}

function metadataVersionObjectKey(keyPrefix: string, userId: string, kind: MetadataKind, contentHash: string): string | null {
    if (kind !== 'backfillManifest') return null;
    const safeUserId = sanitizePathSegment(userId);
    return `${keyPrefix}/users/${safeUserId}/metadata/backfill-manifest.${contentHash}.json`;
}

function stableJson(value: unknown): string {
    return JSON.stringify(sortJson(value));
}

function sortJson(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(sortJson);
    if (!value || typeof value !== 'object') return value;
    const record = value as Record<string, unknown>;
    return Object.keys(record)
        .sort()
        .reduce<Record<string, unknown>>((acc, key) => {
            acc[key] = sortJson(record[key]);
            return acc;
        }, {});
}

async function sha256Hex(value: string): Promise<string> {
    const bytes = new TextEncoder().encode(value);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest))
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');
}

function getCustomMetadataValue(object: R2Object | null, keys: string[]): string | undefined {
    if (!object) return undefined;
    const metadata = object.customMetadata || {};
    for (const key of keys) {
        if (metadata[key] !== undefined) return metadata[key];
        const lowerKey = key.toLowerCase();
        if (metadata[lowerKey] !== undefined) return metadata[lowerKey];
    }
    return undefined;
}

function userIdFromObjectKey(objectKey: string): string {
    const parts = objectKey.split('/');
    const usersIndex = parts.indexOf('users');
    if (usersIndex >= 0 && parts[usersIndex + 1]) return sanitizePathSegment(parts[usersIndex + 1]);
    return 'unknown';
}

async function parseJson<T>(request: Request): Promise<T> {
    const body = await request.json();
    return body as T;
}

function assertAuthorized(request: Request, env: Env): string | null {
    const provided = request.headers.get(API_KEY_HEADER) || '';
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
    const acceptanceError = acceptanceErrorResponse(validateAcceptanceWrite(env, {
        objectKey: payload.objectKey,
        runId: acceptanceRunId(request),
        correlationId: acceptanceCorrelationId(request)
    }));
    if (acceptanceError) return acceptanceError;

    if (!isPresignableObjectKey(payload.objectKey, keyPrefix)) {
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
        const metadata = sanitizeMetadataRecord(payload.metadata);

        const command = new PutObjectCommand({
            Bucket: env.R2_BUCKET_NAME,
            Key: payload.objectKey,
            ContentType: contentType,
            ContentLength: contentLength,
            Metadata: Object.keys(metadata).length ? metadata : undefined
        });

        const metadataHeaders = metadataUploadHeaders(metadata);
        const uploadUrl = await getSignedUrl(client, command, {
            unhoistableHeaders: new Set(Object.keys(metadataHeaders)),
            expiresIn: PRESIGN_EXPIRY_SECONDS
        });

        const response: PresignResponse = {
            uploadUrl,
            method: 'PUT',
            headers: {
                'Content-Type': contentType,
                ...metadataHeaders
            },
            expiresAt: new Date(Date.now() + PRESIGN_EXPIRY_SECONDS * 1000).toISOString()
        };

        return jsonResponse(response, 200);
    } catch (e) {
        const message = e instanceof Error ? e.message : 'Unknown presign error';
        return errorResponse(message, 500);
    }
}

function compareExpectedObject(object: R2Object | null, payload: ObjectVerifyRequest): ObjectVerifyResponse {
    const sha256 = getCustomMetadataValue(object, ['sha256', 'content-sha256', 'contentSha256']);
    const assetId = getCustomMetadataValue(object, ['asset-id', 'assetId']);
    const sourceUrlHash = getCustomMetadataValue(object, ['source-url-hash', 'sourceUrlHash']);
    const contentType = object?.httpMetadata?.contentType;
    const sizeBytes = object?.size;
    const mismatches: string[] = [];
    const expectedSize = Number(payload.expectedSizeBytes);
    const hasExpectedSize = Number.isFinite(expectedSize) && expectedSize >= 0;
    const expectedSha256 = String(payload.expectedSha256 || '').trim().toLowerCase();
    const expectedContentType = String(payload.expectedContentType || '').trim().toLowerCase();

    const matches = {
        sizeBytes: hasExpectedSize && object ? sizeBytes === expectedSize : null,
        sha256: expectedSha256 && object ? sha256 === expectedSha256 : null,
        contentType: expectedContentType && object && contentType ? contentType.toLowerCase() === expectedContentType : null
    };

    if (matches.sizeBytes === false) mismatches.push('sizeBytes');
    if (matches.sha256 === false) mismatches.push('sha256');
    if (matches.contentType === false) mismatches.push('contentType');

    const requiredMatches = [matches.sizeBytes, matches.sha256].filter((value): value is boolean => value !== null);
    const verified = !!object && requiredMatches.length > 0 && requiredMatches.every(Boolean) && mismatches.length === 0;

    return {
        ok: true,
        exists: !!object,
        verified,
        objectKey: payload.objectKey,
        object: object
            ? {
                sizeBytes,
                etag: object.etag,
                uploadedAt: object.uploaded?.toISOString(),
                contentType,
                sha256,
                assetId,
                sourceUrlHash
            }
            : undefined,
        matches,
        mismatches
    };
}

async function handleObjectVerify(request: Request, env: Env): Promise<Response> {
    let payload: ObjectVerifyRequest;
    try {
        payload = await parseJson<ObjectVerifyRequest>(request);
    } catch (e) {
        return errorResponse('Invalid JSON payload.', 400);
    }

    const keyPrefix = sanitizeKeyPrefix(env.KEY_PREFIX);
    const acceptanceError = acceptanceErrorResponse(validateAcceptanceWrite(env, {
        objectKey: payload.objectKey,
        runId: acceptanceRunId(request),
        correlationId: acceptanceCorrelationId(request)
    }));
    if (acceptanceError) return acceptanceError;

    if (!isValidObjectKey(payload.objectKey, keyPrefix)) {
        return errorResponse('Invalid object key.', 400);
    }

    try {
        const object = await env.R2_BUCKET.head(payload.objectKey);
        const result = compareExpectedObject(object, payload);
        if (object && payload.assetId) {
            try {
                await upsertR2DedupeIndex(env.DB, {
                    userId: userIdFromObjectKey(payload.objectKey),
                    assetId: payload.assetId,
                    canonicalObjectKey: payload.objectKey,
                    sourceUrlHash: payload.sourceUrlHash,
                    contentSha256: result.object?.sha256 || payload.expectedSha256,
                    mediaType: result.object?.contentType?.startsWith('video/') ? 'video' : (result.object?.contentType?.startsWith('image/') ? 'image' : undefined),
                    uploadStatus: result.verified ? 'verified' : 'uploaded'
                });
            } catch (e) {
                console.warn('Failed to update R2 dedupe index', e);
            }
        }
        return jsonResponse(result, 200);
    } catch (e) {
        const message = e instanceof Error ? e.message : 'Failed to verify object';
        return errorResponse(message, 500);
    }
}

async function handleObjectHead(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const objectKey = url.searchParams.get('objectKey') || '';
    const keyPrefix = sanitizeKeyPrefix(env.KEY_PREFIX);

    if (!isValidObjectKey(objectKey, keyPrefix)) {
        return new Response(null, { status: 400, headers: corsHeaders() });
    }

    try {
        const object = await env.R2_BUCKET.head(objectKey);
        if (!object) return new Response(null, { status: 404, headers: corsHeaders() });
        const headers = new Headers(corsHeaders());
        if (object.httpMetadata?.contentType) headers.set('content-type', object.httpMetadata.contentType);
        headers.set('x-r2-size-bytes', String(object.size));
        headers.set('x-r2-etag', object.etag);
        const sha256 = getCustomMetadataValue(object, ['sha256', 'content-sha256', 'contentSha256']);
        if (sha256) headers.set('x-r2-sha256', sha256);
        return new Response(null, { status: 200, headers });
    } catch (e) {
        return new Response(null, { status: 500, headers: corsHeaders() });
    }
}

async function handleDiagnostics(env: Env): Promise<Response> {
    const keyPrefix = sanitizeKeyPrefix(env.KEY_PREFIX);
    return jsonResponse({
        ok: true,
        service: SERVICE_NAME,
        now: new Date().toISOString(),
        keyPrefix,
        r2: {
            bucketConfigured: !!env.R2_BUCKET_NAME,
            bindingPresent: !!env.R2_BUCKET
        },
        d1: {
            bindingPresent: !!env.DB
        },
        endpoints: [
            'GET /health',
            'POST /v1/presign',
            'POST /v1/objects/verify',
            'HEAD /v1/objects/verify?objectKey=...',
            'POST /v1/metadata/snapshot',
            'GET /v1/diagnostics'
        ]
    });
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
    const objectKey = metadataObjectKey(keyPrefix, userId, kind);
    const acceptanceError = acceptanceErrorResponse(validateAcceptanceWrite(env, {
        objectKey,
        runId: acceptanceRunId(request),
        correlationId: acceptanceCorrelationId(request)
    }));
    if (acceptanceError) return acceptanceError;

    const canonicalPayload = {
        schemaVersion: payload.payload.schemaVersion,
        data: payload.payload.data
    };
    const contentHash = await sha256Hex(stableJson(canonicalPayload));
    const now = new Date().toISOString();
    const snapshotPayload = {
        ...payload.payload,
        updatedAt: payload.payload.updatedAt || now,
        contentHash
    };

    try {
        const latestObject = await env.R2_BUCKET.head(objectKey);
        const latestHash = getCustomMetadataValue(latestObject, ['content-sha256', 'contentSha256']);
        if (latestHash === contentHash) {
            await upsertMetadataSnapshotIndex(env.DB, {
                userId: sanitizePathSegment(userId),
                kind,
                contentHash,
                objectKey
            }).catch((e) => console.warn('Failed to update metadata snapshot index', e));
            return jsonResponse({
                ok: true,
                objectKey,
                contentHash,
                skipped: true,
                reason: 'unchanged'
            }, 200);
        }

        const body = JSON.stringify(snapshotPayload, null, 2);
        await env.R2_BUCKET.put(objectKey, body, {
            httpMetadata: {
                contentType: 'application/json; charset=utf-8'
            },
            customMetadata: {
                kind,
                contentSha256: contentHash,
                userId: sanitizePathSegment(userId)
            }
        });
        await upsertMetadataSnapshotIndex(env.DB, {
            userId: sanitizePathSegment(userId),
            kind,
            contentHash,
            objectKey
        }).catch((e) => console.warn('Failed to update metadata snapshot index', e));

        const versionKey = metadataVersionObjectKey(keyPrefix, userId, kind, contentHash);
        if (versionKey) {
            const existingVersion = await env.R2_BUCKET.head(versionKey);
            if (!existingVersion) {
                await env.R2_BUCKET.put(versionKey, body, {
                    httpMetadata: {
                        contentType: 'application/json; charset=utf-8'
                    },
                    customMetadata: {
                        kind,
                        contentSha256: contentHash,
                        userId: sanitizePathSegment(userId),
                        versioned: 'true'
                    }
                });
            }
        }

        return jsonResponse({ ok: true, objectKey, versionObjectKey: versionKey, contentHash, skipped: false }, 200);
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

        if (request.method === 'GET' && url.pathname === '/v1/acceptance/identity') {
            const identityAuthError = assertAuthorized(request, env);
            if (identityAuthError) {
                return errorResponse(identityAuthError, 401);
            }
            return jsonResponse(buildAcceptanceIdentity(env), 200);
        }

        // Extension endpoints use API key auth
        const authError = assertAuthorized(request, env);
        if (authError) {
            return errorResponse(authError, 401);
        }

        if (request.method === 'POST' && url.pathname === '/v1/presign') {
            return handlePresign(request, env);
        }

        if (request.method === 'HEAD' && url.pathname === '/v1/objects/verify') {
            return handleObjectHead(request, env);
        }

        if (request.method === 'POST' && url.pathname === '/v1/objects/verify') {
            return handleObjectVerify(request, env);
        }

        if (request.method === 'GET' && url.pathname === '/v1/diagnostics') {
            return handleDiagnostics(env);
        }

        if (request.method === 'POST' && url.pathname === '/v1/metadata/snapshot') {
            return handleMetadataSnapshot(request, env);
        }

        return errorResponse('Not found', 404);
    }
};
