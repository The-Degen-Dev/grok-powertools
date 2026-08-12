const { VideoRetryManager } = require('../../content.js');

const originalPointerEvent = global.PointerEvent;

function createSettingsManager(overrides = {}) {
    const settings = {
        maxRetries: 3,
        retryCooldown: 0,
        autoRetryEnabled: true,
        videoGoal: 3,
        galleryBatchLimit: 2,
        ...overrides
    };
    return {
        settings,
        get: jest.fn((key) => settings[key]),
        subscribe: jest.fn()
    };
}

function makeVisible(element, rect = {}) {
    jest.spyOn(element, 'getBoundingClientRect').mockReturnValue({
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 40,
        bottom: 40,
        width: 40,
        height: 40,
        ...rect
    });
    return element;
}

let promptedVideoFixtureId = 0;

function openLinkedMenu(trigger, menu) {
    const fixtureId = ++promptedVideoFixtureId;
    if (!trigger.id) trigger.id = `make-video-trigger-${fixtureId}`;
    if (!menu.id) menu.id = `make-video-menu-${fixtureId}`;
    trigger.setAttribute('aria-controls', menu.id);
    trigger.setAttribute('aria-expanded', 'true');
    trigger.setAttribute('data-state', 'open');
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-labelledby', trigger.id);
    menu.setAttribute('data-state', 'open');
    if (!menu.isConnected) document.body.appendChild(menu);
    return menu;
}

function createMenuItem(label, onClick = null) {
    const item = makeVisible(document.createElement('div'));
    item.setAttribute('role', 'menuitem');
    item.textContent = label;
    if (onClick) item.addEventListener('click', onClick);
    return item;
}

function mountFocusedPromptedVideoComposer({ root = null, onSubmit = null } = {}) {
    const composer = root || document.createElement('div');
    composer.className = 'query-bar';
    composer.style.display = '';
    const input = document.createElement('div');
    input.setAttribute('contenteditable', 'true');
    input.setAttribute('role', 'textbox');
    input.setAttribute('aria-label', 'Ask Grok anything');
    input.tabIndex = -1;
    const submit = makeVisible(document.createElement('button'));
    submit.setAttribute('aria-label', 'Make video');
    if (onSubmit) submit.addEventListener('click', onSubmit);
    composer.append(input, submit);
    if (!composer.isConnected) document.body.appendChild(composer);
    input.focus();
    return { composer, input, submit };
}

function createSavedBatchCard(sourceUrl, onImageClick = null) {
    const card = document.createElement('div');
    card.setAttribute('role', 'listitem');
    const image = document.createElement('img');
    image.alt = 'Generated image';
    image.src = sourceUrl;
    image.scrollIntoView = jest.fn();
    if (onImageClick) image.addEventListener('click', onImageClick);
    const makeVideo = document.createElement('button');
    makeVideo.setAttribute('aria-label', 'Make video');
    card.append(image, makeVideo);
    document.body.appendChild(card);
    return { card, image, makeVideo };
}

function addNextCardClickProbe() {
    const { image } = createSavedBatchCard(
        'https://assets.grok.com/users/example/generated/deadbeef-bbbb-4ccc-8ddd-eeeeeeeeeeee/image.jpg'
    );
    const nextClick = jest.fn();
    image.addEventListener('click', nextClick);
    return nextClick;
}

function primePromptedGalleryBatch(retryManager, item, prompt = 'slow camera push in') {
    retryManager.batchRunning = true;
    retryManager.batchAborted = false;
    retryManager.batchRunToken = 'batch-test-token';
    retryManager.batchMode = 'prompted';
    retryManager.batchContext = 'gallery';
    retryManager.batchPrompt = prompt;
    retryManager.batchGalleryUrl = window.location.href;
    retryManager.batchProcessedSrcs = new Set();
    retryManager.batchQueue = [item];
    retryManager.batchIndex = 0;
    retryManager.goalCount = 0;
    retryManager.goalTotal = 2;
}

function renderAgentEditor({
    sourceUrl,
    onBack = null,
    makeVideo = true,
    addPrompt = true,
    composer = true,
    includeAgentAsset = true,
    onSubmit = null
} = {}) {
    document.body.innerHTML = `${includeAgentAsset ? `
        <div class="react-flow__node-asset">
            <img src="${sourceUrl}">
        </div>` : ''}
        <div class="query-bar"></div>`;
    const back = makeVisible(document.createElement('button'));
    back.setAttribute('aria-label', 'Back');
    if (onBack) back.addEventListener('click', onBack);

    const makeVideoButton = makeVisible(document.createElement('button'));
    if (makeVideo) {
        makeVideoButton.setAttribute('aria-label', 'Make Video');
        makeVideoButton.setAttribute('aria-haspopup', 'menu');
        makeVideoButton.addEventListener('click', () => {
            if (!addPrompt) return;
            const menu = makeVisible(document.createElement('div'));
            const menuItem = createMenuItem('Add Prompt', () => {
                if (!composer) return;
                mountFocusedPromptedVideoComposer({ onSubmit });
                menuItem.remove();
            });
            menu.appendChild(menuItem);
            openLinkedMenu(makeVideoButton, menu);
        });
    }
    document.body.appendChild(back);
    if (makeVideo) document.body.appendChild(makeVideoButton);
    return { back, makeVideo: makeVideo ? makeVideoButton : null };
}

