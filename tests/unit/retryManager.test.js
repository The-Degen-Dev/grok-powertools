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
            const menuItem = makeVisible(document.createElement('div'));
            menuItem.setAttribute('role', 'menuitem');
            menuItem.textContent = 'Add Prompt';
            menuItem.addEventListener('click', () => {
                if (!composer) return;
                const queryBar = document.createElement('div');
                queryBar.className = 'query-bar';
                const input = document.createElement('div');
                input.setAttribute('contenteditable', 'true');
                const submit = makeVisible(document.createElement('button'));
                submit.setAttribute('aria-label', 'Make video');
                if (onSubmit) submit.addEventListener('click', onSubmit);
                queryBar.append(input, submit);
                document.body.appendChild(queryBar);
                menuItem.remove();
            });
            document.body.appendChild(menuItem);
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

        setIntervalSpy = jest.spyOn(global, 'setInterval').mockImplementation(() => 1);
        retryManager = new VideoRetryManager(mockOverlay, settingsManager, historyManager);
    });

    afterEach(() => {
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
                const addPrompt = makeVisible(document.createElement('div'));
                addPrompt.setAttribute('role', 'menuitem');
                addPrompt.textContent = 'Add Prompt';
                addPrompt.addEventListener('click', () => {
                    const composer = document.createElement('div');
                    composer.setAttribute('contenteditable', 'true');
                    const submit = makeVisible(document.createElement('button'));
                    submit.setAttribute('aria-label', 'Make video');
                    submit.addEventListener('click', () => { submitted++; });
                    composer.className = 'query-bar';
                    composer.appendChild(submit);
                    document.body.appendChild(composer);
                    addPrompt.remove();
                });
                document.body.appendChild(addPrompt);
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
        retryManager.waitForPromptedBatchEditorSurface = jest.fn().mockResolvedValue(null);
        retryManager.injectPromptText = jest.fn().mockReturnValue(true);
        retryManager.clickPromptedVideoSubmitButton = jest.fn().mockReturnValue(true);

        await retryManager.processBatchItemPrompted({ button: first.makeVideo, container: first.card }, retryManager.batchRunToken);

        expect(retryManager.injectPromptText).not.toHaveBeenCalled();
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
            });
            document.body.appendChild(back);
        });
        const nextClick = addNextCardClickProbe();
        primePromptedGalleryBatch(retryManager, { button: first.makeVideo, container: first.card });
        retryManager.injectPromptText = jest.fn().mockReturnValue(true);
        retryManager.clickPromptedVideoSubmitButton = jest.fn().mockReturnValue(true);

        await retryManager.processBatchItemPrompted({ button: first.makeVideo, container: first.card }, retryManager.batchRunToken);

        expect(retryManager.injectPromptText).not.toHaveBeenCalled();
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
                }
            });
        });
        const nextClick = addNextCardClickProbe();
        primePromptedGalleryBatch(retryManager, { button: first.makeVideo, container: first.card });
        retryManager.injectPromptText = jest.fn().mockReturnValue(true);
        retryManager.clickPromptedVideoSubmitButton = jest.fn().mockReturnValue(true);

        await retryManager.processBatchItemPrompted({ button: first.makeVideo, container: first.card }, retryManager.batchRunToken);

        expect(retryManager.injectPromptText).not.toHaveBeenCalled();
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
                }
            });
        });
        const nextClick = addNextCardClickProbe();
        primePromptedGalleryBatch(retryManager, { button: first.makeVideo, container: first.card });
        retryManager.sleep = jest.fn().mockResolvedValue();
        retryManager.injectPromptText = jest.fn().mockReturnValue(true);
        retryManager.clickPromptedVideoSubmitButton = jest.fn().mockReturnValue(true);

        await retryManager.processBatchItemPrompted({ button: first.makeVideo, container: first.card }, retryManager.batchRunToken);

        expect(retryManager.injectPromptText).not.toHaveBeenCalled();
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
                }
            });
        });
        primePromptedGalleryBatch(retryManager, { button: first.makeVideo, container: first.card });
        retryManager.sleep = jest.fn().mockResolvedValue();
        retryManager.injectPromptText = jest.fn().mockReturnValue(true);
        retryManager.clickPromptedVideoSubmitButton = jest.fn().mockReturnValue(true);

        await retryManager.processBatchItemPrompted({ button: first.makeVideo, container: first.card }, retryManager.batchRunToken);

        expect(retryManager.injectPromptText).not.toHaveBeenCalled();
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
        retryManager.injectPromptText = jest.fn().mockReturnValue(true);
        retryManager.clickPromptedVideoSubmitButton = jest.fn().mockReturnValue(true);

        await retryManager.processBatchItemPrompted({ button: first.makeVideo, container: first.card }, 'batch-test-token');

        expect(firstClick).not.toHaveBeenCalled();
        expect(retryManager.injectPromptText).not.toHaveBeenCalled();
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
        retryManager.injectPromptText = jest.fn().mockReturnValue(true);
        retryManager.clickPromptedVideoSubmitButton = jest.fn().mockReturnValue(true);

        await retryManager.processBatchItemPrompted({ button: first.makeVideo, container: first.card }, retryManager.batchRunToken);

        expect(retryManager.injectPromptText).not.toHaveBeenCalled();
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
                const menuItem = makeVisible(document.createElement('div'));
                menuItem.setAttribute('role', 'menuitem');
                menuItem.textContent = 'Add Prompt';
                menuItem.addEventListener('click', () => retryManager.stopBatch());
                document.body.appendChild(menuItem);
            });
            document.body.appendChild(makeVideo);
        });
        const nextClick = addNextCardClickProbe();
        primePromptedGalleryBatch(retryManager, { button: first.makeVideo, container: first.card });
        retryManager.injectPromptText = jest.fn().mockReturnValue(true);
        retryManager.clickPromptedVideoSubmitButton = jest.fn().mockReturnValue(true);

        await retryManager.processBatchItemPrompted({ button: first.makeVideo, container: first.card }, retryManager.batchRunToken);

        expect(retryManager.injectPromptText).not.toHaveBeenCalled();
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
        retryManager.injectPromptText = jest.fn(() => {
            retryManager.stopBatch();
            return true;
        });
        retryManager.clickPromptedVideoSubmitButton = jest.fn().mockReturnValue(true);

        await retryManager.processBatchItemPrompted({ button: first.makeVideo, container: first.card }, retryManager.batchRunToken);

        expect(retryManager.injectPromptText).toHaveBeenCalledWith('slow camera push in');
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
        retryManager.injectPromptText = jest.fn().mockReturnValue(true);
        retryManager.clickPromptedVideoSubmitButton = jest.fn().mockReturnValue(true);
        const recoverSpy = jest.spyOn(retryManager, 'navigateToPromptedBatchGallery').mockImplementation(() => {});

        await retryManager.processBatchItemPrompted({ button: first.makeVideo, container: first.card }, retryManager.batchRunToken);

        expect(recoverSpy).toHaveBeenCalledWith('http://localhost/imagine/saved');
        expect(retryManager.batchRunning).toBe(false);
        expect(retryManager.goalCount).toBe(0);
        expect(mockOverlay.setStatus).toHaveBeenCalledWith(expect.stringContaining('could not return to Saved'), 'warning');
        expect(nextClick).not.toHaveBeenCalled();
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
            const addPromptItem = makeVisible(document.createElement('div'), { width: 120, right: 120 });
            addPromptItem.setAttribute('role', 'menuitem');
            addPromptItem.textContent = 'Add Prompt';
            addPromptItem.addEventListener('click', () => {
                editSubmit.remove();
                const videoSubmit = makeVisible(document.createElement('button'));
                videoSubmit.setAttribute('aria-label', 'Make video');
                queryBar.appendChild(videoSubmit);
                addPromptItem.remove();
            });
            document.body.appendChild(addPromptItem);
        });

        document.body.append(makeVideoTrigger, queryBar);
        retryManager.sleep = jest.fn().mockResolvedValue();
        retryManager.simulateClick = jest.fn((element) => element.click());

        await expect(retryManager.selectMakeVideoMode()).resolves.toBe(true);

        expect(retryManager.simulateClick).toHaveBeenCalledWith(makeVideoTrigger);
        expect(retryManager.simulateClick).toHaveBeenCalledWith(expect.objectContaining({ textContent: 'Add Prompt' }));
        expect(editSubmit.click).not.toHaveBeenCalled();
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
        retryManager.injectPromptText = jest.fn().mockReturnValue(true);
        retryManager.clickPromptedVideoSubmitButton = jest.fn().mockReturnValue(true);

        await retryManager.startPromptedBatchFromDetail('slow camera push in', 1);

        expect(retryManager.injectPromptText).not.toHaveBeenCalled();
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
        retryManager.injectPromptText = jest.fn().mockReturnValue(true);
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
