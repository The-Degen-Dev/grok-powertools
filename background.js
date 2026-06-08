// Background Service Worker
if (typeof importScripts === 'function') {
    try {
        importScripts('cloudSyncUtils.js');
    } catch (e) {
        console.warn('CloudSyncUtils failed to load.', e);
    }
}

const CloudSync = (typeof self !== 'undefined' && self.CloudSyncUtils)
    ? self.CloudSyncUtils
    : {
        RETRY_SCHEDULE_MINUTES: [1, 5, 15, 60, 180, 720],
        MAX_RETRY_ATTEMPTS: 6,
        CLOUD_MODES: {
            localOnly: 'local_only',
            cloudOnly: 'cloud_only',
            dualWrite: 'dual_write'
        },
        DEFAULT_CLOUD_CONFIG: {
            enabled: false,
            mode: 'local_only',
            workerUrl: '',
            apiKey: '',
            keyPrefix: 'grok-powertools/v1'
        },
        STORAGE_KEYS: {
            cloudConfig: 'cloudConfig',
            cloudSyncQueue: 'cloudSyncQueue',
            cloudSyncState: 'cloudSyncState'
        },
        normalizeCloudConfig(config) {
            const merged = { ...this.DEFAULT_CLOUD_CONFIG, ...(config || {}) };
            const validModes = new Set([
                this.CLOUD_MODES.localOnly,
                this.CLOUD_MODES.cloudOnly,
                this.CLOUD_MODES.dualWrite
            ]);
            const hasExplicitMode = !!(config && typeof config === 'object' && Object.prototype.hasOwnProperty.call(config, 'mode'));
            const explicitMode = hasExplicitMode
                ? (validModes.has(merged.mode) ? merged.mode : this.CLOUD_MODES.localOnly)
                : null;
            const legacyEnabled = !!(config && typeof config === 'object' && config.enabled);
            merged.mode = explicitMode || (legacyEnabled ? this.CLOUD_MODES.dualWrite : this.CLOUD_MODES.localOnly);
            merged.enabled = merged.mode !== this.CLOUD_MODES.localOnly;
            merged.workerUrl = this.normalizeWorkerUrl(merged.workerUrl);
            merged.apiKey = String(merged.apiKey || '').trim();
            merged.keyPrefix = String(merged.keyPrefix || 'grok-powertools/v1').trim().replace(/^\/+/, '').replace(/\/+$/, '');
            return merged;
        },
        normalizeWorkerUrl(value) {
            const trimmed = String(value || '').trim();
            if (!trimmed) return '';

            try {
                return new URL(trimmed).origin;
            } catch {
                return trimmed.replace(/\/+$/, '');
            }
        },
        validateWorkersDevUrl(value) {
            try {
                const parsed = new URL(this.normalizeWorkerUrl(value));
                if (parsed.protocol !== 'https:') return false;

                const hostname = parsed.hostname.toLowerCase();
                if (hostname === 'workers.dev') return false;
                if (!hostname.endsWith('.workers.dev')) return false;

                const prefix = hostname.slice(0, -'.workers.dev'.length);
                if (!prefix) return false;

                const labels = prefix.split('.');
                return labels.every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label));
            } catch {
                return false;
            }
        },
        buildMediaObjectKeyFromFinalPath(finalPath, params) {
            const segments = String(finalPath || '').split('/').filter(Boolean);
            const file = segments[segments.length - 1] || `${Date.now()}.png`;
            const dateFolder = segments[segments.length - 2] || `${new Date().toISOString().split('T')[0]}_Auto`;
            const userId = segments[segments.length - 3] || (params && params.fallbackUserId) || 'Shared_Account';
            return `${params.keyPrefix}/users/${userId}/media/${dateFolder}/${file}`;
        },
        detectContentTypeFromUrl(url) {
            const clean = String(url || '').split('?')[0].toLowerCase();
            if (clean.endsWith('.mp4')) return 'video/mp4';
            if (clean.endsWith('.webm')) return 'video/webm';
            if (clean.endsWith('.jpg') || clean.endsWith('.jpeg')) return 'image/jpeg';
            if (clean.endsWith('.webp')) return 'image/webp';
            return 'image/png';
        },
        normalizeSourceUrlForIdentity(value) {
            return String(value || '').split('#')[0].split('?')[0];
        },
        buildSourceUrlHash(value) {
            let hash = 0x811c9dc5;
            const text = this.normalizeSourceUrlForIdentity(value);
            for (let i = 0; i < text.length; i++) {
                hash ^= text.charCodeAt(i);
                hash = Math.imul(hash, 0x01000193);
            }
            return `url_${(hash >>> 0).toString(16).padStart(8, '0')}`;
        },
        resolveMediaExtension(params) {
            const contentType = String((params && params.contentType) || '').toLowerCase();
            if (contentType.includes('mp4')) return 'mp4';
            const source = String((params && (params.sourceUrl || params.finalPath)) || '').split('?')[0].toLowerCase();
            if (source.endsWith('.mp4')) return 'mp4';
            if (source.endsWith('.jpg') || source.endsWith('.jpeg')) return 'jpg';
            if (source.endsWith('.webp')) return 'webp';
            return 'png';
        },
        resolveMediaAssetIdentity(params) {
            const sourceUrlHash = this.buildSourceUrlHash(params && params.sourceUrl);
            const source = `${(params && params.sourceUrl) || ''}/${(params && params.finalPath) || ''}`;
            const uuidMatch = source.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
            const contentSha256 = String((params && params.contentSha256) || '').toLowerCase();
            const assetId = uuidMatch
                ? `media_${uuidMatch[0].toLowerCase()}`
                : (/^[a-f0-9]{64}$/.test(contentSha256) ? `sha256_${contentSha256}` : sourceUrlHash);
            return {
                kind: uuidMatch ? 'stable_media_id' : (/^[a-f0-9]{64}$/.test(contentSha256) ? 'content_hash' : 'source_url_hash'),
                assetId,
                sourceUrlHash,
                mediaType: this.detectContentTypeFromUrl(source).startsWith('video/') ? 'video' : 'image'
            };
        },
        buildMediaObjectKeyForUpload(params) {
            const keyPrefix = String((params && params.keyPrefix) || 'grok-powertools/v1').replace(/^\/+/, '').replace(/\/+$/, '');
            const userId = String((params && (params.userId || params.fallbackUserId)) || 'Shared_Account').replace(/[^a-zA-Z0-9._-]/g, '_');
            const identity = this.resolveMediaAssetIdentity(params || {});
            const extension = this.resolveMediaExtension(params || {});
            return `${keyPrefix}/users/${userId}/media/by-asset/${identity.assetId}.${extension}`;
        },
        buildMediaDedupeKey(params) {
            const userId = String((params && (params.userId || params.fallbackUserId)) || 'Shared_Account').replace(/[^a-zA-Z0-9._-]/g, '_');
            return `media:${userId}:${this.resolveMediaAssetIdentity(params || {}).assetId}`;
        },
        getRetryDelayMinutes(attemptNumber) {
            const index = Math.min(this.RETRY_SCHEDULE_MINUTES.length - 1, Math.max(1, attemptNumber) - 1);
            return this.RETRY_SCHEDULE_MINUTES[index];
        },
        isCloudEnabled(config) {
            const normalized = this.normalizeCloudConfig(config);
            return !!normalized.enabled && normalized.mode !== this.CLOUD_MODES.localOnly;
        },
        isLocalDownloadEnabled(config) {
            const normalized = this.normalizeCloudConfig(config);
            return normalized.mode !== this.CLOUD_MODES.cloudOnly;
        }
    };

console.log('Grok Downloader Background Service Started');

let isScraping = false;
let isR2Backup = false;
let currentTabId = null;
const MAX_LOGS = 100;
const CLOUD_ALARM_NAME = 'gptCloudRetry';
const CLOUD_METADATA_DEBOUNCE_MS = 2000;
const CLOUD_SCHEMA_VERSION = 1;

