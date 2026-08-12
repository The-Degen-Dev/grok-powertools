const { VideoRetryManager } = require('../../content.js');

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

describe('VideoRetryManager', () => {
    let retryManager;
    let mockOverlay;
    let settingsManager;
    let historyManager;
    let setIntervalSpy;

    beforeEach(() => {
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
        window.history.pushState({}, '', '/imagine');
        const card = document.createElement('div');
        card.className = 'media-post-masonry-card';
        document.body.appendChild(card);
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
        const card = document.createElement('div');
        card.className = 'media-post-masonry-card';
        document.body.appendChild(card);

        const gallerySpy = jest.spyOn(retryManager, 'startPromptedBatchFromGallery').mockResolvedValue();
        const detailSpy = jest.spyOn(retryManager, 'startPromptedBatchFromDetail').mockResolvedValue();

        await retryManager.startBatch('prompted', 'test prompt', { galleryLimit: 4, videoGoal: 7 });

        expect(gallerySpy).toHaveBeenCalledWith('test prompt', 4);
        expect(detailSpy).not.toHaveBeenCalled();
    });

    test('startBatch(prompted) routes to detail flow on detail context', async () => {
        window.history.pushState({}, '', '/imagine/post/xyz');
        const gallerySpy = jest.spyOn(retryManager, 'startPromptedBatchFromGallery').mockResolvedValue();
        const detailSpy = jest.spyOn(retryManager, 'startPromptedBatchFromDetail').mockResolvedValue();

        await retryManager.startBatch('prompted', 'detail prompt', { galleryLimit: 4, videoGoal: 6 });

        expect(detailSpy).toHaveBeenCalledWith('detail prompt', 6);
        expect(gallerySpy).not.toHaveBeenCalled();
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

    test('prompted gallery batch returns without counting an item when Add Prompt mode does not open', async () => {
        window.history.pushState({}, '', '/imagine/post/current-ui');
        const container = document.createElement('div');
        const image = document.createElement('img');
        image.src = 'https://assets.grok.com/example.png';
        image.scrollIntoView = jest.fn();
        container.appendChild(image);
        document.body.appendChild(container);

        retryManager.batchRunning = true;
        retryManager.batchAborted = false;
        retryManager.batchPrompt = 'slow camera push in';
        retryManager.batchProcessedSrcs = new Set();
        retryManager.goalCount = 0;
        retryManager.batchIndex = 0;
        retryManager.sleep = jest.fn().mockResolvedValue();
        retryManager.selectMakeVideoMode = jest.fn().mockResolvedValue(false);
        retryManager.injectPromptText = jest.fn().mockReturnValue(true);
        retryManager.batchGoBack = jest.fn().mockResolvedValue(true);

        await retryManager.processBatchItemPrompted({ container });

        expect(retryManager.injectPromptText).not.toHaveBeenCalled();
        expect(retryManager.batchGoBack).toHaveBeenCalledTimes(1);
        expect(retryManager.batchRunning).toBe(false);
        expect(retryManager.goalCount).toBe(0);
        expect(retryManager.batchIndex).toBe(0);
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
