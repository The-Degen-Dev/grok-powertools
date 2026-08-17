// Background Service Worker
if (typeof importScripts === 'function') {
    try {
        importScripts('cloudSyncUtils.js');
    } catch (e) {
        console.warn('CloudSyncUtils failed to load.', e);
    }
    try {
        importScripts('recreateWorkflowUtils.js', 'recreateWorkflowBackground.js');
    } catch (e) {
        console.warn('Grok recreate workflow helpers failed to load.', e);
    }
}

function extractGrokMediaIdFallback(value) {
    const text = String(value || '').trim();
    if (!text) return '';
    const uuidPattern = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
    const bareUuid = text.match(new RegExp(`^${uuidPattern.source}$`, 'i'));
    if (bareUuid) return bareUuid[0].toLowerCase();

    let pathname;
    try {
        pathname = new URL(text, 'https://grok.com').pathname;
    } catch {
        pathname = text.split('#')[0].split('?')[0];
    }
    const segments = pathname.split('/').filter(Boolean);
    for (let index = 0; index < segments.length - 1; index++) {
        if (segments[index].toLowerCase() !== 'generated') continue;
        const generatedUuid = segments[index + 1].match(uuidPattern);
        if (generatedUuid) return generatedUuid[0].toLowerCase();
    }
    const pathnameUuids = pathname.match(new RegExp(uuidPattern.source, 'gi'));
    return pathnameUuids?.length ? pathnameUuids[pathnameUuids.length - 1].toLowerCase() : '';
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
        normalizeAcceptanceContext(context) {
            if (!context) return null;
            const runId = String(context.runId || '').trim();
            const correlationId = String(context.correlationId || '').trim();
            const keyPrefix = String(context.keyPrefix || '').trim().replace(/^\/+/, '').replace(/\/+$/, '');

            if (!runId || !correlationId) {
                throw new Error('acceptance runId and correlationId are required');
            }

            if (!keyPrefix.startsWith(`acceptance/${runId}`)) {
                throw new Error('acceptance prefix must start with the active acceptance run ID');
            }

            return { runId, correlationId, keyPrefix };
        },
        buildAcceptanceHeaders(item) {
            if (!item || !item.acceptance) return {};
            const acceptance = this.normalizeAcceptanceContext(item.acceptance);
            return {
                'x-acceptance-run-id': acceptance.runId,
                'x-acceptance-correlation-id': acceptance.correlationId
            };
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
        extractGrokMediaId: extractGrokMediaIdFallback,
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
            const sourceUrl = (params && params.sourceUrl) || '';
            const finalPath = (params && params.finalPath) || '';
            const source = `${sourceUrl}/${finalPath}`;
            const stableMediaId = this.extractGrokMediaId(sourceUrl) || this.extractGrokMediaId(finalPath);
            const contentSha256 = String((params && params.contentSha256) || '').toLowerCase();
            const assetId = stableMediaId
                ? `media_${stableMediaId}`
                : (/^[a-f0-9]{64}$/.test(contentSha256) ? `sha256_${contentSha256}` : sourceUrlHash);
            return {
                kind: stableMediaId ? 'stable_media_id' : (/^[a-f0-9]{64}$/.test(contentSha256) ? 'content_hash' : 'source_url_hash'),
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
        buildTestUploadObjectKey(keyPrefix) {
            const prefix = String(keyPrefix || 'grok-powertools/v1').trim().replace(/^\/+/, '').replace(/\/+$/, '') || 'grok-powertools/v1';
            return `${prefix}/users/_system/test-uploads/upload-pipeline-test.txt`;
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

const RecreateWorkflowUtils = (typeof self !== 'undefined' && self.GrokRecreateWorkflowUtils)
    ? self.GrokRecreateWorkflowUtils
    : (typeof require === 'function' ? require('./recreateWorkflowUtils.js') : null);
const RecreateWorkflowBackground = (typeof self !== 'undefined' && self.GrokRecreateWorkflowBackground)
    ? self.GrokRecreateWorkflowBackground
    : (typeof require === 'function' ? require('./recreateWorkflowBackground.js') : null);
const RECREATE_WORKFLOW_MESSAGE_TIMEOUT_MS = 540000;
const recreateWorkflowController = RecreateWorkflowBackground
    ? RecreateWorkflowBackground.createRecreateWorkflowController({
        chromeApi: chrome,
        utils: RecreateWorkflowUtils,
        messageTimeoutMs: RECREATE_WORKFLOW_MESSAGE_TIMEOUT_MS
    })
    : null;

const API_KEY_HEADER = ['x-gpt', 'api', 'key'].join('-');

console.log('Grok Downloader Background Service Started');

let isScraping = false;
let isR2Backup = false;
let scrapeStartPending = false;
const ACTIVE_SCRAPE_RUN_TOKEN_KEY = 'activeScrapeRunToken';
const SCRAPE_LEASE_VERSION = 1;
const SCRAPE_ABORT_TIMEOUT_MS = 2000;
const SCRAPE_TRANSFER_DRAIN_TIMEOUT_MS = 2000;
const PENDING_DOWNLOAD_MUTATION_TIMEOUT_MS = 1000;
const CLOUD_QUEUE_MUTATION_TIMEOUT_MS = 1000;
let activeScrapeLease = null;
let scrapeLeaseHydrationPromise = null;
let scrapeLeaseMutationQueue = Promise.resolve();
let scrapeStopPending = false;
const activeScrapeTransferTasks = new Map();
const activeScrapeTransferAbortControllers = new Map();
let backgroundStateReadyPromise = null;
const MAX_LOGS = 100;
const CLOUD_ALARM_NAME = 'gptCloudRetry';
const CLOUD_METADATA_DEBOUNCE_MS = 2000;
const CLOUD_SCHEMA_VERSION = 1;
const PROCESSED_IDS_KEY = 'processedIds';
const PENDING_DOWNLOAD_OPERATIONS_KEY = 'pendingDownloadOperations';
const SCRAPE_COMPLETION_TXN_KEY = 'scrapeCompletionTxn';

// Global History Set
let processedUUIDs = new Set();
let processedIdsMutationQueue = Promise.resolve();
let pendingDownloadOperations = new Map();
let pendingDownloadOperationsMutationQueue = Promise.resolve();
let pendingDownloadOperationsRevision = 0;
let pendingDownloadOperationRevision = 0;
const activeDownloadOperations = new Set();
const pendingScrapeDownloadReceiptsByUrl = new Map();
const pendingScrapeDownloadReceiptsById = new Map();
const revokedScrapeDownloadIds = new Set();

let cloudSyncQueue = [];
let cloudQueueMutationQueue = Promise.resolve();
let cloudQueueRevision = 0;
let cloudQueueDrainPromise = null;
let cloudStatePersistenceRevision = 0;
let scrapeCompletionTxn = null;
let scrapeCompletionTransition = null;
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

function shouldPersistBackupProcessedId(status) {
    return status === 'uploaded' || status === 'already_present' || status === 'conflict_uploaded';
}

function formatRedactedMediaLog(status, identityValue, details = {}) {
    const mediaId = CloudSync.extractGrokMediaId(identityValue);
    const fields = [
        `media=${mediaId ? `...${mediaId.slice(-8)}` : 'unknown'}`,
        `status=${String(status || 'unknown').replace(/[^a-z0-9_-]/gi, '_')}`
    ];
    if (Number.isFinite(details.count)) fields.push(`count=${details.count}`);
    if (Number.isFinite(details.bytes)) fields.push(`bytes=${details.bytes}`);
    if (details.stage) fields.push(`stage=${String(details.stage).replace(/[^a-z0-9_-]/gi, '_')}`);
    return fields.join(' ');
}

function getUploadFailureStage(error) {
    return String(error?.message || '').match(/^\[([^\]]+)\]/)?.[1] || 'runtime';
}

function sanitizeErrorToken(value, fallback) {
    const token = String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 40);
    return token || fallback;
}

function formatRedactedMediaError(error, identityValue, code = 'media_failure') {
    const mediaId = CloudSync.extractGrokMediaId(identityValue);
    return [
        `stage=${sanitizeErrorToken(getUploadFailureStage(error), 'runtime')}`,
        `code=${sanitizeErrorToken(code, 'media_failure')}`,
        `media=${mediaId ? `...${mediaId.slice(-8)}` : 'unknown'}`
    ].join(' ');
}

function isRedactedMediaError(value) {
    return /^stage=[a-z0-9_-]+ code=[a-z0-9_-]+ media=(?:unknown|\.\.\.[a-f0-9]{8})$/.test(String(value || ''));
}

function normalizeProcessedIds(values) {
    return Array.from(new Set(
        (Array.isArray(values) ? values : [])
            .filter((value) => typeof value === 'string' && value)
    ));
}

function writeProcessedIds(values) {
    return chrome.storage.local.set({ [PROCESSED_IDS_KEY]: values });
}

function mutateProcessedIds({ reset = false, ids = [] } = {}, assertAuthorized = null) {
    const mutation = processedIdsMutationQueue.then(async () => {
        const stored = await chrome.storage.local.get([PROCESSED_IDS_KEY]);
        if (assertAuthorized) await assertAuthorized();
        const previousValues = normalizeProcessedIds(stored[PROCESSED_IDS_KEY]);
        const next = reset ? new Set() : new Set(previousValues);
        if (!reset) normalizeProcessedIds(ids).forEach((id) => next.add(id));
        const values = Array.from(next);
        await writeProcessedIds(values);
        processedUUIDs = next;
        try {
            if (assertAuthorized) await assertAuthorized();
        } catch (error) {
            if (isScrapeAuthorityRevokedError(error)) {
                processedUUIDs = new Set(previousValues);
                await writeProcessedIds(previousValues);
            }
            throw error;
        }
        return values;
    });
    processedIdsMutationQueue = mutation.catch(() => {});
    return mutation;
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

async function persistQueuedBackupProcessedIdAfterSuccess(item, result, assertAuthorized = null) {
    const id = item?.backupProcessedId;
    if (!shouldPersistBackupProcessedId(result?.status)) return false;

    if (Number.isInteger(item.cleanupDownloadId)) {
        if (!item.scrapeLease) {
            await detachDownloadOperationScrapeLease(item.cleanupDownloadId);
        }
        const updated = await markDownloadOperationR2Present(item.cleanupDownloadId, result, assertAuthorized);
        return !!updated;
    }

    if (!id) return false;
    await mutateProcessedIds({ ids: [id] }, assertAuthorized);
    return true;
}

function buildDirectBackupUploadResponse(result, sourceUrl) {
    return {
        status: result.status,
        objectKey: result.objectKey,
        assetId: result.assetId,
        backupProcessedId: CloudSync.extractGrokMediaId(sourceUrl) || null
    };
}

function buildR2BackupInitMessage(request = {}) {
    const mode = request.mode === 'canary' ? 'canary' : 'full';
    const limit = Number.isFinite(request.limit) && request.limit > 0 ? request.limit : null;
    const options = request.options && typeof request.options === 'object' ? request.options : {};
    const acceptance = request.acceptance ? CloudSync.normalizeAcceptanceContext(request.acceptance) : null;
    return {
        action: 'INIT_R2_BACKUP',
        mode,
        limit,
        options,
        ...(acceptance ? { acceptance } : {})
    };
}

function buildAcceptanceContextFromCloudConfig(config, source = 'extension') {
    const keyPrefix = CloudSync.sanitizeKeyPrefix
        ? CloudSync.sanitizeKeyPrefix(config?.keyPrefix || '')
        : String(config?.keyPrefix || '').trim().replace(/^\/+/, '').replace(/\/+$/, '');
    const match = keyPrefix.match(/^acceptance\/([^/]+)(?:\/|$)/);
    if (!match) return null;

    return {
        runId: match[1],
        correlationId: `${source}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
        keyPrefix
    };
}

function buildR2BackupInitMessageForConfig(request = {}, config = null) {
    const mode = request.mode === 'canary' ? 'canary' : 'full';
    const derivedAcceptance = mode === 'canary'
        ? buildAcceptanceContextFromCloudConfig(config, 'popup-canary')
        : null;
    return buildR2BackupInitMessage({
        ...request,
        acceptance: request.acceptance || derivedAcceptance
    });
}

function isR2BackupCompletionSuccessful(stats = {}) {
    return stats.stopReason === 'complete' || stats.stopReason === 'canary_complete' || !stats.stopReason;
}

function getR2BackupCompletionStatusLabel(stats = {}) {
    if (stats.stopReason === 'canary_complete') return 'canary complete';
    if (isR2BackupCompletionSuccessful(stats)) return 'complete';
    return `stopped (${stats.stopReason})`;
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
    let revision = ++cloudStatePersistenceRevision;

    while (true) {
        cloudSyncState.unsyncedCount = cloudSyncQueue.length;
        const queueSnapshot = cloudSyncQueue.map((item) => ({
            ...item,
            ...(item.scrapeLease ? { scrapeLease: { ...item.scrapeLease } } : {})
        }));
        const stateSnapshot = { ...cloudSyncState };
        await chrome.storage.local.set({
            [CloudSync.STORAGE_KEYS.cloudSyncQueue]: queueSnapshot,
            [CloudSync.STORAGE_KEYS.cloudSyncState]: stateSnapshot
        });

        if (revision === cloudStatePersistenceRevision) {
            emitCloudStatus();
            return;
        }

        revision = cloudStatePersistenceRevision;
    }
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
            headers: { [API_KEY_HEADER]: baseConfig.apiKey }
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
        acceptance: buildAcceptanceContextFromCloudConfig(baseConfig, 'cloud-test'),
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
    const queueOwnedDownloadIds = new Set(cloudSyncQueue
        .filter((item) => item.type === 'media' && Number.isInteger(item.cleanupDownloadId))
        .map((item) => item.cleanupDownloadId));
    for (const operation of pendingDownloadOperations.values()) {
        if (operation.strategy === 'public_queue' && findPublicQueueItemForOperation(operation)) {
            queueOwnedDownloadIds.add(operation.downloadId);
        }
    }
    const retryableDownloads = Array.from(pendingDownloadOperations.values()).filter((operation) => (
        operation.cloudRequired
        && !(operation.strategy === 'public_queue'
            && operation.r2State === 'pending'
            && queueOwnedDownloadIds.has(operation.downloadId))
        && (
            operation.r2State === 'pending'
            || (!operation.allowLocal && operation.downloadState === 'complete' && operation.r2State === 'present')
        )
        && (operation.attempts || 0) < CloudSync.MAX_RETRY_ATTEMPTS
    ));

    if (retryableItems.length === 0 && retryableDownloads.length === 0) {
        await chrome.alarms.clear(CLOUD_ALARM_NAME);
        cloudSyncState.retryScheduledAt = null;
        await persistCloudState();
        return;
    }

    const minQueueAttempt = retryableItems.reduce((min, item) => {
        const nextAttempt = (item.attempts || 0) + 1;
        return Math.min(min, nextAttempt);
    }, Number.MAX_SAFE_INTEGER);
    const minDownloadAttempt = retryableDownloads.reduce((min, operation) => {
        const nextAttempt = (operation.attempts || 0) + 1;
        return Math.min(min, nextAttempt);
    }, Number.MAX_SAFE_INTEGER);
    const minAttempt = Math.min(minQueueAttempt, minDownloadAttempt);

    const delayInMinutes = CloudSync.getRetryDelayMinutes(minAttempt);
    await chrome.alarms.clear(CLOUD_ALARM_NAME);
    chrome.alarms.create(CLOUD_ALARM_NAME, { delayInMinutes });

    cloudSyncState.retryScheduledAt = new Date(Date.now() + delayInMinutes * 60 * 1000).toISOString();
    await persistCloudState();
}

function enqueueCloudQueueMutation(operation) {
    const timeout = Symbol('cloud_queue_mutation_timeout');
    const operationPromise = cloudQueueMutationQueue.then(operation, operation);
    const mutation = withTimeout(
        operationPromise,
        CLOUD_QUEUE_MUTATION_TIMEOUT_MS,
        timeout
    ).then((result) => {
        if (result === timeout) throw new Error('cloud_queue_mutation_persist_timeout');
        return result;
    });
    cloudQueueMutationQueue = mutation.catch(() => {});
    return mutation;
}

async function rollbackCloudQueueItem(receipt) {
    return enqueueCloudQueueMutation(async () => {
        const index = cloudSyncQueue.findIndex((item) => item.dedupeKey === receipt.dedupeKey);
        if (index === -1 || cloudSyncQueue[index].queueRevision !== receipt.queueRevision) return false;
        if (receipt.previousItem) cloudSyncQueue[index] = receipt.previousItem;
        else cloudSyncQueue.splice(index, 1);
        await persistCloudState();
        return true;
    });
}

function snapshotCloudQueueItems() {
    return enqueueCloudQueueMutation(() => cloudSyncQueue.map((item) => ({ ...item })));
}

function cloudQueueItemIsCurrent(item) {
    return enqueueCloudQueueMutation(() => cloudSyncQueue.some((candidate) => (
        candidate.dedupeKey === item.dedupeKey
        && candidate.queueRevision === item.queueRevision
    )));
}

function removeCloudQueueItemRevision(item) {
    return enqueueCloudQueueMutation(async () => {
        const index = cloudSyncQueue.findIndex((candidate) => (
            candidate.dedupeKey === item.dedupeKey
            && candidate.queueRevision === item.queueRevision
        ));
        if (index === -1) return false;
        cloudSyncQueue.splice(index, 1);
        await persistCloudState();
        return true;
    });
}

function updateCloudQueueItemRevision(item, update) {
    return enqueueCloudQueueMutation(async () => {
        const index = cloudSyncQueue.findIndex((candidate) => (
            candidate.dedupeKey === item.dedupeKey
            && candidate.queueRevision === item.queueRevision
        ));
        if (index === -1) return false;
        cloudSyncQueue[index] = { ...cloudSyncQueue[index], ...update };
        await persistCloudState();
        return true;
    });
}

function cloneCloudQueue(items = cloudSyncQueue) {
    return items.map((item) => ({
        ...item,
        ...(item.scrapeLease ? { scrapeLease: { ...item.scrapeLease } } : {}),
        ...(item.revocationLease ? { revocationLease: { ...item.revocationLease } } : {})
    }));
}

function completionTxnMatchesLease(txn, lease) {
    return Boolean(txn && scrapeLeaseMatches(txn.lease, lease));
}

function recordOwnedByScrapeLease(record, lease) {
    return scrapeLeaseMatches(record?.scrapeLease, lease)
        || scrapeLeaseMatches(record?.revocationLease, lease);
}

function isPreparedCompletionRecord(record) {
    return Boolean(
        record?.completionTxnId
        && scrapeCompletionTxn?.phase === 'prepared'
        && record.completionTxnId === scrapeCompletionTxn.id
    );
}

function isCompletionTransitionBlockingRecord(record) {
    if (!scrapeCompletionTransition || scrapeCompletionTransition.status === 'committed') return false;
    return recordOwnedByScrapeLease(record, scrapeCompletionTransition.txn.lease)
        || record?.completionTxnId === scrapeCompletionTransition.txn.id;
}

function hasBlockedScrapeCompletionTransfer() {
    return scrapeCompletionTxn?.phase === 'prepared'
        || Boolean(scrapeCompletionTransition && scrapeCompletionTransition.status !== 'committed');
}

async function enqueueCloudItem(queueItem, dedupeKey, assertAuthorized = null) {
    const key = dedupeKey || queueItem.id;
    if (assertAuthorized) await assertAuthorized();
    let receipt = null;
    try {
        receipt = await enqueueCloudQueueMutation(async () => {
            const existingIndex = cloudSyncQueue.findIndex((item) => item.dedupeKey === key);
            const existing = existingIndex >= 0 ? cloudSyncQueue[existingIndex] : null;
            const queueRevision = ++cloudQueueRevision;
            const nextReceipt = {
                dedupeKey: key,
                previousItem: existing ? { ...existing } : null,
                queueRevision
            };

            if (existing) {
                if (queueItem.type === 'metadata') {
                    cloudSyncQueue[existingIndex] = {
                        ...existing,
                        payload: queueItem.payload,
                        kind: queueItem.kind,
                        userId: queueItem.userId,
                        updatedAt: Date.now(),
                        attempts: 0,
                        lastError: null,
                        queueRevision
                    };
                } else if (queueItem.type === 'media') {
                    cloudSyncQueue[existingIndex] = {
                        ...existing,
                        sourceUrl: queueItem.sourceUrl || existing.sourceUrl,
                        finalPath: queueItem.finalPath || existing.finalPath,
                        objectKey: queueItem.objectKey || existing.objectKey,
                        assetId: queueItem.assetId || existing.assetId,
                        sourceUrlHash: queueItem.sourceUrlHash || existing.sourceUrlHash,
                        assetIdentityKind: queueItem.assetIdentityKind || existing.assetIdentityKind,
                        contentType: queueItem.contentType || existing.contentType,
                        promptText: queueItem.promptText || existing.promptText || '',
                        backupProcessedId: queueItem.backupProcessedId || existing.backupProcessedId,
                        cleanupDownloadId: Number.isInteger(queueItem.cleanupDownloadId)
                            ? queueItem.cleanupDownloadId
                            : existing.cleanupDownloadId,
                        scrapeLease: queueItem.scrapeLease || null,
                        updatedAt: Date.now(),
                        attempts: 0,
                        lastError: null,
                        queueRevision
                    };
                }
            } else {
                cloudSyncQueue.push({
                    ...queueItem,
                    dedupeKey: key,
                    attempts: queueItem.attempts || 0,
                    createdAt: queueItem.createdAt || Date.now(),
                    queueRevision
                });
            }

            await persistCloudState();
            return nextReceipt;
        });
        if (assertAuthorized) await assertAuthorized();
        return receipt;
    } catch (error) {
        if (receipt && isScrapeAuthorityRevokedError(error)) await rollbackCloudQueueItem(receipt);
        throw error;
    }
}

async function enqueueCloudMediaUpload(sourceUrl, finalPath, promptText = '', acceptance = null, processOptions = {}) {
    const config = await getCloudConfig();
    if (processOptions.assertAuthorized) await processOptions.assertAuthorized();
    if (!CloudSync.isCloudEnabled(config)) return false;
    const acceptanceContext = acceptance || buildAcceptanceContextFromCloudConfig(config, 'queue-media');

    const userInfo = await chrome.storage.local.get(['activeGrokUserId']);
    if (processOptions.assertAuthorized) await processOptions.assertAuthorized();
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
        backupProcessedId: CloudSync.extractGrokMediaId(sourceUrl) || null,
        cleanupDownloadId: Number.isInteger(processOptions.cleanupDownloadId)
            ? processOptions.cleanupDownloadId
            : null,
        scrapeLease: processOptions.scrapeLease
            ? copyScrapeLeaseAuthority(processOptions.scrapeLease)
            : null,
        acceptance: acceptanceContext
    };

    let queueReceipt = null;
    try {
        queueReceipt = await enqueueCloudItem(queueItem, CloudSync.buildMediaDedupeKey({
            fallbackUserId: activeUserId,
            sourceUrl,
            finalPath,
            contentType: queueItem.contentType
        }), processOptions.assertAuthorized || null);
        if (processOptions.assertAuthorized) await processOptions.assertAuthorized();
        await processCloudQueue('media-enqueued', {
            ...processOptions,
            waitForExisting: false
        });
    } catch (e) {
        if (isScrapeAuthorityRevokedError(e)) {
            if (queueReceipt) await rollbackCloudQueueItem(queueReceipt);
            throw e;
        }
        console.error('[CloudQueue]', formatRedactedMediaLog(
            'enqueue_processing_failed',
            queueItem.backupProcessedId || queueItem.assetId,
            { stage: getUploadFailureStage(e) }
        ));
        updateCloudError(formatRedactedMediaError(
            e,
            queueItem.backupProcessedId || queueItem.assetId,
            'queue_enqueue_failed'
        ));
        await persistCloudState().catch(() => { });
    }
    return true;
}

async function enqueueMetadataSnapshot(kind, userId, payload) {
    const config = await getCloudConfig();
    if (!CloudSync.isCloudEnabled(config)) return;
    const acceptance = buildAcceptanceContextFromCloudConfig(config, 'metadata');

    const queueItem = {
        id: makeQueueId('metadata'),
        type: 'metadata',
        kind,
        userId,
        acceptance,
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

function binaryStringToBase64(binary) {
    if (typeof btoa === 'function') return btoa(binary);
    if (typeof Buffer !== 'undefined') return Buffer.from(binary, 'binary').toString('base64');
    throw new Error('reference_capture_failed');
}

function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    const chunkSize = 0x8000;
    let binary = '';

    for (let index = 0; index < bytes.length; index += chunkSize) {
        binary += String.fromCharCode.apply(null, bytes.subarray(index, index + chunkSize));
    }

    return binaryStringToBase64(binary);
}

function chromeRuntimeLastErrorMessage() {
    return chrome.runtime && chrome.runtime.lastError ? chrome.runtime.lastError.message : '';
}

function debuggerAttach(target, version = '1.3') {
    return new Promise((resolve, reject) => {
        chrome.debugger.attach(target, version, () => {
            const errorMessage = chromeRuntimeLastErrorMessage();
            if (errorMessage) {
                reject(new Error(errorMessage));
                return;
            }
            resolve();
        });
    });
}

function debuggerDetach(target) {
    return new Promise((resolve) => {
        chrome.debugger.detach(target, () => {
            resolve();
        });
    });
}

function debuggerSendCommand(target, command, params = {}) {
    return new Promise((resolve, reject) => {
        chrome.debugger.sendCommand(target, command, params, (result) => {
            const errorMessage = chromeRuntimeLastErrorMessage();
            if (errorMessage) {
                reject(new Error(errorMessage));
                return;
            }
            resolve(result);
        });
    });
}

function getNativeClickCoordinate(value) {
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) throw new Error('native_click_invalid');
    return number;
}

async function dispatchNativeClick(tabId, click = {}) {
    if (!chrome.debugger) throw new Error('native_click_unavailable');
    if (!Number.isFinite(Number(tabId))) throw new Error('native_click_unavailable');

    const x = getNativeClickCoordinate(click.x);
    const y = getNativeClickCoordinate(click.y);
    const target = { tabId };
    let attached = false;

    try {
        await debuggerAttach(target);
        attached = true;
        await debuggerSendCommand(target, 'Input.dispatchMouseEvent', {
            type: 'mouseMoved',
            x,
            y,
            button: 'none',
            buttons: 0
        });
        await debuggerSendCommand(target, 'Input.dispatchMouseEvent', {
            type: 'mousePressed',
            x,
            y,
            button: 'left',
            buttons: 1,
            clickCount: 1
        });
        await debuggerSendCommand(target, 'Input.dispatchMouseEvent', {
            type: 'mouseReleased',
            x,
            y,
            button: 'left',
            buttons: 0,
            clickCount: 1
        });

        return { ok: true };
    } catch (error) {
        throw new Error(error.message || 'native_click_unavailable');
    } finally {
        if (attached) await debuggerDetach(target);
    }
}

function getRecreateReferenceMimeType(url, blob) {
    const allowedTypes = RecreateWorkflowUtils ? RecreateWorkflowUtils.ALLOWED_RECREATE_MIME_TYPES : [];
    const blobType = String((blob && blob.type) || '').split(';')[0].toLowerCase();
    if (allowedTypes.includes(blobType)) return blobType;

    const inferredType = String(CloudSync.detectContentTypeFromUrl(url) || '').toLowerCase();
    if (allowedTypes.includes(inferredType)) return inferredType;

    throw new Error('reference_invalid');
}

function getRecreateReferenceExtension(mimeType) {
    if (mimeType === 'image/jpeg') return 'jpg';
    if (mimeType === 'image/webp') return 'webp';
    if (mimeType === 'image/gif') return 'gif';
    if (mimeType === 'image/bmp') return 'bmp';
    if (mimeType === 'image/tiff') return 'tiff';
    if (mimeType === 'video/mp4') return 'mp4';
    if (mimeType === 'video/quicktime') return 'mov';
    if (mimeType === 'video/webm') return 'webm';
    return 'png';
}

async function fetchRecreateReferenceDataUrl(url) {
    if (!RecreateWorkflowUtils) throw new Error('workflow_unavailable');
    if (!RecreateWorkflowUtils.isTrustedGrokMediaUrl(url)) throw new Error('reference_capture_failed');

    const parsed = new URL(String(url || ''));
    if (
        parsed.protocol !== 'https:' ||
        (parsed.hostname !== 'imagine-public.x.ai' && parsed.hostname !== 'images-public.x.ai')
    ) {
        throw new Error('reference_capture_failed');
    }

    const response = await fetch(parsed.href, { credentials: 'omit' });
    if (!response || !response.ok) throw new Error('reference_capture_failed');

    const blob = await response.blob();
    const mimeType = getRecreateReferenceMimeType(parsed.href, blob);
    const kind = RecreateWorkflowUtils.getReferenceKindFromMimeType
        ? RecreateWorkflowUtils.getReferenceKindFromMimeType(mimeType)
        : (mimeType.startsWith('video/') ? 'video' : 'image');
    const maxBytes = kind === 'video'
        ? Number(RecreateWorkflowUtils.MAX_VIDEO_REFERENCE_BYTES) || 0
        : Number(RecreateWorkflowUtils.MAX_REFERENCE_BYTES) || 0;
    if (!blob || blob.size <= 0 || (maxBytes > 0 && blob.size > maxBytes)) {
        throw new Error('reference_invalid');
    }

    const dataUrl = `data:${mimeType};base64,${arrayBufferToBase64(await blob.arrayBuffer())}`;
    const normalized = RecreateWorkflowUtils.normalizeRecreateReference({
        name: `current-grok-${kind}.${getRecreateReferenceExtension(mimeType)}`,
        kind,
        mimeType,
        dataUrl,
        source: kind === 'video' ? 'grok-video-url' : 'current-grok-image'
    });

    const result = {
        dataUrl: normalized.dataUrl,
        mimeType: normalized.mimeType,
        byteLength: normalized.byteLength
    };
    if (normalized.kind === 'video') result.kind = 'video';

    return result;
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

function createScrapeAuthorityRevokedError() {
    const error = new Error('Scrape run authority was revoked.');
    error.code = 'scrape_authority_revoked';
    return error;
}

function getScrapeAuthorityAbortSignal(assertAuthorized) {
    return assertAuthorized?.signal || null;
}

async function fetchWithScrapeAuthority(url, options = {}, assertAuthorized = null) {
    if (assertAuthorized) await assertAuthorized();
    const signal = getScrapeAuthorityAbortSignal(assertAuthorized);
    if (signal?.aborted) throw createScrapeAuthorityRevokedError();
    try {
        const response = await fetch(url, signal ? { ...options, signal } : options);
        if (assertAuthorized) await assertAuthorized();
        return response;
    } catch (error) {
        if (signal?.aborted) throw createScrapeAuthorityRevokedError();
        throw error;
    }
}

async function verifyR2Object(config, descriptor, expected = {}, assertAuthorized = null) {
    const response = await fetchWithScrapeAuthority(`${config.workerUrl}/v1/objects/verify`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            [API_KEY_HEADER]: config.apiKey,
            ...CloudSync.buildAcceptanceHeaders(descriptor)
        },
        body: JSON.stringify({
            objectKey: descriptor.objectKey,
            expectedSizeBytes: expected.sizeBytes,
            expectedSha256: expected.sha256,
            expectedContentType: expected.contentType,
            assetId: descriptor.assetId,
            sourceUrlHash: descriptor.sourceUrlHash
        })
    }, assertAuthorized);

    if (!response.ok) {
        const detail = await response.text().catch(() => 'Unknown verify failure');
        throw new Error(`R2 verify failed (${response.status}): ${detail}`);
    }

    return response.json();
}

async function requestPresignedUrl(config, queueItem, contentLength, assertAuthorized = null) {
    const body = {
        objectKey: queueItem.objectKey,
        contentType: queueItem.contentType || 'application/octet-stream',
        contentLength
    };

    const metadata = sanitizeR2Metadata(queueItem.r2Metadata || {});
    if (Object.keys(metadata).length > 0) {
        body.metadata = metadata;
    }

    const response = await fetchWithScrapeAuthority(`${config.workerUrl}/v1/presign`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            [API_KEY_HEADER]: config.apiKey,
            ...CloudSync.buildAcceptanceHeaders(queueItem)
        },
        body: JSON.stringify(body)
    }, assertAuthorized);

    if (!response.ok) {
        const detail = await response.text().catch(() => 'Unknown presign failure');
        throw new Error(`Presign failed (${response.status}): ${detail}`);
    }

    return response.json();
}

async function uploadPromptSidecar(config, descriptor, assertAuthorized = null) {
    if (!descriptor.promptText) return;

    try {
        if (assertAuthorized) await assertAuthorized();
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
            acceptance: descriptor.acceptance || null,
            r2Metadata: sanitizeR2Metadata({
                'asset-id': descriptor.assetId,
                'sidecar-kind': 'prompt'
            })
        };
        const sidecarBytes = new Blob([sidecar]).size;
        const sidecarPresigned = await requestPresignedUrl(config, sidecarItem, sidecarBytes, assertAuthorized);
        if (assertAuthorized) await assertAuthorized();
        await fetchWithScrapeAuthority(sidecarPresigned.uploadUrl, {
            method: 'PUT',
            headers: { ...(sidecarPresigned.headers || {}), 'Content-Type': 'application/json' },
            body: sidecar
        }, assertAuthorized);
        if (assertAuthorized) await assertAuthorized();
        console.log('[CloudQueue]', formatRedactedMediaLog('sidecar_uploaded', descriptor.assetId, { bytes: sidecarBytes }));
    } catch (error) {
        if (isScrapeAuthorityRevokedError(error)) throw error;
        console.warn('[CloudQueue]', formatRedactedMediaLog('sidecar_failed', descriptor.assetId));
    }
}

async function uploadBlobWithR2Dedupe(config, uploadCandidate, blob, assertAuthorized = null) {
    const contentType = uploadCandidate.contentType || blob.type || 'application/octet-stream';
    const contentSha256 = await sha256Blob(blob);
    if (assertAuthorized) await assertAuthorized();
    let descriptor = buildUploadDescriptor(config, {
        ...uploadCandidate,
        contentType,
        contentSha256
    });

    let preflight;
    try {
        if (assertAuthorized) await assertAuthorized();
        preflight = await verifyR2Object(config, descriptor, {
            sizeBytes: blob.size,
            sha256: contentSha256,
            contentType
        }, assertAuthorized);
        if (assertAuthorized) await assertAuthorized();
    } catch (e) {
        if (isScrapeAuthorityRevokedError(e)) throw e;
        throw new Error(`[${CloudSync.UPLOAD_STAGES.presign}] ${e.message}`);
    }

    if (preflight.exists && preflight.verified) {
        if (assertAuthorized) await assertAuthorized();
        cloudSyncState.r2BytesVerifiedExisting += blob.size;
        cloudSyncState.r2DuplicateUploadsSkipped += 1;
        await persistCloudState();
        if (assertAuthorized) await assertAuthorized();
        log(`Cloud upload ${formatRedactedMediaLog('already_present', descriptor.assetId, { bytes: blob.size })}`, 'success');
        return {
            status: 'already_present',
            objectKey: descriptor.objectKey,
            assetId: descriptor.assetId,
            contentSha256,
            bytes: blob.size
        };
    }

    if (preflight.exists && !preflight.verified) {
        if (assertAuthorized) await assertAuthorized();
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
        if (assertAuthorized) await assertAuthorized();
        log(`Cloud upload ${formatRedactedMediaLog('conflict_detected', descriptor.assetId, { bytes: blob.size })}`, 'warning');
    }

    let presigned;
    try {
        if (assertAuthorized) await assertAuthorized();
        presigned = await requestPresignedUrl(config, descriptor, blob.size, assertAuthorized);
        if (assertAuthorized) await assertAuthorized();
    } catch (e) {
        if (isScrapeAuthorityRevokedError(e)) throw e;
        throw new Error(`[${CloudSync.UPLOAD_STAGES.presign}] ${e.message}`);
    }

    try {
        const uploadHeaders = { ...(presigned.headers || {}) };
        if (!uploadHeaders['Content-Type'] && !uploadHeaders['content-type']) {
            uploadHeaders['Content-Type'] = contentType;
        }

        if (assertAuthorized) await assertAuthorized();
        const uploadResponse = await fetchWithScrapeAuthority(presigned.uploadUrl, {
            method: presigned.method || 'PUT',
            headers: uploadHeaders,
            body: blob
        }, assertAuthorized);
        if (assertAuthorized) await assertAuthorized();

        if (!uploadResponse.ok) {
            const detail = await uploadResponse.text().catch(() => 'Unknown upload error');
            throw new Error(`HTTP ${uploadResponse.status}: ${detail}`);
        }
    } catch (e) {
        if (isScrapeAuthorityRevokedError(e)) throw e;
        if (e.message.startsWith(`[${CloudSync.UPLOAD_STAGES.r2Put}]`)) throw e;
        throw new Error(`[${CloudSync.UPLOAD_STAGES.r2Put}] ${e.message}`);
    }

    if (assertAuthorized) await assertAuthorized();
    const postUpload = await verifyR2Object(config, descriptor, {
        sizeBytes: blob.size,
        sha256: contentSha256,
        contentType
    }, assertAuthorized);
    if (assertAuthorized) await assertAuthorized();
    if (!postUpload.exists || !postUpload.verified) {
        throw new Error(`[${CloudSync.UPLOAD_STAGES.r2Put}] R2 post-upload verification failed`);
    }

    cloudSyncState.r2BytesUploadedNew += blob.size;
    await persistCloudState();
    if (assertAuthorized) await assertAuthorized();
    await uploadPromptSidecar(config, descriptor, assertAuthorized);
    if (assertAuthorized) await assertAuthorized();

    return {
        status: descriptor.conflictOfObjectKey ? 'conflict_uploaded' : 'uploaded',
        objectKey: descriptor.objectKey,
        assetId: descriptor.assetId,
        contentSha256,
        bytes: blob.size,
        conflictOfObjectKey: descriptor.conflictOfObjectKey
    };
}

async function uploadMediaQueueItem(config, queueItem, assertAuthorized = null) {
    let blob;
    let contentType;

    try {
        console.log('[CloudQueue]', formatRedactedMediaLog('fetching', queueItem.backupProcessedId || queueItem.assetId));
        const fetchOpts = { method: 'GET' };

        if (queueItem.sourceUrl.includes('assets.grok.com')) {
            try {
                const cookies = await chrome.cookies.getAll({ domain: '.grok.com' });
                if (assertAuthorized) await assertAuthorized();
                if (cookies.length > 0) {
                    const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');
                    fetchOpts.headers = { 'Cookie': cookieHeader };
                    console.log('[CloudQueue]', formatRedactedMediaLog(
                        'cookies_attached',
                        queueItem.backupProcessedId || queueItem.assetId,
                        { count: cookies.length }
                    ));
                }
            } catch {
                console.warn('[CloudQueue]', formatRedactedMediaLog(
                    'cookies_unavailable',
                    queueItem.backupProcessedId || queueItem.assetId
                ));
            }
        }

        const mediaResponse = await fetchWithScrapeAuthority(queueItem.sourceUrl, fetchOpts, assertAuthorized);
        if (assertAuthorized) await assertAuthorized();
        if (!mediaResponse.ok) {
            throw new Error(`HTTP ${mediaResponse.status}`);
        }
        blob = await mediaResponse.blob();
        if (assertAuthorized) await assertAuthorized();
        contentType = mediaResponse.headers.get('content-type') || queueItem.contentType || 'application/octet-stream';
        queueItem.contentType = contentType;
    } catch (e) {
        if (isScrapeAuthorityRevokedError(e)) throw e;
        const hint = !CloudSync.isValidMediaSourceUrl(queueItem.sourceUrl)
            ? ' (source host not in known media hosts)'
            : '';
        throw new Error(`[${CloudSync.UPLOAD_STAGES.mediaFetch}] ${e.message}${hint}`);
    }

    return uploadBlobWithR2Dedupe(config, {
        ...queueItem,
        contentType
    }, blob, assertAuthorized);
}

async function uploadMetadataQueueItem(config, queueItem) {
    const response = await fetch(`${config.workerUrl}/v1/metadata/snapshot`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            [API_KEY_HEADER]: config.apiKey,
            ...CloudSync.buildAcceptanceHeaders(queueItem)
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

async function drainCloudQueue(reason = 'auto', options = {}) {
    if (hasBlockedScrapeCompletionTransfer()) {
        await recoverPreparedScrapeCompletionTransfer();
        if (hasBlockedScrapeCompletionTransfer()) return;
    }
    const config = await getCloudConfig();
    if (options.assertAuthorized) await options.assertAuthorized();
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
    try {
        if (options.assertAuthorized) await options.assertAuthorized();
    } catch (error) {
        cloudSyncState.processing = false;
        await persistCloudState();
        throw error;
    }

    const force = !!options.force;
    const uploadMediaOverride = options.uploadMediaQueueItem || null;
    const queueSnapshot = await snapshotCloudQueueItems();
    let authorityError = null;

    try {
        for (const item of queueSnapshot) {
            if (!await cloudQueueItemIsCurrent(item)) continue;
            const itemLease = normalizeScrapeLease(item.scrapeLease);
            const processLease = normalizeScrapeLease(options.scrapeLease);
            const usesProcessAuthority = itemLease
                && processLease
                && scrapeLeaseMatches(itemLease, processLease)
                && options.assertAuthorized;
            const itemAbortController = itemLease && !usesProcessAuthority
                ? registerScrapeTransferAbortController(itemLease)
                : null;
            const itemAssertAuthorized = itemLease
                ? (usesProcessAuthority
                    ? options.assertAuthorized
                    : createScrapeTransferAuthorityGuard(itemLease, itemAbortController.signal))
                : (options.assertAuthorized || null);
            const attempts = item.attempts || 0;
            try {
                if (!force && attempts >= CloudSync.MAX_RETRY_ATTEMPTS) {
                    if (!item._permanentFailLogged) {
                        const message = item.type === 'media'
                            ? `Cloud sync ${formatRedactedMediaLog('permanently_failed', item.backupProcessedId || item.assetId, { count: attempts })}`
                            : `Cloud sync permanently failed (${item.type}): ${item.kind} after ${attempts} attempts`;
                        log(message, 'error');
                        await updateCloudQueueItemRevision(item, { _permanentFailLogged: true });
                    }
                    continue;
                }
                if (item.type === 'media') {
                    if (itemAssertAuthorized) await itemAssertAuthorized();
                    const mediaIdentity = item.backupProcessedId || item.assetId;
                    console.log('[CloudQueue]', formatRedactedMediaLog('processing', mediaIdentity));
                    const result = uploadMediaOverride
                        ? await uploadMediaOverride(config, item, itemAssertAuthorized)
                        : await uploadMediaQueueItem(config, item, itemAssertAuthorized);
                    if (itemAssertAuthorized) await itemAssertAuthorized();
                    await persistQueuedBackupProcessedIdAfterSuccess(
                        item,
                        result,
                        itemAssertAuthorized
                    );
                    log(
                        `Cloud upload ${formatRedactedMediaLog(result.status, mediaIdentity, { bytes: result.bytes })}`,
                        result.status === 'conflict_uploaded' ? 'warning' : 'success'
                    );
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
                await removeCloudQueueItemRevision(item);
            } catch (e) {
                if (isScrapeAuthorityRevokedError(e)) {
                    if (itemLease) {
                        await removeCloudQueueItemRevision(item);
                        continue;
                    }
                    authorityError = e;
                    break;
                }
                if (item.type === 'media') {
                    console.error('[CloudQueue]', formatRedactedMediaLog(
                        'failed',
                        item.backupProcessedId || item.assetId,
                        { stage: getUploadFailureStage(e) }
                    ));
                } else {
                    console.error('[CloudQueue] Metadata upload failed:', item.kind);
                }
                const nextAttempts = attempts + 1;
                const redactedError = item.type === 'media'
                    ? formatRedactedMediaError(
                        e,
                        item.backupProcessedId || item.assetId,
                        'queue_upload_failed'
                    )
                    : e.message;
                await updateCloudQueueItemRevision(item, {
                    attempts: nextAttempts,
                    lastError: redactedError,
                    lastAttemptAt: Date.now()
                });
                updateCloudError(redactedError);
                const message = item.type === 'media'
                    ? `Cloud sync ${formatRedactedMediaLog(
                        'failed',
                        item.backupProcessedId || item.assetId,
                        { count: nextAttempts, stage: getUploadFailureStage(e) }
                    )}`
                    : `Cloud sync failed (${item.type})`;
                log(message, 'warning');
            } finally {
                if (itemAbortController) releaseScrapeTransferAbortController(itemLease, itemAbortController);
            }
        }
    } finally {
        cloudSyncState.processing = false;
        await persistCloudState();
    }

    if (authorityError) throw authorityError;

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

function processCloudQueue(reason = 'auto', options = {}) {
    if (cloudQueueDrainPromise) {
        return options.waitForExisting === false ? Promise.resolve() : cloudQueueDrainPromise;
    }

    const drain = drainCloudQueue(reason, options);
    cloudQueueDrainPromise = drain;
    drain.finally(() => {
        if (cloudQueueDrainPromise === drain) cloudQueueDrainPromise = null;
    }).catch(() => {});
    return drain;
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
        let pathname;
        try {
            pathname = new URL(String(url || ''), 'https://grok.com').pathname;
        } catch {
            pathname = String(url || '').split('#')[0].split('?')[0];
        }
        const parts = pathname.split('/').filter(Boolean);
        const cleanName = parts[parts.length - 1] || 'unknown';

        if (cleanName.includes('.')) {
            filename = cleanName.split('.')[0];
        } else {
            filename = cleanName;
        }

        uuid = CloudSync.extractGrokMediaId(url) || null;
        if (uuid) {
            filename = uuid; // Enforce UUID as filename
        } else if (CloudSync.normalizeSourceUrlForIdentity(url)) {
            filename = CloudSync.buildSourceUrlHash(url);
        } else if (suggestedFilename) {
            const suggestedBase = String(suggestedFilename).split('/').pop() || 'unknown';
            filename = suggestedBase.split('.')[0];
        }

        // Generic filenames (e.g. "generated_video") get a timestamp to prevent overwrites
        const GENERIC_NAMES = ['generated_video', 'generated_image', 'unknown', 'image', 'video'];
        if (filename.length < 10 || GENERIC_NAMES.includes(filename.toLowerCase())) {
            filename = `${filename}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        }
    } catch {
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
    } catch { /* keep default */ }
    return 'png';
}

async function generateFilename(url, suggestedFilename, extHint) {
    const parsed = parseFilenameInfo(url, suggestedFilename);

    // 2. Deduplication Check
    if (parsed.uuid && processedUUIDs.has(parsed.uuid)) {
        console.log('Download', formatRedactedMediaLog('duplicate_skipped', parsed.uuid));
        return null; // Signal cancel
    }

    // 3. Build Path
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
        PROCESSED_IDS_KEY,
        CloudSync.STORAGE_KEYS.cloudSyncQueue,
        CloudSync.STORAGE_KEYS.cloudSyncState,
        PENDING_DOWNLOAD_OPERATIONS_KEY,
        SCRAPE_COMPLETION_TXN_KEY
    ]);

    if (stored[PROCESSED_IDS_KEY]) {
        processedUUIDs = new Set(normalizeProcessedIds(stored[PROCESSED_IDS_KEY]));
        console.log(`Loaded ${processedUUIDs.size} processed UUIDs.`);
    }

    pendingDownloadOperations = deserializeDownloadOperations(stored[PENDING_DOWNLOAD_OPERATIONS_KEY]);
    pendingDownloadOperationRevision = Array.from(pendingDownloadOperations.values()).reduce(
        (latest, operation) => Math.max(
            latest,
            Number.isInteger(operation?.operationRevision) ? operation.operationRevision : 0
        ),
        pendingDownloadOperationRevision
    );
    scrapeCompletionTxn = stored[SCRAPE_COMPLETION_TXN_KEY]
        && typeof stored[SCRAPE_COMPLETION_TXN_KEY] === 'object'
        ? { ...stored[SCRAPE_COMPLETION_TXN_KEY] }
        : null;
    const startupDownloadOperations = Array.from(pendingDownloadOperations.values())
        .map((operation) => ({ ...operation }));

    cloudSyncQueue = Array.isArray(stored[CloudSync.STORAGE_KEYS.cloudSyncQueue])
        ? stored[CloudSync.STORAGE_KEYS.cloudSyncQueue].map((item) => {
            if (item?.type !== 'media' || !item.lastError || isRedactedMediaError(item.lastError)) return item;
            return {
                ...item,
                lastError: formatRedactedMediaError(
                    new Error(item.lastError),
                    item.backupProcessedId || item.assetId,
                    'queue_upload_failed'
                )
            };
        })
        : [];
    cloudQueueRevision = cloudSyncQueue.reduce(
        (latest, item) => Math.max(latest, Number.isInteger(item?.queueRevision) ? item.queueRevision : 0),
        cloudQueueRevision
    );

    cloudSyncState = {
        ...cloudSyncState,
        ...(stored[CloudSync.STORAGE_KEYS.cloudSyncState] || {}),
        lastError: isRedactedMediaError(stored[CloudSync.STORAGE_KEYS.cloudSyncState]?.lastError)
            ? stored[CloudSync.STORAGE_KEYS.cloudSyncState].lastError
            : null,
        unsyncedCount: cloudSyncQueue.length,
        processing: false
    };
    const latestMediaError = cloudSyncQueue.find((item) => item.type === 'media' && item.lastError)?.lastError;
    if (latestMediaError) cloudSyncState.lastError = latestMediaError;

    await recoverPreparedScrapeCompletionTransfer();
    await ensureCloudConfigExists();
    await persistCloudState();
    await scheduleCloudRetryAlarm();
    await reconcilePendingDownloadOperations(startupDownloadOperations);
}

