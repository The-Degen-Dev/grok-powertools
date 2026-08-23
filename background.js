// Background Service Worker
let generationRunHelperLoadError = null;
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
    try {
        importScripts('generationRunState.js', 'generationRunController.js');
    } catch (e) {
        generationRunHelperLoadError = e || new Error('GENERATION_HELPERS_LOAD_FAILED');
    }
    try {
        importScripts('providerRunLedger.js');
    } catch (e) {
        console.warn('Provider run ledger helper failed to load.', e);
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
        getAcceptanceCloudConfigContext(config) {
            const normalized = this.normalizeCloudConfig(config);
            const match = normalized.keyPrefix.match(/^acceptance\/([^/]+)$/);
            if (!match) return null;
            return { runId: match[1], keyPrefix: normalized.keyPrefix };
        },
        isAcceptanceCloudConfig(config) {
            return this.getAcceptanceCloudConfigContext(config) !== null;
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
        messageTimeoutMs: RECREATE_WORKFLOW_MESSAGE_TIMEOUT_MS,
        sessionStorage: chrome.storage?.session
    })
    : null;
const GenerationRunController = generationRunHelperLoadError
    ? null
    : (typeof self !== 'undefined' && self.GrokPowerToolsGenerationRunController)
        ? self.GrokPowerToolsGenerationRunController
        : (typeof require === 'function' ? require('./generationRunController.js') : null);
const ProviderRunLedger = (typeof self !== 'undefined' && self.GrokPowerToolsProviderRunLedger)
    ? self.GrokPowerToolsProviderRunLedger
    : (typeof require === 'function' ? require('./providerRunLedger.js') : null);

const API_KEY_HEADER = ['x-gpt', 'api', 'key'].join('-');

console.log('Grok Downloader Background Service Started');

let isScraping = false;
let isR2Backup = false;
let scrapeStartPending = false;
const ACTIVE_SCRAPE_RUN_TOKEN_KEY = 'activeScrapeRunToken';
const SCRAPE_LEASE_VERSION = 1;
const SCRAPE_ABORT_TIMEOUT_MS = 2000;
const SCRAPE_ABORT_ATTEMPT_TIMEOUT_MS = 450;
const SCRAPE_ABORT_RETRY_DELAY_MS = 100;
const SCRAPE_TRANSFER_DRAIN_TIMEOUT_MS = 2000;
const PENDING_DOWNLOAD_MUTATION_TIMEOUT_MS = 1000;
const CLOUD_QUEUE_MUTATION_TIMEOUT_MS = 1000;
const BACKGROUND_READINESS_WAIT_TIMEOUT_MS = 15000;
// A freshly reloaded Chrome worker can be paused for several seconds while its
// first storage mutation is in flight, especially beside a large Saved tab.
const BACKGROUND_INITIALIZATION_TIMEOUT_MS = 10000;
let activeScrapeLease = null;
let scrapeLeaseHydrationPromise = null;
let scrapeLeaseMutationQueue = Promise.resolve();
let scrapeStopPending = false;
let generationRunController = null;
let mutatingWorkflowStartQueue = Promise.resolve();
const ACTIVE_PAGE_WORKFLOW_KEY = 'activePageWorkflowLease';
const PAGE_WORKFLOW_LEASE_VERSION = 1;
const PAGE_WORKFLOW_KINDS = new Set(['template_batch', 'quality_repeat']);
const PAGE_WORKFLOW_HEARTBEAT_TIMEOUT_MS = 45000;
const PAGE_WORKFLOW_PING_TIMEOUT_MS = 1500;
let activePageWorkflowLease = null;
let pageWorkflowLeaseHydrationPromise = null;
let pageWorkflowLeaseMutationQueue = Promise.resolve();
const activeScrapeTransferTasks = new Map();
const activeScrapeTransferKinds = new Map();
const activeScrapeTransferAbortControllers = new Map();
const r2BackupInventoryPromises = new Map();
let backgroundStateReadyPromise = null;
const MAX_LOGS = 100;
const CLOUD_ALARM_NAME = 'gptCloudRetry';
const CLOUD_METADATA_DEBOUNCE_MS = 2000;
const CLOUD_SCHEMA_VERSION = 1;
const MAX_SYNC_ENTRY_LIMIT = 100;
const PROCESSED_IDS_KEY = 'processedIds';
const PROCESSED_LOCAL_IDS_KEY = 'processedLocalIds';
const PROCESSED_R2_IDS_KEY = 'processedR2Ids';
const PROMPT_HISTORY_KEY = 'promptHistory';
const SAVED_PROMPTS_KEY = 'savedPrompts';
const PENDING_DOWNLOAD_OPERATIONS_KEY = 'pendingDownloadOperations';
const SCRAPE_COMPLETION_TXN_KEY = 'scrapeCompletionTxn';
const SCRAPE_COMPLETION_JOURNAL_PREFIX = 'scrapeCompletionJournal:';
const SCRAPE_RUN_STATE_RECORD_PREFIX = 'scrapeRunStateRecord:';
const SCRAPE_PERSISTENCE_WRITER_PREFIX = 'scrapePersistenceWriter:';

// Global History Set
let processedUUIDs = new Set();
let processedLocalUUIDs = new Set();
let processedR2UUIDs = new Set();
let processedIdsMutationQueue = Promise.resolve();
let promptHistoryMutationQueue = Promise.resolve();
let savedPromptsMutationQueue = Promise.resolve();
let globalSettingsMutationQueue = Promise.resolve();
let cloudConfigMutationQueue = Promise.resolve();
let activityLogMutationQueue = Promise.resolve();
let providerRunLedgerMutationQueue = Promise.resolve();
let pendingDownloadOperations = new Map();
let pendingDownloadOperationsMutationQueue = Promise.resolve();
let pendingDownloadOperationsRevision = 0;
let pendingDownloadOperationRevision = 0;
const activeDownloadOperationFinalizations = new Map();
const activeDownloadOperations = new Set();
const pendingScrapeDownloadReceiptsByUrl = new Map();
const pendingScrapeDownloadReceiptsById = new Map();
const revokedScrapeDownloadIds = new Set();

let cloudSyncQueue = [];
let cloudQueueMutationQueue = Promise.resolve();
let cloudQueueRevision = 0;
let cloudQueueDrainPromise = null;
let cloudConfigEpoch = 0;
let activeCloudQueueDrainContext = null;
let cloudStatePersistenceRevision = 0;
let scrapeCompletionTxn = null;
let scrapeCompletionTransition = null;
let scrapeCompletionJournalRevision = 0;
let scrapeCompletionCheckpoint = {
    version: 1,
    retiredThroughWriterEpoch: 0,
    retiredThroughWriterId: '',
    retiredThroughEpoch: 0,
    committed: []
};
let scrapeRunStateRecordRevision = 0;
let latestScrapeRunStateAttemptRevision = 0;
let scrapePersistenceWriterEpoch = 0;
let scrapePersistenceWriterId = '';
let scrapePersistenceWriterClaimId = '';
let ambiguousScrapePersistenceAuthorities = new Set();
let activeScrapeRunMirror = null;
let backgroundStateStatus = { status: 'initializing', error: null };
const deferredLocalStorageChanges = [];
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
let cloudMetadataFlushPromise = null;
let pendingMetadataKinds = new Set();

const METADATA_WATCHED_KEYS = ['savedPrompts', 'promptHistory', 'processedIds'];
const METADATA_KIND_MAP = {
    savedPrompts: 'savedPrompts',
    promptHistory: 'promptHistory',
    processedIds: 'processedIds'
};

function mutateActivityLogs(mutator) {
    const mutation = activityLogMutationQueue.then(async () => {
        const result = await chrome.storage.local.get(['activityLogs']);
        const current = Array.isArray(result.activityLogs) ? result.activityLogs : [];
        const next = mutator([...current]);
        const logs = Array.isArray(next) ? next.slice(0, MAX_LOGS) : current.slice(0, MAX_LOGS);
        await chrome.storage.local.set({ activityLogs: logs });
        chrome.runtime.sendMessage({ action: 'UPDATE_LOGS', logs }).catch(() => { });
        return logs;
    });
    activityLogMutationQueue = mutation.catch(() => {});
    return mutation;
}

function log(msg, type = 'info') {
    const timestamp = new Date().toLocaleTimeString();
    const logEntry = `[${timestamp}] ${msg}`;
    console.log(logEntry);
    const write = mutateActivityLogs((logs) => [{ text: logEntry, type }, ...logs]);
    write.catch(() => {});
    return write;
}

const GLOBAL_SETTINGS_KEYS = new Set([
    'maxRetries',
    'videoGoal',
    'galleryBatchLimit',
    'autoRetryEnabled',
    'retryCooldown',
    'generationDelay',
    'historyLimit',
    'devMode'
]);
const CLOUD_CONFIG_KEYS = new Set(['enabled', 'mode', 'workerUrl', 'apiKey', 'keyPrefix']);

function filterStoragePatch(updates, allowedKeys) {
    if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
        throw new Error('settings_patch_invalid');
    }
    const patch = {};
    for (const [key, value] of Object.entries(updates)) {
        if (allowedKeys.has(key)) patch[key] = value;
    }
    if (Object.keys(patch).length === 0) throw new Error('settings_patch_empty');
    return patch;
}

function patchGlobalSettings(updates) {
    const patch = filterStoragePatch(updates, GLOBAL_SETTINGS_KEYS);
    const mutation = globalSettingsMutationQueue.then(async () => {
        const stored = await chrome.storage.sync.get(['gptGlobalSettings']);
        const current = stored.gptGlobalSettings && typeof stored.gptGlobalSettings === 'object'
            ? stored.gptGlobalSettings
            : {};
        const settings = { ...current, ...patch };
        await chrome.storage.sync.set({ gptGlobalSettings: settings });
        return settings;
    });
    globalSettingsMutationQueue = mutation.catch(() => {});
    return mutation;
}

function patchCloudConfig(updates) {
    const patch = filterStoragePatch(updates, CLOUD_CONFIG_KEYS);
    const mutation = cloudConfigMutationQueue.then(async () => {
        const stored = await chrome.storage.local.get([CloudSync.STORAGE_KEYS.cloudConfig]);
        const current = CloudSync.normalizeCloudConfig(stored[CloudSync.STORAGE_KEYS.cloudConfig]);
        const config = CloudSync.normalizeCloudConfig({ ...current, ...patch });
        if (config.workerUrl && !CloudSync.validateWorkersDevUrl(config.workerUrl)) {
            throw new Error('cloud_worker_url_invalid');
        }
        await chrome.storage.local.set({ [CloudSync.STORAGE_KEYS.cloudConfig]: config });
        return config;
    });
    cloudConfigMutationQueue = mutation.catch(() => {});
    return mutation;
}

function appendProviderRunLedger(entry) {
    if (!ProviderRunLedger || typeof ProviderRunLedger.appendProviderRunLedgerEntry !== 'function') {
        return Promise.reject(new Error('provider_run_ledger_unavailable'));
    }
    const mutation = providerRunLedgerMutationQueue.then(() => (
        ProviderRunLedger.appendProviderRunLedgerEntry(entry, { storage: chrome.storage.local })
    ));
    providerRunLedgerMutationQueue = mutation.catch(() => {});
    return mutation;
}

function shouldPersistBackupProcessedId(status) {
    return status === 'uploaded' || status === 'already_present' || status === 'conflict_uploaded';
}

function getScrapeDestinationsForCloudConfig(config) {
    const destinations = [];
    if (CloudSync.isLocalDownloadEnabled(config)) destinations.push('local');
    if (CloudSync.isCloudEnabled(config)) destinations.push('r2');
    return destinations.sort();
}

