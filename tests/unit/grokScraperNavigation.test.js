const {
    SCRAPE_SURFACES,
    GrokScraper,
    detectGrokScrapeSurface,
    findMatchingAgentMedia,
    getGrokMediaIdentity,
    isSuccessfulMediaTransferStatus,
    shouldStopScraperForStorageChanges
} = require('../../content.js');
const CloudSyncUtils = require('../../cloudSyncUtils.js');

function mockContentChrome() {
    global.chrome = {
        runtime: {
            id: 'extension-id',
            lastError: null,
            sendMessage: jest.fn((message) => Promise.resolve(
                message?.action === 'VALIDATE_SCRAPE_RESUME' ? { valid: true } : undefined
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
    scraper.processedIds = new Set();
    scraper._backupVisited = new Set();
    scraper._runVisited = new Set();
    scraper.runToken = null;
    scraper.runEpoch = 1;
    scraper.Config = { actionWait: 0, navWait: 0, surfaceWait: 50 };
    scraper.getCurrentSurface = jest.fn(() => surface);
    scraper.createRunToken = jest.fn(() => 'run-1');
    scraper.determineModeAndExecute = jest.fn();
    scraper.log = jest.fn();
    return scraper;
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
        expect(chrome.storage.local.set).toHaveBeenCalledWith({
            scraperState: 'running',
            currentIndex: 0,
            scrapeRunToken: 'run-1',
            scrapeRunEpoch: 1,
            scrapeBackupOptions: null
        });
        expect(scraper.state.isRunning).toBe(true);
        expect(scraper.determineModeAndExecute).toHaveBeenCalledWith('run-1', 1);
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
        expect(chrome.storage.local.set).toHaveBeenCalledWith(expect.objectContaining({
            scrapeRunToken: 'background-run',
            scrapeRunEpoch: 12
        }));
    });

    test('uses the background-issued lease for R2 Backup too', async () => {
        const scraper = createScraper();
        chrome.runtime.sendMessage.mockImplementation(async (message) => (
            message.action === 'VALIDATE_CLOUD_CONFIG' ? { valid: true } : undefined
        ));

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
        expect(chrome.storage.local.set).toHaveBeenCalledWith(expect.objectContaining({
            scrapeRunToken: 'background-backup',
            scrapeRunEpoch: 13
        }));
    });
});

describe('Grok scrape surface transitions', () => {
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

    test('captures Saved context before clicking and routes the resulting surface', async () => {
        mockContentChrome();
        const scraper = createScraper();
        scraper.state.isRunning = true;
        scraper.runToken = 'run-1';
        scraper.getGalleryScroller = jest.fn(() => ({ scrollTop: 640, scrollHeight: 2000, clientHeight: 800 }));
        scraper.waitForSurface = jest.fn(() => Promise.resolve(SCRAPE_SURFACES.agentMedia));
        const target = document.createElement('img');
        target.src = 'https://assets.grok.com/users/u/73e5e137-1334-49ea-b06b-a9d9ba891003/content?size=small';
        target.click = jest.fn();

        await GrokScraper.prototype.processItem.call(scraper, target, 'gallery-clean-id', 'run-1');

        expect(chrome.storage.local.set).toHaveBeenCalledWith(expect.objectContaining({
            currentItemId: 'gallery-clean-id',
            scrapeNavigation: expect.objectContaining({
                runToken: 'run-1',
                currentItemId: 'gallery-clean-id',
                expectedIdentity: '73e5e137-1334-49ea-b06b-a9d9ba891003',
                galleryScrollTop: 640
            })
        }));
        expect(target.click).toHaveBeenCalledTimes(1);
        expect(scraper.determineModeAndExecute).toHaveBeenCalledWith('run-1');
    });

    test('stops explicitly when a selected Saved card never changes surfaces', async () => {
        mockContentChrome();
        const scraper = createScraper();
        scraper.state.isRunning = true;
        scraper.runToken = 'run-1';
        scraper.getGalleryScroller = jest.fn(() => ({ scrollTop: 0, scrollHeight: 1000, clientHeight: 800 }));
        scraper.waitForSurface = jest.fn(() => Promise.resolve(null));
        scraper.failRun = jest.fn(() => Promise.resolve());
        const target = document.createElement('img');
        target.src = 'https://assets.grok.com/users/u/73e5e137-1334-49ea-b06b-a9d9ba891003/content';
        target.click = jest.fn();

        await GrokScraper.prototype.processItem.call(scraper, target, 'gallery-clean-id', 'run-1');

        expect(scraper.failRun).toHaveBeenCalledWith(
            'The selected Saved card did not open a supported media surface.',
            'surface_transition_timeout'
        );
        expect(scraper.determineModeAndExecute).not.toHaveBeenCalled();
    });

    test('does not click after Stop wins while navigation state is being saved', async () => {
        mockContentChrome();
        const scraper = createScraper();
        scraper.state.isRunning = true;
        scraper.runToken = 'run-1';
        scraper.getGalleryScroller = jest.fn(() => ({ scrollTop: 0, scrollHeight: 1000, clientHeight: 800 }));
        chrome.storage.local.set.mockImplementation(async () => {
            scraper.runToken = 'run-2';
        });
        scraper.waitForSurface = jest.fn();
        const target = document.createElement('img');
        target.src = 'https://assets.grok.com/users/u/73e5e137-1334-49ea-b06b-a9d9ba891003/content';
        target.click = jest.fn();

        await GrokScraper.prototype.processItem.call(scraper, target, 'gallery-clean-id', 'run-1');

        expect(target.click).not.toHaveBeenCalled();
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
        const stored = {};
        chrome.storage.local.set.mockImplementation((values) => {
            if (values.scrapeNavigation) {
                return navigationWrite.promise.then(() => Object.assign(stored, values));
            }
            Object.assign(stored, values);
            return Promise.resolve();
        });
        const target = document.createElement('img');
        target.src = 'https://assets.grok.com/users/u/73e5e137-1334-49ea-b06b-a9d9ba891003/content';
        target.click = jest.fn();

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

        expect(target.click).not.toHaveBeenCalled();
        expect(stored).toMatchObject({
            scraperState: 'idle',
            scrapeRunToken: null,
            scrapeRunEpoch: null,
            scrapeNavigation: null,
            currentItemId: null
        });
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

    test('restores the Saved scroll position and clears only navigation state', async () => {
        mockContentChrome();
        const scraper = createScraper();
        const scroller = { scrollTop: 0 };
        scraper.state.isRunning = true;
        scraper.runToken = 'run-1';
        scraper.pendingNavigation = {
            runToken: 'run-1',
            runEpoch: 1,
            galleryScrollTop: 840,
            currentItemId: 'gallery-clean-id'
        };
        scraper.sleep = jest.fn(() => Promise.resolve());
        scraper.getGalleryScroller = jest.fn(() => scroller);

        await GrokScraper.prototype.restorePendingGalleryContext.call(scraper, 'run-1');

        expect(scroller.scrollTop).toBe(840);
        expect(scraper.pendingNavigation).toBeNull();
        expect(chrome.storage.local.set).toHaveBeenCalledWith({
            scrapeNavigation: null,
            currentItemId: null
        });
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
            if (message.action === 'PROCESSED_IDS_ADD') {
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
            action: 'PROCESSED_IDS_ADD',
            ids: ['saved-media-url', media.src.split('?')[0], mediaId]
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
            blobDataUrl: 'data:image/png;base64,AA=='
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
            blobDataUrl: null
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
        expect(chrome.storage.local.set).toHaveBeenCalledWith(expect.objectContaining({
            scraperState: 'idle',
            isScraping: false,
            isR2Backup: false,
            scrapeRunToken: null,
            scrapeNavigation: null
        }));
        expect(scraper.processedIds).toEqual(new Set(['existing-id']));
    });

    test('normal stop persists every running flag as idle', async () => {
        mockContentChrome();
        const scraper = createScraper();
        scraper.state.isRunning = true;
        scraper.runToken = 'run-1';

        await GrokScraper.prototype.stop.call(scraper, 'complete');

        expect(chrome.storage.local.set).toHaveBeenCalledWith(expect.objectContaining({
            scraperState: 'idle',
            isScraping: false,
            isR2Backup: false,
            scrapeRunToken: null
        }));
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

function createLeaseBackgroundHarness({
    lease,
    localState = {},
    url = 'https://grok.com/imagine/saved'
} = {}) {
    const sessionState = {};
    if (typeof lease !== 'undefined') sessionState.activeScrapeRunToken = lease;
    const storedLocal = { ...localState };
    const chromeApi = createBackgroundChrome({ url });

    chromeApi.storage.session.get.mockImplementation(async () => ({ ...sessionState }));
    chromeApi.storage.session.set.mockImplementation(async (values) => {
        Object.assign(sessionState, values);
    });
    chromeApi.storage.session.remove.mockImplementation(async (key) => {
        delete sessionState[key];
    });
    chromeApi.storage.local.get.mockImplementation(async () => ({ ...storedLocal }));
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

describe('background scrape lease authority', () => {
    afterEach(() => {
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
        await expect(background.validateScrapeResume(oldLease, 42)).resolves.toBe(false);
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

    test('requires exact token, epoch, and sender tab for resume validation', async () => {
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

        await expect(background.validateScrapeResume(lease, 42)).resolves.toBe(true);
        await expect(background.validateScrapeResume({ ...lease, epoch: lease.epoch + 1 }, 42)).resolves.toBe(false);
        await expect(background.validateScrapeResume(lease, 99)).resolves.toBe(false);
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

        await expect(validateScrapeResume(lease, 42)).resolves.toBe(true);
        await expect(validateScrapeResume({ ...lease, token: 'another-run' }, 42)).resolves.toBe(false);
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