backgroundStateReadyPromise = initializeBackgroundState();
backgroundStateReadyPromise.catch((e) => {
    console.error('Background initialization failed:', e);
});

function ensureBackgroundStateReady() {
    return backgroundStateReadyPromise || Promise.resolve();
}

chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === CLOUD_ALARM_NAME) {
        (async () => {
            await ensureBackgroundStateReady();
            await reconcilePendingDownloadOperations();
            await processCloudQueue('alarm');
        })().catch((e) => {
            updateCloudError(sanitizeErrorToken(getUploadFailureStage(e), 'runtime'));
            persistCloudState().catch(() => { });
        });
    }
});

chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;

    if (changes[PROCESSED_IDS_KEY]) {
        processedUUIDs = new Set(normalizeProcessedIds(changes[PROCESSED_IDS_KEY].newValue));
    }

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

function isGrokSavedUrl(value) {
    try {
        const url = new URL(String(value || ''));
        return (url.hostname === 'grok.com' || url.hostname.endsWith('.grok.com'))
            && /^\/imagine\/saved(?:\/|$)/.test(url.pathname);
    } catch {
        return false;
    }
}

function queryActiveTab() {
    return new Promise((resolve, reject) => {
        let settled = false;
        const finish = (tabs) => {
            if (settled) return;
            settled = true;
            const error = chrome.runtime.lastError;
            if (error) reject(new Error(error.message));
            else resolve(Array.isArray(tabs) ? tabs[0] || null : null);
        };
        try {
            const result = chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => finish(tabs));
            if (result && typeof result.then === 'function') result.then((tabs) => finish(tabs), reject);
        } catch (error) {
            reject(error);
        }
    });
}

