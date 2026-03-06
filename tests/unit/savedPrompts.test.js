const {
    GrokOverlay,
    SAVED_PROMPT_TYPES,
    appendSnippetAtCursor,
    filterSavedPrompts,
    mergePromptTextForAppend,
    normalizeSavedPrompts
} = require('../../content.js');

function createOverlayHarness() {
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
        stopBatch: jest.fn()
    };

    const scraper = {
        setOverlay: jest.fn()
    };

    const overlay = new GrokOverlay(scraper, retryManager, settingsManager, historyManager);
    retryManager.overlay = overlay;
    return { overlay, retryManager };
}

describe('saved prompt helpers', () => {
    test('normalizes legacy saved prompts to v2 schema', () => {
        const normalized = normalizeSavedPrompts([
            { name: 'Style', text: ' cinematic lighting ' },
            { text: '  camera dolly  ', type: 'partial' },
            { name: 'Bad', text: '   ' }
        ], { now: 123456 });

        expect(normalized).toHaveLength(2);
        expect(normalized[0].id).toBe('saved_123456_0');
        expect(normalized[0].name).toBe('Style');
        expect(normalized[0].text).toBe('cinematic lighting');
        expect(normalized[0].type).toBe('full');
        expect(normalized[0].createdAt).toBe(123456);
        expect(normalized[0].updatedAt).toBe(123456);
        expect(normalized[1].type).toBe('partial');
    });

    test('filters saved prompts by type and search query', () => {
        const prompts = normalizeSavedPrompts([
            { name: 'Camera Motion', text: 'slow dolly in', type: 'partial' },
            { name: 'Lighting', text: 'cinematic lighting', type: 'partial' },
            { name: 'Hero Scene', text: 'hero running through rain', type: 'full' }
        ], { now: 1000 });

        const partialMatches = filterSavedPrompts(prompts, SAVED_PROMPT_TYPES.partial, 'light');
        const fullMatches = filterSavedPrompts(prompts, SAVED_PROMPT_TYPES.full, 'hero');

        expect(partialMatches).toHaveLength(1);
        expect(partialMatches[0].name).toBe('Lighting');
        expect(fullMatches).toHaveLength(1);
        expect(fullMatches[0].name).toBe('Hero Scene');
    });

    test('appends prompt text with delimiter and suppresses duplicate token', () => {
        expect(mergePromptTextForAppend('hero running', 'cinematic lighting')).toBe('hero running, cinematic lighting');
        expect(mergePromptTextForAppend('hero running, cinematic lighting', 'cinematic lighting')).toBe('hero running, cinematic lighting');
    });

    test('inserts snippet at cursor using smart delimiters', () => {
        const inserted = appendSnippetAtCursor('hero running', 'cinematic lighting', 12, 12);
        expect(inserted.text).toBe('hero running, cinematic lighting');
        expect(inserted.caret).toBe('hero running, cinematic lighting'.length);
    });
});

describe('prompted batch input source', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
    });

    test('uses current input bar text and does not depend on selector row', async () => {
        const input = document.createElement('textarea');
        input.setAttribute('aria-required', 'true');
        input.value = 'typed prompt from input bar';
        document.body.appendChild(input);

        const { overlay, retryManager } = createOverlayHarness();
        expect(overlay.el.querySelector('#gptBatchPromptSelect')).toBeNull();

        overlay.el.querySelector('#gptPromptedBatchBtn').click();
        await Promise.resolve();

        expect(retryManager.startBatch).toHaveBeenCalledTimes(1);
        expect(retryManager.startBatch).toHaveBeenCalledWith(
            'prompted',
            'typed prompt from input bar',
            expect.objectContaining({ videoGoal: expect.any(Number), galleryLimit: expect.any(Number) })
        );
    });

    test('rejects prompted batch when input bar is empty', async () => {
        const input = document.createElement('textarea');
        input.setAttribute('aria-required', 'true');
        input.value = '';
        document.body.appendChild(input);

        const { overlay, retryManager } = createOverlayHarness();
        const toastSpy = jest.spyOn(overlay.toast, 'show');

        overlay.el.querySelector('#gptPromptedBatchBtn').click();
        await Promise.resolve();

        expect(retryManager.startBatch).not.toHaveBeenCalled();
        expect(toastSpy).toHaveBeenCalledWith(
            'Enter a prompt in the input bar before starting Prompted Batch',
            'error'
        );
    });
});
