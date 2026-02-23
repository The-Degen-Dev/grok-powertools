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
            const hasExplicitMode = !!(config && typeof config === 'object' && Object.prototype.hasOwnProperty.call(config, 'mode'));
            const explicitMode = hasExplicitMode
                ? (merged.mode === 'dual_write' ? 'dual_write' : 'local_only')
                : null;
            const legacyEnabled = !!(config && typeof config === 'object' && config.enabled);
            merged.mode = explicitMode || (legacyEnabled ? 'dual_write' : 'local_only');
            merged.enabled = merged.mode === 'dual_write';
            merged.workerUrl = String(merged.workerUrl || '').trim().replace(/\/+$/, '');
            merged.apiKey = String(merged.apiKey || '').trim();
            merged.keyPrefix = String(merged.keyPrefix || 'grok-powertools/v1').trim().replace(/^\/+/, '').replace(/\/+$/, '');
            return merged;
        },
        validateWorkersDevUrl(value) {
            try {
                const parsed = new URL(String(value || '').trim());
                return parsed.protocol === 'https:' && /^[a-z0-9-]+\.workers\.dev$/i.test(parsed.hostname);
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
            return !!config.enabled && config.mode === 'dual_write';
        }
    };

console.log('Grok Downloader Background Service Started');

let isScraping = false;
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
    processing: false
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
        state: {
            ...cloudSyncState,
            unsyncedCount: cloudSyncQueue.length
        }
    }).catch(() => { });
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
        return 'Worker URL must be https://<name>.workers.dev';
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
        return { ok: false, error: validationError };
    }

    const response = await fetch(`${baseConfig.workerUrl}/health`, {
        method: 'GET',
        headers: {
            'x-gpt-api-key': baseConfig.apiKey
        }
    });

    if (!response.ok) {
        const detail = await response.text().catch(() => 'Unknown response');
        throw new Error(`Health check failed (${response.status}): ${detail}`);
    }

    const data = await response.json();
    return {
        ok: !!data.ok,
        service: data.service,
        now: data.now
    };
}

function updateCloudError(errorMessage) {
    cloudSyncState.lastError = errorMessage || null;
}

function clearCloudError() {
    cloudSyncState.lastError = null;
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

async function enqueueCloudMediaUpload(sourceUrl, finalPath) {
    const config = await getCloudConfig();
    if (!CloudSync.isCloudEnabled(config)) return;

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
        contentType: CloudSync.detectContentTypeFromUrl(sourceUrl)
    };

    await enqueueCloudItem(queueItem, `media:${objectKey}`);
    processCloudQueue('media-enqueued').catch((e) => {
        updateCloudError(e.message);
        persistCloudState().catch(() => { });
    });
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
    const response = await fetch(`${config.workerUrl}/v1/presign`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-gpt-api-key': config.apiKey
        },
        body: JSON.stringify({
            objectKey: queueItem.objectKey,
            contentType: queueItem.contentType || 'application/octet-stream',
            contentLength
        })
    });

    if (!response.ok) {
        const detail = await response.text().catch(() => 'Unknown presign failure');
        throw new Error(`Presign failed (${response.status}): ${detail}`);
    }

    return response.json();
}