function sendMessageToTab(tabId, message) {
    return new Promise((resolve, reject) => {
        let settled = false;
        const finish = (response) => {
            if (settled) return;
            settled = true;
            const error = chrome.runtime.lastError;
            if (error) reject(new Error(error.message));
            else resolve(response);
        };
        try {
            const result = chrome.tabs.sendMessage(tabId, message, (response) => finish(response));
            if (result && typeof result.then === 'function') result.then((response) => finish(response), reject);
        } catch (error) {
            reject(error);
        }
    });
}

function injectContentScripts(tabId) {
    const files = [
        'providerRegistry.js',
        'providerRunLedger.js',
        'chatgptImagesContent.js',
        'recreateWorkflowUtils.js',
        'recreateWorkflowContent.js',
        'content.js'
    ];
    return new Promise((resolve, reject) => {
        let settled = false;
        const finish = () => {
            if (settled) return;
            settled = true;
            const error = chrome.runtime.lastError;
            if (error) reject(new Error(error.message));
            else resolve();
        };
        try {
            const result = chrome.scripting.executeScript({ target: { tabId }, files }, finish);
            if (result && typeof result.then === 'function') result.then(finish, reject);
        } catch (error) {
            reject(error);
        }
    });
}

function queueChromeDownload(options, scrapeLease = null) {
    return new Promise((resolve, reject) => {
        let settled = false;
        let finishing = false;
        const receipt = scrapeLease
            ? registerPendingScrapeDownload(options.url, scrapeLease)
            : null;
        const fail = (error) => {
            if (settled) return;
            settled = true;
            if (receipt) releasePendingScrapeDownload(receipt);
            reject(error);
        };
        const finish = async (downloadId) => {
            if (settled || finishing) return;
            finishing = true;
            const error = chrome.runtime.lastError;
            if (error) {
                fail(new Error(error.message));
                return;
            }
            if (!Number.isInteger(downloadId)) {
                fail(new Error('Chrome did not accept the download.'));
                return;
            }
            if (receipt) {
                bindPendingScrapeDownloadId(receipt, downloadId);
                try {
                    await assertScrapeTransferAuthorized(scrapeLease);
                } catch (authorityError) {
                    receipt.revoked = true;
                    cancelDownload(downloadId);
                    fail(authorityError);
                    return;
                }
            }
            settled = true;
            resolve(downloadId);
        };
        try {
            const result = chrome.downloads.download(options, finish);
            if (result && typeof result.then === 'function') result.then(finish, fail);
        } catch (error) {
            fail(error);
        }
    });
}

