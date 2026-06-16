const utils = require('../../recreateWorkflowUtils.js');
const {
    RecreateWorkflowContentBridge
} = require('../../content.js');
const {
    collectGeneratedImageCandidates,
    dataUrlToFile,
    ensureGrokSearchEnabled,
    extractAssistantPromptFromPage,
    fetchViaBridgeAsDataUrl,
    fetchViaBridgeAsBlobUrl,
    hasUploadPreview,
    injectEditorText,
    readBlobAsDataUrl,
    readFileAsRecreateReference,
    runChatPromptStep,
    runImagineSubmitStep,
    selectCurrentGeneratedImage,
    sourceToDataUrl,
    submitVisibleButton,
    uploadReferenceFile,
    setFileInputFiles,
    waitForCondition
} = require('../../recreateWorkflowContent.js');

const originalFetch = global.fetch;
const CLICK_EVENT_SEQUENCE = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'];

function makeVisibleElement(element) {
    element.getBoundingClientRect = () => ({ width: 240, height: 48, left: 0, top: 0 });
    return element;
}

function createVisibleComposer() {
    const composer = document.createElement('div');
    composer.getBoundingClientRect = () => ({ width: 640, height: 128, left: 80, top: 420 });
    document.body.appendChild(composer);
    return composer;
}

function appendVisibleGrokEditor(container) {
    const editor = document.createElement('textarea');
    editor.setAttribute('aria-label', 'Ask Grok anything');
    makeVisibleElement(editor);
    container.appendChild(editor);
    return editor;
}

function recordClickEvents(element) {
    const events = [];
    CLICK_EVENT_SEQUENCE.forEach((type) => {
        element.addEventListener(type, (event) => {
            events.push({
                type,
                clientX: event.clientX,
                clientY: event.clientY
            });
        });
    });
    return events;
}

