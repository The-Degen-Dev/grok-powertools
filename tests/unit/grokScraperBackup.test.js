const {
    recordBackupUploadStatus,
    resolveBackupScrollAttempt,
    getR2BackupCanaryStopReason,
    getR2BackupPageCommandOptions,
    GrokScraper,
    SettingsManager,
    selectBackupMediaElement,
    selectMatchingLegacyDetailMedia,
    shouldPersistBackupProcessedId
} = require('../../content.js');
const {
    formatR2BackupDetails,
    getR2BackupDoneStatusLabel
} = require('../../popup.js');
const CloudSyncUtils = require('../../cloudSyncUtils.js');
const fs = require('fs');
const path = require('path');
const { Blob: NodeBlob } = require('buffer');
const { webcrypto } = require('crypto');

function setElementBox(el, { width, height, top = 0, left = 0, naturalWidth = width }) {
    Object.defineProperty(el, 'naturalWidth', {
        configurable: true,
        value: naturalWidth
    });
    Object.defineProperty(el, 'naturalHeight', {
        configurable: true,
        value: height
    });
    el.getBoundingClientRect = () => ({
        x: left,
        y: top,
        top,
        left,
        width,
        height,
        right: left + width,
        bottom: top + height
    });
}

describe('Grok backup media selection', () => {
    afterEach(() => {
        document.body.textContent = '';
    });

    test('selects the large generated detail image instead of profile and UI images', () => {
        document.body.innerHTML = `
            <img id="pfp" alt="pfp" src="https://assets.grok.com/users/user-1/profile-picture.webp">
            <img id="share" alt="" src="https://imagine-public.x.ai/i/imagine-public/share-images/share-card.jpg">
            <img id="smallThumb" alt="Most recent favorite" src="https://assets.grok.com/users/user-1/old-favorite/content">
            <img id="generated" alt="Generated detail image" src="https://assets.grok.com/users/user-1/real-media-id/content">
        `;

        setElementBox(document.getElementById('pfp'), { width: 30, height: 30, naturalWidth: 300 });
        setElementBox(document.getElementById('share'), { width: 35, height: 36, naturalWidth: 720 });
        setElementBox(document.getElementById('smallThumb'), { width: 48, height: 48, naturalWidth: 720 });
        setElementBox(document.getElementById('generated'), { width: 421, height: 748, naturalWidth: 720 });

        const media = selectBackupMediaElement(document);

        expect(media).toBe(document.getElementById('generated'));
    });

    test('prefers the active video element when a detail page has video media', () => {
        document.body.innerHTML = `
            <img id="poster" src="https://assets.grok.com/users/user-1/video-thumb/content">
            <video id="video" src="https://assets.grok.com/users/user-1/media-id/generated_video.mp4"></video>
        `;
        setElementBox(document.getElementById('poster'), { width: 400, height: 400, naturalWidth: 720 });
        setElementBox(document.getElementById('video'), { width: 720, height: 720, naturalWidth: 0 });

        const media = selectBackupMediaElement(document);

        expect(media).toBe(document.getElementById('video'));
    });

    test('accepts visible generated videos from the assets videos path', () => {
        document.body.innerHTML = `
            <video id="video" src="https://assets.grok.com/videos/media-id/generated_video.mp4"></video>
        `;
        setElementBox(document.getElementById('video'), { width: 720, height: 720, naturalWidth: 0 });

        const media = selectBackupMediaElement(document);

        expect(media).toBe(document.getElementById('video'));
    });

    test('ignores tiny stale videos before choosing a generated image', () => {
        document.body.innerHTML = `
            <video id="staleVideo" src="https://assets.grok.com/users/user-1/stale/generated_video.mp4"></video>
            <img id="generated" alt="Generated detail image" src="https://assets.grok.com/users/user-1/real-media-id/content">
        `;
        setElementBox(document.getElementById('staleVideo'), { width: 1, height: 1, top: -1000, naturalWidth: 0 });
        setElementBox(document.getElementById('generated'), { width: 421, height: 748, naturalWidth: 720 });

        const media = selectBackupMediaElement(document);

        expect(media).toBe(document.getElementById('generated'));
    });

    test('prefers a visible generated video over a generated image', () => {
        document.body.innerHTML = `
            <img id="generated" alt="Generated detail image" src="https://assets.grok.com/users/user-1/real-media-id/content">
            <video id="video" src="https://assets.grok.com/users/user-1/media-id/generated_video.mp4"></video>
        `;
        setElementBox(document.getElementById('generated'), { width: 421, height: 748, naturalWidth: 720 });
        setElementBox(document.getElementById('video'), { width: 720, height: 720, naturalWidth: 0 });

        const media = selectBackupMediaElement(document);

        expect(media).toBe(document.getElementById('video'));
    });

    test('ignores small rendered thumbnails even when they report large natural dimensions', () => {
        document.body.innerHTML = `
            <img id="pfp" alt="pfp" src="https://assets.grok.com/users/user-1/profile-picture.webp">
            <img id="thumb" alt="" src="https://assets.grok.com/users/user-1/thumb-media-id/content">
        `;
        setElementBox(document.getElementById('pfp'), { width: 30, height: 30, naturalWidth: 300 });
        setElementBox(document.getElementById('thumb'), { width: 48, height: 48, naturalWidth: 720 });
        Object.defineProperty(document.getElementById('thumb'), 'naturalHeight', {
            configurable: true,
            value: 720
        });

        const media = selectBackupMediaElement(document);

        expect(media).toBeNull();
    });

    test('selects only the pending Saved identity from a legacy detail surface', () => {
        const expectedId = '11111111-1111-4111-8111-111111111111';
        const decoyId = '22222222-2222-4222-8222-222222222222';
        document.body.innerHTML = `
            <img id="decoy" src="https://assets.grok.com/users/user-1/generated/${decoyId}/image.jpg">
            <img id="expected" src="https://assets.grok.com/users/user-1/generated/${expectedId}/image.jpg">
        `;
        setElementBox(document.getElementById('decoy'), { width: 900, height: 900, naturalWidth: 1024 });
        setElementBox(document.getElementById('expected'), { width: 700, height: 700, naturalWidth: 1024 });

        expect(selectMatchingLegacyDetailMedia(document, expectedId)).toBe(document.getElementById('expected'));
        expect(selectMatchingLegacyDetailMedia(document, '33333333-3333-4333-8333-333333333333')).toBeNull();
    });

    test('prefers the matching generated video over its matching poster', () => {
        const expectedId = '44444444-4444-4444-8444-444444444444';
        document.body.innerHTML = `
            <img id="poster" src="https://assets.grok.com/users/user-1/generated/${expectedId}/poster.jpg">
            <video id="video" src="https://assets.grok.com/users/user-1/generated/${expectedId}/generated_video.mp4"></video>
        `;
        setElementBox(document.getElementById('poster'), { width: 800, height: 800, naturalWidth: 1024 });
        setElementBox(document.getElementById('video'), { width: 700, height: 700, naturalWidth: 0 });

        expect(selectMatchingLegacyDetailMedia(document, expectedId)).toBe(document.getElementById('video'));
    });
});

function mockChromeForBackground() {
    return {
        alarms: {
            clear: jest.fn(() => Promise.resolve()),
            create: jest.fn(() => Promise.resolve()),
            onAlarm: { addListener: jest.fn() }
        },
        downloads: {
            cancel: jest.fn(),
            download: jest.fn(),
            erase: jest.fn(),
            onChanged: { addListener: jest.fn() },
            onDeterminingFilename: { addListener: jest.fn() },
            removeFile: jest.fn(),
            search: jest.fn()
        },
        offscreen: {
            createDocument: jest.fn(() => Promise.resolve())
        },
        runtime: {
            getURL: jest.fn((path) => path),
            onMessage: { addListener: jest.fn() },
            sendMessage: jest.fn(() => Promise.resolve())
        },
        storage: {
            local: {
                get: jest.fn(() => Promise.resolve({})),
                set: jest.fn(() => Promise.resolve())
            },
            onChanged: { addListener: jest.fn() }
        },
        tabs: {
            onRemoved: { addListener: jest.fn() },
            onUpdated: { addListener: jest.fn() },
            query: jest.fn(),
            sendMessage: jest.fn()
        }
    };
}

function loadBackgroundForTest() {
    jest.resetModules();
    global.chrome = mockChromeForBackground();
    return require('../../background.js');
}