function normalizeScrapeLease(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const status = ['starting', 'active', 'idle'].includes(value.status) ? value.status : null;
    const kind = value.kind === 'sync' || value.kind === 'r2_backup' ? value.kind : null;
    const epoch = Number.isInteger(value.epoch) && value.epoch >= 0 ? value.epoch : null;
    if (!status || epoch === null || value.version !== SCRAPE_LEASE_VERSION) return null;
    if (status !== 'idle') {
        if (!kind || typeof value.token !== 'string' || !value.token) return null;
        if (status === 'active' && !Number.isInteger(value.tabId)) return null;
    }
    return {
        version: SCRAPE_LEASE_VERSION,
        epoch,
        token: status !== 'idle' ? value.token : null,
        tabId: status === 'active' ? value.tabId : null,
        kind: status !== 'idle' ? kind : null,
        status,
        startedAt: status !== 'idle' && Number.isFinite(value.startedAt) ? value.startedAt : null
    };
}

function createIdleScrapeLease(epoch = 0) {
    return {
        version: SCRAPE_LEASE_VERSION,
        epoch: Math.max(0, Number.isInteger(epoch) ? epoch : 0),
        token: null,
        tabId: null,
        kind: null,
        status: 'idle',
        startedAt: null
    };
}

function scrapeLeaseMatches(left, right) {
    return Boolean(
        left
        && right
        && left.status === 'active'
        && right.status === 'active'
        && left.version === right.version
        && left.epoch === right.epoch
        && left.token === right.token
        && left.tabId === right.tabId
        && left.kind === right.kind
    );
}

function scrapeLeaseIdentityMatches(left, right) {
    return Boolean(
        left
        && right
        && left.status !== 'idle'
        && right.status !== 'idle'
        && left.version === right.version
        && left.epoch === right.epoch
        && left.token === right.token
        && left.kind === right.kind
    );
}

function localRunMatchesLease(stored, lease) {
    return Boolean(
        lease?.status === 'active'
        && stored?.scraperState === 'running'
        && stored?.scrapeRunToken === lease.token
        && stored?.scrapeRunEpoch === lease.epoch
        && stored?.isScraping === true
        && (stored?.isR2Backup === true) === (lease.kind === 'r2_backup')
    );
}

function hasStaleLocalRunState(stored = {}) {
    return stored.scraperState === 'running'
        || Boolean(stored.scrapeRunToken)
        || Number.isInteger(stored.scrapeRunEpoch)
        || Boolean(stored.scrapeNavigation)
        || Boolean(stored.currentItemId)
        || stored.isScraping === true
        || stored.isR2Backup === true
        || stored.r2BackupState?.isRunning === true;
}

function buildAuthoritativeIdleLocalState(stored = {}, stopReason = 'stopped') {
    const values = {
        scraperState: 'idle',
        currentIndex: 0,
        scrapeRunToken: null,
        scrapeRunEpoch: null,
        scrapeNavigation: null,
        currentItemId: null,
        scrapeBackupOptions: null,
        isScraping: false,
        isR2Backup: false,
        scrapeStopReason: stopReason
    };
    if (stored.r2BackupState && typeof stored.r2BackupState === 'object') {
        values.r2BackupState = {
            ...stored.r2BackupState,
            isRunning: false,
            stopReason
        };
    }
    return values;
}

async function persistScrapeLease(lease) {
    const session = chrome.storage?.session;
    if (!session || typeof session.set !== 'function') {
        throw new Error('Session storage is unavailable.');
    }
    await session.set({ [ACTIVE_SCRAPE_RUN_TOKEN_KEY]: lease });
    activeScrapeLease = lease;
    return lease;
}

async function hydrateScrapeLeaseAuthority() {
    const session = chrome.storage?.session;
    if (!session || typeof session.get !== 'function' || typeof session.set !== 'function') {
        throw new Error('Session storage is unavailable.');
    }
    const [sessionValues, stored] = await Promise.all([
        session.get([ACTIVE_SCRAPE_RUN_TOKEN_KEY]),
        chrome.storage.local.get([
            'scraperState',
            'scrapeRunToken',
            'scrapeRunEpoch',
            'scrapeNavigation',
            'currentItemId',
            'scrapeBackupOptions',
            'isScraping',
            'isR2Backup',
            'r2BackupState'
        ])
    ]);
    const storedLease = normalizeScrapeLease(sessionValues?.[ACTIVE_SCRAPE_RUN_TOKEN_KEY]);
    if (storedLease?.status === 'active' && localRunMatchesLease(stored, storedLease)) {
        activeScrapeLease = storedLease;
        isScraping = true;
        isR2Backup = storedLease.kind === 'r2_backup';
        scrapeStartPending = false;
        return storedLease;
    }

    const nextEpoch = storedLease?.status === 'active' || storedLease?.status === 'starting'
        ? storedLease.epoch + 1
        : (storedLease?.epoch || 0);
    const tombstone = await persistScrapeLease(createIdleScrapeLease(nextEpoch));
    isScraping = false;
    isR2Backup = false;
    scrapeStartPending = false;
    if (hasStaleLocalRunState(stored)) {
        await chrome.storage.local.set(buildAuthoritativeIdleLocalState(stored, 'stale_session'));
    }
    return tombstone;
}

function ensureScrapeLeaseHydrated() {
    if (!scrapeLeaseHydrationPromise) {
        scrapeLeaseHydrationPromise = hydrateScrapeLeaseAuthority().catch((error) => {
            scrapeLeaseHydrationPromise = null;
            throw error;
        });
    }
    return scrapeLeaseHydrationPromise;
}

function enqueueScrapeLeaseOperation(operation) {
    const execute = async () => {
        await ensureScrapeLeaseHydrated();
        return operation();
    };
    const result = scrapeLeaseMutationQueue.then(execute, execute);
    scrapeLeaseMutationQueue = result.catch(() => {});
    return result;
}

