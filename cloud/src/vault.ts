import type { Env, VaultAsset, VaultMediaType } from './types';

interface R2ListObjectLike {
    key: string;
    size?: number;
    etag?: string;
    uploaded?: Date;
    httpMetadata?: { contentType?: string };
    customMetadata?: Record<string, string>;
}

interface VaultIndexRow {
    asset_id: string;
    canonical_object_key: string;
    source_url_hashes: string;
    content_sha256: string | null;
    media_type: string | null;
    first_seen_at: string;
    last_seen_at: string;
    upload_status: string;
    duplicate_object_keys: string;
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

function mediaTypeFromObjectKey(objectKey: string): VaultMediaType {
    const pathname = objectKey.split(/[?#]/)[0].toLowerCase();
    if (/\.(avif|gif|heic|jpeg|jpg|png|webp)$/.test(pathname)) return 'image';
    if (/\.(m4v|mov|mp4|webm)$/.test(pathname)) return 'video';
    return 'unknown';
}

function mediaTypeFromObject(contentType: string | undefined, objectKey: string): VaultMediaType {
    const contentMediaType = mediaTypeFromContentType(contentType);
    return contentMediaType === 'unknown' ? mediaTypeFromObjectKey(objectKey) : contentMediaType;
}

export function assetIdFromObjectKey(objectKey: string): string {
    const byAsset = objectKey.match(/\/media\/by-asset\/([^/.?#]+)/);
    if (byAsset?.[1]) return byAsset[1];
    const filename = objectKey.split('/').pop() || objectKey;
    return filename.replace(/\.[a-z0-9]+$/i, '');
}

function parseStringArray(value: string | null | undefined): string[] {
    if (!value) return [];
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
    } catch {
        return [];
    }
}

function mediaTypeFromIndexRow(row: VaultIndexRow): VaultMediaType {
    if (row.media_type === 'image' || row.media_type === 'video') return row.media_type;
    return mediaTypeFromObjectKey(row.canonical_object_key);
}

function vaultStatusFromUploadStatus(uploadStatus: string): VaultAsset['verificationStatus'] {
    if (uploadStatus === 'verified') return 'verified';
    if (uploadStatus === 'failed') return 'failed';
    if (uploadStatus === 'blocked') return 'blocked';
    return 'unproven';
}

function normalizeVaultIndexRow(row: VaultIndexRow): VaultAsset {
    const sourceUrlHashes = parseStringArray(row.source_url_hashes);
    const uploadedAt = row.last_seen_at || row.first_seen_at || new Date(0).toISOString();

    return {
        assetId: row.asset_id,
        mediaType: mediaTypeFromIndexRow(row),
        canonicalObjectKey: row.canonical_object_key,
        legacyObjectKeys: parseStringArray(row.duplicate_object_keys),
        sha256: row.content_sha256 || undefined,
        sourceUrlHash: sourceUrlHashes[0],
        firstSeenAt: row.first_seen_at,
        lastSeenAt: row.last_seen_at,
        verificationStatus: vaultStatusFromUploadStatus(row.upload_status),
        gapCodes: [],
        createdAt: row.first_seen_at || uploadedAt,
        updatedAt: uploadedAt,
    };
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
        mediaType: mediaTypeFromObject(contentType, object.key),
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

async function listVaultInventoryFromD1(env: Env, keyPrefix: string, cursor: string | null | undefined, limit: number) {
    const offset = Math.max(0, Number(cursor || '0') || 0);
    const queryLimit = Math.max(1, Math.min(limit, 1000));
    const result = await env.DB
        .prepare(
            `SELECT asset_id, canonical_object_key, source_url_hashes, content_sha256,
                    media_type, first_seen_at, last_seen_at, upload_status, duplicate_object_keys
             FROM r2_dedupe_index
             WHERE canonical_object_key LIKE ?1
             ORDER BY last_seen_at DESC, asset_id ASC
             LIMIT ?2 OFFSET ?3`
        )
        .bind(`${sanitizeKeyPrefix(keyPrefix)}/users/%/media/%`, queryLimit + 1, offset)
        .all<VaultIndexRow>();

    const rows = result.results || [];
    const pageRows = rows.slice(0, queryLimit);
    const items = pageRows.map(normalizeVaultIndexRow);

    return {
        ok: true,
        items,
        nextCursor: rows.length > queryLimit ? String(offset + queryLimit) : null,
        counts: {
            assets: items.length,
            images: items.filter((item) => item.mediaType === 'image').length,
            videos: items.filter((item) => item.mediaType === 'video').length,
            verified: items.filter((item) => item.verificationStatus === 'verified').length,
            blocked: items.filter((item) => item.verificationStatus === 'blocked').length,
            failed: items.filter((item) => item.verificationStatus === 'failed').length,
            unproven: items.filter((item) => item.verificationStatus === 'unproven').length,
        },
    };
}

export async function listVaultInventory(env: Env, cursor?: string | null, limit = 100) {
    const keyPrefix = sanitizeKeyPrefix(env.KEY_PREFIX);
    if (env.DB) {
        try {
            const indexed = await listVaultInventoryFromD1(env, keyPrefix, cursor, limit);
            if (indexed.items.length > 0) return indexed;
        } catch {
            // Fall back to R2 when the D1 index is absent or temporarily unavailable.
        }
    }

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

export async function findVaultMediaObject(env: Env, assetId: string, options?: R2GetOptions) {
    let cursor: string | null = null;
    for (let page = 0; page < 100; page += 1) {
        const inventory = await listVaultInventory(env, cursor, 1000);
        const match = inventory.items.find((item) => item.assetId === assetId);
        const objectKey = match?.canonicalObjectKey || match?.legacyObjectKeys[0];
        if (objectKey) return env.R2_BUCKET.get(objectKey, options);
        cursor = inventory.nextCursor || null;
        if (!cursor) return null;
    }
    return null;
}
