const {
    SCRAPE_SURFACES,
    GrokScraper,
    detectGrokScrapeSurface,
    findMatchingAgentMedia,
    getGrokMediaIdentity,
    isSuccessfulMediaTransferStatus,
    shouldStopScraperForStorageChanges
} = require('../../content.js');

function mockContentChrome() {
    global.chrome = {
        runtime: {
            id: 'extension-id',
            sendMessage: jest.fn((message) => Promise.resolve(
                message?.action === 'VALIDATE_SCRAPE_RESUME' ? { valid: true } : undefined
            ))
        },
        storage: {
            local: {
                get: jest.fn(() => Promise.resolve({})),
                set: jest.fn(() => Promise.resolve())
            }
        }
    };
}

function createScraper(surface = SCRAPE_SURFACES.savedGallery) {
    const scraper = Object.create(GrokScraper.prototype);
    scraper.state = { isRunning: false, currentIndex: 0, mode: 'IDLE' };
    scraper.backupMode = false;
    scraper.processedIds = new Set();
    scraper._backupVisited = new Set();
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

        const response = await scraper.start();

        expect(response).toEqual({ status: 'started', surface: SCRAPE_SURFACES.savedGallery, runToken: 'run-1' });
        expect(chrome.storage.local.set).toHaveBeenCalledWith({
            scraperState: 'running',
            currentIndex: 0,
            scrapeRunToken: 'run-1',
            scrapeBackupOptions: null
        });
        expect(scraper.state.isRunning).toBe(true);
        expect(scraper.determineModeAndExecute).toHaveBeenCalledWith('run-1');
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

    test('transfers the exact Agent media, persists after success, and returns to Saved', async () => {
        const scraper = createScraper(SCRAPE_SURFACES.agentMedia);
        const media = document.createElement('img');
        scraper.state.isRunning = true;
        scraper.runToken = 'run-1';
        scraper.pendingNavigation = {
            runToken: 'run-1',
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
            scrapeNavigation: {
                runToken: 'run-1',
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
            runToken: 'run-1'
        });
        expect(scraper.determineModeAndExecute).toHaveBeenCalledWith('run-1');
        expect(scraper.setupListeners).toHaveBeenCalledTimes(1);
    });

    test('clears a persisted run when the current extension session does not own its token', async () => {
        const stored = {
            scraperState: 'running',
            currentIndex: 2,
            processedIds: ['existing-id'],
            scrapeRunToken: 'stale-run',
            scrapeNavigation: { runToken: 'stale-run', currentItemId: 'gallery-clean-id' },
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
});

function createBackgroundChrome({
    url = 'https://grok.com/imagine/saved',
    initResponse = { status: 'started', surface: 'saved_gallery', runToken: 'run-1' }
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
            sendMessage: jest.fn((_tabId, _message, callback) => callback(initResponse))
        }
    };
}

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

        expect(response).toEqual({ status: 'started', surface: 'saved_gallery', runToken: 'run-1' });
        expect(chrome.storage.session.set).toHaveBeenCalledWith({ activeScrapeRunToken: 'run-1' });
        expect(chrome.storage.local.set).toHaveBeenCalledWith({ isScraping: true, isR2Backup: false });
    });

    test('injects once and retries the handshake when the content script is absent', async () => {
        global.chrome = createBackgroundChrome();
        let attempt = 0;
        chrome.tabs.sendMessage.mockImplementation((_tabId, _message, callback) => {
            attempt++;
            if (attempt === 1) {
                chrome.runtime.lastError = { message: 'Could not establish connection. Receiving end does not exist.' };
                callback(undefined);
                chrome.runtime.lastError = null;
                return;
            }
            callback({ status: 'started', surface: 'saved_gallery', runToken: 'run-1' });
        });
        const { initializeScrapeInActiveTab } = require('../../background.js');

        const response = await initializeScrapeInActiveTab({ action: 'INIT_SCRAPE' });

        expect(response.status).toBe('started');
        expect(chrome.scripting.executeScript).toHaveBeenCalledTimes(1);
        expect(chrome.tabs.sendMessage).toHaveBeenCalledTimes(2);
    });

    test('validates navigation resumes against the extension session token', async () => {
        global.chrome = createBackgroundChrome();
        chrome.storage.session.get.mockResolvedValue({ activeScrapeRunToken: 'run-1' });
        const { validateScrapeResume } = require('../../background.js');

        await expect(validateScrapeResume('run-1')).resolves.toBe(true);
        await expect(validateScrapeResume('another-run')).resolves.toBe(false);
        expect(chrome.storage.session.get).toHaveBeenCalledWith(['activeScrapeRunToken']);
    });

    test('aborts content when background cannot persist the acknowledged run lease', async () => {
        global.chrome = createBackgroundChrome();
        chrome.storage.session.set.mockRejectedValue(new Error('Session storage unavailable'));
        const { initializeScrapeInActiveTab } = require('../../background.js');

        const response = await initializeScrapeInActiveTab({ action: 'INIT_SCRAPE' });

        expect(response).toEqual({
            status: 'error',
            surface: 'unsupported',
            error: 'Session storage unavailable'
        });
        expect(chrome.tabs.sendMessage).toHaveBeenNthCalledWith(
            2,
            42,
            { action: 'ABORT_SCRAPE' },
            expect.any(Function)
        );
        expect(chrome.storage.local.set).toHaveBeenCalledWith({ isScraping: false, isR2Backup: false });
    });

    test('clears the session token when local running state becomes idle', async () => {
        global.chrome = createBackgroundChrome();
        require('../../background.js');
        const storageListener = chrome.storage.onChanged.addListener.mock.calls[0][0];

        storageListener({ scraperState: { newValue: 'idle' } }, 'local');
        await Promise.resolve();

        expect(chrome.storage.session.remove).toHaveBeenCalledWith('activeScrapeRunToken');
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