function makeScrapeRunToken() {
    return `scrape_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function getRequestedLease(value, senderTabId = null) {
    if (value && typeof value === 'object') {
        return normalizeScrapeLease({
            version: SCRAPE_LEASE_VERSION,
            epoch: value.epoch ?? value.runEpoch,
            token: value.token ?? value.runToken,
            tabId: Number.isInteger(senderTabId) ? senderTabId : value.tabId,
            kind: value.kind || (value.isR2Backup ? 'r2_backup' : 'sync'),
            status: 'active',
            startedAt: value.startedAt || Date.now()
        });
    }
    return null;
}

function getRunScopedScrapeLease(value, senderTabId = null, expectedKind = null) {
    if (!value || typeof value !== 'object') return null;
    if (!Number.isInteger(senderTabId)) return null;
    if (value.kind !== 'sync' && value.kind !== 'r2_backup') return null;
    if (expectedKind && value.kind !== expectedKind) return null;
    return getRequestedLease(value, senderTabId);
}

async function validateScrapeResume(value, senderTabId = null) {
    const requested = getRunScopedScrapeLease(value, senderTabId);
    if (!requested) return { valid: false, reason: 'stale_authority' };
    return enqueueScrapeLeaseOperation(async () => {
        const owner = activeScrapeLease;
        if (
            owner?.status === 'active'
            && owner.token === requested.token
            && owner.epoch === requested.epoch
            && owner.kind === requested.kind
            && owner.tabId !== requested.tabId
        ) {
            return { valid: false, reason: 'non_owner' };
        }
        if (!scrapeLeaseMatches(owner, requested)) {
            return { valid: false, reason: 'stale_authority' };
        }
        const stored = await chrome.storage.local.get([
            'scraperState',
            'scrapeRunToken',
            'scrapeRunEpoch',
            'isScraping',
            'isR2Backup'
        ]);
        if (!scrapeLeaseMatches(activeScrapeLease, requested) || !localRunMatchesLease(stored, requested)) {
            return { valid: false, reason: 'stale_authority' };
        }
        return { valid: true, reason: 'active_owner' };
    });
}

const SCRAPE_RUN_MIRROR_KEYS = [
    'currentIndex',
    'scrapeNavigation',
    'currentItemId',
    'scrapeBackupOptions',
    'r2BackupState'
];

function buildAuthorizedRunningMirror(lease, values = {}) {
    const mirror = {};
    for (const key of SCRAPE_RUN_MIRROR_KEYS) {
        if (Object.prototype.hasOwnProperty.call(values, key)) mirror[key] = values[key];
    }
    return {
        ...mirror,
        scraperState: 'running',
        scrapeRunToken: lease.token,
        scrapeRunEpoch: lease.epoch,
        isScraping: true,
        isR2Backup: lease.kind === 'r2_backup',
        ...(lease.kind === 'r2_backup' && mirror.r2BackupState
            ? { r2BackupState: { ...mirror.r2BackupState, isRunning: true } }
            : {})
    };
}

async function commitScrapeRunState(request, sender) {
    const requested = getRunScopedScrapeLease(request, sender?.tab?.id ?? null);
    return enqueueScrapeLeaseOperation(async () => {
        if (!scrapeLeaseMatches(activeScrapeLease, requested)) {
            return { status: 'ignored', reason: 'stale_authority' };
        }
        await chrome.storage.local.set(buildAuthorizedRunningMirror(requested, request.values));
        return { status: 'ok' };
    });
}

async function getAuthorizedScrapeTransferLease(request, sender) {
    const requested = getRunScopedScrapeLease(request, sender?.tab?.id ?? null);
    const authoritySnapshot = await enqueueScrapeLeaseOperation(() => (
        scrapeLeaseMatches(activeScrapeLease, requested) ? { ...requested } : null
    ));
    if (!authoritySnapshot) return null;
    const stored = await chrome.storage.local.get([
        'scraperState',
        'scrapeRunToken',
        'scrapeRunEpoch',
        'isScraping',
        'isR2Backup'
    ]);
    return enqueueScrapeLeaseOperation(() => {
        if (!scrapeLeaseMatches(activeScrapeLease, requested) || !localRunMatchesLease(stored, requested)) {
            return null;
        }
        return { ...requested };
    });
}

async function assertScrapeTransferAuthorized(lease) {
    const current = await getAuthorizedScrapeTransferLease(lease, { tab: { id: lease.tabId } });
    if (!current) {
        const error = new Error('Scrape run authority was revoked.');
        error.code = 'scrape_authority_revoked';
        throw error;
    }
    return current;
}

function createScrapeTransferAuthorityGuard(lease, signal = null) {
    const guard = async () => {
        if (signal?.aborted) throw createScrapeAuthorityRevokedError();
        const current = await assertScrapeTransferAuthorized(lease);
        if (signal?.aborted) throw createScrapeAuthorityRevokedError();
        return current;
    };
    guard.signal = signal;
    guard.scrapeLease = copyScrapeLeaseAuthority(lease);
    return guard;
}

function copyScrapeLeaseAuthority(lease) {
    return {
        version: SCRAPE_LEASE_VERSION,
        epoch: lease.epoch,
        token: lease.token,
        tabId: lease.tabId,
        kind: lease.kind,
        status: 'active',
        startedAt: lease.startedAt || Date.now()
    };
}

function getDownloadOperationScrapeLease(operation) {
    return normalizeScrapeLease(operation?.scrapeLease);
}

function registerPendingScrapeDownload(url, lease) {
    const key = String(url || '');
    const receipt = {
        url: key,
        lease: copyScrapeLeaseAuthority(lease),
        downloadId: null,
        claimed: false,
        revoked: false
    };
    const receipts = pendingScrapeDownloadReceiptsByUrl.get(key) || [];
    receipts.push(receipt);
    pendingScrapeDownloadReceiptsByUrl.set(key, receipts);
    return receipt;
}

function releasePendingScrapeDownload(receipt) {
    if (!receipt) return;
    if (Number.isInteger(receipt.downloadId)) {
        if (pendingScrapeDownloadReceiptsById.get(receipt.downloadId) === receipt) {
            pendingScrapeDownloadReceiptsById.delete(receipt.downloadId);
        }
    }
    const receipts = pendingScrapeDownloadReceiptsByUrl.get(receipt.url);
    if (!receipts) return;
    const remaining = receipts.filter((candidate) => candidate !== receipt);
    if (remaining.length) pendingScrapeDownloadReceiptsByUrl.set(receipt.url, remaining);
    else pendingScrapeDownloadReceiptsByUrl.delete(receipt.url);
}

function bindPendingScrapeDownloadId(receipt, downloadId) {
    receipt.downloadId = downloadId;
    pendingScrapeDownloadReceiptsById.set(downloadId, receipt);
    if (receipt.revoked) {
        revokedScrapeDownloadIds.add(downloadId);
        releasePendingScrapeDownload(receipt);
    }
}

function claimPendingScrapeDownload(item) {
    if (revokedScrapeDownloadIds.has(item.id)) return { revoked: true, downloadId: item.id };
    const byId = pendingScrapeDownloadReceiptsById.get(item.id);
    if (byId) {
        byId.claimed = true;
        return byId;
    }
    const urls = [item.url, item.finalUrl].filter(Boolean);
    for (const url of urls) {
        const receipt = (pendingScrapeDownloadReceiptsByUrl.get(String(url)) || [])
            .find((candidate) => !candidate.claimed);
        if (!receipt) continue;
        receipt.claimed = true;
        bindPendingScrapeDownloadId(receipt, item.id);
        return receipt;
    }
    return null;
}

async function revokeScrapeDownloadAuthority(lease) {
    abortScrapeTransferControllers(lease);
    for (const receipts of pendingScrapeDownloadReceiptsByUrl.values()) {
        for (const receipt of [...receipts]) {
            if (!scrapeLeaseMatches(receipt.lease, lease)) continue;
            receipt.revoked = true;
            if (Number.isInteger(receipt.downloadId)) {
                revokedScrapeDownloadIds.add(receipt.downloadId);
                cancelDownload(receipt.downloadId);
                releasePendingScrapeDownload(receipt);
            } else {
                releasePendingScrapeDownload(receipt);
            }
        }
    }

    const knownOperationIds = Array.from(pendingDownloadOperations.values())
        .filter((operation) => recordOwnedByScrapeLease(operation, lease))
        .map((operation) => operation.downloadId);
    for (const downloadId of knownOperationIds) {
        revokedScrapeDownloadIds.add(downloadId);
        cancelDownload(downloadId);
    }

    const completionTransitionSettled = await settleRevokedScrapeCompletionTransition(lease);
    await revokeScrapeRetryAuthorityAtomically(lease);
    if (completionTransitionSettled
        && scrapeCompletionTransition?.revoked
        && completionTxnMatchesLease(scrapeCompletionTransition.txn, lease)) {
        scrapeCompletionTransition = null;
    }
}

function scrapeTransferKey(lease) {
    return `${lease.kind}:${lease.epoch}:${lease.token}:${lease.tabId}`;
}

function registerScrapeTransferAbortController(lease) {
    const key = scrapeTransferKey(lease);
    const controllers = activeScrapeTransferAbortControllers.get(key) || new Set();
    const controller = new AbortController();
    controllers.add(controller);
    activeScrapeTransferAbortControllers.set(key, controllers);
    return controller;
}

function releaseScrapeTransferAbortController(lease, controller) {
    const key = scrapeTransferKey(lease);
    const controllers = activeScrapeTransferAbortControllers.get(key);
    if (!controllers) return;
    controllers.delete(controller);
    if (controllers.size === 0) activeScrapeTransferAbortControllers.delete(key);
}

function abortScrapeTransferControllers(lease) {
    const key = scrapeTransferKey(lease);
    const controllers = activeScrapeTransferAbortControllers.get(key);
    if (!controllers) return;
    for (const controller of controllers) controller.abort();
    activeScrapeTransferAbortControllers.delete(key);
}

function trackScrapeTransferTask(lease, operation) {
    const key = scrapeTransferKey(lease);
    const tasks = activeScrapeTransferTasks.get(key) || new Set();
    const controller = registerScrapeTransferAbortController(lease);
    const task = Promise.resolve().then(() => operation(controller.signal));
    tasks.add(task);
    activeScrapeTransferTasks.set(key, tasks);
    task.finally(() => {
        releaseScrapeTransferAbortController(lease, controller);
        tasks.delete(task);
        if (tasks.size === 0) activeScrapeTransferTasks.delete(key);
    }).catch(() => {});
    return task;
}

async function waitForScrapeTransferTasks(lease) {
    const key = scrapeTransferKey(lease);
    const tasks = activeScrapeTransferTasks.get(key);
    if (!tasks?.size) return true;
    const drained = await withTimeout(
        Promise.allSettled(Array.from(tasks)).then(() => true),
        SCRAPE_TRANSFER_DRAIN_TIMEOUT_MS,
        false
    );
    if (!drained) activeScrapeTransferTasks.delete(key);
    return drained;
}

function isScrapeAuthorityRevokedError(error) {
    return error?.code === 'scrape_authority_revoked';
}

async function sendScrapeInitWithInjection(tabId, initMessage) {
    try {
        return await sendMessageToTab(tabId, initMessage);
    } catch (firstError) {
        if (!/receiving end does not exist|could not establish connection/i.test(firstError.message)) throw firstError;
        await injectContentScripts(tabId);
        return sendMessageToTab(tabId, initMessage);
    }
}

async function withTimeout(promise, timeoutMs, fallback) {
    let timeoutId = null;
    try {
        return await Promise.race([
            promise,
            new Promise((resolve) => {
                timeoutId = setTimeout(() => resolve(fallback), timeoutMs);
            })
        ]);
    } finally {
        if (timeoutId !== null) clearTimeout(timeoutId);
    }
}

async function sendScrapeAbort(lease, stopNavigation = null) {
    if (!lease || lease.status !== 'active') return false;
    const action = lease.kind === 'r2_backup' ? 'ABORT_R2_BACKUP' : 'ABORT_SCRAPE';
    try {
        const message = {
            action,
            runToken: lease.token,
            runEpoch: lease.epoch
        };
        if (stopNavigation) message.stopNavigation = stopNavigation;
        const response = await withTimeout(
            sendMessageToTab(lease.tabId, message),
            SCRAPE_ABORT_TIMEOUT_MS,
            null
        );
        return response?.status === 'stopped';
    } catch {
        return false;
    }
}

async function reserveScrapeStartIntent(kind) {
    return enqueueScrapeLeaseOperation(async () => {
        if (activeScrapeLease?.status === 'active' || activeScrapeLease?.status === 'starting' || scrapeStartPending || scrapeStopPending) {
            return null;
        }
        const lease = {
            version: SCRAPE_LEASE_VERSION,
            epoch: (activeScrapeLease?.epoch || 0) + 1,
            token: makeScrapeRunToken(),
            tabId: null,
            kind,
            status: 'starting',
            startedAt: Date.now()
        };
        scrapeStartPending = true;
        try {
            await persistScrapeLease(lease);
            return lease;
        } catch (error) {
            scrapeStartPending = false;
            throw error;
        }
    });
}

async function promoteScrapeStartIntent(intent, tabId) {
    return enqueueScrapeLeaseOperation(async () => {
        if (
            activeScrapeLease?.status !== 'starting'
            || !scrapeLeaseIdentityMatches(activeScrapeLease, intent)
        ) return null;
        const lease = { ...intent, tabId, status: 'active' };
        await persistScrapeLease(lease);
        return lease;
    });
}

async function scrapeStartIntentOwnsAuthority(intent) {
    return enqueueScrapeLeaseOperation(async () => (
        activeScrapeLease?.status === 'starting'
        && scrapeLeaseIdentityMatches(activeScrapeLease, intent)
    ));
}

async function cancelPreparedScrapeStart(lease, stopReason = 'start_failed') {
    return enqueueScrapeLeaseOperation(async () => {
        if (!scrapeLeaseIdentityMatches(activeScrapeLease, lease)) return false;
        await persistScrapeLease(createIdleScrapeLease(lease.epoch + 1));
        scrapeStartPending = false;
        isScraping = false;
        isR2Backup = false;
        const stored = await chrome.storage.local.get(['r2BackupState']);
        await chrome.storage.local.set(buildAuthoritativeIdleLocalState(stored, stopReason));
        return true;
    });
}

async function finalizeScrapeStart(lease, initResponse) {
    return enqueueScrapeLeaseOperation(async () => {
        if (!scrapeLeaseMatches(activeScrapeLease, lease)) {
            return { status: 'error', surface: initResponse?.surface || 'saved_gallery', error: 'Start was cancelled.' };
        }
        if (
            initResponse?.status !== 'started'
            || initResponse.surface !== 'saved_gallery'
            || initResponse.runToken !== lease.token
            || initResponse.runEpoch !== lease.epoch
        ) {
            await persistScrapeLease(createIdleScrapeLease(lease.epoch + 1));
            scrapeStartPending = false;
            isScraping = false;
            isR2Backup = false;
            const stored = await chrome.storage.local.get(['r2BackupState']);
            await chrome.storage.local.set(buildAuthoritativeIdleLocalState(stored, 'start_rejected'));
            if (initResponse?.status === 'invalid_context') return initResponse;
            return {
                status: 'error',
                surface: initResponse?.surface || 'unsupported',
                error: initResponse?.error || 'Content script returned no authoritative start acknowledgement.'
            };
        }

        scrapeStartPending = false;
        isScraping = true;
        isR2Backup = lease.kind === 'r2_backup';
        await chrome.storage.local.set({ isScraping: true, isR2Backup });
        return { ...initResponse, runToken: lease.token, runEpoch: lease.epoch };
    });
}

async function initializeScrapeInActiveTab(initMessage, { backup = false, sourceTab = null } = {}) {
    let intent = null;
    let lease = null;
    try {
        intent = await reserveScrapeStartIntent(backup ? 'r2_backup' : 'sync');
        if (!intent) {
            return { status: 'error', surface: 'unsupported', error: 'A sync or backup run is already active.' };
        }
        const resolvedInitMessage = typeof initMessage === 'function' ? await initMessage() : initMessage;
        if (!await scrapeStartIntentOwnsAuthority(intent)) {
            return { status: 'error', surface: 'unsupported', error: 'Start was cancelled.' };
        }
        const tab = sourceTab || await queryActiveTab();
        if (!Number.isInteger(tab?.id) || !isGrokSavedUrl(tab.url)) {
            await cancelPreparedScrapeStart(intent, 'invalid_context');
            return {
                status: 'invalid_context',
                surface: 'unsupported',
                error: backup
                    ? 'Open Grok Imagine Saved before starting backup.'
                    : 'Open Grok Imagine Saved before starting sync.'
            };
        }
        lease = await promoteScrapeStartIntent(intent, tab.id);
        if (!lease) {
            return { status: 'error', surface: 'unsupported', error: 'Start was cancelled.' };
        }
        const initResponse = await sendScrapeInitWithInjection(tab.id, {
            ...resolvedInitMessage,
            runToken: lease.token,
            runEpoch: lease.epoch
        });
        const response = await finalizeScrapeStart(lease, initResponse);
        if (response.status !== 'started') await sendScrapeAbort(lease);
        return response;
    } catch (error) {
        if (intent) await cancelPreparedScrapeStart(lease || intent, 'start_failed').catch(() => {});
        if (lease) await sendScrapeAbort(lease);
        return { status: 'error', surface: 'unsupported', error: error.message || 'Failed to start.' };
    }
}

async function stopScrapeRun(requestedKind = null, stopReason = 'stopped') {
    const prepared = await enqueueScrapeLeaseOperation(async () => {
        const lease = activeScrapeLease?.status === 'active' || activeScrapeLease?.status === 'starting'
            ? { ...activeScrapeLease }
            : null;
        if (!lease) {
            const incompleteLease = scrapeCompletionTxn?.phase === 'prepared'
                ? normalizeScrapeLease(scrapeCompletionTxn.lease)
                : normalizeScrapeLease(scrapeCompletionTransition?.txn?.lease);
            if (incompleteLease) {
                markScrapeCompletionTransitionRevoked(incompleteLease);
                await revokeScrapeDownloadAuthority(incompleteLease);
            }
            const stored = await chrome.storage.local.get(['r2BackupState']);
            await chrome.storage.local.set(buildAuthoritativeIdleLocalState(stored, stopReason));
            return { response: { status: 'stopped', abortAcknowledged: false } };
        }
        if (requestedKind && lease.kind !== requestedKind) {
            return { response: { status: 'error', error: `The active run is ${lease.kind}.` } };
        }

        scrapeStopPending = true;
        markScrapeCompletionTransitionRevoked(lease);
        const tombstone = await persistScrapeLease(createIdleScrapeLease(lease.epoch + 1));
        abortScrapeTransferControllers(lease);
        scrapeStartPending = false;
        isScraping = false;
        isR2Backup = false;
        const stored = await chrome.storage.local.get(['r2BackupState', 'scrapeNavigation']);
        const stopNavigation = stored.scrapeNavigation || null;
        await chrome.storage.local.set(buildAuthoritativeIdleLocalState(stored, stopReason));
        await revokeScrapeDownloadAuthority(lease);
        return { lease, tombstone, stopNavigation };
    });

    if (prepared.response) return prepared.response;
    const { lease, tombstone, stopNavigation } = prepared;
    try {
        const [abortAcknowledged] = await Promise.all([
            lease.status === 'active' ? sendScrapeAbort(lease, stopNavigation) : false,
            waitForScrapeTransferTasks(lease)
        ]);
        return await enqueueScrapeLeaseOperation(async () => {
            scrapeStopPending = false;
            if (activeScrapeLease?.status !== 'idle' || activeScrapeLease.epoch !== tombstone.epoch) {
                return { status: 'stopped', abortAcknowledged };
            }
            return { status: 'stopped', abortAcknowledged };
        });
    } catch (error) {
        await enqueueScrapeLeaseOperation(async () => {
            scrapeStopPending = false;
        }).catch(() => {});
        throw error;
    }
}

async function handleR2BackupProgress(request, sender) {
    return enqueueScrapeLeaseOperation(async () => {
        const requested = getRunScopedScrapeLease(request, sender?.tab?.id ?? null, 'r2_backup');
        if (!scrapeLeaseMatches(activeScrapeLease, requested)) return { status: 'ignored' };
        chrome.runtime.sendMessage({
            action: 'UPDATE_R2_BACKUP_PROGRESS',
            stats: request.stats
        }).catch(() => {});
        return { status: 'ok' };
    });
}

async function completeScrapeRun(request, sender, kind) {
    return enqueueScrapeLeaseOperation(async () => {
        const requested = getRunScopedScrapeLease(request, sender?.tab?.id ?? null, kind);
        if (!scrapeLeaseMatches(activeScrapeLease, requested)) return { status: 'ignored' };
        const lease = { ...activeScrapeLease };
        const stored = await chrome.storage.local.get(['r2BackupState']);
        if (!scrapeLeaseMatches(activeScrapeLease, lease)) return { status: 'ignored' };
        const completionTransfer = await prepareScrapeCompletionTransfer(lease);
        if (!scrapeLeaseMatches(activeScrapeLease, lease)) return { status: 'ignored' };
        await persistScrapeLease(createIdleScrapeLease(lease.epoch + 1));
        scrapeStartPending = false;
        isScraping = false;
        isR2Backup = false;
        await chrome.storage.local.set(buildAuthoritativeIdleLocalState(stored, request.stats?.stopReason || 'complete'));
        await commitScrapeCompletionTransfer(completionTransfer);

        if (kind === 'r2_backup') {
            const stats = request.stats || {};
            const completed = isR2BackupCompletionSuccessful(stats);
            const statusLabel = getR2BackupCompletionStatusLabel(stats);
            log(`R2 Backup ${statusLabel}. Uploaded: ${stats.uploaded || 0}, Already present: ${stats.alreadyPresent || 0}, Queued: ${stats.queued || 0}, Errors: ${stats.errors || 0}`, completed ? 'success' : 'warning');
            chrome.runtime.sendMessage({ action: 'R2_BACKUP_DONE', stats }).catch(() => {});
        } else {
            chrome.runtime.sendMessage({ action: 'SCRAPE_COMPLETE' }).catch(() => {});
        }
        return { status: 'ok' };
    });
}

async function uploadDirectMediaData(request, finalPath, acceptanceSource = 'direct-upload', assertAuthorized = null) {
    const config = await getCloudConfig();
    if (assertAuthorized) await assertAuthorized();
    if (!CloudSync.isCloudEnabled(config)) {
        return { status: 'not_queued', error: 'Cloud sync is not enabled.' };
    }

    const response = await fetchWithScrapeAuthority(request.blobDataUrl, {}, assertAuthorized);
    if (assertAuthorized) await assertAuthorized();
    const blob = await response.blob();
    if (assertAuthorized) await assertAuthorized();
    const contentType = blob.type || (request.isVideo ? 'video/mp4' : 'image/png');
    const userInfo = await chrome.storage.local.get(['activeGrokUserId']);
    if (assertAuthorized) await assertAuthorized();
    const activeUserId = userInfo.activeGrokUserId || 'Shared_Account';
    const acceptance = request.acceptance || buildAcceptanceContextFromCloudConfig(config, acceptanceSource);
    if (assertAuthorized) await assertAuthorized();
    const result = await uploadBlobWithR2Dedupe(config, {
        sourceUrl: request.url,
        finalPath,
        userId: activeUserId,
        contentType,
        promptText: request.promptText || '',
        acceptance
    }, blob, assertAuthorized);
    if (assertAuthorized) await assertAuthorized();

    return buildDirectBackupUploadResponse(result, request.url);
}

// Handle messages
function handleRuntimeMessage(request, sender, sendResponse) {
    if (request.action === 'PROCESSED_IDS_ADD') {
        mutateProcessedIds({ ids: request.ids }).then((processedIds) => {
            sendResponse({ status: 'ok', processedIds });
        }).catch(() => {
            sendResponse({ status: 'error', error: 'processed_ids_mutation_failed' });
        });
        return true;
    }

    if (request.action === 'PROCESSED_IDS_RESET') {
        mutateProcessedIds({ reset: true }).then((processedIds) => {
            sendResponse({ status: 'ok', processedIds });
        }).catch(() => {
            sendResponse({ status: 'error', error: 'processed_ids_mutation_failed' });
        });
        return true;
    }

    if (request.action === 'SCRAPE_RUN_STATE_WRITE') {
        commitScrapeRunState(request, sender).then(sendResponse).catch(() => {
            sendResponse({ status: 'ignored', reason: 'stale_authority' });
        });
        return true;
    }

    if (request.action === 'SCRAPE_PROCESSED_IDS_ADD') {
        (async () => {
            const lease = await getAuthorizedScrapeTransferLease(request, sender);
            if (!lease) return { status: 'ignored', reason: 'stale_authority' };
            return trackScrapeTransferTask(lease, async (signal) => {
                const assertAuthorized = createScrapeTransferAuthorityGuard(lease, signal);
                await assertAuthorized();
                const processedIds = await mutateProcessedIds(
                    { ids: request.ids },
                    assertAuthorized
                );
                await assertAuthorized();
                return { status: 'ok', processedIds };
            });
        })().then(sendResponse).catch((error) => {
            if (isScrapeAuthorityRevokedError(error)) {
                sendResponse({ status: 'ignored', reason: 'stale_authority' });
                return;
            }
            sendResponse({ status: 'error', error: 'processed_ids_mutation_failed' });
        });
        return true;
    }

    if (request.action === 'START_SCRAPE') {
        log('Background: Received START_SCRAPE.');
        initializeScrapeInActiveTab(
            { action: 'INIT_SCRAPE' },
            { sourceTab: sender?.tab || null }
        ).then(sendResponse);
        return true;
    }

    if (request.action === 'STOP_SCRAPE') {
        stopScrapeRun('sync').then(sendResponse).catch((error) => {
            sendResponse({ status: 'error', error: error.message || 'Failed to stop sync.' });
        });
        return true;
    }

    if (request.action === 'START_R2_BACKUP') {
        initializeScrapeInActiveTab(async () => {
            const config = await getCloudConfig();
            const initMessage = buildR2BackupInitMessageForConfig(request, config);
            log(initMessage.mode === 'canary' ? 'Starting R2 Canary Backup...' : 'Starting Full R2 Media Backup...');
            return initMessage;
        }, { backup: true, sourceTab: sender?.tab || null }).then(sendResponse).catch((e) => {
            sendResponse({ status: 'error', error: e.message });
        });
        return true;
    }

    if (request.action === 'STOP_R2_BACKUP') {
        stopScrapeRun('r2_backup').then(sendResponse).catch((error) => {
            sendResponse({ status: 'error', error: error.message || 'Failed to stop backup.' });
        });
        return true;
    }

    if (request.action === 'R2_BACKUP_UPLOAD') {
        (async () => {
            const lease = await getAuthorizedScrapeTransferLease(request, sender);
            if (!lease) return { status: 'ignored', reason: 'stale_authority' };
            return trackScrapeTransferTask(lease, async (signal) => {
            const assertAuthorized = createScrapeTransferAuthorityGuard(lease, signal);
            await assertAuthorized();
            const extHint = request.isVideo ? 'mp4' : null;
            const finalPath = await generateFilenameForBackup(request.url, extHint);
            await assertAuthorized();

            // If content script provided blob data (fetched with cookies), upload directly
            if (request.blobDataUrl) {
                try {
                    const response = await uploadDirectMediaData(
                        request,
                        finalPath,
                        'direct-upload',
                        assertAuthorized
                    );
                    await assertAuthorized();
                    return response;
                } catch (e) {
                    if (isScrapeAuthorityRevokedError(e)) throw e;
                    console.error('[CloudQueue]', formatRedactedMediaLog(
                        'direct_upload_failed',
                        request.url,
                        { stage: getUploadFailureStage(e) }
                    ));
                    return {
                        status: 'error',
                        error: formatRedactedMediaError(e, request.url, 'direct_upload_failed')
                    };
                }
            }

            // No blob data — fall back to service worker fetch (works for public URLs)
            const queued = await enqueueCloudMediaUpload(
                request.url,
                finalPath,
                request.promptText,
                request.acceptance || null,
                {
                    scrapeLease: lease,
                    assertAuthorized
                }
            );
            await assertAuthorized();

            if (!request.skipLocalDownload) {
                const config = await getCloudConfig();
                await assertAuthorized();
                if (CloudSync.isLocalDownloadEnabled(config)) {
                    await queueChromeDownload(
                        { url: request.url, filename: finalPath, conflictAction: 'overwrite' },
                        lease
                    );
                    await assertAuthorized();
                }
            }
            if (queued) {
                return { status: 'queued' };
            } else {
                isScraping = false;
                isR2Backup = false;
                return { status: 'not_queued', error: 'Cloud sync is not enabled. Check Cloud R2 Settings.' };
            }
            });
        })().catch((e) => {
            if (isScrapeAuthorityRevokedError(e)) {
                sendResponse({ status: 'ignored', reason: 'stale_authority' });
                return;
            }
            sendResponse({
                status: 'error',
                error: formatRedactedMediaError(e, request.url, 'backup_upload_failed')
            });
        }).then((response) => {
            if (response) sendResponse(response);
        });
        return true;
    }

    if (request.action === 'R2_BACKUP_PROGRESS') {
        handleR2BackupProgress(request, sender).then(sendResponse).catch(() => {
            sendResponse({ status: 'ignored' });
        });
        return true;
    }

    if (request.action === 'R2_BACKUP_COMPLETE') {
        completeScrapeRun(request, sender, 'r2_backup').then(sendResponse).catch(() => {
            sendResponse({ status: 'ignored' });
        });
        return true;
    }

    if (request.action === 'SCRAPE_COMPLETE') {
        completeScrapeRun(request, sender, 'sync').then(sendResponse).catch(() => {
            sendResponse({ status: 'ignored' });
        });
        return true;
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

    if (request.action === 'VALIDATE_SCRAPE_RESUME') {
        validateScrapeResume(request, sender?.tab?.id ?? null).then(sendResponse).catch(() => {
            sendResponse({ valid: false, reason: 'stale_authority' });
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
            const lease = await getAuthorizedScrapeTransferLease(request, sender);
            if (!lease) return { status: 'ignored', reason: 'stale_authority' };
            return trackScrapeTransferTask(lease, async (signal) => {
            const assertAuthorized = createScrapeTransferAuthorityGuard(lease, signal);
            const config = await getCloudConfig();
            await assertAuthorized();
            const allowLocalDownload = CloudSync.isLocalDownloadEnabled(config);

            if (allowLocalDownload) {
                // This triggers onDeterminingFilename.
                await assertAuthorized();
                await queueChromeDownload({ url: request.url, conflictAction: 'overwrite' }, lease);
                await assertAuthorized();
                return { status: 'queued' };
            }

            if (!request.blobDataUrl) {
                return { status: 'error', error: 'Authenticated media data is required in Cloud only mode.' };
            }

            const extHint = request.isVideo ? 'mp4' : null;
            const finalPath = await generateFilenameForBackup(request.url, extHint);
            await assertAuthorized();
            const response = await uploadDirectMediaData(
                request,
                finalPath,
                'direct-sync',
                assertAuthorized
            );
            await assertAuthorized();
            return response;
            });
        })().catch((e) => {
            if (isScrapeAuthorityRevokedError(e)) {
                sendResponse({ status: 'ignored', reason: 'stale_authority' });
                return;
            }
            sendResponse({
                status: 'error',
                error: formatRedactedMediaError(e, request.url, 'download_media_failed')
            });
        }).then((response) => {
            if (response) sendResponse(response);
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

    if (request.action === 'FETCH_GPT_RECREATE_REFERENCE_DATA_URL') {
        (async () => {
            try {
                const result = await fetchRecreateReferenceDataUrl(request.url);
                sendResponse({ ok: true, ...result });
            } catch (e) {
                sendResponse({ ok: false, error: e.message || 'reference_capture_failed' });
            }
        })();
        return true;
    }

    if (request.action === 'GPT_RECREATE_NATIVE_CLICK'
        || request.action === 'GPT_PROMPTED_VIDEO_NATIVE_CLICK') {
        (async () => {
            try {
                const tabId = sender && sender.tab ? sender.tab.id : null;
                const result = await dispatchNativeClick(tabId, request.click || {});
                sendResponse(result);
            } catch (e) {
                sendResponse({ ok: false, error: e.message || 'native_click_unavailable' });
            }
        })();
        return true;
    }

    if (request.action === 'START_GPT_RECREATE') {
        if (!recreateWorkflowController) {
            sendResponse({ ok: false, error: 'workflow_unavailable' });
            return false;
        }

        (async () => {
            const sourceTab = sender && sender.tab ? sender.tab : {};
            const response = await recreateWorkflowController.start(request, {
                sourceTabId: sourceTab.id,
                sourceTabUrl: sourceTab.url
            });
            sendResponse(response);
        })();
        return true;
    }

    if (request.action === 'ABORT_GPT_RECREATE') {
        if (!recreateWorkflowController) {
            sendResponse({ ok: false, error: 'workflow_unavailable' });
            return false;
        }

        sendResponse(recreateWorkflowController.abort('user'));
        return false;
    }

    return false;
}

const BACKGROUND_READY_MESSAGE_ACTIONS = new Set([
    'PROCESSED_IDS_ADD',
    'PROCESSED_IDS_RESET',
    'SCRAPE_RUN_STATE_WRITE',
    'SCRAPE_PROCESSED_IDS_ADD',
    'START_SCRAPE',
    'STOP_SCRAPE',
    'START_R2_BACKUP',
    'STOP_R2_BACKUP',
    'R2_BACKUP_UPLOAD',
    'R2_BACKUP_PROGRESS',
    'R2_BACKUP_COMPLETE',
    'SCRAPE_COMPLETE',
    'DOWNLOAD_MEDIA',
    'CLOUD_TEST_CONNECTION',
    'CLOUD_RETRY_UNSYNCED',
    'CLOUD_RUN_BACKFILL',
    'CLOUD_CLEAR_STATUS'
]);

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (!BACKGROUND_READY_MESSAGE_ACTIONS.has(request?.action)) {
        return handleRuntimeMessage(request, sender, sendResponse);
    }
    ensureBackgroundStateReady().then(() => {
        handleRuntimeMessage(request, sender, sendResponse);
    }).catch((error) => {
        sendResponse({ status: 'error', error: error.message || 'background_initialization_failed' });
    });
    return true;
});

async function getActiveLeaseForTabEvent(tabId, tab = {}) {
    return enqueueScrapeLeaseOperation(async () => {
        const lease = activeScrapeLease;
        if (lease?.status !== 'active') return null;
        if (tabId !== lease.tabId && tab?.openerTabId !== lease.tabId) return null;
        const stored = await chrome.storage.local.get([
            'scraperState',
            'scrapeRunToken',
            'scrapeRunEpoch',
            'isScraping',
            'isR2Backup'
        ]);
        return localRunMatchesLease(stored, lease) ? { ...lease } : null;
    });
}

// --- NEW TAB INTERCEPTOR ---
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    await ensureBackgroundStateReady();
    const lease = await getActiveLeaseForTabEvent(tabId, tab);
    if (!lease) return;

    if (changeInfo.url) {
        const url = changeInfo.url;
        if (url.includes('imagine-public.x.ai') || url.match(/\.(png|jpg|jpeg|mp4|webp)(\?|$)/i)) {
            return trackScrapeTransferTask(lease, async (signal) => {
                const assertAuthorized = createScrapeTransferAuthorityGuard(lease, signal);
                try {
                    console.log('Background:', formatRedactedMediaLog('media_tab_intercepted', url));

                    const finalPath = await generateFilename(url);
                    await assertAuthorized();

                    if (finalPath) {
                        const config = await getCloudConfig();
                        await assertAuthorized();
                        const allowLocalDownload = CloudSync.isLocalDownloadEnabled(config);

                        if (allowLocalDownload) {
                            await assertAuthorized();
                            await queueChromeDownload({
                                url,
                                filename: finalPath,
                                conflictAction: 'overwrite'
                            }, lease);
                            await assertAuthorized();
                        } else {
                            console.log('Cloud-only mode active: local download skipped.');
                        }

                        await enqueueCloudMediaUpload(url, finalPath, '', null, {
                            scrapeLease: lease,
                            assertAuthorized
                        });
                        await assertAuthorized();
                        chrome.tabs.remove(tabId);
                    } else {
                        await assertAuthorized();
                        console.log('Download skipped (Duplicate). Closing tab.');
                        chrome.tabs.remove(tabId);
                    }
                } catch (error) {
                    if (isScrapeAuthorityRevokedError(error)) return;
                    updateCloudError(formatRedactedMediaError(error, url, 'tab_queue_failed'));
                    await persistCloudState().catch(() => {});
                }
            });
        }
    }
});

chrome.tabs.onRemoved.addListener((tabId) => {
    ensureBackgroundStateReady().then(() => getActiveLeaseForTabEvent(tabId)).then((lease) => {
        if (!lease || lease.tabId !== tabId) return;
        return stopScrapeRun(lease.kind, 'owner_tab_closed');
    }).catch(() => {});
});

function deserializeDownloadOperations(value) {
    const records = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const operations = new Map();
    for (const [key, record] of Object.entries(records)) {
        const downloadId = Number(record?.downloadId ?? key);
        if (!Number.isInteger(downloadId) || !record || typeof record !== 'object') continue;
        const operation = { ...record, downloadId };
        if (operation.lastError && !isRedactedMediaError(operation.lastError)) {
            operation.lastError = formatRedactedMediaError(
                new Error(operation.lastError),
                operation.mediaId,
                'download_operation_failed'
            );
        }
        operations.set(downloadId, operation);
    }
    return operations;
}

function serializeDownloadOperations(operations) {
    return Array.from(operations.entries()).reduce((records, [downloadId, operation]) => {
        records[String(downloadId)] = { ...operation, downloadId };
        return records;
    }, {});
}

function mutatePendingDownloadOperations(mutator) {
    const execute = async () => {
        const revision = ++pendingDownloadOperationsRevision;
        const operations = deserializeDownloadOperations(serializeDownloadOperations(pendingDownloadOperations));
        const result = await mutator(operations);
        pendingDownloadOperations = operations;
        const write = chrome.storage.local.set({
            [PENDING_DOWNLOAD_OPERATIONS_KEY]: serializeDownloadOperations(operations)
        });
        const persisted = await withTimeout(
            Promise.resolve(write).then(() => true),
            PENDING_DOWNLOAD_MUTATION_TIMEOUT_MS,
            false
        );
        if (!persisted) {
            Promise.resolve(write).then(() => {
                if (revision === pendingDownloadOperationsRevision) return;
                return chrome.storage.local.set({
                    [PENDING_DOWNLOAD_OPERATIONS_KEY]: serializeDownloadOperations(pendingDownloadOperations)
                });
            }).catch(() => {});
            throw new Error('pending_download_operations_persist_timeout');
        }
        return result;
    };
    const mutation = pendingDownloadOperationsMutationQueue.then(execute, execute);
    pendingDownloadOperationsMutationQueue = mutation.catch(() => {});
    return mutation;
}

function hydrateDownloadOperations() {
    return pendingDownloadOperationsMutationQueue.then(() => pendingDownloadOperations);
}

async function getDownloadOperation(downloadId) {
    await hydrateDownloadOperations();
    const operation = pendingDownloadOperations.get(downloadId);
    return operation ? { ...operation } : null;
}

function reserveDownloadOperation(operation) {
    return mutatePendingDownloadOperations((operations) => {
        if (operation.mediaId && processedUUIDs.has(operation.mediaId)) return false;
        if (operation.reservationKey) {
            const duplicate = Array.from(operations.values()).some((existing) => (
                existing.reservationKey === operation.reservationKey
                && existing.downloadId !== operation.downloadId
            ));
            if (duplicate) return false;
        }
        operations.set(operation.downloadId, {
            ...operation,
            operationRevision: ++pendingDownloadOperationRevision
        });
        return true;
    });
}

function updateDownloadOperation(downloadId, update) {
    return mutatePendingDownloadOperations((operations) => {
        const existing = operations.get(downloadId);
        if (!existing) return null;
        const next = typeof update === 'function' ? update({ ...existing }) : { ...existing, ...update };
        next.operationRevision = Number.isInteger(next.operationRevision)
            ? next.operationRevision
            : (existing.operationRevision || 0);
        pendingDownloadOperationRevision = Math.max(
            pendingDownloadOperationRevision,
            next.operationRevision
        );
        operations.set(downloadId, next);
        return { ...next };
    });
}

function updateDownloadOperationRevision(downloadId, operationRevision, update) {
    return mutatePendingDownloadOperations((operations) => {
        const existing = operations.get(downloadId);
        if (!existing || (existing.operationRevision || 0) !== operationRevision) return null;
        const next = typeof update === 'function' ? update({ ...existing }) : { ...existing, ...update };
        next.operationRevision = existing.operationRevision || 0;
        operations.set(downloadId, next);
        return { ...next };
    });
}

function detachDownloadOperationScrapeLease(downloadId) {
    return updateDownloadOperation(downloadId, (existing) => {
        if (!existing.scrapeLease) return existing;
        const { scrapeLease: _scrapeLease, ...detached } = existing;
        return {
            ...detached,
            operationRevision: ++pendingDownloadOperationRevision
        };
    });
}

function removeDownloadOperationRevision(downloadId, operationRevision, lease) {
    return mutatePendingDownloadOperations((operations) => {
        const existing = operations.get(downloadId);
        if (!existing || (existing.operationRevision || 0) !== operationRevision) return null;
        if (lease && !scrapeLeaseMatches(getDownloadOperationScrapeLease(existing), lease)) return null;
        operations.delete(downloadId);
        return { ...existing };
    });
}

function makeScrapeCompletionTxn(lease) {
    return {
        id: `scrape_completion_${lease.epoch}_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
        phase: 'prepared',
        lease: copyScrapeLeaseAuthority(lease),
        createdAt: Date.now()
    };
}

