const {
    SCRAPE_SURFACES,
    SAVED_GALLERY_SCOPES,
    GrokScraper,
    GALLERY_RECEIPT_VERSION,
    captureGalleryReceipt,
    captureSavedViewportReceipt,
    detectSavedGalleryScope,
    detectGrokScrapeSurface,
    evaluateGalleryReceipt,
    findMatchingAgentMedia,
    getSavedGalleryContext,
    getGrokMediaIdentity,
    hasOrderedSavedNeighborhood,
    isSuccessfulMediaTransferStatus,
    normalizeSavedViewportReceipt,
    shouldStopScraperForStorageChanges
} = require('../../content.js');
const CloudSyncUtils = require('../../cloudSyncUtils.js');
const { Blob: NodeBlob } = require('buffer');
const { webcrypto } = require('crypto');

function mockContentChrome() {
    global.chrome = {
        runtime: {
            id: 'extension-id',
            lastError: null,
            sendMessage: jest.fn((message) => Promise.resolve(
                message?.action === 'VALIDATE_SCRAPE_RESUME'
                    ? { valid: true, reason: 'active_owner' }
                    : (message?.action === 'GET_SCRAPE_DURABILITY'
                        ? {
                            status: 'durable',
                            inFlightTasks: 0,
                            pendingDownloads: 0,
                            pendingOperations: 0,
                            pendingQueueItems: 0,
                            failedItems: 0
                        }
                    : (message?.action === 'SCRAPE_RUN_STATE_WRITE'
                        ? { status: 'ok' }
                        : (message?.action === 'SCRAPE_PROCESSED_IDS_ADD'
                            ? { status: 'ok', processedIds: message.ids || [] }
                            : undefined)))
            )),
            onMessage: { addListener: jest.fn() }
        },
        storage: {
            local: {
                get: jest.fn(() => Promise.resolve({})),
                set: jest.fn(() => Promise.resolve())
            },
            onChanged: { addListener: jest.fn() }
        }
    };
}

function createScraper(surface = SCRAPE_SURFACES.savedGallery) {
    const scraper = Object.create(GrokScraper.prototype);
    scraper.state = { isRunning: false, currentIndex: 0, mode: 'IDLE' };
    scraper.backupMode = false;
    scraper.backupOptions = { mode: 'full', limit: null, options: {} };
    scraper.backupStats = {
        totalSeen: 0,
        uploaded: 0,
        alreadyPresent: 0,
        queued: 0,
        pendingTransfers: 0,
        errors: 0
    };
    scraper.processedIds = new Set();
    scraper._backupVisited = new Set();
    scraper._runVisited = new Set();
    scraper.runToken = null;
    scraper.runEpoch = 1;
    scraper._pendingInitLease = null;
    scraper._runInvalidationVersion = 0;
    scraper._runStateWriteQueue = Promise.resolve();
    scraper.Config = { actionWait: 0, navWait: 0, surfaceWait: 50 };
    scraper.getCurrentSurface = jest.fn(() => surface);
    scraper.getSavedGalleryScope = jest.fn(() => SAVED_GALLERY_SCOPES.all);
    scraper.createRunToken = jest.fn(() => 'run-1');
    scraper.determineModeAndExecute = jest.fn();
    scraper.log = jest.fn();
    return scraper;
}

function makeVisible(element, width = 120, height = 32) {
    element.getBoundingClientRect = () => ({
        width,
        height,
        top: 0,
        right: width,
        bottom: height,
        left: 0
    });
    return element;
}

function mountSavedScope(selected = 'all') {
    document.querySelectorAll('[data-test-saved-scope]').forEach((control) => control.remove());
    const toolbar = document.createElement('div');
    const all = makeVisible(document.createElement('button'));
    const liked = makeVisible(document.createElement('button'));
    all.setAttribute('data-test-saved-scope', 'all');
    liked.setAttribute('data-test-saved-scope', 'liked');
    all.textContent = 'All';
    liked.textContent = 'Liked';
    if (selected === 'all') all.className = 'bg-primary text-background hover:bg-primary';
    if (selected === 'liked') liked.className = 'bg-primary text-background hover:bg-primary';
    toolbar.append(all, liked);
    document.body.appendChild(toolbar);
    return { toolbar, all, liked };
}

function mountSemanticSavedImage(sourceUrl, scrollTop = 0) {
    const scroller = document.createElement('div');
    scroller.style.overflowY = 'scroll';
    scroller.scrollTop = scrollTop;
    Object.defineProperties(scroller, {
        scrollHeight: { configurable: true, value: 2400 },
        clientHeight: { configurable: true, value: 800 }
    });
    const list = document.createElement('div');
    list.setAttribute('role', 'list');
    const card = document.createElement('article');
    card.setAttribute('role', 'listitem');
    const image = document.createElement('img');
    image.alt = 'Generated image';
    image.src = sourceUrl;
    card.appendChild(image);
    list.appendChild(card);
    scroller.appendChild(list);
    document.body.appendChild(scroller);
    return { scroller, list, card, image };
}

const FULL_POINTER_ACTIVATION_EVENTS = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'];

function recordPointerActivationEvents(element) {
    const events = [];
    FULL_POINTER_ACTIVATION_EVENTS.forEach((eventName) => {
        element.addEventListener(eventName, () => events.push(eventName));
    });
    return events;
}

describe('Grok scrape surface detection', () => {
    afterEach(() => {
        document.body.textContent = '';
    });

    test('recognizes the Saved gallery independently of legacy card selectors', () => {
        expect(detectGrokScrapeSurface(document, 'https://grok.com/imagine/saved')).toBe(SCRAPE_SURFACES.savedGallery);
    });

    test('keeps Saved authoritative when unrelated download controls are present', () => {
        document.body.innerHTML = '<button aria-label="Download"></button>';

        expect(detectGrokScrapeSurface(document, 'https://grok.com/imagine/saved'))
            .toBe(SCRAPE_SURFACES.savedGallery);
    });

    test('recognizes Agent Mode before its media node has rendered', () => {
        expect(detectGrokScrapeSurface(document, 'https://grok.com/imagine/agent/agent-1?conversation=conversation-1'))
            .toBe(SCRAPE_SURFACES.agentMedia);
    });

    test('recognizes legacy detail pages and rejects unrelated Grok surfaces', () => {
        expect(detectGrokScrapeSurface(document, 'https://grok.com/imagine/post/post-1'))
            .toBe(SCRAPE_SURFACES.legacyDetail);
        expect(detectGrokScrapeSurface(document, 'https://grok.com/imagine'))
            .toBe(SCRAPE_SURFACES.unsupported);
        expect(detectGrokScrapeSurface(document, 'https://grok.com/'))
            .toBe(SCRAPE_SURFACES.unsupported);
    });

    test('rejects unsupported Imagine routes even when incidental download controls exist', () => {
        document.body.innerHTML = `
            <button aria-label="Download"></button>
            <svg class="lucide-download"></svg>
        `;

        expect(detectGrokScrapeSurface(document, 'https://grok.com/imagine'))
            .toBe(SCRAPE_SURFACES.unsupported);
        expect(detectGrokScrapeSurface(document, 'https://grok.com/imagine/liked'))
            .toBe(SCRAPE_SURFACES.unsupported);
        expect(detectGrokScrapeSurface(document, 'https://grok.com/imagine/post/post-1'))
            .toBe(SCRAPE_SURFACES.legacyDetail);
    });
});

describe('Grok Saved gallery scope detection', () => {
    afterEach(() => {
        document.body.textContent = '';
    });

    test.each([
        ['all', SAVED_GALLERY_SCOPES.all],
        ['liked', SAVED_GALLERY_SCOPES.liked],
        ['unknown', SAVED_GALLERY_SCOPES.unknown]
    ])('detects the current first-party %s scope without trusting text alone', (selected, expected) => {
        mountSavedScope(selected);

        expect(detectSavedGalleryScope(document)).toBe(expected);
    });

    test('accepts accessible selected-state semantics and fails closed on hidden or ambiguous controls', () => {
        const { all, liked } = mountSavedScope('unknown');
        all.setAttribute('aria-selected', 'true');
        expect(detectSavedGalleryScope(document)).toBe(SAVED_GALLERY_SCOPES.all);

        liked.setAttribute('aria-pressed', 'true');
        expect(detectSavedGalleryScope(document)).toBe(SAVED_GALLERY_SCOPES.unknown);

        liked.setAttribute('aria-pressed', 'false');
        all.hidden = true;
        expect(detectSavedGalleryScope(document)).toBe(SAVED_GALLERY_SCOPES.unknown);
    });
});

describe('Grok media identity', () => {
    test('uses the generated media UUID instead of the account UUID', () => {
        const accountId = '11111111-1111-4111-8111-111111111111';
        const firstAssetId = '22222222-2222-4222-8222-222222222222';
        const secondAssetId = '33333333-3333-4333-8333-333333333333';
        const firstSavedUrl = `https://assets.grok.com/users/${accountId}/generated/${firstAssetId}/image.jpg?cache=1`;
        const firstAgentUrl = `https://assets.grok.com/users/${accountId}/generated/${firstAssetId}/preview_image.jpg?cache=2`;
        const secondAgentUrl = `https://assets.grok.com/users/${accountId}/generated/${secondAssetId}/preview_image.jpg`;

        expect(getGrokMediaIdentity(firstSavedUrl)).toBe(firstAssetId);
        expect(getGrokMediaIdentity(firstAgentUrl)).toBe(firstAssetId);
        expect(getGrokMediaIdentity(secondAgentUrl)).toBe(secondAssetId);
        expect(getGrokMediaIdentity(firstAgentUrl)).not.toBe(getGrokMediaIdentity(secondAgentUrl));
    });

    test('ignores query and hash UUIDs, preserves bare and legacy UUIDs, and normalizes UUID-free paths', () => {
        const accountId = '11111111-1111-4111-8111-111111111111';
        const firstAssetId = '22222222-2222-4222-8222-222222222222';

        expect(getGrokMediaIdentity(
            `https://assets.grok.com/users/${accountId}/generated/${firstAssetId}/image.jpg?media=33333333-3333-4333-8333-333333333333#cache=44444444-4444-4444-8444-444444444444`
        )).toBe(firstAssetId);
        expect(getGrokMediaIdentity(firstAssetId)).toBe(firstAssetId);
        expect(getGrokMediaIdentity(`https://assets.grok.com/users/u/${firstAssetId}/content`)).toBe(firstAssetId);
        expect(getGrokMediaIdentity(
            'https://assets.grok.com/generated/image.jpg?media=33333333-3333-4333-8333-333333333333#cache=44444444-4444-4444-8444-444444444444'
        )).toBe('https://assets.grok.com/generated/image.jpg');
        expect(getGrokMediaIdentity('   ')).toBe('');
    });

    test('matches the authoritative CloudSync helper for stable Grok identities', () => {
        const accountId = '11111111-1111-4111-8111-111111111111';
        const mediaId = '22222222-2222-4222-8222-222222222222';
        const queryId = '33333333-3333-4333-8333-333333333333';
        const values = [
            mediaId,
            `https://assets.grok.com/users/${accountId}/generated/${mediaId}/image.jpg?request=${queryId}`,
            `https://assets.grok.com/users/${accountId}/legacy/${mediaId}/image.jpg#${queryId}`
        ];

        for (const value of values) {
            expect(getGrokMediaIdentity(value)).toBe(CloudSyncUtils.extractGrokMediaId(value));
        }
    });
});

describe('Grok Agent Mode media matching', () => {
    afterEach(() => {
        document.body.textContent = '';
    });

    test('matches the exact pending gallery asset inside a React Flow asset node', () => {
        const expected = '73e5e137-1334-49ea-b06b-a9d9ba891003';
        document.body.innerHTML = `
            <div class="react-flow__node react-flow__node-asset">
                <img id="other" src="https://assets.grok.com/users/u/11111111-2222-4333-8444-555555555555/content">
            </div>
            <div class="react-flow__node react-flow__node-asset">
                <img id="expected" src="https://assets.grok.com/users/u/${expected}/content?variant=large">
            </div>
        `;

        const result = findMatchingAgentMedia(document, expected);

        expect(result.status).toBe('matched');
        expect(result.media).toBe(document.getElementById('expected'));
        expect(getGrokMediaIdentity(result.sourceUrl)).toBe(expected);
    });

    test('fails closed when the pending asset is missing or ambiguous', () => {
        const expected = '73e5e137-1334-49ea-b06b-a9d9ba891003';
        document.body.innerHTML = `
            <div class="react-flow__node-asset"><img src="https://assets.grok.com/${expected}/content"></div>
            <div class="react-flow__node-asset"><video src="https://assets.grok.com/videos/${expected}/generated_video.mp4"></video></div>
        `;

        expect(findMatchingAgentMedia(document, 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee').status).toBe('missing');
        expect(findMatchingAgentMedia(document, expected).status).toBe('ambiguous');
    });

    test('prefers video when one Agent asset node renders both poster and video media', () => {
        const expected = '73e5e137-1334-49ea-b06b-a9d9ba891003';
        document.body.innerHTML = `
            <div class="react-flow__node-asset">
                <img src="https://assets.grok.com/users/u/${expected}/content">
                <video id="video" src="https://assets.grok.com/videos/${expected}/generated_video.mp4"></video>
            </div>
        `;

        const result = findMatchingAgentMedia(document, expected);

        expect(result.status).toBe('matched');
        expect(result.media).toBe(document.getElementById('video'));
    });

    test('matches only the Agent node with the selected generated media UUID', () => {
        const accountId = '11111111-1111-4111-8111-111111111111';
        const firstAssetId = '22222222-2222-4222-8222-222222222222';
        const secondAssetId = '33333333-3333-4333-8333-333333333333';
        const firstSavedUrl = `https://assets.grok.com/users/${accountId}/generated/${firstAssetId}/image.jpg?cache=1`;
        const firstAgentUrl = `https://assets.grok.com/users/${accountId}/generated/${firstAssetId}/preview_image.jpg?cache=2`;
        const secondAgentUrl = `https://assets.grok.com/users/${accountId}/generated/${secondAssetId}/preview_image.jpg`;
        document.body.innerHTML = `
            <div class="react-flow__node-asset"><img id="first" src="${firstAgentUrl}"></div>
            <div class="react-flow__node-asset"><img id="second" src="${secondAgentUrl}"></div>
        `;

        const result = findMatchingAgentMedia(document, firstSavedUrl);

        expect(result.status).toBe('matched');
        expect(result.media).toBe(document.getElementById('first'));
    });

    test('fails closed when two Agent nodes share the same generated media UUID', () => {
        const accountId = '11111111-1111-4111-8111-111111111111';
        const firstAssetId = '22222222-2222-4222-8222-222222222222';
        const firstAgentUrl = `https://assets.grok.com/users/${accountId}/generated/${firstAssetId}/preview_image.jpg?cache=2`;
        document.body.innerHTML = `
            <div class="react-flow__node-asset"><img src="${firstAgentUrl}"></div>
            <div class="react-flow__node-asset"><img src="https://assets.grok.com/users/${accountId}/generated/${firstAssetId}/image.jpg"></div>
        `;

        expect(findMatchingAgentMedia(document, firstAgentUrl).status).toBe('ambiguous');
    });
});

describe('Grok scrape start preflight', () => {
    beforeEach(() => {
        mockContentChrome();
    });

    afterEach(() => {
        delete global.chrome;
        document.body.textContent = '';
    });

    test('fails closed off Saved without changing persistent running state', async () => {
        const scraper = createScraper(SCRAPE_SURFACES.agentMedia);

        const response = await scraper.start();

        expect(response).toEqual({
            status: 'invalid_context',
            surface: SCRAPE_SURFACES.agentMedia,
            error: 'Open Grok Imagine Saved before starting sync.'
        });
        expect(chrome.storage.local.set).not.toHaveBeenCalled();
        expect(scraper.determineModeAndExecute).not.toHaveBeenCalled();
    });

    test('persists a run token and starts only after Saved preflight succeeds', async () => {
        const scraper = createScraper();

        const response = await scraper.start({ runToken: 'run-1', runEpoch: 1 });

        expect(response).toEqual({
            status: 'started',
            surface: SCRAPE_SURFACES.savedGallery,
            runToken: 'run-1',
            runEpoch: 1
        });
        expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
            action: 'SCRAPE_RUN_STATE_WRITE',
            runToken: 'run-1',
            runEpoch: 1,
            kind: 'sync',
            values: expect.objectContaining({ currentIndex: 0, scrapeNavigation: null })
        }));
        expect(chrome.storage.local.set).not.toHaveBeenCalled();
        expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
            action: 'VALIDATE_SCRAPE_RESUME',
            runToken: 'run-1',
            runEpoch: 1,
            kind: 'sync'
        });
        expect(scraper.state.isRunning).toBe(true);
        expect(scraper.determineModeAndExecute).toHaveBeenCalledWith('run-1', 1);
    });

    test.each([
        ['Sync', false],
        ['R2 backup', true]
    ])('%s fails closed when Saved scope drifts while start state is being persisted', async (_label, backup) => {
        const scraper = createScraper();
        const stateWrite = deferred();
        const stateWriteStarted = deferred();
        let currentScope = SAVED_GALLERY_SCOPES.all;
        scraper.getSavedGalleryScope.mockImplementation(() => currentScope);
        scraper.queueRunStateWrite = jest.fn(() => {
            stateWriteStarted.resolve();
            return stateWrite.promise;
        });
        scraper.processItem = jest.fn();
        chrome.runtime.sendMessage.mockImplementation((message) => {
            if (message.action === 'VALIDATE_CLOUD_CONFIG') return Promise.resolve({ valid: true });
            if (message.action === 'VALIDATE_SCRAPE_RESUME') {
                return Promise.resolve({ valid: true, reason: 'active_owner' });
            }
            return Promise.resolve();
        });
        const { image } = mountSemanticSavedImage(
            'https://assets.grok.com/users/u/generated/11111111-1111-4111-8111-111111111111/image.jpg'
        );
        const activationEvents = recordPointerActivationEvents(image);

        const starting = backup
            ? scraper.startBackupMode({ mode: 'full', runToken: 'run-state', runEpoch: 21 })
            : scraper.start({ runToken: 'run-state', runEpoch: 21 });
        await stateWriteStarted.promise;
        currentScope = SAVED_GALLERY_SCOPES.liked;
        stateWrite.resolve({ ok: true, invalidated: false, skipped: false });
        const response = await starting;

        expect(response).toMatchObject({
            status: 'invalid_context',
            surface: SCRAPE_SURFACES.savedGallery,
            scope: SAVED_GALLERY_SCOPES.liked
        });
        expect(response.status).not.toBe('started');
        expect(scraper.determineModeAndExecute).not.toHaveBeenCalled();
        expect(scraper.processItem).not.toHaveBeenCalled();
        expect(activationEvents).toEqual([]);
        expect(scraper.state.isRunning).toBe(false);
        expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
            action: backup ? 'R2_BACKUP_COMPLETE' : 'SCRAPE_COMPLETE',
            runToken: 'run-state',
            runEpoch: 21
        }));
        expect(chrome.runtime.sendMessage.mock.calls.map(([message]) => message.action)).not.toEqual(
            expect.arrayContaining(['DOWNLOAD_MEDIA', 'R2_BACKUP_UPLOAD'])
        );
    });

    test.each([
        ['Sync', false],
        ['R2 backup', true]
    ])('%s fails closed when Saved scope drifts during authority validation', async (_label, backup) => {
        const scraper = createScraper();
        const authority = deferred();
        const authorityStarted = deferred();
        let currentScope = SAVED_GALLERY_SCOPES.all;
        scraper.getSavedGalleryScope.mockImplementation(() => currentScope);
        scraper.processItem = jest.fn();
        chrome.runtime.sendMessage.mockImplementation((message) => {
            if (message.action === 'VALIDATE_CLOUD_CONFIG') return Promise.resolve({ valid: true });
            if (message.action === 'SCRAPE_RUN_STATE_WRITE') return Promise.resolve({ status: 'ok' });
            if (message.action === 'VALIDATE_SCRAPE_RESUME') {
                authorityStarted.resolve();
                return authority.promise;
            }
            return Promise.resolve();
        });
        const { image } = mountSemanticSavedImage(
            'https://assets.grok.com/users/u/generated/22222222-2222-4222-8222-222222222222/image.jpg'
        );
        const activationEvents = recordPointerActivationEvents(image);

        const starting = backup
            ? scraper.startBackupMode({ mode: 'full', runToken: 'run-authority', runEpoch: 22 })
            : scraper.start({ runToken: 'run-authority', runEpoch: 22 });
        await authorityStarted.promise;
        currentScope = SAVED_GALLERY_SCOPES.unknown;
        authority.resolve({ valid: true, reason: 'active_owner' });
        const response = await starting;

        expect(response).toMatchObject({
            status: 'invalid_context',
            surface: SCRAPE_SURFACES.savedGallery,
            scope: SAVED_GALLERY_SCOPES.unknown
        });
        expect(response.status).not.toBe('started');
        expect(scraper.determineModeAndExecute).not.toHaveBeenCalled();
        expect(scraper.processItem).not.toHaveBeenCalled();
        expect(activationEvents).toEqual([]);
        expect(scraper.state.isRunning).toBe(false);
        expect(chrome.runtime.sendMessage.mock.calls.map(([message]) => message.action)).not.toEqual(
            expect.arrayContaining(['DOWNLOAD_MEDIA', 'R2_BACKUP_UPLOAD'])
        );
    });

    test.each([
        ['Liked', SAVED_GALLERY_SCOPES.liked],
        ['an unknown scope', SAVED_GALLERY_SCOPES.unknown]
    ])('R2 backup fails closed when cloud validation resolves after scope changes to %s', async (_label, driftedScope) => {
        const scraper = createScraper();
        const cloudValidation = deferred();
        const cloudValidationStarted = deferred();
        let currentScope = SAVED_GALLERY_SCOPES.all;
        scraper.getSavedGalleryScope.mockImplementation(() => currentScope);
        scraper.queueRunStateWrite = jest.fn().mockResolvedValue({
            ok: true,
            invalidated: false,
            skipped: false
        });
        scraper.processItem = jest.fn();
        chrome.runtime.sendMessage.mockImplementation((message) => {
            if (message.action === 'VALIDATE_CLOUD_CONFIG') {
                cloudValidationStarted.resolve();
                return cloudValidation.promise;
            }
            return Promise.resolve();
        });
        const { image } = mountSemanticSavedImage(
            'https://assets.grok.com/users/u/generated/33333333-3333-4333-8333-333333333333/image.jpg'
        );
        const activationEvents = recordPointerActivationEvents(image);

        const starting = scraper.startBackupMode({
            mode: 'full',
            runToken: 'run-cloud-validation',
            runEpoch: 23
        });
        await cloudValidationStarted.promise;
        currentScope = driftedScope;
        cloudValidation.resolve({ valid: true });
        const response = await starting;

        expect(response).toMatchObject({
            status: 'invalid_context',
            surface: SCRAPE_SURFACES.savedGallery,
            scope: driftedScope
        });
        expect(response.status).not.toBe('started');
        expect(scraper.queueRunStateWrite).not.toHaveBeenCalled();
        expect(scraper.determineModeAndExecute).not.toHaveBeenCalled();
        expect(scraper.processItem).not.toHaveBeenCalled();
        expect(activationEvents).toEqual([]);
        expect(scraper.state.isRunning).toBe(false);
        expect(chrome.runtime.sendMessage.mock.calls.map(([message]) => message.action)).not.toEqual(
            expect.arrayContaining(['VALIDATE_SCRAPE_RESUME', 'DOWNLOAD_MEDIA', 'R2_BACKUP_UPLOAD'])
        );
    });

    test.each([
        ['sync', (scraper) => scraper.start({ runToken: 'run-liked', runEpoch: 7 })],
        ['r2_backup', (scraper) => scraper.startBackupMode({
            mode: 'full',
            runToken: 'run-liked',
            runEpoch: 7
        })]
    ])('fails %s closed unless the Saved All scope is selected', async (_kind, startRun) => {
        const scraper = createScraper();
        scraper.getSavedGalleryScope.mockReturnValue(SAVED_GALLERY_SCOPES.liked);

        await expect(startRun(scraper)).resolves.toMatchObject({
            status: 'invalid_context',
            surface: SCRAPE_SURFACES.savedGallery,
            scope: SAVED_GALLERY_SCOPES.liked,
            error: 'Switch Grok Saved to All before starting.'
        });

        expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
        expect(chrome.storage.local.set).not.toHaveBeenCalled();
        expect(scraper.determineModeAndExecute).not.toHaveBeenCalled();
        expect(scraper.state.isRunning).toBe(false);
    });

    test('uses the documented error status when a run is already active', async () => {
        const scraper = createScraper();
        scraper.state.isRunning = true;

        await expect(scraper.start()).resolves.toEqual({
            status: 'error',
            surface: SCRAPE_SURFACES.savedGallery,
            error: 'Sync is already running.'
        });
    });

    test('fails R2 Backup closed off Saved before cloud validation', async () => {
        const scraper = createScraper(SCRAPE_SURFACES.agentMedia);

        await expect(scraper.startBackupMode({ mode: 'full' })).resolves.toEqual({
            status: 'invalid_context',
            surface: SCRAPE_SURFACES.agentMedia,
            error: 'Open Grok Imagine Saved before starting backup.'
        });
        expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
        expect(chrome.storage.local.set).not.toHaveBeenCalled();
    });

    test('uses only the background-issued token and epoch for normal Sync', async () => {
        const scraper = createScraper();

        const response = await scraper.start({ runToken: 'background-run', runEpoch: 12 });

        expect(response).toMatchObject({
            status: 'started',
            runToken: 'background-run',
            runEpoch: 12
        });
        expect(scraper.createRunToken).not.toHaveBeenCalled();
        expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
            action: 'SCRAPE_RUN_STATE_WRITE',
            runToken: 'background-run',
            runEpoch: 12
        }));
    });

    test('uses the background-issued lease for R2 Backup too', async () => {
        const scraper = createScraper();
        chrome.runtime.sendMessage.mockImplementation(async (message) => {
            if (message.action === 'VALIDATE_CLOUD_CONFIG') return { valid: true };
            if (message.action === 'VALIDATE_SCRAPE_RESUME') {
                return { valid: true, reason: 'active_owner' };
            }
            if (message.action === 'SCRAPE_RUN_STATE_WRITE') return { status: 'ok' };
            return undefined;
        });

        const response = await scraper.startBackupMode({
            mode: 'full',
            runToken: 'background-backup',
            runEpoch: 13
        });

        expect(response).toMatchObject({
            status: 'started',
            runToken: 'background-backup',
            runEpoch: 13
        });
        expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
            action: 'SCRAPE_RUN_STATE_WRITE',
            runToken: 'background-backup',
            runEpoch: 13,
            kind: 'r2_backup',
            values: expect.objectContaining({
                r2BackupState: expect.objectContaining({ isRunning: true })
            })
        }));
    });

    test.each([
        ['sync', (scraper) => scraper.start({ runToken: 'revoked-run', runEpoch: 20 })],
        ['r2_backup', (scraper) => scraper.startBackupMode({
            mode: 'full',
            runToken: 'revoked-run',
            runEpoch: 20
        })]
    ])('does not launch a %s loop after the background tombstones its lease', async (kind, startRun) => {
        const scraper = createScraper();
        chrome.runtime.sendMessage.mockImplementation(async (message) => {
            if (message.action === 'VALIDATE_CLOUD_CONFIG') return { valid: true };
            if (message.action === 'VALIDATE_SCRAPE_RESUME') {
                return { valid: false, reason: 'stale_authority' };
            }
            if (message.action === 'SCRAPE_RUN_STATE_WRITE') return { status: 'ok' };
            return undefined;
        });

        await expect(startRun(scraper)).resolves.toMatchObject({
            status: 'error',
            error: 'Start was cancelled.'
        });

        expect(scraper.determineModeAndExecute).not.toHaveBeenCalled();
        expect(scraper.state.isRunning).toBe(false);
        expect(chrome.storage.local.set).not.toHaveBeenCalled();
    });
});

describe('Grok Saved semantic candidate and viewport receipts', () => {
    const appendCard = (list, mediaId) => {
        const card = document.createElement('article');
        card.setAttribute('role', 'listitem');
        const image = document.createElement('img');
        image.alt = 'Generated image';
        image.src = `https://assets.grok.com/users/u/generated/${mediaId}/image.jpg`;
        card.appendChild(image);
        list.appendChild(card);
        return { card, image };
    };

    afterEach(() => {
        document.body.textContent = '';
    });

    test('rejects multiple plausible generated-media lists instead of choosing the largest', () => {
        const primary = document.createElement('div');
        const decoy = document.createElement('div');
        primary.setAttribute('role', 'list');
        decoy.setAttribute('role', 'list');
        appendCard(primary, '11111111-1111-4111-8111-111111111111');
        appendCard(primary, '22222222-2222-4222-8222-222222222222');
        appendCard(decoy, '33333333-3333-4333-8333-333333333333');
        document.body.append(primary, decoy);

        expect(getSavedGalleryContext(document)).toBeNull();
    });

    test('matches V3 results receipts only from the captured origin and stable neighborhood', () => {
        const before1 = '11111111-1111-4111-8111-111111111111';
        const before2 = '22222222-2222-4222-8222-222222222222';
        const source = '33333333-3333-4333-8333-333333333333';
        const next = '44444444-4444-4444-8444-444444444444';
        const after2 = '55555555-5555-4555-8555-555555555555';
        const generatedVideo = '66666666-6666-4666-8666-666666666666';
        const unrelated1 = '77777777-7777-4777-8777-777777777777';
        const unrelated2 = '88888888-8888-4888-8888-888888888888';
        const receipt = captureGalleryReceipt({
            identities: [before1, before2, source, next, after2],
            sourceIdentity: source,
            origin: { pathname: '/imagine', conversationId: 'conv-a', scope: 'results' }
        });

        expect(receipt).toMatchObject({ version: GALLERY_RECEIPT_VERSION });
        expect(evaluateGalleryReceipt({
            identities: [before1, before2, source, next, after2],
            receipt,
            currentOrigin: { pathname: '/imagine', conversationId: 'conv-a', scope: 'results' },
            allowSourceReplacement: true
        })).toMatchObject({ status: 'matched' });

        expect(evaluateGalleryReceipt({
            identities: [before1, before2, generatedVideo, next, after2],
            receipt,
            currentOrigin: { pathname: '/imagine', conversationId: 'conv-a', scope: 'results' },
            allowSourceReplacement: true
        })).toMatchObject({ status: 'matched', reason: 'source_replaced_with_stable_anchors' });

        expect(evaluateGalleryReceipt({
            identities: [unrelated1, next, unrelated2],
            receipt,
            currentOrigin: { pathname: '/imagine', conversationId: 'conv-a', scope: 'results' },
            allowSourceReplacement: true
        })).toMatchObject({ status: 'ambiguous' });

        expect(evaluateGalleryReceipt({
            identities: [before1, before2, source, next, after2],
            receipt,
            currentOrigin: { pathname: '/imagine', conversationId: 'conv-b', scope: 'results' },
            allowSourceReplacement: true
        })).toMatchObject({ status: 'different', reason: 'origin_mismatch' });
    });

    test('fails Saved receipts closed for replacement, duplicates, order drift, and V2', () => {
        const before = '11111111-1111-4111-8111-111111111111';
        const source = '22222222-2222-4222-8222-222222222222';
        const next = '33333333-3333-4333-8333-333333333333';
        const after = '44444444-4444-4444-8444-444444444444';
        const replacement = '55555555-5555-4555-8555-555555555555';
        const origin = { pathname: '/imagine/saved', conversationId: 'conv-a', scope: 'all' };
        const receipt = captureGalleryReceipt({
            identities: [before, source, next, after],
            sourceIdentity: source,
            origin
        });

        expect(evaluateGalleryReceipt({
            identities: [before, replacement, next, after],
            receipt,
            currentOrigin: origin,
            allowSourceReplacement: false
        })).toMatchObject({ status: 'different', reason: 'source_missing' });
        expect(evaluateGalleryReceipt({
            identities: [before, source, source, next, after],
            receipt,
            currentOrigin: origin,
            allowSourceReplacement: false
        })).toMatchObject({ status: 'ambiguous', reason: 'duplicate_identity' });
        expect(evaluateGalleryReceipt({
            identities: [before, source, after, next],
            receipt,
            currentOrigin: origin,
            allowSourceReplacement: false
        })).toMatchObject({ status: 'different', reason: 'expected_next_mismatch' });
        expect(evaluateGalleryReceipt({
            identities: [before, source, next, after],
            receipt: { ...receipt, version: 2 },
            currentOrigin: origin,
            allowSourceReplacement: false
        })).toMatchObject({ status: 'different', reason: 'receipt_version' });
    });

    test('requires one source and one immediately adjacent expected-next identity', () => {
        mountSavedScope('all');
        const source = '11111111-1111-4111-8111-111111111111';
        const middle = '22222222-2222-4222-8222-222222222222';
        const next = '33333333-3333-4333-8333-333333333333';
        const entries = [source, middle, next].map((sourceIdentity) => ({ sourceIdentity }));
        const receipt = captureGalleryReceipt({
            identities: [source, middle, next],
            sourceIdentity: source,
            origin: { pathname: window.location.pathname, conversationId: '', scope: 'all' }
        });

        expect(hasOrderedSavedNeighborhood(entries, receipt)).toBe(true);
        expect(hasOrderedSavedNeighborhood([entries[0], entries[2], entries[1]], receipt)).toBe(false);
        expect(hasOrderedSavedNeighborhood([...entries, { sourceIdentity: middle }], receipt)).toBe(false);
        expect(hasOrderedSavedNeighborhood([...entries, { sourceIdentity: source }], receipt)).toBe(false);
        expect(hasOrderedSavedNeighborhood([...entries].reverse(), receipt)).toBe(false);
    });

    test('captures the literal semantic neighbor and rejects stale V2 receipts', () => {
        mountSavedScope('all');
        const list = document.createElement('div');
        list.setAttribute('role', 'list');
        const source = '11111111-1111-4111-8111-111111111111';
        const next = '22222222-2222-4222-8222-222222222222';
        appendCard(list, source);
        appendCard(list, next);
        document.body.appendChild(list);

        expect(captureSavedViewportReceipt({ root: document, sourceIdentity: source })).toMatchObject({
            version: 3,
            sourceIdentity: source,
            expectedNextIdentity: next,
            origin: { scope: 'all' }
        });
        expect(normalizeSavedViewportReceipt({
            version: 2,
            sourceIdentity: source,
            expectedNextIdentity: next,
            scrollTop: 0
        })).toBeNull();
    });

    test.each(['liked', 'unknown'])(
        'rejects Saved receipt capture when the native scope is %s',
        (scope) => {
            window.history.pushState({}, '', '/imagine/saved');
            const list = document.createElement('div');
            list.setAttribute('role', 'list');
            const source = '61616161-1111-4111-8111-111111111111';
            appendCard(list, source);
            document.body.appendChild(list);
            mountSavedScope(scope);

            expect(captureSavedViewportReceipt({ root: document, sourceIdentity: source }))
                .toBeNull();
        }
    );
});

