const {
    mergeBackupProcessedIdsForStorage,
    recordBackupUploadStatus,
    resolveBackupScrollAttempt,
    getR2BackupCanaryStopReason,
    GrokScraper,
    selectBackupMediaElement,
    shouldPersistBackupProcessedId
} = require('../../content.js');
const {
    formatR2BackupDetails,
    getR2BackupDoneStatusLabel
} = require('../../popup.js');

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
        const { buildDirectBackupUploadResponse } = loadBackgroundForTest();
        const result = {
            status: 'uploaded',
            objectKey: 'grok/users/user-1/media.mp4',
            assetId: 'asset-1'
        };
        const sourceUrl = 'https://assets.grok.com/videos/11111111-2222-4333-8444-555555555555/generated_video.mp4';

        expect(buildDirectBackupUploadResponse(result, sourceUrl)).toEqual({
            status: 'uploaded',
            objectKey: 'grok/users/user-1/media.mp4',
            assetId: 'asset-1',
            backupProcessedId: '11111111-2222-4333-8444-555555555555'
        });
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

    test('treats canary completion as a successful R2 backup completion', () => {
        const {
            getR2BackupCompletionStatusLabel,
            isR2BackupCompletionSuccessful
        } = loadBackgroundForTest();

        expect(isR2BackupCompletionSuccessful({ stopReason: 'canary_complete' })).toBe(true);
        expect(getR2BackupCompletionStatusLabel({ stopReason: 'canary_complete' })).toBe('canary complete');
        expect(isR2BackupCompletionSuccessful({ stopReason: 'canary_incomplete' })).toBe(false);
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

    test('does not persist processed IDs for queued uploads before R2 success is proven', () => {
        expect(shouldPersistBackupProcessedId('uploaded')).toBe(true);
        expect(shouldPersistBackupProcessedId('already_present')).toBe(true);
        expect(shouldPersistBackupProcessedId('conflict_uploaded')).toBe(true);
        expect(shouldPersistBackupProcessedId('queued')).toBe(false);
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

    test('stops before navigating back after one successful canary media attempt', async () => {
        global.chrome = {
            runtime: {
                sendMessage: jest.fn(() => Promise.resolve())
            },
            storage: {
                local: {
                    get: jest.fn(() => Promise.resolve({ currentItemId: 'media-clean-id' }))
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