function buildCompletionRetrySnapshots(lease, txn) {
    const queue = cloneCloudQueue().map((item) => {
        if (!scrapeLeaseMatches(item.scrapeLease, lease)) return item;
        const { scrapeLease: _scrapeLease, ...detached } = item;
        return {
            ...detached,
            completionTxnId: txn.id,
            revocationLease: copyScrapeLeaseAuthority(lease),
            queueRevision: ++cloudQueueRevision,
            updatedAt: Date.now()
        };
    });
    const operations = deserializeDownloadOperations(serializeDownloadOperations(pendingDownloadOperations));
    for (const [downloadId, operation] of operations) {
        if (!scrapeLeaseMatches(getDownloadOperationScrapeLease(operation), lease)) continue;
        const { scrapeLease: _scrapeLease, ...detached } = operation;
        operations.set(downloadId, {
            ...detached,
            completionTxnId: txn.id,
            revocationLease: copyScrapeLeaseAuthority(lease),
            operationRevision: ++pendingDownloadOperationRevision
        });
    }
    return { queue, operations };
}

function buildCompletionRetryStorageValues(queue, operations, txn) {
    return {
        [CloudSync.STORAGE_KEYS.cloudSyncQueue]: cloneCloudQueue(queue),
        [CloudSync.STORAGE_KEYS.cloudSyncState]: {
            ...cloudSyncState,
            unsyncedCount: queue.length,
            processing: false
        },
        [PENDING_DOWNLOAD_OPERATIONS_KEY]: serializeDownloadOperations(operations),
        [SCRAPE_COMPLETION_TXN_KEY]: txn
    };
}