describe('Grok scrape surface transitions', () => {
    beforeEach(() => {
        mountSavedScope('all');
    });

    afterEach(() => {
        delete global.chrome;
        document.body.textContent = '';
    });

    test('routes Agent Mode directly to the Agent handler without gallery scrolling', async () => {
        const scraper = createScraper(SCRAPE_SURFACES.agentMedia);
        scraper.state.isRunning = true;
        scraper.runToken = 'run-1';
        scraper.executeAgentView = jest.fn();
        scraper.executeListView = jest.fn();
        scraper.executeDetailView = jest.fn();
        const scrollSpy = jest.spyOn(window, 'scrollBy').mockImplementation(() => {});

        await GrokScraper.prototype.determineModeAndExecute.call(scraper, 'run-1');

        expect(scraper.executeAgentView).toHaveBeenCalledWith('run-1');
        expect(scraper.executeListView).not.toHaveBeenCalled();
        expect(scrollSpy).not.toHaveBeenCalled();
        scrollSpy.mockRestore();
    });

    test.each([
        ['sync', false],
        ['R2 backup', true]
    ])('stops %s before scanning, clicking, or scrolling when Saved scope drifts to Liked', async (_kind, backupMode) => {
        mockContentChrome();
        const scraper = createScraper();
        scraper.state.isRunning = true;
        scraper.runToken = 'run-1';
        scraper.backupMode = backupMode;
        scraper.getSavedGalleryScope
            .mockReturnValueOnce(SAVED_GALLERY_SCOPES.all)
            .mockReturnValue(SAVED_GALLERY_SCOPES.liked);
        const { image } = mountSemanticSavedImage(
            'https://assets.grok.com/users/u/generated/73e5e137-1334-49ea-b06b-a9d9ba891003/content'
        );
        const activationEvents = recordPointerActivationEvents(image);
        scraper.processItem = jest.fn();
        scraper.failRun = jest.fn().mockResolvedValue();
        const scrollSpy = jest.spyOn(window, 'scrollBy').mockImplementation(() => {});

        await GrokScraper.prototype.executeListView.call(scraper, 'run-1');

        expect(scraper.failRun).toHaveBeenCalledWith(
            'Saved scope changed to Liked. Switch Grok Saved to All before continuing.',
            'saved_scope_drift'
        );
        expect(scraper.processItem).not.toHaveBeenCalled();
        expect(activationEvents).toEqual([]);
        expect(scrollSpy).not.toHaveBeenCalled();
        expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
        scrollSpy.mockRestore();
    });

    test('stops on a post-return Saved scope drift before receipt cleanup or list continuation', async () => {
        mockContentChrome();
        const scraper = createScraper();
        scraper.state.isRunning = true;
        scraper.runToken = 'run-1';
        scraper.pendingNavigation = {
            runToken: 'run-1',
            runEpoch: 1,
            currentItemId: 'gallery-clean-id'
        };
        scraper.getSavedGalleryScope.mockReturnValue(SAVED_GALLERY_SCOPES.liked);
        scraper.restorePendingGalleryContext = jest.fn().mockResolvedValue(true);
        scraper.executeListView = jest.fn().mockResolvedValue();
        scraper.failRun = jest.fn().mockResolvedValue();

        await GrokScraper.prototype.determineModeAndExecute.call(scraper, 'run-1');

        expect(scraper.failRun).toHaveBeenCalledWith(
            'Saved scope changed to Liked. Switch Grok Saved to All before continuing.',
            'saved_scope_drift'
        );
        expect(scraper.restorePendingGalleryContext).not.toHaveBeenCalled();
        expect(scraper.executeListView).not.toHaveBeenCalled();
        expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
    });

    test.each([
        ['Liked', SAVED_GALLERY_SCOPES.liked],
        ['an unknown scope', SAVED_GALLERY_SCOPES.unknown]
    ])('stops after receipt restoration when Saved scope changes to %s before cleanup', async (_label, driftedScope) => {
        mockContentChrome();
        const scraper = createScraper();
        const sourceId = 'c8c8c8c8-aaaa-4bbb-8ccc-d9d9d9d9d9d9';
        const pending = {
            runToken: 'run-1',
            runEpoch: 1,
            currentItemId: 'gallery-clean-id',
            expectedIdentity: sourceId,
            savedViewportReceipt: {
                version: 3,
                sourceIdentity: sourceId,
                expectedNextIdentity: null,
                beforeIdentities: [],
                afterIdentities: [],
                visibleIdentities: [sourceId],
                origin: { pathname: '/imagine/saved', conversationId: '', scope: 'all' },
                scrollTop: 840
            }
        };
        scraper.state.isRunning = true;
        scraper.runToken = 'run-1';
        scraper.pendingNavigation = pending;
        window.history.pushState({}, '', '/imagine/saved');
        let currentScope = SAVED_GALLERY_SCOPES.all;
        scraper.getSavedGalleryScope.mockImplementation(() => currentScope);
        scraper.failRun = jest.fn().mockResolvedValue();
        scraper.executeListView = jest.fn().mockResolvedValue();
        const { list, scroller } = mountSemanticSavedImage(
            'https://assets.grok.com/users/u/generated/a7a7a7a7-bbbb-4ccc-8ddd-e8e8e8e8e8e8/image.jpg'
        );
        const scrollEvent = jest.fn();
        scroller.addEventListener('scroll', scrollEvent);
        const windowScroll = jest.spyOn(window, 'scrollTo').mockImplementation(() => {});
        scraper.sleep = jest.fn(async () => {
            const card = document.createElement('article');
            card.setAttribute('role', 'listitem');
            const image = document.createElement('img');
            image.alt = 'Generated image';
            image.src = `https://assets.grok.com/users/u/generated/${sourceId}/image.jpg`;
            card.appendChild(image);
            list.appendChild(card);
            currentScope = driftedScope;
        });

        await GrokScraper.prototype.determineModeAndExecute.call(scraper, 'run-1');

        expect(scraper.failRun).toHaveBeenCalledWith(
            driftedScope === SAVED_GALLERY_SCOPES.liked
                ? 'Saved scope changed to Liked. Switch Grok Saved to All before continuing.'
                : 'Could not verify Grok Saved scope. Switch Grok Saved to All before continuing.',
            'saved_scope_drift'
        );
        expect(chrome.runtime.sendMessage).not.toHaveBeenCalledWith(expect.objectContaining({
            action: 'SCRAPE_RUN_STATE_WRITE',
            values: { scrapeNavigation: null, currentItemId: null }
        }));
        expect(scraper.pendingNavigation).toBe(pending);
        expect(scraper.executeListView).not.toHaveBeenCalled();
        expect(scroller.scrollTop).toBe(0);
        expect(scrollEvent).not.toHaveBeenCalled();
        expect(windowScroll).not.toHaveBeenCalled();
        windowScroll.mockRestore();
    });

    test('captures Saved context before clicking and routes the resulting surface', async () => {
        mockContentChrome();
        const scraper = createScraper();
        scraper.state.isRunning = true;
        scraper.runToken = 'run-1';
        scraper.getGalleryScroller = jest.fn(() => ({ scrollTop: 640, scrollHeight: 2000, clientHeight: 800 }));
        scraper.waitForSurface = jest.fn(() => Promise.resolve(SCRAPE_SURFACES.agentMedia));
        const { image: target } = mountSemanticSavedImage(
            'https://assets.grok.com/users/u/73e5e137-1334-49ea-b06b-a9d9ba891003/content?size=small',
            640
        );
        const activationEvents = recordPointerActivationEvents(target);

        await GrokScraper.prototype.processItem.call(scraper, target, 'gallery-clean-id', 'run-1');

        expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
            action: 'SCRAPE_RUN_STATE_WRITE',
            values: expect.objectContaining({
                currentItemId: 'gallery-clean-id',
                scrapeNavigation: expect.objectContaining({
                runToken: 'run-1',
                currentItemId: 'gallery-clean-id',
                expectedIdentity: '73e5e137-1334-49ea-b06b-a9d9ba891003',
                galleryScrollTop: 640
                })
            })
        }));
        expect(activationEvents).toEqual(FULL_POINTER_ACTIVATION_EVENTS);
        expect(scraper.determineModeAndExecute).toHaveBeenCalledWith('run-1');
    });

    test('stops before clicking when Saved scope drifts during the navigation state write', async () => {
        mockContentChrome();
        const scraper = createScraper();
        scraper.state.isRunning = true;
        scraper.runToken = 'run-1';
        scraper.getGalleryScroller = jest.fn(() => ({ scrollTop: 640, scrollHeight: 2000, clientHeight: 800 }));
        const navigationWrite = deferred();
        const navigationWriteStarted = deferred();
        scraper.queueRunStateWrite = jest.fn(() => {
            navigationWriteStarted.resolve();
            return navigationWrite.promise;
        });
        scraper.failRun = jest.fn().mockResolvedValue();
        scraper.waitForSurface = jest.fn();
        let currentScope = SAVED_GALLERY_SCOPES.all;
        scraper.getSavedGalleryScope.mockImplementation(() => currentScope);
        const { image: target } = mountSemanticSavedImage(
            'https://assets.grok.com/users/u/generated/73e5e137-1334-49ea-b06b-a9d9ba891003/content',
            640
        );
        const activationEvents = recordPointerActivationEvents(target);

        const processing = GrokScraper.prototype.processItem.call(scraper, target, 'gallery-clean-id', 'run-1');
        await navigationWriteStarted.promise;
        currentScope = SAVED_GALLERY_SCOPES.liked;
        navigationWrite.resolve({ ok: true, invalidated: false });
        await processing;

        expect(scraper.failRun).toHaveBeenCalledWith(
            'Saved scope changed to Liked. Switch Grok Saved to All before continuing.',
            'saved_scope_drift'
        );
        expect(activationEvents).toEqual([]);
        expect(scraper.waitForSurface).not.toHaveBeenCalled();
        expect(scraper.determineModeAndExecute).not.toHaveBeenCalled();
        expect(scraper.pendingNavigation).toBeUndefined();
    });

    test('captures the semantic Saved scroller and expected-next identity instead of unrelated overflow', async () => {
        mockContentChrome();
        const scraper = createScraper();
        scraper.state.isRunning = true;
        scraper.runToken = 'run-1';
        scraper.waitForSurface = jest.fn(() => Promise.resolve(SCRAPE_SURFACES.agentMedia));

        const unrelatedScroller = document.createElement('div');
        unrelatedScroller.className = 'overflow-scroll';
        unrelatedScroller.scrollTop = 999;
        const galleryScroller = document.createElement('div');
        galleryScroller.className = 'h-dvh overflow-scroll items-center';
        galleryScroller.style.overflowY = 'scroll';
        galleryScroller.scrollTop = 640;
        Object.defineProperties(galleryScroller, {
            scrollHeight: { configurable: true, value: 2400 },
            clientHeight: { configurable: true, value: 800 }
        });
        const list = document.createElement('div');
        list.setAttribute('role', 'list');
        const sourceId = '73e5e137-1334-49ea-b06b-a9d9ba891003';
        const nextId = '84f6f248-2445-4afb-c17c-b0e0cb902114';
        const appendCard = (mediaId) => {
            const card = document.createElement('article');
            card.setAttribute('role', 'listitem');
            const image = document.createElement('img');
            image.alt = 'Generated image';
            image.src = `https://assets.grok.com/users/u/generated/${mediaId}/image.jpg`;
            card.appendChild(image);
            list.appendChild(card);
            return image;
        };
        const target = appendCard(sourceId);
        appendCard(nextId);
        galleryScroller.appendChild(list);
        document.body.append(unrelatedScroller, galleryScroller);

        await GrokScraper.prototype.processItem.call(
            scraper,
            target,
            target.src.split('?')[0],
            'run-1',
            1,
            nextId
        );

        expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
            action: 'SCRAPE_RUN_STATE_WRITE',
            values: expect.objectContaining({
                scrapeNavigation: expect.objectContaining({
                    savedViewportReceipt: {
                        version: 3,
                        sourceIdentity: sourceId,
                        expectedNextIdentity: nextId,
                        beforeIdentities: [],
                        afterIdentities: [nextId],
                        visibleIdentities: [sourceId, nextId],
                        origin: { pathname: '/imagine/saved', conversationId: '', scope: 'all' },
                        scrollTop: 640
                    }
                })
            })
        }));
        expect(unrelatedScroller.scrollTop).toBe(999);
    });

    test('stops explicitly when a selected Saved card never changes surfaces', async () => {
        mockContentChrome();
        const scraper = createScraper();
        scraper.state.isRunning = true;
        scraper.runToken = 'run-1';
        scraper.getGalleryScroller = jest.fn(() => ({ scrollTop: 0, scrollHeight: 1000, clientHeight: 800 }));
        scraper.waitForSurface = jest.fn(() => Promise.resolve(null));
        scraper.failRun = jest.fn(() => Promise.resolve());
        const { image: target } = mountSemanticSavedImage(
            'https://assets.grok.com/users/u/73e5e137-1334-49ea-b06b-a9d9ba891003/content'
        );
        const activationEvents = recordPointerActivationEvents(target);

        await GrokScraper.prototype.processItem.call(scraper, target, 'gallery-clean-id', 'run-1');

        expect(scraper.failRun).toHaveBeenCalledWith(
            'The selected Saved card did not open a supported media surface.',
            'surface_transition_timeout'
        );
        expect(activationEvents).toEqual(FULL_POINTER_ACTIVATION_EVENTS);
        expect(scraper.determineModeAndExecute).not.toHaveBeenCalled();
    });

    test('does not click after Stop wins while navigation state is being saved', async () => {
        mockContentChrome();
        const scraper = createScraper();
        scraper.state.isRunning = true;
        scraper.runToken = 'run-1';
        scraper.getGalleryScroller = jest.fn(() => ({ scrollTop: 0, scrollHeight: 1000, clientHeight: 800 }));
        chrome.runtime.sendMessage.mockImplementation(async (message) => {
            if (message.action === 'SCRAPE_RUN_STATE_WRITE') scraper.runToken = 'run-2';
            return { status: 'ok' };
        });
        scraper.waitForSurface = jest.fn();
        const { image: target } = mountSemanticSavedImage(
            'https://assets.grok.com/users/u/73e5e137-1334-49ea-b06b-a9d9ba891003/content'
        );
        const activationEvents = recordPointerActivationEvents(target);

        await GrokScraper.prototype.processItem.call(scraper, target, 'gallery-clean-id', 'run-1');

        expect(activationEvents).toEqual([]);
        expect(scraper.waitForSurface).not.toHaveBeenCalled();
    });

    test('serializes Stop after a deferred navigation write so stale state cannot land last', async () => {
        mockContentChrome();
        const scraper = createScraper();
        scraper.state.isRunning = true;
        scraper.runToken = 'run-1';
        scraper.runEpoch = 4;
        scraper.getGalleryScroller = jest.fn(() => ({ scrollTop: 0, scrollHeight: 1000, clientHeight: 800 }));
        scraper.waitForSurface = jest.fn();
        const navigationWrite = deferred();
        chrome.runtime.sendMessage.mockImplementation((message) => {
            if (message.action === 'SCRAPE_RUN_STATE_WRITE' && message.values.scrapeNavigation) {
                return navigationWrite.promise.then(() => ({ status: 'ok' }));
            }
            return Promise.resolve({ status: 'ok' });
        });
        const { image: target } = mountSemanticSavedImage(
            'https://assets.grok.com/users/u/73e5e137-1334-49ea-b06b-a9d9ba891003/content'
        );
        const activationEvents = recordPointerActivationEvents(target);

        const processing = GrokScraper.prototype.processItem.call(scraper, target, 'gallery-clean-id', 'run-1', 4);
        await Promise.resolve();
        const stopping = GrokScraper.prototype.stop.call(scraper, 'stopped', {
            notifyBackground: false,
            expectedRunToken: 'run-1',
            expectedRunEpoch: 4
        });
        expect(scraper.state.isRunning).toBe(false);
        navigationWrite.resolve();
        await Promise.all([processing, stopping]);

        expect(activationEvents).toEqual([]);
        expect(chrome.storage.local.set).not.toHaveBeenCalled();
    });

    test('does not acknowledge an ABORT message until deferred run writes and idle persistence finish', async () => {
        mockContentChrome();
        const scraper = createScraper();
        scraper.state.isRunning = true;
        scraper.runToken = 'run-1';
        scraper.runEpoch = 4;
        const idleWrite = deferred();
        chrome.storage.local.set.mockImplementation((values) => (
            values.scraperState === 'idle' ? idleWrite.promise : Promise.resolve()
        ));
        scraper.setupListeners();
        const listener = chrome.runtime.onMessage.addListener.mock.calls[0][0];
        const sendResponse = jest.fn();

        const keepChannelOpen = listener({
            action: 'ABORT_SCRAPE',
            runToken: 'run-1',
            runEpoch: 4
        }, {}, sendResponse);

        expect(keepChannelOpen).toBe(true);
        expect(sendResponse).not.toHaveBeenCalled();
        idleWrite.resolve();
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ status: 'stopped' }));
    });

    test('transfers the exact Agent media, persists after success, and returns to Saved', async () => {
        const scraper = createScraper(SCRAPE_SURFACES.agentMedia);
        const media = document.createElement('img');
        scraper.state.isRunning = true;
        scraper.runToken = 'run-1';
        scraper.pendingNavigation = {
            runToken: 'run-1',
            runEpoch: 1,
            expectedIdentity: '73e5e137-1334-49ea-b06b-a9d9ba891003',
            currentItemId: 'gallery-clean-id'
        };
        scraper.waitForMatchingAgentMedia = jest.fn(() => Promise.resolve({ status: 'matched', media }));
        scraper.performDownload = jest.fn(() => Promise.resolve({ status: 'uploaded' }));
        scraper.persistProcessedId = jest.fn(() => Promise.resolve());
        scraper.returnToSavedGallery = jest.fn(() => Promise.resolve());
        scraper.failRun = jest.fn();

        await GrokScraper.prototype.executeAgentView.call(scraper, 'run-1');

        expect(scraper.performDownload).toHaveBeenCalledWith(media, 'gallery-clean-id', 'run-1');
        expect(scraper.persistProcessedId).toHaveBeenCalledWith('gallery-clean-id', 'run-1');
        expect(scraper.returnToSavedGallery).toHaveBeenCalledWith('run-1');
        expect(scraper.failRun).not.toHaveBeenCalled();
    });

    test.each(['queued', 'cloud_queued'])(
        'advances after %s without persisting the Saved current item',
        async (status) => {
            const scraper = createScraper(SCRAPE_SURFACES.agentMedia);
            const media = document.createElement('img');
            scraper.state.isRunning = true;
            scraper.runToken = 'run-1';
            scraper.pendingNavigation = {
                runToken: 'run-1',
                runEpoch: 1,
                expectedIdentity: '73e5e137-1334-49ea-b06b-a9d9ba891003',
                currentItemId: 'gallery-clean-id'
            };
            scraper.waitForMatchingAgentMedia = jest.fn(() => Promise.resolve({ status: 'matched', media }));
            scraper.performDownload = jest.fn(() => Promise.resolve({ status }));
            scraper.persistProcessedId = jest.fn(() => Promise.resolve());
            scraper.returnToSavedGallery = jest.fn(() => Promise.resolve());

            await GrokScraper.prototype.executeAgentView.call(scraper, 'run-1');

            expect(scraper.persistProcessedId).not.toHaveBeenCalled();
            expect(scraper._runVisited).toContain('gallery-clean-id');
            expect(scraper.returnToSavedGallery).toHaveBeenCalledWith('run-1');
        }
    );

    test('runs the Saved-to-Agent transfer path in R2 Backup mode', async () => {
        const scraper = createScraper(SCRAPE_SURFACES.agentMedia);
        const media = document.createElement('video');
        scraper.state.isRunning = true;
        scraper.runToken = 'run-1';
        scraper.backupMode = true;
        scraper.backupOptions = { mode: 'full', limit: null, options: {} };
        scraper.backupStats = { totalSeen: 0, uploaded: 0, alreadyPresent: 0, queued: 0, errors: 0 };
        scraper.pendingNavigation = {
            runToken: 'run-1',
            runEpoch: 1,
            expectedIdentity: '73e5e137-1334-49ea-b06b-a9d9ba891003',
            currentItemId: 'gallery-clean-id'
        };
        scraper.waitForMatchingAgentMedia = jest.fn(() => Promise.resolve({ status: 'matched', media }));
        scraper.persistBackupProgress = jest.fn(() => Promise.resolve(true));
        scraper.performDownload = jest.fn(async () => {
            scraper.backupStats.uploaded++;
            return { status: 'uploaded' };
        });
        scraper.persistProcessedId = jest.fn();
        scraper.returnToSavedGallery = jest.fn(() => Promise.resolve());

        await GrokScraper.prototype.executeAgentView.call(scraper, 'run-1');

        expect(scraper._backupVisited).toContain('gallery-clean-id');
        expect(scraper.backupStats).toMatchObject({ totalSeen: 1, uploaded: 1 });
        expect(scraper.persistBackupProgress).toHaveBeenCalledWith('run-1');
        expect(scraper.performDownload).toHaveBeenCalledWith(media, 'gallery-clean-id', 'run-1');
        expect(scraper.persistProcessedId).not.toHaveBeenCalled();
        expect(scraper.returnToSavedGallery).toHaveBeenCalledWith('run-1');
    });

    test('returns a successful Agent canary to Saved before completing the run', async () => {
        const scraper = createScraper(SCRAPE_SURFACES.agentMedia);
        const media = document.createElement('video');
        scraper.state.isRunning = true;
        scraper.runToken = 'run-1';
        scraper.backupMode = true;
        scraper.backupOptions = { mode: 'canary', limit: 1, options: { stopAfterMediaAttempt: true } };
        scraper.backupStats = { totalSeen: 0, uploaded: 0, alreadyPresent: 0, queued: 0, errors: 0 };
        scraper.pendingNavigation = {
            runToken: 'run-1',
            runEpoch: 1,
            expectedIdentity: '73e5e137-1334-49ea-b06b-a9d9ba891003',
            currentItemId: 'gallery-clean-id'
        };
        scraper.waitForMatchingAgentMedia = jest.fn(() => Promise.resolve({ status: 'matched', media }));
        scraper.persistBackupProgress = jest.fn(() => Promise.resolve(true));
        scraper.performDownload = jest.fn(async () => {
            scraper.backupStats.uploaded++;
            return { status: 'uploaded' };
        });
        scraper.returnToSavedGallery = jest.fn(() => Promise.resolve());
        scraper.stopBackupMode = jest.fn();

        await GrokScraper.prototype.executeAgentView.call(scraper, 'run-1');

        expect(scraper.returnToSavedGallery).toHaveBeenCalledWith('run-1', {
            stopBackupReason: 'canary_complete'
        });
        expect(scraper.stopBackupMode).not.toHaveBeenCalled();
    });

    test('never persists a failed Agent transfer', async () => {
        const scraper = createScraper(SCRAPE_SURFACES.agentMedia);
        scraper.state.isRunning = true;
        scraper.runToken = 'run-1';
        scraper.pendingNavigation = {
            runToken: 'run-1',
            runEpoch: 1,
            expectedIdentity: '73e5e137-1334-49ea-b06b-a9d9ba891003',
            currentItemId: 'gallery-clean-id'
        };
        scraper.waitForMatchingAgentMedia = jest.fn(() => Promise.resolve({
            status: 'matched',
            media: document.createElement('img')
        }));
        scraper.performDownload = jest.fn(() => Promise.resolve({ status: 'error', error: 'Transfer failed' }));
        scraper.persistProcessedId = jest.fn();
        scraper.returnToSavedGallery = jest.fn();
        scraper.failRun = jest.fn(() => Promise.resolve());

        await GrokScraper.prototype.executeAgentView.call(scraper, 'run-1');

        expect(scraper.failRun).toHaveBeenCalledWith('Transfer failed', 'media_transfer_failed', false);
        expect(scraper.persistProcessedId).not.toHaveBeenCalled();
        expect(scraper.returnToSavedGallery).not.toHaveBeenCalled();
    });

    test('stops without transferring or scrolling when Agent media cannot be matched', async () => {
        const scraper = createScraper(SCRAPE_SURFACES.agentMedia);
        scraper.state.isRunning = true;
        scraper.runToken = 'run-1';
        scraper.pendingNavigation = {
            runToken: 'run-1',
            runEpoch: 1,
            expectedIdentity: '73e5e137-1334-49ea-b06b-a9d9ba891003',
            currentItemId: 'gallery-clean-id'
        };
        scraper.waitForMatchingAgentMedia = jest.fn(() => Promise.resolve({ status: 'missing' }));
        scraper.performDownload = jest.fn();
        scraper.returnToSavedGallery = jest.fn();
        scraper.failRun = jest.fn(() => Promise.resolve());
        const scrollSpy = jest.spyOn(window, 'scrollBy').mockImplementation(() => {});

        await GrokScraper.prototype.executeAgentView.call(scraper, 'run-1');

        expect(scraper.failRun).toHaveBeenCalledWith('Agent Mode did not expose the selected Saved media.', 'agent_media_missing');
        expect(scraper.performDownload).not.toHaveBeenCalled();
        expect(scraper.returnToSavedGallery).not.toHaveBeenCalled();
        expect(scrollSpy).not.toHaveBeenCalled();
        scrollSpy.mockRestore();
    });

    test('does nothing after cancellation wins a transition race', async () => {
        const scraper = createScraper(SCRAPE_SURFACES.agentMedia);
        scraper.state.isRunning = true;
        scraper.runToken = 'run-1';
        scraper.pendingNavigation = {
            runToken: 'run-1',
            runEpoch: 1,
            expectedIdentity: '73e5e137-1334-49ea-b06b-a9d9ba891003',
            currentItemId: 'gallery-clean-id'
        };
        scraper.waitForMatchingAgentMedia = jest.fn(async () => {
            scraper.runToken = 'run-2';
            return { status: 'matched', media: document.createElement('img') };
        });
        scraper.performDownload = jest.fn();
        scraper.persistProcessedId = jest.fn();
        scraper.returnToSavedGallery = jest.fn();

        await GrokScraper.prototype.executeAgentView.call(scraper, 'run-1');

        expect(scraper.performDownload).not.toHaveBeenCalled();
        expect(scraper.persistProcessedId).not.toHaveBeenCalled();
        expect(scraper.returnToSavedGallery).not.toHaveBeenCalled();
    });

    test('does not persist or navigate after Stop wins during transfer', async () => {
        const scraper = createScraper(SCRAPE_SURFACES.agentMedia);
        scraper.state.isRunning = true;
        scraper.runToken = 'run-1';
        scraper.pendingNavigation = {
            runToken: 'run-1',
            runEpoch: 1,
            expectedIdentity: '73e5e137-1334-49ea-b06b-a9d9ba891003',
            currentItemId: 'gallery-clean-id'
        };
        scraper.waitForMatchingAgentMedia = jest.fn(() => Promise.resolve({
            status: 'matched',
            media: document.createElement('img')
        }));
        scraper.performDownload = jest.fn(async () => {
            scraper.runToken = 'run-2';
            return { status: 'uploaded' };
        });
        scraper.persistProcessedId = jest.fn();
        scraper.returnToSavedGallery = jest.fn();

        await GrokScraper.prototype.executeAgentView.call(scraper, 'run-1');

        expect(scraper.persistProcessedId).not.toHaveBeenCalled();
        expect(scraper.returnToSavedGallery).not.toHaveBeenCalled();
    });

    test('transfers the exact legacy detail media and returns through the Saved restore path', async () => {
        mockContentChrome();
        const scraper = createScraper(SCRAPE_SURFACES.legacyDetail);
        const mediaId = '47474747-4747-4747-8747-474747474747';
        const currentItemId = `https://assets.grok.com/users/u/generated/${mediaId}/image.jpg`;
        const media = document.createElement('img');
        scraper.state.isRunning = true;
        scraper.runToken = 'run-1';
        scraper.pendingNavigation = {
            runToken: 'run-1',
            runEpoch: 1,
            expectedIdentity: mediaId,
            currentItemId
        };
        chrome.storage.local.get.mockResolvedValue({ currentItemId });
        scraper.waitForMatchingLegacyDetailMedia = jest.fn(() => Promise.resolve(media));
        scraper.performDownload = jest.fn(() => Promise.resolve({ status: 'uploaded' }));
        scraper.persistProcessedId = jest.fn(() => Promise.resolve(true));
        scraper.returnToSavedGallery = jest.fn(() => Promise.resolve());
        scraper.failRun = jest.fn();

        await GrokScraper.prototype.executeDetailView.call(scraper, 'run-1');

        expect(scraper.waitForMatchingLegacyDetailMedia).toHaveBeenCalledWith(mediaId, 'run-1');
        expect(scraper.performDownload).toHaveBeenCalledWith(media, currentItemId, 'run-1');
        expect(scraper.persistProcessedId).toHaveBeenCalledWith(currentItemId, 'run-1');
        expect(scraper._runVisited).toContain(currentItemId);
        expect(scraper.returnToSavedGallery).toHaveBeenCalledWith('run-1');
        expect(scraper.failRun).not.toHaveBeenCalled();
    });

    test('fails closed when legacy detail does not expose the selected Saved media', async () => {
        mockContentChrome();
        const scraper = createScraper(SCRAPE_SURFACES.legacyDetail);
        const mediaId = '58585858-5858-4858-8858-585858585858';
        const currentItemId = `https://assets.grok.com/users/u/generated/${mediaId}/image.jpg`;
        scraper.state.isRunning = true;
        scraper.runToken = 'run-1';
        scraper.pendingNavigation = {
            runToken: 'run-1',
            runEpoch: 1,
            expectedIdentity: mediaId,
            currentItemId
        };
        chrome.storage.local.get.mockResolvedValue({ currentItemId });
        scraper.waitForMatchingLegacyDetailMedia = jest.fn(() => Promise.resolve(null));
        scraper.performDownload = jest.fn();
        scraper.persistProcessedId = jest.fn();
        scraper.returnToSavedGallery = jest.fn();
        scraper.failRun = jest.fn(() => Promise.resolve());

        await GrokScraper.prototype.executeDetailView.call(scraper, 'run-1');

        expect(scraper.failRun).toHaveBeenCalledWith(
            'Legacy detail view did not expose the selected Saved media.',
            'legacy_media_missing'
        );
        expect(scraper.performDownload).not.toHaveBeenCalled();
        expect(scraper.persistProcessedId).not.toHaveBeenCalled();
        expect(scraper.returnToSavedGallery).not.toHaveBeenCalled();
    });

    test('does not persist or return when Stop wins a legacy detail transfer', async () => {
        mockContentChrome();
        const scraper = createScraper(SCRAPE_SURFACES.legacyDetail);
        const mediaId = '69696969-6969-4969-8969-696969696969';
        const currentItemId = `https://assets.grok.com/users/u/generated/${mediaId}/image.jpg`;
        const media = document.createElement('img');
        scraper.state.isRunning = true;
        scraper.runToken = 'run-1';
        scraper.pendingNavigation = {
            runToken: 'run-1',
            runEpoch: 1,
            expectedIdentity: mediaId,
            currentItemId
        };
        chrome.storage.local.get.mockResolvedValue({ currentItemId });
        scraper.waitForMatchingLegacyDetailMedia = jest.fn(() => Promise.resolve(media));
        scraper.performDownload = jest.fn(async () => {
            scraper.runToken = 'run-2';
            return { status: 'uploaded' };
        });
        scraper.persistProcessedId = jest.fn();
        scraper.returnToSavedGallery = jest.fn();

        await GrokScraper.prototype.executeDetailView.call(scraper, 'run-1');

        expect(scraper.persistProcessedId).not.toHaveBeenCalled();
        expect(scraper.returnToSavedGallery).not.toHaveBeenCalled();
    });

    test('restores the Saved scroll position and clears only navigation state', async () => {
        mockContentChrome();
        const scraper = createScraper();
        const sourceId = '84848484-aaaa-4bbb-8ccc-c3c3c3c3c3c3';
        window.history.pushState({}, '', '/imagine/saved');
        const scroller = document.createElement('div');
        scroller.style.overflowY = 'scroll';
        Object.defineProperties(scroller, {
            scrollHeight: { configurable: true, value: 2200 },
            clientHeight: { configurable: true, value: 800 }
        });
        const list = document.createElement('div');
        list.setAttribute('role', 'list');
        const card = document.createElement('article');
        card.setAttribute('role', 'listitem');
        const image = document.createElement('img');
        image.alt = 'Generated image';
        image.src = `https://assets.grok.com/users/u/generated/${sourceId}/image.jpg`;
        card.appendChild(image);
        list.appendChild(card);
        scroller.appendChild(list);
        document.body.appendChild(scroller);
        scraper.state.isRunning = true;
        scraper.runToken = 'run-1';
        scraper.pendingNavigation = {
            runToken: 'run-1',
            runEpoch: 1,
            expectedIdentity: sourceId,
            galleryScrollTop: 840,
            currentItemId: 'gallery-clean-id',
            savedViewportReceipt: {
                version: 3,
                sourceIdentity: sourceId,
                expectedNextIdentity: null,
                beforeIdentities: [],
                afterIdentities: [],
                visibleIdentities: [sourceId],
                origin: { pathname: '/imagine/saved', conversationId: '', scope: 'all' },
                scrollTop: 840
            }
        };
        scraper.sleep = jest.fn(() => Promise.resolve());

        await GrokScraper.prototype.restorePendingGalleryContext.call(scraper, 'run-1');

        expect(scroller.scrollTop).toBe(840);
        expect(scraper.pendingNavigation).toBeNull();
        expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
            action: 'SCRAPE_RUN_STATE_WRITE',
            values: { scrapeNavigation: null, currentItemId: null }
        }));
    });

    test('waits for the semantic Saved neighborhood and persisted cleanup before clearing its receipt', async () => {
        mockContentChrome();
        const scraper = createScraper();
        const sourceId = '95959595-aaaa-4bbb-8ccc-d4d4d4d4d4d4';
        const nextId = 'a6a6a6a6-bbbb-4ccc-8ddd-e5e5e5e5e5e5';
        scraper.state.isRunning = true;
        scraper.runToken = 'run-1';
        scraper.pendingNavigation = {
            runToken: 'run-1',
            runEpoch: 1,
            currentItemId: 'gallery-clean-id',
            expectedIdentity: sourceId,
            galleryUrl: 'https://grok.com/imagine/saved',
            savedViewportReceipt: {
                version: 3,
                sourceIdentity: sourceId,
                expectedNextIdentity: nextId,
                beforeIdentities: [],
                afterIdentities: [nextId],
                visibleIdentities: [sourceId, nextId],
                origin: { pathname: '/imagine/saved', conversationId: '', scope: 'all' },
                scrollTop: 840
            }
        };

        const unrelatedScroller = document.createElement('div');
        unrelatedScroller.className = 'overflow-scroll';
        unrelatedScroller.scrollTop = 123;
        const galleryScroller = document.createElement('div');
        galleryScroller.className = 'h-dvh overflow-scroll items-center';
        galleryScroller.style.overflowY = 'scroll';
        galleryScroller.scrollTop = 0;
        Object.defineProperties(galleryScroller, {
            scrollHeight: { configurable: true, value: 2400 },
            clientHeight: { configurable: true, value: 800 }
        });
        const list = document.createElement('div');
        list.setAttribute('role', 'list');
        const appendCard = (mediaId) => {
            const card = document.createElement('article');
            card.setAttribute('role', 'listitem');
            const image = document.createElement('img');
            image.alt = 'Generated image';
            image.src = `https://assets.grok.com/users/u/generated/${mediaId}/image.jpg`;
            card.appendChild(image);
            list.appendChild(card);
        };
        appendCard('b7b7b7b7-cccc-4ddd-8eee-f6f6f6f6f6f6');
        galleryScroller.appendChild(list);
        document.body.append(unrelatedScroller, galleryScroller);

        let sleepCount = 0;
        scraper.sleep = jest.fn(async () => {
            sleepCount++;
            if (sleepCount === 1) appendCard(sourceId);
            if (sleepCount === 2) appendCard(nextId);
        });
        const cleanupWrite = deferred();
        const cleanupStarted = deferred();
        chrome.runtime.sendMessage.mockImplementation((message) => {
            if (message.action === 'SCRAPE_RUN_STATE_WRITE'
                && message.values?.scrapeNavigation === null) {
                cleanupStarted.resolve();
                return cleanupWrite.promise;
            }
            return Promise.resolve({ status: 'ok' });
        });

        const restoring = GrokScraper.prototype.restorePendingGalleryContext.call(scraper, 'run-1');
        await cleanupStarted.promise;

        expect(galleryScroller.scrollTop).toBe(840);
        expect(unrelatedScroller.scrollTop).toBe(123);
        expect(sleepCount).toBeGreaterThanOrEqual(2);
        expect(scraper.pendingNavigation).not.toBeNull();

        cleanupWrite.resolve({ status: 'ok' });
        await restoring;

        expect(scraper.pendingNavigation).toBeNull();
    });

    test('reapplies the Saved receipt when restoring scroll remounts the semantic scroller', async () => {
        mockContentChrome();
        const scraper = createScraper();
        const sourceId = 'a7a7a7a7-bbbb-4ccc-8ddd-e6e6e6e6e6e6';
        const nextId = 'b8b8b8b8-cccc-4ddd-8eee-f7f7f7f7f7f7';
        window.history.pushState({}, '', '/imagine/saved');
        scraper.state.isRunning = true;
        scraper.runToken = 'run-1';
        scraper.pendingNavigation = {
            runToken: 'run-1',
            runEpoch: 1,
            currentItemId: 'gallery-clean-id',
            savedViewportReceipt: {
                version: 3,
                sourceIdentity: sourceId,
                expectedNextIdentity: nextId,
                beforeIdentities: [],
                afterIdentities: [nextId],
                visibleIdentities: [sourceId, nextId],
                origin: { pathname: '/imagine/saved', conversationId: '', scope: 'all' },
                scrollTop: 730
            }
        };

        const createScroller = () => {
            const scroller = document.createElement('div');
            scroller.style.overflowY = 'scroll';
            Object.defineProperties(scroller, {
                scrollHeight: { configurable: true, value: 2200 },
                clientHeight: { configurable: true, value: 800 }
            });
            const list = document.createElement('div');
            list.setAttribute('role', 'list');
            for (const mediaId of [sourceId, nextId]) {
                const card = document.createElement('article');
                card.setAttribute('role', 'listitem');
                const image = document.createElement('img');
                image.alt = 'Generated image';
                image.src = `https://assets.grok.com/users/u/generated/${mediaId}/image.jpg`;
                card.appendChild(image);
                list.appendChild(card);
            }
            scroller.appendChild(list);
            return scroller;
        };

        const originalScroller = createScroller();
        let replacementScroller = null;
        originalScroller.addEventListener('scroll', () => {
            replacementScroller = createScroller();
            originalScroller.replaceWith(replacementScroller);
        }, { once: true });
        document.body.appendChild(originalScroller);
        scraper.sleep = jest.fn().mockResolvedValue();

        await GrokScraper.prototype.restorePendingGalleryContext.call(scraper, 'run-1');

        expect(replacementScroller).not.toBeNull();
        expect(replacementScroller.scrollTop).toBe(730);
        expect(scraper.sleep).toHaveBeenCalled();
        expect(scraper.pendingNavigation).toBeNull();
    });

    test('falls back to the captured Saved URL when browser history does not return', async () => {
        const scraper = createScraper(SCRAPE_SURFACES.agentMedia);
        scraper.state.isRunning = true;
        scraper.runToken = 'run-1';
        scraper.pendingNavigation = {
            runToken: 'run-1',
            runEpoch: 1,
            galleryUrl: 'https://grok.com/imagine/saved'
        };
        scraper.log = jest.fn();
        scraper.waitForSurface = jest.fn(() => Promise.resolve(null));
        scraper.navigateToGalleryUrl = jest.fn();
        scraper.failRun = jest.fn();
        const backSpy = jest.spyOn(window.history, 'back').mockImplementation(() => {});

        await GrokScraper.prototype.returnToSavedGallery.call(scraper, 'run-1');

        expect(backSpy).toHaveBeenCalledTimes(1);
        expect(scraper.navigateToGalleryUrl).toHaveBeenCalledWith('https://grok.com/imagine/saved');
        expect(scraper.failRun).not.toHaveBeenCalled();
        backSpy.mockRestore();
    });

    test('restores the Saved viewport before completing a successful backup canary', async () => {
        const scraper = createScraper(SCRAPE_SURFACES.agentMedia);
        scraper.state.isRunning = true;
        scraper.runToken = 'run-1';
        scraper.backupMode = true;
        scraper.pendingNavigation = {
            runToken: 'run-1',
            runEpoch: 1,
            galleryUrl: 'https://grok.com/imagine/saved'
        };
        const order = [];
        scraper.waitForSurface = jest.fn(() => Promise.resolve(SCRAPE_SURFACES.savedGallery));
        scraper.restorePendingGalleryContext = jest.fn(async () => {
            order.push('restore');
            return true;
        });
        scraper.stopBackupMode = jest.fn(async () => {
            order.push('stop');
        });
        const backSpy = jest.spyOn(window.history, 'back').mockImplementation(() => {});

        await GrokScraper.prototype.returnToSavedGallery.call(scraper, 'run-1', {
            stopBackupReason: 'canary_complete'
        });

        expect(order).toEqual(['restore', 'stop']);
        expect(scraper.stopBackupMode).toHaveBeenCalledWith('canary_complete');
        expect(scraper.determineModeAndExecute).not.toHaveBeenCalled();
        backSpy.mockRestore();
    });

    test('does not navigate after Stop wins during the history wait', async () => {
        const scraper = createScraper(SCRAPE_SURFACES.agentMedia);
        scraper.state.isRunning = true;
        scraper.runToken = 'run-1';
        scraper.pendingNavigation = {
            runToken: 'run-1',
            runEpoch: 1,
            galleryUrl: 'https://grok.com/imagine/saved'
        };
        scraper.waitForSurface = jest.fn(async () => {
            scraper.runToken = 'run-2';
            return null;
        });
        scraper.navigateToGalleryUrl = jest.fn();
        const backSpy = jest.spyOn(window.history, 'back').mockImplementation(() => {});

        await GrokScraper.prototype.returnToSavedGallery.call(scraper, 'run-1');

        expect(scraper.navigateToGalleryUrl).not.toHaveBeenCalled();
        backSpy.mockRestore();
    });

    test.each([
        ['normal Sync', false],
        ['R2 backup', true]
    ])('Stop returns %s from an open media surface to Saved without resuming', async (_label, backupMode) => {
        mockContentChrome();
        let surface = SCRAPE_SURFACES.legacyDetail;
        const scraper = createScraper();
        scraper.state.isRunning = true;
        scraper.runToken = 'run-1';
        scraper.runEpoch = 4;
        scraper.backupMode = backupMode;
        scraper.pendingNavigation = {
            runToken: 'run-1',
            runEpoch: 4,
            galleryUrl: 'https://grok.com/imagine/saved'
        };
        scraper.getCurrentSurface.mockImplementation(() => surface);
        scraper.sleep = jest.fn().mockResolvedValue();
        scraper.determineModeAndExecute = jest.fn();
        const backSpy = jest.spyOn(window.history, 'back').mockImplementation(() => {
            surface = SCRAPE_SURFACES.savedGallery;
        });

        const stopMethod = backupMode
            ? GrokScraper.prototype.stopBackupMode
            : GrokScraper.prototype.stop;
        await stopMethod.call(scraper, 'stopped', {
            notifyBackground: false,
            expectedRunToken: 'run-1',
            expectedRunEpoch: 4
        });

        expect(backSpy).toHaveBeenCalledTimes(1);
        expect(scraper.getCurrentSurface()).toBe(SCRAPE_SURFACES.savedGallery);
        expect(scraper.determineModeAndExecute).not.toHaveBeenCalled();
        expect(scraper.state.isRunning).toBe(false);
        expect(scraper.runToken).toBeNull();
        backSpy.mockRestore();
    });

    test('Stop return does not restore a Saved receipt after native scope drift', async () => {
        const sourceId = '72727272-2222-4222-8222-222222222222';
        window.history.pushState({}, '', '/imagine/saved');
        const { scroller } = mountSemanticSavedImage(
            `https://assets.grok.com/users/u/generated/${sourceId}/image.jpg`
        );
        mountSavedScope('liked');
        const scraper = createScraper(SCRAPE_SURFACES.savedGallery);
        scraper.state.isRunning = false;
        scraper.sleep = jest.fn().mockResolvedValue();
        const stopNavigation = {
            runToken: 'run-stop-scope-drift',
            runEpoch: 12,
            galleryUrl: 'https://grok.com/imagine/saved',
            savedViewportReceipt: {
                version: 3,
                sourceIdentity: sourceId,
                expectedNextIdentity: null,
                beforeIdentities: [],
                afterIdentities: [],
                visibleIdentities: [sourceId],
                origin: { pathname: '/imagine/saved', conversationId: '', scope: 'all' },
                scrollTop: 420
            },
            viewportRestored: false,
            returnAlreadyInFlight: false
        };

        await expect(GrokScraper.prototype.returnToSavedAfterStop.call(scraper, stopNavigation))
            .resolves.toBe(true);
        expect(scroller.scrollTop).toBe(0);
    });

    test('a storage tombstone preserves the pending Saved return before invalidating the run', async () => {
        mockContentChrome();
        let surface = SCRAPE_SURFACES.legacyDetail;
        const scraper = createScraper();
        scraper.state.isRunning = true;
        scraper.runToken = 'run-1';
        scraper.runEpoch = 5;
        scraper.pendingNavigation = {
            runToken: 'run-1',
            runEpoch: 5,
            galleryUrl: 'https://grok.com/imagine/saved'
        };
        scraper.getCurrentSurface.mockImplementation(() => surface);
        scraper.sleep = jest.fn().mockResolvedValue();
        scraper._initPromise = Promise.resolve();
        scraper.setupListeners();
        const storageListener = chrome.storage.onChanged.addListener.mock.calls[0][0];
        const backSpy = jest.spyOn(window.history, 'back').mockImplementation(() => {
            surface = SCRAPE_SURFACES.savedGallery;
        });

        storageListener({ scraperState: { oldValue: 'running', newValue: 'idle' } }, 'local');
        await flushAsyncTurns(16);

        expect(backSpy).toHaveBeenCalledTimes(1);
        expect(scraper.getCurrentSurface()).toBe(SCRAPE_SURFACES.savedGallery);
        expect(scraper.state.isRunning).toBe(false);
        backSpy.mockRestore();
    });

    test('a storage tombstone returns a freshly initialized detail page using its old navigation receipt', async () => {
        mockContentChrome();
        let surface = SCRAPE_SURFACES.legacyDetail;
        const scraper = createScraper();
        scraper.runToken = null;
        scraper.runEpoch = null;
        scraper.pendingNavigation = null;
        scraper.getCurrentSurface.mockImplementation(() => surface);
        scraper.sleep = jest.fn().mockResolvedValue();
        scraper._initPromise = Promise.resolve();
        scraper.setupListeners();
        const storageListener = chrome.storage.onChanged.addListener.mock.calls[0][0];
        const backSpy = jest.spyOn(window.history, 'back').mockImplementation(() => {
            surface = SCRAPE_SURFACES.savedGallery;
        });

        storageListener({
            scraperState: { oldValue: 'running', newValue: 'idle' },
            scrapeNavigation: {
                oldValue: {
                    runToken: 'run-1',
                    runEpoch: 7,
                    galleryUrl: 'https://grok.com/imagine/saved'
                },
                newValue: null
            }
        }, 'local');
        await flushAsyncTurns(16);

        expect(backSpy).toHaveBeenCalledTimes(1);
        expect(scraper.getCurrentSurface()).toBe(SCRAPE_SURFACES.savedGallery);
        backSpy.mockRestore();
    });

    test('a storage tombstone identifies a freshly initialized R2 detail page from old backup state', async () => {
        mockContentChrome();
        let surface = SCRAPE_SURFACES.agentMedia;
        const scraper = createScraper();
        scraper.runToken = null;
        scraper.runEpoch = null;
        scraper.pendingNavigation = null;
        scraper.getCurrentSurface.mockImplementation(() => surface);
        scraper.sleep = jest.fn().mockResolvedValue();
        scraper._initPromise = Promise.resolve();
        scraper.stop = jest.fn();
        scraper.setupListeners();
        const storageListener = chrome.storage.onChanged.addListener.mock.calls[0][0];
        const backSpy = jest.spyOn(window.history, 'back').mockImplementation(() => {
            surface = SCRAPE_SURFACES.savedGallery;
        });

        storageListener({
            scraperState: { oldValue: 'running', newValue: 'idle' },
            isR2Backup: { oldValue: true, newValue: false },
            scrapeNavigation: {
                oldValue: {
                    runToken: 'run-r2',
                    runEpoch: 10,
                    galleryUrl: 'https://grok.com/imagine/saved'
                },
                newValue: null
            }
        }, 'local');
        await flushAsyncTurns(16);

        expect(scraper.stop).not.toHaveBeenCalled();
        expect(backSpy).toHaveBeenCalledTimes(1);
        expect(scraper.getCurrentSurface()).toBe(SCRAPE_SURFACES.savedGallery);
        backSpy.mockRestore();
    });

    test('a late abort returns a detail page using the navigation receipt from the background', async () => {
        mockContentChrome();
        let surface = SCRAPE_SURFACES.legacyDetail;
        const scraper = createScraper();
        scraper.runToken = null;
        scraper.runEpoch = null;
        scraper.pendingNavigation = null;
        scraper.getCurrentSurface.mockImplementation(() => surface);
        scraper.sleep = jest.fn().mockResolvedValue();
        const backSpy = jest.spyOn(window.history, 'back').mockImplementation(() => {
            surface = SCRAPE_SURFACES.savedGallery;
        });

        await GrokScraper.prototype.stop.call(scraper, 'stopped', {
            notifyBackground: false,
            expectedRunToken: 'run-1',
            expectedRunEpoch: 8,
            stopNavigation: {
                runToken: 'run-1',
                runEpoch: 8,
                galleryUrl: 'https://grok.com/imagine/saved'
            }
        });

        expect(backSpy).toHaveBeenCalledTimes(1);
        expect(scraper.getCurrentSurface()).toBe(SCRAPE_SURFACES.savedGallery);
        backSpy.mockRestore();
    });

    test('a late R2 abort returns a detail page using the navigation receipt from the background', async () => {
        mockContentChrome();
        let surface = SCRAPE_SURFACES.agentMedia;
        const scraper = createScraper();
        scraper.runToken = null;
        scraper.runEpoch = null;
        scraper.pendingNavigation = null;
        scraper.getCurrentSurface.mockImplementation(() => surface);
        scraper.sleep = jest.fn().mockResolvedValue();
        const backSpy = jest.spyOn(window.history, 'back').mockImplementation(() => {
            surface = SCRAPE_SURFACES.savedGallery;
        });

        await GrokScraper.prototype.stopBackupMode.call(scraper, 'stopped', {
            notifyBackground: false,
            expectedRunToken: 'run-r2',
            expectedRunEpoch: 9,
            stopNavigation: {
                runToken: 'run-r2',
                runEpoch: 9,
                galleryUrl: 'https://grok.com/imagine/saved'
            }
        });

        expect(backSpy).toHaveBeenCalledTimes(1);
        expect(scraper.getCurrentSurface()).toBe(SCRAPE_SURFACES.savedGallery);
        backSpy.mockRestore();
    });

    test('Stop does not issue a second Back while the normal Saved return is already in flight', async () => {
        mockContentChrome();
        let surface = SCRAPE_SURFACES.legacyDetail;
        const scraper = createScraper();
        scraper.state.isRunning = true;
        scraper.runToken = 'run-1';
        scraper.runEpoch = 6;
        scraper.pendingNavigation = {
            runToken: 'run-1',
            runEpoch: 6,
            galleryUrl: 'https://grok.com/imagine/saved'
        };
        scraper._returnToSavedInFlight = {
            runToken: 'run-1',
            runEpoch: 6,
            galleryUrl: 'https://grok.com/imagine/saved'
        };
        scraper.getCurrentSurface.mockImplementation(() => surface);
        scraper.sleep = jest.fn(async () => {
            surface = SCRAPE_SURFACES.savedGallery;
        });
        const backSpy = jest.spyOn(window.history, 'back').mockImplementation(() => {});

        await GrokScraper.prototype.stop.call(scraper, 'stopped', {
            notifyBackground: false,
            expectedRunToken: 'run-1',
            expectedRunEpoch: 6
        });

        expect(backSpy).not.toHaveBeenCalled();
        expect(scraper.getCurrentSurface()).toBe(SCRAPE_SURFACES.savedGallery);
        backSpy.mockRestore();
    });

    test('duplicate receipt-bearing Stop delivery reuses the first cleanup transaction', async () => {
        mockContentChrome();
        const scraper = createScraper(SCRAPE_SURFACES.legacyDetail);
        scraper.state.isRunning = true;
        scraper.runToken = 'run-duplicate-stop';
        scraper.runEpoch = 11;
        scraper.pendingNavigation = {
            runToken: 'run-duplicate-stop',
            runEpoch: 11,
            galleryUrl: 'https://grok.com/imagine/saved'
        };
        scraper.returnToSavedAfterStop = jest.fn().mockResolvedValue(true);
        const options = {
            notifyBackground: false,
            expectedRunToken: 'run-duplicate-stop',
            expectedRunEpoch: 11,
            stopNavigation: scraper.pendingNavigation
        };

        await GrokScraper.prototype.stop.call(scraper, 'stopped', options);
        await GrokScraper.prototype.stop.call(scraper, 'stopped', options);

        expect(scraper.returnToSavedAfterStop).toHaveBeenCalledTimes(1);
    });

    test('does not record backup success after Stop wins during upload', async () => {
        mockContentChrome();
        const scraper = createScraper(SCRAPE_SURFACES.agentMedia);
        scraper.state.isRunning = true;
        scraper.runToken = 'run-1';
        scraper.backupMode = true;
        scraper.backupOptions = {};
        scraper.backupStats = { totalSeen: 1, uploaded: 0, alreadyPresent: 0, queued: 0, errors: 0 };
        scraper.persistBackupProgress = jest.fn();
        const media = document.createElement('img');
        media.src = 'https://assets.grok.com/users/u/73e5e137-1334-49ea-b06b-a9d9ba891003/content';
        document.addEventListener('__gpt_fetch_media', (event) => {
            document.dispatchEvent(new CustomEvent('__gpt_fetch_media_result', {
                detail: { requestId: event.detail.requestId, dataUrl: 'data:image/png;base64,AA==' }
            }));
        }, { once: true });
        chrome.runtime.sendMessage.mockImplementation(async () => {
            scraper.runToken = 'run-2';
            return { status: 'uploaded', backupProcessedId: 'asset-id' };
        });

        const response = await GrokScraper.prototype.performBackupUpload.call(
            scraper,
            media,
            'gallery-clean-id',
            'run-1'
        );

        expect(response).toEqual({ status: 'error', error: 'Backup stopped.' });
        expect(scraper.backupStats.uploaded).toBe(0);
        expect(chrome.storage.local.get).not.toHaveBeenCalled();
        expect(scraper.persistBackupProgress).not.toHaveBeenCalled();
    });

    test('counts queued backup acceptance without persisting content-side processed IDs', async () => {
        mockContentChrome();
        const scraper = createScraper(SCRAPE_SURFACES.agentMedia);
        scraper.state.isRunning = true;
        scraper.runToken = 'run-1';
        scraper.backupMode = true;
        scraper.backupOptions = {};
        scraper.backupStats = { totalSeen: 1, uploaded: 0, alreadyPresent: 0, queued: 0, errors: 0 };
        scraper.persistBackupProgress = jest.fn(() => Promise.resolve(true));
        const media = document.createElement('img');
        media.src = 'https://assets.grok.com/users/11111111-1111-4111-8111-111111111111/generated/22222222-2222-4222-8222-222222222222/image.jpg?request=33333333-3333-4333-8333-333333333333';
        document.addEventListener('__gpt_fetch_media', (event) => {
            document.dispatchEvent(new CustomEvent('__gpt_fetch_media_result', {
                detail: { requestId: event.detail.requestId, dataUrl: 'data:image/png;base64,AA==', size: 1 }
            }));
        }, { once: true });
        chrome.runtime.sendMessage.mockResolvedValue({ status: 'queued' });

        await expect(GrokScraper.prototype.performBackupUpload.call(
            scraper,
            media,
            'saved-media-url',
            'run-1'
        )).resolves.toEqual({ status: 'queued' });

        expect(scraper.backupStats).toMatchObject({ queued: 1, errors: 0 });
        expect(scraper.processedIds).toEqual(new Set());
        expect(chrome.storage.local.get).not.toHaveBeenCalled();
        expect(chrome.storage.local.set).not.toHaveBeenCalledWith(expect.objectContaining({
            processedIds: expect.any(Array)
        }));
    });

    test('routes durable backup identities through the background writer', async () => {
        mockContentChrome();
        const scraper = createScraper(SCRAPE_SURFACES.agentMedia);
        scraper.state.isRunning = true;
        scraper.runToken = 'run-1';
        scraper.backupMode = true;
        scraper.backupOptions = {};
        scraper.backupStats = { totalSeen: 1, uploaded: 0, alreadyPresent: 0, queued: 0, errors: 0 };
        scraper.persistBackupProgress = jest.fn(() => Promise.resolve(true));
        const mediaId = '22222222-2222-4222-8222-222222222222';
        const media = document.createElement('img');
        media.src = `https://assets.grok.com/users/11111111-1111-4111-8111-111111111111/generated/${mediaId}/image.jpg?request=33333333-3333-4333-8333-333333333333`;
        document.addEventListener('__gpt_fetch_media', (event) => {
            document.dispatchEvent(new CustomEvent('__gpt_fetch_media_result', {
                detail: { requestId: event.detail.requestId, dataUrl: 'data:image/png;base64,AA==', size: 1 }
            }));
        }, { once: true });
        chrome.runtime.sendMessage.mockImplementation(async (message) => {
            if (message.action === 'R2_BACKUP_UPLOAD') {
                return { status: 'uploaded', backupProcessedId: mediaId };
            }
            if (message.action === 'SCRAPE_PROCESSED_IDS_ADD') {
                return { status: 'ok', processedIds: ['saved-media-url', media.src.split('?')[0], mediaId] };
            }
            return undefined;
        });

        await expect(GrokScraper.prototype.performBackupUpload.call(
            scraper,
            media,
            'saved-media-url',
            'run-1'
        )).resolves.toEqual({ status: 'uploaded', backupProcessedId: mediaId });

        expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
            action: 'SCRAPE_PROCESSED_IDS_ADD',
            ids: ['saved-media-url', media.src.split('?')[0], mediaId],
            runToken: 'run-1',
            runEpoch: 1,
            kind: 'r2_backup'
        });
        expect(scraper.processedIds).toEqual(new Set(['saved-media-url', media.src.split('?')[0], mediaId]));
        expect(chrome.storage.local.set).not.toHaveBeenCalledWith(expect.objectContaining({
            processedIds: expect.any(Array)
        }));
    });

    test('sends authenticated media data for Cloud only Agent transfers', async () => {
        mockContentChrome();
        const scraper = createScraper(SCRAPE_SURFACES.agentMedia);
        scraper.state.isRunning = true;
        scraper.runToken = 'run-1';
        scraper.overlay = { readCurrentPromptInput: jest.fn(() => 'saved prompt') };
        const media = document.createElement('img');
        media.src = 'https://assets.grok.com/users/u/73e5e137-1334-49ea-b06b-a9d9ba891003/content';
        document.addEventListener('__gpt_fetch_media', (event) => {
            document.dispatchEvent(new CustomEvent('__gpt_fetch_media_result', {
                detail: { requestId: event.detail.requestId, dataUrl: 'data:image/png;base64,AA==' }
            }));
        }, { once: true });
        chrome.runtime.sendMessage.mockImplementation(async (message) => {
            if (message.action === 'GET_CLOUD_CONFIG') return { config: { mode: 'cloud_only' } };
            return { status: 'uploaded' };
        });

        await expect(GrokScraper.prototype.performDownload.call(
            scraper,
            media,
            'gallery-clean-id',
            'run-1'
        )).resolves.toEqual({ status: 'uploaded' });

        expect(chrome.runtime.sendMessage).toHaveBeenLastCalledWith({
            action: 'DOWNLOAD_MEDIA',
            url: media.src,
            isVideo: false,
            promptText: 'saved prompt',
            blobDataUrl: 'data:image/png;base64,AA==',
            runToken: 'run-1',
            runEpoch: 1,
            kind: 'sync'
        });
    });

    test('keeps local Agent transfers on the native download path without bridge data', async () => {
        mockContentChrome();
        const scraper = createScraper(SCRAPE_SURFACES.agentMedia);
        scraper.state.isRunning = true;
        scraper.runToken = 'run-1';
        const media = document.createElement('video');
        media.src = 'https://assets.grok.com/videos/73e5e137-1334-49ea-b06b-a9d9ba891003/generated_video.mp4';
        chrome.runtime.sendMessage.mockImplementation(async (message) => {
            if (message.action === 'GET_CLOUD_CONFIG') return { config: { mode: 'local_only' } };
            return { status: 'queued' };
        });

        await expect(GrokScraper.prototype.performDownload.call(
            scraper,
            media,
            'gallery-clean-id',
            'run-1'
        )).resolves.toEqual({ status: 'queued' });

        expect(chrome.runtime.sendMessage).toHaveBeenLastCalledWith({
            action: 'DOWNLOAD_MEDIA',
            url: media.src,
            isVideo: true,
            promptText: '',
            blobDataUrl: null,
            runToken: 'run-1',
            runEpoch: 1,
            kind: 'sync'
        });
    });
});

