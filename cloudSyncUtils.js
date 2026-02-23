(function () {
    const RETRY_SCHEDULE_MINUTES = [1, 5, 15, 60, 180, 720];
    const MAX_RETRY_ATTEMPTS = 6;
    const DEFAULT_KEY_PREFIX = 'grok-powertools/v1';
    const DEFAULT_CLOUD_CONFIG = {
        enabled: false,
        mode: 'local_only',
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
        return workerUrl.trim().replace(/\/+$/, '');
    }

    function validateWorkersDevUrl(workerUrl) {
        const normalized = normalizeWorkerUrl(workerUrl);
        if (!normalized) return false;

        let parsed;
        try {
            parsed = new URL(normalized);
        } catch (e) {
            return false;
        }

        if (parsed.protocol !== 'https:') return false;
        return /^[a-z0-9-]+\.workers\.dev$/i.test(parsed.hostname);
    }

    function normalizeCloudConfig(config) {
        const merged = { ...DEFAULT_CLOUD_CONFIG, ...(config || {}) };
        const hasExplicitMode = !!(config && typeof config === 'object' && Object.prototype.hasOwnProperty.call(config, 'mode'));
        const explicitMode = hasExplicitMode
            ? (merged.mode === 'dual_write' ? 'dual_write' : 'local_only')
            : null;
        const legacyEnabled = !!(config && typeof config === 'object' && config.enabled);
        const normalizedMode = explicitMode || (legacyEnabled ? 'dual_write' : 'local_only');
        const enabled = normalizedMode === 'dual_write';
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

    function buildMetadataObjectKey(params) {
        const keyPrefix = sanitizeKeyPrefix(params.keyPrefix);
        const userId = sanitizeUserId(params.userId || 'Shared_Account');
        const kind = params.kind;

        if (kind === 'backfillManifest') {
            const timestamp = typeof params.timestamp === 'number' ? params.timestamp : Date.now();
            return `${keyPrefix}/users/${userId}/metadata/backfill-manifest.${timestamp}.json`;
        }

        const filename = METADATA_KIND_TO_FILENAME[kind];
        if (!filename) {
            throw new Error(`Unsupported metadata kind: ${kind}`);
        }

        return `${keyPrefix}/users/${userId}/metadata/${filename}`;
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
        return normalized.enabled && normalized.mode === 'dual_write';
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
        sanitizeKeyPrefix,
        normalizeWorkerUrl,
        validateWorkersDevUrl,
        normalizeCloudConfig,
        buildMediaObjectKey,
        buildMediaObjectKeyFromFinalPath,
        buildMetadataObjectKey,
        getRetryDelayMinutes,
        detectContentTypeFromUrl,
        isCloudEnabled
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = utils;
    }

    if (typeof self !== 'undefined') {
        self.CloudSyncUtils = utils;
    }
})();