describe('recreate content helpers', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        jest.restoreAllMocks();
    });

    afterEach(() => {
        if (typeof originalFetch === 'undefined') {
            delete global.fetch;
        } else {
            global.fetch = originalFetch;
        }
    });

    test('reads local files into normalized references', async () => {
        const file = new File(['hello'], 'sample.png', { type: 'image/png' });
        const reference = await readFileAsRecreateReference(file, 'local');

        expect(reference).toEqual(
            expect.objectContaining({
                name: 'sample.png',
                mimeType: 'image/png',
                source: 'local',
                byteLength: 5
            })
        );
        expect(reference.dataUrl).toMatch(/^data:image\/png;base64,/);
    });

    test('fails when a reference file is missing', async () => {
        await expect(readFileAsRecreateReference(null, 'local')).rejects.toThrow('reference_missing');
    });

    test('reads blobs as data URLs', async () => {
        const dataUrl = await readBlobAsDataUrl(new Blob(['hello'], { type: 'image/png' }));

        expect(dataUrl).toBe('data:image/png;base64,aGVsbG8=');
    });

    test('recreates a File from normalized reference data', () => {
        const file = dataUrlToFile({
            name: 'reference.png',
            mimeType: 'image/png',
            dataUrl: 'data:image/png;base64,aGVsbG8=',
            source: 'drop'
        });

        expect(file.name).toBe('reference.png');
        expect(file.type).toBe('image/png');
        expect(file.size).toBe(5);
    });

    test('collects visible generated image candidates', () => {
        const img = document.createElement('img');
        img.alt = 'Generated image';
        img.src = 'data:image/png;base64,aGVsbG8=';
        Object.defineProperty(img, 'naturalWidth', { value: 720 });
        Object.defineProperty(img, 'naturalHeight', { value: 720 });
        img.getBoundingClientRect = () => ({ left: 400, top: 300, width: 200, height: 200 });
        document.body.appendChild(img);

        const hidden = document.createElement('img');
        hidden.alt = 'Generated image';
        hidden.src = 'data:image/png;base64,aGVsbG8=';
        Object.defineProperty(hidden, 'naturalWidth', { value: 720 });
        Object.defineProperty(hidden, 'naturalHeight', { value: 720 });
        hidden.getBoundingClientRect = () => ({ left: 0, top: 0, width: 0, height: 200 });
        document.body.appendChild(hidden);

        const candidates = collectGeneratedImageCandidates(document);
        expect(candidates).toHaveLength(1);
        expect(candidates[0]).toEqual(
            expect.objectContaining({
                src: 'data:image/png;base64,aGVsbG8=',
                alt: 'Generated image',
                naturalWidth: 720,
                naturalHeight: 720
            })
        );
    });

    test('selects the current generated image using shared scoring', async () => {
        const img = document.createElement('img');
        img.alt = 'Generated image';
        img.src = 'data:image/png;base64,aGVsbG8=';
        Object.defineProperty(img, 'naturalWidth', { value: 720 });
        Object.defineProperty(img, 'naturalHeight', { value: 720 });
        img.getBoundingClientRect = () => ({ left: 400, top: 300, width: 200, height: 200 });
        document.body.appendChild(img);

        const selected = await selectCurrentGeneratedImage({ documentRef: document, utils });
        expect(selected).toEqual(
            expect.objectContaining({
                mimeType: 'image/png',
                source: 'current-grok-image',
                byteLength: 5
            })
        );
    });

    test('throws reference_missing when no current generated image is available', async () => {
        await expect(selectCurrentGeneratedImage({ documentRef: document, utils })).rejects.toThrow(
            'reference_missing'
        );
    });

    test('fetches trusted Grok media through the existing bridge event', async () => {
        const listener = jest.fn((event) => {
            document.dispatchEvent(
                new CustomEvent('__gpt_fetch_media_result', {
                    detail: {
                        requestId: event.detail.requestId,
                        blobUrl: 'blob:test-reference'
                    }
                })
            );
        });
        document.addEventListener('__gpt_fetch_media', listener);

        try {
            await expect(
                fetchViaBridgeAsBlobUrl('https://assets.grok.com/users/test/image.png', {
                    documentRef: document,
                    timeoutMs: 100
                })
            ).resolves.toBe('blob:test-reference');
            expect(listener).toHaveBeenCalledTimes(1);
        } finally {
            document.removeEventListener('__gpt_fetch_media', listener);
        }
    });

    test('fetches trusted Grok media data URLs through the data URL bridge event', async () => {
        const listener = jest.fn((event) => {
            document.dispatchEvent(
                new CustomEvent('__gpt_fetch_media_data_url_result', {
                    detail: {
                        requestId: event.detail.requestId,
                        dataUrl: 'data:image/png;base64,aGVsbG8=',
                        size: 5,
                        type: 'image/png'
                    }
                })
            );
        });
        document.addEventListener('__gpt_fetch_media_data_url', listener);

        try {
            await expect(
                fetchViaBridgeAsDataUrl('https://assets.grok.com/users/test/image.png', {
                    documentRef: document,
                    timeoutMs: 100
                })
            ).resolves.toBe('data:image/png;base64,aGVsbG8=');
            expect(listener).toHaveBeenCalledTimes(1);
            expect(listener.mock.calls[0][0].detail.url).toBe('https://assets.grok.com/users/test/image.png');
        } finally {
            document.removeEventListener('__gpt_fetch_media_data_url', listener);
        }
    });

    test('sourceToDataUrl dispatches __gpt_fetch_media_data_url and resolves the returned data URL', async () => {
        const listener = jest.fn((event) => {
            document.dispatchEvent(
                new CustomEvent('__gpt_fetch_media_data_url_result', {
                    detail: {
                        requestId: event.detail.requestId,
                        dataUrl: 'data:image/png;base64,aGVsbG8='
                    }
                })
            );
        });
        document.addEventListener('__gpt_fetch_media_data_url', listener);
        global.fetch = jest.fn();

        try {
            await expect(
                sourceToDataUrl('https://assets.grok.com/users/test/image.png', {
                    documentRef: document,
                    timeoutMs: 100,
                    utils
                })
            ).resolves.toBe('data:image/png;base64,aGVsbG8=');
            expect(listener).toHaveBeenCalledTimes(1);
            expect(listener.mock.calls[0][0].type).toBe('__gpt_fetch_media_data_url');
            expect(listener.mock.calls[0][0].detail.url).toBe('https://assets.grok.com/users/test/image.png');
            expect(global.fetch).not.toHaveBeenCalled();
        } finally {
            document.removeEventListener('__gpt_fetch_media_data_url', listener);
        }
    });

    test('maps trusted media bridge failures to reference_capture_failed', async () => {
        const listener = jest.fn((event) => {
            document.dispatchEvent(
                new CustomEvent('__gpt_fetch_media_data_url_result', {
                    detail: {
                        requestId: event.detail.requestId,
                        error: 'network failed'
                    }
                })
            );
        });
        document.addEventListener('__gpt_fetch_media_data_url', listener);

        try {
            await expect(
                sourceToDataUrl('https://assets.grok.com/users/test/image.png', {
                    documentRef: document,
                    timeoutMs: 100,
                    utils
                })
            ).rejects.toMatchObject({
                message: 'reference_capture_failed',
                code: 'reference_capture_failed'
            });
            expect(listener).toHaveBeenCalledTimes(1);
        } finally {
            document.removeEventListener('__gpt_fetch_media_data_url', listener);
        }
    });

    test('rejects malformed trusted media data URL bridge results', async () => {
        const listener = jest.fn((event) => {
            document.dispatchEvent(
                new CustomEvent('__gpt_fetch_media_data_url_result', {
                    detail: {
                        requestId: event.detail.requestId,
                        dataUrl: 'not-a-data-url'
                    }
                })
            );
        });
        document.addEventListener('__gpt_fetch_media_data_url', listener);

        try {
            await expect(
                fetchViaBridgeAsDataUrl('https://assets.grok.com/users/test/image.png', {
                    documentRef: document,
                    timeoutMs: 100
                })
            ).rejects.toMatchObject({
                message: 'reference_capture_failed',
                code: 'reference_capture_failed'
            });
        } finally {
            document.removeEventListener('__gpt_fetch_media_data_url', listener);
        }
    });

    test('times out trusted media data URL bridge fetches', async () => {
        await expect(
            fetchViaBridgeAsDataUrl('https://assets.grok.com/users/test/image.png', {
                documentRef: document,
                timeoutMs: 1
            })
        ).rejects.toMatchObject({
            message: 'reference_capture_failed',
            code: 'reference_capture_failed'
        });
    });

    test('waitForCondition resolves when predicate becomes true', async () => {
        let count = 0;
        const result = await waitForCondition(
            () => {
                count++;
                return count > 1 ? 'ready' : null;
            },
            { timeoutMs: 100, intervalMs: 1 }
        );

        expect(result).toBe('ready');
    });

    test('waitForCondition times out while an async predicate is still pending', async () => {
        await expect(
            waitForCondition(() => new Promise(() => {}), {
                timeoutMs: 10,
                intervalMs: 1,
                timeoutError: 'predicate_timeout'
            })
        ).rejects.toMatchObject({
            message: 'predicate_timeout',
            code: 'predicate_timeout'
        });
    });
});