describe('Grok backup resume state', () => {
    afterEach(() => {
        delete global.chrome;
        document.body.textContent = '';
    });

    test('restores backup mode, options, counters, and pending navigation after a page load', async () => {
        const stored = {
            scraperState: 'running',
            currentIndex: 4,
            processedIds: ['existing-id'],
            scrapeRunToken: 'run-1',
            scrapeRunEpoch: 4,
            scrapeNavigation: {
                runToken: 'run-1',
                runEpoch: 4,
                expectedIdentity: '73e5e137-1334-49ea-b06b-a9d9ba891003'
            },
            scrapeBackupOptions: { mode: 'full', limit: null, options: {} },
            isR2Backup: true,
            r2BackupState: { isRunning: true, totalSeen: 7, uploaded: 5, alreadyPresent: 2, queued: 0, errors: 0 }
        };
        mockContentChrome();
        chrome.storage.local.get.mockResolvedValue(stored);
        const scraper = Object.create(GrokScraper.prototype);
        scraper.state = { isRunning: false, currentIndex: 0, mode: 'IDLE' };
        scraper.backupMode = false;
        scraper.backupOptions = { mode: 'full', limit: null, options: {} };
        scraper.backupStats = { totalSeen: 0, uploaded: 0, alreadyPresent: 0, queued: 0, errors: 0 };
        scraper.processedIds = new Set();
        scraper.determineModeAndExecute = jest.fn();
        scraper.setupListeners = jest.fn();

        await GrokScraper.prototype.init.call(scraper);

        expect(scraper.backupMode).toBe(true);
        expect(scraper.backupOptions).toEqual(stored.scrapeBackupOptions);
        expect(scraper.backupStats).toMatchObject({ totalSeen: 7, uploaded: 5, alreadyPresent: 2 });
        expect(scraper.pendingNavigation).toEqual(stored.scrapeNavigation);
        expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
            action: 'VALIDATE_SCRAPE_RESUME',
            runToken: 'run-1',
            runEpoch: 4,
            kind: 'r2_backup'
        });
        expect(scraper.determineModeAndExecute).toHaveBeenCalledWith('run-1', 4);
        expect(scraper.setupListeners).toHaveBeenCalledTimes(1);
    });

    test('clears a persisted run when the current extension session does not own its token', async () => {
        const stored = {
            scraperState: 'running',
            currentIndex: 2,
            processedIds: ['existing-id'],
            scrapeRunToken: 'stale-run',
            scrapeRunEpoch: 3,
            scrapeNavigation: { runToken: 'stale-run', runEpoch: 3, currentItemId: 'gallery-clean-id' },
            isR2Backup: false
        };
        mockContentChrome();
        chrome.storage.local.get.mockResolvedValue(stored);
        chrome.runtime.sendMessage.mockResolvedValue({ valid: false });
        const scraper = Object.create(GrokScraper.prototype);
        scraper.state = { isRunning: false, currentIndex: 0, mode: 'IDLE' };
        scraper.backupMode = false;
        scraper.backupOptions = { mode: 'full', limit: null, options: {} };
        scraper.backupStats = { totalSeen: 0, uploaded: 0, alreadyPresent: 0, queued: 0, errors: 0 };
        scraper.processedIds = new Set();
        scraper.determineModeAndExecute = jest.fn();
        scraper.setupListeners = jest.fn();
        scraper.log = jest.fn();

        await GrokScraper.prototype.init.call(scraper);

        expect(scraper.determineModeAndExecute).not.toHaveBeenCalled();
        expect(scraper.state.isRunning).toBe(false);
        expect(chrome.storage.local.set).not.toHaveBeenCalled();
        expect(scraper.processedIds).toEqual(new Set(['existing-id']));
    });

    test('a non-owner Grok tab clears only its own memory and preserves the owner local mirror', async () => {
        const stored = {
            scraperState: 'running',
            currentIndex: 2,
            processedIds: ['existing-id'],
            scrapeRunToken: 'owner-run',
            scrapeRunEpoch: 7,
            scrapeNavigation: { runToken: 'owner-run', runEpoch: 7, currentItemId: 'owner-item' },
            isScraping: true,
            isR2Backup: false
        };
        mockContentChrome();
        chrome.storage.local.get.mockResolvedValue(stored);
        chrome.runtime.sendMessage.mockResolvedValue({ valid: false, reason: 'non_owner' });
        const scraper = Object.create(GrokScraper.prototype);
        scraper.state = { isRunning: false, currentIndex: 0, mode: 'IDLE' };
        scraper.backupMode = false;
        scraper.backupOptions = { mode: 'full', limit: null, options: {} };
        scraper.backupStats = { totalSeen: 0, uploaded: 0, alreadyPresent: 0, queued: 0, errors: 0 };
        scraper.processedIds = new Set();
        scraper._runStateWriteQueue = Promise.resolve();
        scraper.determineModeAndExecute = jest.fn();
        scraper.setupListeners = jest.fn();

        await GrokScraper.prototype.init.call(scraper);

        expect(scraper.determineModeAndExecute).not.toHaveBeenCalled();
        expect(scraper.state.isRunning).toBe(false);
        expect(chrome.storage.local.set).not.toHaveBeenCalled();
        expect(stored).toMatchObject({
            scraperState: 'running',
            scrapeRunToken: 'owner-run',
            scrapeRunEpoch: 7,
            currentIndex: 2
        });
    });

    test('stale R2 cleanup cannot re-spread a hydrated running flag over false', async () => {
        const stored = {
            scraperState: 'running',
            currentIndex: 3,
            scrapeRunToken: 'stale-backup',
            scrapeRunEpoch: 8,
            isScraping: true,
            isR2Backup: true,
            r2BackupState: { isRunning: true, uploaded: 4, errors: 1 }
        };
        mockContentChrome();
        chrome.storage.local.get.mockResolvedValue(stored);
        chrome.runtime.sendMessage.mockResolvedValue({ valid: false, reason: 'stale_authority' });
        const scraper = Object.create(GrokScraper.prototype);
        scraper.state = { isRunning: false, currentIndex: 0, mode: 'IDLE' };
        scraper.backupMode = false;
        scraper.backupOptions = { mode: 'full', limit: null, options: {} };
        scraper.backupStats = { totalSeen: 0, uploaded: 0, alreadyPresent: 0, queued: 0, errors: 0 };
        scraper.processedIds = new Set();
        scraper._runStateWriteQueue = Promise.resolve();
        scraper.determineModeAndExecute = jest.fn();
        scraper.setupListeners = jest.fn();

        await GrokScraper.prototype.init.call(scraper);

        expect(chrome.storage.local.set).not.toHaveBeenCalled();
    });

    test('normal stop persists every running flag as idle', async () => {
        mockContentChrome();
        const scraper = createScraper();
        scraper.state.isRunning = true;
        scraper.runToken = 'run-1';

        await GrokScraper.prototype.stop.call(scraper, 'complete');

        expect(chrome.storage.local.set).not.toHaveBeenCalled();
    });

    test('backup Stop writes isRunning false after hydrated counter fields', async () => {
        mockContentChrome();
        const scraper = createScraper();
        scraper.state.isRunning = true;
        scraper.backupMode = true;
        scraper.runToken = 'run-1';
        scraper.runEpoch = 4;
        scraper.backupStats = { isRunning: true, uploaded: 9, errors: 0 };

        await GrokScraper.prototype.stopBackupMode.call(scraper, 'stopped', { notifyBackground: false });

        expect(chrome.storage.local.set).not.toHaveBeenCalled();
    });
});

describe('media transfer success statuses', () => {
    test.each(['queued', 'cloud_queued', 'uploaded', 'already_present', 'conflict_uploaded'])(
        'accepts %s as durable enough to advance the scrape',
        (status) => expect(isSuccessfulMediaTransferStatus(status)).toBe(true)
    );

    test.each(['error', 'not_queued', 'skipped_duplicate', undefined])(
        'rejects %s as a successful transfer',
        (status) => expect(isSuccessfulMediaTransferStatus(status)).toBe(false)
    );
});

describe('Grok run durability completion', () => {
    beforeEach(() => {
        mockContentChrome();
    });

    afterEach(() => {
        jest.useRealTimers();
        delete global.chrome;
        jest.restoreAllMocks();
    });

    test('durability polling preserves queued telemetry and clears current pending work only on durable', async () => {
        const scraper = createScraper();
        scraper.state.isRunning = true;
        scraper.backupMode = true;
        scraper.runToken = 'durability-run';
        scraper.runEpoch = 14;
        scraper.backupStats.queued = 1;
        scraper.persistBackupProgress = jest.fn().mockResolvedValue(true);
        scraper.sleep = jest.fn().mockResolvedValue();
        const responses = [
            {
                status: 'pending',
                inFlightTasks: 1,
                pendingDownloads: 0,
                pendingOperations: 1,
                pendingQueueItems: 0,
                failedItems: 0
            },
            {
                status: 'pending',
                inFlightTasks: 0,
                pendingDownloads: 0,
                pendingOperations: 0,
                pendingQueueItems: 1,
                failedItems: 0
            },
            {
                status: 'durable',
                inFlightTasks: 0,
                pendingDownloads: 0,
                pendingOperations: 0,
                pendingQueueItems: 0,
                failedItems: 0
            }
        ];
        chrome.runtime.sendMessage.mockImplementation((message) => {
            if (message.action === 'GET_SCRAPE_DURABILITY') return Promise.resolve(responses.shift());
            return Promise.resolve({ status: 'ok' });
        });

        await expect(scraper.waitForRunDurability('durability-run', { timeoutMs: 1000, pollMs: 0 }))
            .resolves.toMatchObject({ status: 'durable' });

        expect(chrome.runtime.sendMessage.mock.calls.filter(([message]) => (
            message.action === 'GET_SCRAPE_DURABILITY'
        ))).toHaveLength(3);
        expect(scraper.backupStats).toMatchObject({ queued: 1, pendingTransfers: 0 });
        expect(scraper.persistBackupProgress).toHaveBeenCalledTimes(3);
    });

    test('durability polling times out a query that never settles at the absolute deadline', async () => {
        jest.useFakeTimers();
        const scraper = createScraper();
        scraper.state.isRunning = true;
        scraper.runToken = 'durability-query-timeout';
        scraper.runEpoch = 17;
        const queryStarted = deferred();
        chrome.runtime.sendMessage.mockImplementation((message) => {
            if (message.action === 'GET_SCRAPE_DURABILITY') {
                queryStarted.resolve();
                return new Promise(() => {});
            }
            return Promise.resolve({ status: 'ok' });
        });

        const resultPromise = scraper.waitForRunDurability('durability-query-timeout', {
            timeoutMs: 1000,
            pollMs: 250
        });
        let settled = false;
        resultPromise.finally(() => { settled = true; });
        await queryStarted.promise;
        await jest.advanceTimersByTimeAsync(1000);
        await flushAsyncTurns();

        expect(settled).toBe(true);
        await expect(resultPromise).resolves.toMatchObject({ status: 'timeout' });
    });

    test('durability polling rejects a response that settles after the absolute deadline before its timer callback', async () => {
        jest.useFakeTimers();
        jest.setSystemTime(1000);
        const scraper = createScraper();
        scraper.state.isRunning = true;
        scraper.runToken = 'durability-late-query';
        scraper.runEpoch = 21;
        const query = deferred();
        const queryStarted = deferred();
        chrome.runtime.sendMessage.mockImplementation((message) => {
            if (message.action === 'GET_SCRAPE_DURABILITY') {
                queryStarted.resolve();
                return query.promise;
            }
            return Promise.resolve({ status: 'ok' });
        });

        const resultPromise = scraper.waitForRunDurability('durability-late-query', {
            timeoutMs: 1000,
            pollMs: 250
        });
        await queryStarted.promise;
        jest.setSystemTime(2001);
        query.resolve({
            status: 'durable',
            inFlightTasks: 0,
            pendingDownloads: 0,
            pendingOperations: 0,
            pendingQueueItems: 0,
            failedItems: 0
        });
        await flushAsyncTurns();

        await expect(resultPromise).resolves.toEqual({
            status: 'timeout',
            reason: 'deadline_exceeded'
        });
    });

    test('durability polling times out progress persistence at the same absolute deadline', async () => {
        jest.useFakeTimers();
        const scraper = createScraper();
        scraper.state.isRunning = true;
        scraper.backupMode = true;
        scraper.runToken = 'durability-progress-timeout';
        scraper.runEpoch = 18;
        const progressStarted = deferred();
        scraper.persistBackupProgress = jest.fn(() => {
            progressStarted.resolve();
            return new Promise(() => {});
        });
        chrome.runtime.sendMessage.mockResolvedValue({
            status: 'pending',
            inFlightTasks: 1,
            pendingDownloads: 0,
            pendingOperations: 0,
            pendingQueueItems: 0,
            failedItems: 0
        });

        const resultPromise = scraper.waitForRunDurability('durability-progress-timeout', {
            timeoutMs: 1000,
            pollMs: 250
        });
        let settled = false;
        resultPromise.finally(() => { settled = true; });
        await progressStarted.promise;
        await jest.advanceTimersByTimeAsync(1000);
        await flushAsyncTurns();

        expect(settled).toBe(true);
        await expect(resultPromise).resolves.toMatchObject({ status: 'timeout' });
    });

    test('a never-settling progress write does not poison a subsequent run-state write', async () => {
        jest.useFakeTimers();
        const scraper = createScraper();
        scraper.state.isRunning = true;
        scraper.backupMode = true;
        scraper.runToken = 'progress-write-old';
        scraper.runEpoch = 31;
        const oldWrite = deferred();
        const oldWriteStarted = deferred();
        chrome.runtime.sendMessage.mockImplementation((message) => {
            if (message.action !== 'SCRAPE_RUN_STATE_WRITE') return Promise.resolve({ status: 'ok' });
            if (message.runToken === 'progress-write-old') {
                oldWriteStarted.resolve();
                return oldWrite.promise;
            }
            return Promise.resolve({ status: 'ok' });
        });

        const oldProgress = scraper.persistBackupProgress('progress-write-old', {
            runEpoch: 31,
            invalidationVersion: scraper.getRunInvalidationVersion(),
            timeoutMs: 50
        });
        await oldWriteStarted.promise;
        await jest.advanceTimersByTimeAsync(50);
        scraper.invalidateRunMemory();
        scraper.state.isRunning = true;
        scraper.backupMode = true;
        scraper.runToken = 'progress-write-new';
        scraper.runEpoch = 32;

        const newWrite = scraper.queueRunStateWrite(
            { currentIndex: 7 },
            'save new run state',
            {
                runToken: 'progress-write-new',
                runEpoch: 32,
                invalidationVersion: scraper.getRunInvalidationVersion(),
                timeoutMs: 50
            }
        );
        await flushAsyncTurns();
        const newWriteStartedBeforeOldSettled = chrome.runtime.sendMessage.mock.calls.some(([message]) => (
            message.action === 'SCRAPE_RUN_STATE_WRITE'
            && message.runToken === 'progress-write-new'
        ));
        oldWrite.resolve({ status: 'ok' });
        await jest.runOnlyPendingTimersAsync();
        await Promise.allSettled([oldProgress, newWrite]);

        expect(newWriteStartedBeforeOldSettled).toBe(true);
        await expect(newWrite).resolves.toMatchObject({ ok: true });
    });

    test('Stop and a new run suppress a late progress notification from stale authority', async () => {
        const scraper = createScraper();
        scraper.state.isRunning = true;
        scraper.backupMode = true;
        scraper.runToken = 'late-progress-old';
        scraper.runEpoch = 41;
        scraper.backupStats = {
            totalSeen: 2,
            uploaded: 1,
            alreadyPresent: 0,
            queued: 1,
            pendingTransfers: 1,
            errors: 0
        };
        const oldWrite = deferred();
        const oldWriteStarted = deferred();
        chrome.runtime.sendMessage.mockImplementation((message) => {
            if (message.action === 'SCRAPE_RUN_STATE_WRITE' && message.runToken === 'late-progress-old') {
                oldWriteStarted.resolve();
                return oldWrite.promise;
            }
            return Promise.resolve({ status: 'ok' });
        });

        const oldProgress = scraper.persistBackupProgress('late-progress-old', {
            runEpoch: 41,
            invalidationVersion: scraper.getRunInvalidationVersion(),
            timeoutMs: 1000
        });
        await oldWriteStarted.promise;
        scraper.invalidateRunMemory();
        scraper.state.isRunning = true;
        scraper.backupMode = true;
        scraper.runToken = 'late-progress-new';
        scraper.runEpoch = 42;
        scraper.backupStats = {
            totalSeen: 9,
            uploaded: 8,
            alreadyPresent: 0,
            queued: 1,
            pendingTransfers: 0,
            errors: 0
        };
        oldWrite.resolve({ status: 'ok' });

        await expect(oldProgress).resolves.toBe(false);
        await flushAsyncTurns();
        expect(chrome.runtime.sendMessage).not.toHaveBeenCalledWith(expect.objectContaining({
            action: 'R2_BACKUP_PROGRESS',
            runToken: 'late-progress-old'
        }));
        expect(scraper.backupStats).toMatchObject({ totalSeen: 9, uploaded: 8, pendingTransfers: 0 });
    });

    test('durability polling ignores stale authority when Stop wins during its query', async () => {
        jest.useFakeTimers();
        const scraper = createScraper();
        scraper.state.isRunning = true;
        scraper.runToken = 'durability-query-stop';
        scraper.runEpoch = 19;
        const query = deferred();
        const queryStarted = deferred();
        chrome.runtime.sendMessage.mockImplementation((message) => {
            if (message.action === 'GET_SCRAPE_DURABILITY') {
                queryStarted.resolve();
                return query.promise;
            }
            return Promise.resolve({ status: 'ok' });
        });

        const resultPromise = scraper.waitForRunDurability('durability-query-stop', {
            timeoutMs: 1000,
            pollMs: 250
        });
        await queryStarted.promise;
        scraper.invalidateRunMemory();
        query.resolve({
            status: 'durable',
            inFlightTasks: 0,
            pendingDownloads: 0,
            pendingOperations: 0,
            pendingQueueItems: 0,
            failedItems: 0
        });

        await expect(resultPromise).resolves.toEqual({
            status: 'ignored',
            reason: 'stale_authority'
        });
    });

    test('durability polling ignores stale authority when Stop wins during sleep', async () => {
        jest.useFakeTimers();
        const scraper = createScraper();
        scraper.state.isRunning = true;
        scraper.runToken = 'durability-sleep-stop';
        scraper.runEpoch = 20;
        const sleep = deferred();
        const sleepStarted = deferred();
        scraper.sleep = jest.fn(() => {
            sleepStarted.resolve();
            return sleep.promise;
        });
        chrome.runtime.sendMessage.mockResolvedValue({
            status: 'pending',
            inFlightTasks: 1,
            pendingDownloads: 0,
            pendingOperations: 0,
            pendingQueueItems: 0,
            failedItems: 0
        });

        const resultPromise = scraper.waitForRunDurability('durability-sleep-stop', {
            timeoutMs: 1000,
            pollMs: 250
        });
        await sleepStarted.promise;
        scraper.invalidateRunMemory();
        sleep.resolve();

        await expect(resultPromise).resolves.toEqual({
            status: 'ignored',
            reason: 'stale_authority'
        });
    });

    test.each([
        ['failed', 'durability_failed'],
        ['timeout', 'durability_timeout'],
        ['ignored', 'stale_authority'],
        ['unexpected', 'durability_failed']
    ])('durability status %s maps to non-complete reason %s', async (status, expectedReason) => {
        const scraper = createScraper();
        scraper.state.isRunning = true;
        scraper.runToken = 'durability-map';
        scraper.runEpoch = 15;
        scraper.waitForRunDurability = jest.fn().mockResolvedValue({ status });

        await expect(scraper.getDurableCompletionStopReason('complete', 'durability-map'))
            .resolves.toBe(expectedReason);
    });

    test('nonzero durability pending work keeps queued cumulative and fails backup completion closed', async () => {
        const scraper = createScraper();
        scraper.state.isRunning = true;
        scraper.backupMode = true;
        scraper.runToken = 'durability-failed';
        scraper.runEpoch = 16;
        scraper.backupStats.queued = 1;
        scraper.waitForRunDurability = jest.fn().mockImplementation(async () => {
            scraper.backupStats.pendingTransfers = 1;
            return {
                status: 'failed',
                inFlightTasks: 0,
                pendingDownloads: 0,
                pendingOperations: 1,
                pendingQueueItems: 0,
                failedItems: 1
            };
        });
        scraper.returnToSavedAfterStop = jest.fn().mockResolvedValue(false);

        await scraper.stopBackupMode('complete');

        const completion = chrome.runtime.sendMessage.mock.calls
            .map(([message]) => message)
            .find((message) => message.action === 'R2_BACKUP_COMPLETE');
        expect(completion.stats).toMatchObject({
            stopReason: 'durability_failed',
            queued: 1,
            pendingTransfers: 1
        });
        expect(completion.stats.stopReason).not.toBe('complete');
    });
});

