const {
    collectChatGptImageCandidates,
    createChatGptResultSnapshot,
    diffChatGptResultCandidates,
    fillChatGptPromptInput,
    findChatGptPromptInput,
    findChatGptSendButton,
    runChatGptImagePrompt
} = require('../../chatgptImagesContent.js');

function makeImage(src, overrides = {}) {
    const img = document.createElement('img');
    img.src = src;
    img.alt = overrides.alt || 'generated image';
    Object.defineProperty(img, 'complete', { configurable: true, value: true });
    Object.defineProperty(img, 'naturalWidth', { configurable: true, value: overrides.naturalWidth || 1024 });
    Object.defineProperty(img, 'naturalHeight', { configurable: true, value: overrides.naturalHeight || 1024 });
    img.getBoundingClientRect = overrides.getBoundingClientRect || (() => ({
        left: 100,
        top: 100,
        width: 320,
        height: 320
    }));
    document.body.appendChild(img);
    return img;
}

describe('ChatGPT Images content helpers', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        jest.useRealTimers();
    });

    function makeVisible(element, rect = { left: 100, top: 100, width: 320, height: 40 }) {
        element.getBoundingClientRect = () => rect;
        return element;
    }

    test('finds and fills the visible ChatGPT Images prompt textarea', () => {
        const input = document.createElement('textarea');
        input.name = 'prompt-textarea';
        input.placeholder = 'Describe a new image';
        makeVisible(input);
        document.body.appendChild(input);

        const seenEvents = [];
        input.addEventListener('input', () => seenEvents.push('input'));
        input.addEventListener('change', () => seenEvents.push('change'));

        expect(findChatGptPromptInput()).toBe(input);
        fillChatGptPromptInput('a glass lighthouse at sunrise');

        expect(input.value).toBe('a glass lighthouse at sunrise');
        expect(seenEvents).toEqual(['input', 'change']);
    });

    test('prefers the visible ProseMirror composer over ChatGPT hidden fallback textarea', () => {
        const fallback = document.createElement('textarea');
        fallback.name = 'prompt-textarea';
        fallback.placeholder = 'Describe a new image';
        fallback.style.display = 'none';
        fallback.value = 'stale hidden fallback prompt';
        document.body.appendChild(fallback);

        const editor = document.createElement('div');
        editor.id = 'prompt-textarea';
        editor.setAttribute('contenteditable', 'true');
        editor.setAttribute('role', 'textbox');
        editor.setAttribute('aria-label', 'Chat with ChatGPT');
        editor.textContent = 'visible prompt';
        makeVisible(editor);
        document.body.appendChild(editor);

        expect(findChatGptPromptInput()).toBe(editor);
    });

    test('fails clearly when prompt input is missing', async () => {
        await expect(runChatGptImagePrompt({ prompt: 'x', timeoutMs: 5 })).rejects.toMatchObject({
            code: 'chatgpt_prompt_missing'
        });
    });

    test('finds the send button and ignores disabled sends', async () => {
        const input = document.createElement('textarea');
        input.name = 'prompt-textarea';
        makeVisible(input);
        document.body.appendChild(input);

        const send = document.createElement('button');
        send.dataset.testid = 'send-button';
        send.setAttribute('aria-label', 'Send prompt');
        makeVisible(send);
        document.body.appendChild(send);

        expect(findChatGptSendButton()).toBe(send);
        send.disabled = true;
        await expect(runChatGptImagePrompt({ prompt: 'x', timeoutMs: 5 })).rejects.toMatchObject({
            code: 'chatgpt_send_disabled'
        });
    });

    test('fails clearly when send button is missing', async () => {
        const input = document.createElement('textarea');
        input.name = 'prompt-textarea';
        makeVisible(input);
        document.body.appendChild(input);

        await expect(runChatGptImagePrompt({ prompt: 'x', timeoutMs: 5 })).rejects.toMatchObject({
            code: 'chatgpt_send_missing'
        });
    });

    test('fails before submit when a visible blocker appears', async () => {
        const input = document.createElement('textarea');
        input.name = 'prompt-textarea';
        makeVisible(input);
        document.body.appendChild(input);
        document.body.appendChild(document.createTextNode('Upgrade your plan to continue'));

        await expect(runChatGptImagePrompt({ prompt: 'x', timeoutMs: 5 })).rejects.toMatchObject({
            code: 'chatgpt_blocked'
        });
    });

    test('diffs generated images against a pre-submit snapshot', () => {
        makeImage('https://cdn.example.com/existing.png');
        const before = createChatGptResultSnapshot();
        makeImage('https://cdn.example.com/new-result.png', { alt: 'new result' });

        const afterCandidates = collectChatGptImageCandidates();
        const delta = diffChatGptResultCandidates(before, afterCandidates);

        expect(delta).toHaveLength(1);
        expect(delta[0].src).toBe('https://cdn.example.com/new-result.png');
    });

    test('submits a prompt and resolves only after a new image candidate appears', async () => {
        makeImage('https://cdn.example.com/existing.png');

        const input = document.createElement('textarea');
        input.name = 'prompt-textarea';
        makeVisible(input);
        document.body.appendChild(input);

        const send = document.createElement('button');
        send.dataset.testid = 'send-button';
        send.setAttribute('aria-label', 'Send prompt');
        makeVisible(send);
        document.body.appendChild(send);

        const result = await runChatGptImagePrompt({
            prompt: 'a tiny brass observatory',
            timeoutMs: 500,
            intervalMs: 10,
            afterSubmit: () => {
                makeImage('https://cdn.example.com/generated.png');
            }
        });

        expect(input.value).toBe('a tiny brass observatory');
        expect(result).toEqual(expect.objectContaining({
            ok: true,
            providerId: 'chatgpt-images',
            workflow: 'text-to-image',
            prompt: 'a tiny brass observatory',
            submitted: true
        }));
        expect(result.result.src).toBe('https://cdn.example.com/generated.png');
    });
});
