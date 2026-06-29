import type { Env, VaultAsset, VaultGap, VaultMediaType, VaultStatus } from './types';

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

type VaultReadSource = 'legacy' | 'canonical';

interface VaultReadOptions {
    source?: VaultReadSource;
}

interface CanonicalSnapshotRow {
    snapshot_id: string;
    schema_version: string;
    r2_bucket: string;
    r2_object_key: string;
    payload_sha256: string;
    stable_content_hash: string;
    projected_at: string;
    logical_asset_count: number;
    storage_object_count: number;
    prompt_ref_count: number;
    gap_record_count: number;
}

interface CanonicalAssetRow {
    snapshot_id: string;
    canonical_asset_id: string;
    identity_type: string;
    identity_value: string | null;
    canonical_object_key: string | null;
    media_type: string;
    content_sha256: string | null;
    size_bytes: number | null;
    primary_status: string;
    verification_status: string;
    review_required: number;
    gap_flags_json: string;
    storage_object_count: number;
    duplicate_group_count: number;
    prompt_ref_count: number;
    created_at: string | null;
    updated_at: string;
}

interface CanonicalStorageObjectRow {
    canonical_asset_id: string;
    object_key: string;
    status: string;
    source_url_hashes_json: string;
    created_at: string | null;
    updated_at: string;
}

interface CanonicalGapRow {
    gap_id: string;
    type: string;
    severity: string;
    status: string | null;
    canonical_asset_id: string | null;
    object_key_hash: string | null;
    source_conversation_id_hash: string | null;
    asset_id_hash: string | null;
    reason: string | null;
    requires_human_review: number;
    requires_live_grok: number;
    requires_cloud_write: number;
    evidence_json: string;
}

const CANONICAL_PROJECTION_SCHEMA = 'd1-canonical-projection/v1';

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

export function vaultReadSourceFromUrl(url: URL): VaultReadSource {
    return url.searchParams.get('source') === 'canonical' ? 'canonical' : 'legacy';
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

function parseJsonObject(value: string | null | undefined): Record<string, unknown> {
    if (!value) return {};
    try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
    } catch {
        return {};
    }
}

function canonicalMediaType(value: string): VaultMediaType {
    if (value === 'image' || value === 'video') return value;
    return 'unknown';
}

function mediaTypeFromIndexRow(row: VaultIndexRow): VaultMediaType {
    if (row.media_type === 'image' || row.media_type === 'video') return row.media_type;
    return mediaTypeFromObjectKey(row.canonical_object_key);
}

function canonicalVerificationStatus(row: CanonicalAssetRow): VaultStatus {
    if (row.review_required || row.primary_status === 'needs_human_review' || row.primary_status === 'orphan_candidate') {
        return 'blocked';
    }
    if (row.verification_status === 'verified' || row.verification_status === 'blocked' || row.verification_status === 'failed' || row.verification_status === 'unproven') {
        return row.verification_status;
    }
    if (row.primary_status === 'canonical' || row.primary_status === 'date_folder_mapped' || row.primary_status === 'alternate_duplicate') {
        return 'verified';
    }
    return 'unproven';
}

function canonicalGapCodes(row: CanonicalAssetRow): string[] {
    const flags = parseJsonObject(row.gap_flags_json);
    const codes = new Set<string>();
    for (const [key, value] of Object.entries(flags)) {
        if (value) codes.add(key);
    }
    if (row.review_required) codes.add('review_required');
    if (row.primary_status === 'needs_human_review' || row.primary_status === 'orphan_candidate') {
        codes.add(row.primary_status);
    }
    return [...codes].sort();
}

function firstSourceUrlHash(storageRows: CanonicalStorageObjectRow[]): string | undefined {
    for (const row of storageRows) {
        const hashes = parseStringArray(row.source_url_hashes_json);
        if (hashes[0]) return hashes[0];
    }
    return undefined;
}

