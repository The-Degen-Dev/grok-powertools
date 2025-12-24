const { VideoRetryManager, Config } = require('../../content.js');

describe('VideoRetryManager', () => {
    let retryManager;
    let mockOverlay;

    beforeEach(() => {
        // Mock Overlay
        mockOverlay = {
            setStatus: jest.fn()
        };

        // Setup basic DOM required by init()
        document.body.innerHTML = `
      <input type="checkbox" id="gptRetryToggle">
      <input type="number" id="gptMaxRetries">
      <input type="number" id="gptCooldown">
    `;

        // Reset global Chrome usage with Promise support
        chrome.storage.local.get.mockImplementation((keys) => {
            return Promise.resolve({});
        });

        // Create new instance
        retryManager = new VideoRetryManager(mockOverlay);

        // Use fake timers
        jest.useFakeTimers();
    });

    afterEach(() => {
        jest.clearAllMocks();
        jest.useRealTimers();
    });

    test('should initialize with default values', async () => {
        await retryManager.init();
        expect(retryManager.maxRetries).toBe(3);
        expect(retryManager.enabled).toBe(false);
    });

    test('should load maxRetries from storage', async () => {
        chrome.storage.local.get.mockImplementation((keys) => {
            return Promise.resolve({ retryMaxCount: 5, autoRetryEnabled: true });
        });

        await retryManager.init();
        expect(retryManager.maxRetries).toBe(5);
        expect(retryManager.enabled).toBe(true);
    });

    test('should attempt retry if text content matches and enabled', async () => {
        retryManager.enabled = true;
        retryManager.lastClickTime = 0;

        // Mock moderation text
        document.body.textContent = 'Content Moderated. Try a different idea.';

        // Mock clickMakeVideo
        retryManager.clickMakeVideo = jest.fn();

        retryManager.checkAndAct();

        expect(retryManager.clickMakeVideo).toHaveBeenCalled();
        expect(mockOverlay.setStatus).toHaveBeenCalledWith(expect.stringContaining('Retrying'), 'warning');
    });

    test('should NOT attempt retry if disabled', async () => {
        retryManager.enabled = false;
        document.body.textContent = 'Content Moderated. Try a different idea.';
        retryManager.clickMakeVideo = jest.fn();

        retryManager.checkAndAct();

        expect(retryManager.clickMakeVideo).not.toHaveBeenCalled();
    });

    test('should stop retrying after maxRetries', async () => {
        retryManager.enabled = true;
        retryManager.maxRetries = 2;
        retryManager.currentRetry = 2;
        document.body.textContent = 'Content Moderated. Try a different idea.';
        retryManager.clickMakeVideo = jest.fn();

        retryManager.checkAndAct();

        expect(retryManager.clickMakeVideo).not.toHaveBeenCalled();
        expect(mockOverlay.setStatus).toHaveBeenCalledWith('Max Retries Hit', 'error');
    });
});
