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
        jest.restoreAllMocks();
    });

    test('shows ChatGPT Images provider state without adding a second prompt box', () => {
        const { overlay } = createOverlay('https://chatgpt.com/images/');

        expect(overlay.el.dataset.providerId).toBe('chatgpt-images');
        expect(overlay.el.querySelector('#gptProviderLabel').textContent).toBe('Provider: ChatGPT Images');
        expect(overlay.el.querySelector('#gptChatGptImageSection')).toBeNull();
        expect(overlay.el.querySelector('#gptChatGptPrompt')).toBeNull();
        expect(overlay.el.querySelector('#gptChatGptGenerateBtn')).toBeNull();
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
        expect(overlay.el.querySelector('#gptChatGptImageSection')).toBeNull();
        expect(overlay.el.querySelector('#gptRecreateSection').style.display).not.toBe('none');
        expect(overlay.el.querySelector('#gptAutoRetrySection').style.display).not.toBe('none');
    });

    test('tracks native ChatGPT image send and writes provider run ledger entry', async () => {
        const fallback = document.createElement('textarea');
        fallback.name = 'prompt-textarea';
        fallback.value = 'stale hidden fallback prompt';
        fallback.style.display = 'none';
        document.body.appendChild(fallback);

        const input = document.createElement('div');
        input.id = 'prompt-textarea';
        input.setAttribute('contenteditable', 'true');
        input.setAttribute('role', 'textbox');
        input.setAttribute('aria-label', 'Chat with ChatGPT');
        input.textContent = 'a brass observatory';
        input.getBoundingClientRect = () => ({ left: 100, top: 100, width: 320, height: 40 });
        document.body.appendChild(input);

        const send = document.createElement('button');
        send.dataset.testid = 'send-button';
        send.setAttribute('aria-label', 'Send prompt');
        send.getBoundingClientRect = () => ({ left: 100, top: 150, width: 40, height: 40 });
        document.body.appendChild(send);

        const waitForChatGptResultDelta = jest.fn(() => Promise.resolve({
            ok: true,
            providerId: 'chatgpt-images',
            workflow: 'text-to-image',
            result: {
                src: 'https://cdn.example.com/generated.png',
                href: 'https://chatgpt.com/images/generated'
            }
        }));
        const createChatGptResultSnapshot = jest.fn(() => ({ signatures: [] }));
        const sendMessage = jest.spyOn(chrome.runtime, 'sendMessage').mockResolvedValue({
            status: 'ok',
            entry: { runId: 'provider_run_1' }
        });
        const { overlay, historyManager } = createOverlay('https://chatgpt.com/images/', {
            chatGptActions: { ...ChatGPTImagesActions, createChatGptResultSnapshot, waitForChatGptResultDelta }
        });

        send.click();
        await new Promise((resolve) => setTimeout(resolve, 0));
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(createChatGptResultSnapshot).toHaveBeenCalled();
        expect(waitForChatGptResultDelta).toHaveBeenCalledWith(expect.objectContaining({
            signatures: []
        }), expect.objectContaining({ prompt: 'a brass observatory' }));
        expect(historyManager.add).toHaveBeenCalledWith('a brass observatory', 'image');
        expect(sendMessage).toHaveBeenNthCalledWith(1, expect.objectContaining({
            action: 'PROVIDER_RUN_LEDGER_APPEND',
            entry: expect.objectContaining({
                providerId: 'chatgpt-images',
                workflow: 'text-to-image',
                prompt: 'a brass observatory',
                status: 'submitted'
            })
        }));
        expect(sendMessage).toHaveBeenLastCalledWith(expect.objectContaining({
            action: 'PROVIDER_RUN_LEDGER_APPEND',
            entry: expect.objectContaining({
                providerId: 'chatgpt-images',
                workflow: 'text-to-image',
                prompt: 'a brass observatory',
                status: 'generated'
            })
        }));
        expect(overlay.el.querySelector('#gptStatusBadge').textContent).toBe('Generated image ready');
    });

    test('preserves the original provider ledger rejection', async () => {
        const ledgerError = new Error('ledger write failed');
        const sendMessage = jest.spyOn(chrome.runtime, 'sendMessage').mockRejectedValue(ledgerError);
        const { overlay } = createOverlay('https://chatgpt.com/images/');

        await expect(overlay.appendProviderRun({
            providerId: 'chatgpt-images',
            workflow: 'text-to-image',
            status: 'submitted'
        })).rejects.toBe(ledgerError);
        expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
            action: 'PROVIDER_RUN_LEDGER_APPEND'
        }));
    });
});