// Global History Set
let processedUUIDs = new Set();

let cloudSyncQueue = [];
let cloudSyncState = {
    unsyncedCount: 0,
    lastError: null,
    lastSyncAt: null,
    retryScheduledAt: null,
    processing: false,
    lastTestAt: null,
    lastTestResult: null,
    lastTestMessage: null,
    r2BytesVerifiedExisting: 0,
    r2BytesUploadedNew: 0,
    r2DuplicateUploadsSkipped: 0,
    r2ConflictsDetected: 0,
    r2MetadataSnapshotsSkippedUnchanged: 0
};
let cloudMetadataTimer = null;
let pendingMetadataKinds = new Set();

const METADATA_WATCHED_KEYS = ['savedPrompts', 'promptHistory', 'processedIds'];
const METADATA_KIND_MAP = {
    savedPrompts: 'savedPrompts',
    promptHistory: 'promptHistory',
    processedIds: 'processedIds'
};

function log(msg, type = 'info') {
    const timestamp = new Date().toLocaleTimeString();
    const logEntry = `[${timestamp}] ${msg}`;
    console.log(logEntry);

    chrome.storage.local.get(['activityLogs'], (result) => {
        const logs = result.activityLogs || [];
        logs.unshift({ text: logEntry, type: type });
        if (logs.length > MAX_LOGS) logs.pop();
        chrome.storage.local.set({ activityLogs: logs });
        chrome.runtime.sendMessage({ action: 'UPDATE_LOGS', logs: logs }).catch(() => { });
    });
}

function saveHistory() {
    chrome.storage.local.set({ processedIds: Array.from(processedUUIDs) });
}

function shouldPersistBackupProcessedId(status) {
    return status === 'uploaded' || status === 'already_present' || status === 'conflict_uploaded';
}

function applyBackupProcessedIdPersistence(processedIds, id, status, persist) {
    if (!id || !shouldPersistBackupProcessedId(status)) return false;
    if (!processedIds.has(id)) {
        processedIds.add(id);
        persist();
    }
    return true;
}

function persistQueuedBackupProcessedId(item, result, processedIds, persist) {
    return applyBackupProcessedIdPersistence(processedIds, item?.backupProcessedId, result?.status, persist);
}

async function persistQueuedBackupProcessedIdAfterSuccess(item, result) {
    const id = item?.backupProcessedId;
    if (!id || !shouldPersistBackupProcessedId(result?.status)) return false;

    const stored = await chrome.storage.local.get(['processedIds']);
    const merged = new Set(Array.isArray(stored.processedIds) ? stored.processedIds : []);
    for (const processedId of processedUUIDs) {
        if (processedId) merged.add(processedId);
    }
    merged.add(id);

    processedUUIDs = merged;
    await chrome.storage.local.set({ processedIds: Array.from(processedUUIDs) });
    return true;
}

function buildDirectBackupUploadResponse(result, sourceUrl) {
    return {
        status: result.status,
        objectKey: result.objectKey,
        assetId: result.assetId,
        backupProcessedId: parseFilenameInfo(sourceUrl).uuid
    };
}

function makeQueueId(prefix = 'queue') {
    return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
}

function emitCloudStatus() {
    chrome.runtime.sendMessage({
        action: 'UPDATE_CLOUD_STATUS',
        state: getCloudStatusSnapshot()
    }).catch(() => { });
}

function getCloudStatusSnapshot() {
    return {
        ...cloudSyncState,
        unsyncedCount: cloudSyncQueue.length
    };
}

function getCloudTestTelemetry() {
    return {
        lastTestAt: cloudSyncState.lastTestAt,
        lastTestResult: cloudSyncState.lastTestResult,
        lastTestMessage: cloudSyncState.lastTestMessage
    };
}

async function persistCloudState() {
    cloudSyncState.unsyncedCount = cloudSyncQueue.length;
    await chrome.storage.local.set({
        [CloudSync.STORAGE_KEYS.cloudSyncQueue]: cloudSyncQueue,
        [CloudSync.STORAGE_KEYS.cloudSyncState]: cloudSyncState
    });
    emitCloudStatus();
}

async function getCloudConfig() {
    const stored = await chrome.storage.local.get([CloudSync.STORAGE_KEYS.cloudConfig]);
    return CloudSync.normalizeCloudConfig(stored[CloudSync.STORAGE_KEYS.cloudConfig]);
}

async function ensureCloudConfigExists() {
    const stored = await chrome.storage.local.get([CloudSync.STORAGE_KEYS.cloudConfig]);
    const normalized = CloudSync.normalizeCloudConfig(stored[CloudSync.STORAGE_KEYS.cloudConfig]);
    if (!stored[CloudSync.STORAGE_KEYS.cloudConfig]) {
        await chrome.storage.local.set({ [CloudSync.STORAGE_KEYS.cloudConfig]: normalized });
    }
    return normalized;
}

function getCloudValidationError(config) {
    if (!CloudSync.isCloudEnabled(config)) {
        return 'Cloud mode is disabled.';
    }
    if (!CloudSync.validateWorkersDevUrl(config.workerUrl)) {
        return 'Worker URL must be https://<worker>.<subdomain>.workers.dev';
    }
    if (!config.apiKey) {
        return 'API key is required.';
    }
    return null;
}

async function testCloudConnection(configOverride) {
    const baseConfig = configOverride
        ? CloudSync.normalizeCloudConfig(configOverride)
        : await getCloudConfig();

    const validationError = getCloudValidationError(baseConfig);
    if (validationError) {
        return { ok: false, error: validationError, errorSource: 'validation' };
    }

    // Stage 1: Health check
    let healthData;
    try {
        const response = await fetch(`${baseConfig.workerUrl}/health`, {
            method: 'GET',
            headers: { 'x-gpt-api-key': baseConfig.apiKey }
        });
        if (!response.ok) {
            const detail = await response.text().catch(() => 'Unknown response');
            throw new Error(`HTTP ${response.status}: ${detail}`);
        }
        healthData = await response.json();
    } catch (e) {
        throw new Error(`[${CloudSync.UPLOAD_STAGES.healthCheck}] ${e.message}`);
    }

    // Stage 2: Presign test
    const testObjectKey = CloudSync.buildTestUploadObjectKey(baseConfig.keyPrefix);
    const testBlob = new Blob(['upload-pipeline-test'], { type: 'text/plain' });
    const testSha256 = await sha256Blob(testBlob);
    const testDescriptor = {
        objectKey: testObjectKey,
        contentType: 'text/plain',
        assetId: 'system_upload_test',
        sourceUrlHash: 'system_upload_test',
        r2Metadata: sanitizeR2Metadata({
            sha256: testSha256,
            'asset-id': 'system_upload_test',
            'source-url-hash': 'system_upload_test',
            'asset-identity-kind': 'system-test'
        })
    };
    let presigned;
    try {
        presigned = await requestPresignedUrl(baseConfig, testDescriptor, testBlob.size);
    } catch (e) {
        throw new Error(`[${CloudSync.UPLOAD_STAGES.presign}] ${e.message}`);
    }

    // Stage 3: R2 PUT test
    try {
        const uploadHeaders = { ...(presigned.headers || {}), 'Content-Type': 'text/plain' };
        const uploadResponse = await fetch(presigned.uploadUrl, {
            method: presigned.method || 'PUT',
            headers: uploadHeaders,
            body: testBlob
        });
        if (!uploadResponse.ok) {
            const detail = await uploadResponse.text().catch(() => 'Unknown upload error');
            throw new Error(`HTTP ${uploadResponse.status}: ${detail}`);
        }
    } catch (e) {
        if (e.message.startsWith(`[${CloudSync.UPLOAD_STAGES.testUpload}]`)) throw e;
        throw new Error(`[${CloudSync.UPLOAD_STAGES.testUpload}] ${e.message}`);
    }

    // Stage 4: Worker/R2 verify test
    let verifyResult;
    try {
        verifyResult = await verifyR2Object(baseConfig, testDescriptor, {
            sizeBytes: testBlob.size,
            sha256: testSha256,
            contentType: 'text/plain'
        });
        if (!verifyResult.exists || !verifyResult.verified) {
            throw new Error(`Object verification failed: ${JSON.stringify(verifyResult.mismatches || [])}`);
        }
    } catch (e) {
        throw new Error(`[${CloudSync.UPLOAD_STAGES.r2Verify}] ${e.message}`);
    }

    return {
        ok: true,
        testUpload: true,
        testVerify: true,
        objectKey: testObjectKey,
        service: healthData.service,
        now: healthData.now
    };
}

