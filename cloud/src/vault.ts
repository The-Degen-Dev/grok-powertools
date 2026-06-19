import type { Env, VaultAsset, VaultMediaType } from './types';

interface R2ListObjectLike {
    key: string;
    size?: number;
    etag?: string;
    uploaded?: Date;
    httpMetadata?: { contentType?: string };
    customMetadata?: Record<string, string>;
}

function sanitizeKeyPrefix(keyPrefix: string | undefined): string {
    const normalized = String(keyPrefix || 'grok-powertools/v1')
        .trim()
        .replace(/^\/+/, '')
        .replace(/\/+$/, '');
    return normalized || 'grok-powertools/v1';
}

function metadataValue(metadata: Record<string, string> | undefined, keys: string[]): string | undefined {
    for (const key of keys) {
        if (metadata?.[key]) return metadata[key];
        const lower = key.toLowerCase();
        if (metadata?.[lower]) return metadata[lower];
    }
    return undefined;
}

export function mediaTypeFromContentType(contentType: string | undefined): VaultMediaType {
    const normalized = String(contentType || '').toLowerCase();
    if (normalized.startsWith('image/')) return 'image';
    if (normalized.startsWith('video/')) return 'video';
    return 'unknown';
}

export function assetIdFromObjectKey(objectKey: string): string {
    const byAsset = objectKey.match(/\/media\/by-asset\/([^/.?#]+)/);
    if (byAsset?.[1]) return byAsset[1];
    const filename = objectKey.split('/').pop() || objectKey;
    return filename.replace(/\.[a-z0-9]+$/i, '');
}

export async function redactedApiKeyFingerprint(apiKey: string | undefined): Promise<string | null> {
    if (!apiKey) return null;
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(apiKey));
    const hex = Array.from(new Uint8Array(digest))
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');
    return `fp_${hex.slice(0, 12)}`;
}

export async function buildVaultIdentity(env: Env) {
    const keyPrefix = sanitizeKeyPrefix(env.KEY_PREFIX);
    return {
        ok: true,
        service: 'grok-r2-backup',
        keyPrefix,
        r2: {
            bucketName: env.R2_BUCKET_NAME || null,
            bindingPresent: !!env.R2_BUCKET,
        },
        d1: {
            bindingPresent: !!env.DB,
        },
        apiKeyFingerprint: await redactedApiKeyFingerprint(env.CLIENT_API_KEY),
    };
}

export function normalizeVaultObject(object: R2ListObjectLike, keyPrefix: string): VaultAsset {
    const metadata = object.customMetadata || {};
    const contentType = object.httpMetadata?.contentType;
    const assetId = metadataValue(metadata, ['asset-id', 'assetId']) || assetIdFromObjectKey(object.key);
    const uploadedAt = object.uploaded?.toISOString() || new Date(0).toISOString();
    const isCanonical = object.key.startsWith(`${sanitizeKeyPrefix(keyPrefix)}/`) && object.key.includes('/media/by-asset/');

    return {
        assetId,
        mediaType: mediaTypeFromContentType(contentType),
        canonicalObjectKey: isCanonical ? object.key : undefined,
        legacyObjectKeys: isCanonical ? [] : [object.key],
        contentType,
        sizeBytes: object.size,
        etag: object.etag,
        sha256: metadataValue(metadata, ['sha256', 'content-sha256', 'contentSha256']),
        sourceUrlHash: metadataValue(metadata, ['source-url-hash', 'sourceUrlHash']),
        firstSeenAt: uploadedAt,
        lastSeenAt: uploadedAt,
        verificationStatus: 'verified',
        gapCodes: [],
        createdAt: uploadedAt,
        updatedAt: uploadedAt,
    };
}

export async function listVaultInventory(env: Env, cursor?: string | null, limit = 100) {
    const keyPrefix = sanitizeKeyPrefix(env.KEY_PREFIX);
    const listed = await env.R2_BUCKET.list({
        prefix: `${keyPrefix}/users/`,
        cursor: cursor || undefined,
        limit: Math.max(1, Math.min(limit, 1000)),
    });
    const items = listed.objects
        .filter((object) => object.key.includes('/media/'))
        .map((object) => normalizeVaultObject(object, keyPrefix));

    return {
        ok: true,
        items,
        nextCursor: listed.truncated ? listed.cursor || null : null,
        counts: {
            assets: items.length,
            images: items.filter((item) => item.mediaType === 'image').length,
            videos: items.filter((item) => item.mediaType === 'video').length,
            verified: items.filter((item) => item.verificationStatus === 'verified').length,
            blocked: 0,
            failed: 0,
            unproven: 0,
        },
    };
}

export async function readVaultMetadata(env: Env, kind: string) {
    const keyPrefix = sanitizeKeyPrefix(env.KEY_PREFIX);
    const filenameByKind: Record<string, string> = {
        savedPrompts: 'saved-prompts.latest.json',
        promptHistory: 'prompt-history.latest.json',
        processedIds: 'processed-ids.latest.json',
        backfillManifest: 'backfill-manifest.latest.json',
        savedList: 'saved-list.latest.json',
    };
    const filename = filenameByKind[kind];
    if (!filename) return { ok: false, status: 400, error: 'Unsupported metadata kind.' };

    const object = await env.R2_BUCKET.get(`${keyPrefix}/users/greymaker/metadata/${filename}`);
    if (!object) return { ok: true, kind, data: [] };

    const parsed = JSON.parse(await object.text()) as { data?: unknown };
    return {
        ok: true,
        kind,
        data: Array.isArray(parsed.data) ? parsed.data : parsed.data ? [parsed.data] : [],
    };
}

export async function findVaultMediaObject(env: Env, assetId: string) {
    const inventory = await listVaultInventory(env, null, 1000);
    const match = inventory.items.find((item) => item.assetId === assetId);
    const objectKey = match?.canonicalObjectKey || match?.legacyObjectKeys[0];
    if (!objectKey) return null;
    return env.R2_BUCKET.get(objectKey);
}
