const {
    mergeBackupProcessedIdsForStorage,
    recordBackupUploadStatus,
    resolveBackupScrollAttempt,
    getR2BackupCanaryStopReason,
    getR2BackupPageCommandOptions,
    GrokScraper,
    selectBackupMediaElement,
    shouldPersistBackupProcessedId
} = require('../../content.js');
const {
    formatR2BackupDetails,
    getR2BackupDoneStatusLabel
} = require('../../popup.js');
const CloudSyncUtils = require('../../cloudSyncUtils.js');
const fs = require('fs');
const path = require('path');

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
        chrome.storage.local.get.mockResolvedValue({ processedIds: ['direct-clean-id'] });
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
                uploadMediaQueueItem: jest.fn().mockRejectedValue(new Error('[media-fetch] unavailable'))
            }
        )).resolves.toBe(true);

        expect(background.getProcessedUUIDsForTest()).toEqual([]);
        expect(background.getCloudSyncQueueForTest()).toHaveLength(1);
        expect(background.getCloudSyncQueueForTest()[0].backupProcessedId).toBe(mediaId);
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

        expect(isR2BackupCompletionSuccessful({ stopReason: 'canary_complete' })).toBe(true);
        expect(getR2BackupCompletionStatusLabel({ stopReason: 'canary_complete' })).toBe('canary complete');
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