describe('storage stop signals', () => {
    test('normal Sync ignores backup-only state initialization', () => {
        expect(shouldStopScraperForStorageChanges({
            isScraping: { newValue: true },
            isR2Backup: { newValue: false }
        }, false)).toBe(false);
    });

    test('normal Sync stops on its own flag and backup stops on backup flags', () => {
        expect(shouldStopScraperForStorageChanges({ isScraping: { newValue: false } }, false)).toBe(true);
        expect(shouldStopScraperForStorageChanges({ isR2Backup: { newValue: false } }, true)).toBe(true);
        expect(shouldStopScraperForStorageChanges({ r2BackupState: { newValue: { isRunning: false } } }, true)).toBe(true);
    });

    test('both run types stop when the shared scraper state becomes idle', () => {
        const changes = { scraperState: { newValue: 'idle' } };
        expect(shouldStopScraperForStorageChanges(changes, false)).toBe(true);
        expect(shouldStopScraperForStorageChanges(changes, true)).toBe(true);
    });

    test('refreshes scraper processed IDs when background completion updates storage', () => {
        mockContentChrome();
        const scraper = createScraper();
        scraper.setupListeners();
        const storageListener = chrome.storage.onChanged.addListener.mock.calls[0][0];
        const mediaId = '22222222-2222-4222-8222-222222222222';

        storageListener({ processedIds: { newValue: [mediaId] } }, 'local');

        expect(scraper.processedIds).toEqual(new Set([mediaId]));
        expect(scraper.isMediaProcessed(
            `https://assets.grok.com/users/11111111-1111-4111-8111-111111111111/generated/${mediaId}/image.jpg?request=33333333-3333-4333-8333-333333333333`
        )).toBe(true);
        delete global.chrome;
    });

    test('an immediate INIT waits for hydration and a storage Stop cancels it before launch', async () => {
        mockContentChrome();
        const scraper = createScraper();
        const hydration = deferred();
        const sendResponse = jest.fn();
        scraper._initPromise = hydration.promise;
        scraper.setupListeners();
        const runtimeListener = chrome.runtime.onMessage.addListener.mock.calls[0][0];
        const storageListener = chrome.storage.onChanged.addListener.mock.calls[0][0];

        expect(runtimeListener({
            action: 'INIT_SCRAPE',
            runToken: 'pending-sync',
            runEpoch: 11
        }, {}, sendResponse)).toBe(true);
        expect(scraper._pendingInitLease).toEqual({
            kind: 'sync',
            runToken: 'pending-sync',
            runEpoch: 11,
            invalidationVersion: 0
        });

        storageListener({ scraperState: { oldValue: 'running', newValue: 'idle' } }, 'local');
        hydration.resolve();
        await flushAsyncTurns(16);

        expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({
            status: 'error',
            error: 'Start was cancelled.'
        }));
        expect(scraper.determineModeAndExecute).not.toHaveBeenCalled();
        expect(chrome.storage.local.set).not.toHaveBeenCalled();
        delete global.chrome;
    });

    test('a dropped ABORT storage fallback cancels pending R2 cloud validation', async () => {
        mockContentChrome();
        const scraper = createScraper();
        const validation = deferred();
        const sendResponse = jest.fn();
        scraper._initPromise = Promise.resolve();
        chrome.runtime.sendMessage.mockImplementation((message) => {
            if (message.action === 'VALIDATE_CLOUD_CONFIG') return validation.promise;
            if (message.action === 'VALIDATE_SCRAPE_RESUME') {
                return Promise.resolve({ valid: false, reason: 'stale_authority' });
            }
            return Promise.resolve();
        });
        scraper.setupListeners();
        const runtimeListener = chrome.runtime.onMessage.addListener.mock.calls[0][0];
        const storageListener = chrome.storage.onChanged.addListener.mock.calls[0][0];

        expect(runtimeListener({
            action: 'INIT_R2_BACKUP',
            mode: 'full',
            runToken: 'pending-backup',
            runEpoch: 12
        }, {}, sendResponse)).toBe(true);
        await flushAsyncTurns();
        expect(scraper._backupStartPending).toBe(true);

        storageListener({
            scraperState: { oldValue: 'running', newValue: 'idle' },
            isR2Backup: { oldValue: true, newValue: false }
        }, 'local');
        validation.resolve({ valid: true });
        await flushAsyncTurns(20);

        expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({
            status: 'error',
            error: 'Start was cancelled.'
        }));
        expect(scraper.determineModeAndExecute).not.toHaveBeenCalled();
        expect(scraper.state.isRunning).toBe(false);
        expect(chrome.storage.local.set).not.toHaveBeenCalled();
        delete global.chrome;
    });
});

function createBackgroundChrome({
    url = 'https://grok.com/imagine/saved',
    initResponse = null
} = {}) {
    return {
        alarms: {
            clear: jest.fn(() => Promise.resolve()),
            create: jest.fn(() => Promise.resolve()),
            onAlarm: { addListener: jest.fn() }
        },
        downloads: {
            cancel: jest.fn(),
            download: jest.fn((_options, callback) => callback?.(1)),
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
            id: 'extension-id',
            lastError: null,
            getURL: jest.fn((path) => path),
            onMessage: { addListener: jest.fn() },
            sendMessage: jest.fn(() => Promise.resolve())
        },
        scripting: {
            executeScript: jest.fn((_options, callback) => callback?.())
        },
        storage: {
            local: {
                get: jest.fn(() => Promise.resolve({})),
                remove: jest.fn(() => Promise.resolve()),
                set: jest.fn(() => Promise.resolve())
            },
            session: {
                get: jest.fn(() => Promise.resolve({})),
                set: jest.fn(() => Promise.resolve()),
                remove: jest.fn(() => Promise.resolve())
            },
            onChanged: { addListener: jest.fn() }
        },
        tabs: {
            onRemoved: { addListener: jest.fn() },
            onUpdated: { addListener: jest.fn() },
            query: jest.fn((_query, callback) => callback([{ id: 42, url }])),
            remove: jest.fn(),
            sendMessage: jest.fn((_tabId, message, callback) => callback(initResponse || {
                status: 'started',
                surface: 'saved_gallery',
                runToken: message.runToken,
                runEpoch: message.runEpoch
            }))
        }
    };
}

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

async function flushAsyncTurns(count = 8) {
    for (let index = 0; index < count; index++) await Promise.resolve();
}

async function waitForCondition(predicate, attempts = 40) {
    for (let index = 0; index < attempts; index++) {
        if (predicate()) return;
        await Promise.resolve();
    }
    throw new Error('Condition was not reached.');
}

function createLeaseRecord(overrides = {}) {
    return {
        version: 1,
        epoch: 4,
        token: 'run-1',
        tabId: 42,
        kind: 'sync',
        status: 'active',
        startedAt: 1780000000000,
        ...overrides
    };
}

function readSelectedStorage(state, keys) {
    if (keys == null) return { ...state };
    if (typeof keys === 'string') return { [keys]: state[keys] };
    if (Array.isArray(keys)) {
        return keys.reduce((selected, key) => {
            if (Object.prototype.hasOwnProperty.call(state, key)) selected[key] = state[key];
            return selected;
        }, {});
    }
    return Object.keys(keys).reduce((selected, key) => {
        selected[key] = Object.prototype.hasOwnProperty.call(state, key) ? state[key] : keys[key];
        return selected;
    }, {});
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
    return values?.scrapeCompletionTxn?.phase === phase
        || Boolean(findStoredRecord(
            values,
            'scrape_completion_journal',
            (record) => record.phase === phase
        ));
}

function isRunStatePersistence(values, runToken) {
    return values?.scrapeRunToken === runToken
        || Boolean(findStoredRecord(
            values,
            'scrape_run_state_record',
            (record) => record.lease?.token === runToken
        ));
}

function getStoredRunStateRecords(storedLocal, runToken) {
    return Object.values(storedLocal).filter((value) => (
        value?.kind === 'scrape_run_state_record'
        && (!runToken || value.lease?.token === runToken)
    ));
}

function getStoredCompletionJournalEntries(storedLocal) {
    return Object.entries(storedLocal).filter(([, value]) => (
        value?.kind === 'scrape_completion_journal'
    ));
}

function createLeaseBackgroundHarness({
    lease,
    localState = {},
    url = 'https://grok.com/imagine/saved'
} = {}) {
    const sessionState = {};
    if (typeof lease !== 'undefined') sessionState.activeScrapeRunToken = lease;
    const storedLocal = { ...localState };
    const chromeApi = createBackgroundChrome({ url });

    chromeApi.storage.session.get.mockImplementation(async (keys) => readSelectedStorage(sessionState, keys));
    chromeApi.storage.session.set.mockImplementation(async (values) => {
        Object.assign(sessionState, values);
    });
    chromeApi.storage.session.remove.mockImplementation(async (key) => {
        delete sessionState[key];
    });
    chromeApi.storage.local.get.mockImplementation(async (keys) => readSelectedStorage(storedLocal, keys));
    chromeApi.storage.local.remove.mockImplementation(async (keys) => {
        for (const key of Array.isArray(keys) ? keys : [keys]) delete storedLocal[key];
    });
    chromeApi.storage.local.set.mockImplementation(async (values) => {
        Object.assign(storedLocal, values);
    });
    chromeApi.tabs.sendMessage.mockImplementation((_tabId, message, callback) => {
        const response = message.action.startsWith('INIT_')
            ? {
                status: 'started',
                surface: 'saved_gallery',
                runToken: message.runToken,
                runEpoch: message.runEpoch
            }
            : { status: 'stopped' };
        callback(response);
    });

    return { chromeApi, sessionState, storedLocal };
}

function dispatchBackgroundMessage(chromeApi, request, sender = { tab: { id: 42 } }) {
    const listener = chromeApi.runtime.onMessage.addListener.mock.calls[0]?.[0];
    if (!listener) throw new Error('Background message listener was not registered.');
    return new Promise((resolve) => {
        listener(request, sender, resolve);
    });
}

function dispatchBackgroundMessageThroughPort(chromeApi, request, sender = { tab: { id: 42 } }) {
    const listener = chromeApi.runtime.onMessage.addListener.mock.calls[0]?.[0];
    if (!listener) throw new Error('Background message listener was not registered.');
    let resolveResponse;
    const response = new Promise((resolve) => { resolveResponse = resolve; });
    let portOpen = true;
    const returnValue = listener(request, sender, (value) => {
        if (portOpen) resolveResponse(value);
    });
    portOpen = returnValue === true;
    return { returnValue, response };
}

function dispatchLatestBackgroundMessageThroughPort(
    chromeApi,
    request,
    sender = { tab: { id: 42 } }
) {
    const listener = chromeApi.runtime.onMessage.addListener.mock.calls.at(-1)?.[0];
    if (!listener) throw new Error('Background message listener was not registered.');
    let resolveResponse;
    const response = new Promise((resolve) => { resolveResponse = resolve; });
    let portOpen = true;
    const returnValue = listener(request, sender, (value) => {
        if (portOpen) resolveResponse(value);
    });
    portOpen = returnValue === true;
    return { returnValue, response };
}

function dispatchDurabilityMessage(chromeApi, request, sender = { tab: { id: 42 } }) {
    const dispatched = dispatchBackgroundMessageThroughPort(chromeApi, request, sender);
    expect(dispatched.returnValue).toBe(true);
    return dispatched.response;
}

async function seedRunOwnedDownloadOperation({
    mode,
    downloadId,
    mediaId,
    downloadState = 'in_progress',
    r2State
}) {
    const lease = createLeaseRecord();
    const mediaUrl = `https://assets.grok.com/users/account/generated/${mediaId}/image.jpg`;
    const cloudEnabled = mode !== 'local_only';
    const harness = createLeaseBackgroundHarness({
        lease,
        localState: {
            scraperState: 'running',
            scrapeRunToken: lease.token,
            scrapeRunEpoch: lease.epoch,
            isScraping: true,
            isR2Backup: false,
            processedIds: [],
            cloudConfig: {
                enabled: cloudEnabled,
                mode,
                workerUrl: 'https://unit-placeholder.workers.dev',
                apiKey: 'unit-placeholder',
                keyPrefix: 'grok-powertools/v1'
            }
        }
    });
    const downloadItem = {
        id: downloadId,
        url: mediaUrl,
        finalUrl: mediaUrl,
        state: downloadState,
        filename: '/tmp/GrokVault/image.jpg',
        mime: 'image/jpeg'
    };
    let acceptDownload;
    harness.chromeApi.downloads.download.mockImplementation((_options, callback) => {
        acceptDownload = callback;
    });
    harness.chromeApi.downloads.removeFile.mockImplementation((_downloadId, callback) => callback());
    harness.chromeApi.downloads.erase.mockImplementation((_query, callback) => callback());
    harness.chromeApi.downloads.search.mockResolvedValue([downloadItem]);
    global.chrome = harness.chromeApi;
    const background = require('../../background.js');
    await background.ensureBackgroundStateReady();
    await background.ensureScrapeLeaseHydrated();

    const queued = background.queueChromeDownload({ url: mediaUrl }, lease);
    await waitForCondition(() => typeof acceptDownload === 'function');
    const filenameHandling = background.handleDownloadFilename(
        { id: downloadId, url: mediaUrl, filename: 'image.jpg' },
        jest.fn()
    );
    acceptDownload(downloadId);
    await queued;
    await filenameHandling;
    await background.updateDownloadOperation(downloadId, {
        downloadState,
        ...(r2State ? { r2State } : {})
    });

    return { background, downloadItem, harness, lease, mediaId, mediaUrl };
}

async function seedUnrelatedDownloadOperation({
    background,
    harness,
    lease,
    downloadId,
    mediaId
}) {
    const mediaUrl = `https://assets.grok.com/users/account/generated/${mediaId}/image.jpg`;
    let acceptDownload;
    harness.chromeApi.downloads.download.mockImplementation((_options, callback) => {
        acceptDownload = callback;
    });
    const queued = background.queueChromeDownload({ url: mediaUrl }, lease);
    await waitForCondition(() => typeof acceptDownload === 'function');
    const filenameHandling = background.handleDownloadFilename(
        { id: downloadId, url: mediaUrl, filename: 'unrelated.jpg' },
        jest.fn()
    );
    acceptDownload(downloadId);
    await queued;
    await filenameHandling;
    await background.updateDownloadOperation(downloadId, {
        downloadState: 'in_progress',
        r2State: 'pending',
        attempts: 0
    });
}