function updateCloudError(errorMessage) {
    cloudSyncState.lastError = errorMessage || null;
}

function clearCloudError() {
    cloudSyncState.lastError = null;
}

function setCloudTestTelemetry(result, message) {
    cloudSyncState.lastTestAt = new Date().toISOString();
    cloudSyncState.lastTestResult = result || null;
    cloudSyncState.lastTestMessage = message || null;
}

async function clearCloudUiStatus() {
    cloudSyncState.lastError = null;
    cloudSyncState.lastTestAt = null;
    cloudSyncState.lastTestResult = null;
    cloudSyncState.lastTestMessage = null;

    await chrome.storage.local.set({ activityLogs: [] });
    chrome.runtime.sendMessage({ action: 'UPDATE_LOGS', logs: [] }).catch(() => { });
    await persistCloudState();
}

async function scheduleCloudRetryAlarm() {
    const retryableItems = cloudSyncQueue.filter((item) => (item.attempts || 0) < CloudSync.MAX_RETRY_ATTEMPTS);

    if (retryableItems.length === 0) {
        await chrome.alarms.clear(CLOUD_ALARM_NAME);
        cloudSyncState.retryScheduledAt = null;
        await persistCloudState();
        return;
    }

    const minAttempt = retryableItems.reduce((min, item) => {
        const nextAttempt = (item.attempts || 0) + 1;
        return Math.min(min, nextAttempt);
    }, Number.MAX_SAFE_INTEGER);

    const delayInMinutes = CloudSync.getRetryDelayMinutes(minAttempt);
    await chrome.alarms.clear(CLOUD_ALARM_NAME);
    chrome.alarms.create(CLOUD_ALARM_NAME, { delayInMinutes });

    cloudSyncState.retryScheduledAt = new Date(Date.now() + delayInMinutes * 60 * 1000).toISOString();
    await persistCloudState();
}

async function enqueueCloudItem(queueItem, dedupeKey) {
    const key = dedupeKey || queueItem.id;
    const existing = cloudSyncQueue.find((item) => item.dedupeKey === key);

    if (existing) {
        if (queueItem.type === 'metadata') {
            existing.payload = queueItem.payload;
            existing.kind = queueItem.kind;
            existing.userId = queueItem.userId;
            existing.updatedAt = Date.now();
            existing.attempts = 0;
            existing.lastError = null;
        } else if (queueItem.type === 'media') {
            existing.sourceUrl = queueItem.sourceUrl || existing.sourceUrl;
            existing.finalPath = queueItem.finalPath || existing.finalPath;
            existing.objectKey = queueItem.objectKey || existing.objectKey;
            existing.assetId = queueItem.assetId || existing.assetId;
            existing.sourceUrlHash = queueItem.sourceUrlHash || existing.sourceUrlHash;
            existing.assetIdentityKind = queueItem.assetIdentityKind || existing.assetIdentityKind;
            existing.contentType = queueItem.contentType || existing.contentType;
            existing.promptText = queueItem.promptText || existing.promptText || '';
            existing.backupProcessedId = queueItem.backupProcessedId || existing.backupProcessedId;
            existing.updatedAt = Date.now();
            existing.attempts = 0;
            existing.lastError = null;
        }
    } else {
        cloudSyncQueue.push({
            ...queueItem,
            dedupeKey: key,
            attempts: queueItem.attempts || 0,
            createdAt: queueItem.createdAt || Date.now()
        });
    }

    await persistCloudState();
}

async function enqueueCloudMediaUpload(sourceUrl, finalPath, promptText = '') {
    const config = await getCloudConfig();
    if (!CloudSync.isCloudEnabled(config)) return false;

    const userInfo = await chrome.storage.local.get(['activeGrokUserId']);
    const activeUserId = userInfo.activeGrokUserId || 'Shared_Account';

    const objectKey = CloudSync.buildMediaObjectKeyForUpload({
        keyPrefix: config.keyPrefix,
        fallbackUserId: activeUserId,
        sourceUrl,
        finalPath,
        contentType: CloudSync.detectContentTypeFromUrl(sourceUrl)
    });
    const identity = CloudSync.resolveMediaAssetIdentity({
        sourceUrl,
        finalPath,
        contentType: CloudSync.detectContentTypeFromUrl(sourceUrl)
    });

    const queueItem = {
        id: makeQueueId('media'),
        type: 'media',
        sourceUrl,
        finalPath,
        objectKey,
        assetId: identity.assetId,
        sourceUrlHash: identity.sourceUrlHash,
        assetIdentityKind: identity.kind,
        contentType: CloudSync.detectContentTypeFromUrl(sourceUrl),
        promptText: promptText || '',
        backupProcessedId: parseFilenameInfo(sourceUrl).uuid
    };

    await enqueueCloudItem(queueItem, CloudSync.buildMediaDedupeKey({
        fallbackUserId: activeUserId,
        sourceUrl,
        finalPath,
        contentType: queueItem.contentType
    }));
    try {
        await processCloudQueue('media-enqueued');
    } catch (e) {
        console.error('[CloudQueue] processCloudQueue error after media enqueue:', e);
        updateCloudError(e.message);
        await persistCloudState().catch(() => { });
    }
    return true;
}

async function enqueueMetadataSnapshot(kind, userId, payload) {
    const config = await getCloudConfig();
    if (!CloudSync.isCloudEnabled(config)) return;

    const queueItem = {
        id: makeQueueId('metadata'),
        type: 'metadata',
        kind,
        userId,
        payload: {
            schemaVersion: CLOUD_SCHEMA_VERSION,
            data: payload,
            updatedAt: new Date().toISOString()
        }
    };

    await enqueueCloudItem(queueItem, `metadata:${userId}:${kind}`);
}

function toHex(buffer) {
    return Array.from(new Uint8Array(buffer))
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');
}

async function sha256Blob(blob) {
    const buffer = await blob.arrayBuffer();
    const digest = await crypto.subtle.digest('SHA-256', buffer);
    return toHex(digest);
}

function sanitizeR2Metadata(metadata = {}) {
    const clean = {};
    for (const [key, value] of Object.entries(metadata)) {
        if (value === undefined || value === null || value === '') continue;
        const safeKey = String(key).toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 64);
        if (!safeKey) continue;
        clean[safeKey] = String(value).slice(0, 1024);
    }
    return clean;
}

function buildUploadDescriptor(config, params) {
    const identity = CloudSync.resolveMediaAssetIdentity(params);
    const objectKey = CloudSync.buildMediaObjectKeyForUpload({
        ...params,
        keyPrefix: config.keyPrefix,
        userId: params.userId
    });
    const extension = CloudSync.resolveMediaExtension(params);
    const extensionVersion = chrome.runtime?.getManifest ? chrome.runtime.getManifest().version : 'unknown';

    return {
        ...params,
        objectKey,
        assetId: identity.assetId,
        assetIdentityKind: identity.kind,
        sourceUrlHash: identity.sourceUrlHash,
        mediaType: identity.mediaType,
        extension,
        r2Metadata: sanitizeR2Metadata({
            'asset-id': identity.assetId,
            'asset-identity-kind': identity.kind,
            'source-url-hash': identity.sourceUrlHash,
            sha256: params.contentSha256,
            'media-type': identity.mediaType,
            'extension-version': extensionVersion,
            'captured-at': new Date().toISOString()
        })
    };
}

