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