function cloneJson(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function findStoredRecord(values, kind, predicate = () => true) {
    return Object.values(values || {}).find((value) => (
        value
        && typeof value === 'object'
        && value.kind === kind
        && predicate(value)
    ));
}

function isCompletionPersistence(values, phase) {
    return Boolean(findStoredRecord(
        values,
        'scrape_completion_journal',
        (record) => record.phase === phase
    ));
}

function getStoredCompletionRecord(storageState, phase, txnId = null) {
    return findStoredRecord(
        storageState,
        'scrape_completion_journal',
        (record) => record.phase === phase && (!txnId || record.txn?.id === txnId)
    );
}

function createDeferred() {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

function createDurableBackgroundHarness(initialStorage = {}, initialDownloads = {}, initialSession = {}) {
    const storageState = cloneJson(initialStorage);
    const sessionState = cloneJson(initialSession);
    const downloads = new Map(Object.entries(initialDownloads).map(([id, item]) => [Number(id), cloneJson(item)]));
    const storageListeners = [];

    const chromeApi = mockChromeForBackground();
    chromeApi.cookies = { getAll: jest.fn(() => Promise.resolve([])) };
    chromeApi.runtime.getManifest = jest.fn(() => ({ version: 'test' }));
    chromeApi.storage.local.get.mockImplementation(async (keys) => {
        if (keys == null) return cloneJson(storageState);
        const names = Array.isArray(keys) ? keys : [keys];
        return names.reduce((result, key) => {
            if (Object.prototype.hasOwnProperty.call(storageState, key)) {
                result[key] = cloneJson(storageState[key]);
            }
            return result;
        }, {});
    });
    chromeApi.storage.local.set.mockImplementation(async (values) => {
        const changes = {};
        for (const [key, value] of Object.entries(values)) {
            changes[key] = {
                oldValue: cloneJson(storageState[key]),
                newValue: cloneJson(value)
            };
            storageState[key] = cloneJson(value);
        }
        storageListeners.forEach((listener) => listener(changes, 'local'));
    });
    chromeApi.storage.session = {
        get: jest.fn(async (keys) => {
            if (keys == null) return cloneJson(sessionState);
            const names = Array.isArray(keys) ? keys : [keys];
            return names.reduce((result, key) => {
                if (Object.prototype.hasOwnProperty.call(sessionState, key)) {
                    result[key] = cloneJson(sessionState[key]);
                }
                return result;
            }, {});
        }),
        set: jest.fn(async (values) => {
            Object.assign(sessionState, cloneJson(values));
        })
    };
    chromeApi.storage.onChanged.addListener.mockImplementation((listener) => storageListeners.push(listener));
    chromeApi.downloads.search.mockImplementation(async ({ id }) => {
        const item = downloads.get(id);
        return item ? [cloneJson(item)] : [];
    });
    chromeApi.downloads.removeFile.mockImplementation((id, callback) => {
        const item = downloads.get(id);
        if (item) downloads.set(id, { ...item, exists: false });
        if (callback) callback();
    });
    chromeApi.downloads.erase.mockImplementation((query, callback) => {
        const erased = downloads.has(query.id) ? [query.id] : [];
        downloads.delete(query.id);
        if (callback) callback(erased);
        return Promise.resolve(erased);
    });

    return {
        chromeApi,
        downloads,
        storageState,
        async load() {
            jest.resetModules();
            global.chrome = chromeApi;
            const background = require('../../background.js');
            await Promise.resolve();
            return background;
        },
        getDownloadChangedListener() {
            return chromeApi.downloads.onChanged.addListener.mock.calls.at(-1)[0];
        },
        getAlarmListener() {
            return chromeApi.alarms.onAlarm.addListener.mock.calls.at(-1)[0];
        },
        getFilenameListener() {
            return chromeApi.downloads.onDeterminingFilename.addListener.mock.calls.at(-1)[0];
        },
        getRuntimeListener() {
            return chromeApi.runtime.onMessage.addListener.mock.calls.at(-1)[0];
        }
    };
}

async function waitForAssertion(assertion, attempts = 30) {
    let lastError;
    for (let attempt = 0; attempt < attempts; attempt++) {
        try {
            assertion();
            return;
        } catch (error) {
            lastError = error;
            await new Promise((resolve) => setTimeout(resolve, 0));
        }
    }
    throw lastError;
}

function dispatchRuntimeMessage(listener, request, sender = {}) {
    let returnValue;
    const response = new Promise((resolve) => {
        returnValue = listener(request, sender, resolve);
    });
    return { response, returnValue };
}

function mediaBlob(contentType = 'image/jpeg') {
    return new NodeBlob([new Uint8Array([1, 2, 3, 4])], { type: contentType });
}

function activeScrapeLease({
    epoch = 7,
    token = 'active-scrape-run',
    tabId = 42,
    kind = 'r2_backup'
} = {}) {
    return {
        version: 1,
        epoch,
        token,
        tabId,
        kind,
        status: 'active',
        startedAt: 1234
    };
}

function installR2PresentFetch(sourceUrl, { sourcePromise = null } = {}) {
    global.fetch = jest.fn(async (url) => {
        const value = String(url);
        if (value === sourceUrl) {
            if (sourcePromise) return sourcePromise;
            return {
                ok: true,
                headers: { get: () => 'image/jpeg' },
                blob: async () => mediaBlob()
            };
        }
        if (value.endsWith('/v1/objects/verify')) {
            return {
                ok: true,
                json: async () => ({ exists: true, verified: true })
            };
        }
        throw new Error(`Unexpected test fetch: ${value}`);
    });
}

describe('Grok backup background processed ID persistence', () => {
    afterEach(() => {
        delete global.chrome;
        delete global.fetch;
        jest.resetModules();
    });

    test('persists backup processed IDs only after R2-present statuses', () => {
        const { applyBackupProcessedIdPersistence } = loadBackgroundForTest();
        const processedIds = new Set();
        const saveHistory = jest.fn();

        expect(applyBackupProcessedIdPersistence(processedIds, 'media-1', 'queued', saveHistory)).toBe(false);
        expect(applyBackupProcessedIdPersistence(processedIds, 'media-2', 'error', saveHistory)).toBe(false);
        expect(processedIds.size).toBe(0);
        expect(saveHistory).not.toHaveBeenCalled();

        expect(applyBackupProcessedIdPersistence(processedIds, 'media-3', 'uploaded', saveHistory)).toBe(true);
        expect(applyBackupProcessedIdPersistence(processedIds, 'media-4', 'already_present', saveHistory)).toBe(true);
        expect(applyBackupProcessedIdPersistence(processedIds, 'media-5', 'conflict_uploaded', saveHistory)).toBe(true);

        expect(Array.from(processedIds)).toEqual(['media-3', 'media-4', 'media-5']);
        expect(saveHistory).toHaveBeenCalledTimes(3);
    });

    test('does not save history again for an already persisted backup ID', () => {
        const { applyBackupProcessedIdPersistence } = loadBackgroundForTest();
        const processedIds = new Set(['media-1']);
        const saveHistory = jest.fn();

        expect(applyBackupProcessedIdPersistence(processedIds, 'media-1', 'uploaded', saveHistory)).toBe(true);

        expect(processedIds).toEqual(new Set(['media-1']));
        expect(saveHistory).not.toHaveBeenCalled();
    });

    test('persists queued backup IDs only after queued upload proves R2 presence', () => {
        const { persistQueuedBackupProcessedId } = loadBackgroundForTest();
        const processedIds = new Set();
        const saveHistory = jest.fn();

        expect(persistQueuedBackupProcessedId({ backupProcessedId: 'media-1' }, { status: 'queued' }, processedIds, saveHistory)).toBe(false);
        expect(persistQueuedBackupProcessedId({ backupProcessedId: 'media-2' }, { status: 'error' }, processedIds, saveHistory)).toBe(false);
        expect(persistQueuedBackupProcessedId({ backupProcessedId: 'media-3' }, { status: 'not_queued' }, processedIds, saveHistory)).toBe(false);
        expect(persistQueuedBackupProcessedId({}, { status: 'uploaded' }, processedIds, saveHistory)).toBe(false);
        expect(processedIds.size).toBe(0);
        expect(saveHistory).not.toHaveBeenCalled();

        expect(persistQueuedBackupProcessedId({ backupProcessedId: 'media-4' }, { status: 'uploaded' }, processedIds, saveHistory)).toBe(true);
        expect(persistQueuedBackupProcessedId({ backupProcessedId: 'media-5' }, { status: 'already_present' }, processedIds, saveHistory)).toBe(true);
        expect(persistQueuedBackupProcessedId({ backupProcessedId: 'media-6' }, { status: 'conflict_uploaded' }, processedIds, saveHistory)).toBe(true);

        expect(Array.from(processedIds)).toEqual(['media-4', 'media-5', 'media-6']);
        expect(saveHistory).toHaveBeenCalledTimes(3);
    });

    test('builds direct upload responses with parsed backup processed ID', () => {
        const {
            buildDirectBackupUploadResponse,
            extractGrokMediaIdFallback,
            getCloudSyncForTest,
            parseFilenameInfo
        } = loadBackgroundForTest();
        const result = {
            status: 'uploaded',
            objectKey: 'grok/users/user-1/media.mp4',
            assetId: 'asset-1'
        };
        const accountId = '11111111-1111-4111-8111-111111111111';
        const mediaId = '22222222-2222-4222-8222-222222222222';
        const queryId = '33333333-3333-4333-8333-333333333333';
        const hashId = '44444444-4444-4444-8444-444444444444';
        const sourceUrl = `https://assets.grok.com/users/${accountId}/generated/${mediaId}/generated_video.mp4?request=${queryId}#${hashId}`;

        expect(buildDirectBackupUploadResponse(result, sourceUrl)).toEqual({
            status: 'uploaded',
            objectKey: 'grok/users/user-1/media.mp4',
            assetId: 'asset-1',
            backupProcessedId: mediaId
        });
        expect(parseFilenameInfo(sourceUrl).uuid).toBe(mediaId);
        expect(getCloudSyncForTest().extractGrokMediaId(sourceUrl))
            .toBe(CloudSyncUtils.extractGrokMediaId(sourceUrl));
        expect(extractGrokMediaIdFallback(sourceUrl))
            .toBe(CloudSyncUtils.extractGrokMediaId(sourceUrl));
    });

    test('awaits queued backup persistence while preserving latest storage and background IDs', async () => {
        const {
            getProcessedUUIDsForTest,
            persistQueuedBackupProcessedIdAfterSuccess,
            setProcessedUUIDsForTest
        } = loadBackgroundForTest();
        chrome.storage.local.get.mockResolvedValue({
            processedIds: ['direct-clean-id', 'background-queued-id']
        });
        chrome.storage.local.set.mockResolvedValue();
        setProcessedUUIDsForTest(['background-queued-id']);

        await expect(persistQueuedBackupProcessedIdAfterSuccess(
            { backupProcessedId: 'queued-media-id' },
            { status: 'uploaded' }
        )).resolves.toBe(true);

        expect(chrome.storage.local.get).toHaveBeenCalledWith(['processedIds']);
        expect(chrome.storage.local.set).toHaveBeenCalledWith({
            processedIds: ['direct-clean-id', 'background-queued-id', 'queued-media-id']
        });
        expect(getProcessedUUIDsForTest()).toEqual(['direct-clean-id', 'background-queued-id', 'queued-media-id']);
    });

    test('does not persist queued backup IDs before R2-present status', async () => {
        const { persistQueuedBackupProcessedIdAfterSuccess, setProcessedUUIDsForTest } = loadBackgroundForTest();
        setProcessedUUIDsForTest(['background-queued-id']);

        await expect(persistQueuedBackupProcessedIdAfterSuccess(
            { backupProcessedId: 'queued-media-id' },
            { status: 'queued' }
        )).resolves.toBe(false);

        await expect(persistQueuedBackupProcessedIdAfterSuccess(
            {},
            { status: 'uploaded' }
        )).resolves.toBe(false);

        expect(chrome.storage.local.get).not.toHaveBeenCalledWith(['processedIds']);
        expect(chrome.storage.local.set).not.toHaveBeenCalledWith(expect.objectContaining({
            processedIds: expect.any(Array)
        }));
    });

    test('keeps a failed queued upload unprocessed until a later R2-present result', async () => {
        const mediaId = '22222222-2222-4222-8222-222222222222';
        const sourceUrl = `https://assets.grok.com/users/11111111-1111-4111-8111-111111111111/generated/${mediaId}/image.jpg`;
        const background = loadBackgroundForTest();
        chrome.storage.local.get.mockImplementation(async (keys) => {
            if (Array.isArray(keys) && keys.includes('cloudConfig')) {
                return {
                    cloudConfig: {
                        mode: 'cloud_only',
                        workerUrl: 'https://example-worker.workers.dev',
                        apiKey: 'test-only-value'
                    }
                };
            }
            if (Array.isArray(keys) && keys.includes('processedIds')) return { processedIds: [] };
            return {};
        });
        background.setProcessedUUIDsForTest([]);

        await expect(background.enqueueCloudMediaUpload(
            sourceUrl,
            `GrokVault/u/2026-08-12_Auto/${mediaId}.jpg`,
            '',
            null,
            {
                uploadMediaQueueItem: jest.fn().mockRejectedValue(new Error(
                    `[media-fetch] key=test/v1/private/${mediaId}.jpg source=${sourceUrl} prompt=private words`
                ))
            }
        )).resolves.toBe(true);

        expect(background.getProcessedUUIDsForTest()).toEqual([]);
        expect(background.getCloudSyncQueueForTest()).toHaveLength(1);
        expect(background.getCloudSyncQueueForTest()[0].backupProcessedId).toBe(mediaId);
        expect(background.getCloudSyncQueueForTest()[0].lastError)
            .toMatch(/stage=media-fetch code=queue_upload_failed media=\.\.\.[a-f0-9]{8}/);
        expect(background.getCloudSyncQueueForTest()[0].lastError).not.toContain(mediaId);
        expect(background.getCloudSyncQueueForTest()[0].lastError).not.toContain(sourceUrl);
        expect(background.getCloudSyncQueueForTest()[0].lastError).not.toContain('private words');
        expect(chrome.storage.local.set).not.toHaveBeenCalledWith(expect.objectContaining({
            processedIds: expect.any(Array)
        }));

        await background.processCloudQueue('test-success', {
            force: true,
            uploadMediaQueueItem: jest.fn().mockResolvedValue({ status: 'uploaded', bytes: 123 })
        });

        expect(background.getProcessedUUIDsForTest()).toEqual([mediaId]);
        expect(background.getCloudSyncQueueForTest()).toEqual([]);
        expect(chrome.storage.local.set).toHaveBeenCalledWith({ processedIds: [mediaId] });
    });

    test('drops a replayed successful cleanup queue item after its operation already finalized', async () => {
        const mediaId = '22222222-2222-4222-8222-222222222222';
        const background = loadBackgroundForTest();
        chrome.storage.local.get.mockImplementation(async (keys) => {
            if (Array.isArray(keys) && keys.includes('cloudConfig')) {
                return {
                    cloudConfig: {
                        mode: 'cloud_only',
                        workerUrl: 'https://example-worker.workers.dev',
                        apiKey: 'test-only-value'
                    }
                };
            }
            if (Array.isArray(keys) && keys.includes('pendingDownloadOperations')) {
                return { pendingDownloadOperations: {}, processedIds: [mediaId] };
            }
            return {};
        });
        await new Promise((resolve) => setTimeout(resolve, 0));
        background.setCloudSyncQueueForTest([{
            id: 'cleanup-replay',
            type: 'media',
            backupProcessedId: mediaId,
            cleanupDownloadId: 93,
            attempts: 0
        }]);
        const uploadMediaQueueItem = jest.fn().mockResolvedValue({ status: 'already_present', bytes: 123 });

        await background.processCloudQueue('cleanup-replay', {
            force: true,
            uploadMediaQueueItem
        });

        expect(uploadMediaQueueItem).toHaveBeenCalledTimes(1);
        expect(background.getCloudSyncQueueForTest()).toEqual([]);
        expect(chrome.storage.local.set).not.toHaveBeenCalledWith(expect.objectContaining({
            processedIds: expect.any(Array)
        }));
    });

    test('clears a legacy raw cloud status error when no queue item can sanitize it', async () => {
        const mediaId = '22222222-2222-4222-8222-222222222222';
        const signedUrl = `https://imagine-public.x.ai/media/${mediaId}.jpg?token=private-token`;
        const harness = createDurableBackgroundHarness({
            cloudSyncQueue: [],
            cloudSyncState: {
                lastError: `source=${signedUrl} key=test/v1/private/${mediaId}.jpg prompt=private words`,
                processing: false,
                unsyncedCount: 0
            }
        });
        const background = await harness.load();

        await background.initializeBackgroundState();

        expect(harness.storageState.cloudSyncState.lastError).toBeNull();
        expect(JSON.stringify(harness.storageState.cloudSyncState)).not.toContain(signedUrl);
        expect(JSON.stringify(harness.storageState.cloudSyncState)).not.toContain(mediaId);
        expect(JSON.stringify(harness.storageState.cloudSyncState)).not.toContain('private words');
    });

    test('builds full backup init options by default', () => {
        const { buildR2BackupInitMessage } = loadBackgroundForTest();

        expect(buildR2BackupInitMessage({ action: 'START_R2_BACKUP' })).toEqual({
            action: 'INIT_R2_BACKUP',
            mode: 'full',
            limit: null,
            options: {}
        });
    });

    test('carries requested canary mode, limit, and options to content init', () => {
        const { buildR2BackupInitMessage } = loadBackgroundForTest();

        expect(buildR2BackupInitMessage({
            action: 'START_R2_BACKUP',
            mode: 'canary',
            limit: 1,
            options: { stopAfterMediaAttempt: true }
        })).toEqual({
            action: 'INIT_R2_BACKUP',
            mode: 'canary',
            limit: 1,
            options: { stopAfterMediaAttempt: true }
        });
    });

    test('preserves acceptance metadata in R2 backup init messages', () => {
        const { buildR2BackupInitMessage } = loadBackgroundForTest();

        expect(buildR2BackupInitMessage({
            action: 'START_R2_BACKUP',
            mode: 'canary',
            limit: 1,
            options: { stopAfterMediaAttempt: true },
            acceptance: {
                runId: 'run-20260609-001',
                correlationId: 'corr-1',
                keyPrefix: 'acceptance/run-20260609-001'
            }
        })).toEqual({
            action: 'INIT_R2_BACKUP',
            mode: 'canary',
            limit: 1,
            options: { stopAfterMediaAttempt: true },
            acceptance: {
                runId: 'run-20260609-001',
                correlationId: 'corr-1',
                keyPrefix: 'acceptance/run-20260609-001'
            }
        });
    });

    test('derives acceptance metadata for popup canaries from acceptance config', () => {
        const {
            buildAcceptanceContextFromCloudConfig,
            buildR2BackupInitMessageForConfig
        } = loadBackgroundForTest();
        const config = { keyPrefix: 'acceptance/run-20260609-001' };

        expect(buildAcceptanceContextFromCloudConfig({ keyPrefix: 'grok-powertools/v1' })).toBeNull();

        const initMessage = buildR2BackupInitMessageForConfig({
            action: 'START_R2_BACKUP',
            mode: 'canary',
            limit: 1,
            options: { stopAfterMediaAttempt: true }
        }, config);

        expect(initMessage.acceptance).toMatchObject({
            runId: 'run-20260609-001',
            keyPrefix: 'acceptance/run-20260609-001'
        });
        expect(initMessage.acceptance.correlationId).toMatch(/^popup-canary-\d+-[0-9a-f]+$/);
        expect(buildR2BackupInitMessageForConfig({
            action: 'START_R2_BACKUP',
            mode: 'full'
        }, config)).not.toHaveProperty('acceptance');
    });

    test('treats canary completion as a successful R2 backup completion', () => {
        const {
            getR2BackupCompletionStatusLabel,
            isR2BackupCompletionSuccessful
        } = loadBackgroundForTest();
        const completeCanary = {
            stopReason: 'canary_complete',
            pendingTransfers: 0,
            errors: 0
        };

        expect(isR2BackupCompletionSuccessful(completeCanary)).toBe(true);
        expect(getR2BackupCompletionStatusLabel(completeCanary)).toBe('canary complete');
        expect(isR2BackupCompletionSuccessful({ stopReason: 'canary_complete', errors: 0 })).toBe(false);
        expect(isR2BackupCompletionSuccessful({ stopReason: 'canary_incomplete' })).toBe(false);
    });

    test('adds acceptance headers to presign requests', async () => {
        const { requestPresignedUrl } = loadBackgroundForTest();
        global.fetch = jest.fn(() => Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ uploadUrl: 'https://upload.example', method: 'PUT', headers: {} })
        }));

        await requestPresignedUrl({
            workerUrl: 'https://worker.example',
            apiKey: 'api-sample'
        }, {
            objectKey: 'acceptance/run-20260609-001/users/u/media/by-asset/media_1.png',
            contentType: 'image/png',
            acceptance: {
                runId: 'run-20260609-001',
                correlationId: 'corr-1',
                keyPrefix: 'acceptance/run-20260609-001'
            }
        }, 123);

        expect(global.fetch).toHaveBeenCalledWith('https://worker.example/v1/presign', expect.objectContaining({
            method: 'POST',
            headers: expect.objectContaining({
                'x-acceptance-run-id': 'run-20260609-001',
                'x-acceptance-correlation-id': 'corr-1'
            })
        }));
    });

    test('adds acceptance headers to verify and metadata snapshot requests', async () => {
        const { uploadMetadataQueueItem, verifyR2Object } = loadBackgroundForTest();
        global.fetch = jest.fn(() => Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ ok: true })
        }));
        const acceptance = {
            runId: 'run-20260609-001',
            correlationId: 'corr-1',
            keyPrefix: 'acceptance/run-20260609-001'
        };
        const config = {
            workerUrl: 'https://worker.example',
            apiKey: 'api-sample'
        };

        await verifyR2Object(config, {
            objectKey: 'acceptance/run-20260609-001/users/u/media/by-asset/media_1.png',
            assetId: 'media_1',
            sourceUrlHash: 'url_1',
            acceptance
        }, { sizeBytes: 123 });
        await uploadMetadataQueueItem(config, {
            kind: 'savedPrompts',
            userId: 'u',
            payload: { schemaVersion: 1, data: [] },
            acceptance
        });

        const verifyCall = global.fetch.mock.calls[0];
        const metadataCall = global.fetch.mock.calls[1];

        expect(verifyCall[0]).toBe('https://worker.example/v1/objects/verify');
        expect(verifyCall[1].headers).toMatchObject({
            'x-acceptance-run-id': 'run-20260609-001',
            'x-acceptance-correlation-id': 'corr-1'
        });
        expect(metadataCall[0]).toBe('https://worker.example/v1/metadata/snapshot');
        expect(metadataCall[1].headers).toMatchObject({
            'x-acceptance-run-id': 'run-20260609-001',
            'x-acceptance-correlation-id': 'corr-1'
        });
    });

    test('adds derived acceptance headers to cloud test presign and verify requests', async () => {
        const { testCloudConnection } = loadBackgroundForTest();
        const OriginalBlob = global.Blob;
        const originalCrypto = global.crypto;
        Object.defineProperty(global, 'crypto', {
            configurable: true,
            value: require('crypto').webcrypto
        });
        global.Blob = class TestBlob {
            constructor(parts = [], options = {}) {
                this.parts = parts;
                this.type = options.type || '';
                this.size = Buffer.byteLength(parts.map((part) => String(part)).join(''));
            }
            async arrayBuffer() {
                const buffer = Buffer.from(this.parts.map((part) => String(part)).join(''));
                return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
            }
        };
        const calls = [];
        global.fetch = jest.fn((url, options = {}) => {
            calls.push({ url, options });
            if (String(url).endsWith('/health')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ ok: true, service: 'test-worker', now: '2026-06-09T00:00:00.000Z' })
                });
            }
            if (String(url).endsWith('/v1/presign')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ uploadUrl: 'https://upload.example/test', method: 'PUT', headers: {} })
                });
            }
            if (String(url) === 'https://upload.example/test') {
                return Promise.resolve({ ok: true });
            }
            if (String(url).endsWith('/v1/objects/verify')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ ok: true, exists: true, verified: true })
                });
            }
            throw new Error(`unexpected fetch ${url}`);
        });

        try {
            const result = await testCloudConnection({
                mode: 'cloud_only',
                workerUrl: 'https://worker.example.workers.dev',
                apiKey: 'api-sample',
                keyPrefix: 'acceptance/run-20260609-001'
            });

            expect(result.ok).toBe(true);
            const presign = calls.find((call) => String(call.url).endsWith('/v1/presign'));
            const verify = calls.find((call) => String(call.url).endsWith('/v1/objects/verify'));
            expect(presign.options.headers).toMatchObject({
                'x-acceptance-run-id': 'run-20260609-001',
                'x-acceptance-correlation-id': expect.stringMatching(/^cloud-test-\d+-[0-9a-f]+$/)
            });
            expect(verify.options.headers).toMatchObject({
                'x-acceptance-run-id': 'run-20260609-001',
                'x-acceptance-correlation-id': expect.stringMatching(/^cloud-test-\d+-[0-9a-f]+$/)
            });
        } finally {
            global.Blob = OriginalBlob;
            Object.defineProperty(global, 'crypto', {
                configurable: true,
                value: originalCrypto
            });
        }
    });
});