function buildConflictObjectKey(config, descriptor) {
    const keyPrefix = CloudSync.sanitizeKeyPrefix ? CloudSync.sanitizeKeyPrefix(config.keyPrefix) : (config.keyPrefix || 'grok-powertools/v1');
    const userId = String(descriptor.userId || 'Shared_Account').replace(/[^a-zA-Z0-9._-]/g, '_');
    const assetId = String(descriptor.assetId || 'unknown_asset').replace(/[^a-zA-Z0-9._-]/g, '_');
    const timestamp = new Date().toISOString().replace(/[^0-9TZ]/g, '');
    return `${keyPrefix}/users/${userId}/media/conflicts/${assetId}/${timestamp}.${descriptor.extension || 'bin'}`;
}

async function verifyR2Object(config, descriptor, expected = {}) {
    const response = await fetch(`${config.workerUrl}/v1/objects/verify`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-gpt-api-key': config.apiKey
        },
        body: JSON.stringify({
            objectKey: descriptor.objectKey,
            expectedSizeBytes: expected.sizeBytes,
            expectedSha256: expected.sha256,
            expectedContentType: expected.contentType,
            assetId: descriptor.assetId,
            sourceUrlHash: descriptor.sourceUrlHash
        })
    });

    if (!response.ok) {
        const detail = await response.text().catch(() => 'Unknown verify failure');
        throw new Error(`R2 verify failed (${response.status}): ${detail}`);
    }

    return response.json();
}

async function requestPresignedUrl(config, queueItem, contentLength) {
    const body = {
        objectKey: queueItem.objectKey,
        contentType: queueItem.contentType || 'application/octet-stream',
        contentLength
    };

    const metadata = sanitizeR2Metadata(queueItem.r2Metadata || {});
    if (Object.keys(metadata).length > 0) {
        body.metadata = metadata;
    }

    const response = await fetch(`${config.workerUrl}/v1/presign`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-gpt-api-key': config.apiKey
        },
        body: JSON.stringify(body)
    });

    if (!response.ok) {
        const detail = await response.text().catch(() => 'Unknown presign failure');
        throw new Error(`Presign failed (${response.status}): ${detail}`);
    }

    return response.json();
}

async function uploadPromptSidecar(config, descriptor) {
    if (!descriptor.promptText) return;

    try {
        const sidecarKey = descriptor.objectKey + '.prompt.json';
        const sidecar = JSON.stringify({
            prompt: descriptor.promptText,
            mediaKey: descriptor.objectKey,
            assetId: descriptor.assetId,
            uploadedAt: new Date().toISOString()
        });
        const sidecarItem = {
            objectKey: sidecarKey,
            contentType: 'application/json',
            r2Metadata: sanitizeR2Metadata({
                'asset-id': descriptor.assetId,
                'sidecar-kind': 'prompt'
            })
        };
        const sidecarPresigned = await requestPresignedUrl(config, sidecarItem, new Blob([sidecar]).size);
        await fetch(sidecarPresigned.uploadUrl, {
            method: 'PUT',
            headers: { ...(sidecarPresigned.headers || {}), 'Content-Type': 'application/json' },
            body: sidecar
        });
        console.log('[CloudQueue] Prompt sidecar uploaded:', sidecarKey);
    } catch (e) {
        console.warn('[CloudQueue] Sidecar prompt upload failed (non-fatal):', e.message);
    }
}

async function uploadBlobWithR2Dedupe(config, uploadCandidate, blob) {
    const contentType = uploadCandidate.contentType || blob.type || 'application/octet-stream';
    const contentSha256 = await sha256Blob(blob);
    let descriptor = buildUploadDescriptor(config, {
        ...uploadCandidate,
        contentType,
        contentSha256
    });

    let preflight;
    try {
        preflight = await verifyR2Object(config, descriptor, {
            sizeBytes: blob.size,
            sha256: contentSha256,
            contentType
        });
    } catch (e) {
        throw new Error(`[${CloudSync.UPLOAD_STAGES.presign}] ${e.message}`);
    }

    if (preflight.exists && preflight.verified) {
        cloudSyncState.r2BytesVerifiedExisting += blob.size;
        cloudSyncState.r2DuplicateUploadsSkipped += 1;
        await persistCloudState();
        log(`Cloud upload skipped, already present: ${descriptor.objectKey}`, 'success');
        return {
            status: 'already_present',
            objectKey: descriptor.objectKey,
            assetId: descriptor.assetId,
            contentSha256,
            bytes: blob.size
        };
    }

    if (preflight.exists && !preflight.verified) {
        const canonicalKey = descriptor.objectKey;
        descriptor = {
            ...descriptor,
            objectKey: buildConflictObjectKey(config, descriptor),
            conflictOfObjectKey: canonicalKey,
            r2Metadata: sanitizeR2Metadata({
                ...descriptor.r2Metadata,
                'conflict-of': canonicalKey
            })
        };
        cloudSyncState.r2ConflictsDetected += 1;
        await persistCloudState();
        log(`R2 canonical object conflict detected; writing conflict object for ${canonicalKey}`, 'warning');
    }

    let presigned;
    try {
        presigned = await requestPresignedUrl(config, descriptor, blob.size);
    } catch (e) {
        throw new Error(`[${CloudSync.UPLOAD_STAGES.presign}] ${e.message}`);
    }

    try {
        const uploadHeaders = { ...(presigned.headers || {}) };
        if (!uploadHeaders['Content-Type'] && !uploadHeaders['content-type']) {
            uploadHeaders['Content-Type'] = contentType;
        }

        const uploadResponse = await fetch(presigned.uploadUrl, {
            method: presigned.method || 'PUT',
            headers: uploadHeaders,
            body: blob
        });

        if (!uploadResponse.ok) {
            const detail = await uploadResponse.text().catch(() => 'Unknown upload error');
            throw new Error(`HTTP ${uploadResponse.status}: ${detail}`);
        }
    } catch (e) {
        if (e.message.startsWith(`[${CloudSync.UPLOAD_STAGES.r2Put}]`)) throw e;
        throw new Error(`[${CloudSync.UPLOAD_STAGES.r2Put}] ${e.message}`);
    }

    const postUpload = await verifyR2Object(config, descriptor, {
        sizeBytes: blob.size,
        sha256: contentSha256,
        contentType
    });
    if (!postUpload.exists || !postUpload.verified) {
        throw new Error(`[${CloudSync.UPLOAD_STAGES.r2Put}] R2 post-upload verification failed for ${descriptor.objectKey}`);
    }

    cloudSyncState.r2BytesUploadedNew += blob.size;
    await persistCloudState();
    await uploadPromptSidecar(config, descriptor);

    return {
        status: descriptor.conflictOfObjectKey ? 'conflict_uploaded' : 'uploaded',
        objectKey: descriptor.objectKey,
        assetId: descriptor.assetId,
        contentSha256,
        bytes: blob.size,
        conflictOfObjectKey: descriptor.conflictOfObjectKey
    };
}

