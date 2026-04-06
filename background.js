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
            } catch (e) {
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
            } catch (e) {
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
    lastTestMessage: null
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
    let presigned;
    try {
        presigned = await requestPresignedUrl(baseConfig, {
            objectKey: testObjectKey,
            contentType: 'text/plain'
        }, testBlob.size);
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

    return {
        ok: true,
        testUpload: true,
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

    const objectKey = CloudSync.buildMediaObjectKeyFromFinalPath(finalPath, {
        keyPrefix: config.keyPrefix,
        fallbackUserId: activeUserId
    });

    const queueItem = {
        id: makeQueueId('media'),
        type: 'media',
        sourceUrl,
        finalPath,
        objectKey,
        contentType: CloudSync.detectContentTypeFromUrl(sourceUrl),
        promptText: promptText || ''
    };

    // Dedup by source URL (not objectKey which includes date folder)
    const cleanSource = sourceUrl.split('?')[0];
    await enqueueCloudItem(queueItem, `media:${cleanSource}`);
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

async function requestPresignedUrl(config, queueItem, contentLength) {
    const body = {
        objectKey: queueItem.objectKey,
        contentType: queueItem.contentType || 'application/octet-stream',
        contentLength
    };
    // Attach prompt as R2 custom metadata (max 1KB)
    if (queueItem.promptText) {
        body.metadata = { prompt: queueItem.promptText.substring(0, 1024) };
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

async function uploadMediaQueueItem(config, queueItem) {
    let blob;
    let contentType;

    // Stage 1: Fetch media blob from source URL
    try {
        console.log('[CloudQueue] Fetching media blob from:', queueItem.sourceUrl.slice(0, 100));
        const fetchOpts = { method: 'GET' };

        // For assets.grok.com URLs, manually attach cookies (service worker has no cookie jar)
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

    // Stage 2: Get presigned upload URL from worker
    let presigned;
    try {
        presigned = await requestPresignedUrl(config, queueItem, blob.size);
    } catch (e) {
        throw new Error(`[${CloudSync.UPLOAD_STAGES.presign}] ${e.message}`);
    }

    // Stage 3: Upload blob to R2
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

    // Stage 4: Upload sidecar prompt JSON (non-blocking)
    if (queueItem.promptText) {
        try {
            const sidecarKey = queueItem.objectKey + '.prompt.json';
            const sidecar = JSON.stringify({
                prompt: queueItem.promptText,
                mediaKey: queueItem.objectKey,
                uploadedAt: new Date().toISOString()
            });
            const sidecarItem = { objectKey: sidecarKey, contentType: 'application/json' };
            const sidecarPresigned = await requestPresignedUrl(config, sidecarItem, new Blob([sidecar]).size);
            await fetch(sidecarPresigned.uploadUrl, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: sidecar
            });
            console.log('[CloudQueue] Prompt sidecar uploaded:', sidecarKey);
        } catch (e) {
            console.warn('[CloudQueue] Sidecar prompt upload failed (non-fatal):', e.message);
        }
    }
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
                    await uploadMediaQueueItem(config, item);
                    log(`Cloud upload complete: ${item.objectKey}`, 'success');
                } else if (item.type === 'metadata') {
                    await uploadMetadataQueueItem(config, item);
                    log(`Cloud metadata synced: ${item.kind}`, 'success');
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

        // Try to match UUID pattern anywhere in the URL for robustness
        const uuidMatch = url.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
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

    // No dedup check — always generate path for backup
    // Still mark as processed so future normal scrapes skip these
    if (parsed.uuid && !processedUUIDs.has(parsed.uuid)) {
        processedUUIDs.add(parsed.uuid);
        saveHistory();
    }

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
                    const userInfo = await chrome.storage.local.get(['activeGrokUserId']);
                    const activeUserId = userInfo.activeGrokUserId || 'Shared_Account';
                    const objectKey = CloudSync.buildMediaObjectKeyFromFinalPath(finalPath, {
                        keyPrefix: config.keyPrefix,
                        fallbackUserId: activeUserId
                    });

                    // Convert data URL back to blob
                    const resp = await fetch(request.blobDataUrl);
                    const blob = await resp.blob();
                    const contentType = blob.type || (extHint === 'mp4' ? 'video/mp4' : 'image/png');

                    console.log('[CloudQueue] Direct blob upload:', objectKey, blob.size, 'bytes');

                    // Get presigned URL and upload
                    const queueItem = { objectKey, contentType, promptText: request.promptText || '' };
                    const presigned = await requestPresignedUrl(config, queueItem, blob.size);
                    const uploadResp = await fetch(presigned.uploadUrl, {
                        method: presigned.method || 'PUT',
                        headers: { 'Content-Type': contentType },
                        body: blob
                    });

                    if (!uploadResp.ok) throw new Error(`R2 PUT failed: ${uploadResp.status}`);
                    log(`Cloud upload complete: ${objectKey}`, 'success');

                    // Upload sidecar prompt if available
                    if (request.promptText) {
                        try {
                            const sidecarKey = objectKey + '.prompt.json';
                            const sidecar = JSON.stringify({ prompt: request.promptText, mediaKey: objectKey, uploadedAt: new Date().toISOString() });
                            const sidecarItem = { objectKey: sidecarKey, contentType: 'application/json' };
                            const sidecarPresigned = await requestPresignedUrl(config, sidecarItem, new Blob([sidecar]).size);
                            await fetch(sidecarPresigned.uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: sidecar });
                        } catch (e) { console.warn('[CloudQueue] Sidecar failed:', e.message); }
                    }

                    sendResponse({ status: 'queued' });
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
        log(`R2 Backup complete. Uploaded: ${stats.uploaded || 0}, Errors: ${stats.errors || 0}`, 'success');
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
                        ? 'Full pipeline OK (health + presign + R2 upload)'
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

// --- STANDARD DOWNLOAD LISTENER ---
chrome.downloads.onDeterminingFilename.addListener(async (item, suggest) => {
    // If not scraping and not a Grok file, ignore
    if (!isScraping && !item.url.includes('imagine-public') && !item.url.includes('assets.grok.com')) return;

    const finalPath = await generateFilename(item.url, item.filename);
    const config = await getCloudConfig();
    const allowLocalDownload = CloudSync.isLocalDownloadEnabled(config);

    if (finalPath) {
        if (allowLocalDownload) {
            suggest({ filename: finalPath, conflictAction: 'overwrite' });
        } else {
            chrome.downloads.cancel(item.id);
        }

        // Enqueue for R2 — uploadMediaQueueItem now handles cookies for assets.grok.com
        enqueueCloudMediaUpload(item.url, finalPath).catch((e) => {
            updateCloudError(e.message);
            persistCloudState().catch(() => { });
        });
    } else {
        chrome.downloads.cancel(item.id);
    }
});