describe('background-owned processed ID mutations', () => {
    afterEach(() => {
        delete global.chrome;
        jest.resetModules();
    });

    test('serializes overlapping add messages and preserves their union', async () => {
        const harness = createDurableBackgroundHarness({ processedIds: [] });
        await harness.load();
        const listener = harness.getRuntimeListener();
        let releaseFirstRead;
        let processedReadCount = 0;
        const defaultGet = harness.chromeApi.storage.local.get.getMockImplementation();
        harness.chromeApi.storage.local.get.mockImplementation((keys) => {
            if (Array.isArray(keys) && keys.length === 1 && keys[0] === 'processedIds') {
                processedReadCount += 1;
                if (processedReadCount === 1) {
                    return new Promise((resolve) => { releaseFirstRead = () => resolve({ processedIds: [] }); });
                }
            }
            return defaultGet(keys);
        });

        const first = dispatchRuntimeMessage(listener, { action: 'PROCESSED_IDS_ADD', ids: ['media-a'] });
        const second = dispatchRuntimeMessage(listener, { action: 'PROCESSED_IDS_ADD', ids: ['media-b'] });

        expect(first.returnValue).toBe(true);
        expect(second.returnValue).toBe(true);
        await waitForAssertion(() => expect(processedReadCount).toBe(1));
        releaseFirstRead();
        await Promise.all([first.response, second.response]);

        expect(harness.storageState.processedIds).toEqual(['media-a', 'media-b']);
    });

    test('orders reset after a pending add and leaves storage empty', async () => {
        const harness = createDurableBackgroundHarness({ processedIds: [] });
        await harness.load();
        const listener = harness.getRuntimeListener();
        let releaseFirstRead;
        const defaultGet = harness.chromeApi.storage.local.get.getMockImplementation();
        harness.chromeApi.storage.local.get.mockImplementation((keys) => {
            if (!releaseFirstRead && Array.isArray(keys) && keys.length === 1 && keys[0] === 'processedIds') {
                return new Promise((resolve) => { releaseFirstRead = () => resolve({ processedIds: [] }); });
            }
            return defaultGet(keys);
        });

        const add = dispatchRuntimeMessage(listener, { action: 'PROCESSED_IDS_ADD', ids: ['media-a'] });
        const reset = dispatchRuntimeMessage(listener, { action: 'PROCESSED_IDS_RESET' });
        await waitForAssertion(() => expect(releaseFirstRead).toEqual(expect.any(Function)));
        releaseFirstRead();
        await Promise.all([add.response, reset.response]);

        expect(harness.storageState.processedIds).toEqual([]);
    });

    test('orders add after reset and keeps only the new identity', async () => {
        const harness = createDurableBackgroundHarness({ processedIds: ['old-media'] });
        await harness.load();
        const listener = harness.getRuntimeListener();

        const reset = dispatchRuntimeMessage(listener, { action: 'PROCESSED_IDS_RESET' });
        const add = dispatchRuntimeMessage(listener, { action: 'PROCESSED_IDS_ADD', ids: ['new-media'] });
        await Promise.all([reset.response, add.response]);

        expect(harness.storageState.processedIds).toEqual(['new-media']);
    });

    test('refreshes the background cache on external processedIds changes without rewriting storage', async () => {
        const harness = createDurableBackgroundHarness({ processedIds: ['old-media'] });
        const background = await harness.load();
        harness.chromeApi.storage.local.set.mockClear();
        const storageListener = harness.chromeApi.storage.onChanged.addListener.mock.calls.at(-1)[0];

        storageListener({ processedIds: { oldValue: ['old-media'], newValue: ['external-media'] } }, 'local');

        expect(background.getProcessedUUIDsForTest()).toEqual(['external-media']);
        expect(harness.chromeApi.storage.local.set).not.toHaveBeenCalled();
    });
});

describe('content processed ID mutation messages', () => {
    beforeEach(() => {
        global.chrome = {
            runtime: {
                getURL: jest.fn((value) => value),
                onMessage: { addListener: jest.fn() },
                sendMessage: jest.fn(() => Promise.resolve())
            },
            storage: {
                local: {
                    get: jest.fn(() => Promise.resolve({})),
                    set: jest.fn(() => Promise.resolve())
                },
                sync: {
                    get: jest.fn(() => Promise.resolve({})),
                    set: jest.fn(() => Promise.resolve())
                },
                onChanged: { addListener: jest.fn() }
            }
        };
    });

    afterEach(() => {
        delete global.chrome;
    });

    test('routes settings imports through the background writer', async () => {
        chrome.runtime.sendMessage.mockResolvedValue({ status: 'ok', processedIds: ['imported-media'] });
        const manager = new SettingsManager();

        expect(manager.import(JSON.stringify({ processedIds: ['imported-media'] }))).toBe(true);
        await waitForAssertion(() => expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
            action: 'PROCESSED_IDS_ADD',
            ids: ['imported-media']
        }));

        expect(chrome.storage.local.set).not.toHaveBeenCalledWith(expect.objectContaining({
            processedIds: expect.any(Array)
        }));
    });

    test('checks the active run token before and after a scrape add response', async () => {
        let resolveMutation;
        chrome.runtime.sendMessage.mockImplementation((message) => {
            if (message.action === 'SCRAPE_PROCESSED_IDS_ADD') {
                return new Promise((resolve) => { resolveMutation = resolve; });
            }
            return Promise.resolve();
        });
        const scraper = Object.create(GrokScraper.prototype);
        scraper.state = { isRunning: true };
        scraper.runToken = 'run-1';
        scraper.runEpoch = 1;
        scraper.processedIds = new Set();
        scraper.handleExtensionContextInvalidated = jest.fn();

        const persistence = scraper.persistProcessedId('media-a', 'run-1');
        await waitForAssertion(() => expect(resolveMutation).toEqual(expect.any(Function)));
        scraper.runToken = 'run-2';
        resolveMutation({ status: 'ok', processedIds: ['media-a'] });

        await expect(persistence).resolves.toBe(false);
        expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
            action: 'SCRAPE_PROCESSED_IDS_ADD',
            ids: ['media-a'],
            runToken: 'run-1',
            runEpoch: 1,
            kind: 'sync'
        });
        expect(scraper.processedIds).toEqual(new Set());
    });
});

describe('native download processed ID lifecycle', () => {
    const accountId = '11111111-1111-4111-8111-111111111111';
    const mediaId = '22222222-2222-4222-8222-222222222222';
    const queryId = '33333333-3333-4333-8333-333333333333';
    const mediaUrl = `https://assets.grok.com/users/${accountId}/generated/${mediaId}/image.jpg?request=${queryId}`;

    afterEach(() => {
        delete global.chrome;
        delete global.fetch;
        jest.resetModules();
    });

    test('registered filename listener returns literal true and defers exactly one suggestion', async () => {
        const harness = createDurableBackgroundHarness({
            processedIds: [],
            downloadPath: 'GrokVault',
            activeGrokUserId: 'user-1',
            cloudConfig: { mode: 'local_only' }
        });
        await harness.load();
        const listener = harness.getFilenameListener();
        const suggest = jest.fn(() => {
            expect(harness.storageState.pendingDownloadOperations['41']).toBeDefined();
        });

        const returnValue = listener({ id: 41, url: mediaUrl, filename: 'image.jpg' }, suggest);

        expect(returnValue).toBe(true);
        expect(suggest).not.toHaveBeenCalled();
        await waitForAssertion(() => expect(suggest).toHaveBeenCalledTimes(1));
        expect(suggest).toHaveBeenCalledWith(expect.objectContaining({ conflictAction: 'overwrite' }));
        expect(harness.storageState.pendingDownloadOperations['41']).toEqual(expect.objectContaining({
            downloadId: 41,
            mediaId,
            finalPath: expect.stringContaining(mediaId),
            allowLocal: true,
            cloudRequired: false,
            strategy: 'local',
            downloadState: 'in_progress',
            r2State: 'not_required'
        }));
        expect(harness.storageState.pendingDownloadOperations['41']).not.toHaveProperty('url');
        expect(harness.storageState.pendingDownloadOperations['41']).not.toHaveProperty('sourceUrl');
        expect(JSON.stringify(harness.storageState.pendingDownloadOperations['41'])).not.toContain('?request=');
        expect(harness.storageState.processedIds).toEqual([]);
    });

    test.each([
        ['Grok media', mediaUrl],
        ['non-Grok media', 'https://example.com/file.jpg']
    ])('leaves unrelated %s downloads untouched during an active scrape', async (_label, url) => {
        const lease = activeScrapeLease({ kind: 'sync' });
        const harness = createDurableBackgroundHarness({
            processedIds: [],
            downloadPath: 'GrokVault',
            activeGrokUserId: 'user-1',
            cloudConfig: { mode: 'local_only' },
            scraperState: 'running',
            scrapeRunToken: lease.token,
            scrapeRunEpoch: lease.epoch,
            isScraping: true,
            isR2Backup: false
        }, {}, { activeScrapeRunToken: lease });
        const background = await harness.load();
        await background.ensureBackgroundStateReady();
        const suggest = jest.fn();

        expect(harness.getFilenameListener()({ id: 70, url, filename: 'file.jpg' }, suggest)).toBe(true);
        await waitForAssertion(() => expect(suggest).toHaveBeenCalledTimes(1));

        expect(suggest).toHaveBeenCalledWith();
        expect(harness.chromeApi.downloads.cancel).not.toHaveBeenCalled();
        expect(harness.storageState.pendingDownloadOperations || {}).toEqual({});
        expect(harness.storageState.cloudSyncQueue || []).toEqual([]);
        expect(harness.storageState.processedIds).toEqual([]);
    });

    test('accepts an active scrape download with a claimed pending receipt', async () => {
        const lease = activeScrapeLease({ kind: 'sync' });
        const harness = createDurableBackgroundHarness({
            processedIds: [],
            downloadPath: 'GrokVault',
            activeGrokUserId: 'user-1',
            cloudConfig: { mode: 'local_only' },
            scraperState: 'running',
            scrapeRunToken: lease.token,
            scrapeRunEpoch: lease.epoch,
            isScraping: true,
            isR2Backup: false
        }, {}, { activeScrapeRunToken: lease });
        harness.chromeApi.downloads.download.mockResolvedValue(71);
        const background = await harness.load();
        await background.ensureBackgroundStateReady();
        await background.ensureScrapeLeaseHydrated();
        await expect(background.queueChromeDownload({
            url: mediaUrl,
            filename: 'GrokVault/claimed.jpg',
            conflictAction: 'overwrite'
        }, lease)).resolves.toBe(71);
        const suggest = jest.fn();

        expect(harness.getFilenameListener()({ id: 71, url: mediaUrl, filename: 'image.jpg' }, suggest)).toBe(true);
        await waitForAssertion(() => expect(suggest).toHaveBeenCalledTimes(1));

        expect(suggest).toHaveBeenCalledWith(expect.objectContaining({ conflictAction: 'overwrite' }));
        expect(harness.chromeApi.downloads.cancel).not.toHaveBeenCalled();
        expect(harness.storageState.pendingDownloadOperations['71']).toEqual(expect.objectContaining({
            downloadId: 71,
            mediaId,
            scrapeLease: expect.objectContaining({ token: lease.token, epoch: lease.epoch })
        }));
    });

    test('reuses a persisted active-run operation when its receipt was lost on restart', async () => {
        const lease = activeScrapeLease({ kind: 'sync' });
        const finalPath = `GrokVault/user-1/2026-08-12_Auto/${mediaId}.jpg`;
        const operation = {
            downloadId: 72,
            mediaId,
            reservationKey: mediaId,
            finalPath,
            allowLocal: true,
            cloudRequired: false,
            strategy: 'local',
            downloadState: 'in_progress',
            r2State: 'not_required',
            localIdentityPersisted: false,
            scrapeLease: lease
        };
        const harness = createDurableBackgroundHarness({
            processedIds: [],
            downloadPath: 'GrokVault',
            activeGrokUserId: 'user-1',
            cloudConfig: { mode: 'local_only' },
            pendingDownloadOperations: { 72: operation },
            scraperState: 'running',
            scrapeRunToken: lease.token,
            scrapeRunEpoch: lease.epoch,
            isScraping: true,
            isR2Backup: false
        }, {
            72: { id: 72, url: mediaUrl, filename: finalPath, state: 'in_progress' }
        }, { activeScrapeRunToken: lease });
        const background = await harness.load();
        await background.ensureBackgroundStateReady();
        const suggest = jest.fn();

        expect(harness.getFilenameListener()({ id: 72, url: mediaUrl, filename: 'image.jpg' }, suggest)).toBe(true);
        await waitForAssertion(() => expect(suggest).toHaveBeenCalledTimes(1));

        expect(suggest).toHaveBeenCalledWith({ filename: finalPath, conflictAction: 'overwrite' });
        expect(harness.chromeApi.downloads.cancel).not.toHaveBeenCalled();
        expect(harness.storageState.pendingDownloadOperations['72']).toEqual(expect.objectContaining({
            downloadId: 72,
            finalPath,
            scrapeLease: expect.objectContaining({ token: lease.token, epoch: lease.epoch })
        }));
    });

    test('calls suggest exactly once for duplicate, ignored, and error branches', async () => {
        const harness = createDurableBackgroundHarness({
            processedIds: [mediaId],
            downloadPath: 'GrokVault',
            activeGrokUserId: 'user-1',
            cloudConfig: { mode: 'local_only' }
        });
        const background = await harness.load();
        await background.initializeBackgroundState();
        const listener = harness.getFilenameListener();
        const duplicateSuggest = jest.fn();
        const ignoredSuggest = jest.fn();
        const errorSuggest = jest.fn();

        expect(listener({ id: 42, url: mediaUrl, filename: 'image.jpg' }, duplicateSuggest)).toBe(true);
        expect(listener({ id: 43, url: 'https://example.com/file.jpg', filename: 'file.jpg' }, ignoredSuggest)).toBe(true);
        expect(duplicateSuggest).not.toHaveBeenCalled();
        expect(ignoredSuggest).not.toHaveBeenCalled();
        await waitForAssertion(() => expect(duplicateSuggest).toHaveBeenCalledTimes(1));
        await waitForAssertion(() => expect(ignoredSuggest).toHaveBeenCalledTimes(1));

        const defaultGet = harness.chromeApi.storage.local.get.getMockImplementation();
        harness.chromeApi.storage.local.get.mockImplementation((keys) => {
            if (Array.isArray(keys) && keys.includes('downloadPath')) return Promise.reject(new Error('storage unavailable'));
            return defaultGet(keys);
        });
        expect(listener({ id: 44, url: mediaUrl.replace(mediaId, '55555555-5555-4555-8555-555555555555'), filename: 'image.jpg' }, errorSuggest)).toBe(true);
        expect(errorSuggest).not.toHaveBeenCalled();
        await waitForAssertion(() => expect(errorSuggest).toHaveBeenCalledTimes(1));

        expect(harness.chromeApi.downloads.cancel).toHaveBeenCalledWith(42);
        expect(harness.chromeApi.downloads.cancel).toHaveBeenCalledWith(44);
        expect(duplicateSuggest).toHaveBeenCalledWith();
        expect(ignoredSuggest).toHaveBeenCalledWith();
        expect(errorSuggest).toHaveBeenCalledWith();
    });

    test('keeps a concurrent duplicate reserved across service-worker restart', async () => {
        const harness = createDurableBackgroundHarness({
            processedIds: [],
            downloadPath: 'GrokVault',
            activeGrokUserId: 'user-1',
            cloudConfig: { mode: 'local_only' }
        });
        await harness.load();
        const firstSuggest = jest.fn();
        const secondSuggest = jest.fn();

        expect(harness.getFilenameListener()({ id: 45, url: mediaUrl, filename: 'image.jpg' }, firstSuggest)).toBe(true);
        await waitForAssertion(() => expect(firstSuggest).toHaveBeenCalledTimes(1));
        harness.downloads.set(45, { id: 45, url: mediaUrl, filename: '/Downloads/first.jpg', state: 'in_progress' });

        const restarted = await harness.load();
        await restarted.initializeBackgroundState();
        expect(harness.getFilenameListener()({ id: 46, url: mediaUrl, filename: 'image.jpg' }, secondSuggest)).toBe(true);
        await waitForAssertion(() => expect(secondSuggest).toHaveBeenCalledTimes(1));

        expect(firstSuggest).toHaveBeenCalledTimes(1);
        expect(harness.chromeApi.downloads.cancel).toHaveBeenCalledWith(46);
        expect(harness.chromeApi.downloads.cancel).not.toHaveBeenCalledWith(45);
        expect(harness.storageState.processedIds).toEqual([]);
    });

    test('recovers local completion after service-worker restart', async () => {
        const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
        const harness = createDurableBackgroundHarness({
            processedIds: [],
            downloadPath: 'GrokVault',
            activeGrokUserId: 'user-1',
            cloudConfig: { mode: 'local_only' }
        });
        await harness.load();
        const queryOnlyUrl = `https://assets.grok.com/generated/image.jpg?request=${queryId}`;
        const stableSuggest = jest.fn();
        const queryOnlySuggest = jest.fn();

        expect(harness.getFilenameListener()({ id: 47, url: mediaUrl, filename: 'image.jpg' }, stableSuggest)).toBe(true);
        await waitForAssertion(() => expect(stableSuggest).toHaveBeenCalledTimes(1));
        harness.downloads.set(47, {
            id: 47,
            url: mediaUrl,
            filename: '/Downloads/stable.jpg',
            mime: 'image/jpeg',
            state: 'complete'
        });

        await harness.load();
        await Promise.resolve(harness.getDownloadChangedListener()({ id: 47, state: { current: 'complete' } }));
        await waitForAssertion(() => expect(harness.storageState.processedIds).toEqual([mediaId]));
        expect(harness.storageState.pendingDownloadOperations).toEqual({});

        expect(harness.getFilenameListener()({ id: 48, url: queryOnlyUrl, filename: 'image.jpg' }, queryOnlySuggest)).toBe(true);
        await waitForAssertion(() => expect(queryOnlySuggest).toHaveBeenCalledTimes(1));
        harness.downloads.set(48, {
            id: 48,
            url: queryOnlyUrl,
            filename: '/Downloads/query-only.jpg',
            state: 'complete'
        });
        await Promise.resolve(harness.getDownloadChangedListener()({ id: 48, state: { current: 'complete' } }));
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(harness.storageState.processedIds).toEqual([mediaId]);
        expect(queryOnlySuggest.mock.calls[0][0].filename).toMatch(/\/url_[a-f0-9]{8}\.jpg$/);
        expect(queryOnlySuggest.mock.calls[0][0].filename).not.toContain(queryId);
        expect(errorSpy).not.toHaveBeenCalledWith('Background initialization failed:', expect.anything());
        errorSpy.mockRestore();
    });

    test('releases an interrupted durable operation without persisting its identity', async () => {
        const harness = createDurableBackgroundHarness({
            processedIds: [],
            downloadPath: 'GrokVault',
            activeGrokUserId: 'user-1',
            cloudConfig: { mode: 'local_only' }
        });
        await harness.load();
        const suggest = jest.fn();

        expect(harness.getFilenameListener()({ id: 49, url: mediaUrl, filename: 'image.jpg' }, suggest)).toBe(true);
        await waitForAssertion(() => expect(suggest).toHaveBeenCalledTimes(1));
        await Promise.resolve(harness.getDownloadChangedListener()({
            id: 49,
            state: { current: 'interrupted' },
            error: { current: 'USER_CANCELED' }
        }));

        await waitForAssertion(() => expect(harness.storageState.pendingDownloadOperations).toEqual({}));
        expect(harness.storageState.processedIds).toEqual([]);
    });

    test('releases an in-progress reservation when download history is absent after restart', async () => {
        const harness = createDurableBackgroundHarness({
            processedIds: [],
            cloudConfig: { mode: 'local_only' },
            pendingDownloadOperations: {
                50: {
                    downloadId: 50,
                    mediaId,
                    reservationKey: mediaId,
                    finalPath: `GrokVault/user-1/2026-08-12_Auto/${mediaId}.jpg`,
                    allowLocal: true,
                    cloudRequired: false,
                    strategy: 'local',
                    downloadState: 'in_progress',
                    r2State: 'not_required',
                    localIdentityPersisted: false
                }
            }
        });
        const background = await harness.load();

        await background.ensureBackgroundStateReady();

        expect(harness.storageState.pendingDownloadOperations).toEqual({});
        expect(harness.storageState.processedIds).toEqual([]);
    });
});