function vaultStatusFromUploadStatus(uploadStatus: string): VaultAsset['verificationStatus'] {
    if (uploadStatus === 'verified') return 'verified';
    if (uploadStatus === 'failed') return 'failed';
    if (uploadStatus === 'blocked') return 'blocked';
    return 'unproven';
}

async function currentCanonicalSnapshot(env: Env): Promise<CanonicalSnapshotRow | null> {
    if (!env.DB) return null;
    try {
        return await env.DB
            .prepare(
                `SELECT snapshot_id, schema_version, r2_bucket, r2_object_key, payload_sha256,
                        stable_content_hash, projected_at, logical_asset_count, storage_object_count,
                        prompt_ref_count, gap_record_count
                 FROM canonical_snapshot_index
                 WHERE schema_version = ?1
                 ORDER BY projected_at DESC, snapshot_id DESC
                 LIMIT 1`
            )
            .bind(CANONICAL_PROJECTION_SCHEMA)
            .first<CanonicalSnapshotRow>();
    } catch {
        return null;
    }
}

function canonicalProjectionUnavailable() {
    return {
        ok: false,
        status: 503,
        source: 'canonical',
        error: 'CANONICAL_PROJECTION_UNAVAILABLE',
        items: [],
        nextCursor: null,
        counts: {
            assets: 0,
            images: 0,
            videos: 0,
            verified: 0,
            blocked: 0,
            failed: 0,
            unproven: 0,
        },
    };
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

function normalizeCanonicalAssetRow(row: CanonicalAssetRow, storageRows: CanonicalStorageObjectRow[]): VaultAsset {
    const canonicalObjectKey = row.canonical_object_key || storageRows.find((storageRow) => storageRow.status === 'canonical')?.object_key;
    const legacyObjectKeys = [
        ...new Set(
            storageRows
                .map((storageRow) => storageRow.object_key)
                .filter((objectKey) => objectKey && objectKey !== canonicalObjectKey)
        ),
    ];
    const createdAt = row.created_at || storageRows[0]?.created_at || row.updated_at;

    return {
        assetId: row.canonical_asset_id,
        mediaType: canonicalMediaType(row.media_type),
        canonicalObjectKey: canonicalObjectKey || undefined,
        legacyObjectKeys,
        sizeBytes: row.size_bytes ?? undefined,
        sha256: row.content_sha256 || undefined,
        sourceUrlHash: firstSourceUrlHash(storageRows),
        grokPostId: row.identity_type === 'grokPostId' && row.identity_value ? row.identity_value : undefined,
        firstSeenAt: createdAt,
        lastSeenAt: row.updated_at,
        verificationStatus: canonicalVerificationStatus(row),
        gapCodes: canonicalGapCodes(row),
        createdAt,
        updatedAt: row.updated_at,
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

async function listVaultInventoryFromCanonicalProjection(env: Env, cursor: string | null | undefined, limit: number) {
    const snapshot = await currentCanonicalSnapshot(env);
    if (!snapshot) return canonicalProjectionUnavailable();

    const offset = Math.max(0, Number(cursor || '0') || 0);
    const queryLimit = Math.max(1, Math.min(limit, 1000));
    const assetsResult = await env.DB
        .prepare(
            `SELECT snapshot_id, canonical_asset_id, identity_type, identity_value, canonical_object_key,
                    media_type, content_sha256, size_bytes, primary_status, verification_status,
                    review_required, gap_flags_json, storage_object_count, duplicate_group_count,
                    prompt_ref_count, created_at, updated_at
             FROM canonical_asset_projection
             WHERE snapshot_id = ?1
             ORDER BY canonical_asset_id ASC
             LIMIT ?2 OFFSET ?3`
        )
        .bind(snapshot.snapshot_id, queryLimit + 1, offset)
        .all<CanonicalAssetRow>();

    const rows = assetsResult.results || [];
    const pageRows = rows.slice(0, queryLimit);
    const storageResult = await env.DB
        .prepare(
            `SELECT canonical_asset_id, object_key, status, source_url_hashes_json, created_at, updated_at
             FROM canonical_storage_object_projection
             WHERE snapshot_id = ?1
               AND canonical_asset_id IN (
                 SELECT canonical_asset_id
                 FROM canonical_asset_projection
                 WHERE snapshot_id = ?1
                 ORDER BY canonical_asset_id ASC
                 LIMIT ?2 OFFSET ?3
               )
             ORDER BY canonical_asset_id ASC,
               CASE status
                 WHEN 'canonical' THEN 0
                 WHEN 'date_folder_mapped' THEN 1
                 WHEN 'alternate_duplicate' THEN 2
                 ELSE 3
               END,
               object_key ASC`
        )
        .bind(snapshot.snapshot_id, queryLimit, offset)
        .all<CanonicalStorageObjectRow>();
    const storageByAssetId = new Map<string, CanonicalStorageObjectRow[]>();
    for (const storageRow of storageResult.results || []) {
        const group = storageByAssetId.get(storageRow.canonical_asset_id) || [];
        group.push(storageRow);
        storageByAssetId.set(storageRow.canonical_asset_id, group);
    }

    const items = pageRows.map((row) => normalizeCanonicalAssetRow(row, storageByAssetId.get(row.canonical_asset_id) || []));

    return {
        ok: true,
        source: 'canonical',
        snapshot: {
            snapshotId: snapshot.snapshot_id,
            schemaVersion: snapshot.schema_version,
            stableContentHash: snapshot.stable_content_hash,
            projectedAt: snapshot.projected_at,
            logicalAssetCount: snapshot.logical_asset_count,
            storageObjectCount: snapshot.storage_object_count,
            promptRefCount: snapshot.prompt_ref_count,
            gapRecordCount: snapshot.gap_record_count,
        },
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

export async function listVaultInventory(env: Env, cursor?: string | null, limit = 100, options: VaultReadOptions = {}) {
    if (options.source === 'canonical') {
        return listVaultInventoryFromCanonicalProjection(env, cursor, limit);
    }

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

function gapSeverity(value: string): VaultGap['severity'] {
    if (value === 'info' || value === 'warning' || value === 'blocking') return value;
    return 'warning';
}

function gapRecommendedAction(row: CanonicalGapRow): string {
    if (row.requires_live_grok) return 'Inspect the source Grok item and recapture missing response metadata.';
    if (row.requires_human_review) return 'Review the linked storage object before cleanup or dedupe.';
    if (row.requires_cloud_write) return 'Plan an approved cloud write after source evidence is confirmed.';
    return 'Review the source evidence before marking this gap resolved.';
}

function gapEvidence(row: CanonicalGapRow): string {
    const details = [
        row.reason,
        row.status ? `status=${row.status}` : null,
        row.object_key_hash ? `objectKeyHash=${row.object_key_hash}` : null,
        row.source_conversation_id_hash ? `conversationHash=${row.source_conversation_id_hash}` : null,
        row.asset_id_hash ? `assetHash=${row.asset_id_hash}` : null,
    ].filter(Boolean);
    return details.join('; ') || 'Canonical projection gap row.';
}

export async function listVaultGaps(env: Env, cursor?: string | null, limit = 100, options: VaultReadOptions = {}) {
    if (options.source !== 'canonical') return { ok: true, gaps: [] };

    const snapshot = await currentCanonicalSnapshot(env);
    if (!snapshot) {
        return {
            ok: false,
            status: 503,
            source: 'canonical',
            error: 'CANONICAL_PROJECTION_UNAVAILABLE',
            gaps: [],
            nextCursor: null,
        };
    }

    const offset = Math.max(0, Number(cursor || '0') || 0);
    const queryLimit = Math.max(1, Math.min(limit, 1000));
    const result = await env.DB
        .prepare(
            `SELECT gap_id, type, severity, status, canonical_asset_id, object_key_hash,
                    source_conversation_id_hash, asset_id_hash, reason, requires_human_review,
                    requires_live_grok, requires_cloud_write, evidence_json
             FROM canonical_gap_projection
             WHERE snapshot_id = ?1
             ORDER BY gap_id ASC
             LIMIT ?2 OFFSET ?3`
        )
        .bind(snapshot.snapshot_id, queryLimit + 1, offset)
        .all<CanonicalGapRow>();
    const rows = result.results || [];
    const pageRows = rows.slice(0, queryLimit);
    const gaps: VaultGap[] = pageRows.map((row) => ({
        id: row.gap_id,
        assetId: row.canonical_asset_id || undefined,
        code: row.type,
        severity: gapSeverity(row.severity),
        evidence: gapEvidence(row),
        recommendedAction: gapRecommendedAction(row),
        requiresLiveGrok: !!row.requires_live_grok,
        requiresCloudWrite: !!row.requires_cloud_write,
    }));

    return {
        ok: true,
        source: 'canonical',
        snapshot: {
            snapshotId: snapshot.snapshot_id,
            schemaVersion: snapshot.schema_version,
            stableContentHash: snapshot.stable_content_hash,
            projectedAt: snapshot.projected_at,
        },
        gaps,
        nextCursor: rows.length > queryLimit ? String(offset + queryLimit) : null,
        counts: {
            gaps: gaps.length,
            blocking: gaps.filter((gap) => gap.severity === 'blocking').length,
            warning: gaps.filter((gap) => gap.severity === 'warning').length,
            info: gaps.filter((gap) => gap.severity === 'info').length,
            requiresLiveGrok: gaps.filter((gap) => gap.requiresLiveGrok).length,
            requiresCloudWrite: gaps.filter((gap) => gap.requiresCloudWrite).length,
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

async function findCanonicalMediaObjectKey(env: Env, assetId: string): Promise<string | null> {
    const snapshot = await currentCanonicalSnapshot(env);
    if (!snapshot) return null;
    const asset = await env.DB
        .prepare(
            `SELECT canonical_object_key
             FROM canonical_asset_projection
             WHERE snapshot_id = ?1 AND canonical_asset_id = ?2
             LIMIT 1`
        )
        .bind(snapshot.snapshot_id, assetId)
        .first<{ canonical_object_key: string | null }>();
    if (asset?.canonical_object_key) return asset.canonical_object_key;

    const storage = await env.DB
        .prepare(
            `SELECT object_key
             FROM canonical_storage_object_projection
             WHERE snapshot_id = ?1 AND canonical_asset_id = ?2
             ORDER BY CASE status
                 WHEN 'canonical' THEN 0
                 WHEN 'date_folder_mapped' THEN 1
                 WHEN 'alternate_duplicate' THEN 2
                 ELSE 3
               END,
               object_key ASC
             LIMIT 1`
        )
        .bind(snapshot.snapshot_id, assetId)
        .first<{ object_key: string }>();
    return storage?.object_key || null;
}

export async function findVaultMediaObject(env: Env, assetId: string, options: VaultReadOptions = {}) {
    if (options.source === 'canonical') {
        const objectKey = await findCanonicalMediaObjectKey(env, assetId);
        return objectKey ? env.R2_BUCKET.get(objectKey) : null;
    }

    let cursor: string | null = null;
    for (let page = 0; page < 100; page += 1) {
        const inventory = await listVaultInventory(env, cursor, 1000);
        const match = inventory.items.find((item) => item.assetId === assetId);
        const objectKey = match?.canonicalObjectKey || match?.legacyObjectKeys[0];
        if (objectKey) return env.R2_BUCKET.get(objectKey);
        cursor = inventory.nextCursor || null;
        if (!cursor) return null;
    }
    return null;
}
