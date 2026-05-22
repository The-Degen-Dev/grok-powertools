(function () {
    const RETRY_SCHEDULE_MINUTES = [1, 5, 15, 60, 180, 720];
    const MAX_RETRY_ATTEMPTS = 6;
    const DEFAULT_KEY_PREFIX = 'grok-powertools/v1';
    const WORKERS_DEV_SUFFIX = '.workers.dev';
    const WORKERS_DEV_LABEL_REGEX = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
    const UUID_REGEX = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
    const UUID_GLOBAL_REGEX = new RegExp(UUID_REGEX.source, 'gi');
    const GENERIC_MEDIA_STEMS = new Set([
        'generated',
        'generated_image',
        'generated_video',
        'image',
        'video',
        'download',
        'file'
    ]);
    const CLOUD_MODES = {
        localOnly: 'local_only',
        cloudOnly: 'cloud_only',
        dualWrite: 'dual_write'
    };
    const VALID_CLOUD_MODES = new Set([
        CLOUD_MODES.localOnly,
        CLOUD_MODES.cloudOnly,
        CLOUD_MODES.dualWrite
    ]);
    const DEFAULT_CLOUD_CONFIG = {
        enabled: false,
        mode: CLOUD_MODES.localOnly,
        workerUrl: '',
        apiKey: '',
        keyPrefix: DEFAULT_KEY_PREFIX
    };

    const STORAGE_KEYS = {
        cloudConfig: 'cloudConfig',
        cloudSyncQueue: 'cloudSyncQueue',
        cloudSyncState: 'cloudSyncState'
    };

    const METADATA_KIND_TO_FILENAME = {
        savedPrompts: 'saved-prompts.latest.json',
        promptHistory: 'prompt-history.latest.json',
        processedIds: 'processed-ids.latest.json'
    };

    function sanitizeKeyPrefix(keyPrefix) {
        const raw = typeof keyPrefix === 'string' ? keyPrefix.trim() : '';
        const normalized = raw.replace(/^\/+/, '').replace(/\/+$/, '');
        return normalized || DEFAULT_KEY_PREFIX;
    }

    function normalizeWorkerUrl(workerUrl) {
        if (typeof workerUrl !== 'string') return '';
        const trimmed = workerUrl.trim();
        if (!trimmed) return '';

        try {
            const parsed = new URL(trimmed);
            return parsed.origin;
        } catch {
            return trimmed.replace(/\/+$/, '');
        }
    }

    function validateWorkersDevUrl(workerUrl) {
        const normalized = normalizeWorkerUrl(workerUrl);
        if (!normalized) return false;

        let parsed;
        try {
            parsed = new URL(normalized);
        } catch {
            return false;
        }

        if (parsed.protocol !== 'https:') return false;
        const hostname = parsed.hostname.toLowerCase();
        if (hostname === 'workers.dev') return false;
        if (!hostname.endsWith(WORKERS_DEV_SUFFIX)) return false;

        const prefix = hostname.slice(0, -WORKERS_DEV_SUFFIX.length);
        if (!prefix) return false;

        const labels = prefix.split('.');
        return labels.length > 0 && labels.every((label) => WORKERS_DEV_LABEL_REGEX.test(label));
    }

    function normalizeCloudConfig(config) {
        const merged = { ...DEFAULT_CLOUD_CONFIG, ...(config || {}) };
        const hasExplicitMode = !!(config && typeof config === 'object' && Object.prototype.hasOwnProperty.call(config, 'mode'));
        const explicitMode = hasExplicitMode
            ? (VALID_CLOUD_MODES.has(merged.mode) ? merged.mode : CLOUD_MODES.localOnly)
            : null;
        const legacyEnabled = !!(config && typeof config === 'object' && config.enabled);
        const normalizedMode = explicitMode || (legacyEnabled ? CLOUD_MODES.dualWrite : CLOUD_MODES.localOnly);
        const enabled = normalizedMode !== CLOUD_MODES.localOnly;
        return {
            enabled,
            mode: normalizedMode,
            workerUrl: normalizeWorkerUrl(merged.workerUrl),
            apiKey: typeof merged.apiKey === 'string' ? merged.apiKey.trim() : '',
            keyPrefix: sanitizeKeyPrefix(merged.keyPrefix)
        };
    }

    function buildMediaObjectKey(params) {
        const keyPrefix = sanitizeKeyPrefix(params.keyPrefix);
        const userId = sanitizeUserId(params.userId || 'Shared_Account');
        const dateFolder = sanitizePathSegment(params.dateFolder || new Date().toISOString().split('T')[0] + '_Auto');
        const filename = sanitizeFileStem(params.filename || Date.now().toString());
        const extension = sanitizeExtension(params.extension || 'png');
        return `${keyPrefix}/users/${userId}/media/${dateFolder}/${filename}.${extension}`;
    }

    function buildMediaObjectKeyFromFinalPath(finalPath, params) {
        const segments = String(finalPath || '')
            .split('/')
            .map((entry) => entry.trim())
            .filter(Boolean);

        const fallbackUserId = sanitizeUserId((params && params.fallbackUserId) || 'Shared_Account');
        const keyPrefix = sanitizeKeyPrefix(params && params.keyPrefix);

        const baseName = segments.length ? segments[segments.length - 1] : `${Date.now()}.png`;
        const dateFolder = segments.length >= 2 ? sanitizePathSegment(segments[segments.length - 2]) : `${new Date().toISOString().split('T')[0]}_Auto`;
        const userId = segments.length >= 3 ? sanitizeUserId(segments[segments.length - 3]) : fallbackUserId;

        const dotIndex = baseName.lastIndexOf('.');
        const filename = dotIndex > 0 ? baseName.slice(0, dotIndex) : baseName;
        const extension = dotIndex > 0 ? baseName.slice(dotIndex + 1) : 'png';

        return buildMediaObjectKey({
            keyPrefix,
            userId,
            dateFolder,
            filename,
            extension
        });
    }

    function normalizeSourceUrlForIdentity(sourceUrl) {
        if (typeof sourceUrl !== 'string' || !sourceUrl.trim()) return '';
        try {
            const parsed = new URL(sourceUrl.trim());
            parsed.hash = '';
            parsed.search = '';
            parsed.hostname = parsed.hostname.toLowerCase();
            return parsed.toString();
        } catch {
            return sourceUrl.trim().split('#')[0].split('?')[0];
        }
    }

    function stableStringHash(value) {
        const text = String(value || '');
        let hash = 0x811c9dc5;
        for (let i = 0; i < text.length; i++) {
            hash ^= text.charCodeAt(i);
            hash = Math.imul(hash, 0x01000193);
        }
        return (hash >>> 0).toString(16).padStart(8, '0');
    }

    function buildSourceUrlHash(sourceUrl) {
        const normalized = normalizeSourceUrlForIdentity(sourceUrl);
        return `url_${stableStringHash(normalized)}`;
    }

    function getPathSegments(value) {
        if (typeof value !== 'string') return [];
        let path = value;
        try {
            path = new URL(value).pathname;
        } catch {
            path = value.split('?')[0].split('#')[0];
        }

        return path
            .split('/')
            .map((entry) => entry.trim())
            .filter(Boolean);
    }

    function getFilePartsFromPath(value) {
        const segments = getPathSegments(value);
        const baseName = segments.length ? segments[segments.length - 1] : '';
        const dotIndex = baseName.lastIndexOf('.');
        const stem = dotIndex > 0 ? baseName.slice(0, dotIndex) : baseName;
        const extension = dotIndex > 0 ? baseName.slice(dotIndex + 1) : '';
        return {
            baseName,
            stem,
            extension: sanitizeExtension(extension || 'png')
        };
    }

    function extensionFromContentType(contentType) {
        const value = String(contentType || '').toLowerCase();
        if (value.includes('mp4')) return 'mp4';
        if (value.includes('webm')) return 'webm';
        if (value.includes('jpeg')) return 'jpg';
        if (value.includes('jpg')) return 'jpg';
        if (value.includes('webp')) return 'webp';
        if (value.includes('gif')) return 'gif';
        if (value.includes('png')) return 'png';
        return '';
    }

    function resolveMediaExtension(params) {
        const fromContentType = extensionFromContentType(params && params.contentType);
        if (fromContentType) return fromContentType;

        const sourceParts = getFilePartsFromPath(params && params.sourceUrl);
        if (sourceParts.extension) return sourceParts.extension;

        const finalParts = getFilePartsFromPath(params && params.finalPath);
        if (finalParts.extension) return finalParts.extension;

        return 'png';
    }

    function extractStableMediaId(value) {
        const segments = getPathSegments(value);
        const matches = [];
        for (const segment of segments) {
            const segmentMatches = segment.match(UUID_GLOBAL_REGEX);
            if (segmentMatches) matches.push(...segmentMatches);
        }
        if (matches.length > 0) return matches[matches.length - 1].toLowerCase();

        const { stem } = getFilePartsFromPath(value);
        const safeStem = sanitizeFileStem(stem || '');
        if (safeStem && safeStem.length >= 10 && !GENERIC_MEDIA_STEMS.has(safeStem.toLowerCase())) {
            return safeStem;
        }

        return '';
    }

    function resolveMediaAssetIdentity(params) {
        const sourceUrl = params && params.sourceUrl;
        const finalPath = params && params.finalPath;
        const mediaType = params && params.mediaType ? params.mediaType : detectMediaType(params && params.contentType, sourceUrl, finalPath);
        const postId = params && params.postId;
        const mediaIndex = Number.isFinite(params && params.mediaIndex) ? Math.max(0, Math.floor(params.mediaIndex)) : null;
        const sourceUrlHash = buildSourceUrlHash(sourceUrl);

        if (postId && mediaIndex !== null) {
            return {
                kind: 'grok_post_media',
                assetId: sanitizeFileStem(`post_${postId}_${mediaIndex}_${mediaType}`),
                sourceUrlHash,
                mediaType
            };
        }

        const stableMediaId = extractStableMediaId(sourceUrl) || extractStableMediaId(finalPath);
        if (stableMediaId) {
            return {
                kind: 'stable_media_id',
                assetId: sanitizeFileStem(`media_${stableMediaId}`),
                sourceUrlHash,
                mediaType
            };
        }

        const contentSha256 = String((params && params.contentSha256) || '').trim().toLowerCase();
        if (/^[a-f0-9]{64}$/.test(contentSha256)) {
            return {
                kind: 'content_hash',
                assetId: `sha256_${contentSha256}`,
                sourceUrlHash,
                mediaType
            };
        }

        return {
            kind: 'source_url_hash',
            assetId: sourceUrlHash,
            sourceUrlHash,
            mediaType
        };
    }

    function buildCanonicalMediaObjectKey(params) {
        const keyPrefix = sanitizeKeyPrefix(params && params.keyPrefix);
        const userId = sanitizeUserId((params && params.userId) || 'Shared_Account');
        const assetId = sanitizeFileStem((params && params.assetId) || 'unknown_asset');
        const extension = sanitizeExtension((params && params.extension) || 'png');
        return `${keyPrefix}/users/${userId}/media/by-asset/${assetId}.${extension}`;
    }

    function buildMediaObjectKeyForUpload(params) {
        const userId = sanitizeUserId((params && (params.userId || params.fallbackUserId)) || 'Shared_Account');
        const identity = resolveMediaAssetIdentity(params || {});
        const extension = resolveMediaExtension(params || {});
        return buildCanonicalMediaObjectKey({
            keyPrefix: params && params.keyPrefix,
            userId,
            assetId: identity.assetId,
            extension
        });
    }

    function buildMediaDedupeKey(params) {
        const userId = sanitizeUserId((params && (params.userId || params.fallbackUserId)) || 'Shared_Account');
        const identity = resolveMediaAssetIdentity(params || {});
        return `media:${userId}:${identity.assetId}`;
    }

    function buildMetadataObjectKey(params) {
        const keyPrefix = sanitizeKeyPrefix(params.keyPrefix);
        const userId = sanitizeUserId(params.userId || 'Shared_Account');
        const kind = params.kind;

        if (kind === 'backfillManifest') {
            if (params.versionHash) {
                const versionHash = sanitizeFileStem(params.versionHash);
                return `${keyPrefix}/users/${userId}/metadata/backfill-manifest.${versionHash}.json`;
            }
            return `${keyPrefix}/users/${userId}/metadata/backfill-manifest.latest.json`;
        }

        const filename = METADATA_KIND_TO_FILENAME[kind];
        if (!filename) {
            throw new Error(`Unsupported metadata kind: ${kind}`);
        }

        return `${keyPrefix}/users/${userId}/metadata/${filename}`;
    }

    function detectMediaType(contentType, sourceUrl, finalPath) {
        const value = `${contentType || ''} ${sourceUrl || ''} ${finalPath || ''}`.toLowerCase();
        if (value.includes('video/') || value.includes('.mp4') || value.includes('.webm')) return 'video';
        if (value.includes('image/') || value.includes('.png') || value.includes('.jpg') || value.includes('.jpeg') || value.includes('.webp') || value.includes('.gif')) return 'image';
        return 'unknown';
    }

    function getRetryDelayMinutes(attemptNumber) {
        const safeAttempt = Number.isFinite(attemptNumber) ? Math.max(1, Math.floor(attemptNumber)) : 1;
        const index = Math.min(RETRY_SCHEDULE_MINUTES.length - 1, safeAttempt - 1);
        return RETRY_SCHEDULE_MINUTES[index];
    }

    function detectContentTypeFromUrl(url) {
        const clean = String(url || '').split('?')[0].toLowerCase();
        if (clean.endsWith('.mp4')) return 'video/mp4';
        if (clean.endsWith('.webm')) return 'video/webm';
        if (clean.endsWith('.jpg') || clean.endsWith('.jpeg')) return 'image/jpeg';
        if (clean.endsWith('.webp')) return 'image/webp';
        if (clean.endsWith('.gif')) return 'image/gif';
        return 'image/png';
    }

    function isCloudEnabled(config) {
        const normalized = normalizeCloudConfig(config);
        return normalized.enabled && normalized.mode !== CLOUD_MODES.localOnly;
    }

    function isLocalDownloadEnabled(config) {
        const normalized = normalizeCloudConfig(config);
        return normalized.mode !== CLOUD_MODES.cloudOnly;
    }

    const UPLOAD_STAGES = {
        mediaFetch: 'media-fetch',
        presign: 'presign',
        r2Put: 'r2-put',
        r2Verify: 'r2-verify',
        healthCheck: 'health-check',
        testUpload: 'test-upload'
    };

    const KNOWN_MEDIA_HOSTS = ['imagine-public.x.ai', 'assets.grok.com'];

    function isValidMediaSourceUrl(url) {
        if (typeof url !== 'string' || !url) return false;
        try {
            const parsed = new URL(url);
            if (parsed.protocol !== 'https:') return false;
            return KNOWN_MEDIA_HOSTS.includes(parsed.hostname.toLowerCase());
        } catch {
            return false;
        }
    }

    function buildTestUploadObjectKey(keyPrefix) {
        const prefix = sanitizeKeyPrefix(keyPrefix);
        return `${prefix}/users/_system/upload-test.txt`;
    }

    function sanitizeUserId(userId) {
        return sanitizePathSegment(userId || 'Shared_Account') || 'Shared_Account';
    }

    function sanitizePathSegment(value) {
        return String(value || 'unknown')
            .replace(/\.{2,}/g, '')
            .replace(/\//g, '_')
            .replace(/\\/g, '_')
            .replace(/[^a-zA-Z0-9._-]/g, '_')
            .replace(/_{2,}/g, '_')
            .replace(/^_+|_+$/g, '') || 'unknown';
    }

    function sanitizeFileStem(value) {
        return sanitizePathSegment(value || Date.now().toString());
    }

    function sanitizeExtension(value) {
        const normalized = String(value || 'png').replace(/^\./, '').toLowerCase();
        return normalized.replace(/[^a-z0-9]/g, '') || 'png';
    }

    const utils = {
        RETRY_SCHEDULE_MINUTES,
        MAX_RETRY_ATTEMPTS,
        DEFAULT_KEY_PREFIX,
        DEFAULT_CLOUD_CONFIG,
        STORAGE_KEYS,
        METADATA_KIND_TO_FILENAME,
        CLOUD_MODES,
        UPLOAD_STAGES,
        KNOWN_MEDIA_HOSTS,
        isValidMediaSourceUrl,
        buildTestUploadObjectKey,
        sanitizeKeyPrefix,
        normalizeWorkerUrl,
        validateWorkersDevUrl,
        normalizeCloudConfig,
        buildMediaObjectKey,
        buildMediaObjectKeyFromFinalPath,
        buildCanonicalMediaObjectKey,
        buildMediaObjectKeyForUpload,
        buildMediaDedupeKey,
        buildMetadataObjectKey,
        normalizeSourceUrlForIdentity,
        buildSourceUrlHash,
        extractStableMediaId,
        resolveMediaAssetIdentity,
        resolveMediaExtension,
        detectMediaType,
        getRetryDelayMinutes,
        detectContentTypeFromUrl,
        isCloudEnabled,
        isLocalDownloadEnabled
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = utils;
    }

    if (typeof self !== 'undefined') {
        self.CloudSyncUtils = utils;
    }
})();