function applyCompletionRetrySnapshots(queue, operations, txn) {
    cloudSyncQueue = cloneCloudQueue(queue);
    pendingDownloadOperations = deserializeDownloadOperations(serializeDownloadOperations(operations));
    cloudSyncState = {
        ...cloudSyncState,
        unsyncedCount: cloudSyncQueue.length,
        processing: false
    };
    scrapeCompletionTxn = txn ? { ...txn } : null;
}

async function recoverPreparedScrapeCompletionTransfer() {
    const txn = scrapeCompletionTxn;
    if (txn?.phase !== 'prepared') return false;
    if (scrapeCompletionTransition && scrapeCompletionTransition.status !== 'committed') return false;

    const lease = normalizeScrapeLease(txn.lease);
    if (!lease) {
        const queue = cloneCloudQueue().filter((item) => item?.completionTxnId !== txn.id);
        const operations = deserializeDownloadOperations(serializeDownloadOperations(pendingDownloadOperations));
        for (const [downloadId, operation] of operations) {
            if (operation?.completionTxnId === txn.id) operations.delete(downloadId);
        }
        await chrome.storage.local.set(buildCompletionRetryStorageValues(queue, operations, null));
        applyCompletionRetrySnapshots(queue, operations, null);
        return false;
    }

    await ensureScrapeLeaseHydrated();
    const stored = await chrome.storage.local.get(['r2BackupState', 'scrapeStopReason']);
    const stopReason = stored.scrapeStopReason || stored.r2BackupState?.stopReason || null;
    if (stopReason === 'stopped' || stopReason === 'owner_tab_closed') {
        await revokeScrapeRetryAuthorityAtomically(lease);
        return false;
    }
    if (activeScrapeLease?.status === 'active' && !scrapeLeaseMatches(activeScrapeLease, lease)) {
        await revokeScrapeRetryAuthorityAtomically(lease);
        return false;
    }

    if (scrapeLeaseMatches(activeScrapeLease, lease)) {
        await persistScrapeLease(createIdleScrapeLease(lease.epoch + 1));
        scrapeStartPending = false;
        isScraping = false;
        isR2Backup = false;
        await chrome.storage.local.set(buildAuthoritativeIdleLocalState(
            stored,
            stored.scrapeStopReason || 'recovered_complete'
        ));
    }

    const committedTxn = {
        ...txn,
        phase: 'committed',
        committedAt: Date.now(),
        recoveredAt: Date.now()
    };
    const queue = cloneCloudQueue();
    const operations = deserializeDownloadOperations(serializeDownloadOperations(pendingDownloadOperations));
    await chrome.storage.local.set(buildCompletionRetryStorageValues(queue, operations, committedTxn));
    applyCompletionRetrySnapshots(queue, operations, committedTxn);
    return true;
}

async function persistCompletionRetrySnapshots(queue, operations, txn, transition, stage) {
    const write = chrome.storage.local.set(buildCompletionRetryStorageValues(queue, operations, txn));
    transition.pendingWritePromise = Promise.resolve(write);
    transition.status = stage;
    let persisted;
    try {
        persisted = await withTimeout(
            transition.pendingWritePromise.then(() => true),
            CLOUD_QUEUE_MUTATION_TIMEOUT_MS,
            false
        );
    } catch (error) {
        if (scrapeCompletionTransition === transition) scrapeCompletionTransition = null;
        throw error;
    }
    if (!persisted) {
        transition.status = `${stage}_timed_out`;
        transition.pendingWritePromise.then(async () => {
            transition.persisted = true;
            if (transition.revoked) {
                await revokeScrapeRetryAuthorityAtomically(transition.txn.lease);
                if (scrapeCompletionTransition === transition) scrapeCompletionTransition = null;
                return;
            }
            applyCompletionRetrySnapshots(queue, operations, txn);
            if (txn.phase === 'committed') {
                transition.status = 'committed';
                if (scrapeCompletionTransition === transition) scrapeCompletionTransition = null;
            }
        }).catch(() => {
            if (scrapeCompletionTransition === transition) scrapeCompletionTransition = null;
        });
        throw new Error('scrape_completion_transfer_persist_timeout');
    }
    transition.persisted = true;
    transition.pendingWritePromise = null;
    applyCompletionRetrySnapshots(queue, operations, txn);
}

async function prepareScrapeCompletionTransfer(lease) {
    if (hasBlockedScrapeCompletionTransfer()) {
        throw new Error('scrape_completion_transfer_in_progress');
    }
    const txn = makeScrapeCompletionTxn(lease);
    const transition = {
        txn,
        status: 'preparing',
        persisted: false,
        revoked: false,
        pendingWritePromise: null
    };
    scrapeCompletionTransition = transition;
    try {
        const activeDrain = cloudQueueDrainPromise;
        if (activeDrain) await activeDrain;
        await Promise.all([cloudQueueMutationQueue, pendingDownloadOperationsMutationQueue]);
        const snapshots = buildCompletionRetrySnapshots(lease, txn);
        await persistCompletionRetrySnapshots(
            snapshots.queue,
            snapshots.operations,
            txn,
            transition,
            'preparing'
        );
        transition.status = 'prepared';
        return { txn, transition, ...snapshots };
    } catch (error) {
        if (!/_timed_out$/.test(transition.status) && scrapeCompletionTransition === transition) {
            scrapeCompletionTransition = null;
        }
        throw error;
    }
}

async function commitScrapeCompletionTransfer(prepared) {
    const committedTxn = {
        ...prepared.txn,
        phase: 'committed',
        committedAt: Date.now()
    };
    await persistCompletionRetrySnapshots(
        prepared.queue,
        prepared.operations,
        committedTxn,
        prepared.transition,
        'committing'
    );
    prepared.transition.status = 'committed';
    if (scrapeCompletionTransition === prepared.transition) scrapeCompletionTransition = null;
}

function markScrapeCompletionTransitionRevoked(lease) {
    if (scrapeCompletionTransition
        && completionTxnMatchesLease(scrapeCompletionTransition.txn, lease)) {
        scrapeCompletionTransition.revoked = true;
    }
}

async function revokeScrapeRetryAuthorityAtomically(lease) {
    const queue = cloneCloudQueue().filter((item) => !recordOwnedByScrapeLease(item, lease));
    const operations = deserializeDownloadOperations(serializeDownloadOperations(pendingDownloadOperations));
    for (const [downloadId, operation] of operations) {
        if (recordOwnedByScrapeLease(operation, lease)) operations.delete(downloadId);
    }
    const nextTxn = completionTxnMatchesLease(scrapeCompletionTxn, lease) ? null : scrapeCompletionTxn;
    cloudStatePersistenceRevision += 1;
    pendingDownloadOperationsRevision += 1;
    applyCompletionRetrySnapshots(queue, operations, nextTxn);
    const write = Promise.resolve(chrome.storage.local.set(
        buildCompletionRetryStorageValues(queue, operations, nextTxn)
    ));
    const persisted = await withTimeout(
        write.then(() => true).catch(() => false),
        Math.max(CLOUD_QUEUE_MUTATION_TIMEOUT_MS, PENDING_DOWNLOAD_MUTATION_TIMEOUT_MS),
        false
    );
    if (!persisted) {
        write.finally(() => chrome.storage.local.set(buildCompletionRetryStorageValues(
            cloudSyncQueue,
            pendingDownloadOperations,
            scrapeCompletionTxn
        )).catch(() => {})).catch(() => {});
    }
}

async function settleRevokedScrapeCompletionTransition(lease) {
    const transition = scrapeCompletionTransition;
    if (!transition || !completionTxnMatchesLease(transition.txn, lease)) return true;
    transition.revoked = true;
    if (!transition.pendingWritePromise) return true;
    const timeout = Symbol('scrape_completion_stop_timeout');
    const result = await withTimeout(
        transition.pendingWritePromise.then(() => true).catch(() => false),
        SCRAPE_TRANSFER_DRAIN_TIMEOUT_MS,
        timeout
    );
    if (result === timeout) return false;
    transition.pendingWritePromise = null;
    return true;
}

function removeDownloadOperation(downloadId) {
    return mutatePendingDownloadOperations((operations) => {
        const existing = operations.get(downloadId) || null;
        operations.delete(downloadId);
        return existing ? { ...existing } : null;
    });
}

function cancelDownload(downloadId) {
    try {
        chrome.downloads.cancel(downloadId);
    } catch {
        // The download may already have stopped.
    }
}