describe('background scrape lease authority', () => {
    const originalFetch = global.fetch;
    const originalCrypto = global.crypto;
    const originalBlob = global.Blob;

    beforeEach(() => {
        Object.defineProperty(global, 'crypto', { configurable: true, value: webcrypto });
        global.Blob = NodeBlob;
    });

    afterEach(() => {
        jest.useRealTimers();
        global.fetch = originalFetch;
        Object.defineProperty(global, 'crypto', { configurable: true, value: originalCrypto });
        global.Blob = originalBlob;
        delete global.chrome;
        jest.resetModules();
    });

    test('waits for deferred hydration before Stop and cannot resurrect the prior active lease', async () => {
        const oldLease = createLeaseRecord();
        const sessionRead = deferred();
        const harness = createLeaseBackgroundHarness({
            lease: oldLease,
            localState: {
                scraperState: 'running',
                scrapeRunToken: oldLease.token,
                scrapeRunEpoch: oldLease.epoch,
                isScraping: true,
                isR2Backup: false
            }
        });
        harness.chromeApi.storage.session.get.mockImplementationOnce(() => sessionRead.promise);
        global.chrome = harness.chromeApi;
        const background = require('../../background.js');

        const hydration = background.ensureScrapeLeaseHydrated();
        const stop = background.stopScrapeRun('sync');
        await Promise.resolve();
        expect(harness.chromeApi.storage.session.set).not.toHaveBeenCalled();

        sessionRead.resolve({ activeScrapeRunToken: oldLease });
        await hydration;
        await expect(stop).resolves.toMatchObject({ status: 'stopped' });
        await expect(background.validateScrapeResume(oldLease, 42)).resolves.toEqual({
            valid: false,
            reason: 'stale_authority'
        });
        expect(harness.sessionState.activeScrapeRunToken).toMatchObject({
            status: 'idle',
            epoch: oldLease.epoch + 1,
            token: null
        });
    });

    test('keeps an idle tombstone so an older idle signal cannot clear a newer epoch', async () => {
        const harness = createLeaseBackgroundHarness({
            lease: createLeaseRecord({ status: 'idle', token: null, epoch: 8, tabId: null, kind: null })
        });
        global.chrome = harness.chromeApi;
        const background = require('../../background.js');
        await background.ensureScrapeLeaseHydrated();
        const storageListener = harness.chromeApi.storage.onChanged.addListener.mock.calls[0][0];

        storageListener({ scraperState: { oldValue: 'running', newValue: 'idle' } }, 'local');
        const response = await background.initializeScrapeInActiveTab({ action: 'INIT_SCRAPE' });

        expect(response.status).toBe('started');
        expect(harness.sessionState.activeScrapeRunToken).toMatchObject({ status: 'active', epoch: 9 });
        expect(harness.chromeApi.storage.session.remove).not.toHaveBeenCalled();
    });

    test('hydrates a matching active run after worker restart and rejects a second Start', async () => {
        const lease = createLeaseRecord();
        const harness = createLeaseBackgroundHarness({
            lease,
            localState: {
                scraperState: 'running',
                scrapeRunToken: lease.token,
                scrapeRunEpoch: lease.epoch,
                isScraping: true,
                isR2Backup: false
            }
        });
        global.chrome = harness.chromeApi;
        const background = require('../../background.js');

        await background.ensureScrapeLeaseHydrated();
        await expect(background.initializeScrapeInActiveTab({ action: 'INIT_SCRAPE' })).resolves.toMatchObject({
            status: 'error',
            error: 'A sync or backup run is already active.'
        });
        expect(harness.chromeApi.tabs.sendMessage).not.toHaveBeenCalled();
    });

    test.each(['sync', 'r2_backup'])(
        'fails %s closed when the worker restarts before content persists its mirror',
        async (kind) => {
            const lease = createLeaseRecord({ kind });
            const harness = createLeaseBackgroundHarness({
                lease,
                localState: {
                    scraperState: 'idle',
                    scrapeRunToken: null,
                    scrapeRunEpoch: null,
                    isScraping: false,
                    isR2Backup: false
                }
            });
            global.chrome = harness.chromeApi;
            const background = require('../../background.js');

            await background.ensureScrapeLeaseHydrated();

            expect(harness.sessionState.activeScrapeRunToken).toMatchObject({
                status: 'idle',
                epoch: lease.epoch + 1
            });
            await expect(background.validateScrapeResume(lease, lease.tabId)).resolves.toEqual({
                valid: false,
                reason: 'stale_authority'
            });
            expect(harness.chromeApi.tabs.sendMessage).not.toHaveBeenCalled();
        }
    );

    test.each(['sync', 'r2_backup'])(
        'restores %s after content persistence and before background finalization',
        async (kind) => {
            const lease = createLeaseRecord({ kind });
            const harness = createLeaseBackgroundHarness({
                lease,
                localState: {
                    scraperState: 'running',
                    scrapeRunToken: lease.token,
                    scrapeRunEpoch: lease.epoch,
                    scrapeNavigation: null,
                    currentItemId: null,
                    isScraping: true,
                    isR2Backup: kind === 'r2_backup',
                    ...(kind === 'r2_backup' ? { r2BackupState: { isRunning: true } } : {})
                }
            });
            global.chrome = harness.chromeApi;
            const background = require('../../background.js');

            await background.ensureScrapeLeaseHydrated();

            await expect(background.initializeScrapeInActiveTab(
                { action: kind === 'r2_backup' ? 'INIT_R2_BACKUP' : 'INIT_SCRAPE' },
                { backup: kind === 'r2_backup' }
            )).resolves.toMatchObject({
                status: 'error',
                error: 'A sync or backup run is already active.'
            });
            expect(harness.sessionState.activeScrapeRunToken).toEqual(lease);
        }
    );

    test.each(['sync', 'r2_backup'])(
        'restores finalized %s authority after another worker restart',
        async (kind) => {
            const harness = createLeaseBackgroundHarness();
            harness.chromeApi.tabs.sendMessage.mockImplementation((_tabId, message, callback) => {
                if (message.action.startsWith('INIT_')) {
                    Object.assign(harness.storedLocal, {
                        scraperState: 'running',
                        currentIndex: 0,
                        scrapeRunToken: message.runToken,
                        scrapeRunEpoch: message.runEpoch,
                        scrapeNavigation: null,
                        currentItemId: null,
                        scrapeBackupOptions: kind === 'r2_backup' ? { mode: 'full' } : null,
                        isScraping: true,
                        isR2Backup: kind === 'r2_backup',
                        ...(kind === 'r2_backup' ? { r2BackupState: { isRunning: true } } : {})
                    });
                    callback({
                        status: 'started',
                        surface: 'saved_gallery',
                        runToken: message.runToken,
                        runEpoch: message.runEpoch
                    });
                    return;
                }
                callback({ status: 'stopped' });
            });
            global.chrome = harness.chromeApi;
            let background = require('../../background.js');

            await expect(background.initializeScrapeInActiveTab(
                { action: kind === 'r2_backup' ? 'INIT_R2_BACKUP' : 'INIT_SCRAPE' },
                { backup: kind === 'r2_backup' }
            )).resolves.toMatchObject({ status: 'started' });
            const finalizedLease = { ...harness.sessionState.activeScrapeRunToken };

            jest.resetModules();
            background = require('../../background.js');
            await background.ensureScrapeLeaseHydrated();

            expect(harness.sessionState.activeScrapeRunToken).toEqual(finalizedLease);
            await expect(background.initializeScrapeInActiveTab(
                { action: kind === 'r2_backup' ? 'INIT_R2_BACKUP' : 'INIT_SCRAPE' },
                { backup: kind === 'r2_backup' }
            )).resolves.toMatchObject({
                status: 'error',
                error: 'A sync or backup run is already active.'
            });
        }
    );

    test('normalizes stale local running state when session authority is missing', async () => {
        const harness = createLeaseBackgroundHarness({
            localState: {
                scraperState: 'running',
                scrapeRunToken: 'stale-run',
                scrapeRunEpoch: 7,
                scrapeNavigation: { runToken: 'stale-run' },
                currentItemId: 'item-1',
                isScraping: true,
                isR2Backup: false
            }
        });
        global.chrome = harness.chromeApi;
        const background = require('../../background.js');

        await background.ensureScrapeLeaseHydrated();

        expect(harness.sessionState.activeScrapeRunToken).toMatchObject({ status: 'idle', token: null });
        expect(harness.storedLocal).toMatchObject({
            scraperState: 'idle',
            scrapeRunToken: null,
            scrapeRunEpoch: null,
            scrapeNavigation: null,
            currentItemId: null,
            isScraping: false,
            isR2Backup: false
        });
    });

    test('allows exactly one winner across concurrent Starts', async () => {
        const harness = createLeaseBackgroundHarness();
        global.chrome = harness.chromeApi;
        const background = require('../../background.js');

        const responses = await Promise.all([
            background.initializeScrapeInActiveTab({ action: 'INIT_SCRAPE' }),
            background.initializeScrapeInActiveTab({ action: 'INIT_SCRAPE' })
        ]);

        expect(responses.filter((response) => response.status === 'started')).toHaveLength(1);
        expect(responses.filter((response) => response.status === 'error')).toHaveLength(1);
        expect(harness.chromeApi.tabs.sendMessage.mock.calls.filter(([, message]) => message.action === 'INIT_SCRAPE'))
            .toHaveLength(1);
    });

    test('R2 Stop tombstones the intent while cloud configuration is still loading', async () => {
        const harness = createLeaseBackgroundHarness();
        const cloudConfigRead = deferred();
        global.chrome = harness.chromeApi;
        const background = require('../../background.js');
        await background.ensureScrapeLeaseHydrated();
        await background.ensureBackgroundStateReady();
        const baseGet = harness.chromeApi.storage.local.get.getMockImplementation();
        harness.chromeApi.storage.local.get.mockImplementation((keys) => {
            if (Array.isArray(keys) && keys.length === 1 && keys[0] === 'cloudConfig') {
                return cloudConfigRead.promise;
            }
            return baseGet(keys);
        });

        const start = dispatchBackgroundMessage(harness.chromeApi, {
            action: 'START_R2_BACKUP',
            mode: 'full'
        }, {});
        await flushAsyncTurns();
        expect(harness.sessionState.activeScrapeRunToken).toMatchObject({
            status: 'starting',
            kind: 'r2_backup'
        });

        await expect(dispatchBackgroundMessage(harness.chromeApi, { action: 'STOP_R2_BACKUP' }, {}))
            .resolves.toMatchObject({ status: 'stopped' });
        cloudConfigRead.resolve({ cloudConfig: { mode: 'cloud_only', enabled: true } });
        await expect(start).resolves.toMatchObject({ status: 'error', error: 'Start was cancelled.' });

        expect(harness.sessionState.activeScrapeRunToken.status).toBe('idle');
        expect(harness.chromeApi.tabs.query).not.toHaveBeenCalled();
        expect(harness.chromeApi.tabs.sendMessage).not.toHaveBeenCalledWith(
            42,
            expect.objectContaining({ action: 'INIT_R2_BACKUP' }),
            expect.any(Function)
        );
    });

    test.each([
        ['sync', { action: 'INIT_SCRAPE' }, false],
        ['r2_backup', { action: 'INIT_R2_BACKUP', mode: 'full' }, true]
    ])('Stop tombstones a durable %s intent while active-tab discovery is delayed', async (kind, initMessage, backup) => {
        const harness = createLeaseBackgroundHarness();
        const tabsQuery = deferred();
        harness.chromeApi.tabs.query.mockImplementation((_query, callback) => {
            tabsQuery.promise.then(callback);
        });
        global.chrome = harness.chromeApi;
        const background = require('../../background.js');

        const start = background.initializeScrapeInActiveTab(initMessage, { backup });
        await flushAsyncTurns();

        const intent = harness.sessionState.activeScrapeRunToken;
        expect(intent).toMatchObject({
            status: 'starting',
            kind,
            epoch: 1,
            token: expect.any(String),
            tabId: null
        });

        await expect(background.stopScrapeRun(kind)).resolves.toMatchObject({ status: 'stopped' });
        expect(harness.sessionState.activeScrapeRunToken).toMatchObject({
            status: 'idle',
            epoch: 2,
            token: null
        });

        tabsQuery.resolve([{ id: 42, url: 'https://grok.com/imagine/saved' }]);
        await expect(start).resolves.toMatchObject({ status: 'error', error: 'Start was cancelled.' });
        expect(harness.chromeApi.tabs.sendMessage).not.toHaveBeenCalledWith(
            42,
            expect.objectContaining({ action: initMessage.action }),
            expect.any(Function)
        );
        expect(harness.sessionState.activeScrapeRunToken.status).toBe('idle');
    });

    test.each([
        ['sync', { action: 'INIT_SCRAPE' }, false],
        ['r2_backup', { action: 'INIT_R2_BACKUP', mode: 'full' }, true]
    ])('cleans up the durable %s intent when active-tab discovery fails', async (_kind, initMessage, backup) => {
        const harness = createLeaseBackgroundHarness();
        harness.chromeApi.tabs.query.mockImplementation((_query, callback) => {
            harness.chromeApi.runtime.lastError = { message: 'Active tab query failed.' };
            callback([]);
            harness.chromeApi.runtime.lastError = null;
        });
        global.chrome = harness.chromeApi;
        const background = require('../../background.js');

        await expect(background.initializeScrapeInActiveTab(initMessage, { backup })).resolves.toEqual({
            status: 'error',
            surface: 'unsupported',
            error: 'Active tab query failed.'
        });
        expect(harness.sessionState.activeScrapeRunToken).toMatchObject({
            status: 'idle',
            epoch: 2,
            token: null
        });
        expect(harness.storedLocal).toMatchObject({ scraperState: 'idle', isScraping: false, isR2Backup: false });
    });

    test('Stop during delayed INIT revokes the lease and prevents late activation', async () => {
        const harness = createLeaseBackgroundHarness();
        const initResponse = deferred();
        harness.chromeApi.tabs.sendMessage.mockImplementation((_tabId, message, callback) => {
            if (message.action === 'INIT_SCRAPE') {
                initResponse.promise.then(callback);
                return;
            }
            callback({ status: 'stopped' });
        });
        global.chrome = harness.chromeApi;
        const background = require('../../background.js');
        const start = background.initializeScrapeInActiveTab({ action: 'INIT_SCRAPE' });

        await new Promise((resolve) => setTimeout(resolve, 0));
        const stop = background.stopScrapeRun('sync');
        await expect(stop).resolves.toMatchObject({ status: 'stopped' });
        initResponse.resolve({
            status: 'started',
            surface: 'saved_gallery',
            runToken: 'run-1',
            runEpoch: 1
        });

        await expect(start).resolves.toMatchObject({ status: 'error', error: 'Start was cancelled.' });
        expect(harness.sessionState.activeScrapeRunToken.status).toBe('idle');
        expect(harness.storedLocal.isScraping).toBe(false);
    });

    test('Stop responds only after abort acknowledgement and authoritative local cleanup', async () => {
        const lease = createLeaseRecord();
        const abortResponse = deferred();
        const idleWrite = deferred();
        const harness = createLeaseBackgroundHarness({
            lease,
            localState: {
                scraperState: 'running',
                scrapeRunToken: lease.token,
                scrapeRunEpoch: lease.epoch,
                isScraping: true,
                isR2Backup: false
            }
        });
        harness.chromeApi.tabs.sendMessage.mockImplementation((_tabId, message, callback) => {
            if (message.action === 'ABORT_SCRAPE') abortResponse.promise.then(callback);
            else callback({ status: 'started', surface: 'saved_gallery' });
        });
        const baseSet = harness.chromeApi.storage.local.set.getMockImplementation();
        harness.chromeApi.storage.local.set.mockImplementation((values) => {
            if (values.scraperState === 'idle') {
                return idleWrite.promise.then(() => baseSet(values));
            }
            return baseSet(values);
        });
        global.chrome = harness.chromeApi;
        const background = require('../../background.js');
        await background.ensureScrapeLeaseHydrated();
        const response = jest.fn();
        const listener = harness.chromeApi.runtime.onMessage.addListener.mock.calls[0][0];

        listener({ action: 'STOP_SCRAPE' }, {}, response);
        await Promise.resolve();
        expect(response).not.toHaveBeenCalled();
        abortResponse.resolve({ status: 'stopped' });
        await Promise.resolve();
        expect(response).not.toHaveBeenCalled();
        idleWrite.resolve();
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(response).toHaveBeenCalledWith(expect.objectContaining({ status: 'stopped' }));
        expect(harness.storedLocal).toMatchObject({ scraperState: 'idle', scrapeNavigation: null });
    });

    test('Stop sends the Saved navigation receipt with the abort before clearing local state', async () => {
        const lease = createLeaseRecord();
        const navigation = {
            runToken: lease.token,
            runEpoch: lease.epoch,
            galleryUrl: 'https://grok.com/imagine/saved',
            savedViewportReceipt: {
                version: 3,
                sourceIdentity: 'asset-1',
                expectedNextIdentity: null,
                beforeIdentities: [],
                afterIdentities: [],
                visibleIdentities: ['asset-1'],
                origin: { pathname: '/imagine/saved', conversationId: '', scope: 'all' },
                scrollTop: 420
            }
        };
        const harness = createLeaseBackgroundHarness({
            lease,
            localState: {
                scraperState: 'running',
                scrapeRunToken: lease.token,
                scrapeRunEpoch: lease.epoch,
                scrapeNavigation: navigation,
                isScraping: true,
                isR2Backup: false
            }
        });
        global.chrome = harness.chromeApi;
        const background = require('../../background.js');
        await background.ensureScrapeLeaseHydrated();

        await expect(background.stopScrapeRun('sync')).resolves.toMatchObject({ status: 'stopped' });

        expect(harness.chromeApi.tabs.sendMessage).toHaveBeenCalledWith(
            lease.tabId,
            expect.objectContaining({
                action: 'ABORT_SCRAPE',
                runToken: lease.token,
                runEpoch: lease.epoch,
                stopNavigation: navigation
            }),
            expect.any(Function)
        );
        expect(harness.storedLocal.scrapeNavigation).toBeNull();
    });

    test('dropped content abort cannot preserve run authority', async () => {
        const lease = createLeaseRecord();
        const harness = createLeaseBackgroundHarness({
            lease,
            localState: {
                scraperState: 'running',
                scrapeRunToken: lease.token,
                scrapeRunEpoch: lease.epoch,
                isScraping: true
            }
        });
        harness.chromeApi.tabs.sendMessage.mockImplementation((_tabId, message, callback) => {
            if (message.action === 'ABORT_SCRAPE') {
                harness.chromeApi.runtime.lastError = { message: 'Receiving end does not exist.' };
                callback(undefined);
                harness.chromeApi.runtime.lastError = null;
            }
        });
        global.chrome = harness.chromeApi;
        const background = require('../../background.js');
        await background.ensureScrapeLeaseHydrated();

        await expect(background.stopScrapeRun('sync')).resolves.toMatchObject({
            status: 'stopped',
            abortAcknowledged: false
        });
        expect(harness.sessionState.activeScrapeRunToken.status).toBe('idle');
        expect(harness.storedLocal.scraperState).toBe('idle');
    });

    test('ignores stale or cross-tab progress and completion', async () => {
        const lease = createLeaseRecord({ kind: 'r2_backup' });
        const harness = createLeaseBackgroundHarness({
            lease,
            localState: {
                scraperState: 'running',
                scrapeRunToken: lease.token,
                scrapeRunEpoch: lease.epoch,
                isScraping: true,
                isR2Backup: true
            }
        });
        global.chrome = harness.chromeApi;
        require('../../background.js');

        await expect(dispatchBackgroundMessage(harness.chromeApi, {
            action: 'R2_BACKUP_PROGRESS',
            runToken: lease.token,
            runEpoch: lease.epoch - 1,
            stats: { uploaded: 99 }
        })).resolves.toMatchObject({ status: 'ignored' });
        await expect(dispatchBackgroundMessage(harness.chromeApi, {
            action: 'R2_BACKUP_COMPLETE',
            runToken: lease.token,
            runEpoch: lease.epoch,
            stats: { stopReason: 'complete' }
        }, { tab: { id: 99 } })).resolves.toMatchObject({ status: 'ignored' });

        expect(harness.chromeApi.runtime.sendMessage).not.toHaveBeenCalledWith(expect.objectContaining({
            action: expect.stringMatching(/UPDATE_R2_BACKUP_PROGRESS|R2_BACKUP_DONE/)
        }));
        expect(harness.sessionState.activeScrapeRunToken).toEqual(lease);
    });

    test('durability ignores stale or cross-tab requests and reads an empty owner snapshot without side effects', async () => {
        const lease = createLeaseRecord();
        const harness = createLeaseBackgroundHarness({
            lease,
            localState: {
                scraperState: 'running',
                scrapeRunToken: lease.token,
                scrapeRunEpoch: lease.epoch,
                isScraping: true,
                isR2Backup: false
            }
        });
        global.chrome = harness.chromeApi;
        const background = require('../../background.js');
        await background.ensureBackgroundStateReady();
        const storageWritesBefore = harness.chromeApi.storage.local.set.mock.calls.length;
        const runtimeMessagesBefore = harness.chromeApi.runtime.sendMessage.mock.calls.length;

        const stale = dispatchBackgroundMessageThroughPort(harness.chromeApi, {
            action: 'GET_SCRAPE_DURABILITY',
            runToken: lease.token,
            runEpoch: lease.epoch - 1,
            kind: lease.kind
        }, { tab: { id: lease.tabId } });
        const crossTab = dispatchBackgroundMessageThroughPort(harness.chromeApi, {
            action: 'GET_SCRAPE_DURABILITY',
            runToken: lease.token,
            runEpoch: lease.epoch,
            kind: lease.kind
        }, { tab: { id: 99 } });
        const owner = dispatchBackgroundMessageThroughPort(harness.chromeApi, {
            action: 'GET_SCRAPE_DURABILITY',
            runToken: lease.token,
            runEpoch: lease.epoch,
            kind: lease.kind
        }, { tab: { id: lease.tabId } });

        expect(stale.returnValue).toBe(true);
        expect(crossTab.returnValue).toBe(true);
        expect(owner.returnValue).toBe(true);
        await expect(stale.response).resolves.toEqual({ status: 'ignored' });
        await expect(crossTab.response).resolves.toEqual({ status: 'ignored' });
        await expect(owner.response).resolves.toEqual({
            status: 'durable',
            inFlightTasks: 0,
            pendingDownloads: 0,
            pendingOperations: 0,
            pendingQueueItems: 0,
            failedItems: 0
        });
        expect(harness.chromeApi.storage.local.set).toHaveBeenCalledTimes(storageWritesBefore);
        expect(harness.chromeApi.runtime.sendMessage).toHaveBeenCalledTimes(runtimeMessagesBefore);
    });

    test('durability counts one active owner transfer without counting its own query', async () => {
        const lease = createLeaseRecord();
        const harness = createLeaseBackgroundHarness({
            lease,
            localState: {
                scraperState: 'running',
                scrapeRunToken: lease.token,
                scrapeRunEpoch: lease.epoch,
                isScraping: true,
                isR2Backup: false,
                processedIds: []
            }
        });
        global.chrome = harness.chromeApi;
        const background = require('../../background.js');
        await background.ensureBackgroundStateReady();
        const processedWrite = deferred();
        const processedWriteStarted = deferred();
        const baseSet = harness.chromeApi.storage.local.set.getMockImplementation();
        harness.chromeApi.storage.local.set.mockImplementation((values) => {
            if (Array.isArray(values.processedIds) && values.processedIds.includes('durability-media')) {
                processedWriteStarted.resolve();
                return processedWrite.promise.then(() => baseSet(values));
            }
            return baseSet(values);
        });
        const transfer = dispatchBackgroundMessageThroughPort(harness.chromeApi, {
            action: 'SCRAPE_PROCESSED_IDS_ADD',
            runToken: lease.token,
            runEpoch: lease.epoch,
            kind: lease.kind,
            ids: ['durability-media']
        }, { tab: { id: lease.tabId } });
        await processedWriteStarted.promise;

        const response = await dispatchDurabilityMessage(harness.chromeApi, {
            action: 'GET_SCRAPE_DURABILITY',
            runToken: lease.token,
            runEpoch: lease.epoch,
            kind: lease.kind
        }, { tab: { id: lease.tabId } });

        expect(response).toMatchObject({ status: 'pending', inFlightTasks: 1 });
        processedWrite.resolve();
        await expect(transfer.response).resolves.toMatchObject({ status: 'ok' });
    });

    test('durability deduplicates one owner download receipt across URL and download ID indexes', async () => {
        const lease = createLeaseRecord();
        const harness = createLeaseBackgroundHarness({
            lease,
            localState: {
                scraperState: 'running',
                scrapeRunToken: lease.token,
                scrapeRunEpoch: lease.epoch,
                isScraping: true,
                isR2Backup: false
            }
        });
        harness.chromeApi.downloads.download.mockImplementation((_options, callback) => callback(61));
        global.chrome = harness.chromeApi;
        const background = require('../../background.js');
        await background.ensureBackgroundStateReady();
        await background.queueChromeDownload({
            url: 'https://assets.grok.com/generated/durability-receipt.jpg'
        }, lease);

        const response = await dispatchDurabilityMessage(harness.chromeApi, {
            action: 'GET_SCRAPE_DURABILITY',
            runToken: lease.token,
            runEpoch: lease.epoch,
            kind: lease.kind
        }, { tab: { id: lease.tabId } });

        expect(response).toMatchObject({
            status: 'pending',
            pendingDownloads: 1,
            pendingOperations: 0
        });
    });

    test('durability counts a run-owned R2-pending download operation', async () => {
        const { background, harness, lease } = await seedRunOwnedDownloadOperation({
            mode: 'dual_write',
            downloadId: 62,
            mediaId: '73e5e137-1334-49ea-b06b-a9d9ba891062',
            downloadState: 'complete',
            r2State: 'pending'
        });

        const response = await dispatchDurabilityMessage(harness.chromeApi, {
            action: 'GET_SCRAPE_DURABILITY',
            runToken: lease.token,
            runEpoch: lease.epoch,
            kind: lease.kind
        }, { tab: { id: lease.tabId } });

        expect(response).toMatchObject({ status: 'pending', pendingOperations: 1 });
        expect(background.getPendingDownloadOperationsForTest()).toHaveProperty('62');
    });

    test('durability keeps a complete R2-present operation pending until final identity and cleanup settle', async () => {
        const { harness, lease } = await seedRunOwnedDownloadOperation({
            mode: 'dual_write',
            downloadId: 65,
            mediaId: '73e5e137-1334-49ea-b06b-a9d9ba891065',
            downloadState: 'complete',
            r2State: 'present'
        });

        const response = await dispatchDurabilityMessage(harness.chromeApi, {
            action: 'GET_SCRAPE_DURABILITY',
            runToken: lease.token,
            runEpoch: lease.epoch,
            kind: lease.kind
        }, { tab: { id: lease.tabId } });

        expect(response).toMatchObject({ status: 'pending', pendingOperations: 1 });
    });

    test('durability counts a retryable run-owned cloud queue item', async () => {
        const lease = createLeaseRecord({ kind: 'r2_backup' });
        const harness = createLeaseBackgroundHarness({
            lease,
            localState: {
                scraperState: 'running',
                scrapeRunToken: lease.token,
                scrapeRunEpoch: lease.epoch,
                isScraping: true,
                isR2Backup: true
            }
        });
        global.chrome = harness.chromeApi;
        const background = require('../../background.js');
        await background.ensureBackgroundStateReady();
        background.setCloudSyncQueueForTest([{
            id: 'durability-queue',
            type: 'media',
            attempts: 1,
            scrapeLease: { ...lease }
        }]);

        const response = await dispatchDurabilityMessage(harness.chromeApi, {
            action: 'GET_SCRAPE_DURABILITY',
            runToken: lease.token,
            runEpoch: lease.epoch,
            kind: lease.kind
        }, { tab: { id: lease.tabId } });

        expect(response).toMatchObject({ status: 'pending', pendingQueueItems: 1, failedItems: 0 });
    });

    test('durability fails for terminal run-owned queue and operation records', async () => {
        const { background, harness, lease } = await seedRunOwnedDownloadOperation({
            mode: 'dual_write',
            downloadId: 63,
            mediaId: '73e5e137-1334-49ea-b06b-a9d9ba891063',
            downloadState: 'complete',
            r2State: 'pending'
        });
        const maxAttempts = background.getCloudSyncForTest().MAX_RETRY_ATTEMPTS;
        await background.updateDownloadOperation(63, {
            attempts: maxAttempts,
            lastError: 'code=durability_operation_failed'
        });
        background.setCloudSyncQueueForTest([{
            id: 'durability-terminal-queue',
            type: 'media',
            attempts: maxAttempts,
            lastError: 'code=durability_queue_failed',
            scrapeLease: { ...lease }
        }]);

        const response = await dispatchDurabilityMessage(harness.chromeApi, {
            action: 'GET_SCRAPE_DURABILITY',
            runToken: lease.token,
            runEpoch: lease.epoch,
            kind: lease.kind
        }, { tab: { id: lease.tabId } });

        expect(response).toMatchObject({
            status: 'failed',
            pendingOperations: 1,
            pendingQueueItems: 1,
            failedItems: 2
        });
    });

    test('durability excludes operation and queue records owned by another lease', async () => {
        const { background, harness, lease } = await seedRunOwnedDownloadOperation({
            mode: 'dual_write',
            downloadId: 64,
            mediaId: '73e5e137-1334-49ea-b06b-a9d9ba891064',
            downloadState: 'complete',
            r2State: 'pending'
        });
        const otherLease = createLeaseRecord({ token: 'other-run', epoch: lease.epoch + 1, tabId: 77 });
        await background.updateDownloadOperation(64, { scrapeLease: otherLease });
        background.setCloudSyncQueueForTest([{
            id: 'other-run-queue',
            type: 'media',
            attempts: 0,
            scrapeLease: otherLease
        }]);

        const response = await dispatchDurabilityMessage(harness.chromeApi, {
            action: 'GET_SCRAPE_DURABILITY',
            runToken: lease.token,
            runEpoch: lease.epoch,
            kind: lease.kind
        }, { tab: { id: lease.tabId } });

        expect(response).toEqual({
            status: 'durable',
            inFlightTasks: 0,
            pendingDownloads: 0,
            pendingOperations: 0,
            pendingQueueItems: 0,
            failedItems: 0
        });
    });

    test.each([
        [{ stopReason: 'complete', pendingTransfers: 0, errors: 0 }, true, 'complete'],
        [{ stopReason: 'canary_complete', pendingTransfers: 0, errors: 0 }, true, 'canary complete'],
        [{ pendingTransfers: 0, errors: 0 }, false, 'stopped'],
        [{ stopReason: 'complete', errors: 0 }, false, 'incomplete'],
        [{ stopReason: 'complete', pendingTransfers: 1, errors: 0 }, false, 'incomplete'],
        [{ stopReason: 'complete', pendingTransfers: 0, errors: 1 }, false, 'incomplete'],
        [{ stopReason: 'durability_timeout', pendingTransfers: 0, errors: 0 }, false, 'stopped'],
        [{ stopReason: 'durability_failed', pendingTransfers: 1, errors: 0 }, false, 'stopped'],
        [{ stopReason: 'scan_limit', pendingTransfers: 0, errors: 0 }, false, 'paused']
    ])('durability completion predicate fails closed for %#', async (stats, successful, label) => {
        const harness = createLeaseBackgroundHarness();
        global.chrome = harness.chromeApi;
        const background = require('../../background.js');
        await background.ensureBackgroundStateReady();

        expect(background.isR2BackupCompletionSuccessful(stats)).toBe(successful);
        expect(background.getR2BackupCompletionStatusLabel(stats)).toBe(label);
    });

    test('returns reasoned resume validation for the owner, a non-owner tab, and stale authority', async () => {
        const lease = createLeaseRecord();
        const harness = createLeaseBackgroundHarness({
            lease,
            localState: {
                scraperState: 'running',
                scrapeRunToken: lease.token,
                scrapeRunEpoch: lease.epoch,
                isScraping: true
            }
        });
        global.chrome = harness.chromeApi;
        const background = require('../../background.js');

        await expect(background.validateScrapeResume(lease, 42)).resolves.toEqual({
            valid: true,
            reason: 'active_owner'
        });
        await expect(background.validateScrapeResume({ ...lease, epoch: lease.epoch + 1 }, 42)).resolves.toEqual({
            valid: false,
            reason: 'stale_authority'
        });
        await expect(background.validateScrapeResume(lease, 99)).resolves.toEqual({
            valid: false,
            reason: 'non_owner'
        });
    });

    test('rejects an epoch-8 mirror write from another tab without changing the epoch-9 owner mirror', async () => {
        const lease = createLeaseRecord({ token: 'new-owner', epoch: 9, tabId: 42 });
        const ownerMirror = {
            scraperState: 'running',
            currentIndex: 4,
            scrapeRunToken: lease.token,
            scrapeRunEpoch: lease.epoch,
            scrapeNavigation: { currentItemId: 'owner-item' },
            isScraping: true,
            isR2Backup: false
        };
        const harness = createLeaseBackgroundHarness({ lease, localState: ownerMirror });
        global.chrome = harness.chromeApi;
        require('../../background.js');

        const dispatched = dispatchBackgroundMessageThroughPort(harness.chromeApi, {
            action: 'SCRAPE_RUN_STATE_WRITE',
            runToken: 'old-owner',
            runEpoch: 8,
            kind: 'sync',
            values: {
                scraperState: 'running',
                currentIndex: 0,
                scrapeRunToken: 'old-owner',
                scrapeRunEpoch: 8,
                isScraping: true,
                isR2Backup: false
            }
        }, { tab: { id: 99 } });

        expect(dispatched.returnValue).toBe(true);
        await expect(dispatched.response).resolves.toEqual({ status: 'ignored', reason: 'stale_authority' });
        expect(harness.storedLocal).toMatchObject(ownerMirror);
        expect(harness.storedLocal).not.toMatchObject({
            scrapeRunToken: 'old-owner',
            scrapeRunEpoch: 8
        });
    });

    test('rejects a request-controlled tab id when the runtime sender has no tab', async () => {
        const lease = createLeaseRecord();
        const harness = createLeaseBackgroundHarness({
            lease,
            localState: {
                scraperState: 'running',
                currentIndex: 2,
                scrapeRunToken: lease.token,
                scrapeRunEpoch: lease.epoch,
                isScraping: true,
                isR2Backup: false
            }
        });
        global.chrome = harness.chromeApi;
        require('../../background.js');

        const dispatched = dispatchBackgroundMessageThroughPort(harness.chromeApi, {
            action: 'SCRAPE_RUN_STATE_WRITE',
            runToken: lease.token,
            runEpoch: lease.epoch,
            kind: lease.kind,
            tabId: lease.tabId,
            values: { currentIndex: 99 }
        }, {});

        expect(dispatched.returnValue).toBe(true);
        await expect(dispatched.response).resolves.toEqual({ status: 'ignored', reason: 'stale_authority' });
        expect(harness.storedLocal.currentIndex).toBe(2);
    });

    test('a never-settling background run-state write cannot block Stop, a replacement run, or its state write', async () => {
        jest.useFakeTimers();
        const lease = createLeaseRecord({ token: 'background-write-never-settles' });
        const harness = createLeaseBackgroundHarness({
            lease,
            localState: {
                scraperState: 'running',
                currentIndex: 1,
                scrapeRunToken: lease.token,
                scrapeRunEpoch: lease.epoch,
                isScraping: true,
                isR2Backup: false
            }
        });
        global.chrome = harness.chromeApi;
        const background = require('../../background.js');
        await background.ensureBackgroundStateReady();
        await background.ensureScrapeLeaseHydrated();
        const writeStarted = deferred();
        const baseSet = harness.chromeApi.storage.local.set.getMockImplementation();
        harness.chromeApi.storage.local.set.mockImplementation((values) => {
            if (isRunStatePersistence(values, lease.token)) {
                writeStarted.resolve();
                return new Promise(() => {});
            }
            return baseSet(values);
        });

        const staleWrite = dispatchBackgroundMessageThroughPort(harness.chromeApi, {
            action: 'SCRAPE_RUN_STATE_WRITE',
            runToken: lease.token,
            runEpoch: lease.epoch,
            kind: lease.kind,
            values: { currentIndex: 2 }
        }, { tab: { id: lease.tabId } });
        await writeStarted.promise;
        const stop = dispatchBackgroundMessageThroughPort(
            harness.chromeApi,
            { action: 'STOP_SCRAPE' },
            { tab: { id: lease.tabId } }
        );
        let stopSettled = false;
        stop.response.finally(() => { stopSettled = true; });
        await jest.advanceTimersByTimeAsync(1100);
        await flushAsyncTurns(20);

        expect(stopSettled).toBe(true);
        await expect(stop.response).resolves.toMatchObject({ status: 'stopped' });
        await expect(staleWrite.response).resolves.toEqual({
            status: 'ignored',
            reason: 'persistence_timeout'
        });

        const start = dispatchBackgroundMessageThroughPort(harness.chromeApi, {
            action: 'START_SCRAPE'
        }, { tab: { id: lease.tabId, url: 'https://grok.com/imagine/saved' } });
        const started = await start.response;
        expect(started).toMatchObject({ status: 'started', runToken: expect.any(String) });
        const currentWrite = dispatchBackgroundMessageThroughPort(harness.chromeApi, {
            action: 'SCRAPE_RUN_STATE_WRITE',
            runToken: started.runToken,
            runEpoch: started.runEpoch,
            kind: 'sync',
            values: { currentIndex: 7 }
        }, { tab: { id: lease.tabId } });

        await expect(currentWrite.response).resolves.toEqual({ status: 'ok' });
        await expect(background.validateScrapeResume({
            runToken: started.runToken,
            runEpoch: started.runEpoch,
            kind: 'sync'
        }, lease.tabId)).resolves.toEqual({ valid: true, reason: 'active_owner' });
        expect(getStoredRunStateRecords(harness.storedLocal, started.runToken)).toHaveLength(1);
    });

    test('a late old-run state write is inert after Stop and cannot notify or replace a new backup run', async () => {
        jest.useFakeTimers();
        const lease = createLeaseRecord({
            token: 'background-write-late-old',
            kind: 'r2_backup'
        });
        const harness = createLeaseBackgroundHarness({
            lease,
            localState: {
                scraperState: 'running',
                currentIndex: 3,
                scrapeRunToken: lease.token,
                scrapeRunEpoch: lease.epoch,
                isScraping: true,
                isR2Backup: true,
                r2BackupState: { isRunning: true, totalSeen: 3 }
            }
        });
        global.chrome = harness.chromeApi;
        const background = require('../../background.js');
        await background.ensureBackgroundStateReady();
        await background.ensureScrapeLeaseHydrated();
        const staleStorageWrite = deferred();
        const staleWriteStarted = deferred();
        const baseSet = harness.chromeApi.storage.local.set.getMockImplementation();
        harness.chromeApi.storage.local.set.mockImplementation((values) => {
            if (isRunStatePersistence(values, lease.token)) {
                staleWriteStarted.resolve();
                return staleStorageWrite.promise.then(() => baseSet(values));
            }
            return baseSet(values);
        });

        const staleWrite = dispatchBackgroundMessageThroughPort(harness.chromeApi, {
            action: 'SCRAPE_RUN_STATE_WRITE',
            runToken: lease.token,
            runEpoch: lease.epoch,
            kind: lease.kind,
            values: { r2BackupState: { isRunning: true, totalSeen: 4 } }
        }, { tab: { id: lease.tabId } });
        await staleWriteStarted.promise;
        const stop = dispatchBackgroundMessageThroughPort(
            harness.chromeApi,
            { action: 'STOP_R2_BACKUP' },
            { tab: { id: lease.tabId } }
        );
        await jest.advanceTimersByTimeAsync(1100);
        await expect(stop.response).resolves.toMatchObject({ status: 'stopped' });
        await expect(staleWrite.response).resolves.toEqual({
            status: 'ignored',
            reason: 'persistence_timeout'
        });

        const start = dispatchBackgroundMessageThroughPort(harness.chromeApi, {
            action: 'START_R2_BACKUP',
            mode: 'full'
        }, { tab: { id: lease.tabId, url: 'https://grok.com/imagine/saved' } });
        const started = await start.response;
        expect(started).toMatchObject({ status: 'started', runToken: expect.any(String) });
        const currentWrite = dispatchBackgroundMessageThroughPort(harness.chromeApi, {
            action: 'SCRAPE_RUN_STATE_WRITE',
            runToken: started.runToken,
            runEpoch: started.runEpoch,
            kind: 'r2_backup',
            values: { r2BackupState: { isRunning: true, totalSeen: 9 } }
        }, { tab: { id: lease.tabId } });
        await expect(currentWrite.response).resolves.toEqual({ status: 'ok' });

        staleStorageWrite.resolve();
        await flushAsyncTurns(30);
        const staleProgress = dispatchBackgroundMessageThroughPort(harness.chromeApi, {
            action: 'R2_BACKUP_PROGRESS',
            runToken: lease.token,
            runEpoch: lease.epoch,
            kind: lease.kind,
            stats: { totalSeen: 4 }
        }, { tab: { id: lease.tabId } });

        await expect(staleProgress.response).resolves.toEqual({ status: 'ignored' });
        await expect(background.validateScrapeResume({
            runToken: started.runToken,
            runEpoch: started.runEpoch,
            kind: 'r2_backup'
        }, lease.tabId)).resolves.toEqual({ valid: true, reason: 'active_owner' });
        expect(getStoredRunStateRecords(harness.storedLocal, started.runToken)).toHaveLength(1);
        expect(harness.chromeApi.runtime.sendMessage).not.toHaveBeenCalledWith(expect.objectContaining({
            action: 'UPDATE_R2_BACKUP_PROGRESS',
            stats: expect.objectContaining({ totalSeen: 4 })
        }));
    });

    test('a run-state storage result after the caller deadline is inert before its timeout callback runs', async () => {
        jest.useFakeTimers();
        jest.setSystemTime(1780000000000);
        const lease = createLeaseRecord({ token: 'background-write-after-deadline' });
        const harness = createLeaseBackgroundHarness({
            lease,
            localState: {
                scraperState: 'running',
                currentIndex: 3,
                scrapeRunToken: lease.token,
                scrapeRunEpoch: lease.epoch,
                isScraping: true,
                isR2Backup: false
            }
        });
        global.chrome = harness.chromeApi;
        const background = require('../../background.js');
        await background.ensureBackgroundStateReady();
        await background.ensureScrapeLeaseHydrated();
        const storageWrite = deferred();
        const writeStarted = deferred();
        const baseSet = harness.chromeApi.storage.local.set.getMockImplementation();
        harness.chromeApi.storage.local.set.mockImplementation((values) => {
            if (isRunStatePersistence(values, lease.token)) {
                writeStarted.resolve();
                return storageWrite.promise.then(() => baseSet(values));
            }
            return baseSet(values);
        });
        const deadlineAt = Date.now() + 500;

        const write = dispatchBackgroundMessageThroughPort(harness.chromeApi, {
            action: 'SCRAPE_RUN_STATE_WRITE',
            runToken: lease.token,
            runEpoch: lease.epoch,
            kind: lease.kind,
            deadlineAt,
            values: { currentIndex: 8 }
        }, { tab: { id: lease.tabId } });
        await writeStarted.promise;
        jest.setSystemTime(deadlineAt + 1);
        storageWrite.resolve();
        await flushAsyncTurns(20);

        await expect(write.response).resolves.toEqual({
            status: 'ignored',
            reason: 'persistence_timeout'
        });
        const active = dispatchBackgroundMessageThroughPort(harness.chromeApi, {
            action: 'GET_ACTIVE_SCRAPE_RUN_STATE'
        }, { tab: { id: lease.tabId } });
        await expect(active.response).resolves.toMatchObject({
            status: 'ok',
            state: { currentIndex: 3 }
        });
    });

    test('authoritative run-state writes retain only the latest settled immutable record', async () => {
        const lease = createLeaseRecord({ token: 'background-write-compaction' });
        const harness = createLeaseBackgroundHarness({
            lease,
            localState: {
                scraperState: 'running',
                currentIndex: 1,
                scrapeRunToken: lease.token,
                scrapeRunEpoch: lease.epoch,
                isScraping: true,
                isR2Backup: false
            }
        });
        global.chrome = harness.chromeApi;
        require('../../background.js');

        for (const currentIndex of [2, 3]) {
            const write = dispatchBackgroundMessageThroughPort(harness.chromeApi, {
                action: 'SCRAPE_RUN_STATE_WRITE',
                runToken: lease.token,
                runEpoch: lease.epoch,
                kind: lease.kind,
                values: { currentIndex }
            }, { tab: { id: lease.tabId } });
            await expect(write.response).resolves.toEqual({ status: 'ok' });
        }

        expect(getStoredRunStateRecords(harness.storedLocal)).toEqual([
            expect.objectContaining({ mirror: expect.objectContaining({ currentIndex: 3 }) })
        ]);
    });

    test.each([
        {
            label: 'navigation',
            lease: createLeaseRecord({ token: 'restart-navigation-order' }),
            oldValues: {
                currentIndex: 2,
                scrapeNavigation: { currentItemId: 'old-navigation-item' }
            },
            newValues: {
                currentIndex: 7,
                scrapeNavigation: { currentItemId: 'new-navigation-item' }
            },
            expectedState: {
                currentIndex: 7,
                scrapeNavigation: { currentItemId: 'new-navigation-item' }
            }
        },
        {
            label: 'backup progress',
            lease: createLeaseRecord({
                token: 'restart-backup-order',
                kind: 'r2_backup'
            }),
            oldValues: {
                currentIndex: 3,
                r2BackupState: { isRunning: true, totalSeen: 4, uploaded: 1 }
            },
            newValues: {
                currentIndex: 8,
                r2BackupState: { isRunning: true, totalSeen: 11, uploaded: 6 }
            },
            expectedState: {
                currentIndex: 8,
                r2BackupState: { isRunning: true, totalSeen: 11, uploaded: 6 }
            }
        }
    ])('a true worker restart keeps newer same-lease $label above an unseen late write', async ({
        lease,
        oldValues,
        newValues,
        expectedState
    }) => {
        const harness = createLeaseBackgroundHarness({
            lease,
            localState: {
                scraperState: 'running',
                currentIndex: 1,
                scrapeRunToken: lease.token,
                scrapeRunEpoch: lease.epoch,
                isScraping: true,
                isR2Backup: lease.kind === 'r2_backup',
                ...(lease.kind === 'r2_backup'
                    ? { r2BackupState: { isRunning: true, totalSeen: 1, uploaded: 0 } }
                    : {})
            }
        });
        global.chrome = harness.chromeApi;
        let background = require('../../background.js');
        await background.ensureBackgroundStateReady();
        await background.ensureScrapeLeaseHydrated();

        const latePhysicalWrite = deferred();
        const latePhysicalWriteApplied = deferred();
        const oldWriteStarted = deferred();
        const baseSet = harness.chromeApi.storage.local.set.getMockImplementation();
        let oldStoredValues = null;
        harness.chromeApi.storage.local.set.mockImplementation((values) => {
            if (!oldStoredValues && isRunStatePersistence(values, lease.token)) {
                oldStoredValues = JSON.parse(JSON.stringify(values));
                oldWriteStarted.resolve();
                return latePhysicalWrite.promise.then(async () => {
                    await baseSet(oldStoredValues);
                    latePhysicalWriteApplied.resolve();
                    return new Promise(() => {});
                });
            }
            return baseSet(values);
        });

        dispatchLatestBackgroundMessageThroughPort(harness.chromeApi, {
            action: 'SCRAPE_RUN_STATE_WRITE',
            runToken: lease.token,
            runEpoch: lease.epoch,
            kind: lease.kind,
            values: oldValues
        }, { tab: { id: lease.tabId } });
        await oldWriteStarted.promise;

        jest.resetModules();
        background = require('../../background.js');
        await background.ensureBackgroundStateReady();
        await background.ensureScrapeLeaseHydrated();
        const newerWrite = dispatchLatestBackgroundMessageThroughPort(harness.chromeApi, {
            action: 'SCRAPE_RUN_STATE_WRITE',
            runToken: lease.token,
            runEpoch: lease.epoch,
            kind: lease.kind,
            values: newValues
        }, { tab: { id: lease.tabId } });
        await expect(newerWrite.response).resolves.toEqual({ status: 'ok' });

        const [newerStorageKey, newerRecord] = Object.entries(harness.storedLocal).find(([, value]) => (
            value?.kind === 'scrape_run_state_record'
            && value.mirror?.currentIndex === newValues.currentIndex
        ));
        latePhysicalWrite.resolve();
        await latePhysicalWriteApplied.promise;
        const [olderStorageKey, olderRecord] = Object.entries(oldStoredValues)[0];

        delete harness.storedLocal[olderStorageKey];
        delete harness.storedLocal[newerStorageKey];
        harness.storedLocal[olderStorageKey] = olderRecord;
        harness.storedLocal[newerStorageKey] = newerRecord;

        jest.resetModules();
        background = require('../../background.js');
        await background.ensureBackgroundStateReady();
        await background.ensureScrapeLeaseHydrated();
        const active = dispatchLatestBackgroundMessageThroughPort(harness.chromeApi, {
            action: 'GET_ACTIVE_SCRAPE_RUN_STATE'
        }, { tab: { id: lease.tabId } });

        await expect(active.response).resolves.toMatchObject({
            status: 'ok',
            state: expectedState
        });
        await flushAsyncTurns(20);
        expect(getStoredRunStateRecords(harness.storedLocal, lease.token)).toEqual([
            expect.objectContaining({ mirror: expect.objectContaining(expectedState) })
        ]);
    });

    test('a true worker restart cannot recycle an epoch after a late writer claim', async () => {
        const lease = createLeaseRecord({ token: 'restart-writer-claim-order' });
        const harness = createLeaseBackgroundHarness({
            lease,
            localState: {
                scraperState: 'running',
                currentIndex: 1,
                scrapeRunToken: lease.token,
                scrapeRunEpoch: lease.epoch,
                isScraping: true,
                isR2Backup: false
            }
        });
        global.chrome = harness.chromeApi;
        const lateWriterClaim = deferred();
        const lateWriterClaimStarted = deferred();
        const lateWriterClaimApplied = deferred();
        const lateRunStateWrite = deferred();
        const lateRunStateWriteStarted = deferred();
        const lateRunStateWriteApplied = deferred();
        const baseSet = harness.chromeApi.storage.local.set.getMockImplementation();
        let interceptedWriterClaim = false;
        let interceptRunStateWrite = false;
        let oldRunStateValues = null;
        harness.chromeApi.storage.local.set.mockImplementation((values) => {
            const writerClaim = findStoredRecord(values, 'scrape_persistence_writer');
            if (!interceptedWriterClaim && writerClaim) {
                interceptedWriterClaim = true;
                const oldWriterValues = JSON.parse(JSON.stringify(values));
                lateWriterClaimStarted.resolve();
                return lateWriterClaim.promise.then(async () => {
                    await baseSet(oldWriterValues);
                    lateWriterClaimApplied.resolve();
                    return new Promise(() => {});
                });
            }
            if (interceptRunStateWrite
                && !oldRunStateValues
                && isRunStatePersistence(values, lease.token)) {
                oldRunStateValues = JSON.parse(JSON.stringify(values));
                lateRunStateWriteStarted.resolve();
                return lateRunStateWrite.promise.then(async () => {
                    await baseSet(oldRunStateValues);
                    lateRunStateWriteApplied.resolve();
                    return new Promise(() => {});
                });
            }
            return baseSet(values);
        });

        require('../../background.js');
        await lateWriterClaimStarted.promise;

        jest.resetModules();
        let background = require('../../background.js');
        await background.ensureBackgroundStateReady();
        jest.resetModules();
        background = require('../../background.js');
        await background.ensureBackgroundStateReady();
        await background.ensureScrapeLeaseHydrated();

        interceptRunStateWrite = true;
        dispatchLatestBackgroundMessageThroughPort(harness.chromeApi, {
            action: 'SCRAPE_RUN_STATE_WRITE',
            runToken: lease.token,
            runEpoch: lease.epoch,
            kind: lease.kind,
            values: { currentIndex: 4 }
        }, { tab: { id: lease.tabId } });
        await lateRunStateWriteStarted.promise;

        lateWriterClaim.resolve();
        await lateWriterClaimApplied.promise;
        jest.resetModules();
        background = require('../../background.js');
        await background.ensureBackgroundStateReady();
        await background.ensureScrapeLeaseHydrated();
        const newerWrite = dispatchLatestBackgroundMessageThroughPort(harness.chromeApi, {
            action: 'SCRAPE_RUN_STATE_WRITE',
            runToken: lease.token,
            runEpoch: lease.epoch,
            kind: lease.kind,
            values: { currentIndex: 9 }
        }, { tab: { id: lease.tabId } });
        await expect(newerWrite.response).resolves.toEqual({ status: 'ok' });

        lateRunStateWrite.resolve();
        await lateRunStateWriteApplied.promise;
        jest.resetModules();
        background = require('../../background.js');
        await background.ensureBackgroundStateReady();
        await background.ensureScrapeLeaseHydrated();
        const active = dispatchLatestBackgroundMessageThroughPort(harness.chromeApi, {
            action: 'GET_ACTIVE_SCRAPE_RUN_STATE'
        }, { tab: { id: lease.tabId } });

        await expect(active.response).resolves.toMatchObject({
            status: 'ok',
            state: { currentIndex: 9 }
        });
        await flushAsyncTurns(20);
        expect(Object.values(harness.storedLocal).filter((value) => (
            value?.kind === 'scrape_persistence_writer'
        ))).toHaveLength(1);
    });

    test('rejects an unleased media transfer before Chrome accepts a download', async () => {
        const harness = createLeaseBackgroundHarness();
        harness.chromeApi.downloads.download.mockImplementation((_options, callback) => callback(77));
        global.chrome = harness.chromeApi;
        require('../../background.js');

        const dispatched = dispatchBackgroundMessageThroughPort(harness.chromeApi, {
            action: 'DOWNLOAD_MEDIA',
            url: 'https://assets.grok.com/generated/unleased/image.jpg',
            isVideo: false
        }, { tab: { id: 99 } });

        expect(dispatched.returnValue).toBe(true);
        await expect(dispatched.response).resolves.toEqual({ status: 'ignored', reason: 'stale_authority' });
        expect(harness.chromeApi.downloads.download).not.toHaveBeenCalled();
    });

    test.each([
        ['DOWNLOAD_MEDIA', createLeaseRecord(), {
            url: 'https://assets.grok.com/generated/missing-kind.jpg',
            isVideo: false
        }],
        ['R2_BACKUP_UPLOAD', createLeaseRecord({ kind: 'r2_backup' }), {
            url: 'https://assets.grok.com/generated/missing-kind.jpg',
            isVideo: false,
            isR2Backup: true,
            skipLocalDownload: true
        }]
    ])('requires an explicit run kind for %s before transfer side effects', async (action, lease, transfer) => {
        const harness = createLeaseBackgroundHarness({
            lease,
            localState: {
                scraperState: 'running',
                scrapeRunToken: lease.token,
                scrapeRunEpoch: lease.epoch,
                isScraping: true,
                isR2Backup: lease.kind === 'r2_backup',
                cloudConfig: { enabled: false, mode: 'local_only' }
            }
        });
        global.chrome = harness.chromeApi;
        require('../../background.js');

        const dispatched = dispatchBackgroundMessageThroughPort(harness.chromeApi, {
            action,
            runToken: lease.token,
            runEpoch: lease.epoch,
            ...transfer
        }, { tab: { id: lease.tabId } });

        expect(dispatched.returnValue).toBe(true);
        await expect(dispatched.response).resolves.toEqual({ status: 'ignored', reason: 'stale_authority' });
        expect(harness.chromeApi.downloads.download).not.toHaveBeenCalled();
        expect(harness.storedLocal.cloudSyncQueue || []).toEqual([]);
    });

    test('Stop during transfer configuration prevents a later Chrome download', async () => {
        const lease = createLeaseRecord();
        const harness = createLeaseBackgroundHarness({
            lease,
            localState: {
                scraperState: 'running',
                scrapeRunToken: lease.token,
                scrapeRunEpoch: lease.epoch,
                isScraping: true,
                isR2Backup: false,
                cloudConfig: { enabled: false, mode: 'local_only' }
            }
        });
        global.chrome = harness.chromeApi;
        const background = require('../../background.js');
        await background.ensureScrapeLeaseHydrated();
        const configRead = deferred();
        const configReadStarted = deferred();
        const baseGet = harness.chromeApi.storage.local.get.getMockImplementation();
        harness.chromeApi.storage.local.get.mockImplementation((keys) => {
            if (Array.isArray(keys) && keys.length === 1 && keys[0] === 'cloudConfig') {
                configReadStarted.resolve();
                return configRead.promise;
            }
            return baseGet(keys);
        });

        const transfer = dispatchBackgroundMessageThroughPort(harness.chromeApi, {
            action: 'DOWNLOAD_MEDIA',
            runToken: lease.token,
            runEpoch: lease.epoch,
            kind: lease.kind,
            url: 'https://assets.grok.com/generated/deferred/image.jpg',
            isVideo: false
        });
        await configReadStarted.promise;
        const stopping = background.stopScrapeRun('sync');
        configRead.resolve({ cloudConfig: { enabled: false, mode: 'local_only' } });

        await expect(transfer.response).resolves.toEqual({ status: 'ignored', reason: 'stale_authority' });
        await expect(stopping).resolves.toMatchObject({ status: 'stopped' });
        expect(harness.chromeApi.downloads.download).not.toHaveBeenCalled();
    });

    test('Stop during backup filename preparation prevents later cloud queue growth', async () => {
        const lease = createLeaseRecord({ kind: 'r2_backup' });
        const harness = createLeaseBackgroundHarness({
            lease,
            localState: {
                scraperState: 'running',
                scrapeRunToken: lease.token,
                scrapeRunEpoch: lease.epoch,
                isScraping: true,
                isR2Backup: true,
                cloudConfig: {
                    enabled: true,
                    mode: 'cloud_only',
                    workerUrl: 'https://unit-placeholder.workers.dev',
                    apiKey: 'unit-placeholder',
                    keyPrefix: 'grok-powertools/v1'
                }
            }
        });
        global.chrome = harness.chromeApi;
        const background = require('../../background.js');
        await background.ensureScrapeLeaseHydrated();
        const filenameRead = deferred();
        const filenameReadStarted = deferred();
        const baseGet = harness.chromeApi.storage.local.get.getMockImplementation();
        harness.chromeApi.storage.local.get.mockImplementation((keys) => {
            if (Array.isArray(keys) && keys.includes('downloadPath')) {
                filenameReadStarted.resolve();
                return filenameRead.promise;
            }
            return baseGet(keys);
        });

        const transfer = dispatchBackgroundMessageThroughPort(harness.chromeApi, {
            action: 'R2_BACKUP_UPLOAD',
            runToken: lease.token,
            runEpoch: lease.epoch,
            kind: lease.kind,
            url: 'https://assets.grok.com/generated/deferred/image.jpg',
            isVideo: false
        });
        await filenameReadStarted.promise;
        const stopping = background.stopScrapeRun('r2_backup');
        filenameRead.resolve({ downloadPath: 'GrokVault', activeGrokUserId: 'Shared_Account' });

        await expect(transfer.response).resolves.toEqual({ status: 'ignored', reason: 'stale_authority' });
        await expect(stopping).resolves.toMatchObject({ status: 'stopped' });
        expect(background.getCloudSyncQueueForTest()).toEqual([]);
    });

    test('Stop during R2 queue persistence leaves no durable queue entry or transfer', async () => {
        const lease = createLeaseRecord({ kind: 'r2_backup' });
        const harness = createLeaseBackgroundHarness({
            lease,
            localState: {
                scraperState: 'running',
                scrapeRunToken: lease.token,
                scrapeRunEpoch: lease.epoch,
                isScraping: true,
                isR2Backup: true,
                cloudConfig: {
                    enabled: true,
                    mode: 'cloud_only',
                    workerUrl: 'https://unit-placeholder.workers.dev',
                    apiKey: 'unit-placeholder',
                    keyPrefix: 'grok-powertools/v1'
                }
            }
        });
        global.chrome = harness.chromeApi;
        const background = require('../../background.js');
        await background.ensureScrapeLeaseHydrated();
        const queueWrite = deferred();
        const queueWriteStarted = deferred();
        const baseSet = harness.chromeApi.storage.local.set.getMockImplementation();
        harness.chromeApi.storage.local.set.mockImplementation((values) => {
            if (Array.isArray(values.cloudSyncQueue) && values.cloudSyncQueue.length > 0) {
                queueWriteStarted.resolve();
                return queueWrite.promise.then(() => baseSet(values));
            }
            return baseSet(values);
        });

        const transfer = dispatchBackgroundMessageThroughPort(harness.chromeApi, {
            action: 'R2_BACKUP_UPLOAD',
            runToken: lease.token,
            runEpoch: lease.epoch,
            kind: lease.kind,
            url: 'https://assets.grok.com/generated/queue-race.jpg',
            isVideo: false,
            skipLocalDownload: true
        }, { tab: { id: lease.tabId } });
        await queueWriteStarted.promise;
        const stopping = background.stopScrapeRun('r2_backup');
        queueWrite.resolve();

        await expect(transfer.response).resolves.toEqual({ status: 'ignored', reason: 'stale_authority' });
        await expect(stopping).resolves.toMatchObject({ status: 'stopped' });
        expect(background.getCloudSyncQueueForTest()).toEqual([]);
        expect(findStoredRecord(
            harness.storedLocal,
            'scrape_completion_journal',
            (record) => record.phase === 'revoked'
        )).toBeTruthy();
        expect(harness.chromeApi.downloads.download).not.toHaveBeenCalled();
    });

    test('Stop bypasses stalled cloud queue persistence and stale completion cannot restore its run item', async () => {
        jest.useFakeTimers();
        const stalledQueueWrite = deferred();
        try {
            const lease = createLeaseRecord({ kind: 'r2_backup' });
            const harness = createLeaseBackgroundHarness({
                lease,
                localState: {
                    scraperState: 'running',
                    scrapeRunToken: lease.token,
                    scrapeRunEpoch: lease.epoch,
                    isScraping: true,
                    isR2Backup: true
                }
            });
            global.chrome = harness.chromeApi;
            let background = require('../../background.js');
            await background.ensureBackgroundStateReady();
            await background.ensureScrapeLeaseHydrated();

            const queueWriteStarted = deferred();
            const baseSet = harness.chromeApi.storage.local.set.getMockImplementation();
            let intercepted = false;
            harness.chromeApi.storage.local.set.mockImplementation((values) => {
                if (!intercepted && Array.isArray(values.cloudSyncQueue) && values.cloudSyncQueue.length > 0) {
                    intercepted = true;
                    queueWriteStarted.resolve();
                    return stalledQueueWrite.promise.then(() => baseSet(values));
                }
                return baseSet(values);
            });

            const staleItem = {
                id: 'run-scoped-stalled-item',
                type: 'media',
                dedupeKey: 'media:stalled-run-item',
                sourceUrl: 'https://assets.grok.com/generated/stalled/item.jpg',
                scrapeLease: { ...lease }
            };
            const enqueueResult = background.enqueueCloudItemForTest(
                staleItem,
                staleItem.dedupeKey
            ).catch((error) => error);
            await queueWriteStarted.promise;

            const stopping = background.stopScrapeRun('r2_backup');
            await jest.advanceTimersByTimeAsync(2500);

            await expect(stopping).resolves.toMatchObject({ status: 'stopped' });
            await expect(enqueueResult).resolves.toMatchObject({
                message: 'cloud_queue_mutation_persist_timeout'
            });
            expect(background.getCloudSyncQueueForTest()).toEqual([]);
            expect(harness.storedLocal.cloudSyncQueue || []).toEqual([]);
            expect(findStoredRecord(
                harness.storedLocal,
                'scrape_completion_journal',
                (record) => record.phase === 'revoked'
            )).toBeTruthy();

            stalledQueueWrite.resolve();
            await flushAsyncTurns(16);

            expect(background.getCloudSyncQueueForTest()).toEqual([]);
            expect(harness.storedLocal.cloudSyncQueue || []).toEqual([]);

            jest.resetModules();
            background = require('../../background.js');
            await background.ensureBackgroundStateReady();

            expect(background.getCloudSyncQueueForTest()).toEqual([]);
            expect(harness.storedLocal.cloudSyncQueue || []).toEqual([]);
        } finally {
            stalledQueueWrite.resolve();
            await jest.runOnlyPendingTimersAsync();
            jest.useRealTimers();
        }
    });

    test('Stop during processed-ID persistence restores the prior operation value', async () => {
        const lease = createLeaseRecord();
        const harness = createLeaseBackgroundHarness({
            lease,
            localState: {
                scraperState: 'running',
                scrapeRunToken: lease.token,
                scrapeRunEpoch: lease.epoch,
                isScraping: true,
                isR2Backup: false,
                processedIds: []
            }
        });
        global.chrome = harness.chromeApi;
        const background = require('../../background.js');
        await background.ensureScrapeLeaseHydrated();
        const processedWrite = deferred();
        const processedWriteStarted = deferred();
        const baseSet = harness.chromeApi.storage.local.set.getMockImplementation();
        harness.chromeApi.storage.local.set.mockImplementation((values) => {
            if (Array.isArray(values.processedIds) && values.processedIds.includes('cancelled-media')) {
                processedWriteStarted.resolve();
                return processedWrite.promise.then(() => baseSet(values));
            }
            return baseSet(values);
        });

        const mutation = dispatchBackgroundMessageThroughPort(harness.chromeApi, {
            action: 'SCRAPE_PROCESSED_IDS_ADD',
            runToken: lease.token,
            runEpoch: lease.epoch,
            kind: lease.kind,
            ids: ['cancelled-media']
        }, { tab: { id: lease.tabId } });
        await processedWriteStarted.promise;
        const stopping = background.stopScrapeRun('sync');
        processedWrite.resolve();

        await expect(mutation.response).resolves.toEqual({ status: 'ignored', reason: 'stale_authority' });
        await expect(stopping).resolves.toMatchObject({ status: 'stopped' });
        expect(harness.storedLocal.processedIds).toEqual([]);
        expect(background.getProcessedUUIDsForTest()).toEqual([]);
    });

    test('a user reset wins after Stop revokes an in-flight scrape processed-ID add', async () => {
        const lease = createLeaseRecord();
        const harness = createLeaseBackgroundHarness({
            lease,
            localState: {
                scraperState: 'running',
                scrapeRunToken: lease.token,
                scrapeRunEpoch: lease.epoch,
                isScraping: true,
                isR2Backup: false,
                processedIds: ['existing-media']
            }
        });
        global.chrome = harness.chromeApi;
        const background = require('../../background.js');
        await background.ensureScrapeLeaseHydrated();
        const processedWrite = deferred();
        const processedWriteStarted = deferred();
        const baseSet = harness.chromeApi.storage.local.set.getMockImplementation();
        harness.chromeApi.storage.local.set.mockImplementation((values) => {
            if (Array.isArray(values.processedIds) && values.processedIds.includes('cancelled-media')) {
                processedWriteStarted.resolve();
                return processedWrite.promise.then(() => baseSet(values));
            }
            return baseSet(values);
        });

        const add = dispatchBackgroundMessageThroughPort(harness.chromeApi, {
            action: 'SCRAPE_PROCESSED_IDS_ADD',
            runToken: lease.token,
            runEpoch: lease.epoch,
            kind: lease.kind,
            ids: ['cancelled-media']
        }, { tab: { id: lease.tabId } });
        await processedWriteStarted.promise;
        const stopping = background.stopScrapeRun('sync');
        const reset = dispatchBackgroundMessageThroughPort(harness.chromeApi, {
            action: 'PROCESSED_IDS_RESET'
        }, { id: harness.chromeApi.runtime.id });
        processedWrite.resolve();

        await expect(add.response).resolves.toEqual({ status: 'ignored', reason: 'stale_authority' });
        await expect(stopping).resolves.toMatchObject({ status: 'stopped' });
        await expect(reset.response).resolves.toEqual({ status: 'ok', processedIds: [] });
        expect(harness.storedLocal.processedIds).toEqual([]);
        expect(background.getProcessedUUIDsForTest()).toEqual([]);
    });

    test('a revoked enqueue rollback cannot delete a newer same-dedupe queue update', async () => {
        const harness = createLeaseBackgroundHarness();
        global.chrome = harness.chromeApi;
        const background = require('../../background.js');
        await flushAsyncTurns(20);
        const postPersist = deferred();
        const releaseRevocation = deferred();
        let authorityChecks = 0;
        const assertAuthorized = async () => {
            authorityChecks++;
            if (authorityChecks !== 2) return;
            postPersist.resolve();
            await releaseRevocation.promise;
            const error = new Error('revoked');
            error.code = 'scrape_authority_revoked';
            throw error;
        };
        const first = {
            id: 'queue-a',
            type: 'media',
            sourceUrl: 'https://assets.grok.com/generated/shared/a.jpg',
            finalPath: 'GrokVault/a.jpg'
        };
        const second = {
            id: 'queue-b',
            type: 'media',
            sourceUrl: 'https://assets.grok.com/generated/shared/b.jpg',
            finalPath: 'GrokVault/b.jpg'
        };

        const staleEnqueue = background.enqueueCloudItemForTest(first, 'media:shared', assertAuthorized);
        await postPersist.promise;
        await background.enqueueCloudItemForTest(second, 'media:shared');
        releaseRevocation.resolve();

        await expect(staleEnqueue).rejects.toMatchObject({ code: 'scrape_authority_revoked' });
        expect(background.getCloudSyncQueueForTest()).toEqual([
            expect.objectContaining({
                sourceUrl: second.sourceUrl,
                finalPath: second.finalPath
            })
        ]);
    });

    test('a successful processor cannot delete a newer same-dedupe queue revision', async () => {
        jest.useFakeTimers();
        try {
            const harness = createLeaseBackgroundHarness({
                localState: {
                    cloudConfig: {
                        enabled: true,
                        mode: 'cloud_only',
                        workerUrl: 'https://unit-placeholder.workers.dev',
                        apiKey: 'unit-placeholder',
                        keyPrefix: 'grok-powertools/v1'
                    }
                }
            });
            global.chrome = harness.chromeApi;
            const background = require('../../background.js');
            await background.ensureBackgroundStateReady();
            const uploadStarted = deferred();
            const releaseUpload = deferred();
            const first = {
                id: 'queue-a',
                type: 'media',
                dedupeKey: 'media:shared',
                queueRevision: 1,
                sourceUrl: 'https://assets.grok.com/generated/shared/a.jpg',
                finalPath: 'GrokVault/a.jpg',
                assetId: 'asset-a',
                contentType: 'image/jpeg'
            };
            const second = {
                id: 'queue-b',
                type: 'media',
                sourceUrl: 'https://assets.grok.com/generated/shared/b.jpg',
                finalPath: 'GrokVault/b.jpg',
                assetId: 'asset-b',
                contentType: 'image/jpeg'
            };
            background.setCloudSyncQueueForTest([first]);

            const processing = background.processCloudQueue('revision-race', {
                uploadMediaQueueItem: async (_config, item) => {
                    expect(item.sourceUrl).toBe(first.sourceUrl);
                    uploadStarted.resolve();
                    await releaseUpload.promise;
                    return { status: 'uploaded', assetId: item.assetId, bytes: 1 };
                }
            });
            await uploadStarted.promise;
            await background.enqueueCloudItemForTest(second, first.dedupeKey);
            releaseUpload.resolve();
            await processing;

            expect(background.getCloudSyncQueueForTest()).toEqual([
                expect.objectContaining({
                    sourceUrl: second.sourceUrl,
                    finalPath: second.finalPath,
                    assetId: second.assetId
                })
            ]);
        } finally {
            jest.useRealTimers();
        }
    });

    test('an existing unguarded queue drain cannot adopt a stopped run-scoped item', async () => {
        const lease = createLeaseRecord({ kind: 'r2_backup' });
        const runMediaId = '73e5e137-1334-49ea-b06b-a9d9ba891003';
        const runUrl = `https://assets.grok.com/users/account/generated/${runMediaId}/image.jpg`;
        const harness = createLeaseBackgroundHarness({
            lease,
            localState: {
                scraperState: 'running',
                scrapeRunToken: lease.token,
                scrapeRunEpoch: lease.epoch,
                isScraping: true,
                isR2Backup: true,
                processedIds: [],
                downloadPath: 'GrokVault',
                activeGrokUserId: 'user-1',
                cloudConfig: {
                    enabled: true,
                    mode: 'cloud_only',
                    workerUrl: 'https://unit-placeholder.workers.dev',
                    apiKey: 'unit-placeholder',
                    keyPrefix: 'grok-powertools/v1'
                }
            }
        });
        global.chrome = harness.chromeApi;
        const background = require('../../background.js');
        await background.ensureBackgroundStateReady();
        await background.ensureScrapeLeaseHydrated();
        const uploadStarted = deferred();
        const releaseUpload = deferred();
        const uploadedUrls = [];
        const initialUrl = 'https://assets.grok.com/generated/preexisting/image.jpg';
        background.setCloudSyncQueueForTest([{
            id: 'preexisting',
            type: 'media',
            dedupeKey: 'media:preexisting',
            queueRevision: 1,
            sourceUrl: initialUrl,
            finalPath: 'GrokVault/preexisting.jpg',
            assetId: 'preexisting',
            contentType: 'image/jpeg'
        }]);

        const draining = background.processCloudQueue('alarm', {
            uploadMediaQueueItem: async (_config, item) => {
                uploadedUrls.push(item.sourceUrl);
                if (item.sourceUrl === initialUrl) {
                    uploadStarted.resolve();
                    await releaseUpload.promise;
                }
                return { status: 'uploaded', assetId: item.assetId, bytes: 1 };
            }
        });
        await uploadStarted.promise;

        const transfer = dispatchBackgroundMessageThroughPort(harness.chromeApi, {
            action: 'R2_BACKUP_UPLOAD',
            runToken: lease.token,
            runEpoch: lease.epoch,
            kind: lease.kind,
            url: runUrl,
            isVideo: false,
            skipLocalDownload: true
        }, { tab: { id: lease.tabId } });
        await expect(transfer.response).resolves.toEqual({ status: 'queued' });
        await expect(background.stopScrapeRun('r2_backup')).resolves.toMatchObject({ status: 'stopped' });
        releaseUpload.resolve();
        await draining;

        expect(uploadedUrls).toEqual([initialUrl]);
        expect(background.getCloudSyncQueueForTest()).toEqual([]);
        expect(harness.storedLocal.processedIds).toEqual([]);
        expect(background.getProcessedUUIDsForTest()).toEqual([]);
    });

    test('runtime mutations wait for startup hydration instead of being overwritten by its snapshot', async () => {
        const harness = createLeaseBackgroundHarness({ localState: { processedIds: [] } });
        const startupRead = deferred();
        const baseGet = harness.chromeApi.storage.local.get.getMockImplementation();
        let interceptedStartup = false;
        harness.chromeApi.storage.local.get.mockImplementation((keys) => {
            if (!interceptedStartup && Array.isArray(keys) && keys.includes('pendingDownloadOperations')) {
                interceptedStartup = true;
                return startupRead.promise;
            }
            return baseGet(keys);
        });
        global.chrome = harness.chromeApi;
        const background = require('../../background.js');

        let responded = false;
        const mutation = dispatchBackgroundMessageThroughPort(harness.chromeApi, {
            action: 'PROCESSED_IDS_ADD',
            ids: ['post-startup-media']
        }, { id: harness.chromeApi.runtime.id });
        mutation.response.then(() => { responded = true; });
        await flushAsyncTurns();

        expect(responded).toBe(false);
        startupRead.resolve({ processedIds: [] });
        await expect(mutation.response).resolves.toEqual({
            status: 'ok',
            processedIds: ['post-startup-media']
        });
        await flushAsyncTurns(20);
        expect(harness.storedLocal.processedIds).toEqual(['post-startup-media']);
        expect(background.getProcessedUUIDsForTest()).toEqual(['post-startup-media']);
    });

    test.each([
        'blob_fetch',
        'preflight_verify',
        'media_presign',
        'media_put',
        'post_upload_verify',
        'sidecar_presign',
        'sidecar_put'
    ])('Stop at the %s boundary prevents later direct-upload side effects', async (blockedStage) => {
        const lease = createLeaseRecord({ kind: 'r2_backup' });
        const mediaId = '73e5e137-1334-49ea-b06b-a9d9ba891003';
        const mediaUrl = `https://assets.grok.com/users/account/generated/${mediaId}/image.jpg`;
        const harness = createLeaseBackgroundHarness({
            lease,
            localState: {
                scraperState: 'running',
                scrapeRunToken: lease.token,
                scrapeRunEpoch: lease.epoch,
                isScraping: true,
                isR2Backup: true,
                processedIds: [],
                downloadPath: 'GrokVault',
                activeGrokUserId: 'user-1',
                cloudConfig: {
                    enabled: true,
                    mode: 'cloud_only',
                    workerUrl: 'https://unit-placeholder.workers.dev',
                    apiKey: 'unit-placeholder',
                    keyPrefix: 'grok-powertools/v1'
                }
            }
        });
        global.chrome = harness.chromeApi;
        const background = require('../../background.js');
        await background.ensureBackgroundStateReady();
        await background.ensureScrapeLeaseHydrated();
        const blocked = deferred();
        const release = deferred();
        const stages = [];
        let verifyCount = 0;

        global.fetch = jest.fn((url, options = {}) => {
            const value = String(url);
            let stage;
            let response;
            if (value.startsWith('data:')) {
                stage = 'blob_fetch';
                response = {
                    ok: true,
                    blob: async () => new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' })
                };
            } else if (value.endsWith('/v1/objects/verify')) {
                verifyCount++;
                stage = verifyCount === 1 ? 'preflight_verify' : 'post_upload_verify';
                response = {
                    ok: true,
                    status: 200,
                    json: async () => verifyCount === 1
                        ? { exists: false, verified: false }
                        : { exists: true, verified: true },
                    text: async () => ''
                };
            } else if (value.endsWith('/v1/presign')) {
                const body = JSON.parse(options.body || '{}');
                const sidecar = String(body.objectKey || '').endsWith('.prompt.json');
                stage = sidecar ? 'sidecar_presign' : 'media_presign';
                response = {
                    ok: true,
                    status: 200,
                    json: async () => ({
                        uploadUrl: sidecar ? 'https://upload.unit/sidecar' : 'https://upload.unit/media',
                        method: 'PUT',
                        headers: {}
                    }),
                    text: async () => ''
                };
            } else if (value === 'https://upload.unit/media') {
                stage = 'media_put';
                response = { ok: true, status: 200, text: async () => '' };
            } else if (value === 'https://upload.unit/sidecar') {
                stage = 'sidecar_put';
                response = { ok: true, status: 200, text: async () => '' };
            } else {
                throw new Error(`Unexpected fetch URL: ${value}`);
            }
            stages.push(stage);
            if (stage === blockedStage) {
                blocked.resolve();
                return release.promise.then(() => response);
            }
            return Promise.resolve(response);
        });

        const transfer = dispatchBackgroundMessageThroughPort(harness.chromeApi, {
            action: 'R2_BACKUP_UPLOAD',
            runToken: lease.token,
            runEpoch: lease.epoch,
            kind: lease.kind,
            url: mediaUrl,
            blobDataUrl: 'data:image/png;base64,AQID',
            promptText: 'unit prompt',
            isVideo: false,
            skipLocalDownload: true
        }, { tab: { id: lease.tabId } });
        await blocked.promise;
        const stopping = background.stopScrapeRun('r2_backup');
        await waitForCondition(() => harness.sessionState.activeScrapeRunToken?.status === 'idle');
        release.resolve();

        await expect(transfer.response).resolves.toEqual({ status: 'ignored', reason: 'stale_authority' });
        await expect(stopping).resolves.toMatchObject({ status: 'stopped' });
        expect(stages.at(-1)).toBe(blockedStage);
        expect(harness.storedLocal.processedIds).toEqual([]);
        expect(background.getProcessedUUIDsForTest()).toEqual([]);
    });

    test.each(['media_put', 'sidecar_put'])('Stop aborts a stalled %s before returning', async (blockedStage) => {
        jest.useFakeTimers();
        try {
            const lease = createLeaseRecord({ kind: 'r2_backup' });
            const mediaId = '73e5e137-1334-49ea-b06b-a9d9ba891003';
            const mediaUrl = `https://assets.grok.com/users/account/generated/${mediaId}/image.jpg`;
            const harness = createLeaseBackgroundHarness({
                lease,
                localState: {
                    scraperState: 'running',
                    scrapeRunToken: lease.token,
                    scrapeRunEpoch: lease.epoch,
                    isScraping: true,
                    isR2Backup: true,
                    processedIds: [],
                    downloadPath: 'GrokVault',
                    activeGrokUserId: 'user-1',
                    cloudConfig: {
                        enabled: true,
                        mode: 'cloud_only',
                        workerUrl: 'https://unit-placeholder.workers.dev',
                        apiKey: 'unit-placeholder',
                        keyPrefix: 'grok-powertools/v1'
                    }
                }
            });
            global.chrome = harness.chromeApi;
            const background = require('../../background.js');
            await background.ensureBackgroundStateReady();
            await background.ensureScrapeLeaseHydrated();
            const putStarted = deferred();
            let stalledSignal = null;
            let verifyCount = 0;

            global.fetch = jest.fn((url, options = {}) => {
                const value = String(url);
                if (value.startsWith('data:')) {
                    return Promise.resolve({
                        ok: true,
                        blob: async () => new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' })
                    });
                }
                if (value.endsWith('/v1/objects/verify')) {
                    verifyCount++;
                    return Promise.resolve({
                        ok: true,
                        status: 200,
                        json: async () => verifyCount === 1
                            ? { exists: false, verified: false }
                            : { exists: true, verified: true },
                        text: async () => ''
                    });
                }
                if (value.endsWith('/v1/presign')) {
                    const body = JSON.parse(options.body || '{}');
                    const sidecar = String(body.objectKey || '').endsWith('.prompt.json');
                    return Promise.resolve({
                        ok: true,
                        status: 200,
                        json: async () => ({
                            uploadUrl: sidecar ? 'https://upload.unit/sidecar' : 'https://upload.unit/media',
                            method: 'PUT',
                            headers: {}
                        }),
                        text: async () => ''
                    });
                }
                const stage = value.endsWith('/sidecar') ? 'sidecar_put' : 'media_put';
                if (stage !== blockedStage) {
                    return Promise.resolve({ ok: true, status: 200, text: async () => '' });
                }
                stalledSignal = options.signal || null;
                putStarted.resolve();
                return new Promise((_resolve, reject) => {
                    stalledSignal?.addEventListener('abort', () => {
                        const error = new Error('aborted');
                        error.name = 'AbortError';
                        reject(error);
                    }, { once: true });
                });
            });

            const transfer = dispatchBackgroundMessageThroughPort(harness.chromeApi, {
                action: 'R2_BACKUP_UPLOAD',
                runToken: lease.token,
                runEpoch: lease.epoch,
                kind: lease.kind,
                url: mediaUrl,
                blobDataUrl: 'data:image/png;base64,AQID',
                promptText: 'unit prompt',
                isVideo: false,
                skipLocalDownload: true
            }, { tab: { id: lease.tabId } });
            await putStarted.promise;

            const stopping = background.stopScrapeRun('r2_backup');
            await jest.advanceTimersByTimeAsync(2500);

            expect(stalledSignal).toBeDefined();
            expect(stalledSignal.aborted).toBe(true);
            await expect(stopping).resolves.toMatchObject({ status: 'stopped' });
            await expect(transfer.response).resolves.toEqual({ status: 'ignored', reason: 'stale_authority' });
            expect(harness.storedLocal.processedIds).toEqual([]);
        } finally {
            jest.useRealTimers();
        }
    });

    test('a delayed native download lifecycle cannot persist identity after Stop returns', async () => {
        const lease = createLeaseRecord();
        const mediaId = '73e5e137-1334-49ea-b06b-a9d9ba891003';
        const mediaUrl = `https://assets.grok.com/users/account/generated/${mediaId}/image.jpg`;
        const harness = createLeaseBackgroundHarness({
            lease,
            localState: {
                scraperState: 'running',
                scrapeRunToken: lease.token,
                scrapeRunEpoch: lease.epoch,
                isScraping: true,
                isR2Backup: false,
                processedIds: [],
                cloudConfig: { enabled: false, mode: 'local_only' }
            }
        });
        harness.chromeApi.downloads.download.mockImplementation((_options, callback) => callback(77));
        harness.chromeApi.downloads.search.mockResolvedValue([{
            id: 77,
            url: mediaUrl,
            finalUrl: mediaUrl,
            state: 'complete',
            filename: '/tmp/GrokVault/image.jpg'
        }]);
        global.chrome = harness.chromeApi;
        const background = require('../../background.js');
        await background.ensureScrapeLeaseHydrated();

        const transfer = dispatchBackgroundMessageThroughPort(harness.chromeApi, {
            action: 'DOWNLOAD_MEDIA',
            runToken: lease.token,
            runEpoch: lease.epoch,
            kind: lease.kind,
            url: mediaUrl,
            isVideo: false
        }, { tab: { id: lease.tabId } });
        await expect(transfer.response).resolves.toEqual({ status: 'queued' });
        await expect(background.stopScrapeRun('sync')).resolves.toMatchObject({ status: 'stopped' });

        const suggest = jest.fn();
        await background.handleDownloadFilename({ id: 77, url: mediaUrl, filename: 'image.jpg' }, suggest);
        await background.handleDownloadChanged({ id: 77, state: { current: 'complete' } });

        expect(harness.storedLocal.processedIds).toEqual([]);
        expect(background.getProcessedUUIDsForTest()).toEqual([]);
        expect(background.getPendingDownloadOperationsForTest()).toEqual({});
    });

    test('dual-write local completion does not persist before R2 is present', async () => {
        const mediaId = '73e5e137-1334-49ea-b06b-a9d9ba891041';
        const { background, harness, downloadItem } = await seedRunOwnedDownloadOperation({
            mode: 'dual_write',
            downloadId: 41,
            mediaId,
            downloadState: 'complete',
            r2State: 'pending'
        });
        const uploadGate = deferred();
        harness.chromeApi.runtime.sendMessage.mockImplementation((message) => (
            message.action === 'READ_FILE_FOR_UPLOAD' ? uploadGate.promise : Promise.resolve({ ok: true })
        ));

        const completion = background.processCompletedDownloadOperation(41, downloadItem);
        await waitForCondition(() => harness.chromeApi.runtime.sendMessage.mock.calls
            .some(([message]) => message.action === 'READ_FILE_FOR_UPLOAD'), 400);
        const processedBeforeR2 = [...harness.storedLocal.processedIds];
        const operationBeforeR2 = background.getPendingDownloadOperationsForTest()['41'];
        uploadGate.resolve({ ok: false });
        await completion;

        expect(processedBeforeR2).toEqual([]);
        expect(operationBeforeR2).toMatchObject({ r2State: 'pending' });
    });

    test('concurrent duplicate R2 acknowledgements single-flight dual-write finalization exactly once', async () => {
        const mediaId = '73e5e137-1334-49ea-b06b-a9d9ba891042';
        const { background, harness } = await seedRunOwnedDownloadOperation({
            mode: 'dual_write',
            downloadId: 42,
            mediaId,
            downloadState: 'complete',
            r2State: 'pending'
        });
        const processedWritesBefore = harness.chromeApi.storage.local.set.mock.calls
            .filter(([values]) => Object.prototype.hasOwnProperty.call(values, 'processedIds')).length;
        const operationRemovalsBefore = harness.chromeApi.storage.local.set.mock.calls
            .filter(([values]) => values.pendingDownloadOperations
                && !Object.prototype.hasOwnProperty.call(values.pendingDownloadOperations, '42')).length;
        const processedWrite = deferred();
        const processedWriteStarted = deferred();
        const baseSet = harness.chromeApi.storage.local.set.getMockImplementation();
        let intercepted = false;
        harness.chromeApi.storage.local.set.mockImplementation((values) => {
            if (!intercepted && Object.prototype.hasOwnProperty.call(values, 'processedIds')) {
                intercepted = true;
                processedWriteStarted.resolve();
                return processedWrite.promise.then(() => baseSet(values));
            }
            return baseSet(values);
        });

        const first = background.markDownloadOperationR2Present(42, { status: 'uploaded' });
        await processedWriteStarted.promise;
        let duplicateSettled = false;
        const duplicate = background.markDownloadOperationR2Present(42, { status: 'already_present' })
            .then((value) => {
                duplicateSettled = true;
                return value;
            });
        await flushAsyncTurns(100);
        const duplicateSettledBeforeRelease = duplicateSettled;
        const operationDuringFinalization = background.getPendingDownloadOperationsForTest()['42'];
        processedWrite.resolve();
        const results = await Promise.all([first, duplicate]);

        const processedWritesAfter = harness.chromeApi.storage.local.set.mock.calls
            .filter(([values]) => Object.prototype.hasOwnProperty.call(values, 'processedIds')).length;
        const operationRemovalsAfter = harness.chromeApi.storage.local.set.mock.calls
            .filter(([values]) => values.pendingDownloadOperations
                && !Object.prototype.hasOwnProperty.call(values.pendingDownloadOperations, '42')).length;
        expect(duplicateSettledBeforeRelease).toBe(true);
        expect(results).toEqual([true, false]);
        expect(operationDuringFinalization).not.toHaveProperty('finalizationClaim');
        expect(harness.storedLocal.processedIds).toEqual(expect.arrayContaining([mediaId]));
        expect(processedWritesAfter - processedWritesBefore).toBe(1);
        expect(operationRemovalsAfter - operationRemovalsBefore).toBe(1);
        expect(background.getPendingDownloadOperationsForTest()).not.toHaveProperty('42');
    });

    test('completion handoff waits for a run-owned finalizer before snapshotting its operation revision', async () => {
        const mediaId = '73e5e137-1334-49ea-b06b-a9d9ba891058';
        const { background, harness, lease } = await seedRunOwnedDownloadOperation({
            mode: 'dual_write',
            downloadId: 58,
            mediaId,
            downloadState: 'complete',
            r2State: 'pending'
        });
        const originalRevision = background.getPendingDownloadOperationsForTest()['58'].operationRevision;
        const processedWrite = deferred();
        const processedWriteStarted = deferred();
        const baseSet = harness.chromeApi.storage.local.set.getMockImplementation();
        let intercepted = false;
        harness.chromeApi.storage.local.set.mockImplementation((values) => {
            if (!intercepted && Object.prototype.hasOwnProperty.call(values, 'processedIds')) {
                intercepted = true;
                processedWriteStarted.resolve();
                return processedWrite.promise.then(() => baseSet(values));
            }
            return baseSet(values);
        });

        const owner = background.markDownloadOperationR2Present(58, { status: 'uploaded' });
        await processedWriteStarted.promise;
        let completionSettled = false;
        const completion = dispatchBackgroundMessage(harness.chromeApi, {
            action: 'SCRAPE_COMPLETE',
            runToken: lease.token,
            runEpoch: lease.epoch,
            kind: lease.kind,
            stats: { stopReason: 'complete' }
        }, { tab: { id: lease.tabId } }).then((response) => {
            completionSettled = true;
            return response;
        });
        await flushAsyncTurns(100);

        await expect(background.markDownloadOperationR2Present(
            58,
            { status: 'already_present' }
        )).resolves.toBe(false);

        const operationDuringFinalization = background.getPendingDownloadOperationsForTest()['58'];
        expect(completionSettled).toBe(false);
        expect(operationDuringFinalization).toMatchObject({
            operationRevision: originalRevision,
            downloadState: 'complete',
            r2State: 'present'
        });
        expect(operationDuringFinalization).not.toHaveProperty('completionTxnId');

        processedWrite.resolve();
        await expect(owner).resolves.toBe(true);
        await expect(completion).resolves.toEqual({ status: 'ok' });
        expect(background.getPendingDownloadOperationsForTest()).not.toHaveProperty('58');
    });

    test('completion preserves a cloud queue record enqueued while a run-owned finalizer is blocked', async () => {
        const mediaId = '73e5e137-1334-49ea-b06b-a9d9ba891060';
        const { background, harness, lease } = await seedRunOwnedDownloadOperation({
            mode: 'dual_write',
            downloadId: 60,
            mediaId,
            downloadState: 'complete',
            r2State: 'pending'
        });
        const processedWrite = deferred();
        const processedWriteStarted = deferred();
        const gateWrite = deferred();
        const gateWriteStarted = deferred();
        const completionWrite = deferred();
        const completionWriteStarted = deferred();
        const baseSet = harness.chromeApi.storage.local.set.getMockImplementation();
        let processedIntercepted = false;
        let gateIntercepted = false;
        let completionIntercepted = false;
        harness.chromeApi.storage.local.set.mockImplementation((values) => {
            if (!processedIntercepted && Object.prototype.hasOwnProperty.call(values, 'processedIds')) {
                processedIntercepted = true;
                processedWriteStarted.resolve();
                return processedWrite.promise.then(() => baseSet(values));
            }
            if (!gateIntercepted
                && !values.scrapeCompletionTxn
                && values.cloudSyncQueue?.some((item) => item.id === 'completion-cloud-gate')) {
                gateIntercepted = true;
                gateWriteStarted.resolve();
                return gateWrite.promise.then(() => baseSet(values));
            }
            if (!completionIntercepted && isCompletionPersistence(values, 'prepared')) {
                completionIntercepted = true;
                completionWriteStarted.resolve();
                return completionWrite.promise.then(() => baseSet(values));
            }
            return baseSet(values);
        });

        const owner = background.markDownloadOperationR2Present(60, { status: 'uploaded' });
        await processedWriteStarted.promise;
        const completion = dispatchBackgroundMessage(harness.chromeApi, {
            action: 'SCRAPE_COMPLETE',
            runToken: lease.token,
            runEpoch: lease.epoch,
            kind: lease.kind,
            stats: { stopReason: 'complete' }
        }, { tab: { id: lease.tabId } });
        await flushAsyncTurns(20);

        const gateItem = {
            id: 'completion-cloud-gate',
            dedupeKey: 'completion-cloud-gate',
            type: 'media',
            sourceUrl: 'https://assets.grok.com/generated/completion-cloud-gate.jpg',
            scrapeLease: { ...lease }
        };
        const newerItem = {
            id: 'completion-cloud-newer',
            dedupeKey: 'completion-cloud-newer',
            type: 'media',
            sourceUrl: 'https://assets.grok.com/generated/completion-cloud-newer.jpg',
            scrapeLease: { ...lease }
        };
        const gateEnqueue = background.enqueueCloudItemForTest(gateItem, gateItem.dedupeKey);
        await gateWriteStarted.promise;
        const newerEnqueue = background.enqueueCloudItemForTest(newerItem, newerItem.dedupeKey);

        processedWrite.resolve();
        await expect(owner).resolves.toBe(true);
        await flushAsyncTurns(100);
        const completionWriteStartedBeforeCloudQueueSettled = completionIntercepted;

        gateWrite.resolve();
        await gateEnqueue;
        await newerEnqueue;
        await completionWriteStarted.promise;
        completionWrite.resolve();
        await expect(completion).resolves.toEqual({ status: 'ok' });

        const preserved = background.getCloudSyncQueueForTest()
            .find((item) => item.id === newerItem.id);
        expect(completionWriteStartedBeforeCloudQueueSettled).toBe(false);
        expect(preserved).toMatchObject({
            id: newerItem.id,
            completionTxnId: expect.any(String),
            revocationLease: expect.objectContaining({ token: lease.token })
        });
        expect(preserved).not.toHaveProperty('scrapeLease');
    });

    test('completion preserves a newer pending-operation revision started during snapshot persistence', async () => {
        const mediaId = '73e5e137-1334-49ea-b06b-a9d9ba891061';
        const newerMediaId = '73e5e137-1334-49ea-b06b-a9d9ba891062';
        const { background, harness, lease } = await seedRunOwnedDownloadOperation({
            mode: 'dual_write',
            downloadId: 61,
            mediaId,
            downloadState: 'complete',
            r2State: 'pending'
        });
        await seedUnrelatedDownloadOperation({
            background,
            harness,
            lease,
            downloadId: 62,
            mediaId: newerMediaId
        });
        const originalRevision = background.getPendingDownloadOperationsForTest()['62'].operationRevision;
        const processedWrite = deferred();
        const processedWriteStarted = deferred();
        const completionWrite = deferred();
        const completionWriteStarted = deferred();
        const baseSet = harness.chromeApi.storage.local.set.getMockImplementation();
        let processedIntercepted = false;
        let completionIntercepted = false;
        harness.chromeApi.storage.local.set.mockImplementation((values) => {
            if (!processedIntercepted && Object.prototype.hasOwnProperty.call(values, 'processedIds')) {
                processedIntercepted = true;
                processedWriteStarted.resolve();
                return processedWrite.promise.then(() => baseSet(values));
            }
            if (!completionIntercepted && isCompletionPersistence(values, 'prepared')) {
                completionIntercepted = true;
                completionWriteStarted.resolve();
                return completionWrite.promise.then(() => baseSet(values));
            }
            return baseSet(values);
        });

        const owner = background.markDownloadOperationR2Present(61, { status: 'uploaded' });
        await processedWriteStarted.promise;
        const completion = dispatchBackgroundMessage(harness.chromeApi, {
            action: 'SCRAPE_COMPLETE',
            runToken: lease.token,
            runEpoch: lease.epoch,
            kind: lease.kind,
            stats: { stopReason: 'complete' }
        }, { tab: { id: lease.tabId } });
        processedWrite.resolve();
        await expect(owner).resolves.toBe(true);
        await completionWriteStarted.promise;

        let newerUpdateSettled = false;
        const newerUpdate = background.updateDownloadOperation(62, { attempts: 9 }).then((value) => {
            newerUpdateSettled = true;
            return value;
        });
        await flushAsyncTurns(100);
        const newerUpdateSettledBeforeCompletionWrite = newerUpdateSettled;

        completionWrite.resolve();
        await expect(completion).resolves.toEqual({ status: 'ok' });
        await expect(newerUpdate).resolves.toMatchObject({ attempts: 9 });

        expect(newerUpdateSettledBeforeCompletionWrite).toBe(false);
        expect(background.getPendingDownloadOperationsForTest()['62']).toMatchObject({
            attempts: 9,
            operationRevision: expect.any(Number),
            completionTxnId: expect.any(String),
            revocationLease: expect.objectContaining({ token: lease.token })
        });
        expect(background.getPendingDownloadOperationsForTest()['62'].operationRevision)
            .toBeGreaterThan(originalRevision);
    });

    test('completion commit hands off a cloud item created after the prepared snapshot', async () => {
        const lease = createLeaseRecord({ token: 'completion-late-cloud' });
        const harness = createLeaseBackgroundHarness({
            lease,
            localState: {
                scraperState: 'running',
                scrapeRunToken: lease.token,
                scrapeRunEpoch: lease.epoch,
                isScraping: true,
                isR2Backup: false
            }
        });
        global.chrome = harness.chromeApi;
        const background = require('../../background.js');
        await background.ensureBackgroundStateReady();
        await background.ensureScrapeLeaseHydrated();
        const preparedWrite = deferred();
        const preparedWriteStarted = deferred();
        const baseSet = harness.chromeApi.storage.local.set.getMockImplementation();
        let preparedValues = null;
        harness.chromeApi.storage.local.set.mockImplementation((values) => {
            if (!preparedValues && isCompletionPersistence(values, 'prepared')) {
                preparedValues = JSON.parse(JSON.stringify(values));
                preparedWriteStarted.resolve();
                return preparedWrite.promise.then(() => baseSet(values));
            }
            return baseSet(values);
        });

        const completion = dispatchBackgroundMessage(harness.chromeApi, {
            action: 'SCRAPE_COMPLETE',
            runToken: lease.token,
            runEpoch: lease.epoch,
            kind: lease.kind,
            stats: { stopReason: 'complete' }
        }, { tab: { id: lease.tabId } });
        await preparedWriteStarted.promise;
        const lateItem = {
            id: 'completion-after-prepare-cloud',
            dedupeKey: 'completion-after-prepare-cloud',
            type: 'media',
            sourceUrl: 'https://assets.grok.com/generated/completion-after-prepare-cloud.jpg',
            scrapeLease: { ...lease }
        };
        const enqueue = background.enqueueCloudItemForTest(lateItem, lateItem.dedupeKey);

        preparedWrite.resolve();
        await enqueue;
        await expect(completion).resolves.toEqual({ status: 'ok' });

        expect(findStoredRecord(preparedValues, 'scrape_completion_journal')).toMatchObject({
            phase: 'prepared'
        });
        const committed = background.getCloudSyncQueueForTest()
            .find((item) => item.id === lateItem.id);
        expect(committed).toMatchObject({
            completionTxnId: expect.any(String),
            revocationLease: expect.objectContaining({ token: lease.token })
        });
        expect(committed).not.toHaveProperty('scrapeLease');
    });

    test('completion commit hands off a pending operation created after the prepared snapshot', async () => {
        const lease = createLeaseRecord({ token: 'completion-late-operation' });
        const harness = createLeaseBackgroundHarness({
            lease,
            localState: {
                scraperState: 'running',
                scrapeRunToken: lease.token,
                scrapeRunEpoch: lease.epoch,
                isScraping: true,
                isR2Backup: false
            }
        });
        global.chrome = harness.chromeApi;
        const background = require('../../background.js');
        await background.ensureBackgroundStateReady();
        await background.ensureScrapeLeaseHydrated();
        const preparedWrite = deferred();
        const preparedWriteStarted = deferred();
        const baseSet = harness.chromeApi.storage.local.set.getMockImplementation();
        let preparedValues = null;
        harness.chromeApi.storage.local.set.mockImplementation((values) => {
            if (!preparedValues && isCompletionPersistence(values, 'prepared')) {
                preparedValues = JSON.parse(JSON.stringify(values));
                preparedWriteStarted.resolve();
                return preparedWrite.promise.then(() => baseSet(values));
            }
            return baseSet(values);
        });

        const completion = dispatchBackgroundMessage(harness.chromeApi, {
            action: 'SCRAPE_COMPLETE',
            runToken: lease.token,
            runEpoch: lease.epoch,
            kind: lease.kind,
            stats: { stopReason: 'complete' }
        }, { tab: { id: lease.tabId } });
        await preparedWriteStarted.promise;
        const reservation = background.reserveDownloadOperationForTest({
            downloadId: 63,
            mediaId: '73e5e137-1334-49ea-b06b-a9d9ba891063',
            allowLocal: true,
            cloudRequired: true,
            strategy: 'auth_file',
            downloadState: 'in_progress',
            r2State: 'pending',
            attempts: 0,
            scrapeLease: { ...lease }
        });

        preparedWrite.resolve();
        await expect(reservation).resolves.toBe(true);
        await expect(completion).resolves.toEqual({ status: 'ok' });

        expect(findStoredRecord(preparedValues, 'scrape_completion_journal')).toMatchObject({
            phase: 'prepared'
        });
        expect(background.getPendingDownloadOperationsForTest()['63']).toMatchObject({
            completionTxnId: expect.any(String),
            revocationLease: expect.objectContaining({ token: lease.token })
        });
        expect(background.getPendingDownloadOperationsForTest()['63']).not.toHaveProperty('scrapeLease');
    });

    test('completion timeout releases later cloud mutations while its immutable write is still pending', async () => {
        jest.useFakeTimers();
        const lease = createLeaseRecord({ token: 'completion-timeout-order' });
        const harness = createLeaseBackgroundHarness({
            lease,
            localState: {
                scraperState: 'running',
                scrapeRunToken: lease.token,
                scrapeRunEpoch: lease.epoch,
                isScraping: true,
                isR2Backup: false
            }
        });
        global.chrome = harness.chromeApi;
        const background = require('../../background.js');
        await background.ensureBackgroundStateReady();
        await background.ensureScrapeLeaseHydrated();
        const completionWrite = deferred();
        const completionWriteStarted = deferred();
        const baseSet = harness.chromeApi.storage.local.set.getMockImplementation();
        let completionIntercepted = false;
        let secondWriteStarted = false;
        harness.chromeApi.storage.local.set.mockImplementation((values) => {
            if (!completionIntercepted && isCompletionPersistence(values, 'prepared')) {
                completionIntercepted = true;
                completionWriteStarted.resolve();
                return completionWrite.promise.then(() => baseSet(values));
            }
            if (values.cloudSyncQueue?.some((item) => item.id === 'cloud-after-timeout')) {
                secondWriteStarted = true;
            }
            return baseSet(values);
        });

        const completion = dispatchBackgroundMessage(harness.chromeApi, {
            action: 'SCRAPE_COMPLETE',
            runToken: lease.token,
            runEpoch: lease.epoch,
            kind: lease.kind,
            stats: { stopReason: 'complete' }
        }, { tab: { id: lease.tabId } });
        await completionWriteStarted.promise;
        const firstItem = {
            id: 'cloud-waiting-on-completion',
            dedupeKey: 'cloud-waiting-on-completion',
            type: 'media'
        };
        const firstMutation = background.enqueueCloudItemForTest(firstItem, firstItem.dedupeKey)
            .catch((error) => error);
        await jest.advanceTimersByTimeAsync(1100);
        await expect(completion).resolves.toEqual({ status: 'ignored' });
        const secondItem = {
            id: 'cloud-after-timeout',
            dedupeKey: 'cloud-after-timeout',
            type: 'media'
        };
        const secondMutation = background.enqueueCloudItemForTest(secondItem, secondItem.dedupeKey)
            .catch((error) => error);
        await flushAsyncTurns(20);
        const startedBeforeCompletionSettled = secondWriteStarted;

        completionWrite.resolve();
        await flushAsyncTurns(100);
        await Promise.allSettled([firstMutation, secondMutation]);

        expect(startedBeforeCompletionSettled).toBe(true);
        expect(background.getCloudSyncQueueForTest()).toEqual(expect.arrayContaining([
            expect.objectContaining({ id: firstItem.id }),
            expect.objectContaining({ id: secondItem.id })
        ]));
    });

    test('completion timeout releases both mutation streams while its immutable write is unresolved', async () => {
        jest.useFakeTimers();
        const lease = createLeaseRecord({ token: 'completion-unresolved-order' });
        const harness = createLeaseBackgroundHarness({
            lease,
            localState: {
                scraperState: 'running',
                scrapeRunToken: lease.token,
                scrapeRunEpoch: lease.epoch,
                isScraping: true,
                isR2Backup: false
            }
        });
        global.chrome = harness.chromeApi;
        const background = require('../../background.js');
        await background.ensureBackgroundStateReady();
        await background.ensureScrapeLeaseHydrated();
        const completionWrite = deferred();
        const completionWriteStarted = deferred();
        const baseSet = harness.chromeApi.storage.local.set.getMockImplementation();
        let completionIntercepted = false;
        harness.chromeApi.storage.local.set.mockImplementation((values) => {
            if (!completionIntercepted && isCompletionPersistence(values, 'prepared')) {
                completionIntercepted = true;
                completionWriteStarted.resolve();
                return completionWrite.promise.then(() => baseSet(values));
            }
            return baseSet(values);
        });

        const completion = dispatchBackgroundMessage(harness.chromeApi, {
            action: 'SCRAPE_COMPLETE',
            runToken: lease.token,
            runEpoch: lease.epoch,
            kind: lease.kind,
            stats: { stopReason: 'complete' }
        }, { tab: { id: lease.tabId } });
        await completionWriteStarted.promise;
        const cloudMutation = background.enqueueCloudItemForTest({
            id: 'cloud-blocked-by-unresolved-completion',
            dedupeKey: 'cloud-blocked-by-unresolved-completion',
            type: 'media'
        }, 'cloud-blocked-by-unresolved-completion').catch((error) => error);
        const pendingMutation = background.reserveDownloadOperationForTest({
            downloadId: 64,
            mediaId: '73e5e137-1334-49ea-b06b-a9d9ba891064',
            allowLocal: true,
            cloudRequired: false,
            downloadState: 'in_progress',
            r2State: 'not_required',
            attempts: 0
        }).catch((error) => error);
        await jest.advanceTimersByTimeAsync(2200);
        const laterCloudMutation = background.enqueueCloudItemForTest({
            id: 'cloud-still-behind-unresolved-completion',
            dedupeKey: 'cloud-still-behind-unresolved-completion',
            type: 'media'
        }, 'cloud-still-behind-unresolved-completion').catch((error) => error);
        const laterPendingMutation = background.updateDownloadOperation(64, { attempts: 2 })
            .catch((error) => error);
        await flushAsyncTurns(20);
        const queueWhileUnresolved = background.getCloudSyncQueueForTest();
        const operationsWhileUnresolved = background.getPendingDownloadOperationsForTest();

        completionWrite.reject(new Error('forced unresolved completion rejection'));
        await flushAsyncTurns(100);
        await Promise.allSettled([
            completion,
            cloudMutation,
            pendingMutation,
            laterCloudMutation,
            laterPendingMutation
        ]);

        expect(queueWhileUnresolved).toEqual(expect.arrayContaining([
            expect.objectContaining({ id: 'cloud-blocked-by-unresolved-completion' }),
            expect.objectContaining({ id: 'cloud-still-behind-unresolved-completion' })
        ]));
        expect(operationsWhileUnresolved['64']).toMatchObject({ attempts: 2 });
        expect(background.getCloudSyncQueueForTest()).toEqual(expect.arrayContaining([
            expect.objectContaining({ id: 'cloud-blocked-by-unresolved-completion' }),
            expect.objectContaining({ id: 'cloud-still-behind-unresolved-completion' })
        ]));
        expect(background.getPendingDownloadOperationsForTest()['64']).toMatchObject({ attempts: 2 });
    });

    test('a permanently unsettled completion write releases safely after revocation and cannot freeze either mutation stream', async () => {
        jest.useFakeTimers();
        const lease = createLeaseRecord({ token: 'completion-never-settles' });
        const harness = createLeaseBackgroundHarness({
            lease,
            localState: {
                scraperState: 'running',
                scrapeRunToken: lease.token,
                scrapeRunEpoch: lease.epoch,
                isScraping: true,
                isR2Backup: false
            }
        });
        global.chrome = harness.chromeApi;
        const background = require('../../background.js');
        await background.ensureBackgroundStateReady();
        await background.ensureScrapeLeaseHydrated();
        const completionWriteStarted = deferred();
        const baseSet = harness.chromeApi.storage.local.set.getMockImplementation();
        let intercepted = false;
        harness.chromeApi.storage.local.set.mockImplementation((values) => {
            if (!intercepted && isCompletionPersistence(values, 'prepared')) {
                intercepted = true;
                completionWriteStarted.resolve();
                return new Promise(() => {});
            }
            return baseSet(values);
        });

        const completion = dispatchBackgroundMessageThroughPort(harness.chromeApi, {
            action: 'SCRAPE_COMPLETE',
            runToken: lease.token,
            runEpoch: lease.epoch,
            kind: lease.kind,
            stats: { stopReason: 'complete' }
        }, { tab: { id: lease.tabId } });
        await completionWriteStarted.promise;
        await jest.advanceTimersByTimeAsync(1100);
        await expect(completion.response).resolves.toEqual({ status: 'ignored' });

        const stop = dispatchBackgroundMessageThroughPort(
            harness.chromeApi,
            { action: 'STOP_SCRAPE' },
            { tab: { id: lease.tabId } }
        );
        await jest.advanceTimersByTimeAsync(2100);
        await expect(stop.response).resolves.toMatchObject({ status: 'stopped' });

        const cloudMutation = background.enqueueCloudItemForTest({
            id: 'cloud-after-permanent-completion-timeout',
            dedupeKey: 'cloud-after-permanent-completion-timeout',
            type: 'media'
        }, 'cloud-after-permanent-completion-timeout');
        const pendingMutation = background.reserveDownloadOperationForTest({
            downloadId: 65,
            mediaId: '73e5e137-1334-49ea-b06b-a9d9ba891065',
            allowLocal: true,
            cloudRequired: false,
            downloadState: 'in_progress',
            r2State: 'not_required',
            attempts: 0
        });

        await expect(cloudMutation).resolves.toMatchObject({
            dedupeKey: 'cloud-after-permanent-completion-timeout'
        });
        await expect(pendingMutation).resolves.toBe(true);
        expect(background.getCloudSyncQueueForTest()).toEqual(expect.arrayContaining([
            expect.objectContaining({ id: 'cloud-after-permanent-completion-timeout' })
        ]));
        expect(background.getPendingDownloadOperationsForTest()).toHaveProperty('65');
    });

    test('a prepared completion that succeeds after caller timeout is revoked without blocking or overwriting newer mutations', async () => {
        jest.useFakeTimers();
        const lease = createLeaseRecord({ token: 'completion-late-prepare-success' });
        const harness = createLeaseBackgroundHarness({
            lease,
            localState: {
                scraperState: 'running',
                scrapeRunToken: lease.token,
                scrapeRunEpoch: lease.epoch,
                isScraping: true,
                isR2Backup: false
            }
        });
        global.chrome = harness.chromeApi;
        const background = require('../../background.js');
        await background.ensureBackgroundStateReady();
        await background.ensureScrapeLeaseHydrated();
        const lateWrite = deferred();
        const completionWriteStarted = deferred();
        const baseSet = harness.chromeApi.storage.local.set.getMockImplementation();
        let lateValues = null;
        harness.chromeApi.storage.local.set.mockImplementation((values) => {
            if (!lateValues && isCompletionPersistence(values, 'prepared')) {
                lateValues = values;
                completionWriteStarted.resolve();
                return lateWrite.promise.then(() => baseSet(values));
            }
            return baseSet(values);
        });

        const completion = dispatchBackgroundMessageThroughPort(harness.chromeApi, {
            action: 'SCRAPE_COMPLETE',
            runToken: lease.token,
            runEpoch: lease.epoch,
            kind: lease.kind,
            stats: { stopReason: 'complete' }
        }, { tab: { id: lease.tabId } });
        await completionWriteStarted.promise;
        await jest.advanceTimersByTimeAsync(1100);
        await expect(completion.response).resolves.toEqual({ status: 'ignored' });
        const stop = dispatchBackgroundMessageThroughPort(
            harness.chromeApi,
            { action: 'STOP_SCRAPE' },
            { tab: { id: lease.tabId } }
        );
        await jest.advanceTimersByTimeAsync(2100);
        await expect(stop.response).resolves.toMatchObject({ status: 'stopped' });

        await expect(background.enqueueCloudItemForTest({
            id: 'cloud-after-late-prepare',
            dedupeKey: 'cloud-after-late-prepare',
            type: 'media'
        }, 'cloud-after-late-prepare')).resolves.toMatchObject({
            dedupeKey: 'cloud-after-late-prepare'
        });
        await expect(background.reserveDownloadOperationForTest({
            downloadId: 66,
            mediaId: '73e5e137-1334-49ea-b06b-a9d9ba891066',
            allowLocal: true,
            cloudRequired: false,
            downloadState: 'in_progress',
            r2State: 'not_required',
            attempts: 0
        })).resolves.toBe(true);

        lateWrite.resolve();
        await flushAsyncTurns(60);

        expect(background.getCloudSyncQueueForTest()).toEqual(expect.arrayContaining([
            expect.objectContaining({ id: 'cloud-after-late-prepare' })
        ]));
        expect(background.getPendingDownloadOperationsForTest()).toHaveProperty('66');
        const nextRun = await background.initializeScrapeInActiveTab({ action: 'INIT_SCRAPE' });
        expect(nextRun).toMatchObject({ status: 'started', runToken: expect.any(String) });
        expect(nextRun.runToken).not.toBe(lease.token);
    });

    test('a terminal checkpoint cannot revoke a replacement run after its session epoch resets', async () => {
        const oldLease = createLeaseRecord({
            epoch: 50,
            token: 'old-session-checkpoint',
            writerEpoch: 1
        });
        const harness = createLeaseBackgroundHarness({
            localState: {
                'scrapeCompletionJournal:old-session-checkpoint': {
                    kind: 'scrape_completion_journal',
                    version: 2,
                    writerEpoch: 1,
                    revision: 1,
                    phase: 'revoked',
                    lease: oldLease,
                    txn: null,
                    checkpoint: {
                        version: 1,
                        retiredThroughWriterEpoch: 1,
                        retiredThroughEpoch: 50,
                        committed: [],
                        fence: { writerEpoch: 1, revision: 1 }
                    }
                }
            }
        });
        global.chrome = harness.chromeApi;
        let background = require('../../background.js');
        await background.ensureBackgroundStateReady();
        const started = await background.initializeScrapeInActiveTab({ action: 'INIT_SCRAPE' });
        expect(started).toMatchObject({ status: 'started', runEpoch: 1 });
        const replacementLease = { ...harness.sessionState.activeScrapeRunToken };

        await background.enqueueCloudItemForTest({
            id: 'replacement-session-item',
            dedupeKey: 'replacement-session-item',
            type: 'media',
            scrapeLease: replacementLease
        }, 'replacement-session-item');
        expect(background.getCloudSyncQueueForTest()).toHaveLength(1);

        jest.resetModules();
        background = require('../../background.js');
        await background.ensureBackgroundStateReady();
        await background.ensureScrapeLeaseHydrated();

        expect(background.getCloudSyncQueueForTest()).toEqual([
            expect.objectContaining({
                id: 'replacement-session-item',
                scrapeLease: expect.objectContaining({ token: started.runToken })
            })
        ]);
    });

    test('completion journal retention stays bounded across many successful cycles', async () => {
        const harness = createLeaseBackgroundHarness();
        global.chrome = harness.chromeApi;
        const background = require('../../background.js');
        await background.ensureBackgroundStateReady();

        for (let cycle = 0; cycle < 16; cycle++) {
            const started = await background.initializeScrapeInActiveTab({ action: 'INIT_SCRAPE' });
            expect(started).toMatchObject({ status: 'started' });
            const completion = dispatchLatestBackgroundMessageThroughPort(harness.chromeApi, {
                action: 'SCRAPE_COMPLETE',
                runToken: started.runToken,
                runEpoch: started.runEpoch,
                kind: 'sync',
                stats: { stopReason: 'complete' }
            }, { tab: { id: 42 } });
            await expect(completion.response).resolves.toEqual({ status: 'ok' });
            expect(getStoredCompletionJournalEntries(harness.storedLocal).length).toBeLessThanOrEqual(1);
        }

        const retained = getStoredCompletionJournalEntries(harness.storedLocal);
        expect(retained).toHaveLength(1);
        expect(retained[0][1]).toMatchObject({
            phase: 'committed',
            checkpoint: expect.objectContaining({ version: 1 })
        });
    });

    test.each(['prepared', 'committed'])(
        'a late %s write after compaction stays below the revocation checkpoint after restart',
        async (latePhase) => {
            jest.useFakeTimers();
            const lateWrite = deferred();
            try {
                const lease = createLeaseRecord({ token: `late-${latePhase}-after-compaction` });
                const harness = createLeaseBackgroundHarness({
                    lease,
                    localState: {
                        scraperState: 'running',
                        scrapeRunToken: lease.token,
                        scrapeRunEpoch: lease.epoch,
                        isScraping: true,
                        isR2Backup: false,
                        cloudSyncQueue: [{
                            id: `owned-${latePhase}-item`,
                            dedupeKey: `owned-${latePhase}-item`,
                            queueRevision: 1,
                            type: 'media',
                            scrapeLease: lease
                        }]
                    }
                });
                global.chrome = harness.chromeApi;
                let background = require('../../background.js');
                await background.ensureBackgroundStateReady();
                await background.ensureScrapeLeaseHydrated();
                const lateWriteStarted = deferred();
                const lateWriteApplied = deferred();
                const baseSet = harness.chromeApi.storage.local.set.getMockImplementation();
                let lateValues = null;
                harness.chromeApi.storage.local.set.mockImplementation((values) => {
                    if (!lateValues && isCompletionPersistence(values, latePhase)) {
                        lateValues = JSON.parse(JSON.stringify(values));
                        lateWriteStarted.resolve();
                        return lateWrite.promise.then(async () => {
                            await baseSet(lateValues);
                            lateWriteApplied.resolve();
                            return new Promise(() => {});
                        });
                    }
                    return baseSet(values);
                });

                const completion = dispatchLatestBackgroundMessageThroughPort(harness.chromeApi, {
                    action: 'SCRAPE_COMPLETE',
                    runToken: lease.token,
                    runEpoch: lease.epoch,
                    kind: lease.kind,
                    stats: { stopReason: 'complete' }
                }, { tab: { id: lease.tabId } });
                await lateWriteStarted.promise;
                await jest.advanceTimersByTimeAsync(3200);
                await expect(completion.response).resolves.toEqual({ status: 'ignored' });

                lateWrite.resolve();
                await lateWriteApplied.promise;
                jest.useRealTimers();
                jest.resetModules();
                background = require('../../background.js');
                await background.ensureBackgroundStateReady();

                expect(background.getCloudSyncQueueForTest()).toEqual([]);
                const retained = getStoredCompletionJournalEntries(harness.storedLocal);
                expect(retained).toHaveLength(1);
                expect(retained[0][1]).toMatchObject({
                    phase: 'revoked',
                    checkpoint: expect.objectContaining({ version: 1 })
                });
                await expect(background.initializeScrapeInActiveTab({ action: 'INIT_SCRAPE' }))
                    .resolves.toMatchObject({ status: 'started' });
            } finally {
                lateWrite.resolve();
                jest.useRealTimers();
            }
        }
    );

    test('completion fails closed and retains its prior fence when checkpoint persistence rejects', async () => {
        const lease = createLeaseRecord({ token: 'checkpoint-persist-rejection' });
        const priorLease = createLeaseRecord({ token: 'prior-checkpoint', epoch: 2 });
        const priorKey = 'scrapeCompletionJournal:prior-checkpoint';
        const harness = createLeaseBackgroundHarness({
            lease,
            localState: {
                scraperState: 'running',
                scrapeRunToken: lease.token,
                scrapeRunEpoch: lease.epoch,
                isScraping: true,
                isR2Backup: false,
                [priorKey]: {
                    kind: 'scrape_completion_journal',
                    version: 2,
                    writerEpoch: 1,
                    revision: 1,
                    phase: 'revoked',
                    lease: priorLease,
                    txn: null,
                    checkpoint: { version: 1, retiredThroughEpoch: 2, committed: [] }
                }
            }
        });
        global.chrome = harness.chromeApi;
        const background = require('../../background.js');
        await background.ensureBackgroundStateReady();
        await background.ensureScrapeLeaseHydrated();
        const baseSet = harness.chromeApi.storage.local.set.getMockImplementation();
        harness.chromeApi.storage.local.set.mockImplementation((values) => {
            const checkpoint = findStoredRecord(
                values,
                'scrape_completion_journal',
                (record) => record.phase === 'committed' && record.checkpoint
            );
            if (checkpoint) return Promise.reject(new Error('forced checkpoint quota rejection'));
            return baseSet(values);
        });

        const completion = dispatchLatestBackgroundMessageThroughPort(harness.chromeApi, {
            action: 'SCRAPE_COMPLETE',
            runToken: lease.token,
            runEpoch: lease.epoch,
            kind: lease.kind,
            stats: { stopReason: 'complete' }
        }, { tab: { id: lease.tabId } });

        await expect(completion.response).resolves.toEqual({ status: 'ignored' });
        expect(harness.storedLocal).toHaveProperty(priorKey);
        expect(harness.chromeApi.runtime.sendMessage).not.toHaveBeenCalledWith(expect.objectContaining({
            action: 'SCRAPE_COMPLETE'
        }));
    });

    test('completion fails closed without deleting either fence when journal compaction rejects', async () => {
        const lease = createLeaseRecord({ token: 'checkpoint-compaction-rejection' });
        const priorLease = createLeaseRecord({ token: 'prior-compaction-checkpoint', epoch: 2 });
        const priorKey = 'scrapeCompletionJournal:prior-compaction-checkpoint';
        const harness = createLeaseBackgroundHarness({
            lease,
            localState: {
                scraperState: 'running',
                scrapeRunToken: lease.token,
                scrapeRunEpoch: lease.epoch,
                isScraping: true,
                isR2Backup: false,
                [priorKey]: {
                    kind: 'scrape_completion_journal',
                    version: 2,
                    writerEpoch: 1,
                    revision: 1,
                    phase: 'revoked',
                    lease: priorLease,
                    txn: null,
                    checkpoint: { version: 1, retiredThroughEpoch: 2, committed: [] }
                }
            }
        });
        global.chrome = harness.chromeApi;
        const background = require('../../background.js');
        await background.ensureBackgroundStateReady();
        await background.ensureScrapeLeaseHydrated();
        harness.chromeApi.storage.local.remove.mockRejectedValueOnce(
            new Error('forced completion compaction rejection')
        );

        const completion = dispatchLatestBackgroundMessageThroughPort(harness.chromeApi, {
            action: 'SCRAPE_COMPLETE',
            runToken: lease.token,
            runEpoch: lease.epoch,
            kind: lease.kind,
            stats: { stopReason: 'complete' }
        }, { tab: { id: lease.tabId } });

        await expect(completion.response).resolves.toEqual({ status: 'ignored' });
        expect(harness.storedLocal).toHaveProperty(priorKey);
        expect(getStoredCompletionJournalEntries(harness.storedLocal)).toEqual(expect.arrayContaining([
            expect.arrayContaining([
                expect.any(String),
                expect.objectContaining({
                    phase: 'committed',
                    checkpoint: expect.objectContaining({ version: 1 })
                })
            ])
        ]));
        expect(harness.chromeApi.runtime.sendMessage).not.toHaveBeenCalledWith(expect.objectContaining({
            action: 'SCRAPE_COMPLETE'
        }));
    });

    test('Stop during finalizer handoff prevents a stale prepared completion transaction', async () => {
        const mediaId = '73e5e137-1334-49ea-b06b-a9d9ba891059';
        const { background, harness, lease } = await seedRunOwnedDownloadOperation({
            mode: 'dual_write',
            downloadId: 59,
            mediaId,
            downloadState: 'complete',
            r2State: 'pending'
        });
        const processedWrite = deferred();
        const processedWriteStarted = deferred();
        const baseSet = harness.chromeApi.storage.local.set.getMockImplementation();
        let intercepted = false;
        harness.chromeApi.storage.local.set.mockImplementation((values) => {
            if (!intercepted && Object.prototype.hasOwnProperty.call(values, 'processedIds')) {
                intercepted = true;
                processedWriteStarted.resolve();
                return processedWrite.promise.then(() => baseSet(values));
            }
            return baseSet(values);
        });

        const owner = background.markDownloadOperationR2Present(59, { status: 'uploaded' })
            .catch((error) => error);
        await processedWriteStarted.promise;
        const completion = dispatchBackgroundMessage(harness.chromeApi, {
            action: 'SCRAPE_COMPLETE',
            runToken: lease.token,
            runEpoch: lease.epoch,
            kind: lease.kind,
            stats: { stopReason: 'complete' }
        }, { tab: { id: lease.tabId } });
        await flushAsyncTurns(100);

        await expect(background.stopScrapeRun('sync')).resolves.toMatchObject({ status: 'stopped' });
        processedWrite.resolve();

        await expect(owner).resolves.toMatchObject({ code: 'scrape_authority_revoked' });
        await expect(completion).resolves.toMatchObject({ status: 'ignored' });
        expect(findStoredRecord(
            harness.storedLocal,
            'scrape_completion_journal',
            (record) => record.phase === 'revoked'
        )).toBeTruthy();
        expect(background.getPendingDownloadOperationsForTest()).not.toHaveProperty('59');
    });

    test('final identity phase persistence rejection releases ownership without repeating the ID write', async () => {
        const mediaId = '73e5e137-1334-49ea-b06b-a9d9ba891052';
        const { background, harness } = await seedRunOwnedDownloadOperation({
            mode: 'dual_write',
            downloadId: 52,
            mediaId,
            downloadState: 'complete',
            r2State: 'pending'
        });
        const processedWritesBefore = harness.chromeApi.storage.local.set.mock.calls
            .filter(([values]) => Object.prototype.hasOwnProperty.call(values, 'processedIds')).length;
        const operationRemovalsBefore = harness.chromeApi.storage.local.set.mock.calls
            .filter(([values]) => values.pendingDownloadOperations
                && !Object.prototype.hasOwnProperty.call(values.pendingDownloadOperations, '52')).length;
        const baseSet = harness.chromeApi.storage.local.set.getMockImplementation();
        let rejected = false;
        harness.chromeApi.storage.local.set.mockImplementation((values) => {
            const operation = values.pendingDownloadOperations?.['52'];
            if (!rejected && operation?.finalIdentityPersisted === true) {
                rejected = true;
                return Promise.reject(new Error('final identity phase persistence failed'));
            }
            return baseSet(values);
        });

        await expect(background.markDownloadOperationR2Present(52, { status: 'uploaded' }))
            .rejects.toThrow('final identity phase persistence failed');

        const retryable = background.getPendingDownloadOperationsForTest()['52'];
        expect(retryable).toMatchObject({
            downloadState: 'complete',
            r2State: 'present',
            finalIdentityPersisted: true
        });
        expect(retryable).not.toHaveProperty('finalizationClaim');
        expect(harness.storedLocal.pendingDownloadOperations['52']).toMatchObject({ r2State: 'present' });
        expect(harness.storedLocal.pendingDownloadOperations['52']).not.toHaveProperty('finalIdentityPersisted');
        expect(harness.storedLocal.pendingDownloadOperations['52']).not.toHaveProperty('finalizationClaim');
        expect(harness.storedLocal.processedIds).toEqual([mediaId]);

        await expect(background.markDownloadOperationR2Present(52, { status: 'already_present' }))
            .resolves.toBe(true);

        const processedWritesAfter = harness.chromeApi.storage.local.set.mock.calls
            .filter(([values]) => Object.prototype.hasOwnProperty.call(values, 'processedIds')).length;
        const operationRemovalsAfter = harness.chromeApi.storage.local.set.mock.calls
            .filter(([values]) => values.pendingDownloadOperations
                && !Object.prototype.hasOwnProperty.call(values.pendingDownloadOperations, '52')).length;
        expect(processedWritesAfter - processedWritesBefore).toBe(1);
        expect(operationRemovalsAfter - operationRemovalsBefore).toBe(1);
        expect(harness.storedLocal.processedIds).toEqual([mediaId]);
        expect(background.getPendingDownloadOperationsForTest()).not.toHaveProperty('52');
    });

    test('final identity phase timeout releases ownership and keeps retry ordered behind the live write', async () => {
        jest.useFakeTimers();
        const stalledIdentityPhaseWrite = deferred();
        try {
            const mediaId = '73e5e137-1334-49ea-b06b-a9d9ba891053';
            const { background, harness } = await seedRunOwnedDownloadOperation({
                mode: 'dual_write',
                downloadId: 53,
                mediaId,
                downloadState: 'complete',
                r2State: 'pending'
            });
            const processedWritesBefore = harness.chromeApi.storage.local.set.mock.calls
                .filter(([values]) => Object.prototype.hasOwnProperty.call(values, 'processedIds')).length;
            const operationRemovalsBefore = harness.chromeApi.storage.local.set.mock.calls
                .filter(([values]) => values.pendingDownloadOperations
                    && !Object.prototype.hasOwnProperty.call(values.pendingDownloadOperations, '53')).length;
            const identityPhaseWriteStarted = deferred();
            const baseSet = harness.chromeApi.storage.local.set.getMockImplementation();
            let stalled = false;
            harness.chromeApi.storage.local.set.mockImplementation((values) => {
                const operation = values.pendingDownloadOperations?.['53'];
                if (!stalled && operation?.finalIdentityPersisted === true) {
                    stalled = true;
                    identityPhaseWriteStarted.resolve();
                    return stalledIdentityPhaseWrite.promise.then(() => baseSet(values));
                }
                return baseSet(values);
            });

            const timedOut = background.markDownloadOperationR2Present(53, { status: 'uploaded' });
            await identityPhaseWriteStarted.promise;
            await jest.advanceTimersByTimeAsync(1000);
            await expect(timedOut).rejects.toThrow('pending_download_operations_persist_timeout');

            const retryable = background.getPendingDownloadOperationsForTest()['53'];
            expect(retryable).toMatchObject({
                downloadState: 'complete',
                r2State: 'present',
                finalIdentityPersisted: true
            });
            expect(retryable).not.toHaveProperty('finalizationClaim');
            expect(harness.storedLocal.processedIds).toEqual([mediaId]);

            let retrySettled = false;
            const retry = background.markDownloadOperationR2Present(53, { status: 'already_present' })
                .then((result) => {
                    retrySettled = true;
                    return result;
                });
            await flushAsyncTurns(20);
            expect(retrySettled).toBe(false);

            stalledIdentityPhaseWrite.resolve();
            await expect(retry).resolves.toBe(true);
            const processedWritesAfter = harness.chromeApi.storage.local.set.mock.calls
                .filter(([values]) => Object.prototype.hasOwnProperty.call(values, 'processedIds')).length;
            const operationRemovalsAfter = harness.chromeApi.storage.local.set.mock.calls
                .filter(([values]) => values.pendingDownloadOperations
                    && !Object.prototype.hasOwnProperty.call(values.pendingDownloadOperations, '53')).length;
            expect(processedWritesAfter - processedWritesBefore).toBe(1);
            expect(operationRemovalsAfter - operationRemovalsBefore).toBe(1);
            expect(harness.storedLocal.processedIds).toEqual([mediaId]);
            expect(background.getPendingDownloadOperationsForTest()).not.toHaveProperty('53');

            await flushAsyncTurns(20);

            expect(harness.storedLocal.pendingDownloadOperations).not.toHaveProperty('53');
        } finally {
            stalledIdentityPhaseWrite.resolve();
            await jest.runOnlyPendingTimersAsync();
            jest.useRealTimers();
        }
    });

    test('timed-out pending-operation write blocks newer mutation until the live write settles', async () => {
        jest.useFakeTimers();
        const stalledR2StateWrite = deferred();
        try {
            const mediaId = '73e5e137-1334-49ea-b06b-a9d9ba891054';
            const unrelatedMediaId = '73e5e137-1334-49ea-b06b-a9d9ba891055';
            const { background, harness, lease } = await seedRunOwnedDownloadOperation({
                mode: 'dual_write',
                downloadId: 54,
                mediaId,
                downloadState: 'complete',
                r2State: 'pending'
            });
            await seedUnrelatedDownloadOperation({
                background,
                harness,
                lease,
                downloadId: 55,
                mediaId: unrelatedMediaId
            });

            const R2StateWriteStarted = deferred();
            const baseSet = harness.chromeApi.storage.local.set.getMockImplementation();
            let R2StateStalled = false;
            const writeOrder = [];
            harness.chromeApi.storage.local.set.mockImplementation((values) => {
                const operations = values.pendingDownloadOperations;
                if (!R2StateStalled && operations?.['54']?.r2State === 'present'
                    && operations['54'].r2Status === 'uploaded') {
                    R2StateStalled = true;
                    writeOrder.push('r2_state');
                    R2StateWriteStarted.resolve();
                    return stalledR2StateWrite.promise.then(() => baseSet(values));
                }
                if (operations?.['55']?.attempts === 7) {
                    writeOrder.push('newer');
                }
                return baseSet(values);
            });

            const timedOut = background.markDownloadOperationR2Present(54, { status: 'uploaded' });
            await R2StateWriteStarted.promise;
            await jest.advanceTimersByTimeAsync(1000);
            await expect(timedOut).rejects.toThrow('pending_download_operations_persist_timeout');

            let newerUpdateSettled = false;
            const newerUpdate = background.updateDownloadOperation(55, { attempts: 7 })
                .then((operation) => {
                    newerUpdateSettled = true;
                    return operation;
                });
            await jest.advanceTimersByTimeAsync(1000);
            await flushAsyncTurns(20);
            expect(newerUpdateSettled).toBe(false);
            expect(writeOrder).toEqual(['r2_state']);

            stalledR2StateWrite.resolve();
            await expect(newerUpdate).resolves.toMatchObject({ attempts: 7 });
            await flushAsyncTurns(20);

            const authoritative = background.getPendingDownloadOperationsForTest();
            expect(harness.storedLocal.pendingDownloadOperations).toEqual(authoritative);
            expect(authoritative['54']).toMatchObject({
                downloadState: 'complete',
                r2State: 'present'
            });
            expect(authoritative['54']).not.toHaveProperty('finalizationClaim');
            expect(authoritative['55']).toMatchObject({
                mediaId: unrelatedMediaId,
                attempts: 7
            });
            expect(harness.storedLocal.processedIds).toEqual([]);
            expect(writeOrder).toEqual(['r2_state', 'newer']);
        } finally {
            stalledR2StateWrite.resolve();
            await jest.runOnlyPendingTimersAsync();
            jest.useRealTimers();
        }
    });

    test('rejected timed-out pending-operation write releases newer mutation only after rejection', async () => {
        jest.useFakeTimers();
        const rejectedR2StateWrite = deferred();
        try {
            const mediaId = '73e5e137-1334-49ea-b06b-a9d9ba891056';
            const unrelatedMediaId = '73e5e137-1334-49ea-b06b-a9d9ba891057';
            const { background, harness, lease } = await seedRunOwnedDownloadOperation({
                mode: 'dual_write',
                downloadId: 56,
                mediaId,
                downloadState: 'complete',
                r2State: 'pending'
            });
            await seedUnrelatedDownloadOperation({
                background,
                harness,
                lease,
                downloadId: 57,
                mediaId: unrelatedMediaId
            });

            const R2StateWriteStarted = deferred();
            const baseSet = harness.chromeApi.storage.local.set.getMockImplementation();
            let R2StateStalled = false;
            const writeOrder = [];
            harness.chromeApi.storage.local.set.mockImplementation((values) => {
                const operations = values.pendingDownloadOperations;
                if (!R2StateStalled && operations?.['56']?.r2State === 'present'
                    && operations['56'].r2Status === 'uploaded') {
                    R2StateStalled = true;
                    writeOrder.push('r2_state');
                    R2StateWriteStarted.resolve();
                    return rejectedR2StateWrite.promise;
                }
                if (operations?.['57']?.attempts === 9) {
                    writeOrder.push('newer');
                }
                return baseSet(values);
            });

            const timedOut = background.markDownloadOperationR2Present(56, { status: 'uploaded' });
            await R2StateWriteStarted.promise;
            await jest.advanceTimersByTimeAsync(1000);
            await expect(timedOut).rejects.toThrow('pending_download_operations_persist_timeout');

            let newerUpdateSettled = false;
            const newerUpdate = background.updateDownloadOperation(57, { attempts: 9 })
                .then((operation) => {
                    newerUpdateSettled = true;
                    return operation;
                });
            await jest.advanceTimersByTimeAsync(1000);
            await flushAsyncTurns(20);
            expect(newerUpdateSettled).toBe(false);
            expect(writeOrder).toEqual(['r2_state']);

            rejectedR2StateWrite.reject(new Error('R2 state persistence failed'));
            await expect(newerUpdate).resolves.toMatchObject({ attempts: 9 });
            await flushAsyncTurns(20);

            const authoritative = background.getPendingDownloadOperationsForTest();
            expect(harness.storedLocal.pendingDownloadOperations).toEqual(authoritative);
            expect(authoritative['56']).toMatchObject({
                downloadState: 'complete',
                r2State: 'present'
            });
            expect(authoritative['56']).not.toHaveProperty('finalizationClaim');
            expect(authoritative['57']).toMatchObject({
                mediaId: unrelatedMediaId,
                attempts: 9
            });
            expect(harness.storedLocal.processedIds).toEqual([]);
            expect(writeOrder).toEqual(['r2_state', 'newer']);
        } finally {
            rejectedR2StateWrite.resolve();
            await jest.runOnlyPendingTimersAsync();
            jest.useRealTimers();
        }
    });

    test('rejected timed-out identity phase leaves no durable ownership marker without a later mutation', async () => {
        jest.useFakeTimers();
        const rejectedIdentityPhaseWrite = deferred();
        try {
            const mediaId = '73e5e137-1334-49ea-b06b-a9d9ba891058';
            const { background, harness } = await seedRunOwnedDownloadOperation({
                mode: 'dual_write',
                downloadId: 58,
                mediaId,
                downloadState: 'complete',
                r2State: 'pending'
            });

            const identityPhaseWriteStarted = deferred();
            const baseSet = harness.chromeApi.storage.local.set.getMockImplementation();
            let identityPhaseStalled = false;
            harness.chromeApi.storage.local.set.mockImplementation((values) => {
                const operation = values.pendingDownloadOperations?.['58'];
                if (!identityPhaseStalled && operation?.finalIdentityPersisted === true) {
                    identityPhaseStalled = true;
                    identityPhaseWriteStarted.resolve();
                    return rejectedIdentityPhaseWrite.promise;
                }
                return baseSet(values);
            });

            const timedOut = background.markDownloadOperationR2Present(58, { status: 'uploaded' });
            await identityPhaseWriteStarted.promise;
            await jest.advanceTimersByTimeAsync(1000);
            await expect(timedOut).rejects.toThrow('pending_download_operations_persist_timeout');

            rejectedIdentityPhaseWrite.reject(new Error('final identity phase persistence failed'));
            await flushAsyncTurns(20);

            const authoritative = background.getPendingDownloadOperationsForTest();
            expect(authoritative['58']).toMatchObject({
                downloadState: 'complete',
                r2State: 'present',
                finalIdentityPersisted: true
            });
            expect(authoritative['58']).not.toHaveProperty('finalizationClaim');
            expect(harness.storedLocal.pendingDownloadOperations['58']).toMatchObject({
                downloadState: 'complete',
                r2State: 'present'
            });
            expect(harness.storedLocal.pendingDownloadOperations['58']).not.toHaveProperty('finalIdentityPersisted');
            expect(harness.storedLocal.pendingDownloadOperations['58']).not.toHaveProperty('finalizationClaim');
            expect(harness.chromeApi.storage.local.set.mock.calls.some(([values]) => (
                Boolean(values.pendingDownloadOperations?.['58']?.finalizationClaim)
            ))).toBe(false);
            expect(harness.storedLocal.processedIds).toEqual([mediaId]);
        } finally {
            rejectedIdentityPhaseWrite.resolve();
            await jest.runOnlyPendingTimersAsync();
            jest.useRealTimers();
        }
    });

    test('retryable finalization failure releases single-flight ownership without repeating identity persistence', async () => {
        const mediaId = '73e5e137-1334-49ea-b06b-a9d9ba891049';
        const { background, harness } = await seedRunOwnedDownloadOperation({
            mode: 'cloud_only',
            downloadId: 49,
            mediaId,
            downloadState: 'complete',
            r2State: 'pending'
        });
        const processedWritesBefore = harness.chromeApi.storage.local.set.mock.calls
            .filter(([values]) => Object.prototype.hasOwnProperty.call(values, 'processedIds')).length;
        harness.chromeApi.downloads.removeFile.mockImplementation(() => {
            throw new Error('temporary cleanup failure');
        });

        await expect(background.markDownloadOperationR2Present(49, { status: 'uploaded' })).resolves.toBe(false);

        const retryable = background.getPendingDownloadOperationsForTest()['49'];
        expect(retryable).toMatchObject({
            r2State: 'present',
            finalIdentityPersisted: true,
            attempts: 1,
            lastError: expect.stringContaining('code=download_cleanup_failed')
        });
        expect(retryable).not.toHaveProperty('finalizationClaim');
        expect(harness.storedLocal.processedIds).toEqual([mediaId]);

        harness.chromeApi.downloads.removeFile.mockImplementation((_downloadId, callback) => callback());
        await expect(background.markDownloadOperationR2Present(49, { status: 'already_present' })).resolves.toBe(true);

        const processedWritesAfter = harness.chromeApi.storage.local.set.mock.calls
            .filter(([values]) => Object.prototype.hasOwnProperty.call(values, 'processedIds')).length;
        expect(processedWritesAfter - processedWritesBefore).toBe(1);
        expect(background.getPendingDownloadOperationsForTest()).not.toHaveProperty('49');
    });

    test('authority revocation after worker-local finalization ownership releases dual-write for retry', async () => {
        const mediaId = '73e5e137-1334-49ea-b06b-a9d9ba891050';
        const { background, harness } = await seedRunOwnedDownloadOperation({
            mode: 'dual_write',
            downloadId: 50,
            mediaId,
            downloadState: 'complete',
            r2State: 'pending'
        });
        const finalizationAuthority = deferred();
        const finalizationAuthorityStarted = deferred();
        let revoked = false;
        let authorityChecks = 0;
        const assertAuthorized = async () => {
            authorityChecks++;
            if (authorityChecks === 3) {
                finalizationAuthorityStarted.resolve();
                await finalizationAuthority.promise;
            }
            if (!revoked) return;
            const error = new Error('revoked');
            error.code = 'scrape_authority_revoked';
            throw error;
        };

        const finalization = background.markDownloadOperationR2Present(
            50,
            { status: 'uploaded' },
            assertAuthorized
        );
        await finalizationAuthorityStarted.promise;

        await expect(background.markDownloadOperationR2Present(
            50,
            { status: 'already_present' },
            assertAuthorized
        )).resolves.toBe(false);

        revoked = true;
        finalizationAuthority.resolve();

        await expect(finalization).rejects.toMatchObject({ code: 'scrape_authority_revoked' });
        expect(harness.storedLocal.processedIds).toEqual([]);
        expect(background.getPendingDownloadOperationsForTest()['50']).toMatchObject({
            downloadState: 'complete',
            r2State: 'present'
        });
        expect(background.getPendingDownloadOperationsForTest()['50']).not.toHaveProperty('finalizationClaim');

        await expect(background.markDownloadOperationR2Present(50, { status: 'already_present' })).resolves.toBe(true);
        expect(harness.storedLocal.processedIds).toEqual([mediaId]);
        expect(background.getPendingDownloadOperationsForTest()).not.toHaveProperty('50');
    });

    test('dual-write R2 failure remains retryable without persisting identity', async () => {
        const mediaId = '73e5e137-1334-49ea-b06b-a9d9ba891043';
        const { background, harness, downloadItem } = await seedRunOwnedDownloadOperation({
            mode: 'dual_write',
            downloadId: 43,
            mediaId,
            downloadState: 'complete',
            r2State: 'pending'
        });
        harness.chromeApi.runtime.sendMessage.mockResolvedValue({ ok: false });

        await background.processCompletedDownloadOperation(43, downloadItem);

        expect(harness.storedLocal.processedIds).toEqual([]);
        expect(background.getPendingDownloadOperationsForTest()['43']).toMatchObject({
            downloadState: 'complete',
            r2State: 'pending',
            attempts: 1,
            lastError: expect.stringContaining('code=auth_upload_failed')
        });
    });

    test('Local-only persists after local completion and removes the operation', async () => {
        const mediaId = '73e5e137-1334-49ea-b06b-a9d9ba891044';
        const { background, harness, downloadItem } = await seedRunOwnedDownloadOperation({
            mode: 'local_only',
            downloadId: 44,
            mediaId,
            downloadState: 'complete',
            r2State: 'not_required'
        });

        await background.processCompletedDownloadOperation(44, downloadItem);

        expect(harness.storedLocal.processedIds).toEqual([mediaId]);
        expect(background.getPendingDownloadOperationsForTest()).not.toHaveProperty('44');
    });

    test('cloud-only persists after R2 presence and removes the operation', async () => {
        const mediaId = '73e5e137-1334-49ea-b06b-a9d9ba891045';
        const { background, harness } = await seedRunOwnedDownloadOperation({
            mode: 'cloud_only',
            downloadId: 45,
            mediaId,
            downloadState: 'complete',
            r2State: 'pending'
        });

        await background.markDownloadOperationR2Present(45, { status: 'uploaded' });

        expect(harness.storedLocal.processedIds).toEqual([mediaId]);
        expect(harness.chromeApi.downloads.removeFile).toHaveBeenCalledWith(45, expect.any(Function));
        expect(background.getPendingDownloadOperationsForTest()).not.toHaveProperty('45');
    });

    test('Stop before dual-write R2 acknowledgment prevents late identity persistence', async () => {
        const mediaId = '73e5e137-1334-49ea-b06b-a9d9ba891046';
        const { background, harness, downloadItem } = await seedRunOwnedDownloadOperation({
            mode: 'dual_write',
            downloadId: 46,
            mediaId,
            downloadState: 'complete',
            r2State: 'pending'
        });
        const uploadGate = deferred();
        harness.chromeApi.runtime.sendMessage.mockImplementation((message) => (
            message.action === 'READ_FILE_FOR_UPLOAD' ? uploadGate.promise : Promise.resolve({ ok: true })
        ));

        const completion = background.processCompletedDownloadOperation(46, downloadItem);
        await waitForCondition(() => harness.chromeApi.runtime.sendMessage.mock.calls
            .some(([message]) => message.action === 'READ_FILE_FOR_UPLOAD'), 400);
        await expect(background.stopScrapeRun('sync')).resolves.toMatchObject({ status: 'stopped' });
        uploadGate.resolve({ ok: true, base64: 'AQID', type: 'image/jpeg', size: 3 });

        await expect(completion).rejects.toMatchObject({ code: 'scrape_authority_revoked' });
        expect(harness.storedLocal.processedIds).toEqual([]);
        expect(background.getProcessedUUIDsForTest()).toEqual([]);
    });

    test('service-worker hydration preserves retryable dual-write state without persisting identity', async () => {
        const mediaId = '73e5e137-1334-49ea-b06b-a9d9ba891047';
        const seeded = await seedRunOwnedDownloadOperation({
            mode: 'dual_write',
            downloadId: 47,
            mediaId,
            downloadState: 'complete',
            r2State: 'pending'
        });
        const restartState = { ...seeded.harness.storedLocal };
        jest.resetModules();

        const harness = createLeaseBackgroundHarness({ lease: seeded.lease, localState: restartState });
        harness.chromeApi.downloads.search.mockResolvedValue([]);
        global.chrome = harness.chromeApi;
        const background = require('../../background.js');
        await background.ensureBackgroundStateReady();

        expect(harness.storedLocal.processedIds).toEqual([]);
        expect(background.getPendingDownloadOperationsForTest()['47']).toMatchObject({
            downloadState: 'complete',
            r2State: 'pending'
        });
    });

    test('service-worker hydration ignores legacy ownership and finishes after identity persisted before its phase', async () => {
        const mediaId = '73e5e137-1334-49ea-b06b-a9d9ba891051';
        const seeded = await seedRunOwnedDownloadOperation({
            mode: 'dual_write',
            downloadId: 51,
            mediaId,
            downloadState: 'complete',
            r2State: 'present'
        });
        const restartState = JSON.parse(JSON.stringify(seeded.harness.storedLocal));
        restartState.processedIds = [mediaId];
        delete restartState.pendingDownloadOperations['51'].finalIdentityPersisted;
        restartState.pendingDownloadOperations['51'].finalizationClaim = {
            ownerId: 'stale-worker',
            token: 'stale-claim'
        };
        jest.resetModules();

        const harness = createLeaseBackgroundHarness({ lease: seeded.lease, localState: restartState });
        harness.chromeApi.downloads.search.mockResolvedValue([]);
        global.chrome = harness.chromeApi;
        const background = require('../../background.js');
        await background.ensureBackgroundStateReady();

        const processedWrites = harness.chromeApi.storage.local.set.mock.calls
            .filter(([values]) => Object.prototype.hasOwnProperty.call(values, 'processedIds')).length;
        expect(harness.storedLocal.processedIds).toEqual([mediaId]);
        expect(processedWrites).toBe(0);
        expect(harness.chromeApi.alarms.create).toHaveBeenCalledWith(
            'gptCloudRetry',
            expect.objectContaining({ delayInMinutes: expect.any(Number) })
        );
        expect(harness.chromeApi.storage.local.set.mock.calls.some(([values]) => (
            Boolean(values.pendingDownloadOperations?.['51']?.finalizationClaim)
        ))).toBe(false);
        expect(background.getPendingDownloadOperationsForTest()).not.toHaveProperty('51');
    });

    test('missing Local-only history persists known completion and removes the operation', async () => {
        const mediaId = '73e5e137-1334-49ea-b06b-a9d9ba891048';
        const { background, harness } = await seedRunOwnedDownloadOperation({
            mode: 'local_only',
            downloadId: 48,
            mediaId,
            downloadState: 'complete',
            r2State: 'not_required'
        });
        const operation = background.getPendingDownloadOperationsForTest()['48'];

        await background.reconcileMissingDownloadOperation(operation);

        expect(harness.storedLocal.processedIds).toEqual([mediaId]);
        expect(background.getPendingDownloadOperationsForTest()).not.toHaveProperty('48');
    });

    test('Stop is bounded when Chrome never settles a run-scoped download callback', async () => {
        jest.useFakeTimers();
        try {
            const lease = createLeaseRecord();
            const harness = createLeaseBackgroundHarness({
                lease,
                localState: {
                    scraperState: 'running',
                    scrapeRunToken: lease.token,
                    scrapeRunEpoch: lease.epoch,
                    isScraping: true,
                    isR2Backup: false,
                    cloudConfig: { enabled: false, mode: 'local_only' }
                }
            });
            harness.chromeApi.downloads.download.mockImplementation(() => undefined);
            global.chrome = harness.chromeApi;
            const background = require('../../background.js');
            await background.ensureScrapeLeaseHydrated();

            dispatchBackgroundMessageThroughPort(harness.chromeApi, {
                action: 'DOWNLOAD_MEDIA',
                runToken: lease.token,
                runEpoch: lease.epoch,
                kind: lease.kind,
                url: 'https://assets.grok.com/generated/hung/image.jpg',
                isVideo: false
            }, { tab: { id: lease.tabId } });
            await Promise.resolve();
            let stopped = false;
            const stopping = background.stopScrapeRun('sync').then((value) => {
                stopped = true;
                return value;
            });

            await jest.advanceTimersByTimeAsync(3000);
            expect(stopped).toBe(true);
            await expect(stopping).resolves.toMatchObject({ status: 'stopped' });
            expect(harness.storedLocal).toMatchObject({ scraperState: 'idle', isScraping: false });
        } finally {
            jest.useRealTimers();
        }
    });

    test('a later run can claim the same URL after an earlier native callback times out', async () => {
        jest.useFakeTimers();
        try {
            const lease = createLeaseRecord();
            const mediaUrl = 'https://assets.grok.com/generated/shared/image.jpg';
            const harness = createLeaseBackgroundHarness({
                lease,
                localState: {
                    scraperState: 'running',
                    scrapeRunToken: lease.token,
                    scrapeRunEpoch: lease.epoch,
                    isScraping: true,
                    isR2Backup: false,
                    processedIds: [],
                    cloudConfig: { enabled: false, mode: 'local_only' }
                }
            });
            const downloadCallbacks = [];
            harness.chromeApi.downloads.download.mockImplementation((_options, callback) => {
                downloadCallbacks.push(callback);
            });
            global.chrome = harness.chromeApi;
            const background = require('../../background.js');
            await background.ensureBackgroundStateReady();
            await background.ensureScrapeLeaseHydrated();

            const firstTransfer = background.queueChromeDownload({ url: mediaUrl }, lease).catch((error) => error);
            await waitForCondition(() => downloadCallbacks.length === 1);

            const stopping = background.stopScrapeRun('sync');
            await jest.advanceTimersByTimeAsync(2500);
            await expect(stopping).resolves.toMatchObject({ status: 'stopped' });

            const nextRun = await background.initializeScrapeInActiveTab({ action: 'INIT_SCRAPE' });
            expect(nextRun).toMatchObject({ status: 'started', runToken: expect.any(String), runEpoch: expect.any(Number) });
            Object.assign(harness.storedLocal, {
                scraperState: 'running',
                scrapeRunToken: nextRun.runToken,
                scrapeRunEpoch: nextRun.runEpoch,
                isScraping: true,
                isR2Backup: false
            });
            const nextLease = {
                version: 1,
                token: nextRun.runToken,
                epoch: nextRun.runEpoch,
                kind: 'sync',
                tabId: lease.tabId,
                status: 'active',
                startedAt: Date.now()
            };
            const secondTransfer = background.queueChromeDownload({ url: mediaUrl }, nextLease);
            await waitForCondition(() => downloadCallbacks.length === 2);

            const suggest = jest.fn();
            await background.handleDownloadFilename({ id: 88, url: mediaUrl, filename: 'image.jpg' }, suggest);
            downloadCallbacks[1](88);

            await expect(secondTransfer).resolves.toBe(88);
            expect(harness.chromeApi.downloads.cancel).not.toHaveBeenCalledWith(88);
            expect(background.getPendingDownloadOperationsForTest()).toHaveProperty('88');

            downloadCallbacks[0](77);
            await expect(firstTransfer).resolves.toMatchObject({ code: 'scrape_authority_revoked' });
        } finally {
            jest.useRealTimers();
        }
    });

    test('authorized transfers use the hydrated run mirror without a blocking local authority read', async () => {
        const lease = createLeaseRecord();
        const harness = createLeaseBackgroundHarness({
            lease,
            localState: {
                scraperState: 'running',
                scrapeRunToken: lease.token,
                scrapeRunEpoch: lease.epoch,
                isScraping: true,
                isR2Backup: false,
                processedIds: []
            }
        });
        global.chrome = harness.chromeApi;
        const background = require('../../background.js');
        await background.ensureBackgroundStateReady();
        await background.ensureScrapeLeaseHydrated();
        const baseGet = harness.chromeApi.storage.local.get.getMockImplementation();
        let attemptedAuthorityRead = false;
        harness.chromeApi.storage.local.get.mockImplementation((keys) => {
            if (Array.isArray(keys)
                && keys.includes('scraperState')
                && keys.includes('scrapeRunToken')
                && keys.includes('scrapeRunEpoch')) {
                attemptedAuthorityRead = true;
                return new Promise(() => {});
            }
            return baseGet(keys);
        });

        const transfer = dispatchBackgroundMessageThroughPort(harness.chromeApi, {
            action: 'SCRAPE_PROCESSED_IDS_ADD',
            runToken: lease.token,
            runEpoch: lease.epoch,
            kind: lease.kind,
            ids: ['hydrated-authority-media']
        }, { tab: { id: lease.tabId } });

        await expect(transfer.response).resolves.toEqual({
            status: 'ok',
            processedIds: ['hydrated-authority-media']
        });
        expect(attemptedAuthorityRead).toBe(false);
        await expect(background.stopScrapeRun('sync')).resolves.toMatchObject({ status: 'stopped' });
    });

    test('a timed-out Stop cleanup cannot poison later download-operation mutations', async () => {
        jest.useFakeTimers();
        const blockedCleanupWrite = deferred();
        try {
            const lease = createLeaseRecord();
            const mediaUrl = 'https://assets.grok.com/generated/after-timeout/image.jpg';
            const harness = createLeaseBackgroundHarness({
                lease,
                localState: {
                    scraperState: 'running',
                    scrapeRunToken: lease.token,
                    scrapeRunEpoch: lease.epoch,
                    isScraping: true,
                    isR2Backup: false,
                    processedIds: [],
                    cloudConfig: { enabled: false, mode: 'local_only' }
                }
            });
            global.chrome = harness.chromeApi;
            const background = require('../../background.js');
            await background.ensureBackgroundStateReady();
            await background.ensureScrapeLeaseHydrated();
            const cleanupWriteStarted = deferred();
            const baseSet = harness.chromeApi.storage.local.set.getMockImplementation();
            let intercepted = false;
            harness.chromeApi.storage.local.set.mockImplementation((values) => {
                if (!intercepted && isCompletionPersistence(values, 'revoked')) {
                    intercepted = true;
                    cleanupWriteStarted.resolve();
                    return blockedCleanupWrite.promise.then(() => baseSet(values));
                }
                return baseSet(values);
            });

            const stopping = background.stopScrapeRun('sync');
            await cleanupWriteStarted.promise;
            await jest.advanceTimersByTimeAsync(2500);
            await expect(stopping).resolves.toMatchObject({ status: 'stopped' });

            const nextRun = await background.initializeScrapeInActiveTab({ action: 'INIT_SCRAPE' });
            Object.assign(harness.storedLocal, {
                scraperState: 'running',
                scrapeRunToken: nextRun.runToken,
                scrapeRunEpoch: nextRun.runEpoch,
                isScraping: true,
                isR2Backup: false
            });
            const nextLease = {
                version: 1,
                token: nextRun.runToken,
                epoch: nextRun.runEpoch,
                kind: 'sync',
                tabId: lease.tabId,
                status: 'active',
                startedAt: Date.now()
            };
            let downloadCallback = null;
            harness.chromeApi.downloads.download.mockImplementation((_options, callback) => {
                downloadCallback = callback;
            });
            const download = background.queueChromeDownload({ url: mediaUrl }, nextLease);
            await waitForCondition(() => typeof downloadCallback === 'function');

            let filenameHandled = false;
            const filenameHandling = background.handleDownloadFilename(
                { id: 91, url: mediaUrl, filename: 'image.jpg' },
                jest.fn()
            ).then(() => { filenameHandled = true; });
            await jest.advanceTimersByTimeAsync(100);

            expect(filenameHandled).toBe(true);
            downloadCallback(91);
            await expect(download).resolves.toBe(91);
            await filenameHandling;
            expect(background.getPendingDownloadOperationsForTest()).toHaveProperty('91');
        } finally {
            blockedCleanupWrite.resolve();
            await jest.runOnlyPendingTimersAsync();
            jest.useRealTimers();
        }
    });

    test('closing the owner tab tombstones its active lease and local mirror', async () => {
        const lease = createLeaseRecord();
        const harness = createLeaseBackgroundHarness({
            lease,
            localState: {
                scraperState: 'running',
                scrapeRunToken: lease.token,
                scrapeRunEpoch: lease.epoch,
                isScraping: true,
                isR2Backup: false
            }
        });
        global.chrome = harness.chromeApi;
        const background = require('../../background.js');
        await background.ensureBackgroundStateReady();
        const removed = harness.chromeApi.tabs.onRemoved.addListener.mock.calls[0]?.[0];
        expect(removed).toEqual(expect.any(Function));

        removed(lease.tabId, { isWindowClosing: false });
        await waitForCondition(() => (
            harness.sessionState.activeScrapeRunToken?.status === 'idle'
            && harness.storedLocal.scraperState === 'idle'
        ));

        expect(harness.storedLocal).toMatchObject({ scraperState: 'idle', isScraping: false });
    });

    test.each([
        ['sync', { action: 'INIT_SCRAPE' }, 'INIT_SCRAPE'],
        ['r2_backup', { action: 'INIT_R2_BACKUP', mode: 'full' }, 'INIT_R2_BACKUP']
    ])('uses the same authoritative lease handshake for %s', async (kind, initMessage, expectedAction) => {
        const harness = createLeaseBackgroundHarness();
        global.chrome = harness.chromeApi;
        const background = require('../../background.js');

        const response = await background.initializeScrapeInActiveTab(initMessage, { backup: kind === 'r2_backup' });

        expect(response).toMatchObject({ status: 'started', runToken: expect.any(String), runEpoch: 1 });
        expect(harness.sessionState.activeScrapeRunToken).toMatchObject({ kind, status: 'active', epoch: 1 });
        expect(harness.chromeApi.tabs.sendMessage).toHaveBeenCalledWith(
            42,
            expect.objectContaining({ action: expectedAction, runToken: expect.any(String), runEpoch: 1 }),
            expect.any(Function)
        );
    });

    test('fails tab interception closed after restart without matching session authority', async () => {
        const harness = createLeaseBackgroundHarness({
            localState: {
                scraperState: 'running',
                scrapeRunToken: 'stale-run',
                scrapeRunEpoch: 4,
                isScraping: true
            }
        });
        global.chrome = harness.chromeApi;
        require('../../background.js');
        const tabListener = harness.chromeApi.tabs.onUpdated.addListener.mock.calls[0][0];

        await tabListener(42, { url: 'https://imagine-public.x.ai/media/example.jpg' }, { id: 42 });

        expect(harness.chromeApi.downloads.download).not.toHaveBeenCalled();
        expect(harness.chromeApi.tabs.remove).not.toHaveBeenCalled();
        expect(harness.storedLocal.isScraping).toBe(false);
    });

    test('hydrates matching authority before intercepting a restarted run media tab', async () => {
        const lease = createLeaseRecord();
        const harness = createLeaseBackgroundHarness({
            lease,
            localState: {
                scraperState: 'running',
                scrapeRunToken: lease.token,
                scrapeRunEpoch: lease.epoch,
                isScraping: true,
                isR2Backup: false
            }
        });
        global.chrome = harness.chromeApi;
        require('../../background.js');
        const tabListener = harness.chromeApi.tabs.onUpdated.addListener.mock.calls[0][0];

        await tabListener(42, {
            url: 'https://imagine-public.x.ai/media/restarted-run.jpg'
        }, { id: 42 });

        expect(harness.chromeApi.downloads.download).toHaveBeenCalledWith(
            expect.objectContaining({
                url: 'https://imagine-public.x.ai/media/restarted-run.jpg'
            }),
            expect.any(Function)
        );
        expect(harness.chromeApi.tabs.remove).toHaveBeenCalledWith(42);
    });

    test('revalidates tab-transfer authority after filename storage resolves', async () => {
        const lease = createLeaseRecord();
        const filenameRead = deferred();
        const filenameReadStarted = deferred();
        const harness = createLeaseBackgroundHarness({
            lease,
            localState: {
                scraperState: 'running',
                scrapeRunToken: lease.token,
                scrapeRunEpoch: lease.epoch,
                isScraping: true,
                isR2Backup: false
            }
        });
        const baseGet = harness.chromeApi.storage.local.get.getMockImplementation();
        harness.chromeApi.storage.local.get.mockImplementation((keys) => {
            if (Array.isArray(keys) && keys.includes('downloadPath')) {
                filenameReadStarted.resolve();
                return filenameRead.promise;
            }
            return baseGet(keys);
        });
        global.chrome = harness.chromeApi;
        const background = require('../../background.js');
        await background.ensureScrapeLeaseHydrated();
        const tabListener = harness.chromeApi.tabs.onUpdated.addListener.mock.calls[0][0];

        const interception = tabListener(42, {
            url: 'https://imagine-public.x.ai/media/stop-during-await.jpg'
        }, { id: 42 });
        await filenameReadStarted.promise;

        const stopping = background.stopScrapeRun('sync');
        filenameRead.resolve({ downloadPath: 'GrokVault', activeGrokUserId: 'Shared_Account' });
        await Promise.all([interception, stopping]);

        expect(harness.chromeApi.downloads.download).not.toHaveBeenCalled();
        expect(harness.chromeApi.tabs.remove).not.toHaveBeenCalled();
    });

    test('clears the abort timeout after an immediate acknowledgement', async () => {
        jest.useFakeTimers();
        const harness = createLeaseBackgroundHarness();
        global.chrome = harness.chromeApi;
        const { withTimeout } = require('../../background.js');

        await expect(withTimeout(Promise.resolve('ack'), 2000, null)).resolves.toBe('ack');
        expect(jest.getTimerCount()).toBe(0);
        jest.useRealTimers();
    });

    test.each(['sync', 'r2_backup'])(
        'completes a %s Start and Stop with Promise storage and callback tab messaging',
        async (kind) => {
            const harness = createLeaseBackgroundHarness();
            const events = [];
            const baseSessionSet = harness.chromeApi.storage.session.set.getMockImplementation();
            harness.chromeApi.storage.session.set.mockImplementation(async (values) => {
                await baseSessionSet(values);
                events.push(`session:${values.activeScrapeRunToken.status}`);
            });
            harness.chromeApi.tabs.sendMessage.mockImplementation((_tabId, message, callback) => {
                if (message.action.startsWith('INIT_')) {
                    Promise.resolve().then(async () => {
                        await harness.chromeApi.storage.local.set({
                            scraperState: 'running',
                            currentIndex: 0,
                            scrapeRunToken: message.runToken,
                            scrapeRunEpoch: message.runEpoch,
                            scrapeNavigation: null,
                            currentItemId: null,
                            scrapeBackupOptions: kind === 'r2_backup' ? { mode: 'full' } : null,
                            isScraping: true,
                            isR2Backup: kind === 'r2_backup',
                            ...(kind === 'r2_backup' ? { r2BackupState: { isRunning: true } } : {})
                        });
                        events.push('content:start-persisted');
                        callback({
                            status: 'started',
                            surface: 'saved_gallery',
                            runToken: message.runToken,
                            runEpoch: message.runEpoch
                        });
                    });
                    return;
                }
                Promise.resolve().then(async () => {
                    events.push(`content:${message.action}`);
                    await harness.chromeApi.storage.local.set({
                        scraperState: 'idle',
                        scrapeRunToken: null,
                        scrapeRunEpoch: null,
                        scrapeNavigation: null,
                        currentItemId: null,
                        isScraping: false,
                        isR2Backup: false,
                        ...(kind === 'r2_backup' ? { r2BackupState: { isRunning: false } } : {})
                    });
                    events.push('content:stop-persisted');
                    callback({ status: 'stopped' });
                });
            });
            global.chrome = harness.chromeApi;
            require('../../background.js');

            const startDispatch = dispatchBackgroundMessageThroughPort(harness.chromeApi, {
                action: kind === 'r2_backup' ? 'START_R2_BACKUP' : 'START_SCRAPE',
                ...(kind === 'r2_backup' ? { mode: 'full' } : {})
            }, { tab: { id: 42, url: 'https://grok.com/imagine/saved' } });
            expect(startDispatch.returnValue).toBe(true);
            await expect(startDispatch.response).resolves.toMatchObject({ status: 'started' });
            expect(harness.storedLocal).toMatchObject({
                scraperState: 'running',
                isScraping: true,
                isR2Backup: kind === 'r2_backup'
            });

            const stopDispatch = dispatchBackgroundMessageThroughPort(harness.chromeApi, {
                action: kind === 'r2_backup' ? 'STOP_R2_BACKUP' : 'STOP_SCRAPE'
            });
            expect(stopDispatch.returnValue).toBe(true);
            await expect(stopDispatch.response).resolves.toEqual({
                status: 'stopped',
                abortAcknowledged: true
            });
            expect(harness.sessionState.activeScrapeRunToken.status).toBe('idle');
            expect(harness.storedLocal).toMatchObject({
                scraperState: 'idle',
                scrapeRunToken: null,
                scrapeRunEpoch: null,
                isScraping: false,
                isR2Backup: false
            });
            const stopTombstoneIndex = events.lastIndexOf('session:idle');
            const abortIndex = events.indexOf(
                `content:${kind === 'r2_backup' ? 'ABORT_R2_BACKUP' : 'ABORT_SCRAPE'}`
            );
            expect(stopTombstoneIndex).toBeLessThan(abortIndex);
            expect(abortIndex).toBeLessThan(events.indexOf('content:stop-persisted'));
        }
    );

    test('a late ABORT callback after timeout cannot restore authority', async () => {
        jest.useFakeTimers();
        try {
            const lease = createLeaseRecord();
            const harness = createLeaseBackgroundHarness({
                lease,
                localState: {
                    scraperState: 'running',
                    scrapeRunToken: lease.token,
                    scrapeRunEpoch: lease.epoch,
                    isScraping: true,
                    isR2Backup: false
                }
            });
            harness.chromeApi.tabs.sendMessage.mockImplementation((_tabId, message, callback) => {
                if (message.action === 'ABORT_SCRAPE') {
                    setTimeout(() => callback({ status: 'stopped' }), 2500);
                }
            });
            global.chrome = harness.chromeApi;
            const background = require('../../background.js');
            await background.ensureScrapeLeaseHydrated();

            const stop = background.stopScrapeRun('sync');
            await flushAsyncTurns();
            await jest.advanceTimersByTimeAsync(2000);
            await expect(stop).resolves.toEqual({ status: 'stopped', abortAcknowledged: false });
            const tombstone = { ...harness.sessionState.activeScrapeRunToken };

            await jest.advanceTimersByTimeAsync(500);
            await flushAsyncTurns();
            expect(harness.sessionState.activeScrapeRunToken).toEqual(tombstone);
            expect(harness.storedLocal.scraperState).toBe('idle');
        } finally {
            jest.useRealTimers();
        }
    });
});