describe('recreate content DOM actions', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        jest.restoreAllMocks();
    });

    test('sets files on a hidden file input and dispatches change', () => {
        const originalDataTransfer = global.DataTransfer;
        Reflect.deleteProperty(global, 'DataTransfer');

        const input = document.createElement('input');
        input.type = 'file';
        const inputHandler = jest.fn();
        const changeHandler = jest.fn();
        input.addEventListener('input', inputHandler);
        input.addEventListener('change', changeHandler);
        document.body.appendChild(input);

        const file = new File(['hello'], 'reference.png', { type: 'image/png' });

        try {
            setFileInputFiles(input, file);
        } finally {
            if (originalDataTransfer) {
                global.DataTransfer = originalDataTransfer;
            }
        }

        expect(input.files).toHaveLength(1);
        expect(input.files[0].name).toBe('reference.png');
        expect(inputHandler).toHaveBeenCalledTimes(1);
        expect(changeHandler).toHaveBeenCalledTimes(1);
    });

    test('injects editor text through textarea input events', () => {
        const textarea = document.createElement('textarea');
        textarea.setAttribute('aria-label', 'Ask Grok anything');
        makeVisibleElement(textarea);
        const inputHandler = jest.fn();
        const changeHandler = jest.fn();
        textarea.addEventListener('input', inputHandler);
        textarea.addEventListener('change', changeHandler);
        document.body.appendChild(textarea);

        expect(injectEditorText('hello', document)).toBe(true);
        expect(textarea.value).toBe('hello');
        expect(inputHandler).toHaveBeenCalledTimes(1);
        expect(changeHandler).toHaveBeenCalledTimes(1);
    });

    test('injects editor text through bridge event for contenteditable editors', () => {
        const editor = document.createElement('div');
        editor.contentEditable = 'true';
        editor.setAttribute('aria-label', 'Ask Grok anything');
        makeVisibleElement(editor);
        document.body.appendChild(editor);

        const bridgeSpy = jest.fn();
        document.addEventListener('__gpt_set_editor_content', bridgeSpy);

        try {
            expect(injectEditorText('hello', document)).toBe(true);
            expect(bridgeSpy).toHaveBeenCalledTimes(1);
            expect(bridgeSpy.mock.calls[0][0].detail).toEqual({ text: 'hello' });
        } finally {
            document.removeEventListener('__gpt_set_editor_content', bridgeSpy);
        }
    });

    test('does not inject into unrelated textarea or contenteditable editors', () => {
        const textarea = document.createElement('textarea');
        textarea.setAttribute('aria-label', 'Write a comment');
        makeVisibleElement(textarea);
        document.body.appendChild(textarea);

        const editor = document.createElement('div');
        editor.contentEditable = 'true';
        editor.setAttribute('aria-label', 'Message');
        makeVisibleElement(editor);
        document.body.appendChild(editor);

        const bridgeSpy = jest.fn();
        document.addEventListener('__gpt_set_editor_content', bridgeSpy);

        try {
            expect(injectEditorText('hello', document)).toBe(false);
            expect(textarea.value).toBe('');
            expect(bridgeSpy).not.toHaveBeenCalled();
        } finally {
            document.removeEventListener('__gpt_set_editor_content', bridgeSpy);
        }
    });

    test('does not inject into zero-size Grok-labeled editors', () => {
        const textarea = document.createElement('textarea');
        textarea.setAttribute('aria-label', 'Ask Grok anything');
        textarea.getBoundingClientRect = () => ({ width: 0, height: 0, left: 0, top: 0 });
        document.body.appendChild(textarea);

        const editor = document.createElement('div');
        editor.contentEditable = 'true';
        editor.setAttribute('aria-label', 'Ask Grok anything');
        editor.getBoundingClientRect = () => ({ width: 0, height: 0, left: 0, top: 0 });
        document.body.appendChild(editor);

        const bridgeSpy = jest.fn();
        document.addEventListener('__gpt_set_editor_content', bridgeSpy);

        try {
            expect(injectEditorText('hello', document)).toBe(false);
            expect(textarea.value).toBe('');
            expect(bridgeSpy).not.toHaveBeenCalled();
        } finally {
            document.removeEventListener('__gpt_set_editor_content', bridgeSpy);
        }
    });

    test('clicks enabled visible submit buttons only by aria-label', () => {
        const hidden = document.createElement('button');
        hidden.setAttribute('aria-label', 'Submit');
        hidden.disabled = false;
        hidden.getBoundingClientRect = () => ({ width: 0, height: 0, left: 0, top: 0 });
        const hiddenEvents = recordClickEvents(hidden);
        document.body.appendChild(hidden);

        const disabled = document.createElement('button');
        disabled.setAttribute('aria-label', 'Send');
        disabled.disabled = true;
        disabled.getBoundingClientRect = () => ({ width: 40, height: 40, left: 0, top: 0 });
        const disabledEvents = recordClickEvents(disabled);
        document.body.appendChild(disabled);

        const visible = document.createElement('button');
        visible.setAttribute('aria-label', 'Send');
        visible.disabled = false;
        visible.getBoundingClientRect = () => ({ width: 40, height: 40, left: 0, top: 0 });
        const visibleEvents = recordClickEvents(visible);
        document.body.appendChild(visible);

        expect(submitVisibleButton(['Submit', 'Send'], document)).toBe(true);
        expect(hiddenEvents).toEqual([]);
        expect(disabledEvents).toEqual([]);
        expect(visibleEvents.map((event) => event.type)).toEqual(CLICK_EVENT_SEQUENCE);
        expect(visibleEvents).toEqual(
            CLICK_EVENT_SEQUENCE.map((type) => ({
                type,
                clientX: 20,
                clientY: 20
            }))
        );
    });

    test('verifies active Grok Search without clicking when already active', () => {
        const composer = createVisibleComposer();
        appendVisibleGrokEditor(composer);

        const search = document.createElement('button');
        search.setAttribute('aria-label', 'Search');
        search.setAttribute('aria-pressed', 'true');
        search.getBoundingClientRect = () => ({ width: 40, height: 40, left: 0, top: 0 });
        const searchEvents = recordClickEvents(search);
        composer.appendChild(search);

        expect(ensureGrokSearchEnabled(document)).toBe(true);
        expect(searchEvents).toEqual([]);
    });

    test('clicks Grok Search only when needed and verifies active state', () => {
        const composer = createVisibleComposer();
        appendVisibleGrokEditor(composer);

        const search = document.createElement('button');
        search.setAttribute('aria-label', 'Search');
        search.setAttribute('aria-pressed', 'false');
        search.getBoundingClientRect = () => ({ width: 40, height: 40, left: 0, top: 0 });
        const searchEvents = recordClickEvents(search);
        search.addEventListener('click', () => {
            search.setAttribute('aria-pressed', 'true');
        });
        composer.appendChild(search);

        expect(ensureGrokSearchEnabled(document)).toBe(true);
        expect(searchEvents.map((event) => event.type)).toEqual(CLICK_EVENT_SEQUENCE);
    });

    test('fails when Grok Search cannot be verified as active', () => {
        const composer = createVisibleComposer();
        appendVisibleGrokEditor(composer);

        const search = document.createElement('button');
        search.setAttribute('aria-label', 'Search');
        search.getBoundingClientRect = () => ({ width: 40, height: 40, left: 0, top: 0 });
        const searchEvents = recordClickEvents(search);
        composer.appendChild(search);

        expect(() => ensureGrokSearchEnabled(document)).toThrow('chat_search_unavailable');
        expect(searchEvents.map((event) => event.type)).toEqual(CLICK_EVENT_SEQUENCE);
    });

    test('ignores global Search outside the visible composer region', () => {
        const globalSearch = document.createElement('button');
        globalSearch.setAttribute('aria-label', 'Search');
        globalSearch.setAttribute('data-active', 'false');
        globalSearch.setAttribute('data-state', 'closed');
        globalSearch.getBoundingClientRect = () => ({ width: 40, height: 40, left: 10, top: 58 });
        const globalSearchEvents = recordClickEvents(globalSearch);
        document.body.appendChild(globalSearch);

        const composer = createVisibleComposer();
        appendVisibleGrokEditor(composer);

        expect(() => ensureGrokSearchEnabled(document)).toThrow('chat_search_unavailable');
        expect(globalSearchEvents).toEqual([]);
    });

    test('uploads a reference file and detects upload preview', () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/png';
        document.body.appendChild(input);

        expect(
            uploadReferenceFile(
                {
                    name: 'reference.png',
                    mimeType: 'image/png',
                    dataUrl: 'data:image/png;base64,aGVsbG8=',
                    source: 'local'
                },
                document
            )
        ).toBe(true);
        expect(input.files).toHaveLength(1);

        const preview = document.createElement('img');
        preview.src = 'blob:uploaded-reference';
        Object.defineProperty(preview, 'naturalWidth', { value: 120 });
        Object.defineProperty(preview, 'naturalHeight', { value: 90 });
        preview.getBoundingClientRect = () => ({ width: 120, height: 90, left: 0, top: 0 });
        document.body.appendChild(preview);

        expect(hasUploadPreview(document)).toBe(true);
    });

    test('throws named errors for missing upload input and missing prompt marker', () => {
        expect(() =>
            uploadReferenceFile(
                {
                    name: 'reference.png',
                    mimeType: 'image/png',
                    dataUrl: 'data:image/png;base64,aGVsbG8=',
                    source: 'local'
                },
                document
            )
        ).toThrow('chat_upload_input_missing');
        expect(() => extractAssistantPromptFromPage(document)).toThrow('chat_prompt_marker_missing');
    });

    test('extracts assistant answer text with final prompt marker', () => {
        const answer = document.createElement('div');
        answer.setAttribute('data-testid', 'assistant-message');
        answer.textContent = 'FINAL_IMAGINE_PROMPT:\nA red cabin in snow.';
        document.body.appendChild(answer);

        expect(extractAssistantPromptFromPage(document)).toBe('A red cabin in snow.');
    });

    test('runChatPromptStep uploads, injects, submits, and extracts generated prompt', async () => {
        const composer = createVisibleComposer();
        const editor = appendVisibleGrokEditor(composer);

        const search = document.createElement('button');
        search.setAttribute('aria-label', 'Search');
        search.setAttribute('data-state', 'unchecked');
        search.getBoundingClientRect = () => ({ width: 40, height: 40, left: 0, top: 0 });
        const searchEvents = recordClickEvents(search);
        search.addEventListener('click', () => {
            search.setAttribute('data-state', 'checked');
        });
        composer.appendChild(search);

        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/png';
        input.addEventListener('change', () => {
            const preview = document.createElement('img');
            preview.src = 'blob:uploaded-reference';
            Object.defineProperty(preview, 'naturalWidth', { value: 120 });
            Object.defineProperty(preview, 'naturalHeight', { value: 90 });
            preview.getBoundingClientRect = () => ({ width: 120, height: 90, left: 0, top: 0 });
            document.body.appendChild(preview);
        });
        document.body.appendChild(input);

        const submit = document.createElement('button');
        submit.setAttribute('aria-label', 'Send');
        submit.disabled = false;
        submit.getBoundingClientRect = () => ({ width: 40, height: 40, left: 0, top: 0 });
        const submitEvents = recordClickEvents(submit);
        submit.addEventListener('click', () => {
            const answer = document.createElement('div');
            answer.setAttribute('data-testid', 'assistant-message');
            answer.textContent = 'FINAL_IMAGINE_PROMPT:\nA red cabin in snow.';
            document.body.appendChild(answer);
        });
        document.body.appendChild(submit);

        const result = await runChatPromptStep(
            {
                runId: 'recreate_1',
                reference: {
                    name: 'reference.png',
                    mimeType: 'image/png',
                    dataUrl: 'data:image/png;base64,aGVsbG8=',
                    source: 'local'
                },
                bestPracticesEnabled: true
            },
            { documentRef: document, timeoutMs: 100, intervalMs: 1 }
        );

        expect(result).toEqual({ ok: true, runId: 'recreate_1', generatedPrompt: 'A red cabin in snow.' });
        expect(searchEvents.map((event) => event.type)).toEqual(CLICK_EVENT_SEQUENCE);
        expect(editor.value).toContain('FINAL_IMAGINE_PROMPT:');
        expect(submitEvents.map((event) => event.type)).toEqual(CLICK_EVENT_SEQUENCE);
    });

    test('runChatPromptStep fails when upload preview is missing', async () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/png';
        document.body.appendChild(input);

        await expect(
            runChatPromptStep(
                {
                    runId: 'recreate_1',
                    reference: {
                        name: 'reference.png',
                        mimeType: 'image/png',
                        dataUrl: 'data:image/png;base64,aGVsbG8=',
                        source: 'local'
                    },
                    bestPracticesEnabled: false
                },
                { documentRef: document, uploadPreviewTimeoutMs: 10, intervalMs: 1 }
            )
        ).rejects.toThrow('chat_upload_preview_missing');
    });

    test('runChatPromptStep ignores preexisting matching upload previews', async () => {
        const stalePreview = document.createElement('img');
        stalePreview.src = 'blob:old-upload-preview';
        Object.defineProperty(stalePreview, 'naturalWidth', { value: 120 });
        Object.defineProperty(stalePreview, 'naturalHeight', { value: 90 });
        stalePreview.getBoundingClientRect = () => ({ width: 120, height: 90, left: 0, top: 0 });
        document.body.appendChild(stalePreview);

        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/png';
        document.body.appendChild(input);

        await expect(
            runChatPromptStep(
                {
                    runId: 'recreate_1',
                    reference: {
                        name: 'reference.png',
                        mimeType: 'image/png',
                        dataUrl: 'data:image/png;base64,aGVsbG8=',
                        source: 'local'
                    },
                    bestPracticesEnabled: false
                },
                { documentRef: document, uploadPreviewTimeoutMs: 10, intervalMs: 1 }
            )
        ).rejects.toThrow('chat_upload_preview_missing');
    });

    test('runChatPromptStep fails when editor is missing', async () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/png';
        input.addEventListener('change', () => {
            const preview = document.createElement('img');
            preview.src = 'blob:uploaded-reference';
            Object.defineProperty(preview, 'naturalWidth', { value: 120 });
            Object.defineProperty(preview, 'naturalHeight', { value: 90 });
            preview.getBoundingClientRect = () => ({ width: 120, height: 90, left: 0, top: 0 });
            document.body.appendChild(preview);
        });
        document.body.appendChild(input);

        await expect(
            runChatPromptStep(
                {
                    runId: 'recreate_1',
                    reference: {
                        name: 'reference.png',
                        mimeType: 'image/png',
                        dataUrl: 'data:image/png;base64,aGVsbG8=',
                        source: 'local'
                    },
                    bestPracticesEnabled: false
                },
                { documentRef: document, timeoutMs: 100, intervalMs: 1 }
            )
        ).rejects.toThrow('chat_editor_missing');
    });

    test('runChatPromptStep fails when submit is missing', async () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/png';
        input.addEventListener('change', () => {
            const preview = document.createElement('img');
            preview.src = 'blob:uploaded-reference';
            Object.defineProperty(preview, 'naturalWidth', { value: 120 });
            Object.defineProperty(preview, 'naturalHeight', { value: 90 });
            preview.getBoundingClientRect = () => ({ width: 120, height: 90, left: 0, top: 0 });
            document.body.appendChild(preview);
        });
        document.body.appendChild(input);

        const editor = document.createElement('textarea');
        editor.setAttribute('aria-label', 'Ask Grok anything');
        makeVisibleElement(editor);
        document.body.appendChild(editor);

        await expect(
            runChatPromptStep(
                {
                    runId: 'recreate_1',
                    reference: {
                        name: 'reference.png',
                        mimeType: 'image/png',
                        dataUrl: 'data:image/png;base64,aGVsbG8=',
                        source: 'local'
                    },
                    bestPracticesEnabled: false
                },
                { documentRef: document, submitTimeoutMs: 10, intervalMs: 1 }
            )
        ).rejects.toThrow('chat_submit_missing');
    });

    test('runChatPromptStep fails when assistant answer never appears', async () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/png';
        input.addEventListener('change', () => {
            const preview = document.createElement('img');
            preview.src = 'blob:uploaded-reference';
            Object.defineProperty(preview, 'naturalWidth', { value: 120 });
            Object.defineProperty(preview, 'naturalHeight', { value: 90 });
            preview.getBoundingClientRect = () => ({ width: 120, height: 90, left: 0, top: 0 });
            document.body.appendChild(preview);
        });
        document.body.appendChild(input);

        const editor = document.createElement('textarea');
        editor.setAttribute('aria-label', 'Ask Grok anything');
        makeVisibleElement(editor);
        document.body.appendChild(editor);

        const submit = document.createElement('button');
        submit.setAttribute('aria-label', 'Submit');
        submit.disabled = false;
        submit.getBoundingClientRect = () => ({ width: 40, height: 40, left: 0, top: 0 });
        const submitEvents = recordClickEvents(submit);
        document.body.appendChild(submit);

        await expect(
            runChatPromptStep(
                {
                    runId: 'recreate_1',
                    reference: {
                        name: 'reference.png',
                        mimeType: 'image/png',
                        dataUrl: 'data:image/png;base64,aGVsbG8=',
                        source: 'local'
                    },
                    bestPracticesEnabled: false
                },
                { documentRef: document, timeoutMs: 10, intervalMs: 1 }
            )
        ).rejects.toThrow('chat_answer_timeout');
        expect(submitEvents.map((event) => event.type)).toEqual(CLICK_EVENT_SEQUENCE);
    });

    test('submits Imagine prompt after editor injection enables submit', async () => {
        const editor = document.createElement('div');
        editor.contentEditable = 'true';
        editor.setAttribute('aria-label', 'Ask Grok anything');
        makeVisibleElement(editor);
        document.body.appendChild(editor);

        const submit = document.createElement('button');
        submit.setAttribute('aria-label', 'Submit');
        submit.disabled = false;
        submit.getBoundingClientRect = () => ({ width: 40, height: 40, left: 0, top: 0 });
        const submitEvents = recordClickEvents(submit);
        document.body.appendChild(submit);

        const result = await runImagineSubmitStep(
            {
                runId: 'recreate_1',
                generatedPrompt: 'A red cabin in snow.',
                autoSubmit: true
            },
            { documentRef: document, timeoutMs: 100, intervalMs: 1 }
        );

        expect(result).toEqual({ ok: true, runId: 'recreate_1', submitted: true });
        expect(submitEvents.map((event) => event.type)).toEqual(CLICK_EVENT_SEQUENCE);
    });

    test('runImagineSubmitStep fails when submit stays disabled', async () => {
        const editor = document.createElement('div');
        editor.contentEditable = 'true';
        editor.setAttribute('aria-label', 'Ask Grok anything');
        makeVisibleElement(editor);
        document.body.appendChild(editor);

        const submit = document.createElement('button');
        submit.setAttribute('aria-label', 'Submit');
        submit.disabled = true;
        submit.getBoundingClientRect = () => ({ width: 40, height: 40, left: 0, top: 0 });
        const submitEvents = recordClickEvents(submit);
        document.body.appendChild(submit);

        await expect(
            runImagineSubmitStep(
                {
                    runId: 'recreate_1',
                    generatedPrompt: 'A red cabin in snow.',
                    autoSubmit: true
                },
                { documentRef: document, timeoutMs: 10, intervalMs: 1 }
            )
        ).rejects.toThrow('imagine_submit_disabled');
        expect(submitEvents).toEqual([]);
    });

    test('runImagineSubmitStep fails when Imagine editor is missing', async () => {
        await expect(
            runImagineSubmitStep(
                {
                    runId: 'recreate_1',
                    generatedPrompt: 'A red cabin in snow.',
                    autoSubmit: true
                },
                { documentRef: document, timeoutMs: 10, intervalMs: 1 }
            )
        ).rejects.toThrow('imagine_editor_missing');
    });

    test('runImagineSubmitStep maps submit click failures', async () => {
        const editor = document.createElement('div');
        editor.contentEditable = 'true';
        editor.setAttribute('aria-label', 'Ask Grok anything');
        makeVisibleElement(editor);
        document.body.appendChild(editor);

        const submit = document.createElement('button');
        submit.setAttribute('aria-label', 'Submit');
        submit.disabled = false;
        submit.getBoundingClientRect = () => ({ width: 40, height: 40, left: 0, top: 0 });
        const originalDispatchEvent = submit.dispatchEvent.bind(submit);
        submit.dispatchEvent = jest.fn((event) => {
            if (event.type === 'click') throw new Error('click failed');
            return originalDispatchEvent(event);
        });
        document.body.appendChild(submit);

        await expect(
            runImagineSubmitStep(
                {
                    runId: 'recreate_1',
                    generatedPrompt: 'A red cabin in snow.',
                    autoSubmit: true
                },
                { documentRef: document, timeoutMs: 100, intervalMs: 1 }
            )
        ).rejects.toThrow('imagine_submit_failed');
    });
});