describe('VideoRetryManager', () => {
    let retryManager;
    let mockOverlay;
    let settingsManager;
    let historyManager;
    let setIntervalSpy;
    let promptedVideoBridgeHandler;

    beforeEach(() => {
        if (!global.PointerEvent) global.PointerEvent = MouseEvent;
        mockOverlay = {
            setStatus: jest.fn(),
            el: document.createElement('div')
        };
        mockOverlay.el.innerHTML = `
            <span id="gptRetryCounter"></span>
            <span id="gptVideoCounter"></span>
            <span id="gptProgressLabel"></span>
            <div id="gptQuickBatchBtn"></div>
            <div id="gptPromptedBatchBtn"></div>
            <div id="gptBatchStopBtn"></div>
            <div id="gptBatchStatus"></div>
            <div id="gptGalleryLimitRow"></div>
        `;

        settingsManager = createSettingsManager();
        historyManager = { history: [], add: jest.fn() };

        document.body.innerHTML = '';
        window.history.pushState({}, '', '/');

        promptedVideoBridgeHandler = (event) => {
            const target = document.querySelector(`[data-gpt-prompt-target="${event.detail.marker}"]`);
            if (target) target.textContent = event.detail.text;
            document.dispatchEvent(new CustomEvent('__gpt_set_prompted_video_content_result', {
                detail: { marker: event.detail.marker, ok: !!target }
            }));
        };
        document.addEventListener('__gpt_set_prompted_video_content', promptedVideoBridgeHandler);

        setIntervalSpy = jest.spyOn(global, 'setInterval').mockImplementation(() => 1);
        retryManager = new VideoRetryManager(mockOverlay, settingsManager, historyManager);
    });

    afterEach(() => {
        document.removeEventListener('__gpt_set_prompted_video_content', promptedVideoBridgeHandler);
        jest.restoreAllMocks();
    });

    afterAll(() => {
        if (originalPointerEvent) global.PointerEvent = originalPointerEvent;
        else delete global.PointerEvent;
    });

    test('subscribes to settings updates and starts observer', () => {
        expect(settingsManager.subscribe).toHaveBeenCalledTimes(1);
        expect(setIntervalSpy).toHaveBeenCalledTimes(1);
        expect(retryManager.goalRunning).toBe(false);
    });

    test('clickMakeVideo clicks button and enters verifying state', () => {
        const makeVideoButton = document.createElement('button');
        makeVideoButton.setAttribute('aria-label', 'Make video');
        makeVideoButton.click = jest.fn();

        document.body.appendChild(makeVideoButton);

        retryManager.clickMakeVideo();

        expect(makeVideoButton.click).toHaveBeenCalledTimes(1);
        expect(retryManager.isVerifying).toBe(true);
        expect(retryManager.lastClickTime).toBeGreaterThan(0);
    });

    test('attemptRetry increments retry and invokes click', () => {
        retryManager.lastClickTime = 0;
        retryManager.clickMakeVideo = jest.fn();

        retryManager.attemptRetry();

        expect(retryManager.currentRetry).toBe(1);
        expect(retryManager.clickMakeVideo).toHaveBeenCalledTimes(1);
        expect(mockOverlay.setStatus).toHaveBeenCalledWith('Retrying... (1)', 'warning');
    });

    test('attemptRetry stops when max retries are hit', () => {
        settingsManager.settings.maxRetries = 1;
        retryManager.currentRetry = 1;
        retryManager.goalRunning = true;
        retryManager.lastClickTime = 0;
        retryManager.clickMakeVideo = jest.fn();

        retryManager.attemptRetry();

        expect(mockOverlay.setStatus).toHaveBeenCalledWith('Max Retries Hit', 'error');
        expect(retryManager.goalRunning).toBe(false);
        expect(retryManager.clickMakeVideo).not.toHaveBeenCalled();
    });

    test('checkAndAct returns early when auto retry disabled and goal not running', () => {
        settingsManager.settings.autoRetryEnabled = false;
        retryManager.goalRunning = false;
        retryManager.clickMakeVideo = jest.fn();

        retryManager.checkAndAct();

        expect(retryManager.clickMakeVideo).not.toHaveBeenCalled();
    });

    test('checkAndAct marks goal complete after verified success', () => {
        const makeVideoButton = document.createElement('button');
        makeVideoButton.setAttribute('aria-label', 'Make video');
        document.body.appendChild(makeVideoButton);

        const progressButton = document.createElement('button');
        progressButton.setAttribute('aria-label', 'Video Options');
        document.body.appendChild(progressButton);

        retryManager.goalRunning = true;
        retryManager.goalTotal = 1;
        retryManager.goalCount = 0;
        retryManager.isVerifying = true;
        retryManager.preClickButtonCount = 0;

        retryManager.checkAndAct();

        expect(retryManager.goalCount).toBe(1);
        expect(retryManager.goalRunning).toBe(false);
        expect(mockOverlay.setStatus).toHaveBeenCalledWith('Goal Complete', 'success');
    });

    test('detectBatchContext resolves detail on imagine post URL', () => {
        window.history.pushState({}, '', '/imagine/post/abc123');
        expect(retryManager.detectBatchContext()).toBe('detail');
    });

    test('detectBatchContext resolves gallery when card selectors exist', () => {
        window.history.pushState({}, '', '/imagine/saved');
        createSavedBatchCard('https://assets.grok.com/users/example/generated/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee/image.jpg');
        expect(retryManager.detectBatchContext()).toBe('gallery');
    });

    test('targets the nearest qualified media card when an unrelated control is closer to viewport center', () => {
        const menuItem = document.createElement('div');
        menuItem.setAttribute('role', 'listitem');
        const menuImage = document.createElement('img');
        menuImage.alt = 'Menu preview';
        menuImage.src = 'https://assets.grok.com/menu-preview.jpg';
        const menuMakeVideo = makeVisible(document.createElement('button'), { top: 364 });
        menuMakeVideo.setAttribute('aria-label', 'Make video');
        menuMakeVideo.click = jest.fn();
        menuItem.append(menuImage, menuMakeVideo);

        const card = document.createElement('div');
        card.setAttribute('role', 'listitem');
        const image = document.createElement('img');
        image.alt = 'Generated image';
        image.src = 'https://assets.grok.com/users/example/generated/media-1/image.jpg';
        const makeVideo = makeVisible(document.createElement('button'), { top: 40 });
        makeVideo.setAttribute('aria-label', 'Make video');
        makeVideo.click = jest.fn();
        const progress = document.createElement('button');
        progress.setAttribute('aria-label', 'Video Options');
        card.append(image, makeVideo, progress);
        document.body.append(menuItem, card);

        retryManager.startGoal(1);

        expect(retryManager.targetContext).toBe(card);
        expect(retryManager._queryRoot().querySelector('img')).toBe(image);
        expect(retryManager._queryRoot().querySelector(retryManager.PROGRESS_SELECTOR)).toBe(progress);
        expect(makeVideo.click).toHaveBeenCalledTimes(1);
        expect(menuMakeVideo.click).not.toHaveBeenCalled();

        progress.remove();
        expect(retryManager.buildBatchQueue()).toEqual([
            expect.objectContaining({ button: makeVideo, container: card })
        ]);
    });

    test('does not start or click when no qualified media card exists', () => {
        const menuItem = document.createElement('div');
        menuItem.setAttribute('role', 'listitem');
        const menuImage = document.createElement('img');
        menuImage.alt = 'Menu preview';
        const menuMakeVideo = document.createElement('button');
        menuMakeVideo.setAttribute('aria-label', 'Make video');
        menuMakeVideo.click = jest.fn();
        menuItem.append(menuImage, menuMakeVideo);
        document.body.appendChild(menuItem);

        retryManager.startGoal(1);

        expect(retryManager.goalRunning).toBe(false);
        expect(retryManager.targetContext).toBeNull();
        expect(menuMakeVideo.click).not.toHaveBeenCalled();
        expect(mockOverlay.setStatus).toHaveBeenCalledWith('No generated-image card found', 'warning');
    });

    test('startBatch(prompted) routes to gallery flow on gallery context', async () => {
        window.history.pushState({}, '', '/imagine/saved');
        createSavedBatchCard('https://assets.grok.com/users/example/generated/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee/image.jpg');

        const gallerySpy = jest.spyOn(retryManager, 'startPromptedBatchFromGallery').mockResolvedValue();
        const detailSpy = jest.spyOn(retryManager, 'startPromptedBatchFromDetail').mockResolvedValue();

        await retryManager.startBatch('prompted', 'test prompt', { galleryLimit: 4, videoGoal: 7 });

        expect(gallerySpy).toHaveBeenCalledWith('test prompt', 4, expect.any(String));
        expect(detailSpy).not.toHaveBeenCalled();
    });

    test('startBatch(prompted) routes to detail flow on detail context', async () => {
        window.history.pushState({}, '', '/imagine/post/xyz');
        const gallerySpy = jest.spyOn(retryManager, 'startPromptedBatchFromGallery').mockResolvedValue();
        const detailSpy = jest.spyOn(retryManager, 'startPromptedBatchFromDetail').mockResolvedValue();

        await retryManager.startBatch('prompted', 'detail prompt', { galleryLimit: 4, videoGoal: 6 });

        expect(detailSpy).toHaveBeenCalledWith('detail prompt', 6, expect.any(String));
        expect(gallerySpy).not.toHaveBeenCalled();
    });

    test('rejects an overlapping batch start without replacing the active run state', async () => {
        const sourceUrl = 'https://assets.grok.com/users/example/generated/01010101-bbbb-4ccc-8ddd-eeeeeeeeeeee/image.jpg';
        window.history.pushState({}, '', '/imagine/saved');
        const { image } = createSavedBatchCard(sourceUrl);
        const imageClick = jest.fn();
        image.addEventListener('click', imageClick);
        const sleepResolvers = [];
        retryManager.sleep = jest.fn(() => new Promise((resolve) => sleepResolvers.push(resolve)));

        const firstRun = retryManager.startBatch('prompted', 'first prompt', { galleryLimit: 1 });
        const firstToken = retryManager.batchRunToken;
        const secondRun = retryManager.startBatch('prompted', 'second prompt', { galleryLimit: 9 });
        await Promise.resolve();

        const activeState = {
            token: retryManager.batchRunToken,
            prompt: retryManager.batchPrompt,
            goalTotal: retryManager.goalTotal,
            clicks: imageClick.mock.calls.length
        };
        retryManager.stopBatch();
        sleepResolvers.forEach((resolve) => resolve());
        const [, secondResult] = await Promise.all([firstRun, secondRun]);

        expect(secondResult).toBe(false);
        expect(activeState).toEqual({
            token: firstToken,
            prompt: 'first prompt',
            goalTotal: 1,
            clicks: 1
        });
        expect(mockOverlay.setStatus).toHaveBeenCalledWith('Batch is already running', 'warning');
    });

    test('prompted Saved batch submits through Agent Mode and restores the Saved scroll position', async () => {
        const sourceUrl = 'https://assets.grok.com/users/example/generated/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee/image.jpg';
        const originalScrollY = 240;
        let submitted = 0;

        Object.defineProperty(window, 'scrollY', { value: originalScrollY, configurable: true });
        window.scrollTo = jest.fn();
        window.history.pushState({}, '', '/imagine/saved');

        const renderSavedCard = () => {
            document.body.innerHTML = '';
            const card = document.createElement('div');
            card.setAttribute('role', 'listitem');
            const image = document.createElement('img');
            image.alt = 'Generated image';
            image.src = sourceUrl;
            image.scrollIntoView = jest.fn();
            const makeVideo = document.createElement('button');
            makeVideo.setAttribute('aria-label', 'Make video');
            card.append(image, makeVideo);
            document.body.appendChild(card);
            return { card, image };
        };

        const { image } = renderSavedCard();
        image.addEventListener('click', () => {
            window.history.pushState({}, '', '/imagine/agent/agent-1?conversation=conversation-1');
            document.body.innerHTML = `
                <div class="react-flow__node-asset">
                    <img src="${sourceUrl}">
                </div>
                <div class="query-bar"></div>
            `;

            const back = makeVisible(document.createElement('button'));
            back.setAttribute('aria-label', 'Back');
            back.addEventListener('click', () => {
                window.history.pushState({}, '', '/imagine/saved');
                renderSavedCard();
            });

            const makeVideo = makeVisible(document.createElement('button'));
            makeVideo.setAttribute('aria-label', 'Make Video');
            makeVideo.setAttribute('aria-haspopup', 'menu');
            makeVideo.addEventListener('click', () => {
                const menu = makeVisible(document.createElement('div'));
                const addPrompt = createMenuItem('Add Prompt', () => {
                    mountFocusedPromptedVideoComposer({ onSubmit: () => { submitted++; } });
                    addPrompt.remove();
                });
                menu.appendChild(addPrompt);
                openLinkedMenu(makeVideo, menu);
            });
            document.body.append(back, makeVideo);
        });

        retryManager.sleep = jest.fn().mockResolvedValue();

        await retryManager.startPromptedBatchFromGallery('slow camera push in', 1);

        expect(submitted).toBe(1);
        expect(window.location.pathname).toBe('/imagine/saved');
        expect(window.scrollTo).toHaveBeenCalledWith(0, originalScrollY);
        expect(retryManager.goalCount).toBe(1);
    });

    test('waits for delayed exact Agent media and Make Video readiness before acting', async () => {
        const sourceUrl = 'https://assets.grok.com/users/example/generated/02020202-bbbb-4ccc-8ddd-eeeeeeeeeeee/image.jpg';
        let submitted = 0;
        let readinessPolls = 0;
        window.history.pushState({}, '', '/imagine/saved');

        const renderSaved = () => {
            document.body.innerHTML = '';
            return createSavedBatchCard(sourceUrl);
        };
        const { image } = renderSaved();
        image.addEventListener('click', () => {
            window.history.pushState({}, '', '/imagine/agent/agent-2?conversation=conversation-2');
            document.body.innerHTML = '';
            const decoyNode = document.createElement('div');
            decoyNode.className = 'react-flow__node-asset';
            const decoyMedia = document.createElement('img');
            decoyMedia.src = 'https://assets.grok.com/users/example/generated/12121212-bbbb-4ccc-8ddd-eeeeeeeeeeee/image.jpg';
            decoyNode.appendChild(decoyMedia);
            const back = makeVisible(document.createElement('button'));
            back.setAttribute('aria-label', 'Back');
            back.addEventListener('click', () => {
                window.history.pushState({}, '', '/imagine/saved');
                renderSaved();
            });
            document.body.append(decoyNode, back);
        });
        retryManager.sleep = jest.fn().mockImplementation(async () => {
            readinessPolls++;
            if (readinessPolls === 1) {
                const node = document.createElement('div');
                node.className = 'react-flow__node-asset';
                const media = document.createElement('img');
                media.src = sourceUrl;
                node.appendChild(media);
                document.body.appendChild(node);
            }
            if (readinessPolls === 2) {
                const makeVideo = makeVisible(document.createElement('button'));
                makeVideo.setAttribute('aria-label', 'Make Video');
                makeVideo.setAttribute('aria-haspopup', 'menu');
                makeVideo.addEventListener('click', () => {
                    const menu = makeVisible(document.createElement('div'));
                    const addPrompt = createMenuItem('Add Prompt', () => {
                        mountFocusedPromptedVideoComposer({ onSubmit: () => { submitted++; } });
                    });
                    menu.appendChild(addPrompt);
                    openLinkedMenu(makeVideo, menu);
                });
                document.body.appendChild(makeVideo);
            }
        });

        await retryManager.startPromptedBatchFromGallery('slow camera push in', 1);

        expect(readinessPolls).toBeGreaterThanOrEqual(2);
        expect(submitted).toBe(1);
        expect(retryManager.goalCount).toBe(1);
    });

    test('uses the semantic generated image when a decoy image appears first in the Saved card', async () => {
        const sourceUrl = 'https://assets.grok.com/users/example/generated/03030303-bbbb-4ccc-8ddd-eeeeeeeeeeee/image.jpg';
        const decoyUrl = 'https://assets.grok.com/users/example/generated/04040404-bbbb-4ccc-8ddd-eeeeeeeeeeee/avatar.jpg';
        let submitted = 0;
        window.history.pushState({}, '', '/imagine/saved');

        const renderSaved = (onClick = null) => {
            document.body.innerHTML = '';
            const saved = createSavedBatchCard(sourceUrl, onClick);
            const decoy = document.createElement('img');
            decoy.alt = 'Account avatar';
            decoy.src = decoyUrl;
            saved.card.prepend(decoy);
            return saved;
        };
        renderSaved(() => {
            window.history.pushState({}, '', '/imagine/agent/agent-3?conversation=conversation-3');
            renderAgentEditor({
                sourceUrl,
                onSubmit: () => { submitted++; },
                onBack: () => {
                    window.history.pushState({}, '', '/imagine/saved');
                    renderSaved();
                }
            });
        });
        retryManager.sleep = jest.fn().mockResolvedValue();

        await retryManager.startPromptedBatchFromGallery('slow camera push in', 1);

        expect(submitted).toBe(1);
        expect(retryManager.batchProcessedSrcs.has('03030303-bbbb-4ccc-8ddd-eeeeeeeeeeee')).toBe(true);
        expect(retryManager.batchProcessedSrcs.has('04040404-bbbb-4ccc-8ddd-eeeeeeeeeeee')).toBe(false);
    });

    test('prompted Saved batch accepts a legacy detail editor route', async () => {
        const sourceUrl = 'https://assets.grok.com/users/example/generated/abababab-bbbb-4ccc-8ddd-eeeeeeeeeeee/image.jpg';
        let submitted = 0;
        window.history.pushState({}, '', '/imagine/saved');
        createSavedBatchCard(sourceUrl, () => {
            window.history.pushState({}, '', '/imagine/post/post-1');
            renderAgentEditor({
                sourceUrl,
                includeAgentAsset: false,
                onSubmit: () => { submitted++; },
                onBack: () => {
                    window.history.pushState({}, '', '/imagine/saved');
                    document.body.innerHTML = '';
                    createSavedBatchCard(sourceUrl);
                }
            });
        });
        retryManager.sleep = jest.fn().mockResolvedValue();

        await retryManager.startPromptedBatchFromGallery('slow camera push in', 1);

        expect(submitted).toBe(1);
        expect(window.location.pathname).toBe('/imagine/saved');
        expect(retryManager.goalCount).toBe(1);
    });

    test('prompted Saved batch stops without injection or submit when its click never leaves Saved', async () => {
        const sourceUrl = 'https://assets.grok.com/users/example/generated/bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee/image.jpg';
        window.history.pushState({}, '', '/imagine/saved');
        const first = createSavedBatchCard(sourceUrl);
        const next = createSavedBatchCard('https://assets.grok.com/users/example/generated/cccccccc-bbbb-4ccc-8ddd-eeeeeeeeeeee/image.jpg');
        const nextClick = jest.fn();
        next.image.addEventListener('click', nextClick);
        primePromptedGalleryBatch(retryManager, { button: first.makeVideo, container: first.card });
        retryManager.waitForPromptedBatchEditorReady = jest.fn().mockResolvedValue({
            status: 'timeout',
            surface: 'saved_gallery'
        });
        retryManager.injectPromptedVideoText = jest.fn().mockReturnValue(true);
        retryManager.clickPromptedVideoSubmitButton = jest.fn().mockReturnValue(true);

        await retryManager.processBatchItemPrompted({ button: first.makeVideo, container: first.card }, retryManager.batchRunToken);

        expect(retryManager.injectPromptedVideoText).not.toHaveBeenCalled();
        expect(retryManager.clickPromptedVideoSubmitButton).not.toHaveBeenCalled();
        expect(retryManager.goalCount).toBe(0);
        expect(nextClick).not.toHaveBeenCalled();
    });

    test('prompted Saved batch stops without injection or submit on an unsupported destination', async () => {
        const sourceUrl = 'https://assets.grok.com/users/example/generated/dddddddd-bbbb-4ccc-8ddd-eeeeeeeeeeee/image.jpg';
        window.history.pushState({}, '', '/imagine/saved');
        const first = createSavedBatchCard(sourceUrl, () => {
            window.history.pushState({}, '', '/imagine');
            document.body.innerHTML = '';
            const back = makeVisible(document.createElement('button'));
            back.setAttribute('aria-label', 'Back');
            back.addEventListener('click', () => {
                window.history.pushState({}, '', '/imagine/saved');
                document.body.innerHTML = '';
                createSavedBatchCard(sourceUrl);
            });
            document.body.appendChild(back);
        });
        const nextClick = addNextCardClickProbe();
        primePromptedGalleryBatch(retryManager, { button: first.makeVideo, container: first.card });
        retryManager.sleep = jest.fn().mockResolvedValue();
        retryManager.injectPromptedVideoText = jest.fn().mockReturnValue(true);
        retryManager.clickPromptedVideoSubmitButton = jest.fn().mockReturnValue(true);

        await retryManager.processBatchItemPrompted({ button: first.makeVideo, container: first.card }, retryManager.batchRunToken);

        expect(retryManager.injectPromptedVideoText).not.toHaveBeenCalled();
        expect(retryManager.clickPromptedVideoSubmitButton).not.toHaveBeenCalled();
        expect(retryManager.goalCount).toBe(0);
        expect(retryManager.batchRunning).toBe(false);
        expect(nextClick).not.toHaveBeenCalled();
    });

    test('prompted Agent batch stops without injection or submit when Make Video is unavailable', async () => {
        const sourceUrl = 'https://assets.grok.com/users/example/generated/eeeeeeee-bbbb-4ccc-8ddd-eeeeeeeeeeee/image.jpg';
        window.history.pushState({}, '', '/imagine/saved');
        const first = createSavedBatchCard(sourceUrl, () => {
            window.history.pushState({}, '', '/imagine/agent/agent-1?conversation=conversation-1');
            renderAgentEditor({
                sourceUrl,
                makeVideo: false,
                onBack: () => {
                    window.history.pushState({}, '', '/imagine/saved');
                    document.body.innerHTML = '';
                    createSavedBatchCard(sourceUrl);
                }
            });
        });
        const nextClick = addNextCardClickProbe();
        primePromptedGalleryBatch(retryManager, { button: first.makeVideo, container: first.card });
        retryManager.sleep = jest.fn().mockResolvedValue();
        retryManager.injectPromptedVideoText = jest.fn().mockReturnValue(true);
        retryManager.clickPromptedVideoSubmitButton = jest.fn().mockReturnValue(true);

        await retryManager.processBatchItemPrompted({ button: first.makeVideo, container: first.card }, retryManager.batchRunToken);

        expect(retryManager.injectPromptedVideoText).not.toHaveBeenCalled();
        expect(retryManager.clickPromptedVideoSubmitButton).not.toHaveBeenCalled();
        expect(retryManager.goalCount).toBe(0);
        expect(retryManager.batchRunning).toBe(false);
        expect(nextClick).not.toHaveBeenCalled();
    });

    test('prompted Agent batch stops without injection or submit when Add Prompt never appears', async () => {
        const sourceUrl = 'https://assets.grok.com/users/example/generated/ffffffff-bbbb-4ccc-8ddd-eeeeeeeeeeee/image.jpg';
        window.history.pushState({}, '', '/imagine/saved');
        const first = createSavedBatchCard(sourceUrl, () => {
            window.history.pushState({}, '', '/imagine/agent/agent-1?conversation=conversation-1');
            renderAgentEditor({
                sourceUrl,
                addPrompt: false,
                onBack: () => {
                    window.history.pushState({}, '', '/imagine/saved');
                    document.body.innerHTML = '';
                    createSavedBatchCard(sourceUrl);
                }
            });
        });
        const nextClick = addNextCardClickProbe();
        primePromptedGalleryBatch(retryManager, { button: first.makeVideo, container: first.card });
        retryManager.sleep = jest.fn().mockResolvedValue();
        retryManager.injectPromptedVideoText = jest.fn().mockReturnValue(true);
        retryManager.clickPromptedVideoSubmitButton = jest.fn().mockReturnValue(true);

        await retryManager.processBatchItemPrompted({ button: first.makeVideo, container: first.card }, retryManager.batchRunToken);

        expect(retryManager.injectPromptedVideoText).not.toHaveBeenCalled();
        expect(retryManager.clickPromptedVideoSubmitButton).not.toHaveBeenCalled();
        expect(retryManager.goalCount).toBe(0);
        expect(retryManager.batchRunning).toBe(false);
        expect(nextClick).not.toHaveBeenCalled();
    });

    test('prompted Agent batch stops without injection or submit when the video composer never appears', async () => {
        const sourceUrl = 'https://assets.grok.com/users/example/generated/11111111-bbbb-4ccc-8ddd-eeeeeeeeeeee/image.jpg';
        window.history.pushState({}, '', '/imagine/saved');
        const first = createSavedBatchCard(sourceUrl, () => {
            window.history.pushState({}, '', '/imagine/agent/agent-1?conversation=conversation-1');
            renderAgentEditor({
                sourceUrl,
                composer: false,
                onBack: () => {
                    window.history.pushState({}, '', '/imagine/saved');
                    document.body.innerHTML = '';
                    createSavedBatchCard(sourceUrl);
                }
            });
        });
        primePromptedGalleryBatch(retryManager, { button: first.makeVideo, container: first.card });
        retryManager.sleep = jest.fn().mockResolvedValue();
        retryManager.injectPromptedVideoText = jest.fn().mockReturnValue(true);
        retryManager.clickPromptedVideoSubmitButton = jest.fn().mockReturnValue(true);

        await retryManager.processBatchItemPrompted({ button: first.makeVideo, container: first.card }, retryManager.batchRunToken);

        expect(retryManager.injectPromptedVideoText).not.toHaveBeenCalled();
        expect(retryManager.clickPromptedVideoSubmitButton).not.toHaveBeenCalled();
        expect(retryManager.goalCount).toBe(0);
        expect(retryManager.batchRunning).toBe(false);
    });

    test('Stop before a Saved card click blocks prompt injection, submit, counter changes, and later cards', async () => {
        const sourceUrl = 'https://assets.grok.com/users/example/generated/22222222-bbbb-4ccc-8ddd-eeeeeeeeeeee/image.jpg';
        window.history.pushState({}, '', '/imagine/saved');
        const first = createSavedBatchCard(sourceUrl);
        const next = createSavedBatchCard('https://assets.grok.com/users/example/generated/33333333-bbbb-4ccc-8ddd-eeeeeeeeeeee/image.jpg');
        const firstClick = jest.fn();
        const nextClick = jest.fn();
        first.image.addEventListener('click', firstClick);
        next.image.addEventListener('click', nextClick);
        primePromptedGalleryBatch(retryManager, { button: first.makeVideo, container: first.card });
        retryManager.stopBatch();
        retryManager.injectPromptedVideoText = jest.fn().mockReturnValue(true);
        retryManager.clickPromptedVideoSubmitButton = jest.fn().mockReturnValue(true);

        await retryManager.processBatchItemPrompted({ button: first.makeVideo, container: first.card }, 'batch-test-token');

        expect(firstClick).not.toHaveBeenCalled();
        expect(retryManager.injectPromptedVideoText).not.toHaveBeenCalled();
        expect(retryManager.clickPromptedVideoSubmitButton).not.toHaveBeenCalled();
        expect(retryManager.goalCount).toBe(0);
        expect(nextClick).not.toHaveBeenCalled();
    });

    test('Stop during the editor-surface wait blocks prompt injection, submit, counter changes, and later cards', async () => {
        const sourceUrl = 'https://assets.grok.com/users/example/generated/44444444-bbbb-4ccc-8ddd-eeeeeeeeeeee/image.jpg';
        window.history.pushState({}, '', '/imagine/saved');
        const first = createSavedBatchCard(sourceUrl);
        const next = createSavedBatchCard('https://assets.grok.com/users/example/generated/55555555-bbbb-4ccc-8ddd-eeeeeeeeeeee/image.jpg');
        const nextClick = jest.fn();
        next.image.addEventListener('click', nextClick);
        primePromptedGalleryBatch(retryManager, { button: first.makeVideo, container: first.card });
        retryManager.sleep = jest.fn().mockImplementation(async () => retryManager.stopBatch());
        retryManager.injectPromptedVideoText = jest.fn().mockReturnValue(true);
        retryManager.clickPromptedVideoSubmitButton = jest.fn().mockReturnValue(true);

        await retryManager.processBatchItemPrompted({ button: first.makeVideo, container: first.card }, retryManager.batchRunToken);

        expect(retryManager.injectPromptedVideoText).not.toHaveBeenCalled();
        expect(retryManager.clickPromptedVideoSubmitButton).not.toHaveBeenCalled();
        expect(retryManager.goalCount).toBe(0);
        expect(nextClick).not.toHaveBeenCalled();
    });

    test('Stop after Add Prompt blocks prompt injection, submit, counter changes, and later cards', async () => {
        const sourceUrl = 'https://assets.grok.com/users/example/generated/66666666-bbbb-4ccc-8ddd-eeeeeeeeeeee/image.jpg';
        window.history.pushState({}, '', '/imagine/saved');
        const first = createSavedBatchCard(sourceUrl, () => {
            window.history.pushState({}, '', '/imagine/agent/agent-1?conversation=conversation-1');
            document.body.innerHTML = `<div class="react-flow__node-asset"><img src="${sourceUrl}"></div>`;
            const makeVideo = makeVisible(document.createElement('button'));
            makeVideo.setAttribute('aria-label', 'Make Video');
            makeVideo.setAttribute('aria-haspopup', 'menu');
            makeVideo.addEventListener('click', () => {
                const menu = makeVisible(document.createElement('div'));
                menu.appendChild(createMenuItem('Add Prompt', () => retryManager.stopBatch()));
                openLinkedMenu(makeVideo, menu);
            });
            document.body.appendChild(makeVideo);
        });
        const nextClick = addNextCardClickProbe();
        primePromptedGalleryBatch(retryManager, { button: first.makeVideo, container: first.card });
        retryManager.sleep = jest.fn().mockResolvedValue();
        retryManager.injectPromptedVideoText = jest.fn().mockReturnValue(true);
        retryManager.clickPromptedVideoSubmitButton = jest.fn().mockReturnValue(true);

        await retryManager.processBatchItemPrompted({ button: first.makeVideo, container: first.card }, retryManager.batchRunToken);

        expect(retryManager.injectPromptedVideoText).not.toHaveBeenCalled();
        expect(retryManager.clickPromptedVideoSubmitButton).not.toHaveBeenCalled();
        expect(retryManager.goalCount).toBe(0);
        expect(nextClick).not.toHaveBeenCalled();
    });

    test('Stop before submit blocks submit, counter changes, and later cards after writing the prompt', async () => {
        const sourceUrl = 'https://assets.grok.com/users/example/generated/77777777-bbbb-4ccc-8ddd-eeeeeeeeeeee/image.jpg';
        window.history.pushState({}, '', '/imagine/saved');
        const first = createSavedBatchCard(sourceUrl, () => {
            window.history.pushState({}, '', '/imagine/agent/agent-1?conversation=conversation-1');
            renderAgentEditor({ sourceUrl });
        });
        const nextClick = addNextCardClickProbe();
        primePromptedGalleryBatch(retryManager, { button: first.makeVideo, container: first.card });
        retryManager.injectPromptedVideoText = jest.fn(() => {
            retryManager.stopBatch();
            return true;
        });
        retryManager.clickPromptedVideoSubmitButton = jest.fn().mockReturnValue(true);

        await retryManager.processBatchItemPrompted({ button: first.makeVideo, container: first.card }, retryManager.batchRunToken);

        expect(retryManager.injectPromptedVideoText).toHaveBeenCalledWith('slow camera push in');
        expect(retryManager.clickPromptedVideoSubmitButton).not.toHaveBeenCalled();
        expect(retryManager.goalCount).toBe(0);
        expect(nextClick).not.toHaveBeenCalled();
    });

    test('Stop during return does not resubmit or advance after an accepted submission', async () => {
        const sourceUrl = 'https://assets.grok.com/users/example/generated/88888888-bbbb-4ccc-8ddd-eeeeeeeeeeee/image.jpg';
        window.history.pushState({}, '', '/imagine/saved');
        const first = createSavedBatchCard(sourceUrl, () => {
            window.history.pushState({}, '', '/imagine/agent/agent-1?conversation=conversation-1');
            renderAgentEditor({
                sourceUrl,
                onBack: () => retryManager.stopBatch()
            });
        });
        const nextClick = addNextCardClickProbe();
        primePromptedGalleryBatch(retryManager, { button: first.makeVideo, container: first.card });
        const submitSpy = jest.spyOn(retryManager, 'clickPromptedVideoSubmitButton').mockImplementation(() => {
            const submit = document.querySelector('button[aria-label="Make video"]');
            retryManager.simulateClick(submit);
            return true;
        });
        const recoverSpy = jest.spyOn(retryManager, 'navigateToPromptedBatchGallery').mockImplementation(() => {});

        await retryManager.processBatchItemPrompted({ button: first.makeVideo, container: first.card }, retryManager.batchRunToken);

        expect(submitSpy).toHaveBeenCalledTimes(1);
        expect(retryManager.goalCount).toBe(0);
        expect(recoverSpy).not.toHaveBeenCalled();
        expect(nextClick).not.toHaveBeenCalled();
    });

    test('a return timeout recovers the captured Saved URL, stops the batch, and does not advance', async () => {
        const sourceUrl = 'https://assets.grok.com/users/example/generated/99999999-bbbb-4ccc-8ddd-eeeeeeeeeeee/image.jpg';
        window.history.pushState({}, '', '/imagine/saved');
        const first = createSavedBatchCard(sourceUrl, () => {
            window.history.pushState({}, '', '/imagine/agent/agent-1?conversation=conversation-1');
            renderAgentEditor({ sourceUrl });
        });
        const nextClick = addNextCardClickProbe();
        primePromptedGalleryBatch(retryManager, { button: first.makeVideo, container: first.card });
        retryManager.waitForPromptedBatchSavedSurface = jest.fn().mockResolvedValue(false);
        jest.spyOn(window.history, 'back').mockImplementation(() => {});
        retryManager.injectPromptedVideoText = jest.fn().mockReturnValue(true);
        retryManager.clickPromptedVideoSubmitButton = jest.fn().mockReturnValue(true);
        const recoverSpy = jest.spyOn(retryManager, 'navigateToPromptedBatchGallery').mockImplementation(() => {});

        await retryManager.processBatchItemPrompted({ button: first.makeVideo, container: first.card }, retryManager.batchRunToken);

        expect(recoverSpy).toHaveBeenCalledWith('http://localhost/imagine/saved');
        expect(retryManager.batchRunning).toBe(false);
        expect(retryManager.goalCount).toBe(0);
        expect(mockOverlay.setStatus).toHaveBeenCalledWith(expect.stringContaining('could not return to Saved'), 'warning');
        expect(nextClick).not.toHaveBeenCalled();
    });

    test('ignores a hidden Back control and waits for delayed Saved DOM before restoring state', async () => {
        const sourceUrl = 'https://assets.grok.com/users/example/generated/05050505-bbbb-4ccc-8ddd-eeeeeeeeeeee/image.jpg';
        const token = 'batch-return-token';
        const snapshot = {
            galleryUrl: 'http://localhost/imagine/saved',
            sourceId: '05050505-bbbb-4ccc-8ddd-eeeeeeeeeeee',
            scrollY: 420
        };
        let now = 0;
        let historyReturned = false;
        let savedPolls = 0;
        const sequence = [];
        window.history.pushState({}, '', '/imagine/agent/agent-return?conversation=conversation-return');
        document.body.innerHTML = '';
        const hiddenBack = document.createElement('button');
        hiddenBack.setAttribute('aria-label', 'Back');
        hiddenBack.style.display = 'none';
        hiddenBack.click = jest.fn();
        document.body.appendChild(hiddenBack);
        retryManager.batchRunning = true;
        retryManager.batchAborted = false;
        retryManager.batchRunToken = token;
        retryManager.batchMode = 'prompted';
        retryManager.batchContext = 'gallery';
        retryManager.batchProcessedSrcs = new Set();
        window.scrollTo = jest.fn(() => sequence.push('scroll'));
        jest.spyOn(Date, 'now').mockImplementation(() => now);
        const historyBack = jest.spyOn(window.history, 'back').mockImplementation(() => {
            historyReturned = true;
            window.history.pushState({}, '', '/imagine/saved');
        });
        retryManager.sleep = jest.fn().mockImplementation(async () => {
            now += 200;
            if (!historyReturned) return;
            savedPolls++;
            if (savedPolls === 2) {
                document.body.innerHTML = '';
                createSavedBatchCard(sourceUrl);
                sequence.push('saved-dom');
            }
        });

        await expect(retryManager.batchGoBack(snapshot, token)).resolves.toBe('returned');

        expect(hiddenBack.click).not.toHaveBeenCalled();
        expect(historyBack).toHaveBeenCalledTimes(1);
        expect(savedPolls).toBe(2);
        expect(sequence).toEqual(['saved-dom', 'scroll']);
        expect(retryManager.batchQueue).toHaveLength(1);
    });

    test('selectMakeVideoMode opens the current Make Video menu and chooses Add Prompt', async () => {
        const queryBar = document.createElement('div');
        queryBar.className = 'query-bar';

        const editSubmit = makeVisible(document.createElement('button'));
        editSubmit.setAttribute('aria-label', 'Edit');
        editSubmit.click = jest.fn();
        queryBar.appendChild(editSubmit);

        const makeVideoTrigger = makeVisible(document.createElement('button'), { width: 160, right: 160 });
        makeVideoTrigger.setAttribute('aria-label', 'Make Video');
        makeVideoTrigger.setAttribute('aria-haspopup', 'menu');
        makeVideoTrigger.addEventListener('click', () => {
            const menu = makeVisible(document.createElement('div'));
            const addPromptItem = createMenuItem('Add Prompt', () => {
                editSubmit.remove();
                mountFocusedPromptedVideoComposer({ root: queryBar });
                addPromptItem.remove();
            });
            menu.appendChild(addPromptItem);
            openLinkedMenu(makeVideoTrigger, menu);
        });

        document.body.append(makeVideoTrigger, queryBar);
        retryManager.sleep = jest.fn().mockResolvedValue();
        retryManager.simulateClick = jest.fn((element) => element.click());

        await expect(retryManager.selectMakeVideoMode()).resolves.toBe(true);

        expect(retryManager.simulateClick).toHaveBeenCalledWith(makeVideoTrigger);
        expect(retryManager.simulateClick).toHaveBeenCalledWith(expect.objectContaining({ textContent: 'Add Prompt' }));
        expect(editSubmit.click).not.toHaveBeenCalled();
    });

    test('selected linked menu and focused composer ignore remounted retained decoys', async () => {
        let decoyMenuClicks = 0;
        let decoySubmitClicks = 0;
        const decoyInputs = [];
        let decoyMenu = null;
        let decoyComposer = null;
        const mountDecoyMenu = () => {
            decoyMenu?.remove();
            decoyMenu = makeVisible(document.createElement('div'));
            decoyMenu.setAttribute('role', 'menu');
            decoyMenu.appendChild(createMenuItem('Add Prompt', () => { decoyMenuClicks++; }));
            document.body.appendChild(decoyMenu);
        };
        const mountDecoyComposer = () => {
            decoyComposer?.remove();
            decoyComposer = document.createElement('div');
            decoyComposer.className = 'query-bar';
            const input = document.createElement('div');
            input.setAttribute('contenteditable', 'true');
            input.setAttribute('role', 'textbox');
            input.setAttribute('aria-label', 'Ask Grok anything');
            const submit = makeVisible(document.createElement('button'));
            submit.setAttribute('aria-label', 'Make video');
            submit.addEventListener('click', () => { decoySubmitClicks++; });
            decoyComposer.append(input, submit);
            decoyInputs.push(input);
            document.body.appendChild(decoyComposer);
        };
        mountDecoyMenu();
        mountDecoyComposer();

        const selectedTrigger = makeVisible(document.createElement('button'), { width: 160, right: 160 });
        selectedTrigger.setAttribute('aria-label', 'Make Video');
        selectedTrigger.setAttribute('aria-haspopup', 'menu');
        const selectedMenu = makeVisible(document.createElement('div'));
        let selectedTriggerClicks = 0;
        let selectedMenuClicks = 0;
        let selectedSubmitClicks = 0;
        let selectedInput = null;
        selectedTrigger.addEventListener('click', () => {
            selectedTriggerClicks++;
            mountDecoyMenu();
            openLinkedMenu(selectedTrigger, selectedMenu);
        });

        document.body.appendChild(selectedTrigger);
        retryManager.sleep = jest.fn().mockImplementation(async () => {
            if (selectedMenu.querySelector('[role="menuitem"]')) return;
            const selectedAddPrompt = createMenuItem('Add Prompt', () => {
                selectedMenuClicks++;
                mountDecoyComposer();
                const selected = mountFocusedPromptedVideoComposer({
                    onSubmit: () => { selectedSubmitClicks++; }
                });
                selectedInput = selected.input;
            });
            selectedMenu.appendChild(selectedAddPrompt);
        });
        retryManager.simulateClick = jest.fn((element) => element.click());

        await expect(retryManager.selectMakeVideoMode(undefined, selectedTrigger)).resolves.toBe(true);
        expect(retryManager.injectPromptedVideoText('selected prompt')).toBe(true);
        expect(retryManager.clickPromptedVideoSubmitButton()).toBe(true);

        expect(decoyMenuClicks).toBe(0);
        expect(decoyInputs.map((input) => input.textContent)).toEqual(['', '']);
        expect(decoySubmitClicks).toBe(0);
        expect(selectedTriggerClicks).toBe(1);
        expect(selectedMenuClicks).toBe(1);
        expect(selectedInput.textContent).toBe('selected prompt');
        expect(selectedSubmitClicks).toBe(1);
    });

    test('delayed selected focus wins over a verified decoy focused before Add Prompt', async () => {
        let decoySubmitClicks = 0;
        const decoy = mountFocusedPromptedVideoComposer({
            onSubmit: () => { decoySubmitClicks++; }
        });
        const selectedTrigger = makeVisible(document.createElement('button'), { width: 160, right: 160 });
        selectedTrigger.setAttribute('aria-label', 'Make Video');
        selectedTrigger.setAttribute('aria-haspopup', 'menu');
        const menu = makeVisible(document.createElement('div'));
        let addPromptClicked = false;
        let selectedInput = null;
        let selectedSubmitClicks = 0;
        menu.appendChild(createMenuItem('Add Prompt', () => {
            addPromptClicked = true;
            const composer = document.createElement('div');
            composer.className = 'query-bar';
            selectedInput = document.createElement('div');
            selectedInput.setAttribute('contenteditable', 'true');
            selectedInput.setAttribute('role', 'textbox');
            selectedInput.setAttribute('aria-label', 'Ask Grok anything');
            selectedInput.tabIndex = -1;
            const submit = makeVisible(document.createElement('button'));
            submit.setAttribute('aria-label', 'Make video');
            submit.addEventListener('click', () => { selectedSubmitClicks++; });
            composer.append(selectedInput, submit);
            document.body.appendChild(composer);
        }));
        selectedTrigger.addEventListener('click', () => openLinkedMenu(selectedTrigger, menu));
        document.body.appendChild(selectedTrigger);
        retryManager.sleep = jest.fn().mockImplementation(async () => {
            if (addPromptClicked && document.activeElement !== selectedInput) selectedInput.focus();
        });
        retryManager.simulateClick = jest.fn((element) => element.click());

        await expect(retryManager.selectMakeVideoMode(undefined, selectedTrigger)).resolves.toBe(true);
        expect(retryManager.injectPromptedVideoText('selected after delayed focus')).toBe(true);
        expect(retryManager.clickPromptedVideoSubmitButton()).toBe(true);

        expect(decoy.input.textContent).toBe('');
        expect(decoySubmitClicks).toBe(0);
        expect(selectedInput.textContent).toBe('selected after delayed focus');
        expect(selectedSubmitClicks).toBe(1);
    });

    test('multiple distinct post-click focused composers fail closed without write or submit', async () => {
        const originalDecoy = mountFocusedPromptedVideoComposer();
        const selectedTrigger = makeVisible(document.createElement('button'), { width: 160, right: 160 });
        selectedTrigger.setAttribute('aria-label', 'Make Video');
        selectedTrigger.setAttribute('aria-haspopup', 'menu');
        const menu = makeVisible(document.createElement('div'));
        let addPromptClicked = false;
        let remountedDecoy = null;
        let decoySubmitClicks = 0;
        let selectedInput = null;
        let selectedSubmitClicks = 0;
        menu.appendChild(createMenuItem('Add Prompt', () => {
            addPromptClicked = true;
            originalDecoy.composer.remove();
            remountedDecoy = mountFocusedPromptedVideoComposer({
                onSubmit: () => { decoySubmitClicks++; }
            });
            const selectedComposer = document.createElement('div');
            selectedComposer.className = 'query-bar';
            selectedInput = document.createElement('div');
            selectedInput.setAttribute('contenteditable', 'true');
            selectedInput.setAttribute('role', 'textbox');
            selectedInput.setAttribute('aria-label', 'Ask Grok anything');
            selectedInput.tabIndex = -1;
            const selectedSubmit = makeVisible(document.createElement('button'));
            selectedSubmit.setAttribute('aria-label', 'Make video');
            selectedSubmit.addEventListener('click', () => { selectedSubmitClicks++; });
            selectedComposer.append(selectedInput, selectedSubmit);
            document.body.appendChild(selectedComposer);
        }));
        selectedTrigger.addEventListener('click', () => openLinkedMenu(selectedTrigger, menu));
        document.body.appendChild(selectedTrigger);
        retryManager.sleep = jest.fn().mockImplementation(async () => {
            if (addPromptClicked && document.activeElement !== selectedInput) selectedInput.focus();
        });
        retryManager.simulateClick = jest.fn((element) => element.click());

        const selected = await retryManager.selectMakeVideoMode(undefined, selectedTrigger);
        if (selected) {
            retryManager.injectPromptedVideoText('must not be written');
            retryManager.clickPromptedVideoSubmitButton();
        }

        expect(selected).toBe(false);
        expect(remountedDecoy.input.textContent).toBe('');
        expect(decoySubmitClicks).toBe(0);
        expect(selectedInput.textContent).toBe('');
        expect(selectedSubmitClicks).toBe(0);
        expect(retryManager.promptedVideoComposerRoot).toBeNull();
    });

    test('Stop during focus confirmation prevents retention, prompt write, and submit', async () => {
        window.history.pushState({}, '', '/imagine/agent/focus-stop?conversation=focus-stop');
        const selectedTrigger = makeVisible(document.createElement('button'), { width: 160, right: 160 });
        selectedTrigger.setAttribute('aria-label', 'Make Video');
        selectedTrigger.setAttribute('aria-haspopup', 'menu');
        const menu = makeVisible(document.createElement('div'));
        let addPromptClicked = false;
        let focusConfirmationSleeps = 0;
        menu.appendChild(createMenuItem('Add Prompt', () => {
            addPromptClicked = true;
            mountFocusedPromptedVideoComposer();
        }));
        selectedTrigger.addEventListener('click', () => openLinkedMenu(selectedTrigger, menu));
        document.body.appendChild(selectedTrigger);
        retryManager.sleep = jest.fn().mockImplementation(async () => {
            if (!addPromptClicked) return;
            focusConfirmationSleeps++;
            retryManager.stopBatch();
        });
        const injectSpy = jest.spyOn(retryManager, 'injectPromptedVideoText');
        const submitSpy = jest.spyOn(retryManager, 'clickPromptedVideoSubmitButton');

        await retryManager.startPromptedBatchFromDetail('cancel during focus confirmation', 1);

        expect(focusConfirmationSleeps).toBe(1);
        expect(injectSpy).not.toHaveBeenCalled();
        expect(submitSpy).not.toHaveBeenCalled();
        expect(retryManager.promptedVideoComposerRoot).toBeNull();
        expect(retryManager.goalCount).toBe(0);
    });

    test('current menu mode fails closed when the selected trigger opens multiple new Add Prompt items', async () => {
        const selectedTrigger = makeVisible(document.createElement('button'), { width: 160, right: 160 });
        selectedTrigger.setAttribute('aria-label', 'Make Video');
        selectedTrigger.setAttribute('aria-haspopup', 'menu');
        const menuClicks = [0, 0];
        selectedTrigger.addEventListener('click', () => {
            const menu = makeVisible(document.createElement('div'));
            const items = menuClicks.map((_, index) => {
                return createMenuItem('Add Prompt', () => { menuClicks[index]++; });
            });
            menu.append(...items);
            openLinkedMenu(selectedTrigger, menu);
        });
        document.body.appendChild(selectedTrigger);
        retryManager.sleep = jest.fn().mockResolvedValue();
        retryManager.simulateClick = jest.fn((element) => element.click());

        await expect(retryManager.selectMakeVideoMode(undefined, selectedTrigger)).resolves.toBe(false);

        expect(menuClicks).toEqual([0, 0]);
        expect(retryManager.promptedVideoComposerRoot).toBeNull();
    });

    test('linked menu fails closed when a second exact Add Prompt arrives during confirmation', async () => {
        const selectedTrigger = makeVisible(document.createElement('button'), { width: 160, right: 160 });
        selectedTrigger.setAttribute('aria-label', 'Make Video');
        selectedTrigger.setAttribute('aria-haspopup', 'menu');
        const menu = makeVisible(document.createElement('div'));
        const menuClicks = [0, 0];
        selectedTrigger.addEventListener('click', () => {
            const first = createMenuItem('Add Prompt', () => {
                menuClicks[0]++;
                mountFocusedPromptedVideoComposer();
            });
            menu.appendChild(first);
            openLinkedMenu(selectedTrigger, menu);
        });
        document.body.appendChild(selectedTrigger);
        retryManager.sleep = jest.fn().mockImplementation(async () => {
            if (menu.querySelectorAll('[role="menuitem"]').length > 1) return;
            menu.appendChild(createMenuItem('Add Prompt', () => { menuClicks[1]++; }));
        });
        retryManager.simulateClick = jest.fn((element) => element.click());

        await expect(retryManager.selectMakeVideoMode(undefined, selectedTrigger)).resolves.toBe(false);

        expect(retryManager.sleep).toHaveBeenCalled();
        expect(menuClicks).toEqual([0, 0]);
        expect(retryManager.promptedVideoComposerRoot).toBeNull();
    });

    test('linked menu accepts a pre-existing Add Prompt that becomes visible when opened', async () => {
        const selectedTrigger = makeVisible(document.createElement('button'), { width: 160, right: 160 });
        selectedTrigger.setAttribute('aria-label', 'Make Video');
        selectedTrigger.setAttribute('aria-haspopup', 'menu');
        const menu = makeVisible(document.createElement('div'));
        menu.style.display = 'none';
        let menuClicks = 0;
        const addPrompt = createMenuItem('Add Prompt', () => {
            menuClicks++;
            mountFocusedPromptedVideoComposer();
        });
        addPrompt.style.display = 'none';
        menu.appendChild(addPrompt);
        document.body.append(menu, selectedTrigger);
        selectedTrigger.addEventListener('click', () => {
            menu.style.display = '';
            addPrompt.style.display = '';
            openLinkedMenu(selectedTrigger, menu);
        });
        retryManager.sleep = jest.fn().mockResolvedValue();
        retryManager.simulateClick = jest.fn((element) => element.click());

        await expect(retryManager.selectMakeVideoMode(undefined, selectedTrigger)).resolves.toBe(true);

        expect(menuClicks).toBe(1);
        expect(retryManager.promptedVideoComposerRoot).not.toBeNull();
    });

    test.each([
        ['missing aria-controls', (trigger) => trigger.removeAttribute('aria-controls')],
        ['broken aria-controls', (trigger) => trigger.setAttribute('aria-controls', 'missing-menu')],
        ['missing aria-labelledby', (_trigger, menu) => menu.removeAttribute('aria-labelledby')],
        ['broken aria-labelledby', (_trigger, menu) => menu.setAttribute('aria-labelledby', 'other-trigger')]
    ])('current menu mode fails closed for %s', async (_label, breakLink) => {
        const selectedTrigger = makeVisible(document.createElement('button'), { width: 160, right: 160 });
        selectedTrigger.setAttribute('aria-label', 'Make Video');
        selectedTrigger.setAttribute('aria-haspopup', 'menu');
        const menu = makeVisible(document.createElement('div'));
        let menuClicks = 0;
        menu.appendChild(createMenuItem('Add Prompt', () => {
            menuClicks++;
            mountFocusedPromptedVideoComposer();
        }));
        selectedTrigger.addEventListener('click', () => {
            openLinkedMenu(selectedTrigger, menu);
            breakLink(selectedTrigger, menu);
        });
        document.body.appendChild(selectedTrigger);
        retryManager.sleep = jest.fn().mockResolvedValue();
        retryManager.simulateClick = jest.fn((element) => element.click());

        await expect(retryManager.selectMakeVideoMode(undefined, selectedTrigger)).resolves.toBe(false);

        expect(menuClicks).toBe(0);
        expect(retryManager.promptedVideoComposerRoot).toBeNull();
    });

    test('focused readiness accepts a pre-existing hidden unverified composer after it becomes ready', async () => {
        const selectedComposer = document.createElement('div');
        selectedComposer.className = 'query-bar';
        selectedComposer.style.display = 'none';
        const selectedTrigger = makeVisible(document.createElement('button'), { width: 160, right: 160 });
        selectedTrigger.setAttribute('aria-label', 'Make Video');
        selectedTrigger.setAttribute('aria-haspopup', 'menu');
        const menu = makeVisible(document.createElement('div'));
        let menuClicks = 0;
        let selectedInput = null;
        let selectedSubmitClicks = 0;
        menu.appendChild(createMenuItem('Add Prompt', () => {
            menuClicks++;
            const selected = mountFocusedPromptedVideoComposer({
                root: selectedComposer,
                onSubmit: () => { selectedSubmitClicks++; }
            });
            selectedInput = selected.input;
        }));
        selectedTrigger.addEventListener('click', () => openLinkedMenu(selectedTrigger, menu));
        document.body.append(selectedComposer, selectedTrigger);
        retryManager.sleep = jest.fn().mockResolvedValue();
        retryManager.simulateClick = jest.fn((element) => element.click());

        await expect(retryManager.selectMakeVideoMode(undefined, selectedTrigger)).resolves.toBe(true);
        expect(retryManager.injectPromptedVideoText('pre-existing composer prompt')).toBe(true);
        expect(retryManager.clickPromptedVideoSubmitButton()).toBe(true);

        expect(menuClicks).toBe(1);
        expect(retryManager.promptedVideoComposerRoot).toBe(selectedComposer);
        expect(selectedInput.textContent).toBe('pre-existing composer prompt');
        expect(selectedSubmitClicks).toBe(1);
    });

    test('focused composer fails closed with multiple exact prompted-video inputs', async () => {
        const selectedTrigger = makeVisible(document.createElement('button'), { width: 160, right: 160 });
        selectedTrigger.setAttribute('aria-label', 'Make Video');
        selectedTrigger.setAttribute('aria-haspopup', 'menu');
        const menu = makeVisible(document.createElement('div'));
        let menuClicks = 0;
        let submitClicks = 0;
        menu.appendChild(createMenuItem('Add Prompt', () => {
            menuClicks++;
            const composer = document.createElement('div');
            composer.className = 'query-bar';
            const inputs = [0, 1].map(() => {
                const input = document.createElement('div');
                input.setAttribute('contenteditable', 'true');
                input.setAttribute('role', 'textbox');
                input.setAttribute('aria-label', 'Ask Grok anything');
                input.tabIndex = -1;
                return input;
            });
            const submit = makeVisible(document.createElement('button'));
            submit.setAttribute('aria-label', 'Make video');
            submit.addEventListener('click', () => { submitClicks++; });
            composer.append(...inputs, submit);
            document.body.appendChild(composer);
            inputs[0].focus();
        }));
        selectedTrigger.addEventListener('click', () => openLinkedMenu(selectedTrigger, menu));
        document.body.appendChild(selectedTrigger);
        retryManager.sleep = jest.fn().mockResolvedValue();
        retryManager.simulateClick = jest.fn((element) => element.click());

        await expect(retryManager.selectMakeVideoMode(undefined, selectedTrigger)).resolves.toBe(false);

        expect(menuClicks).toBe(1);
        expect(submitClicks).toBe(0);
        expect(retryManager.promptedVideoComposerRoot).toBeNull();
    });

    test('focused composer fails closed with multiple actionable Make video submits', async () => {
        const selectedTrigger = makeVisible(document.createElement('button'), { width: 160, right: 160 });
        selectedTrigger.setAttribute('aria-label', 'Make Video');
        selectedTrigger.setAttribute('aria-haspopup', 'menu');
        const menu = makeVisible(document.createElement('div'));
        let menuClicks = 0;
        let submitClicks = 0;
        menu.appendChild(createMenuItem('Add Prompt', () => {
            menuClicks++;
            const composer = document.createElement('div');
            composer.className = 'query-bar';
            const input = document.createElement('div');
            input.setAttribute('contenteditable', 'true');
            input.setAttribute('role', 'textbox');
            input.setAttribute('aria-label', 'Ask Grok anything');
            input.tabIndex = -1;
            const submits = [0, 1].map(() => {
                const submit = makeVisible(document.createElement('button'));
                submit.setAttribute('aria-label', 'Make video');
                submit.addEventListener('click', () => { submitClicks++; });
                return submit;
            });
            composer.append(input, ...submits);
            document.body.appendChild(composer);
            input.focus();
        }));
        selectedTrigger.addEventListener('click', () => openLinkedMenu(selectedTrigger, menu));
        document.body.appendChild(selectedTrigger);
        retryManager.sleep = jest.fn().mockResolvedValue();
        retryManager.simulateClick = jest.fn((element) => element.click());

        await expect(retryManager.selectMakeVideoMode(undefined, selectedTrigger)).resolves.toBe(false);

        expect(menuClicks).toBe(1);
        expect(submitClicks).toBe(0);
        expect(retryManager.promptedVideoComposerRoot).toBeNull();
    });

    test('prompted detail batch writes and submits only the Add Prompt video composer', async () => {
        window.history.pushState({}, '', '/imagine/agent/agent-1?conversation=conversation-1');
        const preciseEditComposer = document.createElement('div');
        const preciseEditor = document.createElement('div');
        preciseEditor.setAttribute('contenteditable', 'true');
        preciseEditor.setAttribute('role', 'textbox');
        preciseEditor.setAttribute('aria-label', 'Ask Grok anything');
        const preciseEditSubmit = makeVisible(document.createElement('button'));
        preciseEditSubmit.setAttribute('aria-label', 'Edit');
        let preciseEditClicks = 0;
        preciseEditSubmit.addEventListener('click', () => { preciseEditClicks++; });
        preciseEditComposer.append(preciseEditor, preciseEditSubmit);

        const makeVideoTrigger = makeVisible(document.createElement('button'), { width: 160, right: 160 });
        makeVideoTrigger.setAttribute('aria-label', 'Make Video');
        makeVideoTrigger.setAttribute('aria-haspopup', 'menu');
        const menuClicks = { addPrompt: 0, spicy: 0, quickAnimate: 0 };
        let videoEditor;
        let videoSubmitClicks = 0;
        let settingClicks = 0;
        makeVideoTrigger.addEventListener('click', () => {
            const menu = makeVisible(document.createElement('div'));
            const addPrompt = createMenuItem('Add Prompt', () => {
                menuClicks.addPrompt++;
                const videoComposer = document.createElement('div');
                const settings = ['480p', '720p', '1080p', '6s', '10s', '15s', 'Audio']
                    .map((label) => {
                        const setting = makeVisible(document.createElement('button'));
                        setting.textContent = label;
                        setting.addEventListener('click', () => { settingClicks++; });
                        return setting;
                    });
                const mounted = mountFocusedPromptedVideoComposer({
                    root: videoComposer,
                    onSubmit: () => { videoSubmitClicks++; }
                });
                videoEditor = mounted.input;
                mounted.submit.before(...settings);
                addPrompt.remove();
            });

            const spicy = createMenuItem('Spicy', () => { menuClicks.spicy++; });
            const quickAnimate = createMenuItem('Quick Animate', () => { menuClicks.quickAnimate++; });
            menu.append(addPrompt, spicy, quickAnimate);
            openLinkedMenu(makeVideoTrigger, menu);
        });
        document.body.append(preciseEditComposer, makeVideoTrigger);

        const bridgeHandler = (event) => {
            const target = event.type === '__gpt_set_prompted_video_content'
                ? document.querySelector(`[data-gpt-prompt-target="${event.detail.marker}"]`)
                : document.querySelector('[contenteditable="true"]');
            if (target) target.textContent = event.detail.text;
            if (event.type === '__gpt_set_prompted_video_content') {
                document.dispatchEvent(new CustomEvent('__gpt_set_prompted_video_content_result', {
                    detail: { marker: event.detail.marker, ok: !!target }
                }));
            }
        };
        document.addEventListener('__gpt_set_editor_content', bridgeHandler);
        document.addEventListener('__gpt_set_prompted_video_content', bridgeHandler);
        retryManager.awaitBatchItemCompletion = jest.fn().mockResolvedValue('success');

        try {
            await retryManager.startPromptedBatchFromDetail('scoped video prompt', 1);
        } finally {
            document.removeEventListener('__gpt_set_editor_content', bridgeHandler);
            document.removeEventListener('__gpt_set_prompted_video_content', bridgeHandler);
        }

        expect(menuClicks).toEqual({ addPrompt: 1, spicy: 0, quickAnimate: 0 });
        expect(preciseEditor.textContent).toBe('');
        expect(videoEditor.textContent).toBe('scoped video prompt');
        expect(preciseEditClicks).toBe(0);
        expect(videoSubmitClicks).toBe(1);
        expect(settingClicks).toBe(0);
        expect(videoEditor.hasAttribute('data-gpt-prompt-target')).toBe(false);
        expect(retryManager.promptedVideoComposerRoot).toBeNull();
    });

    test.each(['Video', 'Settings'])('waits for a delayed legacy %s composer before injecting and submitting', async (modeLabel) => {
        let promptedText = null;
        let submitted = 0;
        window.history.pushState({}, '', '/imagine/post/legacy-delayed-composer');
        const videoMode = makeVisible(document.createElement('button'));
        videoMode.setAttribute('aria-label', modeLabel);
        const videoModeClick = jest.fn();
        videoMode.addEventListener('click', videoModeClick);
        document.body.appendChild(videoMode);
        const promptListener = (event) => {
            promptedText = event.detail.text;
            const input = document.querySelector(`[data-gpt-prompt-target="${event.detail.marker}"]`);
            if (input) input.textContent = event.detail.text;
            document.dispatchEvent(new CustomEvent('__gpt_set_prompted_video_content_result', {
                detail: { marker: event.detail.marker, ok: !!input }
            }));
        };
        document.addEventListener('__gpt_set_prompted_video_content', promptListener);
        retryManager.sleep = jest.fn().mockImplementation(async () => {
            if (document.querySelector('[contenteditable="true"]')) return;
            const queryBar = document.createElement('div');
            queryBar.className = 'query-bar';
            const input = document.createElement('div');
            input.setAttribute('contenteditable', 'true');
            input.setAttribute('role', 'textbox');
            input.setAttribute('aria-label', 'Ask Grok anything');
            const submit = makeVisible(document.createElement('button'));
            submit.setAttribute('aria-label', 'Make video');
            submit.addEventListener('click', () => { submitted++; });
            queryBar.append(input, submit);
            document.body.appendChild(queryBar);
        });
        retryManager.awaitBatchItemCompletion = jest.fn().mockResolvedValue('success');

        await retryManager.startPromptedBatchFromDetail('legacy prompt', 1);
        document.removeEventListener('__gpt_set_prompted_video_content', promptListener);

        expect(videoModeClick).toHaveBeenCalledTimes(1);
        expect(retryManager.sleep).toHaveBeenCalled();
        expect(promptedText).toBe('legacy prompt');
        expect(submitted).toBe(1);
        expect(retryManager.goalCount).toBe(1);
    });

    test('submits only the retained visible enabled Make video button in a verified composer', async () => {
        const disabledComposer = document.createElement('div');
        disabledComposer.className = 'query-bar';
        const disabledInput = document.createElement('div');
        disabledInput.setAttribute('contenteditable', 'true');
        disabledInput.setAttribute('role', 'textbox');
        disabledInput.setAttribute('aria-label', 'Ask Grok anything');
        const disabledSubmit = makeVisible(document.createElement('button'));
        disabledSubmit.setAttribute('aria-label', 'Make video');
        disabledSubmit.disabled = true;
        disabledComposer.append(disabledInput, disabledSubmit);

        const verifiedComposer = document.createElement('div');
        verifiedComposer.className = 'query-bar';
        const verifiedInput = document.createElement('div');
        verifiedInput.setAttribute('contenteditable', 'true');
        verifiedInput.setAttribute('role', 'textbox');
        verifiedInput.setAttribute('aria-label', 'Ask Grok anything');
        const verifiedSubmit = makeVisible(document.createElement('button'));
        verifiedSubmit.setAttribute('aria-label', 'Make video');
        let verifiedSubmitClicks = 0;
        verifiedSubmit.addEventListener('click', () => { verifiedSubmitClicks++; });
        verifiedComposer.append(verifiedInput, verifiedSubmit);

        const unrelatedSubmit = makeVisible(document.createElement('button'));
        unrelatedSubmit.setAttribute('aria-label', 'Make video');
        document.body.append(disabledComposer, unrelatedSubmit, verifiedComposer);
        retryManager.sleep = jest.fn().mockResolvedValue();

        await expect(retryManager._waitForLegacyPromptedVideoSubmitButton()).resolves.toBe(verifiedSubmit);
        expect(retryManager.promptedVideoComposerRoot).toBe(verifiedComposer);
        expect(retryManager.clickPromptedVideoSubmitButton()).toBe(true);
        expect(verifiedSubmitClicks).toBe(1);
    });

    test('prompted video submit never falls back to the Precise Edit submit', () => {
        const queryBar = document.createElement('div');
        queryBar.className = 'query-bar';
        const editSubmit = makeVisible(document.createElement('button'));
        editSubmit.setAttribute('aria-label', 'Edit');
        editSubmit.click = jest.fn();
        queryBar.appendChild(editSubmit);
        document.body.appendChild(queryBar);
        retryManager.simulateClick = jest.fn();

        expect(retryManager.clickPromptedVideoSubmitButton()).toBe(false);
        expect(retryManager.simulateClick).not.toHaveBeenCalled();
        expect(editSubmit.click).not.toHaveBeenCalled();
    });

    test('prompted detail batch stops before prompt injection when Add Prompt mode does not open', async () => {
        window.history.pushState({}, '', '/imagine/post/current-ui');
        retryManager.selectMakeVideoMode = jest.fn().mockResolvedValue(false);
        retryManager.injectPromptedVideoText = jest.fn().mockReturnValue(true);
        retryManager.clickPromptedVideoSubmitButton = jest.fn().mockReturnValue(true);

        await retryManager.startPromptedBatchFromDetail('slow camera push in', 1);

        expect(retryManager.injectPromptedVideoText).not.toHaveBeenCalled();
        expect(retryManager.clickPromptedVideoSubmitButton).not.toHaveBeenCalled();
        expect(mockOverlay.setStatus).toHaveBeenCalledWith(expect.stringContaining('Add Prompt'), 'warning');
        expect(retryManager.goalCount).toBe(0);
    });

    test('current prompted video completion detects a new ready generated video without retrying', async () => {
        window.history.pushState({}, '', '/imagine/post/source-image');
        const queryBar = document.createElement('div');
        queryBar.className = 'query-bar';
        const persistentSubmit = makeVisible(document.createElement('button'));
        persistentSubmit.setAttribute('aria-label', 'Make video');
        persistentSubmit.click = jest.fn();
        queryBar.appendChild(persistentSubmit);
        document.body.appendChild(queryBar);

        const baseline = retryManager.capturePromptedVideoResultBaseline(document);
        retryManager.batchRunning = true;
        retryManager.batchAborted = false;
        retryManager.currentRetry = 0;
        retryManager.preClickButtonCount = 0;
        retryManager.sleep = jest.fn().mockImplementation(async () => {
            if (document.querySelector('video')) return;
            window.history.pushState({}, '', '/imagine/post/generated-video');
            const video = document.createElement('video');
            video.src = 'https://assets.grok.com/users/example/generated/generated-video/generated_video.mp4';
            Object.defineProperty(video, 'readyState', { value: 4, configurable: true });
            Object.defineProperty(video, 'duration', { value: 10, configurable: true });
            document.body.appendChild(video);
        });

        await expect(retryManager.awaitBatchItemCompletion(document, {
            labelPrefix: 'Prompted Batch [detail]',
            videoResultBaseline: baseline
        })).resolves.toBe('success');

        expect(retryManager.currentRetry).toBe(0);
        expect(persistentSubmit.click).not.toHaveBeenCalled();
    });

    test('current prompted video completion never retries from the persistent Make video submit', async () => {
        window.history.pushState({}, '', '/imagine/post/source-image');
        const queryBar = document.createElement('div');
        queryBar.className = 'query-bar';
        const persistentSubmit = makeVisible(document.createElement('button'));
        persistentSubmit.setAttribute('aria-label', 'Make video');
        persistentSubmit.click = jest.fn();
        queryBar.appendChild(persistentSubmit);
        document.body.appendChild(queryBar);

        retryManager.batchRunning = true;
        retryManager.batchAborted = false;
        retryManager.currentRetry = 0;
        retryManager.preClickButtonCount = 0;
        retryManager.sleep = jest.fn().mockResolvedValue();
        jest.spyOn(Date, 'now')
            .mockReturnValueOnce(0)
            .mockReturnValue(121000);

        await expect(retryManager.awaitBatchItemCompletion(document, {
            labelPrefix: 'Prompted Batch [detail]',
            videoResultBaseline: {
                pageUrl: window.location.href,
                postId: 'source-image',
                completeCount: 0,
                videoSources: []
            }
        })).resolves.toBe('failed');

        expect(retryManager.currentRetry).toBe(0);
        expect(persistentSubmit.click).not.toHaveBeenCalled();
    });

    test('current-page completion does not accept a pre-existing unready source that becomes ready', () => {
        window.history.pushState({}, '', '/imagine/post/source-image');
        const video = document.createElement('video');
        video.src = 'https://assets.grok.com/users/example/generated/66666666-7777-4888-8999-aaaaaaaaaaaa/generated_video.mp4?token=before';
        Object.defineProperty(video, 'readyState', { value: 0, configurable: true });
        document.body.appendChild(video);

        const baseline = retryManager.capturePromptedVideoResultBaseline(document);
        window.history.pushState({}, '', '/imagine/post/generated-video');
        video.src = 'https://assets.grok.com/users/example/generated/66666666-7777-4888-8999-aaaaaaaaaaaa/generated_video.mp4?token=after';
        Object.defineProperty(video, 'readyState', { value: 4, configurable: true });

        expect(retryManager._hasNewPromptedVideoResult(document, baseline)).toBe(false);
    });

    test('Agent completion accepts only a new ready video source in an asset node without a URL change', () => {
        window.history.pushState({}, '', '/imagine/agent/agent-1?conversation=conversation-1');
        const asset = document.createElement('div');
        asset.className = 'react-flow__node-asset';
        const image = document.createElement('img');
        image.src = 'https://assets.grok.com/users/example/generated/source/image.jpg';
        asset.appendChild(image);
        document.body.appendChild(asset);

        const baseline = retryManager.capturePromptedVideoResultBaseline(document);
        expect(baseline.surface).toBe('agent_media');
        expect(baseline.agentAssetSources).toEqual([image.src]);
        expect(retryManager._hasNewPromptedVideoResult(document, baseline)).toBe(false);

        const video = document.createElement('video');
        video.src = 'https://assets.grok.com/users/example/generated/new-video/generated_video.mp4';
        Object.defineProperty(video, 'readyState', { value: 4, configurable: true });
        asset.appendChild(video);

        expect(retryManager._hasNewPromptedVideoResult(document, baseline)).toBe(true);
    });

    test('Agent completion does not accept a pre-existing unready source that becomes ready', () => {
        window.history.pushState({}, '', '/imagine/agent/agent-1?conversation=conversation-1');
        const asset = document.createElement('div');
        asset.className = 'react-flow__node-asset';
        const video = document.createElement('video');
        video.src = 'https://assets.grok.com/users/example/generated/11111111-2222-4333-8444-555555555555/generated_video.mp4?token=before';
        Object.defineProperty(video, 'readyState', { value: 0, configurable: true });
        asset.appendChild(video);
        document.body.appendChild(asset);

        const baseline = retryManager.capturePromptedVideoResultBaseline(document);
        video.src = 'https://assets.grok.com/users/example/generated/11111111-2222-4333-8444-555555555555/generated_video.mp4?token=after';
        Object.defineProperty(video, 'readyState', { value: 4, configurable: true });

        expect(retryManager._hasNewPromptedVideoResult(document, baseline)).toBe(false);
    });

    test('Agent completion ignores unchanged sources and persistent video or Precise Edit controls', () => {
        window.history.pushState({}, '', '/imagine/agent/agent-1?conversation=conversation-1');
        const asset = document.createElement('div');
        asset.className = 'react-flow__node-asset';
        const video = document.createElement('video');
        video.src = 'https://assets.grok.com/users/example/generated/existing-video/generated_video.mp4';
        Object.defineProperty(video, 'readyState', { value: 4, configurable: true });
        asset.appendChild(video);
        const controls = document.createElement('div');
        controls.className = 'query-bar';
        const makeVideo = makeVisible(document.createElement('button'));
        makeVideo.setAttribute('aria-label', 'Make video');
        const edit = makeVisible(document.createElement('button'));
        edit.setAttribute('aria-label', 'Edit');
        controls.append(makeVideo, edit);
        document.body.append(asset, controls);

        const baseline = retryManager.capturePromptedVideoResultBaseline(document);

        expect(retryManager._hasNewPromptedVideoResult(document, baseline)).toBe(false);
    });

    test('prompted detail batch passes the current video result baseline to completion monitoring', async () => {
        window.history.pushState({}, '', '/imagine/post/source-image');
        const baseline = {
            pageUrl: window.location.href,
            postId: 'source-image',
            completeCount: 0,
            videoSources: []
        };
        retryManager.selectMakeVideoMode = jest.fn().mockImplementation(async () => {
            retryManager.promptedVideoModeContract = 'current_menu';
            return true;
        });
        retryManager.injectPromptedVideoText = jest.fn().mockReturnValue(true);
        retryManager.capturePromptedVideoResultBaseline = jest.fn().mockReturnValue(baseline);
        retryManager.clickPromptedVideoSubmitButton = jest.fn().mockReturnValue(true);
        retryManager.awaitBatchItemCompletion = jest.fn().mockResolvedValue('success');
        retryManager.sleep = jest.fn().mockResolvedValue();

        await retryManager.startPromptedBatchFromDetail('slow camera push in', 1);

        expect(retryManager.capturePromptedVideoResultBaseline).toHaveBeenCalledWith(document);
        expect(retryManager.awaitBatchItemCompletion).toHaveBeenCalledWith(document, {
            allowRetry: true,
            labelPrefix: 'Prompted Batch [detail]',
            runToken: expect.any(String),
            videoResultBaseline: baseline
        });
        expect(retryManager.goalCount).toBe(1);
    });

    test('updateCounters shows gallery label during prompted gallery batch', () => {
        retryManager.batchRunning = true;
        retryManager.batchMode = 'prompted';
        retryManager.batchContext = 'gallery';
        retryManager.goalCount = 2;
        retryManager.goalTotal = 5;

        retryManager.updateCounters();

        expect(mockOverlay.el.querySelector('#gptProgressLabel').textContent).toBe('Images Processed');
        expect(mockOverlay.el.querySelector('#gptVideoCounter').textContent).toBe('2/5');
    });

    test('updateBatchButtons works without prompted selector row', () => {
        expect(() => retryManager.updateBatchButtons(true)).not.toThrow();
        expect(() => retryManager.updateBatchButtons(false)).not.toThrow();
    });
});