describe('cloud-only download proof and cleanup ordering', () => {
    const mediaId = '22222222-2222-4222-8222-222222222222';
    const publicUrl = `https://imagine-public.x.ai/media/${mediaId}.jpg?token=private-query-value`;
    const authUrl = `https://assets.grok.com/users/11111111-1111-4111-8111-111111111111/generated/${mediaId}/image.jpg?token=private-query-value`;
    let originalBlob;
    let originalCrypto;

    beforeEach(() => {
        originalBlob = global.Blob;
        originalCrypto = global.crypto;
        global.Blob = NodeBlob;
        Object.defineProperty(global, 'crypto', { configurable: true, value: webcrypto });
    });

    afterEach(() => {
        jest.useRealTimers();
        delete global.chrome;
        delete global.fetch;
        global.Blob = originalBlob;
        Object.defineProperty(global, 'crypto', { configurable: true, value: originalCrypto });
        jest.resetModules();
    });

    function cloudOnlyStorage() {
        return {
            processedIds: [],
            downloadPath: 'GrokVault',
            activeGrokUserId: 'user-1',
            cloudConfig: {
                mode: 'cloud_only',
                workerUrl: 'https://test-worker.example.workers.dev',
                apiKey: 'unit-test-key',
                keyPrefix: 'test/v1'
            }
        };
    }

    function installAuthenticatedUploadFailure(harness) {
        global.fetch = jest.fn(async (url) => {
            if (String(url).endsWith('/v1/objects/verify')) {
                return { ok: false, status: 503, text: async () => 'temporary verify failure' };
            }
            throw new Error(`Unexpected test fetch: ${String(url)}`);
        });
        harness.chromeApi.runtime.sendMessage.mockImplementation(async (message) => {
            if (message.action === 'READ_FILE_FOR_UPLOAD') {
                return {
                    ok: true,
                    base64: Buffer.from([1, 2, 3, 4]).toString('base64'),
                    type: 'image/jpeg',
                    size: 4
                };
            }
            return undefined;
        });
    }

    function dualWritePendingStorage(downloadId) {
        const storage = cloudOnlyStorage();
        storage.processedIds = [mediaId];
        storage.cloudConfig.mode = 'dual_write';
        storage.pendingDownloadOperations = {
            [downloadId]: {
                downloadId,
                mediaId,
                reservationKey: mediaId,
                finalPath: `GrokVault/user-1/2026-08-12_Auto/${mediaId}.jpg`,
                allowLocal: true,
                cloudRequired: true,
                strategy: 'auth_file',
                cleanupDownloadId: null,
                downloadState: 'complete',
                r2State: 'pending',
                attempts: 1,
                lastError: `stage=presign code=auth_upload_failed media=...${mediaId.slice(-8)}`,
                localIdentityPersisted: true
            }
        };
        return storage;
    }

    function publicRetryStorage(downloadId, attempts) {
        const storage = cloudOnlyStorage();
        const finalPath = `GrokVault/user-1/2026-08-12_Auto/${mediaId}.jpg`;
        const contentType = 'image/jpeg';
        const identity = CloudSyncUtils.resolveMediaAssetIdentity({
            sourceUrl: publicUrl,
            finalPath,
            contentType
        });
        const lastError = `stage=media-fetch code=queue_upload_failed media=...${mediaId.slice(-8)}`;
        storage.cloudSyncQueue = [{
            id: 'public-cleanup-retry',
            type: 'media',
            sourceUrl: publicUrl,
            finalPath,
            objectKey: CloudSyncUtils.buildMediaObjectKeyForUpload({
                keyPrefix: storage.cloudConfig.keyPrefix,
                fallbackUserId: storage.activeGrokUserId,
                sourceUrl: publicUrl,
                finalPath,
                contentType
            }),
            assetId: identity.assetId,
            sourceUrlHash: identity.sourceUrlHash,
            assetIdentityKind: identity.kind,
            contentType,
            promptText: '',
            backupProcessedId: mediaId,
            cleanupDownloadId: downloadId,
            dedupeKey: CloudSyncUtils.buildMediaDedupeKey({
                fallbackUserId: storage.activeGrokUserId,
                sourceUrl: publicUrl,
                finalPath,
                contentType
            }),
            attempts,
            lastError
        }];
        storage.cloudSyncState = { lastError, processing: false, unsyncedCount: 1 };
        storage.pendingDownloadOperations = {
            [downloadId]: {
                downloadId,
                mediaId,
                reservationKey: mediaId,
                finalPath,
                allowLocal: false,
                cloudRequired: true,
                strategy: 'public_queue',
                cleanupDownloadId: downloadId,
                downloadState: 'in_progress',
                r2State: 'pending',
                attempts: 0,
                lastError: null,
                localIdentityPersisted: false
            }
        };
        return storage;
    }

    function publicDualWriteRetryStorage(downloadId, attempts, {
        downloadState = 'in_progress',
        localIdentityPersisted = false
    } = {}) {
        const storage = publicRetryStorage(downloadId, attempts);
        storage.cloudConfig.mode = 'dual_write';
        storage.processedIds = localIdentityPersisted ? [mediaId] : [];
        storage.cloudSyncQueue[0].cleanupDownloadId = null;
        storage.pendingDownloadOperations[downloadId] = {
            ...storage.pendingDownloadOperations[downloadId],
            allowLocal: true,
            cleanupDownloadId: null,
            downloadState,
            localIdentityPersisted
        };
        return storage;
    }

    async function completeFailedPublicDualWriteDownload(harness, downloadId) {
        global.fetch = jest.fn(() => Promise.reject(new Error('[media-fetch] temporary failure')));
        await harness.load();
        const suggest = jest.fn();

        expect(harness.getFilenameListener()({
            id: downloadId,
            url: publicUrl,
            filename: 'image.jpg'
        }, suggest)).toBe(true);
        await waitForAssertion(() => expect(suggest).toHaveBeenCalledTimes(1));
        await waitForAssertion(() => expect(harness.storageState.cloudSyncQueue?.[0]?.attempts).toBe(1));

        expect(harness.storageState.cloudSyncQueue[0].cleanupDownloadId).toBe(downloadId);
        expect(harness.storageState.pendingDownloadOperations[String(downloadId)].cleanupDownloadId).toBe(downloadId);

        harness.downloads.set(downloadId, {
            id: downloadId,
            url: publicUrl,
            filename: '/Downloads/public-dual.jpg',
            mime: 'image/jpeg',
            state: 'complete'
        });
        await Promise.resolve(harness.getDownloadChangedListener()({
            id: downloadId,
            state: { current: 'complete' }
        }));
        await waitForAssertion(() => expect(
            harness.storageState.pendingDownloadOperations[String(downloadId)]
        ).toEqual(expect.objectContaining({
            downloadState: 'complete',
            r2State: 'pending'
        })));

        expect(harness.storageState.pendingDownloadOperations[String(downloadId)]).toEqual(expect.objectContaining({
            downloadState: 'complete',
            r2State: 'pending'
        }));
        expect(harness.storageState.pendingDownloadOperations[String(downloadId)].localIdentityPersisted)
            .not.toBe(true);
        expect(harness.storageState.processedIds).toEqual([]);
        expect(harness.chromeApi.downloads.removeFile).not.toHaveBeenCalled();
    }

    function completedCloudOnlyOperation(downloadId) {
        const storage = cloudOnlyStorage();
        storage.pendingDownloadOperations = {
            [downloadId]: {
                downloadId,
                mediaId,
                reservationKey: mediaId,
                finalPath: `GrokVault/user-1/2026-08-12_Auto/${mediaId}.jpg`,
                allowLocal: false,
                cloudRequired: true,
                strategy: 'public_queue',
                cleanupDownloadId: downloadId,
                downloadState: 'complete',
                r2State: 'present',
                r2Status: 'already_present',
                attempts: 0,
                lastError: null,
                localIdentityPersisted: false
            }
        };
        return storage;
    }

    async function createFailedRunOwnedDualWrite(harness, lease, downloadId) {
        global.fetch = jest.fn(() => Promise.reject(new Error('[media-fetch] temporary failure')));
        harness.chromeApi.downloads.download.mockResolvedValue(downloadId);
        const background = await harness.load();
        await background.ensureBackgroundStateReady();

        const upload = dispatchRuntimeMessage(harness.getRuntimeListener(), {
            action: 'R2_BACKUP_UPLOAD',
            runToken: lease.token,
            runEpoch: lease.epoch,
            kind: lease.kind,
            url: publicUrl,
            isVideo: false,
            promptText: ''
        }, { tab: { id: lease.tabId } });
        await expect(upload.response).resolves.toEqual({ status: 'queued' });
        await waitForAssertion(() => expect(harness.storageState.cloudSyncQueue?.[0]?.attempts).toBe(1));

        const suggest = jest.fn();
        expect(harness.getFilenameListener()({
            id: downloadId,
            url: publicUrl,
            filename: 'image.jpg'
        }, suggest)).toBe(true);
        await waitForAssertion(() => expect(suggest).toHaveBeenCalledTimes(1));
        await waitForAssertion(() => expect(
            harness.storageState.cloudSyncQueue?.[0]?.cleanupDownloadId
        ).toBe(downloadId));

        harness.downloads.set(downloadId, {
            id: downloadId,
            url: publicUrl,
            filename: '/Downloads/run-owned-dual-write.jpg',
            mime: 'image/jpeg',
            state: 'in_progress'
        });
        return background;
    }

    test('normal completion preserves linked native download authority through alarm retry', async () => {
        const downloadId = 73;
        const lease = activeScrapeLease({ token: 'completed-linked-native-run' });
        const storage = {
            ...cloudOnlyStorage(),
            cloudConfig: { ...cloudOnlyStorage().cloudConfig, mode: 'dual_write' },
            scraperState: 'running',
            scrapeRunToken: lease.token,
            scrapeRunEpoch: lease.epoch,
            isScraping: true,
            isR2Backup: true
        };
        const harness = createDurableBackgroundHarness(storage, {}, { activeScrapeRunToken: lease });
        const background = await createFailedRunOwnedDualWrite(harness, lease, downloadId);

        expect(harness.storageState.cloudSyncQueue[0]).toEqual(expect.objectContaining({
            cleanupDownloadId: downloadId,
            scrapeLease: expect.objectContaining({ token: lease.token, epoch: lease.epoch })
        }));
        expect(harness.storageState.pendingDownloadOperations[String(downloadId)]).toEqual(expect.objectContaining({
            downloadId,
            scrapeLease: expect.objectContaining({ token: lease.token, epoch: lease.epoch }),
            downloadState: 'in_progress',
            r2State: 'pending',
            attempts: 0
        }));
        const runQueueRevision = harness.storageState.cloudSyncQueue[0].queueRevision;

        const completion = dispatchRuntimeMessage(harness.getRuntimeListener(), {
            action: 'R2_BACKUP_COMPLETE',
            runToken: lease.token,
            runEpoch: lease.epoch,
            kind: lease.kind,
            stats: { uploaded: 0, alreadyPresent: 0, queued: 1, errors: 0, stopReason: 'complete' }
        }, { tab: { id: lease.tabId } });
        await expect(completion.response).resolves.toEqual({ status: 'ok' });

        const effectiveQueue = background.getCloudSyncQueueForTest();
        const effectiveOperations = background.getPendingDownloadOperationsForTest();
        expect(effectiveQueue[0]).toEqual(expect.objectContaining({
            attempts: 1,
            queueRevision: expect.any(Number)
        }));
        expect(effectiveQueue[0].queueRevision).toBeGreaterThan(runQueueRevision);
        expect(effectiveQueue[0]).not.toHaveProperty('scrapeLease');
        expect(effectiveOperations[String(downloadId)]).toEqual(expect.objectContaining({
            attempts: 0,
            downloadState: 'in_progress',
            r2State: 'pending'
        }));
        expect(effectiveOperations[String(downloadId)]).not.toHaveProperty('scrapeLease');
        expect(getStoredCompletionRecord(harness.storageState, 'committed')).toBeTruthy();

        installR2PresentFetch(publicUrl);
        harness.getAlarmListener()({ name: 'gptCloudRetry' });
        await waitForAssertion(() => expect(
            harness.storageState.cloudSyncQueue.filter((item) => item.type === 'media')
        ).toEqual([]));

        expect(harness.chromeApi.downloads.cancel).not.toHaveBeenCalledWith(downloadId);
        expect(harness.storageState.processedIds).toEqual([]);
        expect(harness.storageState.pendingDownloadOperations[String(downloadId)]).toEqual(expect.objectContaining({
            downloadState: 'in_progress',
            r2State: 'present'
        }));

        harness.downloads.set(downloadId, {
            ...harness.downloads.get(downloadId),
            state: 'complete'
        });
        await Promise.resolve(harness.getDownloadChangedListener()({
            id: downloadId,
            state: { current: 'complete' }
        }));
        await waitForAssertion(() => expect(harness.storageState.processedIds).toEqual([mediaId]));

        expect(harness.storageState.pendingDownloadOperations).toEqual({});
        expect(harness.chromeApi.downloads.removeFile).not.toHaveBeenCalled();
    });

    test('stale download completion cannot remove authority detached by normal completion', async () => {
        const downloadId = 75;
        const lease = activeScrapeLease({ token: 'stale-download-completion-run' });
        const storage = {
            ...cloudOnlyStorage(),
            scraperState: 'running',
            scrapeRunToken: lease.token,
            scrapeRunEpoch: lease.epoch,
            isScraping: true,
            isR2Backup: true,
            pendingDownloadOperations: {
                [downloadId]: {
                    downloadId,
                    operationRevision: 11,
                    mediaId,
                    reservationKey: mediaId,
                    finalPath: `GrokVault/user-1/2026-08-12_Auto/${mediaId}.jpg`,
                    allowLocal: false,
                    cloudRequired: true,
                    strategy: 'auth_file',
                    cleanupDownloadId: null,
                    downloadState: 'in_progress',
                    r2State: 'pending',
                    attempts: 1,
                    localIdentityPersisted: false,
                    scrapeLease: lease
                }
            }
        };
        const harness = createDurableBackgroundHarness(storage, {
            [downloadId]: {
                id: downloadId,
                url: authUrl,
                filename: '/Downloads/stale-auth-file.jpg',
                mime: 'image/jpeg',
                state: 'in_progress'
            }
        }, { activeScrapeRunToken: lease });
        const background = await harness.load();
        await background.ensureBackgroundStateReady();
        await background.ensureScrapeLeaseHydrated();

        const downloadSearch = createDeferred();
        let downloadSearchStarted = false;
        harness.chromeApi.downloads.search.mockImplementation(() => {
            downloadSearchStarted = true;
            return downloadSearch.promise;
        });
        harness.downloads.set(downloadId, {
            ...harness.downloads.get(downloadId),
            state: 'complete'
        });

        const changed = harness.getDownloadChangedListener()({
            id: downloadId,
            state: { current: 'complete' }
        });
        await waitForAssertion(() => expect(downloadSearchStarted).toBe(true));

        const completion = dispatchRuntimeMessage(harness.getRuntimeListener(), {
            action: 'R2_BACKUP_COMPLETE',
            runToken: lease.token,
            runEpoch: lease.epoch,
            kind: lease.kind,
            stats: { uploaded: 0, alreadyPresent: 0, queued: 1, errors: 0, stopReason: 'complete' }
        }, { tab: { id: lease.tabId } });
        await expect(completion.response).resolves.toEqual({ status: 'ok' });

        downloadSearch.resolve([cloneJson(harness.downloads.get(downloadId))]);
        await changed;

        const effectiveOperation = background.getPendingDownloadOperationsForTest()[String(downloadId)];
        expect(effectiveOperation).toEqual(expect.objectContaining({
            downloadId,
            operationRevision: expect.any(Number),
            downloadState: 'complete',
            r2State: 'pending'
        }));
        expect(effectiveOperation.operationRevision).toBeGreaterThan(11);
        expect(effectiveOperation).not.toHaveProperty('scrapeLease');
        expect(harness.chromeApi.downloads.cancel).not.toHaveBeenCalledWith(downloadId);
        expect(harness.storageState.processedIds).toEqual([]);
    });

    test('rejected atomic completion transfer remains lease-owned and Stop revokes it', async () => {
        const downloadId = 76;
        const lease = activeScrapeLease({ token: 'rejected-completion-transfer-run' });
        const storage = {
            ...cloudOnlyStorage(),
            scraperState: 'running',
            scrapeRunToken: lease.token,
            scrapeRunEpoch: lease.epoch,
            isScraping: true,
            isR2Backup: true,
            cloudSyncQueue: [{
                id: 'rejected-transfer-item',
                dedupeKey: 'rejected-transfer-item',
                queueRevision: 9,
                type: 'media',
                backupProcessedId: mediaId,
                attempts: 1,
                scrapeLease: lease
            }],
            pendingDownloadOperations: {
                [downloadId]: {
                    downloadId,
                    operationRevision: 13,
                    mediaId,
                    allowLocal: false,
                    cloudRequired: true,
                    strategy: 'auth_file',
                    downloadState: 'in_progress',
                    r2State: 'pending',
                    scrapeLease: lease
                }
            }
        };
        const harness = createDurableBackgroundHarness(storage, {
            [downloadId]: { id: downloadId, url: authUrl, state: 'in_progress' }
        }, { activeScrapeRunToken: lease });
        const background = await harness.load();
        await background.ensureBackgroundStateReady();
        await background.ensureScrapeLeaseHydrated();

        const originalSet = harness.chromeApi.storage.local.set.getMockImplementation();
        harness.chromeApi.storage.local.set.mockImplementation((values) => {
            if (isCompletionPersistence(values, 'prepared')) {
                return Promise.reject(new Error('atomic completion persistence rejected'));
            }
            return originalSet(values);
        });

        const completion = dispatchRuntimeMessage(harness.getRuntimeListener(), {
            action: 'R2_BACKUP_COMPLETE',
            runToken: lease.token,
            runEpoch: lease.epoch,
            kind: lease.kind,
            stats: { uploaded: 0, alreadyPresent: 0, queued: 1, errors: 0, stopReason: 'complete' }
        }, { tab: { id: lease.tabId } });
        await expect(completion.response).resolves.toEqual({ status: 'ignored' });
        expect(harness.storageState.cloudSyncQueue[0].scrapeLease).toEqual(expect.objectContaining({ token: lease.token }));
        expect(harness.storageState.pendingDownloadOperations[String(downloadId)].scrapeLease)
            .toEqual(expect.objectContaining({ token: lease.token }));

        harness.chromeApi.storage.local.set.mockImplementation(originalSet);
        const stopped = dispatchRuntimeMessage(harness.getRuntimeListener(), { action: 'STOP_R2_BACKUP' });
        await expect(stopped.response).resolves.toEqual(expect.objectContaining({ status: 'stopped' }));
        expect(background.getCloudSyncQueueForTest().filter((item) => item.type === 'media')).toEqual([]);
        expect(background.getPendingDownloadOperationsForTest()).toEqual({});
        expect(getStoredCompletionRecord(harness.storageState, 'revoked')).toBeTruthy();
        expect(harness.chromeApi.downloads.cancel).toHaveBeenCalledWith(downloadId);
        expect(harness.storageState.processedIds).toEqual([]);
    });

    test('a timed-out late committed completion record is fenced by revocation across restart', async () => {
        jest.useFakeTimers();
        const downloadId = 77;
        const lease = activeScrapeLease({ token: 'late-completion-transfer-run' });
        const storage = {
            ...cloudOnlyStorage(),
            scraperState: 'running',
            scrapeRunToken: lease.token,
            scrapeRunEpoch: lease.epoch,
            isScraping: true,
            isR2Backup: true,
            cloudSyncQueue: [{
                id: 'late-transfer-item',
                dedupeKey: 'late-transfer-item',
                queueRevision: 17,
                type: 'media',
                backupProcessedId: mediaId,
                attempts: 1,
                scrapeLease: lease
            }],
            pendingDownloadOperations: {
                [downloadId]: {
                    downloadId,
                    operationRevision: 19,
                    mediaId,
                    allowLocal: false,
                    cloudRequired: true,
                    strategy: 'auth_file',
                    downloadState: 'in_progress',
                    r2State: 'pending',
                    scrapeLease: lease
                }
            }
        };
        const harness = createDurableBackgroundHarness(storage, {
            [downloadId]: { id: downloadId, url: authUrl, state: 'in_progress' }
        }, { activeScrapeRunToken: lease });
        const background = await harness.load();
        await background.ensureBackgroundStateReady();
        await background.ensureScrapeLeaseHydrated();

        const originalSet = harness.chromeApi.storage.local.set.getMockImplementation();
        const lateWrite = createDeferred();
        const completionWriteStarted = createDeferred();
        let lateValues = null;
        harness.chromeApi.storage.local.set.mockImplementation((values) => {
            if (!lateValues && isCompletionPersistence(values, 'committed')) {
                lateValues = cloneJson(values);
                completionWriteStarted.resolve();
                return lateWrite.promise.then(() => originalSet(lateValues));
            }
            return originalSet(values);
        });

        const completion = dispatchRuntimeMessage(harness.getRuntimeListener(), {
            action: 'R2_BACKUP_COMPLETE',
            runToken: lease.token,
            runEpoch: lease.epoch,
            kind: lease.kind,
            stats: { uploaded: 0, alreadyPresent: 0, queued: 1, errors: 0, stopReason: 'complete' }
        }, { tab: { id: lease.tabId } });
        await completionWriteStarted.promise;
        expect(findStoredRecord(lateValues, 'scrape_completion_journal')).toEqual(
            expect.objectContaining({ phase: 'committed' })
        );
        await jest.advanceTimersByTimeAsync(3500);
        await expect(completion.response).resolves.toEqual({ status: 'ignored' });
        expect(harness.storageState.scraperState).toBe('idle');
        expect(background.getCloudSyncQueueForTest()).toEqual([]);
        expect(background.getPendingDownloadOperationsForTest()).toEqual({});
        expect(getStoredCompletionRecord(harness.storageState, 'revoked')).toBeTruthy();
        const upload = jest.fn();
        await background.processCloudQueue('revoked-late-transfer', { uploadMediaQueueItem: upload });
        expect(upload).not.toHaveBeenCalled();

        jest.useRealTimers();
        findStoredRecord(lateValues, 'scrape_completion_journal').revision = 1000;
        lateWrite.resolve();
        await lateWrite.promise;
        await Promise.resolve();
        expect(getStoredCompletionRecord(harness.storageState, 'committed')).toBeTruthy();

        const restarted = await harness.load();
        await restarted.ensureBackgroundStateReady();
        await restarted.processCloudQueue('restarted-revoked-late-transfer', { uploadMediaQueueItem: upload });
        expect(restarted.getCloudSyncQueueForTest()).toEqual([]);
        expect(restarted.getPendingDownloadOperationsForTest()).toEqual({});
        expect(upload).not.toHaveBeenCalled();
        expect(harness.storageState.processedIds).toEqual([]);
    });

    test('startup commits a prepared completion transfer and unblocks its retry work', async () => {
        const lease = activeScrapeLease({ token: 'prepared-restart-run' });
        const completionTxn = {
            id: 'scrape_completion_prepared_restart',
            phase: 'prepared',
            lease,
            createdAt: 1234
        };
        const storage = {
            ...cloudOnlyStorage(),
            scraperState: 'idle',
            scrapeRunToken: null,
            scrapeRunEpoch: null,
            isScraping: false,
            isR2Backup: false,
            scrapeStopReason: 'complete',
            scrapeCompletionTxn: completionTxn,
            cloudSyncQueue: [{
                id: 'prepared-restart-item',
                dedupeKey: 'prepared-restart-item',
                queueRevision: 31,
                type: 'media',
                backupProcessedId: mediaId,
                attempts: 1,
                completionTxnId: completionTxn.id,
                revocationLease: lease
            }]
        };
        const idleLease = {
            version: 1,
            epoch: lease.epoch + 1,
            token: null,
            tabId: null,
            kind: null,
            status: 'idle',
            startedAt: null
        };
        const harness = createDurableBackgroundHarness(storage, {}, { activeScrapeRunToken: idleLease });
        const background = await harness.load();
        await background.ensureBackgroundStateReady();

        expect(getStoredCompletionRecord(
            harness.storageState,
            'committed',
            completionTxn.id
        )).toBeTruthy();

        const upload = jest.fn(() => Promise.resolve({ status: 'already_present', bytes: 0 }));
        await background.processCloudQueue('prepared-restart-recovery', { uploadMediaQueueItem: upload });

        expect(upload).toHaveBeenCalledTimes(1);
        expect(harness.storageState.cloudSyncQueue).toEqual([]);
        expect(harness.storageState.processedIds).toEqual([mediaId]);
    });

    test('startup discards a stopped prepared completion transfer without retrying it', async () => {
        const lease = activeScrapeLease({ token: 'stopped-prepared-restart-run' });
        const completionTxn = {
            id: 'scrape_completion_stopped_prepared_restart',
            phase: 'prepared',
            lease,
            createdAt: 1234
        };
        const downloadId = 79;
        const storage = {
            ...cloudOnlyStorage(),
            scraperState: 'idle',
            scrapeRunToken: null,
            scrapeRunEpoch: null,
            isScraping: false,
            isR2Backup: false,
            scrapeStopReason: 'stopped',
            scrapeCompletionTxn: completionTxn,
            cloudSyncQueue: [{
                id: 'stopped-prepared-restart-item',
                dedupeKey: 'stopped-prepared-restart-item',
                queueRevision: 32,
                type: 'media',
                backupProcessedId: mediaId,
                attempts: 1,
                completionTxnId: completionTxn.id,
                revocationLease: lease
            }],
            pendingDownloadOperations: {
                [downloadId]: {
                    downloadId,
                    operationRevision: 33,
                    mediaId,
                    allowLocal: false,
                    cloudRequired: true,
                    strategy: 'auth_file',
                    downloadState: 'in_progress',
                    r2State: 'pending',
                    completionTxnId: completionTxn.id,
                    revocationLease: lease
                }
            }
        };
        const idleLease = {
            version: 1,
            epoch: lease.epoch + 1,
            token: null,
            tabId: null,
            kind: null,
            status: 'idle',
            startedAt: null
        };
        const harness = createDurableBackgroundHarness(storage, {}, { activeScrapeRunToken: idleLease });
        const background = await harness.load();
        await background.ensureBackgroundStateReady();

        const upload = jest.fn();
        await background.processCloudQueue('stopped-prepared-recovery', { uploadMediaQueueItem: upload });

        expect(upload).not.toHaveBeenCalled();
        expect(getStoredCompletionRecord(harness.storageState, 'revoked')).toBeTruthy();
        expect(harness.storageState.cloudSyncQueue).toEqual([]);
        expect(background.getPendingDownloadOperationsForTest()).toEqual({});
        expect(harness.storageState.processedIds).toEqual([]);
    });

    test('a failed completion commit recovers and drains without a service-worker restart', async () => {
        const lease = activeScrapeLease({ token: 'same-worker-commit-recovery-run' });
        const storage = {
            ...cloudOnlyStorage(),
            scraperState: 'running',
            scrapeRunToken: lease.token,
            scrapeRunEpoch: lease.epoch,
            isScraping: true,
            isR2Backup: true,
            cloudSyncQueue: [{
                id: 'same-worker-commit-recovery-item',
                dedupeKey: 'same-worker-commit-recovery-item',
                queueRevision: 34,
                type: 'media',
                backupProcessedId: mediaId,
                attempts: 1,
                scrapeLease: lease
            }]
        };
        const harness = createDurableBackgroundHarness(storage, {}, { activeScrapeRunToken: lease });
        const background = await harness.load();
        await background.ensureBackgroundStateReady();

        const originalSet = harness.chromeApi.storage.local.set.getMockImplementation();
        let rejectedCommit = false;
        harness.chromeApi.storage.local.set.mockImplementation((values) => {
            if (!rejectedCommit && isCompletionPersistence(values, 'committed')) {
                rejectedCommit = true;
                return Promise.reject(new Error('completion commit rejected once'));
            }
            return originalSet(values);
        });

        const completion = dispatchRuntimeMessage(harness.getRuntimeListener(), {
            action: 'R2_BACKUP_COMPLETE',
            runToken: lease.token,
            runEpoch: lease.epoch,
            kind: lease.kind,
            stats: { uploaded: 0, alreadyPresent: 0, queued: 1, errors: 0, stopReason: 'complete' }
        }, { tab: { id: lease.tabId } });
        await expect(completion.response).resolves.toEqual({ status: 'ignored' });
        const preparedRecord = getStoredCompletionRecord(harness.storageState, 'prepared');
        expect(preparedRecord).toBeTruthy();

        const upload = jest.fn(() => Promise.resolve({ status: 'already_present', bytes: 0 }));
        await background.processCloudQueue('same-worker-completion-recovery', { uploadMediaQueueItem: upload });

        expect(upload).toHaveBeenCalledTimes(1);
        expect(getStoredCompletionRecord(
            harness.storageState,
            'committed',
            preparedRecord.txn.id
        )).toBeTruthy();
        expect(harness.storageState.cloudSyncQueue).toEqual([]);
        expect(harness.storageState.processedIds).toEqual([mediaId]);
    });

    test('stale interrupted download callback cannot remove a detached retry operation', async () => {
        const downloadId = 80;
        const lease = activeScrapeLease({ token: 'stale-interrupted-download-run' });
        const storage = {
            ...cloudOnlyStorage(),
            scraperState: 'running',
            scrapeRunToken: lease.token,
            scrapeRunEpoch: lease.epoch,
            isScraping: true,
            isR2Backup: true,
            pendingDownloadOperations: {
                [downloadId]: {
                    downloadId,
                    operationRevision: 41,
                    mediaId,
                    allowLocal: false,
                    cloudRequired: true,
                    strategy: 'auth_file',
                    downloadState: 'in_progress',
                    r2State: 'pending',
                    scrapeLease: lease
                }
            }
        };
        const harness = createDurableBackgroundHarness(storage, {
            [downloadId]: { id: downloadId, url: authUrl, state: 'in_progress' }
        }, { activeScrapeRunToken: lease });
        const background = await harness.load();
        await background.ensureBackgroundStateReady();
        await background.ensureScrapeLeaseHydrated();

        const staleRevision = background
            .getPendingDownloadOperationsForTest()[String(downloadId)]
            .operationRevision;

        const completion = dispatchRuntimeMessage(harness.getRuntimeListener(), {
            action: 'R2_BACKUP_COMPLETE',
            runToken: lease.token,
            runEpoch: lease.epoch,
            kind: lease.kind,
            stats: { uploaded: 0, alreadyPresent: 0, queued: 1, errors: 0, stopReason: 'complete' }
        }, { tab: { id: lease.tabId } });
        await expect(completion.response).resolves.toEqual({ status: 'ok' });

        await expect(background.removeDownloadOperationRevisionForTest(
            downloadId,
            staleRevision,
            lease
        )).resolves.toBeNull();

        const effectiveOperation = background.getPendingDownloadOperationsForTest()[String(downloadId)];
        expect(effectiveOperation).toEqual(expect.objectContaining({
            operationRevision: expect.any(Number),
            downloadState: 'in_progress',
            r2State: 'pending'
        }));
        expect(effectiveOperation.operationRevision).toBeGreaterThan(41);
        expect(effectiveOperation).not.toHaveProperty('scrapeLease');
        expect(harness.chromeApi.downloads.cancel).not.toHaveBeenCalledWith(downloadId);
    });

    test('normal completion transfers an unqueued authenticated-file retry operation', async () => {
        const downloadId = 78;
        const lease = activeScrapeLease({ token: 'unqueued-auth-file-run' });
        const storage = {
            ...cloudOnlyStorage(),
            scraperState: 'running',
            scrapeRunToken: lease.token,
            scrapeRunEpoch: lease.epoch,
            isScraping: true,
            isR2Backup: true,
            pendingDownloadOperations: {
                [downloadId]: {
                    downloadId,
                    operationRevision: 23,
                    mediaId,
                    reservationKey: mediaId,
                    finalPath: `GrokVault/user-1/2026-08-12_Auto/${mediaId}.jpg`,
                    allowLocal: false,
                    cloudRequired: true,
                    strategy: 'auth_file',
                    downloadState: 'in_progress',
                    r2State: 'pending',
                    attempts: 1,
                    localIdentityPersisted: false,
                    scrapeLease: lease
                }
            }
        };
        const harness = createDurableBackgroundHarness(storage, {
            [downloadId]: { id: downloadId, url: authUrl, state: 'in_progress' }
        }, { activeScrapeRunToken: lease });
        const background = await harness.load();
        await background.ensureBackgroundStateReady();

        const completion = dispatchRuntimeMessage(harness.getRuntimeListener(), {
            action: 'R2_BACKUP_COMPLETE',
            runToken: lease.token,
            runEpoch: lease.epoch,
            kind: lease.kind,
            stats: { uploaded: 0, alreadyPresent: 0, queued: 1, errors: 0, stopReason: 'complete' }
        }, { tab: { id: lease.tabId } });
        await expect(completion.response).resolves.toEqual({ status: 'ok' });

        const effectiveOperation = background.getPendingDownloadOperationsForTest()[String(downloadId)];
        expect(effectiveOperation).toEqual(expect.objectContaining({
            downloadId,
            operationRevision: expect.any(Number),
            downloadState: 'in_progress',
            r2State: 'pending'
        }));
        expect(effectiveOperation.operationRevision).toBeGreaterThan(23);
        expect(effectiveOperation).not.toHaveProperty('scrapeLease');
        expect(getStoredCompletionRecord(harness.storageState, 'committed')).toBeTruthy();
        expect(harness.chromeApi.downloads.cancel).not.toHaveBeenCalledWith(downloadId);
    });

    test('coalesces concurrent cloud drains before the deferred config read', async () => {
        const harness = createDurableBackgroundHarness(cloudOnlyStorage());
        const background = await harness.load();
        await background.ensureBackgroundStateReady();
        background.setCloudSyncQueueForTest([{
            id: 'single-flight-item',
            dedupeKey: 'single-flight-item',
            queueRevision: 31,
            type: 'media',
            backupProcessedId: mediaId,
            attempts: 0
        }]);

        const originalGet = harness.chromeApi.storage.local.get.getMockImplementation();
        const configRead = createDeferred();
        let configReads = 0;
        harness.chromeApi.storage.local.get.mockImplementation((keys) => {
            if (Array.isArray(keys) && keys.length === 1 && keys[0] === 'cloudConfig') {
                configReads += 1;
                return configRead.promise;
            }
            return originalGet(keys);
        });
        const uploadResult = createDeferred();
        const upload = jest.fn(() => uploadResult.promise);

        const first = background.processCloudQueue('concurrent-first', { uploadMediaQueueItem: upload });
        const second = background.processCloudQueue('concurrent-second', { uploadMediaQueueItem: upload });
        expect(second).toBe(first);
        configRead.resolve({ cloudConfig: cloneJson(harness.storageState.cloudConfig) });
        await waitForAssertion(() => expect(upload).toHaveBeenCalled());
        const uploadCallsBeforeRelease = upload.mock.calls.length;
        uploadResult.resolve({ status: 'already_present', bytes: 0 });
        await Promise.all([first, second]);

        expect(configReads).toBe(1);
        expect(uploadCallsBeforeRelease).toBe(1);
        expect(upload).toHaveBeenCalledTimes(1);
        expect(harness.storageState.processedIds).toEqual([mediaId]);
    });

    test('Stop still revokes linked native download and queue work before completion', async () => {
        const downloadId = 74;
        const lease = activeScrapeLease({ token: 'stopped-linked-native-run' });
        const storage = {
            ...cloudOnlyStorage(),
            cloudConfig: { ...cloudOnlyStorage().cloudConfig, mode: 'dual_write' },
            scraperState: 'running',
            scrapeRunToken: lease.token,
            scrapeRunEpoch: lease.epoch,
            isScraping: true,
            isR2Backup: true
        };
        const harness = createDurableBackgroundHarness(storage, {}, { activeScrapeRunToken: lease });
        const background = await createFailedRunOwnedDualWrite(harness, lease, downloadId);

        const stopped = dispatchRuntimeMessage(harness.getRuntimeListener(), { action: 'STOP_R2_BACKUP' });
        await expect(stopped.response).resolves.toEqual(expect.objectContaining({ status: 'stopped' }));

        expect(background.getCloudSyncQueueForTest().filter((item) => item.type === 'media')).toEqual([]);
        expect(background.getPendingDownloadOperationsForTest()).toEqual({});
        expect(getStoredCompletionRecord(harness.storageState, 'revoked')).toBeTruthy();
        expect(harness.chromeApi.downloads.cancel).toHaveBeenCalledWith(downloadId);
        expect(harness.storageState.processedIds).toEqual([]);
    });

    test('retries a failed run queue item after normal completion detaches its authority', async () => {
        const lease = activeScrapeLease();
        const storage = {
            ...cloudOnlyStorage(),
            scraperState: 'running',
            scrapeRunToken: lease.token,
            scrapeRunEpoch: lease.epoch,
            isScraping: true,
            isR2Backup: true
        };
        global.fetch = jest.fn(() => Promise.reject(new Error('[media-fetch] temporary failure')));
        const harness = createDurableBackgroundHarness(storage, {}, { activeScrapeRunToken: lease });
        const background = await harness.load();
        await background.ensureBackgroundStateReady();

        const upload = dispatchRuntimeMessage(harness.getRuntimeListener(), {
            action: 'R2_BACKUP_UPLOAD',
            runToken: lease.token,
            runEpoch: lease.epoch,
            kind: lease.kind,
            url: publicUrl,
            isVideo: false,
            promptText: '',
            skipLocalDownload: true
        }, { tab: { id: lease.tabId } });
        await expect(upload.response).resolves.toEqual({ status: 'queued' });
        await waitForAssertion(() => expect(harness.storageState.cloudSyncQueue?.[0]?.attempts).toBe(1));
        expect(harness.storageState.cloudSyncQueue[0].scrapeLease).toEqual(expect.objectContaining({
            token: lease.token,
            epoch: lease.epoch
        }));

        const completion = dispatchRuntimeMessage(harness.getRuntimeListener(), {
            action: 'R2_BACKUP_COMPLETE',
            runToken: lease.token,
            runEpoch: lease.epoch,
            kind: lease.kind,
            stats: { uploaded: 0, alreadyPresent: 0, queued: 1, errors: 0, stopReason: 'complete' }
        }, { tab: { id: lease.tabId } });
        await expect(completion.response).resolves.toEqual({ status: 'ok' });

        expect(background.getCloudSyncQueueForTest()).toHaveLength(1);
        expect(background.getCloudSyncQueueForTest()[0]).not.toHaveProperty('scrapeLease');
        expect(getStoredCompletionRecord(harness.storageState, 'committed')).toBeTruthy();
        installR2PresentFetch(publicUrl);
        harness.getAlarmListener()({ name: 'gptCloudRetry' });
        await waitForAssertion(() => expect(harness.storageState.processedIds).toEqual([mediaId]));

        expect(harness.storageState.cloudSyncQueue).toEqual([]);
    });

    test('Stop still removes failed queue work owned by the revoked run', async () => {
        const lease = activeScrapeLease({ token: 'stopped-r2-run' });
        const storage = {
            ...cloudOnlyStorage(),
            scraperState: 'running',
            scrapeRunToken: lease.token,
            scrapeRunEpoch: lease.epoch,
            isScraping: true,
            isR2Backup: true
        };
        global.fetch = jest.fn(() => Promise.reject(new Error('[media-fetch] temporary failure')));
        const harness = createDurableBackgroundHarness(storage, {}, { activeScrapeRunToken: lease });
        const background = await harness.load();
        await background.ensureBackgroundStateReady();

        const upload = dispatchRuntimeMessage(harness.getRuntimeListener(), {
            action: 'R2_BACKUP_UPLOAD',
            runToken: lease.token,
            runEpoch: lease.epoch,
            kind: lease.kind,
            url: publicUrl,
            isVideo: false,
            promptText: '',
            skipLocalDownload: true
        }, { tab: { id: lease.tabId } });
        await expect(upload.response).resolves.toEqual({ status: 'queued' });
        await waitForAssertion(() => expect(harness.storageState.cloudSyncQueue?.[0]?.attempts).toBe(1));

        const stopped = dispatchRuntimeMessage(harness.getRuntimeListener(), { action: 'STOP_R2_BACKUP' });
        await expect(stopped.response).resolves.toEqual(expect.objectContaining({ status: 'stopped' }));

        expect(background.getCloudSyncQueueForTest().filter((item) => item.type === 'media')).toEqual([]);
        expect(getStoredCompletionRecord(harness.storageState, 'revoked')).toBeTruthy();
        expect(harness.storageState.processedIds).toEqual([]);
    });

    test('waits for download completion when public R2 proof arrives first', async () => {
        installR2PresentFetch(publicUrl);
        const harness = createDurableBackgroundHarness(cloudOnlyStorage());
        await harness.load();
        const suggest = jest.fn();

        expect(harness.getFilenameListener()({ id: 51, url: publicUrl, filename: 'image.jpg' }, suggest)).toBe(true);
        await waitForAssertion(() => expect(suggest).toHaveBeenCalledTimes(1));
        await waitForAssertion(() => expect(
            harness.storageState.pendingDownloadOperations['51'].r2State
        ).toBe('present'));

        expect(harness.storageState.processedIds).toEqual([]);
        expect(harness.chromeApi.downloads.removeFile).not.toHaveBeenCalled();

        harness.downloads.set(51, {
            id: 51,
            url: publicUrl,
            filename: '/Downloads/public.jpg',
            mime: 'image/jpeg',
            state: 'complete'
        });
        await Promise.resolve(harness.getDownloadChangedListener()({ id: 51, state: { current: 'complete' } }));

        await waitForAssertion(() => expect(harness.storageState.processedIds).toEqual([mediaId]));
        expect(harness.chromeApi.downloads.removeFile).toHaveBeenCalledWith(51, expect.any(Function));
        expect(harness.storageState.pendingDownloadOperations).toEqual({});
    });

    test('waits for public R2 proof when download completion arrives first', async () => {
        let resolveSource;
        const sourcePromise = new Promise((resolve) => { resolveSource = resolve; });
        installR2PresentFetch(publicUrl, { sourcePromise });
        const harness = createDurableBackgroundHarness(cloudOnlyStorage());
        await harness.load();
        const suggest = jest.fn();

        expect(harness.getFilenameListener()({ id: 52, url: publicUrl, filename: 'image.jpg' }, suggest)).toBe(true);
        await waitForAssertion(() => expect(suggest).toHaveBeenCalledTimes(1));
        await waitForAssertion(() => expect(harness.storageState.cloudSyncQueue?.[0]).toEqual(expect.objectContaining({
            cleanupDownloadId: 52,
            backupProcessedId: mediaId
        })));
        harness.downloads.set(52, {
            id: 52,
            url: publicUrl,
            filename: '/Downloads/public.jpg',
            mime: 'image/jpeg',
            state: 'complete'
        });
        await Promise.resolve(harness.getDownloadChangedListener()({ id: 52, state: { current: 'complete' } }));

        expect(harness.storageState.processedIds).toEqual([]);
        expect(harness.chromeApi.downloads.removeFile).not.toHaveBeenCalled();

        resolveSource({
            ok: true,
            headers: { get: () => 'image/jpeg' },
            blob: async () => mediaBlob()
        });
        await waitForAssertion(() => expect(harness.storageState.processedIds).toEqual([mediaId]));
        expect(harness.chromeApi.downloads.removeFile).toHaveBeenCalledWith(52, expect.any(Function));
        expect(harness.storageState.pendingDownloadOperations).toEqual({});
    });

    test('preserves public cleanup retry attempts on startup and advances exactly once on alarm', async () => {
        const downloadId = 55;
        const storage = publicRetryStorage(downloadId, 5);
        global.fetch = jest.fn(() => Promise.reject(new Error('[media-fetch] temporary failure')));
        const harness = createDurableBackgroundHarness(storage, {
            [downloadId]: {
                id: downloadId,
                url: publicUrl,
                filename: '/Downloads/public-retry.jpg',
                mime: 'image/jpeg',
                state: 'in_progress'
            }
        });
        const background = await harness.load();

        await background.initializeBackgroundState();

        expect(harness.storageState.cloudSyncQueue).toHaveLength(1);
        expect(harness.storageState.cloudSyncQueue[0]).toEqual(expect.objectContaining({
            cleanupDownloadId: downloadId,
            attempts: 5,
            lastError: storage.cloudSyncQueue[0].lastError
        }));
        expect(global.fetch).not.toHaveBeenCalled();

        harness.getAlarmListener()({ name: 'gptCloudRetry' });
        await waitForAssertion(() => expect(harness.storageState.cloudSyncQueue[0].attempts).toBe(6));

        expect(global.fetch).toHaveBeenCalledTimes(1);
        expect(harness.storageState.cloudSyncQueue).toHaveLength(1);
        expect(harness.storageState.pendingDownloadOperations[String(downloadId)].attempts).toBe(0);
    });

    test('does not retry a capped public cleanup queue through its operation state', async () => {
        const downloadId = 56;
        const storage = publicRetryStorage(downloadId, CloudSyncUtils.MAX_RETRY_ATTEMPTS);
        global.fetch = jest.fn(() => Promise.reject(new Error('[media-fetch] should not run')));
        const harness = createDurableBackgroundHarness(storage, {
            [downloadId]: {
                id: downloadId,
                url: publicUrl,
                filename: '/Downloads/public-capped.jpg',
                mime: 'image/jpeg',
                state: 'in_progress'
            }
        });
        const background = await harness.load();

        await background.initializeBackgroundState();
        harness.chromeApi.alarms.create.mockClear();
        harness.getAlarmListener()({ name: 'gptCloudRetry' });
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(global.fetch).not.toHaveBeenCalled();
        expect(harness.storageState.cloudSyncQueue[0].attempts).toBe(CloudSyncUtils.MAX_RETRY_ATTEMPTS);
        expect(harness.chromeApi.alarms.create).not.toHaveBeenCalled();
    });

    test('preserves legacy public dual-write queue ownership and advances one attempt per alarm', async () => {
        const downloadId = 62;
        const storage = publicDualWriteRetryStorage(downloadId, 5);
        global.fetch = jest.fn(() => Promise.reject(new Error('[media-fetch] temporary failure')));
        const harness = createDurableBackgroundHarness(storage, {
            [downloadId]: {
                id: downloadId,
                url: publicUrl,
                filename: '/Downloads/public-dual-retry.jpg',
                mime: 'image/jpeg',
                state: 'in_progress'
            }
        });
        const background = await harness.load();

        await background.initializeBackgroundState();

        expect(harness.storageState.cloudSyncQueue).toHaveLength(1);
        expect(harness.storageState.cloudSyncQueue[0]).toEqual(expect.objectContaining({
            cleanupDownloadId: downloadId,
            attempts: 5,
            lastError: storage.cloudSyncQueue[0].lastError
        }));
        expect(harness.storageState.pendingDownloadOperations[String(downloadId)].cleanupDownloadId).toBe(downloadId);
        expect(global.fetch).not.toHaveBeenCalled();
        expect(harness.chromeApi.alarms.create).toHaveBeenLastCalledWith('gptCloudRetry', {
            delayInMinutes: CloudSyncUtils.getRetryDelayMinutes(6)
        });

        harness.getAlarmListener()({ name: 'gptCloudRetry' });
        await waitForAssertion(() => expect(harness.storageState.cloudSyncQueue[0].attempts).toBe(6));

        expect(global.fetch).toHaveBeenCalledTimes(1);
        expect(harness.storageState.cloudSyncQueue).toHaveLength(1);
        expect(harness.storageState.pendingDownloadOperations[String(downloadId)].attempts).toBe(0);
    });

    test('does not retry a capped legacy public dual-write queue through operation state', async () => {
        const downloadId = 63;
        const storage = publicDualWriteRetryStorage(downloadId, CloudSyncUtils.MAX_RETRY_ATTEMPTS);
        global.fetch = jest.fn(() => Promise.reject(new Error('[media-fetch] should not run')));
        const harness = createDurableBackgroundHarness(storage, {
            [downloadId]: {
                id: downloadId,
                url: publicUrl,
                filename: '/Downloads/public-dual-capped.jpg',
                mime: 'image/jpeg',
                state: 'in_progress'
            }
        });
        const background = await harness.load();

        await background.initializeBackgroundState();
        expect(harness.chromeApi.alarms.create).not.toHaveBeenCalled();
        harness.getAlarmListener()({ name: 'gptCloudRetry' });
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(global.fetch).not.toHaveBeenCalled();
        expect(harness.storageState.cloudSyncQueue[0]).toEqual(expect.objectContaining({
            cleanupDownloadId: downloadId,
            attempts: CloudSyncUtils.MAX_RETRY_ATTEMPTS,
            lastError: storage.cloudSyncQueue[0].lastError
        }));
        expect(harness.storageState.pendingDownloadOperations[String(downloadId)].cleanupDownloadId).toBe(downloadId);
        expect(harness.chromeApi.alarms.create).not.toHaveBeenCalled();
    });

    test('persists public dual-write identity only after queue success following a reset', async () => {
        const downloadId = 64;
        const storage = cloudOnlyStorage();
        storage.cloudConfig.mode = 'dual_write';
        const harness = createDurableBackgroundHarness(storage);
        await completeFailedPublicDualWriteDownload(harness, downloadId);

        const reset = dispatchRuntimeMessage(harness.getRuntimeListener(), { action: 'PROCESSED_IDS_RESET' });
        await reset.response;
        expect(harness.storageState.processedIds).toEqual([]);
        expect(harness.storageState.pendingDownloadOperations[String(downloadId)]).toEqual(expect.objectContaining({
            r2State: 'pending'
        }));
        expect(harness.storageState.pendingDownloadOperations[String(downloadId)].localIdentityPersisted)
            .not.toBe(true);

        installR2PresentFetch(publicUrl);
        harness.getAlarmListener()({ name: 'gptCloudRetry' });
        await waitForAssertion(() => expect(harness.storageState.processedIds).toEqual([mediaId]));
        await waitForAssertion(() => expect(harness.storageState.cloudSyncQueue).toEqual([]));

        expect(harness.storageState.processedIds).toEqual([mediaId]);
        expect(harness.storageState.pendingDownloadOperations).toEqual({});
        expect(harness.chromeApi.downloads.removeFile).not.toHaveBeenCalled();
    });

    test('retains missing-history public dual-write ownership until R2 success after restart', async () => {
        const downloadId = 65;
        const storage = cloudOnlyStorage();
        storage.cloudConfig.mode = 'dual_write';
        const harness = createDurableBackgroundHarness(storage);
        await completeFailedPublicDualWriteDownload(harness, downloadId);

        const reset = dispatchRuntimeMessage(harness.getRuntimeListener(), { action: 'PROCESSED_IDS_RESET' });
        await reset.response;
        harness.downloads.delete(downloadId);
        installR2PresentFetch(publicUrl);

        const restarted = await harness.load();
        await restarted.ensureBackgroundStateReady();
        expect(harness.storageState.pendingDownloadOperations[String(downloadId)]).toEqual(expect.objectContaining({
            cleanupDownloadId: downloadId,
            downloadState: 'complete',
            r2State: 'pending'
        }));
        expect(harness.storageState.pendingDownloadOperations[String(downloadId)].localIdentityPersisted)
            .not.toBe(true);
        expect(harness.storageState.processedIds).toEqual([]);
        expect(global.fetch).not.toHaveBeenCalled();

        harness.getAlarmListener()({ name: 'gptCloudRetry' });
        await waitForAssertion(() => expect(harness.storageState.processedIds).toEqual([mediaId]));
        await waitForAssertion(() => expect(harness.storageState.cloudSyncQueue).toEqual([]));

        expect(harness.storageState.processedIds).toEqual([mediaId]);
        expect(harness.storageState.pendingDownloadOperations).toEqual({});
        expect(harness.chromeApi.downloads.removeFile).not.toHaveBeenCalled();
    });

    test('retains failed authenticated cloud-only work and retries it after restart', async () => {
        const rawFailure = `object test/v1/users/private/${mediaId}.jpg source=${authUrl} prompt=private words`;
        global.fetch = jest.fn(async (url) => {
            if (String(url).endsWith('/v1/objects/verify')) {
                return { ok: false, status: 500, text: async () => rawFailure };
            }
            throw new Error(`Unexpected test fetch: ${String(url)}`);
        });
        const harness = createDurableBackgroundHarness(cloudOnlyStorage());
        harness.chromeApi.runtime.sendMessage.mockImplementation(async (message) => {
            if (message.action === 'READ_FILE_FOR_UPLOAD') {
                return {
                    ok: true,
                    base64: Buffer.from([1, 2, 3, 4]).toString('base64'),
                    type: 'image/jpeg',
                    size: 4
                };
            }
            return undefined;
        });
        await harness.load();
        const suggest = jest.fn();
        expect(harness.getFilenameListener()({ id: 53, url: authUrl, filename: 'image.jpg' }, suggest)).toBe(true);
        await waitForAssertion(() => expect(suggest).toHaveBeenCalledTimes(1));
        harness.downloads.set(53, {
            id: 53,
            url: authUrl,
            filename: '/Downloads/auth.jpg',
            mime: 'image/jpeg',
            state: 'complete'
        });

        await Promise.resolve(harness.getDownloadChangedListener()({ id: 53, state: { current: 'complete' } }));
        await waitForAssertion(() => expect(
            harness.storageState.pendingDownloadOperations['53'].lastError
        ).toEqual(expect.any(String)));

        const persistedError = harness.storageState.pendingDownloadOperations['53'].lastError;
        expect(harness.storageState.processedIds).toEqual([]);
        expect(harness.chromeApi.downloads.removeFile).not.toHaveBeenCalled();
        expect(persistedError).not.toContain(mediaId);
        expect(persistedError).not.toContain(authUrl);
        expect(persistedError).not.toContain('private words');
        expect(persistedError).not.toContain('test/v1/users/private');
        expect(persistedError).toMatch(/stage=[a-z0-9_-]+ code=[a-z0-9_-]+ media=\.\.\.[a-f0-9]{8}/);
        expect(harness.chromeApi.alarms.create).toHaveBeenCalledWith(
            'gptCloudRetry',
            expect.objectContaining({ delayInMinutes: expect.any(Number) })
        );

        installR2PresentFetch(authUrl);
        await harness.load();

        await waitForAssertion(() => expect(harness.storageState.processedIds).toEqual([mediaId]));
        expect(harness.chromeApi.downloads.removeFile).toHaveBeenCalledWith(53, expect.any(Function));
        expect(harness.storageState.pendingDownloadOperations).toEqual({});
    });

    test('dual-write auth failure waits for R2 before persisting identity and never deletes the file', async () => {
        const storage = cloudOnlyStorage();
        storage.cloudConfig.mode = 'dual_write';
        global.fetch = jest.fn(async (url) => {
            if (String(url).endsWith('/v1/objects/verify')) {
                return { ok: false, status: 503, text: async () => `private/${mediaId}.jpg?secret=1` };
            }
            throw new Error(`Unexpected test fetch: ${String(url)}`);
        });
        const harness = createDurableBackgroundHarness(storage);
        harness.chromeApi.runtime.sendMessage.mockImplementation(async (message) => {
            if (message.action === 'READ_FILE_FOR_UPLOAD') {
                return {
                    ok: true,
                    base64: Buffer.from([1, 2, 3, 4]).toString('base64'),
                    type: 'image/jpeg',
                    size: 4
                };
            }
            return undefined;
        });
        await harness.load();
        const suggest = jest.fn();
        expect(harness.getFilenameListener()({ id: 54, url: authUrl, filename: 'image.jpg' }, suggest)).toBe(true);
        await waitForAssertion(() => expect(suggest).toHaveBeenCalledTimes(1));
        harness.downloads.set(54, {
            id: 54,
            url: authUrl,
            filename: '/Downloads/auth-dual.jpg',
            mime: 'image/jpeg',
            state: 'complete'
        });

        await Promise.resolve(harness.getDownloadChangedListener()({ id: 54, state: { current: 'complete' } }));
        await waitForAssertion(() => expect(
            harness.storageState.pendingDownloadOperations['54']?.lastError
        ).toEqual(expect.any(String)));

        expect(harness.storageState.processedIds).toEqual([]);
        expect(harness.chromeApi.downloads.removeFile).not.toHaveBeenCalled();
        expect(harness.storageState.pendingDownloadOperations['54']).toEqual(expect.objectContaining({
            downloadState: 'complete',
            r2State: 'pending'
        }));

        installR2PresentFetch(authUrl);
        harness.getAlarmListener()({ name: 'gptCloudRetry' });
        await waitForAssertion(() => expect(harness.storageState.processedIds).toEqual([mediaId]));

        expect(harness.storageState.pendingDownloadOperations).toEqual({});
        expect(harness.chromeApi.downloads.removeFile).not.toHaveBeenCalled();
    });

    test('does not resurrect a reset dual-write identity during an alarm retry', async () => {
        const downloadId = 57;
        const harness = createDurableBackgroundHarness(dualWritePendingStorage(downloadId), {
            [downloadId]: {
                id: downloadId,
                url: authUrl,
                filename: '/Downloads/auth-dual-alarm.jpg',
                mime: 'image/jpeg',
                state: 'complete'
            }
        });
        installAuthenticatedUploadFailure(harness);
        await harness.load();
        await waitForAssertion(() => expect(
            harness.storageState.pendingDownloadOperations[String(downloadId)].attempts
        ).toBeGreaterThan(1));

        const reset = dispatchRuntimeMessage(harness.getRuntimeListener(), { action: 'PROCESSED_IDS_RESET' });
        await reset.response;
        expect(harness.storageState.processedIds).toEqual([]);
        const attemptsBeforeAlarm = harness.storageState.pendingDownloadOperations[String(downloadId)].attempts;

        harness.getAlarmListener()({ name: 'gptCloudRetry' });
        await waitForAssertion(() => expect(
            harness.storageState.pendingDownloadOperations[String(downloadId)].attempts
        ).toBeGreaterThan(attemptsBeforeAlarm));

        expect(harness.storageState.processedIds).toEqual([]);
        expect(harness.storageState.pendingDownloadOperations[String(downloadId)].localIdentityPersisted).toBe(true);
    });

    test('does not resurrect a reset dual-write identity during startup reconciliation', async () => {
        const downloadId = 58;
        const harness = createDurableBackgroundHarness(dualWritePendingStorage(downloadId), {
            [downloadId]: {
                id: downloadId,
                url: authUrl,
                filename: '/Downloads/auth-dual-restart.jpg',
                mime: 'image/jpeg',
                state: 'complete'
            }
        });
        installAuthenticatedUploadFailure(harness);
        await harness.load();
        await waitForAssertion(() => expect(
            harness.storageState.pendingDownloadOperations[String(downloadId)].attempts
        ).toBeGreaterThan(1));

        const reset = dispatchRuntimeMessage(harness.getRuntimeListener(), { action: 'PROCESSED_IDS_RESET' });
        await reset.response;
        expect(harness.storageState.processedIds).toEqual([]);
        const attemptsBeforeRestart = harness.storageState.pendingDownloadOperations[String(downloadId)].attempts;

        await harness.load();
        await waitForAssertion(() => expect(
            harness.storageState.pendingDownloadOperations[String(downloadId)].attempts
        ).toBeGreaterThan(attemptsBeforeRestart));

        expect(harness.storageState.processedIds).toEqual([]);
        expect(harness.storageState.pendingDownloadOperations[String(downloadId)].localIdentityPersisted).toBe(true);
    });

    test('finalizes an R2-present operation when download history was already erased', async () => {
        const downloadId = 59;
        const harness = createDurableBackgroundHarness(completedCloudOnlyOperation(downloadId));
        const background = await harness.load();

        await background.ensureBackgroundStateReady();

        expect(harness.storageState.processedIds).toEqual([mediaId]);
        expect(harness.storageState.pendingDownloadOperations).toEqual({});
        expect(harness.chromeApi.downloads.removeFile).not.toHaveBeenCalled();
        expect(harness.chromeApi.downloads.erase).not.toHaveBeenCalled();
    });

    test('keeps missing-history R2-pending work retryable without inventing download completion', async () => {
        const downloadId = 61;
        installR2PresentFetch(publicUrl);
        const harness = createDurableBackgroundHarness(publicRetryStorage(downloadId, 0));
        const background = await harness.load();

        await background.ensureBackgroundStateReady();

        expect(harness.storageState.pendingDownloadOperations[String(downloadId)]).toEqual(expect.objectContaining({
            cleanupDownloadId: downloadId,
            downloadState: 'in_progress',
            r2State: 'pending'
        }));
        expect(harness.storageState.cloudSyncQueue[0]).toEqual(expect.objectContaining({
            cleanupDownloadId: downloadId,
            attempts: 0
        }));
        expect(harness.storageState.processedIds).toEqual([]);
        expect(harness.chromeApi.alarms.create).toHaveBeenCalledWith(
            'gptCloudRetry',
            expect.objectContaining({ delayInMinutes: expect.any(Number) })
        );

        harness.getAlarmListener()({ name: 'gptCloudRetry' });
        await waitForAssertion(() => expect(harness.storageState.cloudSyncQueue).toEqual([]));

        expect(harness.storageState.processedIds).toEqual([]);
        expect(harness.storageState.pendingDownloadOperations[String(downloadId)]).toEqual(expect.objectContaining({
            downloadState: 'in_progress',
            r2State: 'present'
        }));
    });

    test('continues cleanup when file bytes were removed before worker restart', async () => {
        const downloadId = 60;
        const harness = createDurableBackgroundHarness(completedCloudOnlyOperation(downloadId), {
            [downloadId]: {
                id: downloadId,
                url: publicUrl,
                filename: '/Downloads/already-removed.jpg',
                mime: 'image/jpeg',
                state: 'complete',
                exists: false
            }
        });
        harness.chromeApi.downloads.removeFile.mockImplementation((id, callback) => {
            harness.chromeApi.runtime.lastError = { message: 'File not found' };
            callback();
            delete harness.chromeApi.runtime.lastError;
        });
        harness.chromeApi.downloads.erase.mockImplementation((query, callback) => {
            harness.downloads.delete(query.id);
            harness.chromeApi.runtime.lastError = { message: 'Invalid download id' };
            callback();
            delete harness.chromeApi.runtime.lastError;
        });
        const background = await harness.load();

        await background.ensureBackgroundStateReady();

        expect(harness.chromeApi.downloads.removeFile).toHaveBeenCalledWith(downloadId, expect.any(Function));
        expect(harness.chromeApi.downloads.erase).toHaveBeenCalledWith({ id: downloadId }, expect.any(Function));
        expect(harness.downloads.has(downloadId)).toBe(false);
        expect(harness.storageState.processedIds).toEqual([mediaId]);
        expect(harness.storageState.pendingDownloadOperations).toEqual({});
    });

    test('redacts media failures returned through the runtime UI boundary', async () => {
        const rawFailure = `key=test/v1/private/${mediaId}.jpg source=${authUrl} prompt=private words`;
        global.fetch = jest.fn(async (url) => {
            if (String(url).startsWith('data:image/')) {
                return { blob: async () => new NodeBlob([new Uint8Array([1, 2, 3, 4])], { type: 'image/jpeg' }) };
            }
            if (String(url).endsWith('/v1/objects/verify')) {
                return { ok: false, status: 500, text: async () => rawFailure };
            }
            throw new Error(`Unexpected test fetch: ${String(url)}`);
        });
        const lease = {
            version: 1,
            epoch: 4,
            token: 'backup-redaction-run',
            tabId: 42,
            kind: 'r2_backup',
            status: 'active',
            startedAt: 1234
        };
        const harness = createDurableBackgroundHarness({
            ...cloudOnlyStorage(),
            scraperState: 'running',
            scrapeRunToken: lease.token,
            scrapeRunEpoch: lease.epoch,
            isScraping: true,
            isR2Backup: true
        }, {}, { activeScrapeRunToken: lease });
        await harness.load();

        const dispatched = dispatchRuntimeMessage(harness.getRuntimeListener(), {
            action: 'R2_BACKUP_UPLOAD',
            runToken: lease.token,
            runEpoch: lease.epoch,
            kind: lease.kind,
            url: authUrl,
            isVideo: false,
            promptText: 'private words',
            blobDataUrl: 'data:image/jpeg;base64,AQIDBA=='
        }, { tab: { id: lease.tabId } });

        expect(dispatched.returnValue).toBe(true);
        const response = await dispatched.response;
        expect(response.status).toBe('error');
        expect(response.error).toMatch(/stage=presign code=direct_upload_failed media=\.\.\.[a-f0-9]{8}/);
        expect(response.error).not.toContain(mediaId);
        expect(response.error).not.toContain(authUrl);
        expect(response.error).not.toContain('private words');
        expect(response.error).not.toContain('test/v1/private');
    });
});