describe('native download processed ID lifecycle', () => {
    const accountId = '11111111-1111-4111-8111-111111111111';
    const mediaId = '22222222-2222-4222-8222-222222222222';
    const queryId = '33333333-3333-4333-8333-333333333333';
    const mediaUrl = `https://assets.grok.com/users/${accountId}/generated/${mediaId}/image.jpg?request=${queryId}`;

    function configureDownloadStorage() {
        chrome.storage.local.get.mockImplementation(async (keys) => {
            if (Array.isArray(keys) && keys.includes('processedIds')) return { processedIds: [] };
            if (Array.isArray(keys) && keys.includes('downloadPath')) {
                return { downloadPath: 'GrokVault', activeGrokUserId: 'user-1' };
            }
            if (Array.isArray(keys) && keys.includes('cloudConfig')) {
                return { cloudConfig: { mode: 'local_only' } };
            }
            return {};
        });
    }

    afterEach(() => {
        delete global.chrome;
        jest.resetModules();
    });

    test('reserves an accepted stable media download without persisting before completion', async () => {
        const background = loadBackgroundForTest();
        configureDownloadStorage();
        background.setProcessedUUIDsForTest([]);
        const suggest = jest.fn();

        await background.handleDownloadFilename({ id: 41, url: mediaUrl, filename: 'image.jpg' }, suggest);

        expect(suggest).toHaveBeenCalledWith(expect.objectContaining({ conflictAction: 'overwrite' }));
        expect(background.getPendingDownloadIdentitiesForTest()).toEqual([[41, mediaId]]);
        expect(background.getProcessedUUIDsForTest()).toEqual([]);
        expect(chrome.storage.local.set).not.toHaveBeenCalledWith(expect.objectContaining({
            processedIds: expect.any(Array)
        }));
    });

    test('persists exactly the stable media ID when the download completes', async () => {
        const background = loadBackgroundForTest();
        configureDownloadStorage();
        background.setProcessedUUIDsForTest([]);

        await background.handleDownloadFilename({ id: 42, url: mediaUrl, filename: 'image.jpg' }, jest.fn());
        await background.handleDownloadChanged({ id: 42, state: { current: 'complete' } });

        expect(background.getPendingDownloadIdentitiesForTest()).toEqual([]);
        expect(background.getProcessedUUIDsForTest()).toEqual([mediaId]);
        expect(chrome.storage.local.set).toHaveBeenCalledWith({ processedIds: [mediaId] });
    });

    test('releases an interrupted download without persisting it', async () => {
        const background = loadBackgroundForTest();
        configureDownloadStorage();
        background.setProcessedUUIDsForTest([]);

        await background.handleDownloadFilename({ id: 43, url: mediaUrl, filename: 'image.jpg' }, jest.fn());
        await background.handleDownloadChanged({
            id: 43,
            state: { current: 'interrupted' },
            error: { current: 'USER_CANCELED' }
        });

        expect(background.getPendingDownloadIdentitiesForTest()).toEqual([]);
        expect(background.getProcessedUUIDsForTest()).toEqual([]);
        expect(chrome.storage.local.set).not.toHaveBeenCalledWith(expect.objectContaining({
            processedIds: expect.any(Array)
        }));
    });

    test('rejects a concurrent duplicate reservation without cancelling the first download', async () => {
        const background = loadBackgroundForTest();
        configureDownloadStorage();
        background.setProcessedUUIDsForTest([]);
        const firstSuggest = jest.fn();
        const secondSuggest = jest.fn();

        await background.generateFilename(mediaUrl, 'image.jpg');
        await background.handleDownloadFilename({ id: 44, url: mediaUrl, filename: 'image.jpg' }, firstSuggest);
        await background.handleDownloadFilename({ id: 45, url: mediaUrl, filename: 'image.jpg' }, secondSuggest);

        expect(firstSuggest).toHaveBeenCalledTimes(1);
        expect(secondSuggest).not.toHaveBeenCalled();
        expect(chrome.downloads.cancel).toHaveBeenCalledWith(45);
        expect(chrome.downloads.cancel).not.toHaveBeenCalledWith(44);
        expect(background.getProcessedUUIDsForTest()).toEqual([]);
    });

    test('never treats a query UUID as stable identity when the pathname has none', async () => {
        const background = loadBackgroundForTest();
        configureDownloadStorage();
        background.setProcessedUUIDsForTest([]);
        const queryOnlyUrl = `https://assets.grok.com/generated/image.jpg?request=${queryId}`;
        const suggest = jest.fn();

        await background.handleDownloadFilename({ id: 46, url: queryOnlyUrl, filename: 'image.jpg' }, suggest);
        await background.handleDownloadChanged({ id: 46, state: { current: 'complete' } });

        expect(suggest).toHaveBeenCalledTimes(1);
        expect(background.getPendingDownloadIdentitiesForTest()).toEqual([]);
        expect(background.getProcessedUUIDsForTest()).toEqual([]);
        expect(suggest.mock.calls[0][0].filename).toMatch(/\/url_[a-f0-9]{8}\.jpg$/);
        expect(suggest.mock.calls[0][0].filename).not.toContain(queryId);
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

    test('preserves background-persisted processed IDs when content records backup success', () => {
        const statuses = ['uploaded', 'already_present', 'conflict_uploaded'];

        for (const status of statuses) {
            const inMemoryIds = new Set(['previous-clean-url-id']);
            const existingIds = ['uuid-from-background'];
            const nextId = 'clean-url-id';

            expect(shouldPersistBackupProcessedId(status)).toBe(true);
            expect(mergeBackupProcessedIdsForStorage(existingIds, inMemoryIds, nextId)).toEqual([
                'uuid-from-background',
                'previous-clean-url-id',
                'clean-url-id'
            ]);
        }
    });

    test('merges response backup processed ID with clean URL ID during content persistence', () => {
        expect(mergeBackupProcessedIdsForStorage(
            ['uuid-from-background'],
            new Set(['previous-clean-url-id']),
            'clean-url-id',
            'response-backup-uuid'
        )).toEqual([
            'uuid-from-background',
            'previous-clean-url-id',
            'clean-url-id',
            'response-backup-uuid'
        ]);
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
        scraper.log = jest.fn();
        scraper.determineModeAndExecute = jest.fn();

        const firstStart = scraper.startBackupMode({ mode: 'canary', limit: 1 });
        const secondStart = scraper.startBackupMode({ mode: 'canary', limit: 1 });

        expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(1);
        expect(scraper.log).toHaveBeenCalledWith('R2 Backup already running or starting.', 'warning');

        resolveValidation({ valid: true });
        await firstStart;
        await secondStart;

        expect(chrome.storage.local.set).toHaveBeenCalledTimes(1);
        expect(scraper.determineModeAndExecute).toHaveBeenCalledTimes(1);
        expect(scraper.state.isRunning).toBe(true);
    });

    test('starts hard-capped canary from page-origin canary command', () => {
        const scraper = Object.create(GrokScraper.prototype);
        scraper.startBackupMode = jest.fn();

        scraper.handlePageCommand({ action: 'INIT_R2_CANARY' });

        expect(scraper.startBackupMode).toHaveBeenCalledWith({
            mode: 'canary',
            limit: 1,
            options: { stopAfterMediaAttempt: true }
        });
    });

    test('stops before navigating back after one successful canary media attempt', async () => {
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
        scraper.backupMode = true;
        scraper.backupOptions = { mode: 'canary', limit: 1, options: { stopAfterMediaAttempt: true } };
        scraper.backupStats = { totalSeen: 0, uploaded: 0, alreadyPresent: 0, queued: 0, errors: 0 };
        scraper.processedIds = new Set();
        scraper._backupVisited = new Set();
        scraper.Config = { actionWait: 0, navWait: 0 };
        scraper.sleep = jest.fn(() => Promise.resolve());
        scraper.performDownload = jest.fn(async () => {
            recordBackupUploadStatus(scraper.backupStats, 'uploaded');
        });
        scraper.stopBackupMode = jest.fn(async (stopReason) => {
            scraper.state.isRunning = false;
            scraper.backupMode = false;
            scraper.stopReason = stopReason;
        });
        scraper.waitForSelector = jest.fn();
        scraper.determineModeAndExecute = jest.fn();

        await scraper.executeDetailView();

        expect(scraper.backupStats.totalSeen).toBe(1);
        expect(scraper.performDownload).toHaveBeenCalledTimes(1);
        expect(scraper.stopBackupMode).toHaveBeenCalledWith('canary_complete');
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
            errors: 1
        })).toBe('2 uploaded / 3 already present / 4 queued / 1 errors');
    });

    test('labels canary completion distinctly', () => {
        expect(getR2BackupDoneStatusLabel({ stopReason: 'canary_complete' })).toBe('Canary complete');
    });

    test('labels incomplete canary distinctly', () => {
        expect(getR2BackupDoneStatusLabel({ stopReason: 'canary_incomplete' })).toBe('Canary incomplete');
    });
});