describe('recreate content bridge', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        jest.restoreAllMocks();
    });

    test('async catch responses use content phase and page diagnostics without payload leakage', async () => {
        const listeners = [];
        const error = new Error('chat_upload_input_missing');
        error.code = 'chat_upload_input_missing';
        error.phase = 'chat';
        error.diagnostics = {
            dataUrl: 'data:image/png;base64,bGVhaw=='
        };
        const request = {
            action: 'GPT_RECREATE_CHAT_STEP',
            runId: 'recreate_1',
            reference: {
                name: 'source.png',
                mimeType: 'image/png',
                dataUrl: 'data:image/png;base64,aGVsbG8=',
                source: 'local'
            }
        };
        const actions = {
            runChatPromptStep: jest.fn(async () => {
                throw error;
            })
        };
        const chromeRuntime = {
            onMessage: {
                addListener: jest.fn((listener) => {
                    listeners.push(listener);
                })
            }
        };
        const bridge = new RecreateWorkflowContentBridge(null, null, {
            actions,
            chromeRuntime,
            documentRef: { title: 'Grok Chat' },
            locationRef: { href: 'https://grok.com/' }
        });

        bridge.setupListeners();
        const response = await new Promise((resolve) => {
            const keepAlive = listeners[0](request, {}, resolve);
            expect(keepAlive).toBe(true);
        });

        expect(actions.runChatPromptStep).toHaveBeenCalledWith(request);
        expect(response).toEqual({
            ok: false,
            runId: 'recreate_1',
            phase: 'content',
            error: 'chat_upload_input_missing',
            diagnostics: {
                url: 'https://grok.com/',
                title: 'Grok Chat'
            }
        });
        expect(JSON.stringify(response)).not.toContain('data:image/png');
        expect(JSON.stringify(response)).not.toContain('source.png');
    });

    test('async catch responses do not expose arbitrary generic error messages', async () => {
        const listeners = [];
        const request = {
            action: 'GPT_RECREATE_CHAT_STEP',
            runId: 'recreate_1',
            reference: {
                name: 'source.png',
                mimeType: 'image/png',
                dataUrl: 'data:image/png;base64,aGVsbG8=',
                source: 'local'
            }
        };
        const actions = {
            runChatPromptStep: jest.fn(async () => {
                throw new Error('raw prompt and data:image/png;base64,bGVhaw== leaked');
            })
        };
        const chromeRuntime = {
            onMessage: {
                addListener: jest.fn((listener) => {
                    listeners.push(listener);
                })
            }
        };
        const bridge = new RecreateWorkflowContentBridge(null, null, {
            actions,
            chromeRuntime,
            documentRef: { title: 'Grok Chat' },
            locationRef: { href: 'https://grok.com/' }
        });

        bridge.setupListeners();
        const response = await new Promise((resolve) => {
            const keepAlive = listeners[0](request, {}, resolve);
            expect(keepAlive).toBe(true);
        });

        expect(response).toEqual({
            ok: false,
            runId: 'recreate_1',
            phase: 'content',
            error: 'workflow_failed',
            diagnostics: {
                url: 'https://grok.com/',
                title: 'Grok Chat'
            }
        });
        expect(JSON.stringify(response)).not.toContain('data:image/png');
        expect(JSON.stringify(response)).not.toContain('raw prompt');
    });
});