async function uploadMediaQueueItem(config, queueItem) {
    let blob;
    let contentType;

    try {
        console.log('[CloudQueue] Fetching media blob from:', queueItem.sourceUrl.slice(0, 100));
        const fetchOpts = { method: 'GET' };

        if (queueItem.sourceUrl.includes('assets.grok.com')) {
            try {
                const cookies = await chrome.cookies.getAll({ domain: '.grok.com' });
                if (cookies.length > 0) {
                    const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');
                    fetchOpts.headers = { 'Cookie': cookieHeader };
                    console.log('[CloudQueue] Attached', cookies.length, 'cookies for assets.grok.com');
                }
            } catch (cookieErr) {
                console.warn('[CloudQueue] Failed to get cookies:', cookieErr.message);
            }
        }

        const mediaResponse = await fetch(queueItem.sourceUrl, fetchOpts);
        if (!mediaResponse.ok) {
            throw new Error(`HTTP ${mediaResponse.status}`);
        }
        blob = await mediaResponse.blob();
        contentType = mediaResponse.headers.get('content-type') || queueItem.contentType || 'application/octet-stream';
        queueItem.contentType = contentType;
    } catch (e) {
        const hint = !CloudSync.isValidMediaSourceUrl(queueItem.sourceUrl)
            ? ` (source host not in known media hosts: ${queueItem.sourceUrl})`
            : '';
        throw new Error(`[${CloudSync.UPLOAD_STAGES.mediaFetch}] ${e.message}${hint}`);
    }

    return uploadBlobWithR2Dedupe(config, {
        ...queueItem,
        contentType
    }, blob);
}

async function uploadMetadataQueueItem(config, queueItem) {
    const response = await fetch(`${config.workerUrl}/v1/metadata/snapshot`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-gpt-api-key': config.apiKey
        },
        body: JSON.stringify({
            userId: queueItem.userId,
            kind: queueItem.kind,
            payload: queueItem.payload
        })
    });

    if (!response.ok) {
        const detail = await response.text().catch(() => 'Unknown metadata snapshot error');
        throw new Error(`Metadata snapshot failed (${response.status}): ${detail}`);
    }

    return response.json();
}

async function processCloudQueue(reason = 'auto', options = {}) {
    if (cloudSyncState.processing) {
        console.log('[CloudQueue] SKIPPED processCloudQueue — already processing (reason:', reason, ')');
        return;
    }

    const config = await getCloudConfig();
    if (!CloudSync.isCloudEnabled(config)) {
        await scheduleCloudRetryAlarm();
        return;
    }

    const validationError = getCloudValidationError(config);
    if (validationError) {
        updateCloudError(validationError);
        await persistCloudState();
        return;
    }

    cloudSyncState.processing = true;
    await persistCloudState();

    const force = !!options.force;
    const remaining = [];

    try {
        for (const item of cloudSyncQueue) {
            const attempts = item.attempts || 0;
            if (!force && attempts >= CloudSync.MAX_RETRY_ATTEMPTS) {
                if (!item._permanentFailLogged) {
                    log(`Cloud sync permanently failed (${item.type}): ${item.objectKey || item.kind} after ${attempts} attempts — ${item.lastError || 'unknown error'}`, 'error');
                    item._permanentFailLogged = true;
                }
                remaining.push(item);
                continue;
            }

            try {
                if (item.type === 'media') {
                    console.log('[CloudQueue] Processing media item:', item.objectKey, '| sourceUrl:', item.sourceUrl?.slice(0, 80));
                    const result = await uploadMediaQueueItem(config, item);
                    await persistQueuedBackupProcessedIdAfterSuccess(item, result);
                    if (result.status === 'already_present') {
                        log(`Cloud upload already present: ${result.objectKey}`, 'success');
                    } else {
                        log(`Cloud upload complete: ${result.objectKey}`, result.status === 'conflict_uploaded' ? 'warning' : 'success');
                    }
                } else if (item.type === 'metadata') {
                    const result = await uploadMetadataQueueItem(config, item);
                    if (result && result.skipped) {
                        cloudSyncState.r2MetadataSnapshotsSkippedUnchanged += 1;
                        log(`Cloud metadata unchanged: ${item.kind}`, 'info');
                    } else {
                        log(`Cloud metadata synced: ${item.kind}`, 'success');
                    }
                } else {
                    throw new Error(`Unknown queue item type: ${item.type}`);
                }

                clearCloudError();
                cloudSyncState.lastSyncAt = new Date().toISOString();
            } catch (e) {
                console.error('[CloudQueue] Upload FAILED:', item.type, item.objectKey || item.kind, '|', e.message);
                item.attempts = attempts + 1;
                item.lastError = e.message;
                item.lastAttemptAt = Date.now();
                remaining.push(item);
                updateCloudError(e.message);
                log(`Cloud sync failed (${item.type}): ${e.message}`, 'warning');
            }
        }
    } finally {
        cloudSyncQueue = remaining;
        cloudSyncState.processing = false;
        await persistCloudState();
    }

    // If new items were queued while we were processing, drain immediately
    if (cloudSyncQueue.length > 0 && cloudSyncQueue.some(i => (i.attempts || 0) === 0)) {
        setTimeout(() => processCloudQueue('drain'), 100);
    } else {
        await scheduleCloudRetryAlarm();
    }

    if (reason === 'manual') {
        log('Manual cloud retry completed.', 'info');
    }
}

async function runCloudBackfill() {
    const config = await getCloudConfig();
    if (!CloudSync.isCloudEnabled(config)) {
        throw new Error('Enable Cloud Backup before running backfill.');
    }

    const stored = await chrome.storage.local.get([
        'savedPrompts',
        'promptHistory',
        'processedIds',
        'activeGrokUserId'
    ]);

    const userId = stored.activeGrokUserId || 'Shared_Account';

    await enqueueMetadataSnapshot('savedPrompts', userId, stored.savedPrompts || []);
    await enqueueMetadataSnapshot('promptHistory', userId, stored.promptHistory || []);
    await enqueueMetadataSnapshot('processedIds', userId, stored.processedIds || []);

    await enqueueMetadataSnapshot('backfillManifest', userId, {
        userId,
        generatedAt: new Date().toISOString(),
        counts: {
            savedPrompts: Array.isArray(stored.savedPrompts) ? stored.savedPrompts.length : 0,
            promptHistory: Array.isArray(stored.promptHistory) ? stored.promptHistory.length : 0,
            processedIds: Array.isArray(stored.processedIds) ? stored.processedIds.length : 0
        },
        note: 'Backfill includes prompts/history/processed IDs only. Media binaries are not backfilled in v1.'
    });

    await processCloudQueue('backfill');
}

function scheduleMetadataSyncForChanges(changes) {
    METADATA_WATCHED_KEYS.forEach((key) => {
        if (changes[key]) pendingMetadataKinds.add(key);
    });

    if (pendingMetadataKinds.size === 0) return;

    if (cloudMetadataTimer) clearTimeout(cloudMetadataTimer);
    cloudMetadataTimer = setTimeout(() => {
        flushMetadataSync().catch((e) => {
            updateCloudError(e.message);
            persistCloudState().catch(() => { });
        });
    }, CLOUD_METADATA_DEBOUNCE_MS);
}

async function flushMetadataSync() {
    const config = await getCloudConfig();
    if (!CloudSync.isCloudEnabled(config)) {
        pendingMetadataKinds.clear();
        return;
    }

    const kinds = Array.from(pendingMetadataKinds);
    pendingMetadataKinds.clear();

    if (kinds.length === 0) return;

    const stored = await chrome.storage.local.get([...METADATA_WATCHED_KEYS, 'activeGrokUserId']);
    const userId = stored.activeGrokUserId || 'Shared_Account';

    for (const storageKey of kinds) {
        const kind = METADATA_KIND_MAP[storageKey];
        if (!kind) continue;
        await enqueueMetadataSnapshot(kind, userId, stored[storageKey] || []);
    }

    await processCloudQueue('metadata');
}

