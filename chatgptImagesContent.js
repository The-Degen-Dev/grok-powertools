(function (root, factory) {
    const api = factory();

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }

    if (root) {
        root.ChatGPTImagesContentActions = api;
    }
})(typeof self !== 'undefined' ? self : typeof globalThis !== 'undefined' ? globalThis : this, function () {
    function fail(code) {
        const error = new Error(code);
        error.code = code;
        return error;
    }

    function getDocument(options = {}) {
        return options.documentRef || (typeof document !== 'undefined' ? document : null);
    }

    function isVisible(element) {
        if (!element || typeof element.getBoundingClientRect !== 'function') return true;
        if (element.hidden || element.getAttribute('aria-hidden') === 'true') return false;
        if (typeof getComputedStyle === 'function') {
            const style = getComputedStyle(element);
            if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
        }
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
    }

    function findVisibleElement(documentRef, selector) {
        return Array.from(documentRef.querySelectorAll(selector)).find(isVisible) || null;
    }

    function findChatGptPromptInput(options = {}) {
        const documentRef = getDocument(options);
        if (!documentRef) return null;

        return (
            findVisibleElement(documentRef, '#prompt-textarea[contenteditable="true"][role="textbox"]') ||
            findVisibleElement(documentRef, '[role="textbox"][aria-label="Chat with ChatGPT"]') ||
            findVisibleElement(documentRef, 'textarea[name="prompt-textarea"]') ||
            findVisibleElement(documentRef, 'textarea[placeholder="Describe a new image"]')
        );
    }

    function findChatGptSendButton(options = {}) {
        const documentRef = getDocument(options);
        if (!documentRef) return null;

        return Array.from(
            documentRef.querySelectorAll('button[data-testid="send-button"], button[aria-label="Send prompt"]')
        ).find(isVisible) || null;
    }

    function dispatchEditableEvents(element) {
        const InputEventConstructor = typeof InputEvent === 'function' ? InputEvent : Event;
        element.dispatchEvent(new InputEventConstructor('input', { bubbles: true, inputType: 'insertText' }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function fillChatGptPromptInput(prompt, options = {}) {
        const input = findChatGptPromptInput(options);
        if (!input) throw fail('chatgpt_prompt_missing');

        const text = String(prompt || '').trim();
        if ('value' in input) {
            const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value');
            if (descriptor && typeof descriptor.set === 'function') {
                descriptor.set.call(input, text);
            } else {
                input.value = text;
            }
        } else {
            input.textContent = text;
        }
        dispatchEditableEvents(input);
        return input;
    }

    function clickElement(element) {
        const view = typeof window !== 'undefined' ? window : null;
        ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach((type) => {
            element.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view }));
        });
    }

    function candidateSignature(candidate) {
        return [candidate.src, candidate.href || '', candidate.alt || ''].join('|');
    }

    function collectChatGptImageCandidates(options = {}) {
        const documentRef = getDocument(options);
        if (!documentRef) return [];

        return Array.from(documentRef.querySelectorAll('img'))
            .map((img) => {
                const rect = typeof img.getBoundingClientRect === 'function'
                    ? img.getBoundingClientRect()
                    : { left: 0, top: 0, width: 0, height: 0 };
                const anchor = img.closest('a');
                const candidate = {
                    src: String(img.currentSrc || img.src || '').trim(),
                    alt: img.getAttribute('alt') || '',
                    href: anchor ? String(anchor.href || '') : '',
                    naturalWidth: img.naturalWidth || 0,
                    naturalHeight: img.naturalHeight || 0,
                    rect: {
                        left: rect.left,
                        top: rect.top,
                        width: rect.width,
                        height: rect.height
                    }
                };
                return {
                    ...candidate,
                    signature: candidateSignature(candidate)
                };
            })
            .filter((candidate) => {
                if (!candidate.src) return false;
                if (candidate.src.startsWith('data:image/gif;base64,R0lGODlhAQABA')) return false;
                if (candidate.rect.width <= 0 || candidate.rect.height <= 0) return false;
                if (candidate.naturalWidth > 0 && candidate.naturalWidth < 128) return false;
                if (candidate.naturalHeight > 0 && candidate.naturalHeight < 128) return false;
                return true;
            });
    }

    function createChatGptResultSnapshot(options = {}) {
        const candidates = collectChatGptImageCandidates(options);
        return {
            createdAt: Date.now(),
            signatures: candidates.map((candidate) => candidate.signature),
            candidates
        };
    }

    function diffChatGptResultCandidates(snapshot, candidates = []) {
        const known = new Set((snapshot && snapshot.signatures) || []);
        const seen = new Set();
        return candidates.filter((candidate) => {
            if (!candidate.signature || known.has(candidate.signature) || seen.has(candidate.signature)) return false;
            seen.add(candidate.signature);
            return true;
        });
    }

    function readChatGptPromptInput(options = {}) {
        const input = findChatGptPromptInput(options);
        if (!input) return '';
        if ('value' in input) return String(input.value || '').trim();
        return String(input.textContent || '').trim();
    }

    function assertNoVisibleBlocker(options = {}) {
        const documentRef = getDocument(options);
        if (!documentRef || !documentRef.body) return;
        const text = String(documentRef.body.innerText || documentRef.body.textContent || '');
        if (/log in|sign up|upgrade|captcha|rate limit|usage limit|try again later/i.test(text)) {
            throw fail('chatgpt_blocked');
        }
    }

    function waitForCondition(predicate, options = {}) {
        const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 180000;
        const intervalMs = Number.isFinite(options.intervalMs) ? options.intervalMs : 500;

        return new Promise((resolve, reject) => {
            let settled = false;
            let pollTimer = null;
            const deadlineTimer = setTimeout(
                () => finish(null, fail(options.timeoutError || 'chatgpt_result_timeout')),
                timeoutMs
            );

            function finish(value, error) {
                if (settled) return;
                settled = true;
                clearTimeout(deadlineTimer);
                if (pollTimer) clearTimeout(pollTimer);
                if (error) reject(error);
                else resolve(value);
            }

            function poll() {
                Promise.resolve()
                    .then(() => predicate())
                    .then((value) => {
                        if (settled) return;
                        if (value) {
                            finish(value);
                            return;
                        }
                        pollTimer = setTimeout(poll, intervalMs);
                    })
                    .catch((error) => finish(null, error));
            }

            poll();
        });
    }

    async function runChatGptImagePrompt(request = {}, options = {}) {
        const prompt = String(request.prompt || '').trim();
        if (!prompt) throw fail('chatgpt_prompt_empty');

        assertNoVisibleBlocker(options);
        const before = createChatGptResultSnapshot(options);
        fillChatGptPromptInput(prompt, options);

        const send = findChatGptSendButton(options);
        if (!send) throw fail('chatgpt_send_missing');
        if (send.disabled || send.getAttribute('aria-disabled') === 'true') throw fail('chatgpt_send_disabled');

        clickElement(send);
        if (typeof request.afterSubmit === 'function') await request.afterSubmit();

        const result = await waitForCondition(() => {
            const delta = diffChatGptResultCandidates(before, collectChatGptImageCandidates(options));
            return delta[0] || null;
        }, {
            timeoutMs: request.timeoutMs,
            intervalMs: request.intervalMs,
            timeoutError: 'chatgpt_result_timeout'
        });

        return {
            ok: true,
            providerId: 'chatgpt-images',
            workflow: 'text-to-image',
            prompt,
            submitted: true,
            result
        };
    }

    async function waitForChatGptResultDelta(snapshot, request = {}, options = {}) {
        const result = await waitForCondition(() => {
            const delta = diffChatGptResultCandidates(snapshot, collectChatGptImageCandidates(options));
            return delta[0] || null;
        }, {
            timeoutMs: request.timeoutMs,
            intervalMs: request.intervalMs,
            timeoutError: 'chatgpt_result_timeout'
        });

        return {
            ok: true,
            providerId: 'chatgpt-images',
            workflow: 'text-to-image',
            submitted: true,
            result
        };
    }

    return {
        collectChatGptImageCandidates,
        createChatGptResultSnapshot,
        diffChatGptResultCandidates,
        fillChatGptPromptInput,
        findChatGptPromptInput,
        findChatGptSendButton,
        readChatGptPromptInput,
        runChatGptImagePrompt,
        waitForChatGptResultDelta,
        waitForCondition
    };
});
