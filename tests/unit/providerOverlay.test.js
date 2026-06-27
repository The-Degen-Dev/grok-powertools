const ProviderRegistry = require('../../providerRegistry.js');
const ChatGPTImagesActions = require('../../chatgptImagesContent.js');
const ProviderRunLedger = require('../../providerRunLedger.js');
const { GrokOverlay } = require('../../content.js');

function createOverlay(providerUrl, overrides = {}) {
    const settings = {
        maxRetries: 3,
        videoGoal: 5,
        galleryBatchLimit: 10,
        autoRetryEnabled: true,
        retryCooldown: 8000,
        generationDelay: 8000,
        historyLimit: 50,
        devMode: false
    };

    const settingsManager = {
        settings,
        get: jest.fn((key) => settings[key]),
        set: jest.fn((key, value) => {
            settings[key] = value;
        }),
        subscribe: jest.fn(),
        export: jest.fn(() => '{}'),
        import: jest.fn(() => true),
        reset: jest.fn()
    };

    const historyManager = {
        history: [],
        add: jest.fn(),
        clear: jest.fn(),
        subscribe: jest.fn()
    };

    const retryManager = {
        overlay: null,
        goalRunning: false,
        batchRunning: false,
        startGoal: jest.fn(),
        startBatch: jest.fn().mockResolvedValue(undefined),
        startQualityRepeat: jest.fn(),
        stopBatch: jest.fn(),
        stopQualityRepeat: jest.fn()
    };

    const scraper = {
        setOverlay: jest.fn(),
        start: jest.fn(),
        stop: jest.fn()
    };

    const provider = ProviderRegistry.detectProvider(providerUrl);
    const overlay = new GrokOverlay(scraper, retryManager, settingsManager, historyManager, {
        provider,
        chatGptActions: overrides.chatGptActions || ChatGPTImagesActions,
        providerRunLedger: overrides.providerRunLedger || ProviderRunLedger
    });
    retryManager.overlay = overlay;
    return { overlay, historyManager, retryManager, scraper };
}

describe('provider-aware overlay', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
    });

    test('shows ChatGPT Images provider card and hides Grok-only sections', () => {
        const { overlay } = createOverlay('https://chatgpt.com/images/');

        expect(overlay.el.dataset.providerId).toBe('chatgpt-images');
        expect(overlay.el.querySelector('#gptProviderLabel').textContent).toBe('Provider: ChatGPT Images');
        expect(overlay.el.querySelector('#gptChatGptImageSection').style.display).not.toBe('none');
        expect(overlay.el.querySelector('#gptRecreateSection').style.display).toBe('none');
        expect(overlay.el.querySelector('#gptAutoRetrySection').style.display).toBe('none');
        expect(overlay.el.querySelector('#gptTemplateBatchSection').style.display).toBe('none');
        expect(overlay.el.querySelector('#gptQualityRepeatSection').style.display).toBe('none');
        expect(overlay.el.querySelector('#gptGalleryDownloadSection').style.display).toBe('none');
    });

    test('keeps Grok controls visible on Grok Imagine', () => {
        const { overlay } = createOverlay('https://grok.com/imagine');

        expect(overlay.el.dataset.providerId).toBe('grok-imagine');
        expect(overlay.el.querySelector('#gptProviderLabel').textContent).toBe('Provider: Grok Imagine');
        expect(overlay.el.querySelector('#gptChatGptImageSection').style.display).toBe('none');
        expect(overlay.el.querySelector('#gptRecreateSection').style.display).not.toBe('none');
        expect(overlay.el.querySelector('#gptAutoRetrySection').style.display).not.toBe('none');
    });

    test('runs ChatGPT image generation and writes provider run ledger entry', async () => {
        const runChatGptImagePrompt = jest.fn(() => Promise.resolve({
            ok: true,
            providerId: 'chatgpt-images',
            workflow: 'text-to-image',
            prompt: 'a brass observatory',
            result: {
                src: 'https://cdn.example.com/generated.png',
                href: 'https://chatgpt.com/images/generated'
            }
        }));
        const appendProviderRunLedgerEntry = jest.fn(() => Promise.resolve({ runId: 'provider_run_1' }));
        const { overlay, historyManager } = createOverlay('https://chatgpt.com/images/', {
            chatGptActions: { ...ChatGPTImagesActions, runChatGptImagePrompt },
            providerRunLedger: { ...ProviderRunLedger, appendProviderRunLedgerEntry }
        });

        overlay.el.querySelector('#gptChatGptPrompt').value = 'a brass observatory';
        overlay.el.querySelector('#gptChatGptGenerateBtn').click();
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(runChatGptImagePrompt).toHaveBeenCalledWith(expect.objectContaining({
            prompt: 'a brass observatory'
        }));
        expect(historyManager.add).toHaveBeenCalledWith('a brass observatory', 'image');
        expect(appendProviderRunLedgerEntry).toHaveBeenCalledWith(expect.objectContaining({
            providerId: 'chatgpt-images',
            workflow: 'text-to-image',
            prompt: 'a brass observatory',
            status: 'generated'
        }));
        expect(overlay.el.querySelector('#gptChatGptStatus').textContent).toBe('Generated image ready');
    });
});