function isMissingDownloadArtifactError(error) {
    return /(?:not found|does not exist|doesn't exist|no such file|invalid download|already (?:deleted|removed|erased))/i
        .test(String(error?.message || error || ''));
}

function runDownloadMutation(invoke, errorCode, { allowMissing = false } = {}) {
    return new Promise((resolve, reject) => {
        let settled = false;
        const fail = (error) => {
            if (settled) return;
            settled = true;
            if (allowMissing && isMissingDownloadArtifactError(error)) resolve();
            else reject(new Error(errorCode));
        };
        const finish = (value) => {
            if (settled) return;
            const error = chrome.runtime.lastError;
            if (error) {
                fail(error);
                return;
            }
            settled = true;
            resolve(value);
        };
        try {
            const result = invoke(finish);
            if (result && typeof result.then === 'function') result.then(finish, fail);
        } catch (error) {
            fail(error);
        }
    });
}

async function removeDownloadedFile(downloadId) {
    await runDownloadMutation(
        (callback) => chrome.downloads.removeFile(downloadId, callback),
        'download_cleanup_failed',
        { allowMissing: true }
    );
    await runDownloadMutation(
        (callback) => chrome.downloads.erase({ id: downloadId }, callback),
        'download_history_cleanup_failed',
        { allowMissing: true }
    );
}

function getDownloadOperationAuthorityGuard(operation) {
    const lease = getDownloadOperationScrapeLease(operation);
    return lease ? () => assertScrapeTransferAuthorized(lease) : null;
}

async function finalizeDownloadOperation(downloadId, { historyMissing = false, assertAuthorized = null } = {}) {
    if (assertAuthorized) await assertAuthorized();
    const operation = await getDownloadOperation(downloadId);
    if (!operation || operation.downloadState !== 'complete') return false;
    if (operation.cloudRequired && operation.r2State !== 'present') return false;
    const authorityGuard = assertAuthorized || getDownloadOperationAuthorityGuard(operation);
    if (authorityGuard) await authorityGuard();

    if (operation.mediaId && (!operation.allowLocal || !operation.localIdentityPersisted)) {
        await mutateProcessedIds({ ids: [operation.mediaId] }, authorityGuard);
    }
    if (!operation.allowLocal) {
        if (authorityGuard) await authorityGuard();
        if (!historyMissing) {
            try {
                await removeDownloadedFile(downloadId);
                if (authorityGuard) await authorityGuard();
            } catch (error) {
                if (isScrapeAuthorityRevokedError(error)) throw error;
                await recordDownloadOperationError(downloadId, error, 'download_cleanup_failed');
                return false;
            }
            console.log('[CloudQueue]', formatRedactedMediaLog('local_file_deleted', operation.mediaId));
        }
    }
    if (authorityGuard) await authorityGuard();
    await removeDownloadOperation(downloadId);
    return true;
}

async function markDownloadOperationR2Present(downloadId, result, assertAuthorized = null) {
    if (assertAuthorized) await assertAuthorized();
    const operation = await updateDownloadOperation(downloadId, (existing) => ({
        ...existing,
        r2State: 'present',
        r2Status: result.status,
        attempts: 0,
        lastError: null
    }));
    if (!operation) return false;
    const authorityGuard = assertAuthorized || getDownloadOperationAuthorityGuard(operation);
    if (authorityGuard) await authorityGuard();

    if (operation.downloadState === 'complete') {
        await finalizeDownloadOperation(downloadId, { assertAuthorized: authorityGuard });
    }
    return true;
}

async function recordDownloadOperationError(downloadId, error, code) {
    const operation = await getDownloadOperation(downloadId);
    if (!operation) return null;
    const lastError = formatRedactedMediaError(error, operation.mediaId, code);
    await updateDownloadOperation(downloadId, (existing) => ({
        ...existing,
        attempts: (existing.attempts || 0) + 1,
        lastAttemptAt: Date.now(),
        lastError
    }));
    updateCloudError(lastError);
    await persistCloudState().catch(() => {});
    await scheduleCloudRetryAlarm().catch(() => {});
    return lastError;
}

function findPublicQueueItemForOperation(operation) {
    const directlyLinked = cloudSyncQueue.find((item) => (
        item.type === 'media'
        && item.cleanupDownloadId === operation.downloadId
    ));
    if (directlyLinked) return directlyLinked;

    return cloudSyncQueue.find((item) => {
        if (item.type !== 'media' || Number.isInteger(item.cleanupDownloadId)) return false;
        if (!item.finalPath || item.finalPath !== operation.finalPath) return false;
        return (operation.mediaId && item.backupProcessedId === operation.mediaId)
            || (operation.reservationKey && (
                item.assetId === operation.reservationKey
                || item.sourceUrlHash === operation.reservationKey
            ));
    }) || null;
}

async function linkPublicQueueOperation(operation) {
    const queueItem = findPublicQueueItemForOperation(operation);
    if (!queueItem) return null;

    if (queueItem.cleanupDownloadId !== operation.downloadId) {
        queueItem.cleanupDownloadId = operation.downloadId;
        await persistCloudState();
    }
    if (operation.cleanupDownloadId !== operation.downloadId) {
        await updateDownloadOperation(operation.downloadId, {
            cleanupDownloadId: operation.downloadId
        });
    }
    return queueItem;
}

async function ensurePublicDownloadQueued(operation, downloadItem, assertAuthorized = null) {
    if (!operation?.cloudRequired || operation.strategy !== 'public_queue') return;
    if (activeDownloadOperations.has(operation.downloadId)) return;
    const authorityGuard = assertAuthorized || getDownloadOperationAuthorityGuard(operation);
    if (authorityGuard) await authorityGuard();
    if (await linkPublicQueueOperation(operation)) return;
    if (authorityGuard) await authorityGuard();
    const sourceUrl = downloadItem?.finalUrl || downloadItem?.url;
    if (!sourceUrl) {
        await recordDownloadOperationError(
            operation.downloadId,
            new Error('[download-search] source unavailable'),
            'public_source_missing'
        );
        return;
    }

    activeDownloadOperations.add(operation.downloadId);
    try {
        if (operation.cleanupDownloadId !== operation.downloadId) {
            await updateDownloadOperation(operation.downloadId, {
                cleanupDownloadId: operation.downloadId
            });
        }
        await enqueueCloudMediaUpload(sourceUrl, operation.finalPath, '', null, {
            cleanupDownloadId: operation.downloadId,
            scrapeLease: getDownloadOperationScrapeLease(operation),
            assertAuthorized: authorityGuard
        });
        if (authorityGuard) await authorityGuard();
    } catch (error) {
        if (isScrapeAuthorityRevokedError(error)) throw error;
        await recordDownloadOperationError(operation.downloadId, error, 'public_queue_failed');
    } finally {
        activeDownloadOperations.delete(operation.downloadId);
    }
}

async function uploadAuthenticatedDownload(operation, downloadItem, assertAuthorized = null) {
    if (activeDownloadOperations.has(operation.downloadId)) return;
    const authorityGuard = assertAuthorized || getDownloadOperationAuthorityGuard(operation);
    if (authorityGuard) await authorityGuard();
    activeDownloadOperations.add(operation.downloadId);
    try {
        if (!downloadItem?.filename) throw new Error('[download-search] file unavailable');
        const sourceUrl = downloadItem.finalUrl || downloadItem.url;
        if (!sourceUrl) throw new Error('[download-search] source unavailable');

        console.log('[CloudQueue]', formatRedactedMediaLog('download_complete', operation.mediaId));
        try {
            await chrome.offscreen.createDocument({
                url: 'offscreen.html',
                reasons: ['BLOBS'],
                justification: 'Read downloaded file for R2 cloud backup upload'
            });
            if (authorityGuard) await authorityGuard();
        } catch (error) {
            if (!error.message.includes('already exists') && !error.message.includes('Only a single offscreen')) {
                throw error;
            }
        }

        const fileData = await chrome.runtime.sendMessage({
            action: 'READ_FILE_FOR_UPLOAD',
            filePath: downloadItem.filename,
            contentType: downloadItem.mime || 'application/octet-stream'
        });
        if (authorityGuard) await authorityGuard();
        if (!fileData || !fileData.ok) throw new Error('[file-read] unavailable');
        console.log('[CloudQueue]', formatRedactedMediaLog('file_read', operation.mediaId, { bytes: fileData.size }));

        const config = await getCloudConfig();
        if (authorityGuard) await authorityGuard();
        const userInfo = await chrome.storage.local.get(['activeGrokUserId']);
        if (authorityGuard) await authorityGuard();
        const binaryStr = atob(fileData.base64);
        const bytes = new Uint8Array(binaryStr.length);
        for (let index = 0; index < binaryStr.length; index++) bytes[index] = binaryStr.charCodeAt(index);
        const blob = new Blob([bytes], { type: fileData.type });
        const result = await uploadBlobWithR2Dedupe(config, {
            sourceUrl,
            finalPath: operation.finalPath,
            userId: userInfo.activeGrokUserId || 'Shared_Account',
            contentType: fileData.type,
            acceptance: buildAcceptanceContextFromCloudConfig(config, 'download-upload')
        }, blob, authorityGuard);
        if (authorityGuard) await authorityGuard();

        log(
            `Cloud upload ${formatRedactedMediaLog(result.status, operation.mediaId, { bytes: result.bytes })}`,
            result.status === 'conflict_uploaded' ? 'warning' : 'success'
        );
        await markDownloadOperationR2Present(operation.downloadId, result, authorityGuard);
    } catch (error) {
        if (isScrapeAuthorityRevokedError(error)) throw error;
        console.error('[CloudQueue]', formatRedactedMediaLog(
            'post_download_upload_failed',
            operation.mediaId,
            { stage: getUploadFailureStage(error) }
        ));
        await recordDownloadOperationError(operation.downloadId, error, 'auth_upload_failed');
    } finally {
        activeDownloadOperations.delete(operation.downloadId);
    }
}

async function processCompletedDownloadOperation(downloadId, downloadItem = null, assertAuthorized = null) {
    if (assertAuthorized) await assertAuthorized();
    let operation = await getDownloadOperation(downloadId);
    if (!operation) return;
    const authorityGuard = assertAuthorized || getDownloadOperationAuthorityGuard(operation);
    if (authorityGuard) await authorityGuard();
    const item = downloadItem || (await chrome.downloads.search({ id: downloadId }))[0];
    if (authorityGuard) await authorityGuard();

    if (operation.allowLocal && operation.mediaId && !operation.localIdentityPersisted) {
        await mutateProcessedIds({ ids: [operation.mediaId] }, authorityGuard);
        operation = await updateDownloadOperation(downloadId, { localIdentityPersisted: true });
        if (!operation) return;
        if (authorityGuard) await authorityGuard();
    }

    if (!operation.cloudRequired) {
        await removeDownloadOperation(downloadId);
        return;
    }

    if (operation.strategy === 'public_queue') {
        await finalizeDownloadOperation(downloadId, { assertAuthorized: authorityGuard });
        return;
    }

    await uploadAuthenticatedDownload(operation, item, authorityGuard);
}

async function reconcileMissingDownloadOperation(operation, assertAuthorized = null) {
    if (assertAuthorized) await assertAuthorized();
    if (operation.strategy === 'public_queue' && operation.r2State !== 'present') {
        const queueItem = await linkPublicQueueOperation(operation);
        if (assertAuthorized) await assertAuthorized();
        if (operation.allowLocal && operation.localIdentityPersisted && queueItem) return;

        let queueChanged = false;
        cloudSyncQueue.forEach((item) => {
            if (item.type === 'media' && item.cleanupDownloadId === operation.downloadId) {
                item.cleanupDownloadId = null;
                queueChanged = true;
            }
        });
        if (queueChanged) await persistCloudState();
        if (assertAuthorized) await assertAuthorized();
        await removeDownloadOperation(operation.downloadId);
        return;
    }

    if (operation.downloadState === 'complete') {
        if (!operation.allowLocal && operation.r2State === 'present') {
            await finalizeDownloadOperation(operation.downloadId, { historyMissing: true, assertAuthorized });
            return;
        }
        if (operation.allowLocal && operation.mediaId && !operation.localIdentityPersisted) {
            await mutateProcessedIds({ ids: [operation.mediaId] }, assertAuthorized);
        }
    }

    if (assertAuthorized) await assertAuthorized();
    await removeDownloadOperation(operation.downloadId);
}

async function reconcilePendingDownloadOperations(startupOperations = null) {
    const operations = Array.isArray(startupOperations)
        ? startupOperations
        : Array.from((await hydrateDownloadOperations()).values()).map((operation) => ({ ...operation }));
    for (const operation of operations) {
        if (isPreparedCompletionRecord(operation) || isCompletionTransitionBlockingRecord(operation)) continue;
        const scrapeLease = getDownloadOperationScrapeLease(operation);
        const assertAuthorized = scrapeLease
            ? () => assertScrapeTransferAuthorized(scrapeLease)
            : null;
        if (assertAuthorized) {
            try {
                await assertAuthorized();
            } catch (error) {
                if (!isScrapeAuthorityRevokedError(error)) throw error;
                await removeDownloadOperation(operation.downloadId);
                cancelDownload(operation.downloadId);
                continue;
            }
        }
        const [downloadItem] = await chrome.downloads.search({ id: operation.downloadId });
        if (assertAuthorized) await assertAuthorized();
        if (!downloadItem) {
            await reconcileMissingDownloadOperation(operation, assertAuthorized);
            continue;
        }
        if (downloadItem.state === 'interrupted') {
            await removeDownloadOperation(operation.downloadId);
            continue;
        }

        let current = operation;
        if (downloadItem.state === 'complete' && operation.downloadState !== 'complete') {
            current = await updateDownloadOperation(operation.downloadId, { downloadState: 'complete' });
        }

        if (current.strategy === 'public_queue' && current.r2State !== 'present') {
            await ensurePublicDownloadQueued(current, downloadItem, assertAuthorized);
            current = await getDownloadOperation(operation.downloadId);
            if (!current) continue;
            if (assertAuthorized) await assertAuthorized();
        }

        if (downloadItem.state === 'complete') {
            await processCompletedDownloadOperation(operation.downloadId, downloadItem, assertAuthorized);
        }
    }
    await scheduleCloudRetryAlarm();
}

async function handleDownloadFilename(item, suggestOnce) {
    await ensureScrapeLeaseHydrated();
    const scrapeReceipt = claimPendingScrapeDownload(item);
    if (scrapeReceipt?.revoked || revokedScrapeDownloadIds.has(item.id)) {
        releasePendingScrapeDownload(scrapeReceipt);
        revokedScrapeDownloadIds.delete(item.id);
        suggestOnce();
        cancelDownload(item.id);
        return;
    }
    const scrapeLease = scrapeReceipt?.lease || null;
    const assertAuthorized = scrapeLease
        ? () => assertScrapeTransferAuthorized(scrapeLease)
        : null;
    const existingOperation = scrapeLease ? null : await getDownloadOperation(item.id);

    if (!scrapeLease && existingOperation) {
        const existingLease = getDownloadOperationScrapeLease(existingOperation);
        try {
            if (existingLease) await assertScrapeTransferAuthorized(existingLease);
            if (existingOperation.finalPath) {
                suggestOnce({ filename: existingOperation.finalPath, conflictAction: 'overwrite' });
            } else {
                suggestOnce();
            }
        } catch (error) {
            suggestOnce();
            if (isScrapeAuthorityRevokedError(error)) {
                await removeDownloadOperation(item.id).catch(() => {});
                cancelDownload(item.id);
                return;
            }
            throw error;
        }
        return;
    }

    if (!scrapeLease && isScraping) {
        suggestOnce();
        return;
    }

    if (!scrapeLease && !isScraping && !item.url.includes('imagine-public') && !item.url.includes('assets.grok.com')) {
        suggestOnce();
        return;
    }

    let reserved = false;
    const mediaId = CloudSync.extractGrokMediaId(item.url);
    try {
        if (assertAuthorized) await assertAuthorized();
        const finalPath = await generateFilename(item.url, item.filename);
        if (assertAuthorized) await assertAuthorized();
        if (!finalPath) {
            releasePendingScrapeDownload(scrapeReceipt);
            suggestOnce();
            cancelDownload(item.id);
            return;
        }

        const config = await getCloudConfig();
        if (assertAuthorized) await assertAuthorized();
        const cloudRequired = CloudSync.isCloudEnabled(config);
        const allowLocal = CloudSync.isLocalDownloadEnabled(config);
        const isAuthUrl = item.url.includes('assets.grok.com');
        const strategy = !cloudRequired ? 'local' : (isAuthUrl ? 'auth_file' : 'public_queue');
        const identity = CloudSync.resolveMediaAssetIdentity({ sourceUrl: item.url, finalPath });
        const operation = {
            downloadId: item.id,
            mediaId,
            reservationKey: mediaId || identity.assetId,
            finalPath,
            allowLocal,
            cloudRequired,
            strategy,
            cleanupDownloadId: cloudRequired && (strategy === 'public_queue' || !allowLocal)
                ? item.id
                : null,
            downloadState: 'in_progress',
            r2State: cloudRequired ? 'pending' : 'not_required',
            r2Status: null,
            attempts: 0,
            lastError: null,
            createdAt: Date.now(),
            ...(scrapeLease ? { scrapeLease: copyScrapeLeaseAuthority(scrapeLease) } : {})
        };

        reserved = await reserveDownloadOperation(operation);
        if (assertAuthorized) await assertAuthorized();
        if (!reserved) {
            releasePendingScrapeDownload(scrapeReceipt);
            suggestOnce();
            cancelDownload(item.id);
            return;
        }

        releasePendingScrapeDownload(scrapeReceipt);
        suggestOnce({ filename: finalPath, conflictAction: 'overwrite' });
        if (cloudRequired && strategy === 'public_queue') {
            await ensurePublicDownloadQueued(operation, item, assertAuthorized);
            if (assertAuthorized) await assertAuthorized();
        } else if (cloudRequired) {
            console.log('[CloudQueue]', formatRedactedMediaLog('download_tracked', mediaId));
        }
    } catch (error) {
        releasePendingScrapeDownload(scrapeReceipt);
        if (reserved) await removeDownloadOperation(item.id).catch(() => {});
        suggestOnce();
        cancelDownload(item.id);
        if (isScrapeAuthorityRevokedError(error)) return;
        console.error('[CloudQueue]', formatRedactedMediaLog(
            'filename_rejected',
            mediaId,
            { stage: getUploadFailureStage(error) }
        ));
    }
}

function handleDownloadFilenameEvent(item, suggest) {
    let suggested = false;
    const suggestOnce = (suggestion) => {
        if (suggested) return;
        suggested = true;
        if (typeof suggestion === 'undefined') suggest();
        else suggest(suggestion);
    };
    ensureBackgroundStateReady().then(() => handleDownloadFilename(item, suggestOnce)).catch(() => {
        suggestOnce();
        cancelDownload(item.id);
    });
    return true;
}

async function handleDownloadChanged(delta) {
    await ensureBackgroundStateReady();
    if (revokedScrapeDownloadIds.has(delta.id)) {
        revokedScrapeDownloadIds.delete(delta.id);
        await removeDownloadOperation(delta.id).catch(() => {});
        cancelDownload(delta.id);
        return;
    }
    const state = delta.state?.current;
    if (state === 'interrupted' || (delta.error && state !== 'complete')) {
        const existing = await getDownloadOperation(delta.id);
        if (!existing) return;
        if (isPreparedCompletionRecord(existing) || isCompletionTransitionBlockingRecord(existing)) return;
        const scrapeLease = getDownloadOperationScrapeLease(existing);
        const operationRevision = existing.operationRevision || 0;
        const operation = async (signal = null) => {
            const assertAuthorized = scrapeLease
                ? createScrapeTransferAuthorityGuard(scrapeLease, signal)
                : null;
            try {
                if (assertAuthorized) await assertAuthorized();
                const removed = await removeDownloadOperationRevision(
                    delta.id,
                    operationRevision,
                    scrapeLease
                );
                if (!removed) return;
                console.warn('[CloudQueue]', formatRedactedMediaLog('download_interrupted', removed.mediaId));
            } catch (error) {
                if (!isScrapeAuthorityRevokedError(error)) throw error;
                const removed = await removeDownloadOperationRevision(
                    delta.id,
                    operationRevision,
                    scrapeLease
                ).catch(() => null);
                if (removed) cancelDownload(delta.id);
            }
        };
        if (scrapeLease) await trackScrapeTransferTask(scrapeLease, operation);
        else await operation();
        return;
    }
    if (state !== 'complete') return;

    const existing = await getDownloadOperation(delta.id);
    if (!existing) return;
    if (isPreparedCompletionRecord(existing) || isCompletionTransitionBlockingRecord(existing)) return;
    const scrapeLease = getDownloadOperationScrapeLease(existing);
    const operationRevision = existing.operationRevision || 0;
    const operation = async (signal = null) => {
        const assertAuthorized = scrapeLease
            ? createScrapeTransferAuthorityGuard(scrapeLease, signal)
            : null;
        try {
            if (assertAuthorized) await assertAuthorized();
            const updated = await updateDownloadOperationRevision(
                delta.id,
                operationRevision,
                { downloadState: 'complete' }
            );
            if (!updated) return;
            if (assertAuthorized) await assertAuthorized();
            await processCompletedDownloadOperation(delta.id, null, assertAuthorized);
        } catch (error) {
            if (!isScrapeAuthorityRevokedError(error)) throw error;
            const removed = await removeDownloadOperationRevision(
                delta.id,
                operationRevision,
                scrapeLease
            ).catch(() => null);
            if (removed) cancelDownload(delta.id);
        }
    };
    if (scrapeLease) await trackScrapeTransferTask(scrapeLease, operation);
    else await operation();
}

if (typeof module !== 'undefined') {
    module.exports = {
        applyBackupProcessedIdPersistence,
        buildAcceptanceContextFromCloudConfig,
        buildDirectBackupUploadResponse,
        buildR2BackupInitMessage,
        buildR2BackupInitMessageForConfig,
        dispatchNativeClick,
        enqueueCloudItemForTest: enqueueCloudItem,
        enqueueCloudMediaUpload,
        extractGrokMediaIdFallback,
        fetchRecreateReferenceDataUrl,
        getR2BackupCompletionStatusLabel,
        getCloudSyncForTest: () => CloudSync,
        getCloudSyncQueueForTest: () => cloudSyncQueue.map((item) => ({ ...item })),
        getPendingDownloadOperationsForTest: () => serializeDownloadOperations(pendingDownloadOperations),
        getProcessedUUIDsForTest: () => Array.from(processedUUIDs),
        generateFilename,
        handleDownloadChanged,
        handleDownloadFilename,
        initializeBackgroundState,
        ensureBackgroundStateReady,
        initializeScrapeInActiveTab,
        ensureScrapeLeaseHydrated,
        isGrokSavedUrl,
        isR2BackupCompletionSuccessful,
        queueChromeDownload,
        stopScrapeRun,
        validateScrapeResume,
        withTimeout,
        persistQueuedBackupProcessedId,
        persistQueuedBackupProcessedIdAfterSuccess,
        recreateWorkflowController,
        RECREATE_WORKFLOW_MESSAGE_TIMEOUT_MS,
        requestPresignedUrl,
        parseFilenameInfo,
        processCloudQueue,
        setCloudSyncQueueForTest: (items) => {
            cloudSyncQueue = items.map((item) => ({ ...item }));
            cloudQueueRevision = cloudSyncQueue.reduce(
                (latest, item) => Math.max(latest, Number.isInteger(item.queueRevision) ? item.queueRevision : 0),
                cloudQueueRevision
            );
        },
        setProcessedUUIDsForTest: (ids) => { processedUUIDs = new Set(ids); },
        testCloudConnection,
        uploadMetadataQueueItem,
        verifyR2Object
    };
}

// --- STANDARD DOWNLOAD LISTENER ---
chrome.downloads.onDeterminingFilename.addListener(handleDownloadFilenameEvent);

// --- POST-DOWNLOAD R2 UPLOAD (for auth URLs like assets.grok.com) ---
chrome.downloads.onChanged.addListener(handleDownloadChanged);