describe('background scrape start handshake', () => {
    afterEach(() => {
        delete global.chrome;
        jest.resetModules();
    });

    test('rejects an active Grok tab that is not Saved before messaging content', async () => {
        global.chrome = createBackgroundChrome({ url: 'https://grok.com/imagine/agent/agent-1' });
        const { initializeScrapeInActiveTab } = require('../../background.js');

        const response = await initializeScrapeInActiveTab({ action: 'INIT_SCRAPE' });

        expect(response).toEqual({
            status: 'invalid_context',
            surface: 'unsupported',
            error: 'Open Grok Imagine Saved before starting sync.'
        });
        expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
        expect(chrome.storage.local.set).not.toHaveBeenCalledWith(expect.objectContaining({ isScraping: true }));
    });

    test.each([
        ['sync', 'START_SCRAPE', 'INIT_SCRAPE'],
        ['R2 backup', 'START_R2_BACKUP', 'INIT_R2_BACKUP']
    ])('starts %s from the authenticated Saved sender tab without active-tab discovery', async (
        _label,
        startAction,
        initAction
    ) => {
        global.chrome = createBackgroundChrome({ url: 'https://grok.com/imagine/agent/unrelated' });
        require('../../background.js');

        const response = await dispatchBackgroundMessage(
            chrome,
            { action: startAction, mode: 'full' },
            { tab: { id: 77, url: 'https://grok.com/imagine/saved' } }
        );

        expect(response.status).toBe('started');
        expect(chrome.tabs.query).not.toHaveBeenCalled();
        expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(
            77,
            expect.objectContaining({ action: initAction }),
            expect.any(Function)
        );
    });

    test('popup Start still falls back to active-tab discovery when no sender tab exists', async () => {
        global.chrome = createBackgroundChrome();
        require('../../background.js');

        const response = await dispatchBackgroundMessage(
            chrome,
            { action: 'START_SCRAPE' },
            {}
        );

        expect(response.status).toBe('started');
        expect(chrome.tabs.query).toHaveBeenCalledWith(
            { active: true, currentWindow: true },
            expect.any(Function)
        );
        expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(
            42,
            expect.objectContaining({ action: 'INIT_SCRAPE' }),
            expect.any(Function)
        );
    });

    test('a non-Saved sender tab fails closed instead of falling back to another active tab', async () => {
        global.chrome = createBackgroundChrome();
        require('../../background.js');

        const response = await dispatchBackgroundMessage(
            chrome,
            { action: 'START_SCRAPE' },
            { tab: { id: 77, url: 'https://grok.com/imagine/agent/not-saved' } }
        );

        expect(response).toEqual({
            status: 'invalid_context',
            surface: 'unsupported',
            error: 'Open Grok Imagine Saved before starting sync.'
        });
        expect(chrome.tabs.query).not.toHaveBeenCalled();
        expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
    });

    test('does not persist running state when content preflight rejects the page', async () => {
        global.chrome = createBackgroundChrome({
            initResponse: {
                status: 'invalid_context',
                surface: 'unsupported',
                error: 'Open Grok Imagine Saved before starting sync.'
            }
        });
        const { initializeScrapeInActiveTab } = require('../../background.js');

        const response = await initializeScrapeInActiveTab({ action: 'INIT_SCRAPE' });

        expect(response.status).toBe('invalid_context');
        expect(chrome.storage.local.set).not.toHaveBeenCalledWith(expect.objectContaining({ isScraping: true }));
    });

    test('persists running state only after content acknowledges a Saved start', async () => {
        global.chrome = createBackgroundChrome();
        const { initializeScrapeInActiveTab } = require('../../background.js');

        const response = await initializeScrapeInActiveTab({ action: 'INIT_SCRAPE' });

        expect(response).toMatchObject({
            status: 'started',
            surface: 'saved_gallery',
            runToken: expect.any(String),
            runEpoch: 1
        });
        expect(chrome.storage.session.set).toHaveBeenLastCalledWith({
            activeScrapeRunToken: expect.objectContaining({
                status: 'active',
                epoch: 1,
                token: response.runToken,
                tabId: 42,
                kind: 'sync'
            })
        });
        expect(chrome.storage.local.set).toHaveBeenCalledWith({ isScraping: true, isR2Backup: false });
    });

    test('injects once and retries the handshake when the content script is absent', async () => {
        global.chrome = createBackgroundChrome();
        let attempt = 0;
        chrome.tabs.sendMessage.mockImplementation((_tabId, message, callback) => {
            attempt++;
            if (attempt === 1) {
                chrome.runtime.lastError = { message: 'Could not establish connection. Receiving end does not exist.' };
                callback(undefined);
                chrome.runtime.lastError = null;
                return;
            }
            callback({
                status: 'started',
                surface: 'saved_gallery',
                runToken: message.runToken,
                runEpoch: message.runEpoch
            });
        });
        const { initializeScrapeInActiveTab } = require('../../background.js');

        const response = await initializeScrapeInActiveTab({ action: 'INIT_SCRAPE' });

        expect(response.status).toBe('started');
        expect(chrome.scripting.executeScript).toHaveBeenCalledTimes(1);
        expect(chrome.tabs.sendMessage).toHaveBeenCalledTimes(2);
    });

    test('validates navigation resumes against the authoritative session lease', async () => {
        const lease = createLeaseRecord();
        const harness = createLeaseBackgroundHarness({
            lease,
            localState: {
                scraperState: 'running',
                scrapeRunToken: lease.token,
                scrapeRunEpoch: lease.epoch,
                isScraping: true,
                isR2Backup: false
            }
        });
        global.chrome = harness.chromeApi;
        const { validateScrapeResume } = require('../../background.js');

        await expect(validateScrapeResume(lease, 42)).resolves.toEqual({
            valid: true,
            reason: 'active_owner'
        });
        await expect(validateScrapeResume({ ...lease, token: 'another-run' }, 42)).resolves.toEqual({
            valid: false,
            reason: 'stale_authority'
        });
        expect(chrome.storage.session.get).toHaveBeenCalledWith(['activeScrapeRunToken']);
    });

    test('does not initialize content when background cannot persist the run lease', async () => {
        global.chrome = createBackgroundChrome();
        chrome.storage.session.set
            .mockResolvedValueOnce()
            .mockRejectedValueOnce(new Error('Session storage unavailable'));
        const { initializeScrapeInActiveTab } = require('../../background.js');

        const response = await initializeScrapeInActiveTab({ action: 'INIT_SCRAPE' });

        expect(response).toEqual({
            status: 'error',
            surface: 'unsupported',
            error: 'Session storage unavailable'
        });
        expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
        expect(chrome.storage.local.set).not.toHaveBeenCalledWith(expect.objectContaining({ isScraping: true }));
    });

    test('releases the pending intent after a session persistence failure', async () => {
        global.chrome = createBackgroundChrome();
        chrome.storage.session.set
            .mockResolvedValueOnce()
            .mockRejectedValueOnce(new Error('Session storage unavailable'))
            .mockResolvedValue();
        const { initializeScrapeInActiveTab } = require('../../background.js');

        await expect(initializeScrapeInActiveTab({ action: 'INIT_SCRAPE' })).resolves.toMatchObject({
            status: 'error',
            error: 'Session storage unavailable'
        });
        await expect(initializeScrapeInActiveTab({ action: 'INIT_SCRAPE' })).resolves.toMatchObject({
            status: 'started'
        });
    });

    test('does not let generic local idle changes mutate session authority', async () => {
        global.chrome = createBackgroundChrome();
        require('../../background.js');
        const storageListener = chrome.storage.onChanged.addListener.mock.calls[0][0];

        storageListener({ scraperState: { newValue: 'idle' } }, 'local');
        await Promise.resolve();

        expect(chrome.storage.session.remove).not.toHaveBeenCalled();
    });
});

describe('native media download acknowledgement', () => {
    afterEach(() => {
        delete global.chrome;
        jest.resetModules();
    });

    test('resolves only after Chrome accepts the download', async () => {
        global.chrome = createBackgroundChrome();
        chrome.downloads.download.mockImplementation((_options, callback) => callback(91));
        const { queueChromeDownload } = require('../../background.js');

        await expect(queueChromeDownload({ url: 'https://assets.grok.com/media' })).resolves.toBe(91);
    });

    test('rejects when Chrome reports a download error', async () => {
        global.chrome = createBackgroundChrome();
        chrome.downloads.download.mockImplementation((_options, callback) => {
            chrome.runtime.lastError = { message: 'Download rejected' };
            callback(undefined);
            chrome.runtime.lastError = null;
        });
        const { queueChromeDownload } = require('../../background.js');

        await expect(queueChromeDownload({ url: 'https://assets.grok.com/media' }))
            .rejects.toThrow('Download rejected');
    });
});