describe('backup and queue logging safety', () => {
    test('does not log raw media URLs, prompts, or object keys in reviewed paths', () => {
        const contentSource = fs.readFileSync(path.join(__dirname, '../../content.js'), 'utf8');
        const backgroundSource = fs.readFileSync(path.join(__dirname, '../../background.js'), 'utf8');
        const taggedBackupLogs = contentSource.split('\n')
            .filter((line) => line.includes('[BackupUpload]'))
            .join('\n');
        const taggedQueueLogs = backgroundSource.split('\n')
            .filter((line) => line.includes('[CloudQueue]'))
            .join('\n');

        expect(taggedBackupLogs).not.toMatch(/Prompt:|promptText|src\.slice|src:/);
        expect(contentSource).not.toContain('...${src.slice(-20)}');
        expect(taggedQueueLogs).not.toMatch(/sourceUrl|objectKey|finalPath|e\.message|sidecarKey/);
        expect(backgroundSource).not.toMatch(/\blog\(`[^`\n]*\$\{(?:descriptor|result|item)\.objectKey/);
        expect(backgroundSource).not.toContain('Skipping Duplicate: ${parsed.uuid}');
        expect(backgroundSource).not.toContain('item.lastError = e.message');
    });

    test('keeps processedIds writes behind the one background serializer', () => {
        const contentSource = fs.readFileSync(path.join(__dirname, '../../content.js'), 'utf8');
        const popupSource = fs.readFileSync(path.join(__dirname, '../../popup.js'), 'utf8');
        const backgroundSource = fs.readFileSync(path.join(__dirname, '../../background.js'), 'utf8');

        expect(contentSource).not.toMatch(/safeChromeStorageSet\([^\n]*processedIds/);
        expect(popupSource).not.toMatch(/chrome\.storage\.local\.set\(\{\s*processedIds/);
        expect(contentSource).toContain("action: 'PROCESSED_IDS_ADD'");
        expect(contentSource).toContain("action: 'PROCESSED_IDS_RESET'");
        expect(popupSource).toContain("action: 'PROCESSED_IDS_RESET'");
        expect(contentSource).not.toContain('mergeBackupProcessedIdsForStorage');

        const directBackgroundWrites = backgroundSource.match(
            /chrome\.storage\.local\.set\(\{\s*\[PROCESSED_IDS_KEY\]/g
        ) || [];
        expect(directBackgroundWrites).toHaveLength(1);
    });
});

describe('Grok backup scan exhaustion', () => {
    test('does not exhaust while the gallery scroll position is still advancing', () => {
        const result = resolveBackupScrollAttempt({
            before: { scrollTop: 100, scrollHeight: 2000, clientHeight: 500 },
            after: { scrollTop: 600, scrollHeight: 2000, clientHeight: 500 },
            beforeSignature: 'same-cards',
            afterSignature: 'same-cards',
            staleRetries: 99,
            maxStaleRetries: 100
        });

        expect(result.exhausted).toBe(false);
        expect(result.nextStaleRetries).toBe(0);
    });

    test('does not exhaust at the bottom when newly loaded card identities changed', () => {
        const result = resolveBackupScrollAttempt({
            before: { scrollTop: 1500, scrollHeight: 2000, clientHeight: 500 },
            after: { scrollTop: 1500, scrollHeight: 2000, clientHeight: 500 },
            beforeSignature: 'old-cards',
            afterSignature: 'new-cards',
            staleRetries: 99,
            maxStaleRetries: 100
        });

        expect(result.exhausted).toBe(false);
        expect(result.nextStaleRetries).toBe(0);
    });

    test('exhausts only after repeated stable no-new scans at the gallery bottom', () => {
        const result = resolveBackupScrollAttempt({
            before: { scrollTop: 1500, scrollHeight: 2000, clientHeight: 500 },
            after: { scrollTop: 1500, scrollHeight: 2000, clientHeight: 500 },
            beforeSignature: 'same-cards',
            afterSignature: 'same-cards',
            staleRetries: 99,
            maxStaleRetries: 100
        });

        expect(result.exhausted).toBe(true);
        expect(result.nextStaleRetries).toBe(100);
    });
});

describe('Grok backup upload stats', () => {
    test('tracks uploaded, already-present, and queued statuses separately', () => {
        const stats = { uploaded: 0, alreadyPresent: 0, queued: 0, errors: 0 };

        expect(recordBackupUploadStatus(stats, 'uploaded')).toBe(true);
        expect(recordBackupUploadStatus(stats, 'already_present')).toBe(true);
        expect(recordBackupUploadStatus(stats, 'queued')).toBe(true);

        expect(stats).toEqual({
            uploaded: 1,
            alreadyPresent: 1,
            queued: 1,
            errors: 0
        });
    });

    test('persists processed IDs only after R2 presence is durable', () => {
        expect(shouldPersistBackupProcessedId('uploaded')).toBe(true);
        expect(shouldPersistBackupProcessedId('already_present')).toBe(true);
        expect(shouldPersistBackupProcessedId('conflict_uploaded')).toBe(true);
        expect(shouldPersistBackupProcessedId('queued')).toBe(false);
        expect(shouldPersistBackupProcessedId('cloud_queued')).toBe(false);
    });

    test('completes canary only after the first R2-present media status', () => {
        const canaryOptions = { mode: 'canary', limit: 1 };
        const conflictStats = { uploaded: 0, alreadyPresent: 0, queued: 0, errors: 0 };
        recordBackupUploadStatus(conflictStats, 'conflict_uploaded');

        expect(getR2BackupCanaryStopReason(canaryOptions, { uploaded: 1, alreadyPresent: 0, queued: 0 })).toBe('canary_complete');
        expect(getR2BackupCanaryStopReason(canaryOptions, { uploaded: 0, alreadyPresent: 1, queued: 0 })).toBe('canary_complete');
        expect(getR2BackupCanaryStopReason(canaryOptions, conflictStats)).toBe('canary_complete');
        expect(getR2BackupCanaryStopReason({ mode: 'full', limit: null }, { uploaded: 1, alreadyPresent: 0, queued: 0 })).toBeNull();
    });

    test('stops canary as incomplete after one queued or failed media attempt', () => {
        const canaryOptions = { mode: 'canary', limit: 1 };

        expect(getR2BackupCanaryStopReason(canaryOptions, { uploaded: 0, alreadyPresent: 0, queued: 1, errors: 0 })).toBe('canary_incomplete');
        expect(getR2BackupCanaryStopReason(canaryOptions, { uploaded: 0, alreadyPresent: 0, queued: 0, errors: 1 })).toBe('canary_incomplete');
        expect(getR2BackupCanaryStopReason(canaryOptions, { uploaded: 0, alreadyPresent: 0, queued: 0, errors: 0 })).toBeNull();
    });
});

describe('Grok backup canary flow', () => {
    afterEach(() => {
        delete global.chrome;
        document.body.textContent = '';
    });

    test('builds hard-capped canary options for page-origin canary commands', () => {
        expect(getR2BackupPageCommandOptions({ action: 'INIT_R2_CANARY' })).toEqual({
            mode: 'canary',
            limit: 1,
            options: { stopAfterMediaAttempt: true }
        });

        expect(getR2BackupPageCommandOptions({
            action: 'INIT_R2_BACKUP',
            mode: 'canary',
            limit: 999,
            options: { source: 'test' }
        })).toEqual({
            mode: 'canary',
            limit: 1,
            options: { source: 'test', stopAfterMediaAttempt: true }
        });
    });

    test('rejects page-origin full backup commands', () => {
        expect(getR2BackupPageCommandOptions(null)).toBeNull();
        expect(getR2BackupPageCommandOptions({})).toBeNull();
        expect(getR2BackupPageCommandOptions({ action: 'INIT_R2_BACKUP' })).toBeNull();
        expect(getR2BackupPageCommandOptions({ action: 'INIT_R2_BACKUP', mode: 'full' })).toBeNull();
    });

    test('does not start backup from unsafe page-origin full backup commands', () => {
        const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
        const scraper = Object.create(GrokScraper.prototype);
        scraper.startBackupMode = jest.fn();
        scraper.stopBackupMode = jest.fn();
        scraper.start = jest.fn();
        scraper.stop = jest.fn();
        scraper.processedIds = new Set(['existing-id']);

        scraper.handlePageCommand({ action: 'INIT_R2_BACKUP' });
        scraper.handlePageCommand({ action: 'INIT_R2_BACKUP', mode: 'full' });

        expect(scraper.startBackupMode).not.toHaveBeenCalled();
        expect(scraper.stopBackupMode).not.toHaveBeenCalled();
        expect(scraper.start).not.toHaveBeenCalled();
        expect(scraper.stop).not.toHaveBeenCalled();
        expect(scraper.processedIds).toEqual(new Set(['existing-id']));
        expect(warnSpy).toHaveBeenCalledTimes(2);
        warnSpy.mockRestore();
    });

    test('does not start duplicate R2 backup while config validation is pending', async () => {
        let resolveValidation;
        const validationPromise = new Promise((resolve) => {
            resolveValidation = resolve;
        });
        global.chrome = {
            runtime: {
                sendMessage: jest.fn((message, callback) => {
                    if (message.action === 'VALIDATE_CLOUD_CONFIG') {
                        validationPromise.then(callback);
                    } else if (message.action === 'SCRAPE_RUN_STATE_WRITE') {
                        callback({ status: 'ok' });
                    } else if (message.action === 'VALIDATE_SCRAPE_RESUME') {
                        callback({ valid: true, reason: 'active_owner' });
                    }
                    return Promise.resolve();
                })
            },
            storage: {
                local: {
                    set: jest.fn(() => Promise.resolve())
                }
            }
        };
        const scraper = Object.create(GrokScraper.prototype);
        scraper.state = { isRunning: false, currentIndex: 0, mode: 'IDLE' };
        scraper.getCurrentSurface = jest.fn(() => 'saved_gallery');
        scraper.getSavedGalleryScope = jest.fn(() => 'all');
        scraper.log = jest.fn();
        scraper.determineModeAndExecute = jest.fn();

        const firstStart = scraper.startBackupMode({
            mode: 'canary',
            limit: 1,
            runToken: 'run-1',
            runEpoch: 1
        });
        const secondStart = scraper.startBackupMode({
            mode: 'canary',
            limit: 1,
            runToken: 'run-1',
            runEpoch: 1
        });

        expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(1);
        expect(scraper.log).toHaveBeenCalledWith('R2 Backup already running or starting.', 'warning');

        resolveValidation({ valid: true });
        await firstStart;
        await secondStart;

        expect(chrome.storage.local.set).not.toHaveBeenCalled();
        expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
            action: 'SCRAPE_RUN_STATE_WRITE',
            runToken: 'run-1',
            runEpoch: 1,
            kind: 'r2_backup'
        }), expect.any(Function));
        expect(scraper.determineModeAndExecute).toHaveBeenCalledTimes(1);
        expect(scraper.state.isRunning).toBe(true);
    });

    test('Stop during deferred R2 INIT prevents the pending lease from starting', async () => {
        let resolveValidation;
        const validationPromise = new Promise((resolve) => {
            resolveValidation = resolve;
        });
        global.chrome = {
            runtime: {
                sendMessage: jest.fn((message, callback) => {
                    if (message.action === 'VALIDATE_CLOUD_CONFIG') validationPromise.then(callback);
                    return Promise.resolve();
                })
            },
            storage: {
                local: {
                    set: jest.fn(() => Promise.resolve())
                }
            }
        };
        const scraper = Object.create(GrokScraper.prototype);
        scraper.state = { isRunning: false, currentIndex: 0, mode: 'IDLE' };
        scraper.backupOptions = { mode: 'full', limit: null, options: {} };
        scraper.backupStats = { totalSeen: 0, uploaded: 0, alreadyPresent: 0, queued: 0, errors: 0 };
        scraper.getCurrentSurface = jest.fn(() => 'saved_gallery');
        scraper.getSavedGalleryScope = jest.fn(() => 'all');
        scraper.log = jest.fn();
        scraper.determineModeAndExecute = jest.fn();

        const start = scraper.startBackupMode({
            mode: 'full',
            runToken: 'pending-backup',
            runEpoch: 9
        });
        await Promise.resolve();
        const stop = scraper.stopBackupMode('stopped', {
            notifyBackground: false,
            expectedRunToken: 'pending-backup',
            expectedRunEpoch: 9
        });

        await expect(stop).resolves.toEqual({ status: 'stopped' });
        resolveValidation({ valid: true });
        await expect(start).resolves.toEqual({
            status: 'error',
            surface: 'saved_gallery',
            error: 'Start was cancelled.'
        });
        expect(scraper.determineModeAndExecute).not.toHaveBeenCalled();
        expect(scraper.state.isRunning).toBe(false);
        expect(chrome.storage.local.set).not.toHaveBeenCalled();
        expect(chrome.runtime.sendMessage).not.toHaveBeenCalledWith(
            expect.objectContaining({ action: 'SCRAPE_RUN_STATE_WRITE' }),
            expect.any(Function)
        );
    });

    test('starts hard-capped canary from page-origin canary command', () => {
        global.chrome = {
            runtime: {
                id: 'extension-id',
                sendMessage: jest.fn(() => Promise.resolve())
            }
        };
        const scraper = Object.create(GrokScraper.prototype);
        scraper.startBackupMode = jest.fn();

        scraper.handlePageCommand({ action: 'INIT_R2_CANARY' });

        expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
            action: 'START_R2_BACKUP',
            mode: 'canary',
            limit: 1,
            options: { stopAfterMediaAttempt: true }
        });
    });

    test('returns to Saved before completing one successful legacy canary media attempt', async () => {
        global.chrome = {
            runtime: {
                sendMessage: jest.fn(() => Promise.resolve())
            },
            storage: {
                local: {
                    get: jest.fn(() => Promise.resolve({ currentItemId: 'media-clean-id' })),
                    set: jest.fn(() => Promise.resolve())
                }
            }
        };
        const scraper = Object.create(GrokScraper.prototype);
        scraper.state = { isRunning: true, currentIndex: 0, mode: 'DETAIL' };
        scraper.runToken = 'run-1';
        scraper.runEpoch = 1;
        scraper.backupMode = true;
        scraper.backupOptions = { mode: 'canary', limit: 1, options: { stopAfterMediaAttempt: true } };
        scraper.backupStats = { totalSeen: 0, uploaded: 0, alreadyPresent: 0, queued: 0, errors: 0 };
        scraper.processedIds = new Set();
        scraper._backupVisited = new Set();
        scraper.Config = { actionWait: 0, navWait: 0 };
        scraper.sleep = jest.fn(() => Promise.resolve());
        const media = document.createElement('img');
        scraper.waitForMatchingLegacyDetailMedia = jest.fn(async () => media);
        scraper.performDownload = jest.fn(async () => {
            recordBackupUploadStatus(scraper.backupStats, 'uploaded');
        });
        scraper.stopBackupMode = jest.fn(async (stopReason) => {
            scraper.state.isRunning = false;
            scraper.backupMode = false;
            scraper.stopReason = stopReason;
        });
        scraper.returnToSavedGallery = jest.fn(async () => {});
        scraper.waitForSelector = jest.fn();
        scraper.determineModeAndExecute = jest.fn();

        await scraper.executeDetailView();

        expect(scraper.backupStats.totalSeen).toBe(1);
        expect(scraper.performDownload).toHaveBeenCalledWith(media, 'media-clean-id', 'run-1');
        expect(scraper.returnToSavedGallery).toHaveBeenCalledWith('run-1', {
            stopBackupReason: 'canary_complete'
        });
        expect(scraper.stopBackupMode).not.toHaveBeenCalled();
        expect(scraper.waitForSelector).not.toHaveBeenCalled();
        expect(scraper.determineModeAndExecute).not.toHaveBeenCalled();
    });
});

describe('Grok backup acceptance context propagation', () => {
    test('page command options preserve acceptance run metadata for canaries', () => {
        const options = getR2BackupPageCommandOptions({
            action: 'INIT_R2_CANARY',
            runId: 'run-20260609-001',
            correlationId: 'corr-1',
            keyPrefix: 'acceptance/run-20260609-001'
        });

        expect(options).toMatchObject({
            mode: 'canary',
            limit: 1,
            acceptance: {
                runId: 'run-20260609-001',
                correlationId: 'corr-1',
                keyPrefix: 'acceptance/run-20260609-001'
            }
        });
    });

    test('page command ignores acceptance metadata for full backup commands', () => {
        expect(getR2BackupPageCommandOptions({
            action: 'INIT_R2_BACKUP',
            mode: 'full',
            runId: 'run-20260609-001',
            correlationId: 'corr-1',
            keyPrefix: 'acceptance/run-20260609-001'
        })).toBeNull();
    });
});

describe('Grok backup popup status text', () => {
    test('labels scan-limit stops as paused instead of complete', () => {
        expect(getR2BackupDoneStatusLabel({ stopReason: 'scan_limit' })).toBe('Paused');
    });

    test('shows uploaded, already-present, queued, and error counts separately', () => {
        expect(formatR2BackupDetails({
            uploaded: 2,
            alreadyPresent: 3,
            queued: 4,
            pendingTransfers: 0,
            errors: 1
        })).toBe('2 uploaded / 3 already present / 4 queued total / 0 pending / 1 errors');
        expect(formatR2BackupDetails({ queued: 4 })).toContain('unknown pending');
    });

    test('labels only a durable canary completion distinctly', () => {
        expect(getR2BackupDoneStatusLabel({
            stopReason: 'canary_complete',
            pendingTransfers: 0,
            errors: 0
        })).toBe('Canary complete');
        expect(getR2BackupDoneStatusLabel({ stopReason: 'canary_complete' })).toBe('Incomplete');
    });

    test('keeps non-complete canary reasons out of the Complete state', () => {
        expect(getR2BackupDoneStatusLabel({ stopReason: 'canary_incomplete' })).toBe('Stopped');
    });
});