async function uploadMediaQueueItem(config, queueItem) {
    const mediaResponse = await fetch(queueItem.sourceUrl, { method: 'GET' });
    if (!mediaResponse.ok) {
        throw new Error(`Media fetch failed (${mediaResponse.status})`);
    }

    const blob = await mediaResponse.blob();
    const contentType = mediaResponse.headers.get('content-type') || queueItem.contentType || 'application/octet-stream';
    queueItem.contentType = contentType;

    const presigned = await requestPresignedUrl(config, queueItem, blob.size);

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
        throw new Error(`R2 upload failed (${uploadResponse.status}): ${detail}`);
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
    if (cloudSyncState.processing) return;

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

    for (const item of cloudSyncQueue) {
        const attempts = item.attempts || 0;
        if (!force && attempts >= CloudSync.MAX_RETRY_ATTEMPTS) {
            remaining.push(item);
            continue;
        }

        try {
            if (item.type === 'media') {
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
            item.attempts = attempts + 1;
            item.lastError = e.message;
            item.lastAttemptAt = Date.now();
            remaining.push(item);
            updateCloudError(e.message);
            log(`Cloud sync failed (${item.type}): ${e.message}`, 'warning');
        }
    }

    cloudSyncQueue = remaining;
    cloudSyncState.processing = false;
    await persistCloudState();
    await scheduleCloudRetryAlarm();

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

        // Try to match UUID pattern for robustness
        const uuidMatch = filename.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
        if (uuidMatch) {
            uuid = uuidMatch[0];
            filename = uuid; // Enforce UUID as filename
        } else if (suggestedFilename) {
            // Fallback to suggested if provided and no UUID found in URL
            filename = suggestedFilename.split('.')[0];
        }

        if (filename.length < 10) filename = Date.now().toString();
    } catch (e) {
        filename = Date.now().toString();
    }

    return { filename, uuid };
}

// --- HELPER: Centralized Filename Generation ---
async function generateFilename(url, suggestedFilename) {
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

    // Extension
    let ext = 'png';
    if (url.includes('.mp4')) ext = 'mp4';
    else if (url.includes('.jpg') || url.includes('.jpeg')) ext = 'jpg';

    const stored = await chrome.storage.local.get(['downloadPath', 'activeGrokUserId']);
    const rootFolder = stored.downloadPath || 'GrokVault';
    const userId = stored.activeGrokUserId || 'Shared_Account';

    // Construct: Root / UserID / Date / Filename
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

    if (request.action === 'DOWNLOAD_MEDIA') {
        // Direct invocation
        // We can just rely on chrome.downloads.download which triggers onDeterminingFilename
        chrome.downloads.download({ url: request.url, conflictAction: 'overwrite' });
        sendResponse({ status: 'queued' });
        return false;
    }

    if (request.action === 'ADD_LOG') {
        log(request.text, request.type);
        sendResponse({ status: 'ok' });
        return false;
    }

    if (request.action === 'CLOUD_TEST_CONNECTION') {
        (async () => {
            try {
                const result = await testCloudConnection(request.config);
                sendResponse({ ok: true, result });
            } catch (e) {
                sendResponse({ ok: false, error: e.message });
            }
        })();
        return true;
    }

    if (request.action === 'CLOUD_GET_STATUS') {
        sendResponse({
            ok: true,
            state: {
                ...cloudSyncState,
                unsyncedCount: cloudSyncQueue.length
            }
        });
        return false;
    }

    if (request.action === 'CLOUD_RETRY_UNSYNCED') {
        (async () => {
            try {
                await processCloudQueue('manual', { force: true });
                sendResponse({
                    ok: true,
                    state: {
                        ...cloudSyncState,
                        unsyncedCount: cloudSyncQueue.length
                    }
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
                    state: {
                        ...cloudSyncState,
                        unsyncedCount: cloudSyncQueue.length
                    }
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
                chrome.downloads.download({ url: url, filename: finalPath, conflictAction: 'overwrite' }, (id) => {
                    if (chrome.runtime.lastError) console.error('BG Download failed:', chrome.runtime.lastError);
                    else console.log('BG Download started:', id);
                });

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
    if (!isScraping && !item.url.includes('imagine-public')) return;

    const finalPath = await generateFilename(item.url, item.filename);

    if (finalPath) {
        suggest({ filename: finalPath, conflictAction: 'overwrite' });
        enqueueCloudMediaUpload(item.url, finalPath).catch((e) => {
            updateCloudError(e.message);
            persistCloudState().catch(() => { });
        });
    } else {
        chrome.downloads.cancel(item.id);
    }
});