function scrapeDestinationContractMatches(expected, config) {
    const normalizedExpected = Array.from(new Set(
        (Array.isArray(expected) ? expected : [])
            .filter((value) => value === 'local' || value === 'r2')
    )).sort();
    const actual = getScrapeDestinationsForCloudConfig(config);
    return normalizedExpected.length === actual.length
        && normalizedExpected.every((value, index) => value === actual[index]);
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

function writeProcessedState(processedIds, localIds, r2Ids) {
    return chrome.storage.local.set({
        [PROCESSED_IDS_KEY]: processedIds,
        [PROCESSED_LOCAL_IDS_KEY]: localIds,
        [PROCESSED_R2_IDS_KEY]: r2Ids
    });
}

function mutateProcessedState({ reset = false, ids = [], localIds = [], r2Ids = [] } = {}, assertAuthorized = null) {
    const mutation = processedIdsMutationQueue.then(async () => {
        const stored = await chrome.storage.local.get([
            PROCESSED_IDS_KEY,
            PROCESSED_LOCAL_IDS_KEY,
            PROCESSED_R2_IDS_KEY
        ]);
        if (assertAuthorized) await assertAuthorized();
        const previousValues = normalizeProcessedIds(stored[PROCESSED_IDS_KEY]);
        const previousLocalValues = normalizeProcessedIds(stored[PROCESSED_LOCAL_IDS_KEY]);
        const previousR2Values = normalizeProcessedIds(stored[PROCESSED_R2_IDS_KEY]);
        const next = reset ? new Set() : new Set(previousValues);
        const nextLocal = reset ? new Set() : new Set(previousLocalValues);
        const nextR2 = reset ? new Set() : new Set(previousR2Values);
        if (!reset) {
            normalizeProcessedIds(ids).forEach((id) => next.add(id));
            normalizeProcessedIds(localIds).forEach((id) => {
                next.add(id);
                nextLocal.add(id);
            });
            normalizeProcessedIds(r2Ids).forEach((id) => {
                next.add(id);
                nextR2.add(id);
            });
        }
        const values = Array.from(next);
        const localValues = Array.from(nextLocal);
        const r2Values = Array.from(nextR2);
        await writeProcessedState(values, localValues, r2Values);
        processedUUIDs = next;
        processedLocalUUIDs = nextLocal;
        processedR2UUIDs = nextR2;
        try {
            if (assertAuthorized) await assertAuthorized();
        } catch (error) {
            if (isScrapeAuthorityRevokedError(error)) {
                processedUUIDs = new Set(previousValues);
                processedLocalUUIDs = new Set(previousLocalValues);
                processedR2UUIDs = new Set(previousR2Values);
                await writeProcessedState(
                    previousValues,
                    previousLocalValues,
                    previousR2Values
                );
            }
            throw error;
        }
        return { processedIds: values, localIds: localValues, r2Ids: r2Values };
    });
    processedIdsMutationQueue = mutation.catch(() => {});
    return mutation;
}

function mutateProcessedIds(options = {}, assertAuthorized = null) {
    return mutateProcessedState(options, assertAuthorized).then((state) => state.processedIds);
}

function mutateProcessedReceipts({ localIds = [], r2Ids = [] } = {}, assertAuthorized = null) {
    return mutateProcessedState({ localIds, r2Ids }, assertAuthorized);
}

function normalizePromptHistoryEntries(values) {
    const now = Date.now();
    return (Array.isArray(values) ? values : []).flatMap((entry, index) => {
        if (!entry || typeof entry !== 'object') return [];
        const text = String(entry.text || '').replace(/\s+/g, ' ').trim();
        if (!text) return [];
        const timestamp = Number.isFinite(entry.timestamp) && entry.timestamp > 0
            ? entry.timestamp
            : now;
        const id = typeof entry.id === 'string' && entry.id.trim()
            ? entry.id.trim()
            : `history_${timestamp}_${index}`;
        return [{
            id,
            text,
            type: entry.type === 'video' ? 'video' : 'image',
            timestamp
        }];
    });
}

function mutatePromptHistory({ operation, entry = null, limit = 50 } = {}) {
    const mutation = promptHistoryMutationQueue.then(async () => {
        const stored = await chrome.storage.local.get([PROMPT_HISTORY_KEY]);
        let history = normalizePromptHistoryEntries(stored[PROMPT_HISTORY_KEY]);
        if (operation === 'clear') {
            history = [];
        } else if (operation === 'add') {
            const normalizedEntry = normalizePromptHistoryEntries([entry])[0];
            if (!normalizedEntry) throw new Error('prompt_history_entry_invalid');
            history = history.filter((item) => (
                item.text !== normalizedEntry.text || item.type !== normalizedEntry.type
            ));
            history.unshift(normalizedEntry);
            const boundedLimit = Math.max(1, Math.min(500, Number.parseInt(limit, 10) || 50));
            history = history.slice(0, boundedLimit);
        } else {
            throw new Error('prompt_history_operation_invalid');
        }
        await chrome.storage.local.set({ [PROMPT_HISTORY_KEY]: history });
        return history;
    });
    promptHistoryMutationQueue = mutation.catch(() => {});
    return mutation;
}

function normalizeSavedPromptEntries(values) {
    const now = Date.now();
    return (Array.isArray(values) ? values : []).flatMap((entry, index) => {
        const source = entry && typeof entry === 'object'
            ? entry
            : { text: typeof entry === 'string' ? entry : '' };
        const text = String(source.text || '').replace(/\s+/g, ' ').trim();
        if (!text) return [];
        const createdAt = Number.isFinite(source.createdAt) && source.createdAt > 0
            ? source.createdAt
            : now;
        const updatedAt = Number.isFinite(source.updatedAt) && source.updatedAt > 0
            ? source.updatedAt
            : createdAt;
        const id = typeof source.id === 'string' && source.id.trim()
            ? source.id.trim()
            : `saved_${now}_${index}`;
        const requestedName = String(source.name || '').trim();
        return [{
            id,
            name: (requestedName || text.slice(0, 40) || 'Untitled Prompt').slice(0, 80),
            text,
            type: source.type === 'partial' ? 'partial' : 'full',
            createdAt,
            updatedAt
        }];
    });
}

function mutateSavedPrompts({ operation, item = null, items = [], itemId = '' } = {}) {
    const mutation = savedPromptsMutationQueue.then(async () => {
        const stored = await chrome.storage.local.get([SAVED_PROMPTS_KEY]);
        let prompts = normalizeSavedPromptEntries(stored[SAVED_PROMPTS_KEY]);
        if (operation === 'normalize') {
            // Normalization is intentionally based on the latest stored value.
        } else if (operation === 'add') {
            const normalizedItem = normalizeSavedPromptEntries([item])[0];
            if (!normalizedItem) throw new Error('saved_prompt_invalid');
            if (prompts.some((prompt) => prompt.id === normalizedItem.id)) {
                throw new Error('saved_prompt_id_conflict');
            }
            prompts.push(normalizedItem);
        } else if (operation === 'update') {
            const targetId = String(itemId || item?.id || '').trim();
            const normalizedItem = normalizeSavedPromptEntries([{ ...item, id: targetId }])[0];
            const index = prompts.findIndex((prompt) => prompt.id === targetId);
            if (!targetId || !normalizedItem || index === -1) throw new Error('saved_prompt_not_found');
            prompts[index] = normalizedItem;
        } else if (operation === 'delete') {
            const targetId = String(itemId || '').trim();
            if (!targetId) throw new Error('saved_prompt_not_found');
            prompts = prompts.filter((prompt) => prompt.id !== targetId);
        } else if (operation === 'merge') {
            const additions = normalizeSavedPromptEntries(items);
            const knownIds = new Set(prompts.map((prompt) => prompt.id));
            for (const addition of additions) {
                if (knownIds.has(addition.id)) continue;
                knownIds.add(addition.id);
                prompts.push(addition);
            }
        } else {
            throw new Error('saved_prompts_operation_invalid');
        }
        await chrome.storage.local.set({ [SAVED_PROMPTS_KEY]: prompts });
        return prompts;
    });
    savedPromptsMutationQueue = mutation.catch(() => {});
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
    await mutateProcessedReceipts({ r2Ids: [id] }, assertAuthorized);
    if (item.scrapeLease) clearR2BackupInventoryCache(item.scrapeLease);
    return true;
}

function buildDirectBackupUploadResponse(result, sourceUrl) {
    return {
        status: result.status,
        objectKey: result.objectKey,
        assetId: result.assetId,
        ...(result.metadataStatus ? { metadataStatus: result.metadataStatus } : {}),
        ...(result.metadataObjectKey ? { metadataObjectKey: result.metadataObjectKey } : {}),
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
    const acceptanceConfig = CloudSync.getAcceptanceCloudConfigContext(config);
    if (!acceptanceConfig) return null;

    return {
        runId: acceptanceConfig.runId,
        correlationId: `${source}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
        keyPrefix: acceptanceConfig.keyPrefix
    };
}

function cloudQueueItemMatchesAcceptanceConfig(item, config) {
    const acceptanceConfig = CloudSync.getAcceptanceCloudConfigContext(config);
    if (!acceptanceConfig || item?.type !== 'media') return false;
    const itemRunId = String(item.acceptance?.runId || '').trim();
    const itemKeyPrefix = CloudSync.sanitizeKeyPrefix
        ? CloudSync.sanitizeKeyPrefix(item.acceptance?.keyPrefix || '')
        : String(item.acceptance?.keyPrefix || '').trim().replace(/^\/+/, '').replace(/\/+$/, '');
    const correlationId = String(item.acceptance?.correlationId || '').trim();
    return itemRunId === acceptanceConfig.runId
        && itemKeyPrefix === acceptanceConfig.keyPrefix
        && Boolean(correlationId);
}

function cloudQueueItemIsEligibleForConfig(item, config) {
    if (!CloudSync.isAcceptanceCloudConfig(config)) return true;
    return cloudQueueItemMatchesAcceptanceConfig(item, config);
}

function getCloudConfigFingerprint(config) {
    return JSON.stringify(CloudSync.normalizeCloudConfig(config));
}

function createCloudConfigRevokedError() {
    const error = new Error('Cloud configuration changed during queue processing.');
    error.code = 'cloud_config_revoked';
    return error;
}

function isCloudConfigRevokedError(error) {
    return error?.code === 'cloud_config_revoked';
}

function isCloudQueueAuthorityRevokedError(error) {
    return isCloudConfigRevokedError(error) || isScrapeAuthorityRevokedError(error);
}

async function assertCloudConfigSnapshotCurrent(snapshot, item = null) {
    if (!snapshot
        || snapshot.revoked
        || snapshot.epoch !== cloudConfigEpoch) {
        throw createCloudConfigRevokedError();
    }
    if (snapshot.revoked
        || snapshot.epoch !== cloudConfigEpoch
        || getCloudConfigFingerprint(snapshot.config) !== snapshot.configFingerprint
        || (item && !cloudQueueItemIsEligibleForConfig(item, snapshot.config))) {
        throw createCloudConfigRevokedError();
    }
    return snapshot.config;
}

function createCloudConfigSnapshotGuard(snapshot, item = null) {
    const guard = () => assertCloudConfigSnapshotCurrent(snapshot, item);
    guard.signal = snapshot.abortController?.signal || null;
    return guard;
}

function combineCloudQueueAuthorityGuards(...guards) {
    const activeGuards = guards.filter(Boolean);
    if (activeGuards.length === 0) return null;
    const combined = async () => {
        for (const guard of activeGuards) await guard();
    };
    const signals = activeGuards.map((guard) => guard.signal).filter(Boolean);
    if (signals.length === 1) {
        combined.signal = signals[0];
    } else if (signals.length > 1) {
        const controller = new AbortController();
        for (const signal of signals) {
            if (signal.aborted) controller.abort();
            else signal.addEventListener('abort', () => controller.abort(), { once: true });
        }
        combined.signal = controller.signal;
    }
    return combined;
}

function revokeActiveCloudQueueDrain() {
    if (!activeCloudQueueDrainContext) return;
    activeCloudQueueDrainContext.revoked = true;
    activeCloudQueueDrainContext.abortController?.abort();
}

function buildCloudMediaQueueDedupeKey(baseDedupeKey, config) {
    const acceptanceConfig = CloudSync.getAcceptanceCloudConfigContext(config);
    if (!acceptanceConfig) return baseDedupeKey;
    return `${baseDedupeKey}:acceptance:${encodeURIComponent(acceptanceConfig.runId)}:${encodeURIComponent(acceptanceConfig.keyPrefix)}`;
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
    const completedReason = stats.stopReason === 'complete'
        || stats.stopReason === 'canary_complete';
    return completedReason
        && Number.isInteger(stats.pendingTransfers)
        && stats.pendingTransfers === 0
        && Number(stats.errors || 0) === 0;
}

function getR2BackupCompletionStatusLabel(stats = {}) {
    if (isR2BackupCompletionSuccessful(stats)) {
        return stats.stopReason === 'canary_complete' ? 'canary complete' : 'complete';
    }
    if (stats.stopReason === 'complete' || stats.stopReason === 'canary_complete') return 'incomplete';
    if (stats.stopReason === 'scan_limit' || stats.stopReason === 'stalled') return 'paused';
    return 'stopped';
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

    await mutateActivityLogs(() => []);
    await persistCloudState();
}

async function scheduleCloudRetryAlarm(configOverride = null, assertConfigCurrent = null) {
    if (assertConfigCurrent) await assertConfigCurrent();
    const config = configOverride || await getCloudConfig();
    const acceptanceMode = CloudSync.isAcceptanceCloudConfig(config);
    const retryableItems = cloudSyncQueue.filter((item) => (
        cloudQueueItemIsEligibleForConfig(item, config)
        && (item.attempts || 0) < CloudSync.MAX_RETRY_ATTEMPTS
    ));
    const queueOwnedDownloadIds = new Set(cloudSyncQueue
        .filter((item) => item.type === 'media' && Number.isInteger(item.cleanupDownloadId))
        .map((item) => item.cleanupDownloadId));
    for (const operation of pendingDownloadOperations.values()) {
        if (operation.strategy === 'public_queue' && findPublicQueueItemForOperation(operation)) {
            queueOwnedDownloadIds.add(operation.downloadId);
        }
    }
    const retryableDownloads = acceptanceMode ? [] : Array.from(pendingDownloadOperations.values()).filter((operation) => (
        operation.cloudRequired
        && !(operation.strategy === 'public_queue'
            && operation.r2State === 'pending'
            && queueOwnedDownloadIds.has(operation.downloadId))
        && (
            operation.r2State === 'pending'
            || (operation.downloadState === 'complete' && operation.r2State === 'present')
        )
        && (operation.attempts || 0) < CloudSync.MAX_RETRY_ATTEMPTS
    ));

    if (retryableItems.length === 0 && retryableDownloads.length === 0) {
        if (assertConfigCurrent) await assertConfigCurrent();
        await chrome.alarms.clear(CLOUD_ALARM_NAME);
        if (assertConfigCurrent) await assertConfigCurrent();
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
    if (assertConfigCurrent) await assertConfigCurrent();
    await chrome.alarms.clear(CLOUD_ALARM_NAME);
    if (assertConfigCurrent) await assertConfigCurrent();
    chrome.alarms.create(CLOUD_ALARM_NAME, { delayInMinutes });

    if (assertConfigCurrent) await assertConfigCurrent();
    cloudSyncState.retryScheduledAt = new Date(Date.now() + delayInMinutes * 60 * 1000).toISOString();
    await persistCloudState();
}

function enqueueCloudQueueMutation(operation) {
    const timeout = Symbol('cloud_queue_mutation_timeout');
    const operationPromise = cloudQueueMutationQueue.then(operation, operation);
    cloudQueueMutationQueue = operationPromise.catch(() => {});
    const mutation = withTimeout(
        operationPromise,
        CLOUD_QUEUE_MUTATION_TIMEOUT_MS,
        timeout
    ).then((result) => {
        if (result === timeout) throw new Error('cloud_queue_mutation_persist_timeout');
        return result;
    });
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

function removeCloudQueueItemRevision(item, assertAuthorized = null) {
    return enqueueCloudQueueMutation(async () => {
        if (assertAuthorized) await assertAuthorized();
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

function updateCloudQueueItemRevision(item, update, assertAuthorized = null) {
    return enqueueCloudQueueMutation(async () => {
        if (assertAuthorized) await assertAuthorized();
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

async function enqueueCloudItem(queueItem, dedupeKey, assertAuthorized = null, options = {}) {
    const key = dedupeKey || queueItem.id;
    if (assertAuthorized) await assertAuthorized();
    let receipt = null;
    try {
        receipt = await enqueueCloudQueueMutation(async () => {
            const existingIndex = cloudSyncQueue.findIndex((item) => item.dedupeKey === key);
            const existing = existingIndex >= 0 ? cloudSyncQueue[existingIndex] : null;
            if (existing
                && options.acceptanceConfig
                && !cloudQueueItemMatchesAcceptanceConfig(existing, options.acceptanceConfig)) {
                return {
                    accepted: false,
                    dedupeKey: key,
                    previousItem: null,
                    queueRevision: null
                };
            }
            const queueRevision = ++cloudQueueRevision;
            const nextReceipt = {
                accepted: true,
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
                        captureMetadata: queueItem.captureMetadata || existing.captureMetadata || null,
                        requireCaptureMetadata: queueItem.requireCaptureMetadata === true
                            || existing.requireCaptureMetadata === true,
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
    const configEpoch = cloudConfigEpoch;
    const config = await getCloudConfig();
    const configSnapshot = {
        epoch: configEpoch,
        config,
        configFingerprint: getCloudConfigFingerprint(config),
        revoked: false,
        abortController: new AbortController()
    };
    const enqueueAuthority = combineCloudQueueAuthorityGuards(
        createCloudConfigSnapshotGuard(configSnapshot),
        processOptions.assertAuthorized || null
    );
    if (enqueueAuthority) await enqueueAuthority();
    if (!CloudSync.isCloudEnabled(config)) return false;
    let acceptanceContext = acceptance || buildAcceptanceContextFromCloudConfig(config, 'queue-media');
    const acceptanceConfig = CloudSync.getAcceptanceCloudConfigContext(config);
    if (acceptanceConfig) {
        try {
            acceptanceContext = CloudSync.normalizeAcceptanceContext(acceptanceContext);
        } catch {
            return false;
        }
        if (acceptanceContext.runId !== acceptanceConfig.runId
            || acceptanceContext.keyPrefix !== acceptanceConfig.keyPrefix) return false;
    }

    const userInfo = await chrome.storage.local.get(['activeGrokUserId']);
    if (enqueueAuthority) await enqueueAuthority();
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
        captureMetadata: processOptions.captureMetadata || null,
        requireCaptureMetadata: processOptions.requireCaptureMetadata === true,
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
        const baseDedupeKey = CloudSync.buildMediaDedupeKey({
            fallbackUserId: activeUserId,
            sourceUrl,
            finalPath,
            contentType: queueItem.contentType
        });
        queueReceipt = await enqueueCloudItem(
            queueItem,
            buildCloudMediaQueueDedupeKey(baseDedupeKey, config),
            enqueueAuthority,
            { acceptanceConfig }
        );
        if (!queueReceipt?.accepted) return false;
        if (enqueueAuthority) await enqueueAuthority();
        await processCloudQueue('media-enqueued', {
            ...processOptions,
            waitForExisting: false
        });
    } catch (e) {
        if (isCloudConfigRevokedError(e)) {
            if (queueReceipt?.accepted) await rollbackCloudQueueItem(queueReceipt);
            return false;
        }
        if (isScrapeAuthorityRevokedError(e)) {
            if (queueReceipt?.accepted) await rollbackCloudQueueItem(queueReceipt);
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
    if (!CloudSync.isCloudEnabled(config) || CloudSync.isAcceptanceCloudConfig(config)) return false;

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
    return true;
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

async function dispatchNativeClick(tabId, click = {}, assertAuthorized = null) {
    if (!chrome.debugger) throw new Error('native_click_unavailable');
    if (!Number.isFinite(Number(tabId))) throw new Error('native_click_unavailable');

    const x = getNativeClickCoordinate(click.x);
    const y = getNativeClickCoordinate(click.y);
    const target = { tabId };
    let attached = false;
    let clickState = 'not_dispatched';

    try {
        if (assertAuthorized) await assertAuthorized();
        await debuggerAttach(target);
        attached = true;
        if (assertAuthorized) await assertAuthorized();
        await debuggerSendCommand(target, 'Input.dispatchMouseEvent', {
            type: 'mouseMoved',
            x,
            y,
            button: 'none',
            buttons: 0
        });
        if (assertAuthorized) await assertAuthorized();
        await debuggerSendCommand(target, 'Input.dispatchMouseEvent', {
            type: 'mousePressed',
            x,
            y,
            button: 'left',
            buttons: 1,
            clickCount: 1
        });
        clickState = 'unknown';
        if (assertAuthorized) await assertAuthorized();
        await debuggerSendCommand(target, 'Input.dispatchMouseEvent', {
            type: 'mouseReleased',
            x,
            y,
            button: 'left',
            buttons: 0,
            clickCount: 1
        });
        clickState = 'click_sent';

        return { ok: true, clickState };
    } catch (error) {
        const failure = new Error(error.message || 'native_click_unavailable');
        failure.clickState = clickState;
        throw failure;
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

async function fetchRecreateReferenceDataUrl(url, options = {}) {
    if (!RecreateWorkflowUtils) throw new Error('workflow_unavailable');
    if (!RecreateWorkflowUtils.isTrustedGrokMediaUrl(url)) throw new Error('reference_capture_failed');

    const parsed = new URL(String(url || ''));
    if (
        parsed.protocol !== 'https:' ||
        (parsed.hostname !== 'imagine-public.x.ai' && parsed.hostname !== 'images-public.x.ai')
    ) {
        throw new Error('reference_capture_failed');
    }

    if (options.assertAuthorized) await options.assertAuthorized();
    const response = await fetch(parsed.href, {
        credentials: 'omit',
        ...(options.signal ? { signal: options.signal } : {})
    });
    if (!response || !response.ok) throw new Error('reference_capture_failed');

    if (options.assertAuthorized) await options.assertAuthorized();
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

    if (options.assertAuthorized) await options.assertAuthorized();
    const dataUrl = `data:${mimeType};base64,${arrayBufferToBase64(await blob.arrayBuffer())}`;
    if (options.assertAuthorized) await options.assertAuthorized();
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
        if (signal?.aborted && assertAuthorized) await assertAuthorized();
        if (signal?.aborted) throw createScrapeAuthorityRevokedError();
        throw error;
    }
}

async function loadVerifiedVaultInventory(config, assertAuthorized = null) {
    const items = new Map();
    const seenCursors = new Set();
    const keyPrefix = CloudSync.sanitizeKeyPrefix
        ? CloudSync.sanitizeKeyPrefix(config.keyPrefix)
        : String(config.keyPrefix || '').trim().replace(/^\/+/, '').replace(/\/+$/, '');
    const requiredObjectKeyPrefix = `${keyPrefix}/`;
    let cursor = null;

    do {
        if (cursor && seenCursors.has(cursor)) throw new Error('vault_inventory_cursor_repeated');
        if (cursor) seenCursors.add(cursor);
        if (assertAuthorized) await assertAuthorized();
        const url = new URL('/v1/vault/inventory', config.workerUrl);
        url.searchParams.set('limit', '1000');
        if (cursor) url.searchParams.set('cursor', cursor);
        const response = await fetchWithScrapeAuthority(url.toString(), {
            headers: { [API_KEY_HEADER]: config.apiKey }
        }, assertAuthorized);
        if (!response.ok) throw new Error(`vault_inventory_${response.status}`);
        const page = await response.json();
        if (assertAuthorized) await assertAuthorized();
        for (const item of page.items || []) {
            if (item.canonicalObjectKey
                && !String(item.canonicalObjectKey).startsWith(requiredObjectKeyPrefix)) {
                throw new Error('vault_inventory_object_key_prefix_mismatch');
            }
            if (item.verificationStatus !== 'verified'
                || !['image', 'video'].includes(item.mediaType)
                || !item.assetId
                || !item.canonicalObjectKey) continue;
            items.set(item.assetId, item);
        }
        cursor = page.nextCursor || null;
    } while (cursor);

    return items;
}

async function headVerifiedVaultObject(config, item, assertAuthorized = null) {
    const url = new URL('/v1/objects/verify', config.workerUrl);
    url.searchParams.set('objectKey', item.canonicalObjectKey);
    const response = await fetchWithScrapeAuthority(url.toString(), {
        method: 'HEAD',
        headers: { [API_KEY_HEADER]: config.apiKey }
    }, assertAuthorized);
    if (response.status === 404) return { status: 'missing', assetId: item.assetId };
    if (!response.ok) return { status: 'error', error: `r2_head_${response.status}` };
    const bytes = Number(response.headers.get('x-r2-size-bytes') || 0);
    const contentType = response.headers.get('content-type') || '';
    const expectedType = item.mediaType === 'video' ? 'video/' : 'image/';
    if (bytes <= 0 || !contentType.startsWith(expectedType)) {
        return { status: 'error', error: 'r2_head_metadata_mismatch' };
    }
    return {
        status: 'already_present',
        assetId: item.assetId,
        objectKey: item.canonicalObjectKey,
        bytes,
        contentType,
        sha256: response.headers.get('x-r2-sha256') || ''
    };
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
        if (isCloudQueueAuthorityRevokedError(error)) throw error;
        console.warn('[CloudQueue]', formatRedactedMediaLog('sidecar_failed', descriptor.assetId));
    }
}

function sortJsonValue(value) {
    if (Array.isArray(value)) return value.map(sortJsonValue);
    if (!value || typeof value !== 'object') return value;
    return Object.keys(value).sort().reduce((result, key) => {
        result[key] = sortJsonValue(value[key]);
        return result;
    }, {});
}

function validateCaptureMetadata(captureMetadata, assetId) {
    if (!captureMetadata || typeof captureMetadata !== 'object' || Array.isArray(captureMetadata)) {
        throw new Error('asset_metadata_required');
    }
    if (captureMetadata.schemaVersion !== 2
        || captureMetadata.evidenceSource !== 'grok_conversation_response') {
        throw new Error('asset_metadata_schema_invalid');
    }
    const captureAssetId = String(captureMetadata.assetId || '').toLowerCase();
    const canonicalAssetId = String(assetId || '').toLowerCase();
    const canonicalMediaId = CloudSync.extractGrokMediaId(canonicalAssetId);
    if (captureAssetId !== canonicalAssetId && captureAssetId !== canonicalMediaId) {
        throw new Error('asset_metadata_asset_mismatch');
    }
    if (!captureMetadata.conversationId || !captureMetadata.assetMetadata) {
        throw new Error('asset_metadata_incomplete');
    }
    if (typeof captureMetadata.promptText !== 'string') {
        throw new Error('asset_metadata_prompt_invalid');
    }
    const promptEvidenceSource = String(captureMetadata.promptEvidenceSource || '');
    const hasPrompt = Boolean(captureMetadata.promptText.trim());
    if (!hasPrompt && promptEvidenceSource !== 'unavailable') {
        throw new Error('asset_metadata_prompt_missing');
    }
    if (hasPrompt && promptEvidenceSource === 'unavailable') {
        throw new Error('asset_metadata_prompt_evidence_invalid');
    }
    if (promptEvidenceSource && ![
        'response_media_gen_input',
        'asset_media_gen_input',
        'unavailable'
    ].includes(promptEvidenceSource)) {
        throw new Error('asset_metadata_prompt_evidence_invalid');
    }
    return sortJsonValue(captureMetadata);
}

async function buildAssetMetadataSidecar(descriptor) {
    const capture = validateCaptureMetadata(descriptor.captureMetadata, descriptor.assetId);
    const payload = sortJsonValue({
        schemaVersion: 2,
        mediaKey: descriptor.objectKey,
        assetId: descriptor.assetId,
        capture
    });
    const body = JSON.stringify(payload);
    const blob = new Blob([body], { type: 'application/json' });
    const sha256 = await sha256Blob(blob);
    return {
        body,
        blob,
        sha256,
        objectKey: `${descriptor.objectKey}.metadata.v2.${sha256.slice(0, 24)}.json`
    };
}

async function uploadAssetMetadataSidecar(config, descriptor, assertAuthorized = null) {
    if (assertAuthorized) await assertAuthorized();
    const sidecar = await buildAssetMetadataSidecar(descriptor);
    if (assertAuthorized) await assertAuthorized();
    const sidecarDescriptor = {
        objectKey: sidecar.objectKey,
        contentType: 'application/json',
        assetId: descriptor.assetId,
        sourceUrlHash: descriptor.sourceUrlHash,
        acceptance: descriptor.acceptance || null,
        r2Metadata: sanitizeR2Metadata({
            'asset-id': descriptor.assetId,
            'sidecar-kind': 'asset-metadata-v2',
            sha256: sidecar.sha256
        })
    };
    const expected = {
        sizeBytes: sidecar.blob.size,
        sha256: sidecar.sha256,
        contentType: 'application/json'
    };
    const existing = await verifyR2Object(config, sidecarDescriptor, expected, assertAuthorized);
    if (assertAuthorized) await assertAuthorized();
    if (existing.exists && existing.verified) {
        return { status: 'already_present', objectKey: sidecar.objectKey, sha256: sidecar.sha256 };
    }
    if (existing.exists) throw new Error('asset_metadata_sidecar_conflict');

    const presigned = await requestPresignedUrl(
        config,
        sidecarDescriptor,
        sidecar.blob.size,
        assertAuthorized
    );
    if (assertAuthorized) await assertAuthorized();
    const uploadResponse = await fetchWithScrapeAuthority(presigned.uploadUrl, {
        method: presigned.method || 'PUT',
        headers: { ...(presigned.headers || {}), 'Content-Type': 'application/json' },
        body: sidecar.body
    }, assertAuthorized);
    if (assertAuthorized) await assertAuthorized();
    if (!uploadResponse.ok) {
        const detail = await uploadResponse.text().catch(() => 'Unknown metadata sidecar error');
        throw new Error(`asset_metadata_sidecar_put_${uploadResponse.status}: ${detail}`);
    }

    const verified = await verifyR2Object(config, sidecarDescriptor, expected, assertAuthorized);
    if (assertAuthorized) await assertAuthorized();
    if (!verified.exists || !verified.verified) throw new Error('asset_metadata_sidecar_verify_failed');
    console.log('[CloudQueue]', formatRedactedMediaLog(
        'metadata_sidecar_uploaded',
        descriptor.assetId,
        { bytes: sidecar.blob.size }
    ));
    return { status: 'uploaded', objectKey: sidecar.objectKey, sha256: sidecar.sha256 };
}

async function ensureCaptureMetadataDurable(config, descriptor, assertAuthorized = null) {
    if (!descriptor.captureMetadata) {
        if (descriptor.requireCaptureMetadata) throw new Error('asset_metadata_required');
        return null;
    }
    try {
        return await uploadAssetMetadataSidecar(config, descriptor, assertAuthorized);
    } catch (error) {
        if (isCloudQueueAuthorityRevokedError(error)) throw error;
        if (String(error?.message || '').startsWith('[asset-metadata]')) throw error;
        throw new Error(`[asset-metadata] ${error?.message || 'asset_metadata_failed'}`);
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
        if (isCloudQueueAuthorityRevokedError(e)) throw e;
        throw new Error(`[${CloudSync.UPLOAD_STAGES.presign}] ${e.message}`);
    }

    if (preflight.exists && preflight.verified) {
        if (assertAuthorized) await assertAuthorized();
        const metadataResult = await ensureCaptureMetadataDurable(config, descriptor, assertAuthorized);
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
            bytes: blob.size,
            ...(metadataResult ? {
                metadataStatus: metadataResult.status,
                metadataObjectKey: metadataResult.objectKey
            } : {})
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
        if (isCloudQueueAuthorityRevokedError(e)) throw e;
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
        if (isCloudQueueAuthorityRevokedError(e)) throw e;
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
    const metadataResult = await ensureCaptureMetadataDurable(config, descriptor, assertAuthorized);
    if (assertAuthorized) await assertAuthorized();
    await uploadPromptSidecar(config, descriptor, assertAuthorized);
    if (assertAuthorized) await assertAuthorized();

    return {
        status: descriptor.conflictOfObjectKey ? 'conflict_uploaded' : 'uploaded',
        objectKey: descriptor.objectKey,
        assetId: descriptor.assetId,
        contentSha256,
        bytes: blob.size,
        conflictOfObjectKey: descriptor.conflictOfObjectKey,
        ...(metadataResult ? {
            metadataStatus: metadataResult.status,
            metadataObjectKey: metadataResult.objectKey
        } : {})
    };
}

async function uploadMediaQueueItem(config, queueItem, assertAuthorized = null) {
    let blob;
    let contentType;

    try {
        console.log('[CloudQueue]', formatRedactedMediaLog('fetching', queueItem.backupProcessedId || queueItem.assetId));
        const fetchOpts = {
            method: 'GET',
            credentials: 'include'
        };

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
        if (isCloudQueueAuthorityRevokedError(e)) throw e;
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

async function uploadMetadataQueueItem(config, queueItem, assertAuthorized = null) {
    const response = await fetchWithScrapeAuthority(`${config.workerUrl}/v1/metadata/snapshot`, {
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
    }, assertAuthorized);

    if (!response.ok) {
        const detail = await response.text().catch(() => 'Unknown metadata snapshot error');
        throw new Error(`Metadata snapshot failed (${response.status}): ${detail}`);
    }

    return response.json();
}

async function drainCloudQueue(reason = 'auto', options = {}, drainContext = null) {
    if (drainContext?.revoked || drainContext?.epoch !== cloudConfigEpoch) return;
    if (hasBlockedScrapeCompletionTransfer()) {
        await recoverPreparedScrapeCompletionTransfer();
        if (hasBlockedScrapeCompletionTransfer()) return;
    }
    const config = await getCloudConfig();
    if (drainContext) {
        drainContext.config = config;
        drainContext.configFingerprint = getCloudConfigFingerprint(config);
        if (drainContext.revoked || drainContext.epoch !== cloudConfigEpoch) return;
    }
    const drainConfigGuard = drainContext
        ? createCloudConfigSnapshotGuard(drainContext)
        : null;
    if (drainConfigGuard) await drainConfigGuard();
    if (options.assertAuthorized) await options.assertAuthorized();
    if (!CloudSync.isCloudEnabled(config)) {
        await scheduleCloudRetryAlarm(config, drainConfigGuard);
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
    const queueSnapshot = (await snapshotCloudQueueItems())
        .filter((item) => cloudQueueItemIsEligibleForConfig(item, config));
    let authorityError = null;
    let configRevoked = false;

    try {
        for (const item of queueSnapshot) {
            const itemConfigGuard = drainContext
                ? createCloudConfigSnapshotGuard(drainContext, item)
                : null;
            if (itemConfigGuard) await itemConfigGuard();
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
            const scrapeAssertAuthorized = itemLease
                ? (usesProcessAuthority
                    ? options.assertAuthorized
                    : createScrapeTransferAuthorityGuard(itemLease, itemAbortController.signal))
                : (options.assertAuthorized || null);
            const itemAssertAuthorized = combineCloudQueueAuthorityGuards(
                itemConfigGuard,
                scrapeAssertAuthorized
            );
            const attempts = item.attempts || 0;
            try {
                if (!force && attempts >= CloudSync.MAX_RETRY_ATTEMPTS) {
                    if (!item._permanentFailLogged) {
                        const message = item.type === 'media'
                            ? `Cloud sync ${formatRedactedMediaLog('permanently_failed', item.backupProcessedId || item.assetId, { count: attempts })}`
                            : `Cloud sync permanently failed (${item.type}): ${item.kind} after ${attempts} attempts`;
                        log(message, 'error');
                        await updateCloudQueueItemRevision(
                            item,
                            { _permanentFailLogged: true },
                            itemConfigGuard
                        );
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
                    const result = await uploadMetadataQueueItem(config, item, itemAssertAuthorized);
                    if (result && result.skipped) {
                        cloudSyncState.r2MetadataSnapshotsSkippedUnchanged += 1;
                        log(`Cloud metadata unchanged: ${item.kind}`, 'info');
                    } else {
                        log(`Cloud metadata synced: ${item.kind}`, 'success');
                    }
                } else {
                    throw new Error(`Unknown queue item type: ${item.type}`);
                }

                if (itemAssertAuthorized) await itemAssertAuthorized();
                clearCloudError();
                cloudSyncState.lastSyncAt = new Date().toISOString();
                await removeCloudQueueItemRevision(item, itemAssertAuthorized);
            } catch (e) {
                if (isCloudConfigRevokedError(e)) {
                    configRevoked = true;
                    break;
                }
                if (isScrapeAuthorityRevokedError(e)) {
                    if (itemLease) {
                        try {
                            await removeCloudQueueItemRevision(item, itemConfigGuard);
                        } catch (removeError) {
                            if (isCloudConfigRevokedError(removeError)) {
                                configRevoked = true;
                                break;
                            }
                            throw removeError;
                        }
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
                try {
                    await updateCloudQueueItemRevision(item, {
                        attempts: nextAttempts,
                        lastError: redactedError,
                        lastAttemptAt: Date.now()
                    }, itemConfigGuard);
                    if (item.type === 'media' && Number.isInteger(item.cleanupDownloadId)) {
                        const operation = await getDownloadOperation(item.cleanupDownloadId);
                        const publicQueueOwnsRetry = operation?.strategy === 'public_queue';
                        await recordDownloadOperationError(
                            item.cleanupDownloadId,
                            e,
                            publicQueueOwnsRetry
                                ? 'public_queue_failed'
                                : 'auth_upload_failed',
                            { incrementAttempts: !publicQueueOwnsRetry }
                        );
                    }
                } catch (updateError) {
                    if (isCloudConfigRevokedError(updateError)) {
                        configRevoked = true;
                        break;
                    }
                    throw updateError;
                }
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

    if (configRevoked) return;
    if (authorityError) throw authorityError;

    if (drainConfigGuard) {
        try {
            await drainConfigGuard();
        } catch (error) {
            if (isCloudConfigRevokedError(error)) return;
            throw error;
        }
    }

    // If new items were queued while we were processing, drain immediately
    if (cloudSyncQueue.some((item) => (
        cloudQueueItemIsEligibleForConfig(item, config)
        && (item.attempts || 0) === 0
    ))) {
        const followUpEpoch = drainContext?.epoch ?? cloudConfigEpoch;
        setTimeout(() => {
            if (followUpEpoch !== cloudConfigEpoch) return;
            processCloudQueue('drain');
        }, 100);
    } else {
        await scheduleCloudRetryAlarm(config, drainConfigGuard);
    }

    if (reason === 'manual') {
        log('Manual cloud retry completed.', 'info');
    }
}

function processCloudQueue(reason = 'auto', options = {}) {
    if (cloudQueueDrainPromise) {
        const requestedEpoch = cloudConfigEpoch;
        if (activeCloudQueueDrainContext?.epoch !== requestedEpoch) {
            const activeDrain = cloudQueueDrainPromise;
            const restart = activeDrain.then(
                () => {
                    if (requestedEpoch !== cloudConfigEpoch) return;
                    return processCloudQueue(reason, options);
                },
                (error) => {
                    if (requestedEpoch !== cloudConfigEpoch) return;
                    if (!isCloudConfigRevokedError(error)) throw error;
                    return processCloudQueue(reason, options);
                }
            );
            return options.waitForExisting === false ? Promise.resolve() : restart;
        }
        return options.waitForExisting === false ? Promise.resolve() : cloudQueueDrainPromise;
    }

    const drainContext = {
        epoch: cloudConfigEpoch,
        config: null,
        configFingerprint: null,
        revoked: false,
        abortController: new AbortController()
    };
    activeCloudQueueDrainContext = drainContext;
    const drain = drainCloudQueue(reason, options, drainContext);
    cloudQueueDrainPromise = drain;
    drain.finally(() => {
        if (cloudQueueDrainPromise === drain) cloudQueueDrainPromise = null;
        if (activeCloudQueueDrainContext === drainContext) activeCloudQueueDrainContext = null;
    }).catch(() => {});
    return drain;
}

async function runCloudBackfill() {
    const config = await getCloudConfig();
    if (!CloudSync.isCloudEnabled(config)) {
        throw new Error('Enable Cloud Backup before running backfill.');
    }
    if (CloudSync.isAcceptanceCloudConfig(config)) return;

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
        cloudMetadataTimer = null;
        runMetadataSyncFlush().catch((e) => {
            updateCloudError(e.message);
            persistCloudState().catch(() => { });
        });
    }, CLOUD_METADATA_DEBOUNCE_MS);
}

function runMetadataSyncFlush() {
    if (cloudMetadataFlushPromise) return cloudMetadataFlushPromise;
    const flush = (async () => {
        do {
            await flushMetadataSync();
        } while (pendingMetadataKinds.size > 0);
    })();
    cloudMetadataFlushPromise = flush;
    flush.finally(() => {
        if (cloudMetadataFlushPromise === flush) cloudMetadataFlushPromise = null;
    }).catch(() => {});
    return flush;
}

async function drainPendingMetadataSync() {
    while (cloudMetadataTimer || cloudMetadataFlushPromise || pendingMetadataKinds.size > 0) {
        if (cloudMetadataTimer) {
            clearTimeout(cloudMetadataTimer);
            cloudMetadataTimer = null;
        }
        if (cloudMetadataFlushPromise) await cloudMetadataFlushPromise;
        else if (pendingMetadataKinds.size > 0) await runMetadataSyncFlush();
    }
}

function cancelPendingMetadataSyncForTest() {
    if (cloudMetadataTimer) clearTimeout(cloudMetadataTimer);
    cloudMetadataTimer = null;
    pendingMetadataKinds.clear();
}

async function flushMetadataSync() {
    const config = await getCloudConfig();
    if (!CloudSync.isCloudEnabled(config) || CloudSync.isAcceptanceCloudConfig(config)) {
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

function createBackgroundInitializationTimeoutError() {
    const error = new Error('background_initialization_timeout');
    error.code = 'background_initialization_timeout';
    return error;
}

function assertBackgroundInitializationCurrent(context) {
    if (!context) return;
    if (!context.active || Date.now() >= context.deadlineAt) {
        throw createBackgroundInitializationTimeoutError();
    }
}

async function getGenerationBlockingWorkflow() {
    const scrapeActive = activeScrapeLease?.status === 'starting'
        || activeScrapeLease?.status === 'active'
        || activeScrapeLease?.status === 'stopping'
        || scrapeStartPending
        || scrapeStopPending
        || isScraping
        || isR2Backup;
    if (scrapeActive) {
        const kind = activeScrapeLease?.kind || (isR2Backup ? 'r2_backup' : 'sync');
        return {
            kind,
            status: activeScrapeLease?.status === 'stopping' || scrapeStopPending ? 'stopping' : 'running',
            runId: activeScrapeLease?.token || ''
        };
    }

    return recreateWorkflowController?.getActiveRunStatus?.() || null;
}

function enqueueMutatingWorkflowStart(operation) {
    const execute = () => Promise.resolve().then(operation);
    const result = mutatingWorkflowStartQueue.then(execute, execute);
    mutatingWorkflowStartQueue = result.catch(() => {});
    return result;
}

function createIdlePageWorkflowLease(epoch = 0) {
    return {
        version: PAGE_WORKFLOW_LEASE_VERSION,
        status: 'idle',
        kind: null,
        runId: null,
        epoch: Math.max(0, Number.isInteger(epoch) ? epoch : 0),
        ownerTabId: null,
        ownerDocumentId: '',
        startedAt: 0,
        updatedAt: 0,
        counts: null
    };
}

function normalizePageWorkflowLease(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    if (value.version !== PAGE_WORKFLOW_LEASE_VERSION) return null;
    const epoch = Number.isInteger(value.epoch) && value.epoch >= 0 ? value.epoch : null;
    if (epoch === null) return null;
    if (value.status === 'idle') return createIdlePageWorkflowLease(epoch);
    if (value.status !== 'running'
        || !PAGE_WORKFLOW_KINDS.has(value.kind)
        || typeof value.runId !== 'string'
        || !value.runId
        || !Number.isInteger(value.ownerTabId)
        || typeof value.ownerDocumentId !== 'string'
        || !value.ownerDocumentId) {
        return null;
    }
    return {
        version: PAGE_WORKFLOW_LEASE_VERSION,
        status: 'running',
        kind: value.kind,
        runId: value.runId,
        epoch,
        ownerTabId: value.ownerTabId,
        ownerDocumentId: value.ownerDocumentId,
        startedAt: Number.isFinite(value.startedAt) ? value.startedAt : Date.now(),
        updatedAt: Number.isFinite(value.updatedAt)
            ? value.updatedAt
            : (Number.isFinite(value.startedAt) ? value.startedAt : Date.now()),
        counts: sanitizeMutatingWorkflowCounts(value.counts)
    };
}

function pageWorkflowLeaseMatches(left, right) {
    return Boolean(
        left?.status === 'running'
        && right?.status === 'running'
        && left.version === right.version
        && left.kind === right.kind
        && left.runId === right.runId
        && left.epoch === right.epoch
        && left.ownerTabId === right.ownerTabId
        && left.ownerDocumentId === right.ownerDocumentId
    );
}

async function persistPageWorkflowLease(lease) {
    if (!chrome.storage?.session?.set) throw new Error('Session storage is unavailable.');
    await chrome.storage.session.set({ [ACTIVE_PAGE_WORKFLOW_KEY]: lease });
    activePageWorkflowLease = lease;
    return lease;
}

async function hydratePageWorkflowLease() {
    if (!chrome.storage?.session?.get || !chrome.storage?.session?.set) {
        throw new Error('Session storage is unavailable.');
    }
    const stored = await chrome.storage.session.get([ACTIVE_PAGE_WORKFLOW_KEY]);
    const lease = normalizePageWorkflowLease(stored?.[ACTIVE_PAGE_WORKFLOW_KEY]);
    if (lease) {
        activePageWorkflowLease = lease;
        return lease;
    }
    return persistPageWorkflowLease(createIdlePageWorkflowLease());
}

function ensurePageWorkflowLeaseHydrated() {
    if (!pageWorkflowLeaseHydrationPromise) {
        pageWorkflowLeaseHydrationPromise = hydratePageWorkflowLease().catch((error) => {
            pageWorkflowLeaseHydrationPromise = null;
            throw error;
        });
    }
    return pageWorkflowLeaseHydrationPromise;
}

function enqueuePageWorkflowLeaseOperation(operation) {
    const execute = async () => {
        await ensurePageWorkflowLeaseHydrated();
        return operation();
    };
    const result = pageWorkflowLeaseMutationQueue.then(execute, execute);
    pageWorkflowLeaseMutationQueue = result.catch(() => {});
    return result;
}

function getPageWorkflowAuthority(request, sender) {
    const kind = String(request?.kind || '');
    const runId = String(request?.runId || '');
    const epoch = request?.epoch;
    const ownerTabId = sender?.tab?.id;
    const ownerDocumentId = String(sender?.documentId || '');
    if (!PAGE_WORKFLOW_KINDS.has(kind)
        || !runId
        || !Number.isInteger(epoch)
        || !Number.isInteger(ownerTabId)
        || !ownerDocumentId) {
        return null;
    }
    return normalizePageWorkflowLease({
        version: PAGE_WORKFLOW_LEASE_VERSION,
        status: 'running',
        kind,
        runId,
        epoch,
        ownerTabId,
        ownerDocumentId,
        startedAt: Date.now(),
        updatedAt: Date.now(),
        counts: null
    });
}

async function clearReplacedPageWorkflowOwner(sender = {}) {
    const viewerTabId = sender?.tab?.id;
    const viewerDocumentId = String(sender?.documentId || '');
    if (!Number.isInteger(viewerTabId) || !viewerDocumentId) return false;
    return enqueuePageWorkflowLeaseOperation(async () => {
        const lease = activePageWorkflowLease;
        if (lease?.status !== 'running'
            || lease.ownerTabId !== viewerTabId
            || lease.ownerDocumentId === viewerDocumentId) {
            return false;
        }
        await persistPageWorkflowLease(createIdlePageWorkflowLease(lease.epoch + 1));
        return true;
    });
}

function pingPageWorkflowOwner(lease) {
    return new Promise((resolve) => {
        let settled = false;
        const finish = (response = null) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeoutId);
            const error = chrome.runtime.lastError;
            resolve(error ? null : response);
        };
        const timeoutId = setTimeout(() => finish(null), PAGE_WORKFLOW_PING_TIMEOUT_MS);
        try {
            const result = chrome.tabs.sendMessage(
                lease.ownerTabId,
                {
                    action: 'PAGE_WORKFLOW_PING',
                    kind: lease.kind,
                    runId: lease.runId,
                    epoch: lease.epoch
                },
                { documentId: lease.ownerDocumentId },
                (response) => finish(response)
            );
            if (result && typeof result.then === 'function') {
                result.then((response) => finish(response), () => finish(null));
            }
        } catch {
            finish(null);
        }
    });
}

async function reconcileStalePageWorkflowLease() {
    const candidate = await enqueuePageWorkflowLeaseOperation(() => (
        activePageWorkflowLease?.status === 'running'
            && Date.now() - activePageWorkflowLease.updatedAt >= PAGE_WORKFLOW_HEARTBEAT_TIMEOUT_MS
            ? { ...activePageWorkflowLease }
            : null
    ));
    if (!candidate) return;
    const response = await pingPageWorkflowOwner(candidate);
    await enqueuePageWorkflowLeaseOperation(async () => {
        if (!pageWorkflowLeaseMatches(activePageWorkflowLease, candidate)) return;
        if (response?.alive === true
            && response.runId === candidate.runId
            && response.epoch === candidate.epoch) {
            await persistPageWorkflowLease({
                ...activePageWorkflowLease,
                updatedAt: Date.now()
            });
            return;
        }
        await persistPageWorkflowLease(createIdlePageWorkflowLease(candidate.epoch + 1));
    });
}

async function listActiveMutatingWorkflows(sender = {}) {
    await clearReplacedPageWorkflowOwner(sender);
    await reconcileStalePageWorkflowLease();
    const workflows = [];
    const scrapeActive = activeScrapeLease?.status === 'starting'
        || activeScrapeLease?.status === 'active'
        || activeScrapeLease?.status === 'stopping'
        || scrapeStartPending
        || scrapeStopPending
        || isScraping
        || isR2Backup;
    if (scrapeActive) {
        const kind = activeScrapeLease?.kind || (isR2Backup ? 'r2_backup' : 'sync');
        const mirror = getActiveScrapeRunMirror(activeScrapeLease);
        const backupStats = mirror?.r2BackupState && typeof mirror.r2BackupState === 'object'
            ? mirror.r2BackupState
            : null;
        workflows.push({
            kind,
            status: activeScrapeLease?.status === 'stopping' || scrapeStopPending ? 'stopping' : 'running',
            runId: activeScrapeLease?.token || '',
            epoch: Number.isInteger(activeScrapeLease?.epoch) ? activeScrapeLease.epoch : null,
            ownerTabId: Number.isInteger(activeScrapeLease?.tabId) ? activeScrapeLease.tabId : null,
            counts: kind === 'r2_backup' && backupStats ? {
                seen: Number(backupStats.totalSeen) || 0,
                uploaded: Number(backupStats.uploaded) || 0,
                alreadyPresent: Number(backupStats.alreadyPresent) || 0,
                queued: Number(backupStats.queued) || 0,
                pending: Number(backupStats.pendingTransfers) || 0,
                failed: Number(backupStats.errors) || 0
            } : {
                currentIndex: Math.max(0, Number(mirror?.currentIndex) || 0)
            }
        });
    }

    const recreateWorkflow = recreateWorkflowController?.getRunStatus
        ? await recreateWorkflowController.getRunStatus({
            includeOwner: true,
            viewerTabId: Number.isInteger(sender?.tab?.id) ? sender.tab.id : null,
            viewerDocumentId: String(sender?.documentId || '')
        })
        : recreateWorkflowController?.getActiveRunStatus?.({ includeOwner: true }) || null;
    if (recreateWorkflow) workflows.push(recreateWorkflow);

    if (generationRunController) {
        const generationStatus = await generationRunController.getGenerationRunStatus({}, sender);
        if (generationStatus?.status === 'active' && generationStatus.run) {
            workflows.push({
                kind: generationStatus.run.kind,
                status: generationStatus.run.status,
                runId: generationStatus.run.runId,
                epoch: generationStatus.run.epoch,
                ownerTabId: Number.isInteger(generationStatus.run.ownerTabId)
                    ? generationStatus.run.ownerTabId
                    : null,
                ownerDocumentId: String(generationStatus.run.ownerDocumentId || ''),
                counts: generationStatus.run.counts && typeof generationStatus.run.counts === 'object'
                    ? { ...generationStatus.run.counts }
                    : null
            });
        }
    }
    const pageWorkflow = await enqueuePageWorkflowLeaseOperation(() => (
        activePageWorkflowLease?.status === 'running'
            ? { ...activePageWorkflowLease }
            : null
    ));
    if (pageWorkflow) workflows.push(pageWorkflow);
    return workflows;
}

const GENERATION_MUTATING_WORKFLOW_KINDS = new Set([
    'quick_batch',
    'prompted_batch',
    'video_goal'
]);

function sanitizeMutatingWorkflowCounts(counts) {
    if (!counts || typeof counts !== 'object') return null;
    const allowed = [
        'accepted',
        'failed',
        'skipped',
        'pending',
        'currentIndex',
        'seen',
        'uploaded',
        'alreadyPresent',
        'queued'
    ];
    return allowed.reduce((result, key) => {
        if (!Number.isFinite(Number(counts[key]))) return result;
        result[key] = Math.max(0, Number(counts[key]));
        return result;
    }, {});
}

function getMutatingWorkflowRecoveryActions(workflow, isOwner) {
    if (!isOwner || !workflow) return [];
    if (workflow.status === 'stopping'
        && (workflow.kind === 'sync' || workflow.kind === 'r2_backup')) {
        return ['retry_stop', 'refresh_owner'];
    }
    if (workflow.kind === 'recreate' && workflow.status === 'stopping') {
        return ['retry_cancel', 'refresh_owner'];
    }
    if (workflow.kind === 'sync' || workflow.kind === 'r2_backup' || workflow.kind === 'recreate') {
        return ['stop'];
    }
    if (PAGE_WORKFLOW_KINDS.has(workflow.kind)) return ['stop'];
    if (!GENERATION_MUTATING_WORKFLOW_KINDS.has(workflow.kind)) return [];
    if (workflow.status === 'retryable_failed') return ['retry_failed', 'cancel'];
    return ['resume', 'stop'];
}

function buildPublicMutatingWorkflow(workflow, viewerTabId = null, viewerDocumentId = '') {
    if (!workflow) return null;
    const ownsTab = Number.isInteger(viewerTabId)
        && Number.isInteger(workflow.ownerTabId)
        && viewerTabId === workflow.ownerTabId;
    const requiresDocument = (GENERATION_MUTATING_WORKFLOW_KINDS.has(workflow.kind)
        || PAGE_WORKFLOW_KINDS.has(workflow.kind)
        || workflow.kind === 'recreate')
        && Boolean(workflow.ownerDocumentId);
    const isOwner = ownsTab && (!requiresDocument || viewerDocumentId === workflow.ownerDocumentId);
    const authority = isOwner && (workflow.kind === 'sync' || workflow.kind === 'r2_backup')
        ? {
            runToken: workflow.runId,
            runEpoch: workflow.epoch,
            tabId: workflow.ownerTabId,
            kind: workflow.kind
        }
        : (isOwner && workflow.runId && Number.isInteger(workflow.epoch)
            ? { runId: workflow.runId, epoch: workflow.epoch, kind: workflow.kind }
            : null);
    return {
        kind: workflow.kind,
        status: workflow.status,
        phase: typeof workflow.phase === 'string' ? workflow.phase : null,
        counts: sanitizeMutatingWorkflowCounts(workflow.counts),
        isOwner,
        recoveryActions: getMutatingWorkflowRecoveryActions(workflow, isOwner),
        authority
    };
}

async function getAuthoritativeMutatingWorkflowStatus(sender = {}) {
    let viewerTabId = Number.isInteger(sender?.tab?.id) ? sender.tab.id : null;
    const viewerDocumentId = String(sender?.documentId || '');
    if (!Number.isInteger(viewerTabId)) {
        const activeTab = await queryActiveTab().catch(() => null);
        viewerTabId = Number.isInteger(activeTab?.id) ? activeTab.id : null;
    }
    const stoppingLease = await enqueueScrapeLeaseOperation(() => (
        activeScrapeLease?.status === 'stopping'
            && activeScrapeLease.tabId === viewerTabId
            ? { ...activeScrapeLease }
            : null
    ));
    if (stoppingLease) {
        await stopScrapeRun(
            stoppingLease.kind,
            'stopped',
            getRequestedLease(stoppingLease, stoppingLease.tabId)
        ).catch(() => {});
    }
    const effectiveSender = Number.isInteger(sender?.tab?.id)
        ? sender
        : { ...sender, tab: Number.isInteger(viewerTabId) ? { id: viewerTabId } : null };
    const workflows = await listActiveMutatingWorkflows(effectiveSender);
    if (workflows.length === 0) {
        return { status: 'idle', activeWorkflow: null };
    }
    if (workflows.length > 1) {
        return {
            status: 'conflict',
            error: 'MUTATING_WORKFLOW_AUTHORITY_CONFLICT',
            activeWorkflow: {
                kind: 'authority_conflict',
                status: 'blocked',
                phase: null,
                counts: null,
                isOwner: false,
                recoveryActions: [],
                workflows: workflows.map((workflow) => (
                    buildPublicMutatingWorkflow(workflow, viewerTabId, viewerDocumentId)
                ))
            }
        };
    }
    return {
        status: 'active',
        activeWorkflow: buildPublicMutatingWorkflow(workflows[0], viewerTabId, viewerDocumentId)
    };
}

function buildMutatingWorkflowConflict(workflows) {
    if (workflows.length === 1) {
        return { status: 'conflict', activeWorkflow: buildPublicMutatingWorkflow(workflows[0]) };
    }
    return {
        status: 'conflict',
        error: 'MUTATING_WORKFLOW_AUTHORITY_CONFLICT',
        activeWorkflow: {
            kind: 'authority_conflict',
            status: 'blocked',
            workflows: workflows.map((workflow) => buildPublicMutatingWorkflow(workflow))
        }
    };
}

async function startGenerationWithGlobalAuthority(request, sender) {
    return enqueueMutatingWorkflowStart(async () => {
        const activeWorkflows = await listActiveMutatingWorkflows(sender);
        if (activeWorkflows.length > 0) return buildMutatingWorkflowConflict(activeWorkflows);
        return generationRunController.startGenerationRun(request, sender);
    });
}

async function reserveScrapeWithGlobalAuthority(kind) {
    return enqueueMutatingWorkflowStart(async () => {
        const activeWorkflows = await listActiveMutatingWorkflows();
        if (activeWorkflows.length > 0) {
            return { intent: null, conflict: buildMutatingWorkflowConflict(activeWorkflows) };
        }
        return { intent: await reserveScrapeStartIntent(kind), conflict: null };
    });
}

async function startRecreateWithGlobalAuthority(request, context) {
    return await enqueueMutatingWorkflowStart(async () => {
        const activeWorkflows = await listActiveMutatingWorkflows({
            tab: Number.isInteger(context?.sourceTabId) ? { id: context.sourceTabId } : null,
            documentId: String(context?.sourceDocumentId || '')
        });
        if (activeWorkflows.length > 0) {
            return {
                ok: false,
                error: 'workflow_active',
                ...buildMutatingWorkflowConflict(activeWorkflows)
            };
        }
        let acknowledgeStart;
        let acknowledged = false;
        const started = new Promise((resolve) => {
            acknowledgeStart = (response) => {
                if (acknowledged) return;
                acknowledged = true;
                resolve(response);
            };
        });
        const completion = recreateWorkflowController.start(request, {
            ...context,
            onStarted: acknowledgeStart
        });
        completion.then(
            (response) => acknowledgeStart(response),
            (error) => acknowledgeStart({
                ok: false,
                error: error?.message || 'workflow_failed'
            })
        );
        return await started;
    });
}

function makePageWorkflowRunId(kind) {
    const suffix = typeof globalThis.crypto?.randomUUID === 'function'
        ? globalThis.crypto.randomUUID()
        : `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    return `${kind}_${suffix}`;
}

async function startPageWorkflowWithGlobalAuthority(request, sender) {
    const kind = String(request?.kind || '');
    const ownerTabId = sender?.tab?.id;
    const ownerDocumentId = String(sender?.documentId || '');
    if (!PAGE_WORKFLOW_KINDS.has(kind)
        || !Number.isInteger(ownerTabId)
        || !ownerDocumentId) {
        return { status: 'rejected', error: 'PAGE_WORKFLOW_CONTEXT_INVALID' };
    }
    return enqueueMutatingWorkflowStart(async () => {
        const activeWorkflows = await listActiveMutatingWorkflows(sender);
        if (activeWorkflows.length > 0) return buildMutatingWorkflowConflict(activeWorkflows);
        const lease = await enqueuePageWorkflowLeaseOperation(async () => {
            if (activePageWorkflowLease?.status === 'running') return null;
            return persistPageWorkflowLease({
                version: PAGE_WORKFLOW_LEASE_VERSION,
                status: 'running',
                kind,
                runId: makePageWorkflowRunId(kind),
                epoch: (activePageWorkflowLease?.epoch || 0) + 1,
                ownerTabId,
                ownerDocumentId,
                startedAt: Date.now(),
                updatedAt: Date.now(),
                counts: sanitizeMutatingWorkflowCounts(request?.counts)
            });
        });
        if (!lease) return { status: 'rejected', error: 'PAGE_WORKFLOW_ACTIVE' };
        return {
            status: 'started',
            activeWorkflow: buildPublicMutatingWorkflow(lease, ownerTabId, ownerDocumentId)
        };
    });
}

async function updatePageWorkflow(request, sender) {
    const requested = getPageWorkflowAuthority(request, sender);
    if (!requested) return { status: 'ignored', reason: 'stale_authority' };
    return enqueuePageWorkflowLeaseOperation(async () => {
        if (!pageWorkflowLeaseMatches(activePageWorkflowLease, requested)) {
            return { status: 'ignored', reason: 'stale_authority' };
        }
        const lease = {
            ...activePageWorkflowLease,
            updatedAt: Date.now(),
            counts: sanitizeMutatingWorkflowCounts(request?.counts)
        };
        await persistPageWorkflowLease(lease);
        return {
            status: 'updated',
            activeWorkflow: buildPublicMutatingWorkflow(
                lease,
                lease.ownerTabId,
                lease.ownerDocumentId
            )
        };
    });
}

async function finishPageWorkflow(request, sender, terminalStatus) {
    const requested = getPageWorkflowAuthority(request, sender);
    if (!requested) return { status: 'ignored', reason: 'stale_authority' };
    return enqueuePageWorkflowLeaseOperation(async () => {
        if (!pageWorkflowLeaseMatches(activePageWorkflowLease, requested)) {
            return { status: 'ignored', reason: 'stale_authority' };
        }
        await persistPageWorkflowLease(createIdlePageWorkflowLease(activePageWorkflowLease.epoch + 1));
        return { status: terminalStatus };
    });
}

function notifyGenerationCancellation(details) {
    if (!Number.isInteger(details?.ownerTabId) || !chrome.tabs?.sendMessage) {
        return Promise.resolve({ acknowledged: false });
    }

    return new Promise((resolve) => {
        let settled = false;
        const finish = (acknowledged) => {
            if (settled) return;
            settled = true;
            resolve({ acknowledged });
        };

        try {
            const message = {
                action: 'GENERATION_RUN_CANCELLED',
                runId: details.runId,
                epoch: details.epoch,
                ownerDocumentId: details.ownerDocumentId
            };
            const sendOptions = details.ownerDocumentId ? { documentId: details.ownerDocumentId } : {};
            const callback = (response) => {
                if (chrome.runtime?.lastError) {
                    finish(false);
                    return;
                }
                finish(response?.acknowledged === true);
            };
            const pending = chrome.tabs.sendMessage(
                details.ownerTabId,
                message,
                sendOptions,
                callback
            );
            if (pending && typeof pending.then === 'function') {
                pending.then(
                    (response) => finish(response?.acknowledged === true),
                    () => finish(false)
                );
            }
        } catch {
            finish(false);
        }
    });
}

async function initializeGenerationRunController() {
    if (generationRunController) {
        await generationRunController.initialize();
        return generationRunController;
    }
    if (!GenerationRunController?.createGenerationRunController || !chrome.storage?.session) {
        return null;
    }

    generationRunController = GenerationRunController.createGenerationRunController({
        sessionStorage: chrome.storage.session,
        localStorage: chrome.storage.local,
        getBlockingWorkflow: getGenerationBlockingWorkflow,
        notifyCancellation: notifyGenerationCancellation
    });
    await generationRunController.initialize();
    return generationRunController;
}

async function initializeBackgroundState(context = null, storedSnapshot = null) {
    const stored = storedSnapshot || await chrome.storage.local.get(null);
    assertBackgroundInitializationCurrent(context);

    if (stored[PROCESSED_IDS_KEY]) {
        processedUUIDs = new Set(normalizeProcessedIds(stored[PROCESSED_IDS_KEY]));
        console.log(`Loaded ${processedUUIDs.size} processed UUIDs.`);
    }
    processedLocalUUIDs = new Set(normalizeProcessedIds(stored[PROCESSED_LOCAL_IDS_KEY]));
    processedR2UUIDs = new Set(normalizeProcessedIds(stored[PROCESSED_R2_IDS_KEY]));

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
    await initializeScrapePersistenceWriter(stored, context);
    assertBackgroundInitializationCurrent(context);
    await hydrateScrapeCompletionJournal(stored, context?.deadlineAt);
    assertBackgroundInitializationCurrent(context);
    hydrateScrapeRunStateRecordRevision(stored);
    if (recreateWorkflowController?.initialize) {
        await recreateWorkflowController.initialize();
        assertBackgroundInitializationCurrent(context);
    }
    await initializeGenerationRunController();
    assertBackgroundInitializationCurrent(context);
    await ensurePageWorkflowLeaseHydrated();
    assertBackgroundInitializationCurrent(context);
    const startupDownloadOperations = Array.from(pendingDownloadOperations.values())
        .map((operation) => ({ ...operation }));

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

    await recoverPreparedScrapeCompletionTransfer(context?.deadlineAt);
    assertBackgroundInitializationCurrent(context);
    const startupCloudConfig = await ensureCloudConfigExists();
    assertBackgroundInitializationCurrent(context);
    await persistCloudState();
    assertBackgroundInitializationCurrent(context);
    await scheduleCloudRetryAlarm();
    assertBackgroundInitializationCurrent(context);
    if (!CloudSync.isAcceptanceCloudConfig(startupCloudConfig)) {
        await reconcilePendingDownloadOperations(startupDownloadOperations);
    }
    assertBackgroundInitializationCurrent(context);
}

async function runBoundedBackgroundInitialization() {
    const context = {
        active: true,
        deadlineAt: Number.POSITIVE_INFINITY
    };
    const timeout = Symbol('background_initialization_timeout');
    let initialization = null;
    try {
        const stored = await chrome.storage.local.get(null);
        context.deadlineAt = Date.now() + BACKGROUND_INITIALIZATION_TIMEOUT_MS;
        initialization = initializeBackgroundState(context, stored);
        const result = await withTimeout(
            initialization.then(() => true),
            BACKGROUND_INITIALIZATION_TIMEOUT_MS,
            timeout
        );
        if (result === timeout || Date.now() >= context.deadlineAt) {
            throw createBackgroundInitializationTimeoutError();
        }
        flushDeferredLocalStorageChanges();
        backgroundStateStatus = { status: 'ready', error: null };
        return true;
    } catch (error) {
        const normalized = error?.message?.includes('timeout')
            ? createBackgroundInitializationTimeoutError()
            : error;
        backgroundStateStatus = {
            status: 'failed',
            error: normalized?.message || 'background_initialization_failed'
        };
        throw normalized;
    } finally {
        context.active = false;
        initialization?.catch(() => {});
    }
}

backgroundStateReadyPromise = runBoundedBackgroundInitialization();
backgroundStateReadyPromise.catch((e) => {
    console.error('Background initialization failed:', e);
});

async function ensureBackgroundStateReady() {
    const timeout = Symbol('background_readiness_wait_timeout');
    const result = await withTimeout(
        backgroundStateReadyPromise || Promise.resolve(true),
        BACKGROUND_READINESS_WAIT_TIMEOUT_MS,
        timeout
    );
    if (result === timeout) throw createBackgroundInitializationTimeoutError();
    return result;
}

function waitForBackgroundInitialization() {
    return backgroundStateReadyPromise || Promise.resolve(true);
}

chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === CLOUD_ALARM_NAME) {
        (async () => {
            await ensureBackgroundStateReady();
            const config = await getCloudConfig();
            if (!CloudSync.isAcceptanceCloudConfig(config)) {
                await reconcilePendingDownloadOperations();
            }
            await processCloudQueue('alarm');
        })().catch((e) => {
            if (e?.code === 'background_initialization_timeout') return;
            updateCloudError(sanitizeErrorToken(getUploadFailureStage(e), 'runtime'));
            persistCloudState().catch(() => { });
        });
    }
});