function parseFilenameInfo(url, suggestedFilename) {
    let filename = 'unknown';
    let uuid = null;

    try {
        // Typical URL: .../images/UUID.png?cache...
        const parts = url.split('/');
        const lastPart = parts[parts.length - 1];
        const cleanName = lastPart.split('?')[0];

        if (cleanName.includes('.')) {
            filename = cleanName.split('.')[0];
        } else {
            filename = cleanName;
        }

        // Match the LAST UUID in the URL — for assets.grok.com/users/{USER_ID}/generated/{VIDEO_ID}/...
        // the first UUID is the user ID, the last is the actual media UUID
        const allUuids = url.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi) || [];
        const uuidMatch = allUuids.length ? [allUuids[allUuids.length - 1]] : null;
        if (uuidMatch) {
            uuid = uuidMatch[0];
            filename = uuid; // Enforce UUID as filename
        } else if (suggestedFilename) {
            // Fallback to suggested if provided and no UUID found in URL
            filename = suggestedFilename.split('.')[0];
        }

        // Generic filenames (e.g. "generated_video") get a timestamp to prevent overwrites
        const GENERIC_NAMES = ['generated_video', 'generated_image', 'unknown', 'image', 'video'];
        if (filename.length < 10 || GENERIC_NAMES.includes(filename.toLowerCase())) {
            filename = `${filename}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        }
    } catch (e) {
        filename = Date.now().toString();
    }

    return { filename, uuid };
}

// --- HELPER: Centralized Filename Generation ---
async function detectExtension(url, extHint) {
    if (extHint) return extHint;
    if (url.includes('.mp4')) return 'mp4';
    if (url.includes('.webm')) return 'webm';
    if (url.includes('.jpg') || url.includes('.jpeg')) return 'jpg';
    if (url.includes('.webp')) return 'webp';
    if (url.includes('.png')) return 'png';
    // No extension in URL — probe content type via HEAD request
    try {
        const head = await fetch(url, { method: 'HEAD' });
        const ct = (head.headers.get('content-type') || '').toLowerCase();
        if (ct.startsWith('video/')) return 'mp4';
        if (ct.includes('jpeg')) return 'jpg';
        if (ct.includes('webp')) return 'webp';
    } catch (e) { /* keep default */ }
    return 'png';
}

async function generateFilename(url, suggestedFilename, extHint) {
    const parsed = parseFilenameInfo(url, suggestedFilename);

    // 2. Deduplication Check
    if (parsed.uuid && processedUUIDs.has(parsed.uuid)) {
        console.log(`Skipping Duplicate: ${parsed.uuid}`);
        return null; // Signal cancel
    }

    // 3. Mark as processed (Optimistic)
    if (parsed.uuid) {
        processedUUIDs.add(parsed.uuid);
        saveHistory();
    }

    // 4. Build Path
    const dateStr = new Date().toISOString().split('T')[0];
    const ext = await detectExtension(url, extHint);

    const stored = await chrome.storage.local.get(['downloadPath', 'activeGrokUserId']);
    const rootFolder = stored.downloadPath || 'GrokVault';
    const userId = stored.activeGrokUserId || 'Shared_Account';

    // Construct: Root / UserID / Date / Filename
    return `${rootFolder}/${userId}/${dateStr}_Auto/${parsed.filename}.${ext}`;
}

async function generateFilenameForBackup(url, extHint) {
    const parsed = parseFilenameInfo(url);

    const dateStr = new Date().toISOString().split('T')[0];
    const ext = await detectExtension(url, extHint);

    const stored = await chrome.storage.local.get(['downloadPath', 'activeGrokUserId']);
    const rootFolder = stored.downloadPath || 'GrokVault';
    const userId = stored.activeGrokUserId || 'Shared_Account';

    return `${rootFolder}/${userId}/${dateStr}_Auto/${parsed.filename}.${ext}`;
}

async function initializeBackgroundState() {
    const stored = await chrome.storage.local.get([
        'processedIds',
        CloudSync.STORAGE_KEYS.cloudSyncQueue,
        CloudSync.STORAGE_KEYS.cloudSyncState
    ]);

    if (stored.processedIds) {
        processedUUIDs = new Set(stored.processedIds);
        console.log(`Loaded ${processedUUIDs.size} processed UUIDs.`);
    }

    cloudSyncQueue = Array.isArray(stored[CloudSync.STORAGE_KEYS.cloudSyncQueue])
        ? stored[CloudSync.STORAGE_KEYS.cloudSyncQueue]
        : [];

    cloudSyncState = {
        ...cloudSyncState,
        ...(stored[CloudSync.STORAGE_KEYS.cloudSyncState] || {}),
        unsyncedCount: cloudSyncQueue.length,
        processing: false
    };

    await ensureCloudConfigExists();
    await persistCloudState();
    await scheduleCloudRetryAlarm();
}

initializeBackgroundState().catch((e) => {
    console.error('Background initialization failed:', e);
});

chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === CLOUD_ALARM_NAME) {
        processCloudQueue('alarm').catch((e) => {
            updateCloudError(e.message);
            persistCloudState().catch(() => { });
        });
    }
});

chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;

    if (changes[CloudSync.STORAGE_KEYS.cloudConfig]) {
        const oldNormalized = CloudSync.normalizeCloudConfig(changes[CloudSync.STORAGE_KEYS.cloudConfig].oldValue);
        const newNormalized = CloudSync.normalizeCloudConfig(changes[CloudSync.STORAGE_KEYS.cloudConfig].newValue);

        if (JSON.stringify(oldNormalized) !== JSON.stringify(newNormalized)) {
            chrome.storage.local.set({ [CloudSync.STORAGE_KEYS.cloudConfig]: newNormalized }).catch(() => { });
        }

        if (CloudSync.isCloudEnabled(newNormalized)) {
            processCloudQueue('config-change').catch((e) => {
                updateCloudError(e.message);
                persistCloudState().catch(() => { });
            });
        } else {
            chrome.alarms.clear(CLOUD_ALARM_NAME).catch(() => { });
        }
    }

    scheduleMetadataSyncForChanges(changes);
});

// Handle messages
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'START_SCRAPE') {
        log('Background: Received START_SCRAPE.');
        isScraping = true;
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0] && (tabs[0].url.includes('x.com') || tabs[0].url.includes('grok.com'))) {
                currentTabId = tabs[0].id;

                // Helper to send message with retry
                const sendInit = () => {
                    chrome.tabs.sendMessage(currentTabId, { action: 'INIT_SCRAPE' }, (response) => {
                        if (chrome.runtime.lastError) {
                            console.warn('Injecting Content Script...');
                            chrome.scripting.executeScript({
                                target: { tabId: currentTabId },
                                files: ['content.js']
                            }, () => {
                                setTimeout(() => {
                                    chrome.tabs.sendMessage(currentTabId, { action: 'INIT_SCRAPE' });
                                    chrome.storage.local.set({ isScraping: true });
                                }, 500);
                            });
                        } else {
                            chrome.storage.local.set({ isScraping: true });
                        }
                    });
                };
                sendInit();
                sendResponse({ status: 'started' });
            } else {
                sendResponse({ status: 'no_tab' });
            }
        });
        return true;
    }

    if (request.action === 'STOP_SCRAPE') {
        isScraping = false;
        chrome.storage.local.set({ isScraping: false });
        if (currentTabId) chrome.tabs.sendMessage(currentTabId, { action: 'ABORT_SCRAPE' });
        sendResponse({ status: 'stopped' });
        return false;
    }

    if (request.action === 'START_R2_BACKUP') {
        if (isScraping) {
            sendResponse({ status: 'busy', error: 'Scraper is already running.' });
            return false;
        }
        log('Starting Full R2 Media Backup...');
        isR2Backup = true;
        isScraping = true;
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0] && (tabs[0].url.includes('x.com') || tabs[0].url.includes('grok.com'))) {
                currentTabId = tabs[0].id;
                chrome.tabs.sendMessage(currentTabId, { action: 'INIT_R2_BACKUP' }, (response) => {
                    if (chrome.runtime.lastError) {
                        chrome.scripting.executeScript({
                            target: { tabId: currentTabId },
                            files: ['content.js']
                        }, () => {
                            setTimeout(() => {
                                chrome.tabs.sendMessage(currentTabId, { action: 'INIT_R2_BACKUP' });
                                chrome.storage.local.set({ isScraping: true, isR2Backup: true });
                            }, 500);
                        });
                    } else {
                        chrome.storage.local.set({ isScraping: true, isR2Backup: true });
                    }
                });
                sendResponse({ status: 'started' });
            } else {
                isScraping = false;
                isR2Backup = false;
                sendResponse({ status: 'no_tab', error: 'Navigate to Grok Favorites first.' });
            }
        });
        return true;
    }

    if (request.action === 'STOP_R2_BACKUP') {
        isR2Backup = false;
        isScraping = false;
        chrome.storage.local.set({ isScraping: false, isR2Backup: false });
        if (currentTabId) chrome.tabs.sendMessage(currentTabId, { action: 'ABORT_R2_BACKUP' });
        sendResponse({ status: 'stopped' });
        return false;
    }

    if (request.action === 'R2_BACKUP_UPLOAD') {
        (async () => {
            const extHint = request.isVideo ? 'mp4' : null;
            const finalPath = await generateFilenameForBackup(request.url, extHint);

            // If content script provided blob data (fetched with cookies), upload directly
            if (request.blobDataUrl) {
                const config = await getCloudConfig();
                if (!CloudSync.isCloudEnabled(config)) {
                    sendResponse({ status: 'not_queued', error: 'Cloud sync is not enabled.' });
                    return;
                }

                try {
                    // Convert data URL back to blob
                    const resp = await fetch(request.blobDataUrl);
                    const blob = await resp.blob();
                    const contentType = blob.type || (extHint === 'mp4' ? 'video/mp4' : 'image/png');
                    const userInfo = await chrome.storage.local.get(['activeGrokUserId']);
                    const activeUserId = userInfo.activeGrokUserId || 'Shared_Account';

                    const result = await uploadBlobWithR2Dedupe(config, {
                        sourceUrl: request.url,
                        finalPath,
                        userId: activeUserId,
                        contentType,
                        promptText: request.promptText || ''
                    }, blob);

                    console.log('[CloudQueue] Direct blob upload result:', result.status, result.objectKey, blob.size, 'bytes');
                    sendResponse(buildDirectBackupUploadResponse(result, request.url));
                } catch (e) {
                    console.error('[CloudQueue] Direct blob upload failed:', e.message);
                    sendResponse({ status: 'error', error: e.message });
                }
                return;
            }

            // No blob data — fall back to service worker fetch (works for public URLs)
            const queued = await enqueueCloudMediaUpload(request.url, finalPath, request.promptText);

            if (!request.skipLocalDownload) {
                const config = await getCloudConfig();
                if (CloudSync.isLocalDownloadEnabled(config)) {
                    chrome.downloads.download({ url: request.url, filename: finalPath, conflictAction: 'overwrite' });
                }
            }
            if (queued) {
                sendResponse({ status: 'queued' });
            } else {
                sendResponse({ status: 'not_queued', error: 'Cloud sync is not enabled. Check Cloud R2 Settings.' });
            }
        })().catch((e) => {
            sendResponse({ status: 'error', error: e.message });
        });
        return true;
    }

    if (request.action === 'R2_BACKUP_PROGRESS') {
        chrome.runtime.sendMessage({
            action: 'UPDATE_R2_BACKUP_PROGRESS',
            stats: request.stats
        }).catch(() => {});
        sendResponse({ status: 'ok' });
        return false;
    }

    if (request.action === 'R2_BACKUP_COMPLETE') {
        isR2Backup = false;
        isScraping = false;
        chrome.storage.local.set({ isScraping: false, isR2Backup: false });
        const stats = request.stats || {};
        const completed = stats.stopReason === 'complete' || !stats.stopReason;
        const statusLabel = completed ? 'complete' : `stopped (${stats.stopReason})`;
        log(`R2 Backup ${statusLabel}. Uploaded: ${stats.uploaded || 0}, Already present: ${stats.alreadyPresent || 0}, Queued: ${stats.queued || 0}, Errors: ${stats.errors || 0}`, completed ? 'success' : 'warning');
        chrome.runtime.sendMessage({
            action: 'R2_BACKUP_DONE',
            stats: stats
        }).catch(() => {});
        sendResponse({ status: 'ok' });
        return false;
    }

    if (request.action === 'VALIDATE_CLOUD_CONFIG') {
        (async () => {
            const config = await getCloudConfig();
            if (!CloudSync.isCloudEnabled(config)) {
                sendResponse({ valid: false, error: 'Cloud sync is disabled. Set mode to dual_write or cloud_only.' });
                return;
            }
            if (!CloudSync.validateWorkersDevUrl(config.workerUrl)) {
                sendResponse({ valid: false, error: 'Worker URL is missing or invalid.' });
                return;
            }
            if (!config.apiKey) {
                sendResponse({ valid: false, error: 'API key is not set.' });
                return;
            }
            sendResponse({ valid: true });
        })().catch((e) => {
            sendResponse({ valid: false, error: e.message });
        });
        return true;
    }

    if (request.action === 'GET_CLOUD_CONFIG') {
        (async () => {
            const config = await getCloudConfig();
            sendResponse({ config });
        })().catch(() => {
            sendResponse({ config: null });
        });
        return true;
    }

    if (request.action === 'DOWNLOAD_MEDIA') {
        (async () => {
            const config = await getCloudConfig();
            const allowLocalDownload = CloudSync.isLocalDownloadEnabled(config);

            if (allowLocalDownload) {
                // This triggers onDeterminingFilename.
                chrome.downloads.download({ url: request.url, conflictAction: 'overwrite' });
                sendResponse({ status: 'queued' });
            } else {
                const finalPath = await generateFilename(request.url);
                if (!finalPath) {
                    sendResponse({ status: 'skipped_duplicate' });
                    return;
                }
                await enqueueCloudMediaUpload(request.url, finalPath);
                sendResponse({ status: 'cloud_queued' });
            }
        })().catch((e) => {
            sendResponse({ status: 'error', error: e.message });
        });
        return true;
    }

    if (request.action === 'ADD_LOG') {
        log(request.text, request.type);
        sendResponse({ status: 'ok' });
        return false;
    }

    if (request.action === 'CLOUD_TEST_CONNECTION') {
        (async () => {
            try {
                setCloudTestTelemetry('running', 'Testing upload pipeline...');
                await persistCloudState();

                const result = await testCloudConnection(request.config);
                if (result.ok) {
                    clearCloudError();
                    const successMsg = result.testUpload
                        ? 'Full pipeline OK (health + presign + R2 upload + verify)'
                        : 'Cloud connection OK';
                    setCloudTestTelemetry('success', successMsg);
                } else if (result.error) {
                    const sourceLabel = result.errorSource || 'validation';
                    const message = `${sourceLabel}: ${result.error}`;
                    updateCloudError(message);
                    setCloudTestTelemetry('error', message);
                }
                await persistCloudState();
                sendResponse({
                    ok: true,
                    result,
                    telemetry: getCloudTestTelemetry(),
                    state: getCloudStatusSnapshot()
                });
            } catch (e) {
                const stageMatch = e.message.match(/^\[([^\]]+)\]/);
                const failureSource = stageMatch ? stageMatch[1] : 'runtime';
                const message = `${failureSource}: ${e.message}`;
                updateCloudError(message);
                setCloudTestTelemetry('error', message);
                await persistCloudState();
                sendResponse({
                    ok: false,
                    error: message,
                    telemetry: getCloudTestTelemetry(),
                    state: getCloudStatusSnapshot()
                });
            }
        })();
        return true;
    }

    if (request.action === 'CLOUD_GET_STATUS') {
        sendResponse({
            ok: true,
            telemetry: getCloudTestTelemetry(),
            state: getCloudStatusSnapshot()
        });
        return false;
    }

    if (request.action === 'CLOUD_RETRY_UNSYNCED') {
        (async () => {
            try {
                await processCloudQueue('manual', { force: true });
                sendResponse({
                    ok: true,
                    state: getCloudStatusSnapshot()
                });
            } catch (e) {
                sendResponse({ ok: false, error: e.message });
            }
        })();
        return true;
    }

    if (request.action === 'CLOUD_RUN_BACKFILL') {
        (async () => {
            try {
                await runCloudBackfill();
                sendResponse({
                    ok: true,
                    state: getCloudStatusSnapshot()
                });
            } catch (e) {
                sendResponse({ ok: false, error: e.message });
            }
        })();
        return true;
    }

    if (request.action === 'CLOUD_CLEAR_STATUS') {
        (async () => {
            try {
                await clearCloudUiStatus();
                sendResponse({
                    ok: true,
                    logs: [],
                    state: getCloudStatusSnapshot()
                });
            } catch (e) {
                sendResponse({ ok: false, error: e.message });
            }
        })();
        return true;
    }

    return false;
});

// --- NEW TAB INTERCEPTOR ---
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    const stored = await chrome.storage.local.get(['isScraping']);
    if (!stored.isScraping) return;

    if (changeInfo.url) {
        const url = changeInfo.url;
        if (url.includes('imagine-public.x.ai') || url.match(/\.(png|jpg|jpeg|mp4|webp)(\?|$)/i)) {
            console.log('Background: Intercepted media tab. Processing:', url);

            // Generate Filename (Forces GrokVault path + Dedupe)
            const finalPath = await generateFilename(url);

            if (finalPath) {
                const config = await getCloudConfig();
                const allowLocalDownload = CloudSync.isLocalDownloadEnabled(config);

                if (allowLocalDownload) {
                    chrome.downloads.download({ url: url, filename: finalPath, conflictAction: 'overwrite' }, (id) => {
                        if (chrome.runtime.lastError) console.error('BG Download failed:', chrome.runtime.lastError);
                        else console.log('BG Download started:', id);
                    });
                } else {
                    console.log('Cloud-only mode active: local download skipped.');
                }

                enqueueCloudMediaUpload(url, finalPath).catch((e) => {
                    updateCloudError(e.message);
                    persistCloudState().catch(() => { });
                });

                chrome.tabs.remove(tabId);
            } else {
                console.log('Download skipped (Duplicate). Closing tab.');
                chrome.tabs.remove(tabId);
            }
        }
    }
});

if (typeof module !== 'undefined') {
    module.exports = {
        applyBackupProcessedIdPersistence,
        buildDirectBackupUploadResponse,
        getProcessedUUIDsForTest: () => Array.from(processedUUIDs),
        persistQueuedBackupProcessedId,
        persistQueuedBackupProcessedIdAfterSuccess,
        setProcessedUUIDsForTest: (ids) => { processedUUIDs = new Set(ids); }
    };
}

// --- STANDARD DOWNLOAD LISTENER ---
const _pendingR2Downloads = new Map();

chrome.downloads.onDeterminingFilename.addListener(async (item, suggest) => {
    if (!isScraping && !item.url.includes('imagine-public') && !item.url.includes('assets.grok.com')) return;

    const finalPath = await generateFilename(item.url, item.filename);
    const config = await getCloudConfig();
    const cloudEnabled = CloudSync.isCloudEnabled(config);
    const allowLocal = CloudSync.isLocalDownloadEnabled(config);
    const isAuthUrl = item.url.includes('assets.grok.com');

    if (!finalPath) {
        chrome.downloads.cancel(item.id);
        return;
    }

    // Always allow download to complete — we need the file for R2 upload
    suggest({ filename: finalPath, conflictAction: 'overwrite' });

    if (cloudEnabled) {
        if (isAuthUrl) {
            // Auth URL: can't re-fetch from service worker. Track for post-download R2 upload.
            _pendingR2Downloads.set(item.id, { finalPath, url: item.url, deleteAfter: !allowLocal });
            console.log('[CloudQueue] Tracking auth download for R2:', item.id, finalPath.slice(-30));
        } else {
            // Public URL: service worker can fetch directly
            enqueueCloudMediaUpload(item.url, finalPath).catch((e) => {
                updateCloudError(e.message);
                persistCloudState().catch(() => {});
            });
            // If Cloud Only, delete local file after queue (public URLs don't need it)
            if (!allowLocal) {
                _pendingR2Downloads.set(item.id, { finalPath, url: item.url, deleteAfter: true, skipUpload: true });
            }
        }
    }
});

// --- POST-DOWNLOAD R2 UPLOAD (for auth URLs like assets.grok.com) ---
chrome.downloads.onChanged.addListener(async (delta) => {
    if (!delta.state || delta.state.current !== 'complete') return;
    console.log('[CloudQueue] Download state changed to complete:', delta.id, 'pending:', _pendingR2Downloads.has(delta.id));
    const pending = _pendingR2Downloads.get(delta.id);
    if (!pending) return;
    _pendingR2Downloads.delete(delta.id);

    if (pending.skipUpload) {
        // Just clean up local file
        if (pending.deleteAfter) {
            chrome.downloads.removeFile(delta.id, () => {
                chrome.downloads.erase({ id: delta.id });
            });
        }
        return;
    }

    try {
        const [dlItem] = await chrome.downloads.search({ id: delta.id });
        if (!dlItem || !dlItem.filename) throw new Error('Download item not found');

        console.log('[CloudQueue] Download complete, reading file for R2:', dlItem.filename.slice(-50));

        // Create offscreen document to read the file
        try {
            await chrome.offscreen.createDocument({
                url: 'offscreen.html',
                reasons: ['BLOBS'],
                justification: 'Read downloaded file for R2 cloud backup upload'
            });
        } catch (e) {
            // Already exists — that's fine
            if (!e.message.includes('already exists') && !e.message.includes('Only a single offscreen')) throw e;
        }

        // Read file via offscreen document
        const fileData = await chrome.runtime.sendMessage({
            action: 'READ_FILE_FOR_UPLOAD',
            filePath: dlItem.filename,
            contentType: dlItem.mime || 'application/octet-stream'
        });

        if (!fileData || !fileData.ok) throw new Error(fileData?.error || 'Failed to read file');

        console.log('[CloudQueue] File read:', fileData.size, 'bytes, uploading to R2...');

        const config = await getCloudConfig();
        const userInfo = await chrome.storage.local.get(['activeGrokUserId']);

        // Convert base64 back to blob
        const binaryStr = atob(fileData.base64);
        const bytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
        const blob = new Blob([bytes], { type: fileData.type });

        const result = await uploadBlobWithR2Dedupe(config, {
            sourceUrl: pending.url,
            finalPath: pending.finalPath,
            userId: userInfo.activeGrokUserId || 'Shared_Account',
            contentType: fileData.type
        }, blob);

        log(`Cloud upload ${result.status === 'already_present' ? 'already present' : 'complete'}: ${result.objectKey}`, result.status === 'conflict_uploaded' ? 'warning' : 'success');

        if (pending.deleteAfter && result.status === 'already_present') {
            console.log('[CloudQueue] Existing R2 object verified before local cleanup:', result.objectKey);
        }

        // Delete local file if Cloud Only mode
        if (pending.deleteAfter) {
            chrome.downloads.removeFile(delta.id, () => {
                chrome.downloads.erase({ id: delta.id });
                console.log('[CloudQueue] Local file deleted (Cloud Only mode)');
            });
        }
    } catch (e) {
        console.error('[CloudQueue] Post-download R2 upload failed:', e.message);
        log(`Cloud upload failed: ${e.message}`, 'warning');
        updateCloudError(e.message);
        persistCloudState().catch(() => {});
    }
});