function applyLocalStorageChanges(changes) {
    if (changes[PROCESSED_IDS_KEY]) {
        processedUUIDs = new Set(normalizeProcessedIds(changes[PROCESSED_IDS_KEY].newValue));
    }
    if (changes[PROCESSED_LOCAL_IDS_KEY]) {
        processedLocalUUIDs = new Set(
            normalizeProcessedIds(changes[PROCESSED_LOCAL_IDS_KEY].newValue)
        );
    }
    if (changes[PROCESSED_R2_IDS_KEY]) {
        processedR2UUIDs = new Set(
            normalizeProcessedIds(changes[PROCESSED_R2_IDS_KEY].newValue)
        );
    }

    if (changes[CloudSync.STORAGE_KEYS.cloudConfig]) {
        const oldNormalized = CloudSync.normalizeCloudConfig(changes[CloudSync.STORAGE_KEYS.cloudConfig].oldValue);
        const newNormalized = CloudSync.normalizeCloudConfig(changes[CloudSync.STORAGE_KEYS.cloudConfig].newValue);
        const configChanged = JSON.stringify(oldNormalized) !== JSON.stringify(newNormalized);

        if (configChanged) {
            cloudConfigEpoch += 1;
            revokeActiveCloudQueueDrain();
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
}

function flushDeferredLocalStorageChanges() {
    while (deferredLocalStorageChanges.length > 0) {
        applyLocalStorageChanges(deferredLocalStorageChanges.shift());
    }
}

chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    if (backgroundStateStatus.status !== 'ready') {
        deferredLocalStorageChanges.push(changes);
        return;
    }
    applyLocalStorageChanges(changes);
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

function getTabById(tabId) {
    return new Promise((resolve, reject) => {
        if (!Number.isInteger(tabId) || typeof chrome.tabs?.get !== 'function') {
            resolve(null);
            return;
        }
        let settled = false;
        const finish = (tab) => {
            if (settled) return;
            settled = true;
            const error = chrome.runtime.lastError;
            if (error) reject(new Error(error.message));
            else resolve(tab || null);
        };
        try {
            const result = chrome.tabs.get(tabId, (tab) => finish(tab));
            if (result && typeof result.then === 'function') result.then((tab) => finish(tab), reject);
        } catch (error) {
            reject(error);
        }
    });
}

function isGrokTabUrl(value) {
    try {
        const url = new URL(String(value || ''));
        return url.protocol === 'https:'
            && (url.hostname === 'grok.com' || url.hostname.endsWith('.grok.com'));
    } catch {
        return false;
    }
}

async function isScrapeOwnerPositivelyAbsent(tabId) {
    if (!Number.isInteger(tabId) || typeof chrome.tabs?.get !== 'function') return false;
    try {
        const tab = await getTabById(tabId);
        return !tab || !isGrokTabUrl(tab.url);
    } catch (error) {
        return /no tab with id|tab not found|invalid tab/i.test(String(error?.message || ''));
    }
}

function injectContentScripts(tabId) {
    const files = [
        'providerRegistry.js',
        'providerRunLedger.js',
        'chatgptImagesContent.js',
        'grokImagineAdapter.js',
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

function queueChromeDownload(options, scrapeLease = null, transferContext = null) {
    return new Promise((resolve, reject) => {
        let settled = false;
        let finishing = false;
        const receipt = scrapeLease
            ? registerPendingScrapeDownload(options.url, scrapeLease, transferContext)
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
    const status = ['starting', 'active', 'stopping', 'idle'].includes(value.status) ? value.status : null;
    const kind = value.kind === 'sync' || value.kind === 'r2_backup' ? value.kind : null;
    const epoch = Number.isInteger(value.epoch) && value.epoch >= 0 ? value.epoch : null;
    const writerEpoch = Number.isInteger(value.writerEpoch) && value.writerEpoch >= 0
        ? value.writerEpoch
        : 0;
    const writerId = value.writerId === undefined
        ? ''
        : normalizeScrapePersistenceWriterId(value.writerId, { allowLegacy: true });
    if (writerId === null) return null;
    if (!status || epoch === null || value.version !== SCRAPE_LEASE_VERSION) return null;
    if (status !== 'idle') {
        if (!kind || typeof value.token !== 'string' || !value.token) return null;
        if ((status === 'active' || status === 'stopping') && !Number.isInteger(value.tabId)) return null;
    }
    return {
        version: SCRAPE_LEASE_VERSION,
        writerEpoch,
        writerId,
        epoch,
        token: status !== 'idle' ? value.token : null,
        tabId: status === 'active' || status === 'stopping' ? value.tabId : null,
        kind: status !== 'idle' ? kind : null,
        status,
        startedAt: status !== 'idle' && Number.isFinite(value.startedAt) ? value.startedAt : null
    };
}

function createIdleScrapeLease(epoch = 0) {
    return {
        version: SCRAPE_LEASE_VERSION,
        writerEpoch: scrapePersistenceWriterEpoch,
        writerId: scrapePersistenceWriterId,
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
        && (left.writerEpoch || 0) === (right.writerEpoch || 0)
        && (left.writerId || '') === (right.writerId || '')
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
        && (left.writerEpoch || 0) === (right.writerEpoch || 0)
        && (left.writerId || '') === (right.writerId || '')
        && left.epoch === right.epoch
        && left.token === right.token
        && left.tabId === right.tabId
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

function buildAuthoritativeIdleLocalState(
    stored = {},
    stopReason = 'stopped',
    { clearBackupProgress = false } = {}
) {
    const values = {
        scraperState: 'idle',
        currentIndex: 0,
        scrapeRunToken: null,
        scrapeRunEpoch: null,
        scrapeNavigation: null,
        currentItemId: null,
        scrapeFailures: null,
        scrapeBackupOptions: null,
        scrapeEntryLimitState: null,
        scrapeDestinations: null,
        isScraping: false,
        isR2Backup: false,
        scrapeStopReason: stopReason
    };
    if (stored.r2BackupState && typeof stored.r2BackupState === 'object') {
        values.r2BackupState = clearBackupProgress
            ? { isRunning: false, stopReason }
            : {
                ...stored.r2BackupState,
                isRunning: false,
                stopReason
            };
    }
    return values;
}

function buildImmutableStorageKey(prefix, revision, identity) {
    const suffix = Math.random().toString(16).slice(2, 10);
    return `${prefix}${revision}:${identity}:${Date.now()}:${suffix}`;
}

function normalizeScrapePersistenceWriterId(value, { allowLegacy = false } = {}) {
    if (allowLegacy && (value === undefined || value === '')) return '';
    if (typeof value !== 'string' || value.length < 1 || value.length > 128) return null;
    return /^[A-Za-z0-9._:-]+$/.test(value) ? value : null;
}

function makeScrapePersistenceWriterId() {
    const writerId = globalThis.crypto?.randomUUID?.();
    const normalized = normalizeScrapePersistenceWriterId(writerId);
    if (!normalized) throw new Error('scrape_persistence_writer_identity_unavailable');
    return normalized;
}

function getScrapePersistenceAuthorityKey(value = {}) {
    const order = getScrapePersistenceOrder(value);
    return `${order.writerEpoch}:${order.writerId}`;
}

function getScrapePersistenceOrder(value = {}) {
    const checkpointFence = value?.checkpoint?.fence || value?.fence;
    const source = checkpointFence
        && Number.isInteger(checkpointFence.writerEpoch)
        && Number.isInteger(checkpointFence.revision)
        ? checkpointFence
        : value;
    return {
        writerEpoch: Number.isInteger(source.writerEpoch) && source.writerEpoch >= 0
            ? source.writerEpoch
            : 0,
        writerId: normalizeScrapePersistenceWriterId(source.writerId, { allowLegacy: true }) || '',
        revision: Number.isInteger(source.revision) && source.revision >= 0
            ? source.revision
            : 0
    };
}

function compareScrapePersistenceOrder(left, right) {
    const leftOrder = getScrapePersistenceOrder(left);
    const rightOrder = getScrapePersistenceOrder(right);
    if (leftOrder.writerEpoch !== rightOrder.writerEpoch) {
        return leftOrder.writerEpoch - rightOrder.writerEpoch;
    }
    if (leftOrder.writerId !== rightOrder.writerId) {
        return leftOrder.writerId.localeCompare(rightOrder.writerId);
    }
    return leftOrder.revision - rightOrder.revision;
}

function getScrapePersistenceWriterRecords(stored = {}) {
    return Object.entries(stored).reduce((records, [key, value]) => {
        if (!key.startsWith(SCRAPE_PERSISTENCE_WRITER_PREFIX)) return records;
        const legacy = value?.version === 1 && value.writerId === undefined;
        const writerId = legacy
            ? ''
            : normalizeScrapePersistenceWriterId(value?.writerId);
        const claimId = value?.version === 3
            ? normalizeScrapePersistenceWriterId(value?.claimId)
            : `legacy-marker:${key}`;
        if (value?.kind !== 'scrape_persistence_writer'
            || !Number.isInteger(value.writerEpoch)
            || value.writerEpoch < 0
            || (!legacy && !writerId)
            || !claimId) {
            throw new Error('scrape_persistence_writer_record_invalid');
        }
        if (value.version !== 1 && value.version !== 2 && value.version !== 3) {
            throw new Error('scrape_persistence_writer_record_invalid');
        }
        records.push({ ...value, writerId, claimId, storageKey: key });
        return records;
    }, []).sort((left, right) => (
        right.writerEpoch - left.writerEpoch
        || right.writerId.localeCompare(left.writerId)
        || right.storageKey.localeCompare(left.storageKey)
    ));
}

async function removeScrapePersistenceWriterRecords(records) {
    const keys = records.map((record) => record.storageKey).filter(Boolean);
    if (keys.length === 0) return;
    if (typeof chrome.storage?.local?.remove !== 'function') {
        throw new Error('scrape_persistence_writer_compaction_unavailable');
    }
    await chrome.storage.local.remove(keys);
}

async function initializeScrapePersistenceWriter(stored = {}, context = null) {
    const writerRecords = getScrapePersistenceWriterRecords(stored);
    const claimsByAuthority = new Map();
    for (const record of writerRecords) {
        const authorityKey = getScrapePersistenceAuthorityKey(record);
        if (!claimsByAuthority.has(authorityKey)) claimsByAuthority.set(authorityKey, new Set());
        claimsByAuthority.get(authorityKey).add(record.claimId);
    }
    ambiguousScrapePersistenceAuthorities = new Set(
        Array.from(claimsByAuthority.entries())
            .filter(([, claimIds]) => claimIds.size > 1)
            .map(([authorityKey]) => authorityKey)
    );
    const observedEpoch = Object.values(stored).reduce((latest, value) => {
        if (value?.kind !== 'scrape_run_state_record'
            && value?.kind !== 'scrape_completion_journal') {
            return latest;
        }
        return Math.max(latest, getScrapePersistenceOrder(value).writerEpoch);
    }, writerRecords[0]?.writerEpoch || 0);
    const writerEpoch = observedEpoch + 1;
    const writerId = makeScrapePersistenceWriterId();
    const claimId = makeScrapePersistenceWriterId();
    const record = {
        kind: 'scrape_persistence_writer',
        version: 3,
        writerEpoch,
        writerId,
        claimId
    };
    const storageKey = buildImmutableStorageKey(
        SCRAPE_PERSISTENCE_WRITER_PREFIX,
        writerEpoch,
        writerId
    );
    await chrome.storage.local.set({
        [storageKey]: record
    });
    assertBackgroundInitializationCurrent(context);
    scrapePersistenceWriterEpoch = writerEpoch;
    scrapePersistenceWriterId = writerId;
    scrapePersistenceWriterClaimId = claimId;
    await removeScrapePersistenceWriterRecords(writerRecords);
    assertBackgroundInitializationCurrent(context);
}

async function ensureScrapePersistenceWriterForRevocation() {
    if (scrapePersistenceWriterId) return true;
    const context = {
        active: true,
        deadlineAt: Date.now() + PENDING_DOWNLOAD_MUTATION_TIMEOUT_MS
    };
    const timeout = Symbol('scrape_revocation_writer_timeout');
    const claim = (async () => {
        const stored = await chrome.storage.local.get(null);
        assertBackgroundInitializationCurrent(context);
        await initializeScrapePersistenceWriter(stored, context);
        return true;
    })();
    try {
        const result = await withTimeout(
            claim,
            PENDING_DOWNLOAD_MUTATION_TIMEOUT_MS,
            timeout
        );
        if (result !== true || Date.now() >= context.deadlineAt) {
            throw new Error('scrape_revocation_writer_timeout');
        }
        return true;
    } finally {
        context.active = false;
        claim.catch(() => {});
    }
}

function parseScrapeRunStateRecord(storageKey, value) {
    if (!storageKey.startsWith(SCRAPE_RUN_STATE_RECORD_PREFIX)
        || value?.kind !== 'scrape_run_state_record'
        || !Number.isInteger(value.revision)
        || value.revision < 0
        || !normalizeScrapeLease(value.lease)
        || !value.mirror
        || typeof value.mirror !== 'object'
        || Array.isArray(value.mirror)) {
        return null;
    }
    const legacy = value.version === 2 && value.writerId === undefined;
    const writerId = legacy
        ? ''
        : normalizeScrapePersistenceWriterId(value.writerId);
    const claimId = value.version === 4
        ? normalizeScrapePersistenceWriterId(value.claimId)
        : `legacy-record:${storageKey}`;
    if ((value.version !== 2 && value.version !== 3 && value.version !== 4)
        || (!legacy && !writerId)
        || !claimId) return null;
    return { ...value, writerId, claimId, storageKey };
}

function getScrapeRunStateRecords(stored = {}) {
    return Object.entries(stored).reduce((records, [key, value]) => {
        const record = parseScrapeRunStateRecord(key, value);
        if (record) records.push(record);
        return records;
    }, []);
}

function hydrateScrapeRunStateRecordRevision(stored = {}) {
    const records = getScrapeRunStateRecords(stored);
    const latest = records
        .filter((record) => {
            const order = getScrapePersistenceOrder(record);
            return order.writerEpoch === scrapePersistenceWriterEpoch
                && order.writerId === scrapePersistenceWriterId
                && record.claimId === scrapePersistenceWriterClaimId;
        })
        .reduce(
            (revision, record) => Math.max(revision, record.revision),
            0
        );
    scrapeRunStateRecordRevision = Math.max(scrapeRunStateRecordRevision, latest);
    latestScrapeRunStateAttemptRevision = Math.max(latestScrapeRunStateAttemptRevision, latest);
}

function rawScrapeRunStateRecordTargetsLease(value, lease) {
    return Boolean(
        value?.kind === 'scrape_run_state_record'
        && value.lease
        && value.lease.token === lease.token
        && value.lease.epoch === lease.epoch
        && value.lease.tabId === lease.tabId
        && value.lease.kind === lease.kind
    );
}

function scrapeRunStateRecordsEquivalent(left, right) {
    return JSON.stringify({
        lease: normalizeScrapeLease(left.lease),
        mirror: left.mirror
    }) === JSON.stringify({
        lease: normalizeScrapeLease(right.lease),
        mirror: right.mirror
    });
}

function getLatestScrapeRunStateRecord(stored, lease) {
    const targetedEntries = Object.entries(stored).filter(([key, value]) => (
        key.startsWith(SCRAPE_RUN_STATE_RECORD_PREFIX)
        && rawScrapeRunStateRecordTargetsLease(value, lease)
    ));
    if (targetedEntries.some(([key, value]) => !parseScrapeRunStateRecord(key, value))) {
        return { status: 'invalid', record: null };
    }
    const records = targetedEntries
        .map(([key, value]) => parseScrapeRunStateRecord(key, value));
    if (records.some((record) => !scrapeLeaseMatches(normalizeScrapeLease(record.lease), lease))) {
        return { status: 'conflict', record: null };
    }
    const claimsByAuthority = new Map();
    for (const record of records) {
        const authorityKey = getScrapePersistenceAuthorityKey(record);
        if (!claimsByAuthority.has(authorityKey)) claimsByAuthority.set(authorityKey, new Set());
        claimsByAuthority.get(authorityKey).add(record.claimId);
    }
    if (Array.from(claimsByAuthority.entries()).some(([authorityKey, claimIds]) => (
        claimIds.size > 1 || ambiguousScrapePersistenceAuthorities.has(authorityKey)
    ))) {
        return { status: 'conflict', record: null };
    }
    records.sort((left, right) => compareScrapePersistenceOrder(right, left));
    if (records.length === 0) return { status: 'missing', record: null };
    const tied = records.filter((record) => compareScrapePersistenceOrder(record, records[0]) === 0);
    if (tied.some((record) => !scrapeRunStateRecordsEquivalent(record, records[0]))) {
        return { status: 'invalid', record: null };
    }
    tied.sort((left, right) => right.storageKey.localeCompare(left.storageKey));
    return { status: 'ok', record: tied[0] };
}

function setActiveScrapeRunMirror(record) {
    activeScrapeRunMirror = record ? {
        lease: copyScrapeLeaseAuthority(record.lease),
        writerEpoch: getScrapePersistenceOrder(record).writerEpoch,
        writerId: getScrapePersistenceOrder(record).writerId,
        claimId: record.claimId || '',
        revision: record.revision,
        storageKey: record.storageKey || null,
        mirror: { ...record.mirror }
    } : null;
}

async function removeScrapeRunStateRecords(storageKeys, deadlineAt = Date.now() + PENDING_DOWNLOAD_MUTATION_TIMEOUT_MS) {
    const keys = Array.from(new Set(storageKeys)).filter(Boolean);
    if (keys.length === 0) return true;
    if (typeof chrome.storage?.local?.remove !== 'function') return false;
    try {
        const timeout = Symbol('scrape_run_state_compaction_timeout');
        const result = await withTimeout(
            Promise.resolve(chrome.storage.local.remove(keys)).then(() => true, () => false),
            Math.max(0, deadlineAt - Date.now()),
            timeout
        );
        return result === true && Date.now() < deadlineAt;
    } catch {
        return false;
    }
}

async function pruneScrapeRunStateRecords(retainedStorageKey = null, cutoff = {
    writerEpoch: scrapePersistenceWriterEpoch,
    writerId: scrapePersistenceWriterId,
    revision: latestScrapeRunStateAttemptRevision
}) {
    const deadlineAt = Date.now() + PENDING_DOWNLOAD_MUTATION_TIMEOUT_MS;
    const timeout = Symbol('scrape_run_state_discovery_timeout');
    try {
        const stored = await withTimeout(
            Promise.resolve(chrome.storage.local.get(null)),
            Math.max(0, deadlineAt - Date.now()),
            timeout
        );
        if (stored === timeout || Date.now() >= deadlineAt) return false;
        const keys = getScrapeRunStateRecords(stored)
            .filter((record) => record.storageKey !== retainedStorageKey)
            .filter((record) => compareScrapePersistenceOrder(record, cutoff) <= 0)
            .map((record) => record.storageKey);
        return removeScrapeRunStateRecords(keys, deadlineAt);
    } catch {
        return false;
    }
}

function getActiveScrapeRunMirror(lease = activeScrapeLease) {
    return scrapeLeaseMatches(activeScrapeRunMirror?.lease, lease)
        ? { ...activeScrapeRunMirror.mirror }
        : null;
}

async function readEffectiveScrapeRunState(lease, keys) {
    const mirror = getActiveScrapeRunMirror(lease);
    if (mirror) return mirror;
    return chrome.storage.local.get(keys);
}

async function persistScrapeLease(lease) {
    const session = chrome.storage?.session;
    if (!session || typeof session.set !== 'function') {
        throw new Error('Session storage is unavailable.');
    }
    await session.set({ [ACTIVE_SCRAPE_RUN_TOKEN_KEY]: lease });
    activeScrapeLease = lease;
    if (!scrapeLeaseMatches(activeScrapeRunMirror?.lease, lease)) {
        setActiveScrapeRunMirror(null);
        pruneScrapeRunStateRecords();
    }
    return lease;
}

async function hydrateScrapeLeaseAuthority() {
    const session = chrome.storage?.session;
    if (!session || typeof session.get !== 'function' || typeof session.set !== 'function') {
        throw new Error('Session storage is unavailable.');
    }
    const [sessionValues, stored] = await Promise.all([
        session.get([ACTIVE_SCRAPE_RUN_TOKEN_KEY]),
        chrome.storage.local.get(null)
    ]);
    hydrateScrapeRunStateRecordRevision(stored);
    const storedLease = normalizeScrapeLease(sessionValues?.[ACTIVE_SCRAPE_RUN_TOKEN_KEY]);
    const runStateSelection = storedLease?.status === 'active'
        ? getLatestScrapeRunStateRecord(stored, storedLease)
        : { status: 'missing', record: null };
    const runStateRecord = runStateSelection.record;
    const effectiveStored = runStateSelection.status === 'ok'
        ? runStateRecord.mirror
        : (runStateSelection.status === 'missing' ? stored : {});
    if (storedLease?.status === 'active' && localRunMatchesLease(effectiveStored, storedLease)) {
        activeScrapeLease = storedLease;
        setActiveScrapeRunMirror(runStateRecord || {
            lease: storedLease,
            revision: 0,
            mirror: effectiveStored
        });
        await pruneScrapeRunStateRecords(runStateRecord?.storageKey || null);
        isScraping = true;
        isR2Backup = storedLease.kind === 'r2_backup';
        scrapeStartPending = false;
        return storedLease;
    }

    if (storedLease?.status === 'stopping') {
        activeScrapeLease = storedLease;
        isScraping = false;
        isR2Backup = false;
        scrapeStartPending = false;
        scrapeStopPending = true;
        await chrome.storage.local.set(buildAuthoritativeIdleLocalState(stored, 'stopping'));
        setTimeout(() => {
            stopScrapeRun(
                storedLease.kind,
                'stopped',
                getRequestedLease(storedLease, storedLease.tabId)
            ).catch(() => {});
        }, 0);
        return storedLease;
    }

    const nextEpoch = storedLease?.status === 'active' || storedLease?.status === 'starting'
        ? storedLease.epoch + 1
        : (storedLease?.epoch || 0);
    const tombstone = await persistScrapeLease(createIdleScrapeLease(nextEpoch));
    isScraping = false;
    isR2Backup = false;
    scrapeStartPending = false;
    await pruneScrapeRunStateRecords();
    if (hasStaleLocalRunState(stored) || hasStaleLocalRunState(effectiveStored)) {
        const stopReason = runStateSelection.status === 'invalid'
            || runStateSelection.status === 'conflict'
            ? 'invalid_persisted_run_state'
            : 'stale_session';
        await chrome.storage.local.set(buildAuthoritativeIdleLocalState(stored, stopReason, {
            clearBackupProgress: runStateSelection.status === 'conflict'
        }));
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

function normalizeSyncEntryLimit(value) {
    const limit = Number(value);
    return Number.isInteger(limit) && limit > 0 && limit <= MAX_SYNC_ENTRY_LIMIT
        ? limit
        : null;
}

function getRequestedLease(value, senderTabId = null) {
    if (value && typeof value === 'object') {
        const token = value.token ?? value.runToken;
        const epoch = value.epoch ?? value.runEpoch;
        const kind = value.kind || (value.isR2Backup ? 'r2_backup' : 'sync');
        const writerEpoch = activeScrapeLease
            && activeScrapeLease.status !== 'idle'
            && activeScrapeLease.token === token
            && activeScrapeLease.epoch === epoch
            && activeScrapeLease.kind === kind
            && activeScrapeLease.tabId === senderTabId
            ? activeScrapeLease.writerEpoch
            : 0;
        const writerId = writerEpoch > 0 ? (activeScrapeLease.writerId || '') : '';
        return normalizeScrapeLease({
            version: SCRAPE_LEASE_VERSION,
            writerEpoch,
            writerId,
            epoch,
            token,
            tabId: Number.isInteger(senderTabId) ? senderTabId : value.tabId,
            kind,
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
        const stored = await readEffectiveScrapeRunState(requested, [
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
    'scrapeFailures',
    'scrapeBackupOptions',
    'scrapeEntryLimitState',
    'r2BackupState',
    'scrapeDestinations'
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
    const startedAt = Date.now();
    const deadlineAt = Math.min(
        Number.isFinite(request?.deadlineAt)
            ? request.deadlineAt
            : startedAt + PENDING_DOWNLOAD_MUTATION_TIMEOUT_MS,
        startedAt + PENDING_DOWNLOAD_MUTATION_TIMEOUT_MS
    );
    const prepared = await enqueueScrapeLeaseOperation(() => {
        if (!scrapeLeaseMatches(activeScrapeLease, requested)) {
            return { response: { status: 'ignored', reason: 'stale_authority' } };
        }
        if (Date.now() >= deadlineAt) {
            return { response: { status: 'ignored', reason: 'persistence_timeout' } };
        }
        const revision = ++scrapeRunStateRecordRevision;
        latestScrapeRunStateAttemptRevision = revision;
        const record = {
            kind: 'scrape_run_state_record',
            version: 4,
            writerEpoch: scrapePersistenceWriterEpoch,
            writerId: scrapePersistenceWriterId,
            claimId: scrapePersistenceWriterClaimId,
            revision,
            lease: copyScrapeLeaseAuthority(requested),
            mirror: buildAuthorizedRunningMirror(requested, {
                ...(getActiveScrapeRunMirror(requested) || {}),
                ...request.values
            }),
            createdAt: Date.now()
        };
        return {
            record,
            storageKey: buildImmutableStorageKey(
                SCRAPE_RUN_STATE_RECORD_PREFIX,
                revision,
                `${scrapePersistenceWriterEpoch}:${scrapePersistenceWriterId}:${requested.epoch}:${requested.token}`
            )
        };
    });
    if (prepared.response) return prepared.response;
    const timeout = Symbol('scrape_run_state_persist_timeout');
    const failed = Symbol('scrape_run_state_persist_failed');
    const write = Promise.resolve(chrome.storage.local.set({
        [prepared.storageKey]: prepared.record
    }));
    const result = await withTimeout(
        write.then(() => true, () => failed),
        Math.max(0, deadlineAt - Date.now()),
        timeout
    );
    if (Date.now() >= deadlineAt || result !== true) {
        write.then(() => removeScrapeRunStateRecords([prepared.storageKey]), () => {
            // A rejected unique write has no persisted key to prune.
        });
        return {
            status: 'ignored',
            reason: Date.now() >= deadlineAt || result === timeout
                ? 'persistence_timeout'
                : 'persistence_failed'
        };
    }

    return enqueueScrapeLeaseOperation(() => {
        if (Date.now() >= deadlineAt) {
            return { status: 'ignored', reason: 'persistence_timeout' };
        }
        if (!scrapeLeaseMatches(activeScrapeLease, requested)
            || prepared.record.writerEpoch !== scrapePersistenceWriterEpoch
            || prepared.record.writerId !== scrapePersistenceWriterId
            || prepared.record.claimId !== scrapePersistenceWriterClaimId
            || prepared.record.revision !== latestScrapeRunStateAttemptRevision) {
            return { status: 'ignored', reason: 'stale_authority' };
        }
        setActiveScrapeRunMirror({ ...prepared.record, storageKey: prepared.storageKey });
        pruneScrapeRunStateRecords(prepared.storageKey, prepared.record);
        return { status: 'ok' };
    });
}

async function getAuthorizedScrapeTransferLease(request, sender) {
    const requested = getRunScopedScrapeLease(request, sender?.tab?.id ?? null);
    const authoritySnapshot = await enqueueScrapeLeaseOperation(() => (
        scrapeLeaseMatches(activeScrapeLease, requested) ? { ...requested } : null
    ));
    if (!authoritySnapshot) return null;
    const stored = await readEffectiveScrapeRunState(requested, [
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
        writerEpoch: Number.isInteger(lease.writerEpoch) ? lease.writerEpoch : 0,
        writerId: normalizeScrapePersistenceWriterId(lease.writerId, { allowLegacy: true }) || '',
        epoch: lease.epoch,
        token: lease.token,
        tabId: lease.tabId,
        kind: lease.kind,
        status: 'active',
        startedAt: lease.startedAt || Date.now()
    };
}

function copyScrapeCompletionLeaseAuthority(lease) {
    const copied = copyScrapeLeaseAuthority(lease);
    if (lease.status === 'starting') copied.status = 'starting';
    return copied;
}

function getDownloadOperationScrapeLease(operation) {
    return normalizeScrapeLease(operation?.scrapeLease);
}

function registerPendingScrapeDownload(url, lease, transferContext = null) {
    const key = String(url || '');
    const receipt = {
        url: key,
        lease: copyScrapeLeaseAuthority(lease),
        downloadId: null,
        claimed: false,
        revoked: false,
        promptText: String(transferContext?.promptText || ''),
        captureMetadata: transferContext?.captureMetadata || null,
        requireCaptureMetadata: transferContext?.requireCaptureMetadata === true
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

function countPendingScrapeDownloadReceipts(lease) {
    const receipts = new Set();
    for (const receiptList of pendingScrapeDownloadReceiptsByUrl.values()) {
        for (const receipt of receiptList) {
            if (scrapeLeaseMatches(receipt?.lease, lease)) receipts.add(receipt);
        }
    }
    for (const receipt of pendingScrapeDownloadReceiptsById.values()) {
        if (scrapeLeaseMatches(receipt?.lease, lease)) receipts.add(receipt);
    }
    return receipts.size;
}

function getScrapeDurabilitySnapshot(lease) {
    const key = scrapeTransferKey(lease);
    const inFlightTasks = activeScrapeTransferTasks.get(key)?.size || 0;
    const inFlightByKind = Object.fromEntries(
        Array.from(activeScrapeTransferKinds.get(key)?.entries() || [])
            .filter(([, count]) => count > 0)
            .sort(([left], [right]) => (left < right ? -1 : (left > right ? 1 : 0)))
    );
    const pendingDownloads = countPendingScrapeDownloadReceipts(lease);
    const ownedOperations = Array.from(pendingDownloadOperations.values())
        .filter((record) => recordOwnedByScrapeLease(record, lease));
    const ownedQueue = cloudSyncQueue
        .filter((record) => recordOwnedByScrapeLease(record, lease));
    const failedItems = [...ownedOperations, ...ownedQueue].filter((record) => (
        Boolean(record.lastError)
        && (record.attempts || 0) >= CloudSync.MAX_RETRY_ATTEMPTS
    )).length;
    const pendingOperations = ownedOperations.length;
    const pendingQueueItems = ownedQueue.length;
    const pendingCount = inFlightTasks
        + pendingDownloads
        + pendingOperations
        + pendingQueueItems;
    return {
        status: failedItems > 0
            ? 'failed'
            : (pendingCount > 0 ? 'pending' : 'durable'),
        inFlightTasks,
        inFlightByKind,
        pendingDownloads,
        pendingOperations,
        pendingQueueItems,
        failedItems
    };
}

async function revokeScrapeDownloadAuthority(lease) {
    clearR2BackupInventoryCache(lease);
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

function clearR2BackupInventoryCache(lease) {
    if (!lease) return;
    r2BackupInventoryPromises.delete(scrapeTransferKey(lease));
}

function getR2BackupInventoryForLease(config, lease, assertAuthorized) {
    const key = scrapeTransferKey(lease);
    let inventoryPromise = r2BackupInventoryPromises.get(key);
    if (!inventoryPromise) {
        inventoryPromise = loadVerifiedVaultInventory(config, assertAuthorized);
        r2BackupInventoryPromises.set(key, inventoryPromise);
        inventoryPromise.catch(() => {
            if (r2BackupInventoryPromises.get(key) === inventoryPromise) {
                r2BackupInventoryPromises.delete(key);
            }
        });
    }
    return inventoryPromise;
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

function trackScrapeTransferTask(lease, operation, taskKind = 'generic') {
    const key = scrapeTransferKey(lease);
    const tasks = activeScrapeTransferTasks.get(key) || new Set();
    const kinds = activeScrapeTransferKinds.get(key) || new Map();
    const kind = typeof taskKind === 'string' && /^[a-z_]+$/.test(taskKind)
        ? taskKind
        : 'generic';
    const controller = registerScrapeTransferAbortController(lease);
    const task = Promise.resolve().then(() => operation(controller.signal));
    tasks.add(task);
    activeScrapeTransferTasks.set(key, tasks);
    kinds.set(kind, (kinds.get(kind) || 0) + 1);
    activeScrapeTransferKinds.set(key, kinds);
    task.finally(() => {
        releaseScrapeTransferAbortController(lease, controller);
        tasks.delete(task);
        if (tasks.size === 0) activeScrapeTransferTasks.delete(key);
        const remaining = (kinds.get(kind) || 1) - 1;
        if (remaining > 0) kinds.set(kind, remaining);
        else kinds.delete(kind);
        if (kinds.size === 0) activeScrapeTransferKinds.delete(key);
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
    if (!drained) {
        activeScrapeTransferTasks.delete(key);
        activeScrapeTransferKinds.delete(key);
    }
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
    const message = {
        action,
        runToken: lease.token,
        runEpoch: lease.epoch
    };
    if (stopNavigation) message.stopNavigation = stopNavigation;

    const deadline = Date.now() + SCRAPE_ABORT_TIMEOUT_MS;
    while (Date.now() < deadline) {
        const remaining = deadline - Date.now();
        try {
            const response = await withTimeout(
                sendMessageToTab(lease.tabId, message),
                Math.min(SCRAPE_ABORT_ATTEMPT_TIMEOUT_MS, remaining),
                null
            );
            if (response?.status === 'stopped') return true;
        } catch { }

        if (!stopNavigation) return false;
        const retryDelay = Math.min(SCRAPE_ABORT_RETRY_DELAY_MS, deadline - Date.now());
        if (retryDelay <= 0) break;
        await new Promise((resolve) => setTimeout(resolve, retryDelay));
    }
    return false;
}

async function reserveScrapeStartIntent(kind) {
    return enqueueScrapeLeaseOperation(async () => {
        if (
            activeScrapeLease?.status === 'active'
            || activeScrapeLease?.status === 'starting'
            || activeScrapeLease?.status === 'stopping'
            || scrapeStartPending
            || scrapeStopPending
        ) {
            return null;
        }
        const lease = {
            version: SCRAPE_LEASE_VERSION,
            writerEpoch: scrapePersistenceWriterEpoch,
            writerId: scrapePersistenceWriterId,
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
        const stored = await readEffectiveScrapeRunState(lease, ['r2BackupState']);
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
            const stored = await readEffectiveScrapeRunState(lease, ['r2BackupState']);
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
        const reservation = await reserveScrapeWithGlobalAuthority(backup ? 'r2_backup' : 'sync');
        intent = reservation.intent;
        if (reservation.conflict) {
            return {
                status: 'error',
                surface: 'unsupported',
                error: 'Another mutating extension workflow is already active.',
                activeWorkflow: reservation.conflict.activeWorkflow
            };
        }
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

async function getAuthoritativeScrapeStatus() {
    return enqueueScrapeLeaseOperation(() => {
        const lease = activeScrapeLease;
        if (lease?.status === 'stopping' || scrapeStopPending) {
            return {
                status: 'stopping',
                isScraping: true,
                isR2Backup: lease?.kind === 'r2_backup',
                kind: lease?.kind || null,
                runToken: lease?.token || null,
                runEpoch: Number.isInteger(lease?.epoch) ? lease.epoch : null
            };
        }
        if (lease?.status === 'active') {
            return {
                status: 'running',
                isScraping: true,
                isR2Backup: lease.kind === 'r2_backup',
                kind: lease.kind,
                runToken: lease.token,
                runEpoch: lease.epoch
            };
        }
        if (lease?.status === 'starting' || scrapeStartPending) {
            return {
                status: 'starting',
                isScraping: false,
                isR2Backup: lease?.kind === 'r2_backup',
                kind: lease?.kind || null,
                runToken: lease?.token || null,
                runEpoch: Number.isInteger(lease?.epoch) ? lease.epoch : null
            };
        }
        return {
            status: 'idle',
            isScraping: false,
            isR2Backup: false,
            kind: null,
            runToken: null,
            runEpoch: null
        };
    });
}

async function releaseFailedScrapeStopAuthority(stopReason, expectedLease = null) {
    try {
        return await enqueueScrapeLeaseOperation(async () => {
            const stoppingLease = activeScrapeLease?.status === 'stopping'
                ? { ...activeScrapeLease }
                : null;
            if (!stoppingLease) return false;
            if (expectedLease && !scrapeLeaseIdentityMatches(stoppingLease, expectedLease)) return false;
            await persistScrapeLease(createIdleScrapeLease(stoppingLease.epoch + 1));
            scrapeStartPending = false;
            scrapeStopPending = false;
            isScraping = false;
            isR2Backup = false;
            const stored = await chrome.storage.local.get(['r2BackupState']);
            await chrome.storage.local.set(buildAuthoritativeIdleLocalState(
                stored,
                `${stopReason}_cleanup_failed`
            ));
            return true;
        });
    } catch {
        scrapeStopPending = true;
        return false;
    }
}

async function stopScrapeRun(requestedKind = null, stopReason = 'stopped', expectedAuthority = null) {
    await ensureScrapePersistenceWriterForRevocation();
    let prepared;
    try {
        prepared = await enqueueScrapeLeaseOperation(async () => {
            const lease = activeScrapeLease?.status === 'active'
                || activeScrapeLease?.status === 'starting'
                || activeScrapeLease?.status === 'stopping'
                ? { ...activeScrapeLease }
                : null;
            if (expectedAuthority && !scrapeLeaseIdentityMatches(lease, expectedAuthority)) {
                return { response: { status: 'ignored', reason: 'stale_authority' } };
            }
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
                return {
                    response: {
                        status: 'stopped',
                        abortAcknowledged: false,
                        transferDrained: true
                    }
                };
            }
            if (requestedKind && lease.kind !== requestedKind) {
                return { response: { status: 'error', error: `The active run is ${lease.kind}.` } };
            }

            if (lease.status === 'starting') {
                const tombstone = await persistScrapeLease(createIdleScrapeLease(lease.epoch + 1));
                scrapeStartPending = false;
                scrapeStopPending = false;
                isScraping = false;
                isR2Backup = false;
                const stored = await chrome.storage.local.get(['r2BackupState']);
                await chrome.storage.local.set(buildAuthoritativeIdleLocalState(stored, stopReason));
                return {
                    response: {
                        status: 'stopped',
                        abortAcknowledged: true,
                        ownerAbsent: true,
                        transferDrained: true,
                        runEpoch: tombstone.epoch
                    }
                };
            }

            scrapeStopPending = true;
            const abortLease = { ...lease, status: 'active' };
            const stored = lease.status === 'active'
                ? await readEffectiveScrapeRunState(lease, ['r2BackupState', 'scrapeNavigation'])
                : await chrome.storage.local.get(['r2BackupState', 'scrapeNavigation']);
            const stopNavigation = stored.scrapeNavigation || null;
            if (lease.status === 'active') {
                markScrapeCompletionTransitionRevoked(lease);
                await persistScrapeLease({ ...lease, status: 'stopping' });
                clearR2BackupInventoryCache(lease);
                abortScrapeTransferControllers(lease);
                scrapeStartPending = false;
                isScraping = false;
                isR2Backup = false;
                await chrome.storage.local.set(buildAuthoritativeIdleLocalState(stored, 'stopping'));
                await revokeScrapeDownloadAuthority(lease);
            }
            return {
                abortLease,
                stoppingLease: { ...lease, status: 'stopping' },
                stopNavigation
            };
        });
    } catch (error) {
        await releaseFailedScrapeStopAuthority(stopReason);
        throw error;
    }

    if (prepared.response) return prepared.response;
    const { abortLease, stoppingLease, stopNavigation } = prepared;
    try {
        const [abortAcknowledged, transferDrained] = await Promise.all([
            sendScrapeAbort(abortLease, stopNavigation),
            waitForScrapeTransferTasks(abortLease)
        ]);
        await drainPendingMetadataSync();
        const ownerAbsent = abortAcknowledged
            ? false
            : await isScrapeOwnerPositivelyAbsent(abortLease.tabId);
        return await enqueueScrapeLeaseOperation(async () => {
            if (!scrapeLeaseIdentityMatches(activeScrapeLease, stoppingLease)) {
                return {
                    status: activeScrapeLease?.status === 'idle' ? 'stopped' : 'ignored',
                    abortAcknowledged,
                    transferDrained
                };
            }
            await persistScrapeLease(createIdleScrapeLease(stoppingLease.epoch + 1));
            scrapeStopPending = false;
            const stored = await chrome.storage.local.get(['r2BackupState']);
            await chrome.storage.local.set(buildAuthoritativeIdleLocalState(stored, stopReason));
            return {
                status: 'stopped',
                abortAcknowledged,
                transferDrained,
                ...(!abortAcknowledged && !ownerAbsent
                    ? { refreshOwnerRecommended: true }
                    : {})
            };
        });
    } catch (error) {
        await releaseFailedScrapeStopAuthority(stopReason, stoppingLease);
        throw error;
    }
}

function getStopScrapeAuthority(request, sender, expectedKind) {
    const scoped = ['runToken', 'runEpoch', 'token', 'epoch', 'kind']
        .some((key) => Object.prototype.hasOwnProperty.call(request || {}, key));
    if (!scoped) return { scoped: false, authority: null };
    return {
        scoped: true,
        authority: getRunScopedScrapeLease(request, sender?.tab?.id ?? null, expectedKind)
    };
}

function stopScrapeRunFromMessage(request, sender, kind) {
    const scope = getStopScrapeAuthority(request, sender, kind);
    if (scope.scoped && !scope.authority) {
        return Promise.resolve({ status: 'ignored', reason: 'stale_authority' });
    }
    return stopScrapeRun(kind, 'stopped', scope.authority);
}

async function handleR2BackupProgress(request, sender) {
    return enqueueScrapeLeaseOperation(async () => {
        const requested = getRunScopedScrapeLease(request, sender?.tab?.id ?? null, 'r2_backup');
        if (!scrapeLeaseMatches(activeScrapeLease, requested)) return { status: 'ignored' };
        chrome.runtime.sendMessage({
            action: 'UPDATE_R2_BACKUP_PROGRESS',
            stats: request.stats && typeof request.stats === 'object' ? { ...request.stats } : {}
        }).catch(() => {});
        return { status: 'ok' };
    });
}

async function completeScrapeRun(request, sender, kind) {
    const prepared = await enqueueScrapeLeaseOperation(async () => {
        const requested = getRunScopedScrapeLease(request, sender?.tab?.id ?? null, kind);
        if (!scrapeLeaseMatches(activeScrapeLease, requested)) return null;
        const lease = { ...activeScrapeLease };
        return { lease };
    });
    if (!prepared) return { status: 'ignored' };

    const { lease } = prepared;
    await processedIdsMutationQueue;
    await drainPendingMetadataSync();
    const completionTransfer = await prepareScrapeCompletionTransfer(lease);
    return enqueueScrapeLeaseOperation(async () => {
        if (!scrapeLeaseMatches(activeScrapeLease, lease)) return { status: 'ignored' };
        const stored = await readEffectiveScrapeRunState(lease, ['r2BackupState']);
        if (!scrapeLeaseMatches(activeScrapeLease, lease)) return { status: 'ignored' };
        clearR2BackupInventoryCache(lease);
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
            log(`R2 Backup ${statusLabel}. Uploaded: ${stats.uploaded || 0}, Already present: ${stats.alreadyPresent || 0}, Queued total: ${stats.queued || 0}, Pending: ${stats.pendingTransfers ?? 'unknown'}, Errors: ${stats.errors || 0}`, completed ? 'success' : 'warning');
            chrome.runtime.sendMessage({ action: 'R2_BACKUP_DONE', stats }).catch(() => {});
        } else {
            chrome.runtime.sendMessage({
                action: 'SCRAPE_COMPLETE',
                stats: request.stats || {}
            }).catch(() => {});
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
        captureMetadata: request.captureMetadata || null,
        requireCaptureMetadata: true,
        acceptance
    }, blob, assertAuthorized);
    if (assertAuthorized) await assertAuthorized();

    return buildDirectBackupUploadResponse(result, request.url);
}

function getDirectUploadReceiptIds(request, response, finalPath) {
    const mediaId = CloudSync.extractGrokMediaId(request.url);
    const canonicalAssetId = response.assetId || CloudSync.resolveMediaAssetIdentity({
        sourceUrl: request.url,
        finalPath,
        mediaType: request.isVideo ? 'video' : 'image'
    }).assetId;
    return Array.from(new Set([mediaId, canonicalAssetId].filter(Boolean)));
}

async function checkR2BackupPresence(request, sender) {
    const lease = await getAuthorizedScrapeTransferLease(request, sender);
    if (!lease || lease.kind !== 'r2_backup') {
        return { status: 'ignored', reason: 'stale_authority' };
    }

    return trackScrapeTransferTask(lease, async (signal) => {
        const assertAuthorized = createScrapeTransferAuthorityGuard(lease, signal);
        try {
            await assertAuthorized();
            const config = await getCloudConfig();
            await assertAuthorized();
            if (!CloudSync.isCloudEnabled(config)) {
                return { status: 'error', error: 'r2_presence_cloud_disabled' };
            }
            const extHint = request.isVideo ? 'mp4' : null;
            const finalPath = await generateFilenameForBackup(request.url, extHint);
            await assertAuthorized();
            const identity = CloudSync.resolveMediaAssetIdentity({
                sourceUrl: request.url,
                finalPath,
                mediaType: request.isVideo ? 'video' : 'image'
            });
            const inventory = await getR2BackupInventoryForLease(config, lease, assertAuthorized);
            await assertAuthorized();
            const item = inventory.get(identity.assetId);
            if (!item) return { status: 'missing', assetId: identity.assetId };
            if (item.mediaType !== identity.mediaType) {
                return { status: 'error', error: 'r2_inventory_media_type_mismatch' };
            }
            const result = await headVerifiedVaultObject(config, item, assertAuthorized);
            await assertAuthorized();
            if (result.status === 'error') {
                clearR2BackupInventoryCache(lease);
                return result;
            }
            if (result.status !== 'already_present') return result;
            const metadataResult = await ensureCaptureMetadataDurable(config, {
                objectKey: result.objectKey,
                assetId: result.assetId,
                captureMetadata: request.captureMetadata || null,
                requireCaptureMetadata: true,
                acceptance: request.acceptance || null
            }, assertAuthorized);
            await assertAuthorized();
            await mutateProcessedReceipts({
                r2Ids: [result.assetId || identity.assetId]
            }, assertAuthorized);
            return {
                ...result,
                metadataStatus: metadataResult.status,
                metadataObjectKey: metadataResult.objectKey
            };
        } catch (error) {
            clearR2BackupInventoryCache(lease);
            if (isScrapeAuthorityRevokedError(error)) throw error;
            await assertAuthorized();
            const code = String(error?.message || '');
            return {
                status: 'error',
                error: /^[a-z0-9_]+$/.test(code) ? code : 'r2_presence_check_failed'
            };
        }
    }, 'presence');
}

function handleGenerationRuntimeMessage(request, sender, sendResponse) {
    const handlers = {
        GENERATION_RUN_START: 'startGenerationRun',
        GENERATION_RUN_CLAIM: 'claimGenerationAction',
        GENERATION_RUN_REPORT: 'reportGenerationAction',
        GENERATION_RUN_RETRY_FAILED: 'retryFailedGenerationItems',
        GENERATION_RUN_CANCEL: 'cancelGenerationRun',
        GENERATION_RUN_STATUS: 'getGenerationRunStatus'
    };
    const methodName = handlers[request.action];
    if (!methodName) return null;
    if (generationRunHelperLoadError) {
        sendResponse({ status: 'rejected', error: 'GENERATION_HELPERS_LOAD_FAILED' });
        return false;
    }
    if (!generationRunController) {
        sendResponse({ status: 'rejected', error: 'GENERATION_CONTROLLER_UNAVAILABLE' });
        return false;
    }

    const operation = request.action === 'GENERATION_RUN_START'
        ? startGenerationWithGlobalAuthority(request, sender)
        : generationRunController[methodName](request, sender);
    operation.then((response) => {
        if (request.action !== 'GENERATION_RUN_STATUS') {
            sendResponse(response);
            return;
        }
        sendResponse({
            ...response,
            isOwner: Number.isInteger(sender?.tab?.id)
                && sender.tab.id === response?.run?.ownerTabId
        });
    }).catch((error) => {
        sendResponse({
            status: 'rejected',
            error: String(error?.code || error?.message || 'GENERATION_CONTROLLER_ERROR')
        });
    });
    return true;
}

// Handle messages
function handleRuntimeMessage(request, sender, sendResponse) {
    const generationResponse = handleGenerationRuntimeMessage(request, sender, sendResponse);
    if (generationResponse !== null) return generationResponse;

    if (request.action === 'PROCESSED_IDS_ADD') {
        mutateProcessedIds({ ids: request.ids }).then((processedIds) => {
            sendResponse({ status: 'ok', processedIds });
        }).catch(() => {
            sendResponse({ status: 'error', error: 'processed_ids_mutation_failed' });
        });
        return true;
    }

    if (request.action === 'PROCESSED_IDS_RESET') {
        const resetLockedNow = activeScrapeLease?.status === 'starting'
            || activeScrapeLease?.status === 'active'
            || activeScrapeLease?.status === 'stopping'
            || scrapeStartPending
            || scrapeStopPending
            || isScraping
            || isR2Backup;
        if (resetLockedNow) {
            sendResponse({ status: 'error', error: 'processed_ids_locked_by_active_sync' });
            return true;
        }
        const assertResetAllowed = async () => {
            const locked = await enqueueScrapeLeaseOperation(() => (
                activeScrapeLease?.status === 'starting'
                || activeScrapeLease?.status === 'active'
                || activeScrapeLease?.status === 'stopping'
                || scrapeStartPending
                || scrapeStopPending
                || isScraping
                || isR2Backup
            ));
            if (locked) throw createScrapeAuthorityRevokedError();
        };
        mutateProcessedIds({ reset: true }, assertResetAllowed).then((processedIds) => {
                sendResponse({ status: 'ok', processedIds });
        }).catch((error) => {
            sendResponse({
                status: 'error',
                error: isScrapeAuthorityRevokedError(error)
                    ? 'processed_ids_locked_by_active_sync'
                    : 'processed_ids_mutation_failed'
            });
        });
        return true;
    }

    if (request.action === 'PROMPT_HISTORY_MUTATE') {
        mutatePromptHistory(request).then((promptHistory) => {
            sendResponse({ status: 'ok', promptHistory });
        }).catch((error) => {
            sendResponse({ status: 'error', error: error.message || 'prompt_history_mutation_failed' });
        });
        return true;
    }

    if (request.action === 'SAVED_PROMPTS_MUTATE') {
        mutateSavedPrompts(request).then((savedPrompts) => {
            sendResponse({ status: 'ok', savedPrompts });
        }).catch((error) => {
            sendResponse({ status: 'error', error: error.message || 'saved_prompts_mutation_failed' });
        });
        return true;
    }

    if (request.action === 'SCRAPE_RUN_STATE_WRITE') {
        commitScrapeRunState(request, sender).then(sendResponse).catch(() => {
            sendResponse({ status: 'ignored', reason: 'stale_authority' });
        });
        return true;
    }

    if (request.action === 'GET_SCRAPE_DURABILITY') {
        (async () => {
            const lease = await getAuthorizedScrapeTransferLease(request, sender);
            return lease ? getScrapeDurabilitySnapshot(lease) : { status: 'ignored' };
        })().then(sendResponse).catch(() => sendResponse({ status: 'ignored' }));
        return true;
    }

    if (request.action === 'GET_SCRAPE_STATUS') {
        getAuthoritativeScrapeStatus().then(sendResponse).catch(() => {
            sendResponse({ status: 'error', error: 'scrape_status_unavailable' });
        });
        return true;
    }

    if (request.action === 'GET_ACTIVE_WORKFLOW_STATUS') {
        getAuthoritativeMutatingWorkflowStatus(sender).then(sendResponse).catch(() => {
            sendResponse({ status: 'error', error: 'active_workflow_status_unavailable' });
        });
        return true;
    }

    if (request.action === 'PAGE_WORKFLOW_START') {
        startPageWorkflowWithGlobalAuthority(request, sender).then(sendResponse).catch((error) => {
            sendResponse({ status: 'rejected', error: error.message || 'PAGE_WORKFLOW_START_FAILED' });
        });
        return true;
    }

    if (request.action === 'PAGE_WORKFLOW_UPDATE') {
        updatePageWorkflow(request, sender).then(sendResponse).catch((error) => {
            sendResponse({ status: 'error', error: error.message || 'PAGE_WORKFLOW_UPDATE_FAILED' });
        });
        return true;
    }

    if (request.action === 'PAGE_WORKFLOW_STOP' || request.action === 'PAGE_WORKFLOW_COMPLETE') {
        finishPageWorkflow(
            request,
            sender,
            request.action === 'PAGE_WORKFLOW_STOP' ? 'stopped' : 'completed'
        ).then(sendResponse).catch((error) => {
            sendResponse({ status: 'error', error: error.message || 'PAGE_WORKFLOW_FINISH_FAILED' });
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
            }, 'processed_ids');
        })().then(sendResponse).catch((error) => {
            if (isScrapeAuthorityRevokedError(error)) {
                sendResponse({ status: 'ignored', reason: 'stale_authority' });
                return;
            }
            sendResponse({ status: 'error', error: 'processed_ids_mutation_failed' });
        });
        return true;
    }

    if (request.action === 'SCRAPE_DESTINATION_RECEIPTS_ADD') {
        (async () => {
            const lease = await getAuthorizedScrapeTransferLease(request, sender);
            if (!lease) return { status: 'ignored', reason: 'stale_authority' };
            return trackScrapeTransferTask(lease, async (signal) => {
                const assertAuthorized = createScrapeTransferAuthorityGuard(lease, signal);
                await assertAuthorized();
                const receipts = await mutateProcessedReceipts({
                    localIds: request.localIds,
                    r2Ids: request.r2Ids
                }, assertAuthorized);
                await assertAuthorized();
                return {
                    status: 'ok',
                    processedIds: receipts.processedIds,
                    localIds: receipts.localIds,
                    r2Ids: receipts.r2Ids
                };
            }, 'processed_receipts');
        })().then(sendResponse).catch((error) => {
            if (isScrapeAuthorityRevokedError(error)) {
                sendResponse({ status: 'ignored', reason: 'stale_authority' });
                return;
            }
            sendResponse({ status: 'error', error: 'processed_receipts_mutation_failed' });
        });
        return true;
    }

    if (request.action === 'START_SCRAPE') {
        log('Background: Received START_SCRAPE.');
        const entryLimit = normalizeSyncEntryLimit(request.entryLimit);
        initializeScrapeInActiveTab(
            {
                action: 'INIT_SCRAPE',
                ...(entryLimit ? { entryLimit } : {})
            },
            { sourceTab: sender?.tab || null }
        ).then(sendResponse);
        return true;
    }

    if (request.action === 'STOP_SCRAPE') {
        stopScrapeRunFromMessage(request, sender, 'sync').then(sendResponse).catch((error) => {
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
        stopScrapeRunFromMessage(request, sender, 'r2_backup').then(sendResponse).catch((error) => {
            sendResponse({ status: 'error', error: error.message || 'Failed to stop backup.' });
        });
        return true;
    }

    if (request.action === 'R2_BACKUP_CHECK_PRESENT') {
        checkR2BackupPresence(request, sender).then(sendResponse).catch((error) => {
            if (isScrapeAuthorityRevokedError(error)) {
                sendResponse({ status: 'ignored', reason: 'stale_authority' });
                return;
            }
            sendResponse({ status: 'error', error: 'r2_presence_check_failed' });
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
                    const receiptIds = getDirectUploadReceiptIds(request, response, finalPath);
                    if (receiptIds.length && shouldPersistBackupProcessedId(response.status)) {
                        await mutateProcessedReceipts({ r2Ids: receiptIds }, assertAuthorized);
                        clearR2BackupInventoryCache(lease);
                    }
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

            if (request.url?.includes('assets.grok.com')) {
                await queueChromeDownload(
                    { url: request.url, filename: finalPath, conflictAction: 'overwrite' },
                    lease,
                    {
                        promptText: request.promptText || '',
                        captureMetadata: request.captureMetadata || null,
                        requireCaptureMetadata: true
                    }
                );
                await assertAuthorized();
                return { status: 'queued' };
            }

            // Public media can be fetched directly by the service worker.
            const queued = await enqueueCloudMediaUpload(
                request.url,
                finalPath,
                request.promptText,
                request.acceptance || null,
                {
                    scrapeLease: lease,
                    assertAuthorized,
                    captureMetadata: request.captureMetadata || null,
                    requireCaptureMetadata: true
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
            }, 'media_upload');
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

    if (request.action === 'GET_ACTIVE_SCRAPE_RUN_STATE') {
        enqueueScrapeLeaseOperation(() => {
            const lease = activeScrapeLease;
            const state = getActiveScrapeRunMirror(lease);
            if (lease?.status !== 'active' || sender?.tab?.id !== lease.tabId || !state) {
                return { status: 'ignored', reason: 'stale_authority' };
            }
            return {
                status: 'ok',
                runToken: lease.token,
                runEpoch: lease.epoch,
                kind: lease.kind,
                state
            };
        }).then(sendResponse).catch(() => {
            sendResponse({ status: 'ignored', reason: 'stale_authority' });
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

    if (request.action === 'GLOBAL_SETTINGS_PATCH') {
        patchGlobalSettings(request.updates).then((settings) => {
            sendResponse({ status: 'ok', settings });
        }).catch((error) => {
            sendResponse({ status: 'error', error: error.message || 'settings_patch_failed' });
        });
        return true;
    }

    if (request.action === 'CLOUD_CONFIG_PATCH') {
        patchCloudConfig(request.updates).then((config) => {
            sendResponse({ status: 'ok', config });
        }).catch((error) => {
            sendResponse({ status: 'error', error: error.message || 'cloud_config_patch_failed' });
        });
        return true;
    }

    if (request.action === 'PROVIDER_RUN_LEDGER_APPEND') {
        appendProviderRunLedger(request.entry).then((entry) => {
            sendResponse({ status: 'ok', entry });
        }).catch((error) => {
            sendResponse({ status: 'error', error: error.message || 'provider_run_ledger_failed' });
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
            if (!scrapeDestinationContractMatches(request.destinations, config)) {
                return { status: 'error', error: 'sync_destination_drift' };
            }
            const allowLocalDownload = CloudSync.isLocalDownloadEnabled(config);

            if (allowLocalDownload) {
                // This triggers onDeterminingFilename.
                await assertAuthorized();
                await queueChromeDownload(
                    { url: request.url, conflictAction: 'overwrite' },
                    lease,
                    {
                        promptText: request.promptText || '',
                        captureMetadata: request.captureMetadata || null,
                        requireCaptureMetadata: CloudSync.isCloudEnabled(config)
                    }
                );
                await assertAuthorized();
                return { status: 'queued' };
            }

            const extHint = request.isVideo ? 'mp4' : null;
            const finalPath = await generateFilenameForBackup(request.url, extHint);
            await assertAuthorized();
            if (!request.blobDataUrl) {
                const queued = await enqueueCloudMediaUpload(
                    request.url,
                    finalPath,
                    request.promptText || '',
                    null,
                    {
                        scrapeLease: lease,
                        assertAuthorized,
                        captureMetadata: request.captureMetadata || null,
                        requireCaptureMetadata: true
                    }
                );
                await assertAuthorized();
                return queued
                    ? { status: 'queued' }
                    : { status: 'error', error: 'cloud_media_queue_rejected' };
            }

            const response = await uploadDirectMediaData(
                request,
                finalPath,
                'direct-sync',
                assertAuthorized
            );
            await assertAuthorized();
            const receiptIds = getDirectUploadReceiptIds(request, response, finalPath);
            if (receiptIds.length && shouldPersistBackupProcessedId(response.status)) {
                await mutateProcessedReceipts({ r2Ids: receiptIds }, assertAuthorized);
            }
            return response;
            }, 'media_transfer');
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
        log(request.text, request.type).then((logs) => {
            sendResponse({ status: 'ok', logs });
        }).catch(() => {
            sendResponse({ status: 'error', error: 'activity_log_write_failed' });
        });
        return true;
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
                const operation = request.authority
                    ? await recreateWorkflowController?.authorizeContentOperation?.(request, sender)
                    : null;
                const result = await fetchRecreateReferenceDataUrl(request.url, operation || {});
                sendResponse({ ok: true, ...result });
            } catch (e) {
                sendResponse({ ok: false, error: e.message || 'reference_capture_failed' });
            }
        })();
        return true;
    }

    if (request.action === 'GPT_RECREATE_RESULT_BASELINE') {
        (async () => {
            try {
                if (!recreateWorkflowController?.recordResultBaseline) {
                    throw new Error('workflow_unavailable');
                }
                sendResponse(await recreateWorkflowController.recordResultBaseline(request, sender));
            } catch (e) {
                sendResponse({ ok: false, error: e.message || 'workflow_aborted' });
            }
        })();
        return true;
    }

    if (request.action === 'GPT_RECREATE_NATIVE_CLICK'
        || request.action === 'GPT_PROMPTED_VIDEO_NATIVE_CLICK') {
        (async () => {
            try {
                const tabId = sender && sender.tab ? sender.tab.id : null;
                const operation = request.action === 'GPT_RECREATE_NATIVE_CLICK'
                    ? await recreateWorkflowController?.authorizeContentOperation?.(request, sender)
                    : null;
                if (request.action === 'GPT_RECREATE_NATIVE_CLICK' && !operation) {
                    throw new Error('workflow_aborted');
                }
                if (request.action === 'GPT_PROMPTED_VIDEO_NATIVE_CLICK'
                    && request.generationDispatch) {
                    const generation = await generationRunController?.dispatchGenerationAction?.(
                        request.generationDispatch,
                        sender,
                        (assertAuthorized) => dispatchNativeClick(
                            tabId,
                            request.click || {},
                            assertAuthorized
                        )
                    );
                    if (!['submitted', 'accepted'].includes(generation?.status)) {
                        throw new Error(generation?.error || 'generation_dispatch_rejected');
                    }
                    sendResponse({ ok: true, generation });
                    return;
                }
                const result = await dispatchNativeClick(
                    tabId,
                    request.click || {},
                    operation?.assertAuthorized || null
                );
                sendResponse(result);
            } catch (e) {
                sendResponse({
                    ok: false,
                    error: e.message || 'native_click_unavailable',
                    clickState: e.clickState || 'unknown'
                });
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
            const response = await startRecreateWithGlobalAuthority(request, {
                sourceTabId: sourceTab.id,
                sourceTabUrl: sourceTab.url,
                sourceDocumentId: sender?.documentId || ''
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

        (async () => {
            const activeRun = await recreateWorkflowController.getRunStatus({ includeOwner: true });
            if (!activeRun
                || request?.runId !== activeRun.runId
                || request?.epoch !== activeRun.epoch
                || sender?.tab?.id !== activeRun.ownerTabId
                || String(sender?.documentId || '') !== String(activeRun.ownerDocumentId || '')) {
                sendResponse({ ok: false, error: 'stale_authority', status: 'ignored' });
                return;
            }
            const result = await recreateWorkflowController.abort('user');
            sendResponse(result);
        })();
        return true;
    }

    if (request.action === 'GET_GPT_RECREATE_STATUS') {
        if (!recreateWorkflowController) {
            sendResponse({ ok: false, error: 'workflow_unavailable' });
            return false;
        }

        (async () => {
            const activeRun = await recreateWorkflowController.getRunStatus();
            sendResponse({ ok: true, activeRun });
        })().catch((error) => {
            sendResponse({ ok: false, error: error.message || 'workflow_unavailable' });
        });
        return true;
    }

    return false;
}

const BACKGROUND_READY_MESSAGE_ACTIONS = new Set([
    'GENERATION_RUN_START',
    'GENERATION_RUN_CLAIM',
    'GENERATION_RUN_REPORT',
    'GENERATION_RUN_RETRY_FAILED',
    'GENERATION_RUN_CANCEL',
    'GENERATION_RUN_STATUS',
    'PROCESSED_IDS_ADD',
    'PROCESSED_IDS_RESET',
    'PROMPT_HISTORY_MUTATE',
    'SAVED_PROMPTS_MUTATE',
    'SCRAPE_RUN_STATE_WRITE',
    'GET_ACTIVE_SCRAPE_RUN_STATE',
    'GET_SCRAPE_STATUS',
    'GET_ACTIVE_WORKFLOW_STATUS',
    'PAGE_WORKFLOW_START',
    'PAGE_WORKFLOW_UPDATE',
    'PAGE_WORKFLOW_STOP',
    'PAGE_WORKFLOW_COMPLETE',
    'SCRAPE_PROCESSED_IDS_ADD',
    'SCRAPE_DESTINATION_RECEIPTS_ADD',
    'GET_SCRAPE_DURABILITY',
    'START_SCRAPE',
    'START_R2_BACKUP',
    'START_GPT_RECREATE',
    'ABORT_GPT_RECREATE',
    'GET_GPT_RECREATE_STATUS',
    'FETCH_GPT_RECREATE_REFERENCE_DATA_URL',
    'GPT_RECREATE_NATIVE_CLICK',
    'GPT_RECREATE_RESULT_BASELINE',
    'R2_BACKUP_CHECK_PRESENT',
    'R2_BACKUP_UPLOAD',
    'R2_BACKUP_PROGRESS',
    'R2_BACKUP_COMPLETE',
    'SCRAPE_COMPLETE',
    'DOWNLOAD_MEDIA',
    'CLOUD_GET_STATUS',
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
        const stored = await readEffectiveScrapeRunState(lease, [
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
    try {
        await waitForBackgroundInitialization();
        if (changeInfo.url && recreateWorkflowController?.handleOwnedTabUpdated) {
            const handled = await recreateWorkflowController.handleOwnedTabUpdated(tabId, changeInfo.url);
            if (handled) return;
        }
        const lease = await getActiveLeaseForTabEvent(tabId, tab);
        if (!lease) return;

        if (changeInfo.url) {
            const url = changeInfo.url;
            if (url.includes('imagine-public.x.ai') || url.match(/\.(png|jpg|jpeg|mp4|webp)(\?|$)/i)) {
                await trackScrapeTransferTask(lease, async (signal) => {
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
                            await chrome.tabs.remove(tabId);
                        } else {
                            await assertAuthorized();
                            console.log('Download skipped (Duplicate). Closing tab.');
                            await chrome.tabs.remove(tabId);
                        }
                    } catch (error) {
                        if (isScrapeAuthorityRevokedError(error)) return;
                        updateCloudError(formatRedactedMediaError(error, url, 'tab_queue_failed'));
                        await persistCloudState().catch(() => {});
                    }
                }, 'media_intercept');
                return;
            }
        }
    } catch {
        return;
    }
});

chrome.tabs.onRemoved.addListener((tabId) => {
    return waitForBackgroundInitialization()
        .then(async () => {
            const lease = await getActiveLeaseForTabEvent(tabId);
            const operations = [];
            if (lease?.tabId === tabId) {
                operations.push(stopScrapeRun(lease.kind, 'owner_tab_closed'));
            }
            if (generationRunController?.cancelGenerationRunForOwnerTab) {
                operations.push(generationRunController.cancelGenerationRunForOwnerTab(tabId));
            }
            if (recreateWorkflowController?.handleOwnedTabRemoved) {
                operations.push(recreateWorkflowController.handleOwnedTabRemoved(tabId));
            }
            operations.push(enqueuePageWorkflowLeaseOperation(async () => {
                if (activePageWorkflowLease?.status !== 'running'
                    || activePageWorkflowLease.ownerTabId !== tabId) {
                    return false;
                }
                await persistPageWorkflowLease(
                    createIdlePageWorkflowLease(activePageWorkflowLease.epoch + 1)
                );
                return true;
            }));
            await Promise.all(operations);
        })
        .catch(() => {});
});

function deserializeDownloadOperations(value) {
    const records = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const operations = new Map();
    for (const [key, record] of Object.entries(records)) {
        const downloadId = Number(record?.downloadId ?? key);
        if (!Number.isInteger(downloadId) || !record || typeof record !== 'object') continue;
        const operation = { ...record, downloadId };
        delete operation.finalizationClaim;
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
    let resolveMutation;
    let rejectMutation;
    const mutation = new Promise((resolve, reject) => {
        resolveMutation = resolve;
        rejectMutation = reject;
    });
    const execute = async () => {
        try {
            const revision = ++pendingDownloadOperationsRevision;
            const operations = deserializeDownloadOperations(serializeDownloadOperations(pendingDownloadOperations));
            const result = await mutator(operations);
            pendingDownloadOperations = operations;
            const write = Promise.resolve(chrome.storage.local.set({
                [PENDING_DOWNLOAD_OPERATIONS_KEY]: serializeDownloadOperations(operations)
            }));
            const persisted = await withTimeout(
                write.then(() => true),
                PENDING_DOWNLOAD_MUTATION_TIMEOUT_MS,
                false
            );
            if (persisted) {
                resolveMutation(result);
                return;
            }
            rejectMutation(new Error('pending_download_operations_persist_timeout'));
            await write;
            if (revision !== pendingDownloadOperationsRevision) {
                await chrome.storage.local.set({
                    [PENDING_DOWNLOAD_OPERATIONS_KEY]: serializeDownloadOperations(pendingDownloadOperations)
                });
            }
        } catch (error) {
            rejectMutation(error);
            throw error;
        }
    };
    const queueBarrier = pendingDownloadOperationsMutationQueue.then(execute, execute);
    pendingDownloadOperationsMutationQueue = queueBarrier.catch(() => {});
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
        if (operation.mediaId) {
            const localSatisfied = !operation.allowLocal
                || processedLocalUUIDs.has(operation.mediaId);
            const r2Satisfied = !operation.cloudRequired
                || processedR2UUIDs.has(operation.mediaId);
            if (localSatisfied && r2Satisfied) return false;
        }
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

function stableSerialize(value) {
    if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
    if (value && typeof value === 'object') {
        return `{${Object.keys(value).sort().map((key) => (
            `${JSON.stringify(key)}:${stableSerialize(value[key])}`
        )).join(',')}}`;
    }
    return JSON.stringify(value);
}

function scrapeCompletionLeaseKey(lease) {
    return `${lease.writerEpoch || 0}:${lease.writerId || ''}:${lease.epoch}:${lease.token}:${lease.tabId}:${lease.kind}`;
}

function getScrapeLeaseOrder(lease) {
    return {
        writerEpoch: Number.isInteger(lease?.writerEpoch) && lease.writerEpoch >= 0
            ? lease.writerEpoch
            : 0,
        writerId: normalizeScrapePersistenceWriterId(lease?.writerId, { allowLegacy: true }) || '',
        epoch: Number.isInteger(lease?.epoch) && lease.epoch >= 0 ? lease.epoch : 0
    };
}

function compareScrapeLeaseOrder(left, right) {
    if (left.writerEpoch !== right.writerEpoch) return left.writerEpoch - right.writerEpoch;
    if (left.writerId !== right.writerId) return left.writerId.localeCompare(right.writerId);
    return left.epoch - right.epoch;
}

function normalizeScrapeCompletionCheckpoint(value) {
    if (!value
        || value.version !== 1
        || !Number.isInteger(value.retiredThroughEpoch)
        || value.retiredThroughEpoch < 0) {
        return null;
    }
    const retiredThroughWriterId = normalizeScrapePersistenceWriterId(
        value.retiredThroughWriterId,
        { allowLegacy: true }
    );
    if (retiredThroughWriterId === null) return null;
    const committedByLease = new Map();
    if (!Array.isArray(value.committed)) return null;
    for (const entry of value.committed) {
        const lease = normalizeScrapeLease(entry?.lease);
        const txn = entry?.txn && typeof entry.txn === 'object' && !Array.isArray(entry.txn)
            ? { ...entry.txn }
            : null;
        if (!lease || typeof txn?.id !== 'string' || !txn.id || txn.phase !== 'committed') return null;
        const key = scrapeCompletionLeaseKey(lease);
        const normalized = { lease: copyScrapeLeaseAuthority(lease), txn };
        const existing = committedByLease.get(key);
        if (existing && stableSerialize(existing) !== stableSerialize(normalized)) return null;
        committedByLease.set(key, normalized);
    }
    const committed = Array.from(committedByLease.values()).sort((left, right) => (
        compareScrapeLeaseOrder(getScrapeLeaseOrder(left.lease), getScrapeLeaseOrder(right.lease))
        || left.lease.token.localeCompare(right.lease.token)
    ));
    let fence = null;
    if (value.fence !== undefined) {
        const fenceWriterId = normalizeScrapePersistenceWriterId(
            value.fence?.writerId,
            { allowLegacy: true }
        );
        if (!Number.isInteger(value.fence?.writerEpoch)
            || value.fence.writerEpoch < 0
            || fenceWriterId === null
            || !Number.isInteger(value.fence?.revision)
            || value.fence.revision < 0) {
            return null;
        }
        fence = {
            writerEpoch: value.fence.writerEpoch,
            writerId: fenceWriterId,
            revision: value.fence.revision
        };
    }
    return {
        version: 1,
        retiredThroughWriterEpoch: Number.isInteger(value.retiredThroughWriterEpoch)
            && value.retiredThroughWriterEpoch >= 0
            ? value.retiredThroughWriterEpoch
            : 0,
        retiredThroughWriterId,
        retiredThroughEpoch: value.retiredThroughEpoch,
        committed,
        ...(fence ? { fence } : {})
    };
}

function parseScrapeCompletionJournalRecord(storageKey, value) {
    if (!storageKey.startsWith(SCRAPE_COMPLETION_JOURNAL_PREFIX)) return null;
    const legacy = value?.version === 2 && value.writerId === undefined;
    const writerId = legacy
        ? ''
        : normalizeScrapePersistenceWriterId(value?.writerId);
    const lease = normalizeScrapeLease(value?.lease);
    const terminal = value?.phase === 'committed' || value?.phase === 'revoked';
    let checkpoint = terminal ? normalizeScrapeCompletionCheckpoint(value?.checkpoint) : null;
    if (value?.kind !== 'scrape_completion_journal'
        || (value.version !== 2 && value.version !== 3)
        || (!legacy && !writerId)
        || !Number.isInteger(value.writerEpoch)
        || value.writerEpoch < 0
        || !Number.isInteger(value.revision)
        || value.revision < 0
        || !['prepared', 'committed', 'revoked'].includes(value.phase)
        || !lease
        || (terminal && !checkpoint)
        || (value.phase !== 'revoked'
            && (typeof value.txn?.id !== 'string' || value.txn.phase !== value.phase))) {
        throw new Error('scrape_completion_journal_record_invalid');
    }
    if (checkpoint?.fence && compareScrapePersistenceOrder(
        checkpoint,
        { writerEpoch: value.writerEpoch, writerId, revision: value.revision }
    ) !== 0) {
        throw new Error('scrape_completion_journal_record_invalid');
    }
    if (checkpoint && !checkpoint.fence) {
        checkpoint = {
            ...checkpoint,
            fence: { writerEpoch: value.writerEpoch, writerId, revision: value.revision }
        };
    }
    return {
        ...value,
        writerId,
        lease,
        ...(checkpoint ? { checkpoint } : {}),
        storageKey
    };
}

function getScrapeCompletionJournalRecords(stored = {}) {
    const records = Object.entries(stored).reduce((entries, [key, value]) => {
        const record = parseScrapeCompletionJournalRecord(key, value);
        if (record) entries.push(record);
        return entries;
    }, []).sort(compareScrapePersistenceOrder);
    for (let index = 1; index < records.length; index++) {
        const prior = records[index - 1];
        const current = records[index];
        if (compareScrapePersistenceOrder(prior, current) !== 0) continue;
        const priorSignature = stableSerialize({
            phase: prior.phase,
            lease: prior.lease,
            txn: prior.txn || null,
            checkpoint: prior.checkpoint || null
        });
        const currentSignature = stableSerialize({
            phase: current.phase,
            lease: current.lease,
            txn: current.txn || null,
            checkpoint: current.checkpoint || null
        });
        if (priorSignature !== currentSignature) {
            throw new Error('scrape_completion_journal_ambiguous');
        }
    }
    return records;
}

function completionDecisionIsReferenced(decision, queue, operations) {
    const matches = (record) => (
        record?.completionTxnId === decision.txn.id
        && scrapeLeaseMatches(normalizeScrapeLease(record.revocationLease), decision.lease)
    );
    return queue.some(matches) || Array.from(operations.values()).some(matches);
}

function buildScrapeCompletionCheckpoint(queue, operations, lease, phase, txn = null) {
    const committed = new Map(scrapeCompletionCheckpoint.committed.map((entry) => [
        scrapeCompletionLeaseKey(entry.lease),
        { lease: copyScrapeLeaseAuthority(entry.lease), txn: { ...entry.txn } }
    ]));
    const leaseKey = scrapeCompletionLeaseKey(lease);
    if (phase === 'committed' && txn) {
        committed.set(leaseKey, {
            lease: copyScrapeLeaseAuthority(lease),
            txn: { ...txn, phase: 'committed' }
        });
    } else if (phase === 'revoked') {
        committed.delete(leaseKey);
    }
    const referenced = Array.from(committed.values())
        .filter((decision) => completionDecisionIsReferenced(decision, queue, operations))
        .sort((left, right) => (
            compareScrapeLeaseOrder(getScrapeLeaseOrder(left.lease), getScrapeLeaseOrder(right.lease))
            || left.lease.token.localeCompare(right.lease.token)
        ));
    const priorRetiredOrder = {
        writerEpoch: scrapeCompletionCheckpoint.retiredThroughWriterEpoch || 0,
        writerId: scrapeCompletionCheckpoint.retiredThroughWriterId || '',
        epoch: scrapeCompletionCheckpoint.retiredThroughEpoch
    };
    const leaseOrder = getScrapeLeaseOrder(lease);
    const retiredOrder = compareScrapeLeaseOrder(priorRetiredOrder, leaseOrder) >= 0
        ? priorRetiredOrder
        : leaseOrder;
    return {
        version: 1,
        retiredThroughWriterEpoch: retiredOrder.writerEpoch,
        retiredThroughWriterId: retiredOrder.writerId,
        retiredThroughEpoch: retiredOrder.epoch,
        committed: referenced
    };
}

function makeScrapeCompletionJournalRecord(lease, phase, txn = null, snapshots = null) {
    const revision = ++scrapeCompletionJournalRevision;
    const normalizedTxn = txn ? { ...txn, phase } : null;
    const record = {
        kind: 'scrape_completion_journal',
        version: 3,
        writerEpoch: scrapePersistenceWriterEpoch,
        writerId: scrapePersistenceWriterId,
        revision,
        phase,
        lease: copyScrapeCompletionLeaseAuthority(lease),
        txn: normalizedTxn,
        createdAt: Date.now()
    };
    if ((phase === 'committed' || phase === 'revoked') && snapshots) {
        record.checkpoint = {
            ...buildScrapeCompletionCheckpoint(
                snapshots.queue,
                snapshots.operations,
                lease,
                phase,
                normalizedTxn
            ),
            fence: {
                writerEpoch: record.writerEpoch,
                writerId: record.writerId,
                revision: record.revision
            }
        };
    }
    return record;
}

function startScrapeCompletionJournalWrite(record) {
    const identity = record.txn?.id || `${record.lease.epoch}:${record.lease.token}`;
    const storageKey = buildImmutableStorageKey(
        SCRAPE_COMPLETION_JOURNAL_PREFIX,
        record.revision,
        `${record.writerEpoch}:${record.writerId}:${identity}:${record.phase}`
    );
    return {
        storageKey,
        write: Promise.resolve(chrome.storage.local.set({ [storageKey]: record }))
    };
}

function createScrapeCompletionTransferTimeoutError() {
    return new Error('scrape_completion_transfer_persist_timeout');
}

async function awaitScrapeCompletionDeadline(promise, deadlineAt) {
    const timeout = Symbol('scrape_completion_deadline');
    const wrapped = Promise.resolve(promise).then((value) => ({ value }));
    wrapped.catch(() => {});
    const result = await withTimeout(
        wrapped,
        Math.max(0, deadlineAt - Date.now()),
        timeout
    );
    if (result === timeout || Date.now() >= deadlineAt) {
        throw createScrapeCompletionTransferTimeoutError();
    }
    return result.value;
}

async function compactScrapeCompletionJournal(retainedRecord, deadlineAt) {
    const stored = await awaitScrapeCompletionDeadline(chrome.storage.local.get(null), deadlineAt);
    const keys = getScrapeCompletionJournalRecords(stored)
        .filter((record) => record.storageKey !== retainedRecord.storageKey)
        .filter((record) => compareScrapePersistenceOrder(record, retainedRecord) <= 0)
        .map((record) => record.storageKey);
    if (keys.length === 0) return true;
    if (typeof chrome.storage?.local?.remove !== 'function') {
        throw new Error('scrape_completion_journal_compaction_unavailable');
    }
    await awaitScrapeCompletionDeadline(chrome.storage.local.remove(keys), deadlineAt);
    return true;
}

function mergeScrapeCompletionCheckpointAuthority(currentValue, candidateValue) {
    const current = normalizeScrapeCompletionCheckpoint(currentValue);
    const candidate = normalizeScrapeCompletionCheckpoint(candidateValue);
    if (!current || !candidate) throw new Error('scrape_completion_checkpoint_invalid');
    const order = compareScrapePersistenceOrder(candidate, current);
    if (order < 0) return current;
    if (order > 0) return candidate;
    if (stableSerialize(current) !== stableSerialize(candidate)) {
        throw new Error('scrape_completion_checkpoint_ambiguous');
    }
    return current;
}

async function adoptScrapeCompletionCheckpoint(record, deadlineAt, assertCurrent = null) {
    if (assertCurrent) assertCurrent();
    let authority = mergeScrapeCompletionCheckpointAuthority(
        scrapeCompletionCheckpoint,
        record.checkpoint
    );
    if (authority !== record.checkpoint
        && stableSerialize(authority) !== stableSerialize(record.checkpoint)) {
        return false;
    }
    await compactScrapeCompletionJournal(record, deadlineAt);
    if (assertCurrent) assertCurrent();
    authority = mergeScrapeCompletionCheckpointAuthority(
        scrapeCompletionCheckpoint,
        record.checkpoint
    );
    if (authority !== record.checkpoint
        && stableSerialize(authority) !== stableSerialize(record.checkpoint)) {
        return false;
    }
    scrapeCompletionCheckpoint = normalizeScrapeCompletionCheckpoint(record.checkpoint);
    return true;
}

function applyScrapeCompletionCheckpoint(checkpoint) {
    const normalized = normalizeScrapeCompletionCheckpoint(checkpoint);
    if (!normalized) return false;
    let queue = cloneCloudQueue();
    let operations = deserializeDownloadOperations(serializeDownloadOperations(pendingDownloadOperations));
    const committed = new Map(normalized.committed.map((entry) => [
        scrapeCompletionLeaseKey(entry.lease),
        entry
    ]));
    for (const decision of committed.values()) {
        const snapshots = buildCompletionRetrySnapshots(
            decision.lease,
            decision.txn,
            queue,
            operations
        );
        queue = snapshots.queue;
        operations = snapshots.operations;
    }
    const shouldRevoke = (record) => {
        const lease = normalizeScrapeLease(record?.scrapeLease)
            || normalizeScrapeLease(record?.revocationLease);
        const retiredOrder = {
            writerEpoch: normalized.retiredThroughWriterEpoch,
            writerId: normalized.retiredThroughWriterId,
            epoch: normalized.retiredThroughEpoch
        };
        return Boolean(
            lease
            && compareScrapeLeaseOrder(getScrapeLeaseOrder(lease), retiredOrder) <= 0
            && !committed.has(scrapeCompletionLeaseKey(lease))
        );
    };
    queue = queue.filter((item) => !shouldRevoke(item));
    for (const [downloadId, operation] of operations) {
        if (shouldRevoke(operation)) operations.delete(downloadId);
    }
    applyCompletionRetrySnapshots(queue, operations, scrapeCompletionTxn);
    scrapeCompletionCheckpoint = normalized;
    return true;
}

function applyScrapeCompletionJournalRecord(record) {
    const lease = normalizeScrapeLease(record.lease);
    if (!lease) return false;
    scrapeCompletionJournalRevision = Math.max(scrapeCompletionJournalRevision, record.revision || 0);
    if (record.phase === 'revoked') {
        const queue = cloneCloudQueue().filter((item) => !recordOwnedByScrapeLease(item, lease));
        const operations = deserializeDownloadOperations(serializeDownloadOperations(pendingDownloadOperations));
        for (const [downloadId, operation] of operations) {
            if (recordOwnedByScrapeLease(operation, lease)) operations.delete(downloadId);
        }
        const nextTxn = completionTxnMatchesLease(scrapeCompletionTxn, lease) ? null : scrapeCompletionTxn;
        applyCompletionRetrySnapshots(queue, operations, nextTxn);
        scrapeCompletionCheckpoint = mergeScrapeCompletionCheckpointAuthority(
            scrapeCompletionCheckpoint,
            record.checkpoint
        );
        return true;
    }
    if (!record.txn || typeof record.txn !== 'object') return false;
    const txn = { ...record.txn, phase: record.phase };
    const snapshots = buildCompletionRetrySnapshots(lease, txn);
    applyCompletionRetrySnapshots(snapshots.queue, snapshots.operations, txn);
    if (record.phase === 'committed') {
        scrapeCompletionCheckpoint = mergeScrapeCompletionCheckpointAuthority(
            scrapeCompletionCheckpoint,
            record.checkpoint
        );
    }
    return true;
}

async function hydrateScrapeCompletionJournal(
    stored = {},
    deadlineAt = Date.now() + CLOUD_QUEUE_MUTATION_TIMEOUT_MS
) {
    const records = getScrapeCompletionJournalRecords(stored);
    const latestRevision = records
        .filter((record) => {
            const order = getScrapePersistenceOrder(record);
            return order.writerEpoch === scrapePersistenceWriterEpoch
                && order.writerId === scrapePersistenceWriterId;
        })
        .reduce((latest, record) => Math.max(latest, record.revision), 0);
    scrapeCompletionJournalRevision = Math.max(scrapeCompletionJournalRevision, latestRevision);
    const retainedRecord = records
        .filter((record) => (
            (record.phase === 'committed' || record.phase === 'revoked')
            && normalizeScrapeCompletionCheckpoint(record.checkpoint)
        ))
        .sort((left, right) => compareScrapePersistenceOrder(right, left))[0] || null;
    if (retainedRecord) {
        applyScrapeCompletionCheckpoint(retainedRecord.checkpoint);
        applyScrapeCompletionJournalRecord(retainedRecord);
    }
    for (const record of records) {
        if (retainedRecord && compareScrapePersistenceOrder(record, retainedRecord) <= 0) continue;
        applyScrapeCompletionJournalRecord(record);
    }
    if (retainedRecord) await compactScrapeCompletionJournal(retainedRecord, deadlineAt);
    return records;
}

function buildCompletionRetrySnapshots(
    lease,
    txn,
    queueSource = cloudSyncQueue,
    operationsSource = pendingDownloadOperations
) {
    const queue = cloneCloudQueue(queueSource).map((item) => {
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
    const operations = deserializeDownloadOperations(serializeDownloadOperations(operationsSource));
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

function getRunOwnedActiveDownloadFinalizations(lease) {
    const finalizations = [];
    for (const [downloadId, finalization] of activeDownloadOperationFinalizations) {
        const operation = pendingDownloadOperations.get(downloadId);
        if (scrapeLeaseMatches(finalization.lease, lease)
            || recordOwnedByScrapeLease(operation, lease)) {
            finalizations.push(finalization.settled);
        }
    }
    return finalizations;
}

function assertScrapeCompletionTransferCurrent(lease, transition) {
    if (transition.revoked
        || transition.abandoned
        || scrapeCompletionTransition !== transition
        || !scrapeLeaseMatches(activeScrapeLease, lease)) {
        throw createScrapeAuthorityRevokedError();
    }
    if (Date.now() >= transition.deadlineAt) {
        throw createScrapeCompletionTransferTimeoutError();
    }
}

function assertScrapeCompletionTransitionCurrent(transition) {
    if (transition.revoked
        || transition.abandoned
        || scrapeCompletionTransition !== transition) {
        throw createScrapeAuthorityRevokedError();
    }
    if (Date.now() >= transition.deadlineAt) {
        throw createScrapeCompletionTransferTimeoutError();
    }
}

async function runWithScrapeCompletionMutationBarrier({
    lease,
    transition,
    waitForFinalizers = false,
    deadlineAt = transition.deadlineAt,
    operation
}) {
    transition.deadlineAt = Math.min(
        Number.isFinite(deadlineAt) ? deadlineAt : Number.POSITIVE_INFINITY,
        Date.now() + CLOUD_QUEUE_MUTATION_TIMEOUT_MS
    );
    try {
        while (true) {
            const cloudQueueTail = cloudQueueMutationQueue;
            const pendingOperationsTail = pendingDownloadOperationsMutationQueue;
            await awaitScrapeCompletionDeadline(
                Promise.all([cloudQueueTail, pendingOperationsTail]),
                transition.deadlineAt
            );
            if (cloudQueueTail !== cloudQueueMutationQueue
                || pendingOperationsTail !== pendingDownloadOperationsMutationQueue) {
                continue;
            }

            if (waitForFinalizers) {
                const finalizations = getRunOwnedActiveDownloadFinalizations(lease);
                if (finalizations.length > 0) {
                    await awaitScrapeCompletionDeadline(
                        Promise.allSettled(finalizations),
                        transition.deadlineAt
                    );
                    continue;
                }
            }

            let releaseBarrier;
            const barrier = new Promise((resolve) => { releaseBarrier = resolve; });
            let barrierReleased = false;
            const releaseMutationBarrier = () => {
                if (barrierReleased) return;
                barrierReleased = true;
                if (transition.releaseMutationBarrier === releaseMutationBarrier) {
                    transition.releaseMutationBarrier = null;
                }
                releaseBarrier();
            };
            cloudQueueMutationQueue = barrier;
            pendingDownloadOperationsMutationQueue = barrier;
            transition.releaseMutationBarrier = releaseMutationBarrier;
            const operationPromise = Promise.resolve().then(operation);
            operationPromise.then(releaseMutationBarrier, releaseMutationBarrier);
            operationPromise.catch(() => {});
            try {
                return await awaitScrapeCompletionDeadline(
                    operationPromise,
                    transition.deadlineAt
                );
            } finally {
                releaseMutationBarrier();
            }
        }
    } catch (error) {
        if (error?.message === 'scrape_completion_transfer_persist_timeout') {
            transition.status = `${transition.status}_timed_out`;
            transition.abandoned = true;
            transition.releaseMutationBarrier?.();
        }
        throw error;
    }
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

async function recoverPreparedScrapeCompletionTransfer(
    startupDeadlineAt = Date.now() + CLOUD_QUEUE_MUTATION_TIMEOUT_MS
) {
    const txn = scrapeCompletionTxn;
    if (txn?.phase !== 'prepared') return false;
    if (scrapeCompletionTransition && scrapeCompletionTransition.status !== 'committed') return false;
    const deadlineAt = Math.min(
        Number.isFinite(startupDeadlineAt) ? startupDeadlineAt : Number.POSITIVE_INFINITY,
        Date.now() + CLOUD_QUEUE_MUTATION_TIMEOUT_MS
    );

    const lease = normalizeScrapeLease(txn.lease);
    if (!lease) {
        const queue = cloneCloudQueue().filter((item) => item?.completionTxnId !== txn.id);
        const operations = deserializeDownloadOperations(serializeDownloadOperations(pendingDownloadOperations));
        for (const [downloadId, operation] of operations) {
            if (operation?.completionTxnId === txn.id) operations.delete(downloadId);
        }
        applyCompletionRetrySnapshots(queue, operations, null);
        return false;
    }

    await awaitScrapeCompletionDeadline(ensureScrapeLeaseHydrated(), deadlineAt);
    const stored = await awaitScrapeCompletionDeadline(
        chrome.storage.local.get(['r2BackupState', 'scrapeStopReason']),
        deadlineAt
    );
    const stopReason = stored.scrapeStopReason || stored.r2BackupState?.stopReason || null;
    if (stopReason === 'stopped'
        || stopReason === 'owner_tab_closed'
        || stopReason === 'completion_timeout') {
        await revokeScrapeRetryAuthorityAtomically(lease, deadlineAt);
        return false;
    }
    if (activeScrapeLease?.status === 'active' && !scrapeLeaseMatches(activeScrapeLease, lease)) {
        await revokeScrapeRetryAuthorityAtomically(lease, deadlineAt);
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
    const transition = {
        txn: committedTxn,
        status: 'recovering',
        persisted: false,
        revoked: false,
        abandoned: false,
        pendingWritePromise: null,
        releaseMutationBarrier: null,
        deadlineAt
    };
    scrapeCompletionTransition = transition;
    try {
        return await runWithScrapeCompletionMutationBarrier({
            lease,
            transition,
            deadlineAt,
            operation: async () => {
                assertScrapeCompletionTransitionCurrent(transition);
                const snapshots = buildCompletionRetrySnapshots(lease, committedTxn);
                await persistCompletionRetrySnapshots(
                    snapshots.queue,
                    snapshots.operations,
                    committedTxn,
                    transition,
                    'recovering'
                );
                transition.status = 'committed';
                if (scrapeCompletionTransition === transition) scrapeCompletionTransition = null;
                return true;
            }
        });
    } catch (error) {
        transition.abandoned = true;
        transition.releaseMutationBarrier?.();
        if (scrapeCompletionTransition === transition) scrapeCompletionTransition = null;
        throw error;
    }
}

async function persistCompletionRetrySnapshots(queue, operations, txn, transition, stage) {
    transition.status = stage;
    const snapshots = { queue, operations };
    const journalRecord = makeScrapeCompletionJournalRecord(
        txn.lease,
        txn.phase,
        txn,
        snapshots
    );
    const startedWrite = startScrapeCompletionJournalWrite(journalRecord);
    const pendingWrite = startedWrite.write.then(async () => {
        transition.persisted = true;
        assertScrapeCompletionTransitionCurrent(transition);
        if (journalRecord.checkpoint) {
            const adopted = await adoptScrapeCompletionCheckpoint({
                ...journalRecord,
                storageKey: startedWrite.storageKey
            }, transition.deadlineAt, () => assertScrapeCompletionTransitionCurrent(transition));
            if (!adopted) throw createScrapeAuthorityRevokedError();
        }
        assertScrapeCompletionTransitionCurrent(transition);
        applyCompletionRetrySnapshots(queue, operations, txn);
    });
    transition.pendingWritePromise = pendingWrite;
    try {
        await pendingWrite;
    } catch (error) {
        if (scrapeCompletionTransition === transition) scrapeCompletionTransition = null;
        throw error;
    } finally {
        if (transition.pendingWritePromise === pendingWrite) transition.pendingWritePromise = null;
    }
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
        abandoned: false,
        pendingWritePromise: null,
        releaseMutationBarrier: null,
        deadlineAt: Date.now() + CLOUD_QUEUE_MUTATION_TIMEOUT_MS
    };
    scrapeCompletionTransition = transition;
    try {
        const activeDrain = cloudQueueDrainPromise;
        if (activeDrain) {
            await awaitScrapeCompletionDeadline(activeDrain, transition.deadlineAt);
        }
        return await runWithScrapeCompletionMutationBarrier({
            lease,
            transition,
            waitForFinalizers: true,
            operation: async () => {
                assertScrapeCompletionTransferCurrent(lease, transition);
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
            }
        });
    } catch (error) {
        const timedOut = error?.message === 'scrape_completion_transfer_persist_timeout';
        if (timedOut) {
            transition.revoked = true;
            transition.abandoned = true;
            transition.releaseMutationBarrier?.();
        }
        if (scrapeCompletionTransition === transition) {
            scrapeCompletionTransition = null;
        }
        if (timedOut) {
            await stopScrapeRun(lease.kind, 'completion_timeout').catch(async () => {
                await revokeScrapeRetryAuthorityAtomically(lease).catch(() => {});
            });
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
    try {
        prepared.transition.deadlineAt = Date.now() + CLOUD_QUEUE_MUTATION_TIMEOUT_MS;
        await runWithScrapeCompletionMutationBarrier({
            transition: prepared.transition,
            operation: async () => {
                assertScrapeCompletionTransitionCurrent(prepared.transition);
                const snapshots = buildCompletionRetrySnapshots(prepared.txn.lease, committedTxn);
                await persistCompletionRetrySnapshots(
                    snapshots.queue,
                    snapshots.operations,
                    committedTxn,
                    prepared.transition,
                    'committing'
                );
                prepared.transition.status = 'committed';
                if (scrapeCompletionTransition === prepared.transition) scrapeCompletionTransition = null;
            }
        });
    } catch (error) {
        if (error?.message === 'scrape_completion_transfer_persist_timeout') {
            prepared.transition.revoked = true;
            prepared.transition.abandoned = true;
            prepared.transition.releaseMutationBarrier?.();
            if (scrapeCompletionTransition === prepared.transition) scrapeCompletionTransition = null;
            await revokeScrapeRetryAuthorityAtomically(prepared.txn.lease);
        }
        throw error;
    }
}

function markScrapeCompletionTransitionRevoked(lease) {
    if (scrapeCompletionTransition
        && completionTxnMatchesLease(scrapeCompletionTransition.txn, lease)) {
        scrapeCompletionTransition.revoked = true;
    }
}

async function revokeScrapeRetryAuthorityAtomically(
    lease,
    requestedDeadlineAt = Date.now() + Math.max(
        CLOUD_QUEUE_MUTATION_TIMEOUT_MS,
        PENDING_DOWNLOAD_MUTATION_TIMEOUT_MS
    )
) {
    const deadlineAt = Math.min(
        Number.isFinite(requestedDeadlineAt) ? requestedDeadlineAt : Number.POSITIVE_INFINITY,
        Date.now() + Math.max(CLOUD_QUEUE_MUTATION_TIMEOUT_MS, PENDING_DOWNLOAD_MUTATION_TIMEOUT_MS)
    );
    const queue = cloneCloudQueue().filter((item) => !recordOwnedByScrapeLease(item, lease));
    const operations = deserializeDownloadOperations(serializeDownloadOperations(pendingDownloadOperations));
    for (const [downloadId, operation] of operations) {
        if (recordOwnedByScrapeLease(operation, lease)) operations.delete(downloadId);
    }
    const nextTxn = completionTxnMatchesLease(scrapeCompletionTxn, lease) ? null : scrapeCompletionTxn;
    cloudStatePersistenceRevision += 1;
    pendingDownloadOperationsRevision += 1;
    applyCompletionRetrySnapshots(queue, operations, nextTxn);
    const snapshots = { queue, operations };
    const journalRecord = makeScrapeCompletionJournalRecord(lease, 'revoked', null, snapshots);
    const startedWrite = startScrapeCompletionJournalWrite(journalRecord);
    const operation = { abandoned: false };
    const assertCurrent = () => {
        if (operation.abandoned || Date.now() >= deadlineAt) {
            throw createScrapeCompletionTransferTimeoutError();
        }
    };
    const persistence = startedWrite.write.then(async () => {
        assertCurrent();
        const adopted = await adoptScrapeCompletionCheckpoint({
            ...journalRecord,
            storageKey: startedWrite.storageKey
        }, deadlineAt, assertCurrent);
        assertCurrent();
        return adopted;
    });
    persistence.catch(() => {});
    const timeout = Symbol('scrape_revocation_persist_timeout');
    const result = await withTimeout(
        persistence.then((persisted) => persisted === true, () => false),
        Math.max(0, deadlineAt - Date.now()),
        timeout
    );
    if (result !== true || Date.now() >= deadlineAt) {
        operation.abandoned = true;
        throw new Error('scrape_revocation_persist_timeout');
    }
    return true;
}

async function settleRevokedScrapeCompletionTransition(lease) {
    const transition = scrapeCompletionTransition;
    if (!transition || !completionTxnMatchesLease(transition.txn, lease)) return true;
    transition.revoked = true;
    transition.abandoned = true;
    transition.releaseMutationBarrier?.();
    transition.pendingWritePromise = null;
    if (scrapeCompletionTransition === transition) scrapeCompletionTransition = null;
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
    if (activeDownloadOperationFinalizations.has(downloadId)) return false;
    const initialOperation = pendingDownloadOperations.get(downloadId);
    if (initialOperation && isCompletionTransitionBlockingRecord(initialOperation)) return false;
    let settleFinalization;
    const finalization = {
        lease: getDownloadOperationScrapeLease(initialOperation),
        settled: new Promise((resolve) => { settleFinalization = resolve; })
    };
    activeDownloadOperationFinalizations.set(downloadId, finalization);

    try {
        if (assertAuthorized) await assertAuthorized();
        let operation = await getDownloadOperation(downloadId);
        if (!operation || operation.downloadState !== 'complete') return false;
        if (operation.cloudRequired && operation.r2State !== 'present') return false;
        finalization.lease = finalization.lease || getDownloadOperationScrapeLease(operation);
        const operationRevision = operation.operationRevision || 0;
        const authorityGuard = assertAuthorized || getDownloadOperationAuthorityGuard(operation);
        if (authorityGuard) await authorityGuard();

        const localReceiptRequired = operation.allowLocal && !operation.localIdentityPersisted;
        const r2ReceiptRequired = operation.cloudRequired
            && operation.r2State === 'present'
            && !operation.r2IdentityPersisted;
        const receiptIds = Array.from(new Set([
            operation.mediaId,
            operation.reservationKey
        ].filter(Boolean)));
        if (receiptIds.length && (localReceiptRequired || r2ReceiptRequired)) {
            await mutateProcessedReceipts({
                localIds: localReceiptRequired ? receiptIds : [],
                r2Ids: r2ReceiptRequired ? receiptIds : []
            }, authorityGuard);
            operation = await updateDownloadOperationRevision(downloadId, operationRevision, {
                finalIdentityPersisted: true,
                ...(localReceiptRequired ? { localIdentityPersisted: true } : {}),
                ...(r2ReceiptRequired ? { r2IdentityPersisted: true } : {})
            });
            if (!operation) return false;
            if (authorityGuard) await authorityGuard();
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
        const removed = await removeDownloadOperationRevision(
            downloadId,
            operationRevision
        );
        return Boolean(removed);
    } finally {
        if (activeDownloadOperationFinalizations.get(downloadId) === finalization) {
            activeDownloadOperationFinalizations.delete(downloadId);
        }
        settleFinalization();
    }
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
    const scrapeLease = getDownloadOperationScrapeLease(operation);
    if (scrapeLease?.kind === 'r2_backup') clearR2BackupInventoryCache(scrapeLease);

    if (operation.downloadState === 'complete') {
        return finalizeDownloadOperation(downloadId, { assertAuthorized: authorityGuard });
    }
    return true;
}

async function recordDownloadOperationError(downloadId, error, code, { incrementAttempts = true } = {}) {
    const operation = await getDownloadOperation(downloadId);
    if (!operation) return null;
    const lastError = formatRedactedMediaError(error, operation.mediaId, code);
    await updateDownloadOperation(downloadId, (existing) => ({
        ...existing,
        attempts: (existing.attempts || 0) + (incrementAttempts ? 1 : 0),
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
        await enqueueCloudMediaUpload(sourceUrl, operation.finalPath, operation.promptText || '', null, {
            cleanupDownloadId: operation.downloadId,
            scrapeLease: getDownloadOperationScrapeLease(operation),
            assertAuthorized: authorityGuard,
            captureMetadata: operation.captureMetadata || null,
            requireCaptureMetadata: operation.requireCaptureMetadata === true
        });
        if (authorityGuard) await authorityGuard();
    } catch (error) {
        if (isScrapeAuthorityRevokedError(error)) throw error;
        await recordDownloadOperationError(operation.downloadId, error, 'public_queue_failed');
    } finally {
        activeDownloadOperations.delete(operation.downloadId);
    }
}

async function readDownloadedFileForUpload(downloadItem, assertAuthorized = null) {
    if (!downloadItem?.filename) throw new Error('[download-search] item unavailable');
    if (assertAuthorized) await assertAuthorized();
    try {
        const hasDocument = typeof chrome.offscreen?.hasDocument === 'function'
            ? await chrome.offscreen.hasDocument()
            : false;
        if (!hasDocument) {
            await chrome.offscreen.createDocument({
                url: 'offscreen.html',
                reasons: ['BLOBS'],
                justification: 'Read a completed Grok media download for its configured R2 backup'
            });
        }
    } catch (error) {
        const message = String(error?.message || '');
        if (!message.includes('already exists') && !message.includes('Only a single offscreen')) {
            throw error;
        }
    }
    if (assertAuthorized) await assertAuthorized();
    const fileData = await chrome.runtime.sendMessage({
        action: 'READ_FILE_FOR_UPLOAD',
        filePath: downloadItem.filename,
        contentType: downloadItem.mime || 'application/octet-stream'
    });
    if (assertAuthorized) await assertAuthorized();
    if (!fileData?.ok || typeof fileData.base64 !== 'string') {
        throw new Error(`[download-read] ${fileData?.error || 'file read failed'}`);
    }
    const binary = atob(fileData.base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
    return new Blob([bytes], {
        type: fileData.type || downloadItem.mime || 'application/octet-stream'
    });
}

async function uploadAuthenticatedDownload(operation, downloadItem, assertAuthorized = null) {
    if (activeDownloadOperations.has(operation.downloadId)) return;
    const authorityGuard = assertAuthorized || getDownloadOperationAuthorityGuard(operation);
    if (authorityGuard) await authorityGuard();
    activeDownloadOperations.add(operation.downloadId);
    try {
        if (!downloadItem) throw new Error('[download-search] item unavailable');
        const sourceUrl = downloadItem.finalUrl || downloadItem.url;
        if (!sourceUrl) throw new Error('[download-search] source unavailable');

        console.log('[CloudQueue]', formatRedactedMediaLog('download_complete', operation.mediaId));
        const blob = await readDownloadedFileForUpload(downloadItem, authorityGuard);
        const config = await getCloudConfig();
        if (authorityGuard) await authorityGuard();
        if (!CloudSync.isCloudEnabled(config)) throw new Error('[config] cloud sync disabled');
        const userInfo = await chrome.storage.local.get(['activeGrokUserId']);
        if (authorityGuard) await authorityGuard();
        const result = await uploadBlobWithR2Dedupe(config, {
            sourceUrl,
            finalPath: operation.finalPath,
            userId: userInfo.activeGrokUserId || 'Shared_Account',
            contentType: blob.type || downloadItem.mime || 'application/octet-stream',
            promptText: operation.promptText || '',
            captureMetadata: operation.captureMetadata || null,
            requireCaptureMetadata: operation.requireCaptureMetadata === true,
            acceptance: buildAcceptanceContextFromCloudConfig(config, 'download-upload')
        }, blob, authorityGuard);
        if (authorityGuard) await authorityGuard();
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

    const localOnly = operation.allowLocal && !operation.cloudRequired;
    const receiptIds = Array.from(new Set([
        operation.mediaId,
        operation.reservationKey
    ].filter(Boolean)));
    if (localOnly && receiptIds.length && !operation.localIdentityPersisted) {
        await mutateProcessedReceipts({ localIds: receiptIds }, authorityGuard);
        operation = await updateDownloadOperation(downloadId, { localIdentityPersisted: true });
        if (!operation) return;
        if (authorityGuard) await authorityGuard();
    }

    if (!operation.cloudRequired) {
        await removeDownloadOperation(downloadId);
        return;
    }

    if (operation.r2State === 'present') {
        await finalizeDownloadOperation(downloadId, { assertAuthorized: authorityGuard });
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

    if (operation.downloadState === 'complete' && operation.r2State === 'present') {
        await finalizeDownloadOperation(operation.downloadId, {
            historyMissing: true,
            assertAuthorized
        });
        return;
    }
    if (operation.downloadState === 'complete' && operation.allowLocal && !operation.cloudRequired) {
        const receiptIds = Array.from(new Set([
            operation.mediaId,
            operation.reservationKey
        ].filter(Boolean)));
        if (receiptIds.length && !operation.localIdentityPersisted) {
            await mutateProcessedReceipts({ localIds: receiptIds }, assertAuthorized);
        }
        await removeDownloadOperation(operation.downloadId);
        return;
    }

    if (operation.strategy === 'public_queue' && operation.r2State !== 'present') {
        await linkPublicQueueOperation(operation);
        if (assertAuthorized) await assertAuthorized();
        return;
    }

    if (operation.cloudRequired && operation.r2State !== 'present') return;

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
            promptText: scrapeReceipt?.promptText || '',
            captureMetadata: scrapeReceipt?.captureMetadata || null,
            requireCaptureMetadata: scrapeReceipt?.requireCaptureMetadata === true,
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
    });
    return true;
}

async function handleDownloadChanged(delta) {
    try {
        await waitForBackgroundInitialization();
    } catch {
        return;
    }
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
        if (scrapeLease) await trackScrapeTransferTask(scrapeLease, operation, 'download_finalize');
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
    if (scrapeLease) await trackScrapeTransferTask(scrapeLease, operation, 'download_finalize');
    else await operation();
}

function handleDownloadChangedEvent(delta) {
    return handleDownloadChanged(delta).catch(async (error) => {
        if (isScrapeAuthorityRevokedError(error)) return;
        updateCloudError(formatRedactedMediaError(error, null, 'download_event_failed'));
        await persistCloudState().catch(() => {});
    });
}

if (typeof module !== 'undefined') {
    module.exports = {
        applyBackupProcessedIdPersistence,
        buildAcceptanceContextFromCloudConfig,
        buildDirectBackupUploadResponse,
        buildR2BackupInitMessage,
        buildR2BackupInitMessageForConfig,
        cancelPendingMetadataSyncForTest,
        dispatchNativeClick,
        enqueueCloudItemForTest: enqueueCloudItem,
        enqueueCloudMediaUpload,
        extractGrokMediaIdFallback,
        fetchRecreateReferenceDataUrl,
        getR2BackupCompletionStatusLabel,
        getCloudSyncForTest: () => CloudSync,
        getCloudSyncQueueForTest: () => cloudSyncQueue.map((item) => ({ ...item })),
        getBackgroundStateForTest: () => ({ ...backgroundStateStatus }),
        getGenerationRunControllerForTest: () => generationRunController,
        getGenerationBlockingWorkflow,
        getPendingDownloadOperationsForTest: () => serializeDownloadOperations(pendingDownloadOperations),
        getProcessedUUIDsForTest: () => Array.from(processedUUIDs),
        getScrapeDurabilitySnapshot,
        generateFilename,
        headVerifiedVaultObject,
        handleDownloadChanged,
        handleDownloadFilename,
        initializeBackgroundState,
        initializeGenerationRunController,
        ensureBackgroundStateReady,
        initializeScrapeInActiveTab,
        ensureScrapeLeaseHydrated,
        isGrokSavedUrl,
        isR2BackupCompletionSuccessful,
        loadVerifiedVaultInventory,
        queueChromeDownload,
        stopScrapeRun,
        validateScrapeResume,
        waitForBackgroundInitialization,
        withTimeout,
        persistQueuedBackupProcessedId,
        persistQueuedBackupProcessedIdAfterSuccess,
        recreateWorkflowController,
        RECREATE_WORKFLOW_MESSAGE_TIMEOUT_MS,
        requestPresignedUrl,
        reserveDownloadOperationForTest: reserveDownloadOperation,
        removeDownloadOperationRevisionForTest: removeDownloadOperationRevision,
        parseFilenameInfo,
        processCompletedDownloadOperation,
        processCloudQueue,
        markDownloadOperationR2Present,
        reconcileMissingDownloadOperation,
        setCloudSyncQueueForTest: (items) => {
            cloudSyncQueue = items.map((item) => ({ ...item }));
            cloudQueueRevision = cloudSyncQueue.reduce(
                (latest, item) => Math.max(latest, Number.isInteger(item.queueRevision) ? item.queueRevision : 0),
                cloudQueueRevision
            );
        },
        setProcessedUUIDsForTest: (ids) => { processedUUIDs = new Set(ids); },
        testCloudConnection,
        updateDownloadOperation,
        uploadAssetMetadataSidecar,
        uploadBlobWithR2Dedupe,
        uploadMetadataQueueItem,
        verifyR2Object
    };
}

// --- STANDARD DOWNLOAD LISTENER ---
chrome.downloads.onDeterminingFilename.addListener(handleDownloadFilenameEvent);

// --- POST-DOWNLOAD R2 UPLOAD (for auth URLs like assets.grok.com) ---
chrome.downloads.onChanged.addListener(handleDownloadChangedEvent);
