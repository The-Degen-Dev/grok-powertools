const utils = require('../../recreateWorkflowUtils.js');
const {
    RecreateWorkflowContentBridge
} = require('../../content.js');
const {
    collectGeneratedImageCandidates,
    collectGeneratedVideoCandidates,
    dataUrlToFile,
    ensureGrokSearchEnabled,
    extractAssistantPromptFromPage,
    fetchPublicImageAsDataUrl,
    fetchViaBackgroundAsDataUrl,
    fetchViaBridgeAsDataUrl,
    fetchViaBridgeAsBlobUrl,
    hasUploadPreview,
    injectEditorText,
    readBlobAsDataUrl,
    readFileAsRecreateReference,
    resolveReferenceForUpload,
    runChatPromptStep,
    runImaginePostValidationStep,
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
const LARGE_IMAGE_DATA_URL = `data:image/png;base64,${Buffer.alloc(12 * 1024, 1).toString('base64')}`;

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

function appendGeneratedImage(overrides = {}) {
    const img = document.createElement('img');
    img.alt = 'Generated image';
    img.src = overrides.src || 'https://assets.grok.com/users/sample/content?cache=1';
    Object.defineProperty(img, 'complete', {
        configurable: true,
        value: typeof overrides.complete === 'boolean' ? overrides.complete : true
    });
    Object.defineProperty(img, 'naturalWidth', {
        configurable: true,
        value: Number.isFinite(overrides.naturalWidth) ? overrides.naturalWidth : 1024
    });
    Object.defineProperty(img, 'naturalHeight', {
        configurable: true,
        value: Number.isFinite(overrides.naturalHeight) ? overrides.naturalHeight : 1024
    });
    img.getBoundingClientRect =
        overrides.getBoundingClientRect ||
        (() => ({ left: 320, top: 120, width: 320, height: 320 }));
    document.body.appendChild(img);
    return img;
}

function appendGeneratedVideo(overrides = {}) {
    const video = document.createElement('video');
    video.src = overrides.src || 'https://imagine-public.x.ai/imagine-public/share-videos/sample_1080_hd.mp4';
    Object.defineProperty(video, 'readyState', {
        configurable: true,
        value: Number.isFinite(overrides.readyState) ? overrides.readyState : 1
    });
    Object.defineProperty(video, 'duration', {
        configurable: true,
        value: Number.isFinite(overrides.duration) ? overrides.duration : 10
    });
    Object.defineProperty(video, 'videoWidth', {
        configurable: true,
        value: Number.isFinite(overrides.videoWidth) ? overrides.videoWidth : 720
    });
    Object.defineProperty(video, 'videoHeight', {
        configurable: true,
        value: Number.isFinite(overrides.videoHeight) ? overrides.videoHeight : 1280
    });
    video.getBoundingClientRect =
        overrides.getBoundingClientRect ||
        (() => ({ left: 320, top: 120, width: 320, height: 568 }));
    document.body.appendChild(video);
    return video;
}

function appendVisibleGrokEditor(container) {
    const editor = document.createElement('textarea');
    editor.setAttribute('aria-label', 'Ask Grok anything');
    makeVisibleElement(editor);
    container.appendChild(editor);
    return editor;
}

function installContentEditableBridge(documentRef = document) {
    const handler = (event) => {
        const editor = Array.from(
            documentRef.querySelectorAll('[contenteditable], [role="textbox"], div[aria-label], div[data-placeholder]')
        ).find((candidate) => {
            const editableState = String(candidate.getAttribute('contenteditable') || candidate.contentEditable || '').toLowerCase();
            return editableState === 'true' || editableState === 'plaintext-only' || candidate.isContentEditable;
        });
        if (editor) editor.textContent = String((event.detail && event.detail.text) || '');
    };

    documentRef.addEventListener('__gpt_set_editor_content', handler);
    return () => documentRef.removeEventListener('__gpt_set_editor_content', handler);
}

function installMediaDataUrlBridge(dataUrl = LARGE_IMAGE_DATA_URL, documentRef = document) {
    const handler = (event) => {
        const requestId = event.detail && event.detail.requestId;
        documentRef.dispatchEvent(
            new CustomEvent('__gpt_fetch_media_data_url_result', {
                detail: {
                    requestId,
                    dataUrl,
                    size: 12 * 1024,
                    type: 'image/png'
                }
            })
        );
    };

    documentRef.addEventListener('__gpt_fetch_media_data_url', handler);
    return () => documentRef.removeEventListener('__gpt_fetch_media_data_url', handler);
}

function createVideoSamplingDocument() {
    const drawImage = jest.fn();
    const toDataURL = jest.fn(() => `data:image/jpeg;base64,${Buffer.from('contact-sheet').toString('base64')}`);
    const createVideo = () => {
        const video = {
            duration: 10.042,
            videoWidth: 464,
            videoHeight: 688,
            preload: '',
            muted: false,
            playsInline: false,
            onloadedmetadata: null,
            onseeked: null,
            onerror: null,
            removeAttribute: jest.fn()
        };
        Object.defineProperty(video, 'src', {
            set(value) {
                this._src = value;
                setTimeout(() => {
                    if (typeof this.onloadedmetadata === 'function') this.onloadedmetadata();
                }, 0);
            },
            get() {
                return this._src || '';
            }
        });
        Object.defineProperty(video, 'currentTime', {
            set(value) {
                this._currentTime = value;
                setTimeout(() => {
                    if (typeof this.onseeked === 'function') this.onseeked();
                }, 0);
            },
            get() {
                return this._currentTime || 0;
            }
        });
        return video;
    };

    return {
        drawImage,
        toDataURL,
        documentRef: {
            createElement(tagName) {
                if (tagName === 'video') return createVideo();
                if (tagName === 'canvas') {
                    return {
                        width: 0,
                        height: 0,
                        getContext: jest.fn(() => ({ drawImage })),
                        toDataURL
                    };
                }
                return document.createElement(tagName);
            }
        }
    };
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
        delete global.chrome;
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

    test('reads local video files into normalized video references', async () => {
        const file = new File(['video'], 'sample.mp4', { type: 'video/mp4' });
        const reference = await readFileAsRecreateReference(file, 'local');

        expect(reference).toEqual(
            expect.objectContaining({
                kind: 'video',
                name: 'sample.mp4',
                mimeType: 'video/mp4',
                source: 'local',
                byteLength: 5
            })
        );
        expect(reference.dataUrl).toMatch(/^data:video\/mp4;base64,/);
    });

    test('stores sampled local video contact sheets when a frame sampler is available', async () => {
        const { documentRef } = createVideoSamplingDocument();
        const frameSampler = jest.fn(() => Promise.resolve({
            contactSheetDataUrl: `data:image/jpeg;base64,${Buffer.from('contact-sheet').toString('base64')}`,
            frameSampleCount: 7,
            sampleTimesSec: [0, 1.665, 3.331, 4.996, 6.661, 8.326, 9.992],
            contactSheetWidth: 720,
            contactSheetHeight: 512,
            contactSheetMimeType: 'image/jpeg'
        }));
        const reference = utils.normalizeRecreateReference({
            kind: 'video',
            name: 'sample.mp4',
            mimeType: 'video/mp4',
            source: 'local',
            dataUrl: `data:video/mp4;base64,${Buffer.from('video').toString('base64')}`
        });

        const resolved = await resolveReferenceForUpload(reference, {
            documentRef,
            utils,
            metadataProbeTimeoutMs: 100,
            frameSamplingTimeoutMs: 100,
            frameSampler
        });

        expect(resolved.metadata).toEqual(expect.objectContaining({
            durationSec: 10.042,
            width: 464,
            height: 688,
            frameSampleCount: 7,
            frameSamplingLimited: false
        }));
        expect(resolved.frames).toEqual(expect.objectContaining({
            contactSheetDataUrl: expect.stringMatching(/^data:image\/jpeg;base64,/),
            frameSampleCount: 7,
            contactSheetMimeType: 'image/jpeg'
        }));
        expect(resolved.frames.sampleTimesSec).toHaveLength(7);
        expect(frameSampler).toHaveBeenCalledWith(reference.dataUrl, expect.objectContaining({
            frameSamplingTimeoutMs: 100
        }));
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

    test('recreates a File from normalized video reference data', () => {
        const file = dataUrlToFile({
            name: 'reference.mp4',
            kind: 'video',
            mimeType: 'video/mp4',
            dataUrl: 'data:video/mp4;base64,aGVsbG8=',
            source: 'drop'
        });

        expect(file.name).toBe('reference.mp4');
        expect(file.type).toBe('video/mp4');
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

    test('collects visible generated video candidates', () => {
        appendGeneratedVideo({
            src: 'https://imagine-public.x.ai/imagine-public/share-videos/sample_1080_hd.mp4',
            videoWidth: 464,
            videoHeight: 688
        });
        appendGeneratedVideo({
            src: 'https://imagine-public.x.ai/imagine-public/share-videos/hidden_1080_hd.mp4',
            getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 568 })
        });

        const candidates = collectGeneratedVideoCandidates(document);
        expect(candidates).toHaveLength(1);
        expect(candidates[0]).toEqual(
            expect.objectContaining({
                mediaKind: 'video',
                src: 'https://imagine-public.x.ai/imagine-public/share-videos/sample_1080_hd.mp4',
                videoWidth: 464,
                videoHeight: 688
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

    test('selects a public Grok post image when its alt text is the prompt', async () => {
        global.fetch = jest.fn(() =>
            Promise.resolve({
                ok: true,
                blob: () => Promise.resolve(new Blob(['image-bytes'], { type: 'image/jpeg' }))
            })
        );

        const img = document.createElement('img');
        img.alt = 'A striking minimalist abstract geometric artwork presented as a square with thick black frame.';
        img.src = 'https://imagine-public.x.ai/imagine-public/images/post-detail.jpg';
        Object.defineProperty(img, 'naturalWidth', { value: 720 });
        Object.defineProperty(img, 'naturalHeight', { value: 1280 });
        img.getBoundingClientRect = () => ({ left: 480, top: 120, width: 320, height: 568 });
        document.body.appendChild(img);

        const selected = await selectCurrentGeneratedImage({ documentRef: document, utils });

        expect(selected).toEqual(
            expect.objectContaining({
                mimeType: 'image/jpeg',
                source: 'current-grok-image',
                byteLength: 11
            })
        );
        expect(global.fetch).toHaveBeenCalledWith(
            'https://imagine-public.x.ai/imagine-public/images/post-detail.jpg',
            expect.objectContaining({ credentials: 'omit' })
        );
    });

    test('resolves a Grok post URL to its shared video reference', async () => {
        const postUrl = 'https://grok.com/imagine/post/9171bd6b-496d-49ee-a91e-e82c9e392b6c';
        const videoUrl = 'https://imagine-public.x.ai/imagine-public/share-videos/9171bd6b-496d-49ee-a91e-e82c9e392b6c_1080_hd.mp4';
        global.fetch = jest.fn((url) => {
            if (String(url) === postUrl) {
                return Promise.resolve({
                    ok: true,
                    text: () => Promise.resolve([
                        `<meta property="og:video" content="${videoUrl}">`,
                        '<meta name="description" content="he catches up with her and embraces her slowly">'
                    ].join('\n'))
                });
            }

            return Promise.resolve({
                ok: true,
                blob: () => Promise.resolve(new Blob(['video'], { type: 'video/mp4' }))
            });
        });

        const resolved = await resolveReferenceForUpload(
            {
                kind: 'video',
                name: 'grok-post-video.mp4',
                url: postUrl,
                source: 'grok-post-url'
            },
            { documentRef: document, utils, metadataProbeTimeoutMs: 1 }
        );

        expect(resolved).toEqual(expect.objectContaining({
            kind: 'video',
            source: 'grok-post-url',
            mimeType: 'video/mp4',
            byteLength: 5
        }));
        expect(resolved.metadata).toEqual(expect.objectContaining({
            sourcePostUrl: postUrl,
            sourceVideoUrl: videoUrl,
            sourcePrompt: 'he catches up with her and embraces her slowly'
        }));
        expect(resolved.dataUrl).toMatch(/^data:video\/mp4;base64,/);
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

    test('fetchViaBackgroundAsDataUrl requests public Imagine media through the extension runtime', async () => {
        const chromeRuntime = {
            sendMessage: jest.fn(() =>
                Promise.resolve({
                    ok: true,
                    dataUrl: 'data:image/jpeg;base64,aGVsbG8='
                })
            )
        };

        await expect(
            fetchViaBackgroundAsDataUrl('https://imagine-public.x.ai/imagine-public/share-images/reference.jpg', {
                chromeRuntime
            })
        ).resolves.toBe('data:image/jpeg;base64,aGVsbG8=');
        expect(chromeRuntime.sendMessage).toHaveBeenCalledWith({
            action: 'FETCH_GPT_RECREATE_REFERENCE_DATA_URL',
            url: 'https://imagine-public.x.ai/imagine-public/share-images/reference.jpg'
        });
    });

    test('fetchPublicImageAsDataUrl reads public Imagine media directly', async () => {
        global.fetch = jest.fn(() =>
            Promise.resolve({
                ok: true,
                blob: () => Promise.resolve(new Blob(['hello'], { type: 'image/jpeg' }))
            })
        );

        await expect(
            fetchPublicImageAsDataUrl('https://imagine-public.x.ai/imagine-public/share-images/reference.jpg')
        ).resolves.toBe('data:image/jpeg;base64,aGVsbG8=');
        expect(global.fetch).toHaveBeenCalledWith(
            'https://imagine-public.x.ai/imagine-public/share-images/reference.jpg',
            { credentials: 'omit' }
        );
    });

    test('sourceToDataUrl falls back to background fetch before the page bridge for public Imagine media', async () => {
        const listener = jest.fn();
        global.fetch = jest.fn(() => Promise.reject(new Error('cors')));
        const chromeRuntime = {
            sendMessage: jest.fn(() =>
                Promise.resolve({
                    ok: true,
                    dataUrl: 'data:image/jpeg;base64,aGVsbG8='
                })
            )
        };
        document.addEventListener('__gpt_fetch_media_data_url', listener);

        try {
            await expect(
                sourceToDataUrl('https://imagine-public.x.ai/imagine-public/share-images/reference.jpg', {
                    chromeRuntime,
                    documentRef: document,
                    timeoutMs: 100,
                    utils
                })
            ).resolves.toBe('data:image/jpeg;base64,aGVsbG8=');
            expect(chromeRuntime.sendMessage).toHaveBeenCalledTimes(1);
            expect(listener).not.toHaveBeenCalled();
        } finally {
            document.removeEventListener('__gpt_fetch_media_data_url', listener);
        }
    });

    test('sourceToDataUrl reports public Imagine fetch failures distinctly', async () => {
        global.fetch = jest.fn(() => Promise.reject(new Error('cors')));
        const chromeRuntime = {
            sendMessage: jest.fn(() => Promise.resolve({ ok: false, error: 'reference_capture_failed' }))
        };

        await expect(
            sourceToDataUrl('https://imagine-public.x.ai/imagine-public/share-images/reference.jpg', {
                chromeRuntime,
                documentRef: document,
                timeoutMs: 1,
                utils
            })
        ).rejects.toMatchObject({
            message: 'reference_public_fetch_failed',
            code: 'reference_public_fetch_failed'
        });
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

    test('uploads a video reference file and detects video upload preview', () => {
        const composer = createVisibleComposer();
        appendVisibleGrokEditor(composer);
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'video/mp4';
        composer.appendChild(input);

        expect(
            uploadReferenceFile(
                {
                    name: 'reference.mp4',
                    kind: 'video',
                    mimeType: 'video/mp4',
                    dataUrl: 'data:video/mp4;base64,aGVsbG8=',
                    source: 'local'
                },
                document
            )
        ).toBe(true);
        expect(input.files).toHaveLength(1);

        const preview = appendGeneratedVideo({
            src: 'blob:uploaded-video-reference',
            getBoundingClientRect: () => ({ width: 120, height: 180, left: 90, top: 430 })
        });
        composer.appendChild(preview);

        expect(hasUploadPreview(document, null, { kind: 'video', name: 'reference.mp4' })).toBe(true);
    });

    test('uploads to Grok input instead of the extension overlay file input', () => {
        const overlay = document.createElement('div');
        overlay.id = 'grok-powertools-overlay';
        const overlayInput = document.createElement('input');
        overlayInput.id = 'gptRecreateFileInput';
        overlayInput.type = 'file';
        overlayInput.accept = 'image/png';
        overlay.appendChild(overlayInput);
        document.body.appendChild(overlay);

        const grokInput = document.createElement('input');
        grokInput.type = 'file';
        grokInput.multiple = true;
        document.body.appendChild(grokInput);

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
        expect(grokInput.files).toHaveLength(1);
        expect(overlayInput.files).toHaveLength(0);
    });

    test('upload preview detection ignores images outside the Grok composer', () => {
        const composer = createVisibleComposer();
        appendVisibleGrokEditor(composer);
        const attach = document.createElement('button');
        attach.setAttribute('aria-label', 'Attach');
        makeVisibleElement(attach);
        composer.appendChild(attach);

        const profileImage = document.createElement('img');
        profileImage.src = 'https://assets.grok.com/users/example/avatar.webp';
        Object.defineProperty(profileImage, 'naturalWidth', { value: 120 });
        Object.defineProperty(profileImage, 'naturalHeight', { value: 120 });
        profileImage.getBoundingClientRect = () => ({ width: 120, height: 120, left: 1000, top: 1000 });
        document.body.appendChild(profileImage);

        expect(hasUploadPreview(document)).toBe(false);

        const preview = document.createElement('img');
        preview.src = 'blob:uploaded-reference';
        Object.defineProperty(preview, 'naturalWidth', { value: 120 });
        Object.defineProperty(preview, 'naturalHeight', { value: 90 });
        preview.getBoundingClientRect = () => ({ width: 120, height: 90, left: 0, top: 0 });
        composer.appendChild(preview);

        expect(hasUploadPreview(document)).toBe(true);
    });

    test('upload preview detection accepts small Grok thumbnails near attach control', () => {
        const composer = createVisibleComposer();
        appendVisibleGrokEditor(composer);
        const attach = document.createElement('button');
        attach.setAttribute('aria-label', 'Attach');
        attach.getBoundingClientRect = () => ({ width: 40, height: 40, left: 532, top: 424 });
        composer.appendChild(attach);

        const preview = document.createElement('img');
        preview.src = 'https://assets.grok.com/users/example/upload/content';
        Object.defineProperty(preview, 'naturalWidth', { value: 448 });
        Object.defineProperty(preview, 'naturalHeight', { value: 672 });
        preview.getBoundingClientRect = () => ({ width: 34, height: 34, left: 545, top: 429 });
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
            composer.appendChild(preview);
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

        expect(result).toEqual(expect.objectContaining({
            ok: true,
            runId: 'recreate_1',
            generatedPrompt: 'A red cabin in snow.',
            referenceSummary: expect.objectContaining({
                kind: 'image',
                source: 'local',
                mimeType: 'image/png',
                sourceHash: expect.any(String)
            })
        }));
        expect(searchEvents.map((event) => event.type)).toEqual(CLICK_EVENT_SEQUENCE);
        expect(editor.value).toContain('FINAL_IMAGINE_PROMPT:');
        expect(submitEvents.map((event) => event.type)).toEqual(CLICK_EVENT_SEQUENCE);
    });

    test('runChatPromptStep uses video instructions and extracts video prompt marker', async () => {
        const composer = createVisibleComposer();
        const editor = appendVisibleGrokEditor(composer);

        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'video/mp4';
        input.addEventListener('change', () => {
            const preview = appendGeneratedVideo({
                src: 'blob:uploaded-video-reference',
                getBoundingClientRect: () => ({ width: 120, height: 180, left: 90, top: 430 })
            });
            composer.appendChild(preview);
        });
        composer.appendChild(input);

        const submit = document.createElement('button');
        submit.setAttribute('aria-label', 'Send');
        submit.disabled = false;
        submit.getBoundingClientRect = () => ({ width: 40, height: 40, left: 0, top: 0 });
        submit.addEventListener('click', () => {
            const answer = document.createElement('div');
            answer.setAttribute('data-testid', 'assistant-message');
            answer.textContent = 'FINAL_IMAGINE_VIDEO_PROMPT:\nA 10-second handheld clip of two people embracing slowly.';
            document.body.appendChild(answer);
        });
        document.body.appendChild(submit);

        const result = await runChatPromptStep(
            {
                runId: 'recreate_video_1',
                reference: {
                    name: 'reference.mp4',
                    kind: 'video',
                    mimeType: 'video/mp4',
                    dataUrl: 'data:video/mp4;base64,aGVsbG8=',
                    source: 'local',
                    metadata: {
                        sourcePrompt: 'he catches up with her and embraces her slowly'
                    }
                },
                bestPracticesEnabled: false
            },
            { documentRef: document, timeoutMs: 100, intervalMs: 1, metadataProbeTimeoutMs: 1 }
        );

        expect(result.generatedPrompt).toBe('A 10-second handheld clip of two people embracing slowly.');
        expect(result.referenceSummary).toEqual(expect.objectContaining({
            kind: 'video',
            source: 'local',
            mimeType: 'video/mp4',
            sourceHash: expect.any(String)
        }));
        expect(editor.value).toContain('Grok Imagine Video');
        expect(editor.value).toContain('FINAL_IMAGINE_VIDEO_PROMPT:');
        expect(editor.value).toContain('Known source prompt context');
    });

    test('runChatPromptStep lets native Grok submit clicks pass through the overlay', async () => {
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1728 });
        Object.defineProperty(window, 'innerHeight', { configurable: true, value: 996 });

        const composer = createVisibleComposer();
        const editor = appendVisibleGrokEditor(composer);

        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/png';
        input.addEventListener('change', () => {
            const preview = document.createElement('img');
            preview.src = 'blob:uploaded-reference';
            Object.defineProperty(preview, 'naturalWidth', { value: 120 });
            Object.defineProperty(preview, 'naturalHeight', { value: 90 });
            preview.getBoundingClientRect = () => ({ width: 120, height: 90, left: 0, top: 0 });
            composer.appendChild(preview);
        });
        document.body.appendChild(input);

        const submit = document.createElement('button');
        submit.setAttribute('aria-label', 'Submit');
        submit.disabled = false;
        submit.getBoundingClientRect = () => ({ width: 40, height: 40, left: 1342, top: 843 });
        submit.addEventListener('click', () => {
            editor.value = '';
            const answer = document.createElement('div');
            answer.setAttribute('data-testid', 'assistant-message');
            answer.textContent = 'FINAL_IMAGINE_PROMPT:\nA geometry prompt.';
            document.body.appendChild(answer);
        });
        document.body.appendChild(submit);

        const overlay = document.createElement('div');
        overlay.id = 'grok-powertools-overlay';
        overlay.style.pointerEvents = 'auto';
        overlay.getBoundingClientRect = () => ({ width: 420, height: 900, left: 1328, top: 250 });
        document.body.appendChild(overlay);

        const nativeClick = jest.fn(async () => {
            expect(overlay.style.pointerEvents).toBe('none');
        });

        const result = await runChatPromptStep(
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
            { documentRef: document, timeoutMs: 100, intervalMs: 1, chatSubmitAcceptedTimeoutMs: 5, nativeClick }
        );

        expect(result.generatedPrompt).toBe('A geometry prompt.');
        expect(nativeClick).toHaveBeenCalledWith({ x: 1362, y: 863 });
        expect(overlay.style.pointerEvents).toBe('auto');
        expect(editor.value).toBe('');
    });

    test('runChatPromptStep verifies contenteditable bridge text before submit', async () => {
        const composer = createVisibleComposer();
        const editor = document.createElement('div');
        editor.contentEditable = 'true';
        editor.setAttribute('aria-label', 'Ask Grok anything');
        makeVisibleElement(editor);
        composer.appendChild(editor);

        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/png';
        input.addEventListener('change', () => {
            const preview = document.createElement('img');
            preview.src = 'blob:uploaded-reference';
            Object.defineProperty(preview, 'naturalWidth', { value: 120 });
            Object.defineProperty(preview, 'naturalHeight', { value: 90 });
            preview.getBoundingClientRect = () => ({ width: 120, height: 90, left: 0, top: 0 });
            composer.appendChild(preview);
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
            answer.textContent = 'FINAL_IMAGINE_PROMPT:\nA contenteditable request.';
            document.body.appendChild(answer);
        });
        document.body.appendChild(submit);

        global.fetch = jest.fn(() => Promise.reject(new Error('network')));
        const uninstallBridge = installContentEditableBridge();

        try {
            const result = await runChatPromptStep(
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
                { documentRef: document, timeoutMs: 100, editorInjectionTimeoutMs: 50, intervalMs: 1 }
            );

            expect(result.generatedPrompt).toBe('A contenteditable request.');
            expect(editor.textContent).toContain('FINAL_IMAGINE_PROMPT:');
            expect(submitEvents.map((event) => event.type)).toEqual(CLICK_EVENT_SEQUENCE);
        } finally {
            uninstallBridge();
        }
    });

    test('runChatPromptStep falls back when the contenteditable bridge does not update text', async () => {
        const composer = createVisibleComposer();
        const editor = document.createElement('div');
        editor.contentEditable = 'true';
        editor.setAttribute('aria-label', 'Ask Grok anything');
        makeVisibleElement(editor);
        composer.appendChild(editor);

        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/png';
        input.addEventListener('change', () => {
            const preview = document.createElement('img');
            preview.src = 'blob:uploaded-reference';
            Object.defineProperty(preview, 'naturalWidth', { value: 120 });
            Object.defineProperty(preview, 'naturalHeight', { value: 90 });
            preview.getBoundingClientRect = () => ({ width: 120, height: 90, left: 0, top: 0 });
            composer.appendChild(preview);
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
            answer.textContent = 'FINAL_IMAGINE_PROMPT:\nA fallback contenteditable request.';
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
                bestPracticesEnabled: false
            },
            {
                documentRef: document,
                timeoutMs: 100,
                editorInjectionTimeoutMs: 10,
                intervalMs: 1
            }
        );

        expect(result.generatedPrompt).toBe('A fallback contenteditable request.');
        expect(editor.textContent).toContain('FINAL_IMAGINE_PROMPT:');
        expect(submitEvents.map((event) => event.type)).toEqual(CLICK_EVENT_SEQUENCE);
    });

    test('runChatPromptStep waits for delayed Grok upload input', async () => {
        const composer = createVisibleComposer();
        appendVisibleGrokEditor(composer);

        const editor = document.createElement('textarea');
        editor.setAttribute('aria-label', 'Ask Grok anything');
        makeVisibleElement(editor);
        composer.appendChild(editor);

        const submit = document.createElement('button');
        submit.setAttribute('aria-label', 'Send');
        submit.disabled = false;
        submit.getBoundingClientRect = () => ({ width: 40, height: 40, left: 0, top: 0 });
        submit.addEventListener('click', () => {
            const answer = document.createElement('div');
            answer.setAttribute('data-testid', 'assistant-message');
            answer.textContent = 'FINAL_IMAGINE_PROMPT:\nA delayed upload.';
            document.body.appendChild(answer);
        });
        composer.appendChild(submit);

        setTimeout(() => {
            const input = document.createElement('input');
            input.type = 'file';
            input.name = 'files';
            input.multiple = true;
            input.addEventListener('change', () => {
                const preview = document.createElement('img');
                preview.src = 'blob:delayed-upload-preview';
                Object.defineProperty(preview, 'naturalWidth', { value: 120 });
                Object.defineProperty(preview, 'naturalHeight', { value: 90 });
                preview.getBoundingClientRect = () => ({ width: 120, height: 90, left: 0, top: 0 });
                composer.appendChild(preview);
            });
            composer.appendChild(input);
        }, 5);

        const result = await runChatPromptStep(
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
            { documentRef: document, timeoutMs: 100, uploadInputTimeoutMs: 100, intervalMs: 1 }
        );

        expect(result.generatedPrompt).toBe('A delayed upload.');
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
        submit.addEventListener('click', () => {
            editor.value = '';
        });
        document.body.appendChild(submit);

        const chromeRuntime = {
            sendMessage: jest.fn(() => Promise.resolve({ ok: true }))
        };

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
                { documentRef: document, timeoutMs: 10, intervalMs: 1, chatSubmitAcceptedTimeoutMs: 5, chromeRuntime }
            )
        ).rejects.toThrow('chat_answer_timeout');
        expect(submitEvents.map((event) => event.type).slice(0, CLICK_EVENT_SEQUENCE.length)).toEqual(CLICK_EVENT_SEQUENCE);
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
        submit.addEventListener('click', () => {
            appendGeneratedImage();
        });
        document.body.appendChild(submit);

        const uninstallBridge = installContentEditableBridge();
        const uninstallMediaBridge = installMediaDataUrlBridge();
        const nativeClick = jest.fn(async () => {
            CLICK_EVENT_SEQUENCE.forEach((type) => {
                submit.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
            });
            return { ok: true };
        });

        let result;
        try {
            result = await runImagineSubmitStep(
                {
                    runId: 'recreate_1',
                    generatedPrompt: 'A red cabin in snow.',
                    autoSubmit: true
                },
                { documentRef: document, timeoutMs: 100, resultTimeoutMs: 100, intervalMs: 1, nativeClick }
            );
        } finally {
            uninstallMediaBridge();
            uninstallBridge();
        }

        expect(result).toEqual(expect.objectContaining({
            ok: true,
            runId: 'recreate_1',
            mediaKind: 'image',
            submitted: true,
            resultReady: true,
            result: expect.objectContaining({
                mediaKind: 'image',
                sourceKind: 'trusted-grok-media',
                openableSurface: 'direct-media-url',
                naturalWidth: 1024,
                naturalHeight: 1024,
                renderedWidth: 320,
                renderedHeight: 320,
                byteLength: 12288,
                openable: true
            })
        }));
        expect(nativeClick).toHaveBeenCalledTimes(1);
        expect(submitEvents.map((event) => event.type)).toEqual(CLICK_EVENT_SEQUENCE);
    });

    test('runImagineSubmitStep Stop cancels an in-flight submit wait before any late click or result', async () => {
        const editor = document.createElement('div');
        editor.contentEditable = 'true';
        editor.setAttribute('aria-label', 'Ask Grok anything');
        makeVisibleElement(editor);
        document.body.appendChild(editor);

        const submit = document.createElement('button');
        submit.setAttribute('aria-label', 'Submit');
        submit.disabled = true;
        submit.getBoundingClientRect = () => ({ width: 40, height: 40, left: 0, top: 0 });
        submit.addEventListener('click', () => {
            appendGeneratedImage();
        });
        document.body.appendChild(submit);

        const uninstallBridge = installContentEditableBridge();
        const uninstallMediaBridge = installMediaDataUrlBridge();
        const abortController = new AbortController();
        const nativeClick = jest.fn(async () => {
            submit.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
            return { ok: true };
        });

        let outcome;
        try {
            const pendingResult = runImagineSubmitStep(
                {
                    runId: 'recreate_stop_1',
                    generatedPrompt: 'A red cabin in snow.',
                    autoSubmit: true
                },
                {
                    documentRef: document,
                    timeoutMs: 100,
                    resultTimeoutMs: 100,
                    intervalMs: 1,
                    nativeClick,
                    signal: abortController.signal
                }
            );

            await waitForCondition(() => editor.textContent.includes('A red cabin in snow.'), {
                timeoutMs: 100,
                intervalMs: 1
            });
            abortController.abort();
            submit.disabled = false;

            outcome = await pendingResult.then(
                (value) => ({ status: 'resolved', value }),
                (error) => ({ status: 'rejected', error })
            );
        } finally {
            uninstallMediaBridge();
            uninstallBridge();
        }

        expect(nativeClick).not.toHaveBeenCalled();
        expect(document.querySelector('img[alt="Generated image"]')).toBeNull();
        expect(outcome).toEqual({
            status: 'rejected',
            error: expect.objectContaining({ code: 'workflow_aborted' })
        });
    });

    test('runImagineSubmitStep waits through low-resolution placeholder result cards', async () => {
        const editor = document.createElement('div');
        editor.contentEditable = 'true';
        editor.setAttribute('aria-label', 'Ask Grok anything');
        makeVisibleElement(editor);
        document.body.appendChild(editor);

        const submit = document.createElement('button');
        submit.setAttribute('aria-label', 'Submit');
        submit.disabled = false;
        submit.getBoundingClientRect = () => ({ width: 40, height: 40, left: 0, top: 0 });
        submit.addEventListener('click', () => {
            appendGeneratedImage({
                src: 'data:image/png;base64,aGVsbG8=',
                naturalWidth: 144,
                naturalHeight: 256,
                getBoundingClientRect: () => ({ left: 320, top: 120, width: 354, height: 433 })
            });
        });
        document.body.appendChild(submit);

        const uninstallBridge = installContentEditableBridge();

        try {
            await expect(
                runImagineSubmitStep(
                    {
                        runId: 'recreate_1',
                        generatedPrompt: 'A red cabin in snow.',
                        autoSubmit: true
                    },
                    {
                        documentRef: document,
                        timeoutMs: 100,
                        resultTimeoutMs: 100,
                        placeholderTimeoutMs: 50,
                        intervalMs: 1
                    }
                )
            ).rejects.toMatchObject({
                code: 'imagine_result_placeholder',
                diagnostics: expect.objectContaining({
                    placeholderResultCount: 1,
                    largestNaturalWidth: 144,
                    largestNaturalHeight: 256,
                    placeholderObservedMs: expect.any(Number)
                })
            });
        } finally {
            uninstallBridge();
        }
    });

    test('runImagineSubmitStep succeeds when placeholder cards hydrate to Grok media', async () => {
        const editor = document.createElement('div');
        editor.contentEditable = 'true';
        editor.setAttribute('aria-label', 'Ask Grok anything');
        makeVisibleElement(editor);
        document.body.appendChild(editor);

        const submit = document.createElement('button');
        submit.setAttribute('aria-label', 'Submit');
        submit.disabled = false;
        submit.getBoundingClientRect = () => ({ width: 40, height: 40, left: 0, top: 0 });
        submit.addEventListener('click', () => {
            const img = appendGeneratedImage({
                src: 'data:image/png;base64,aGVsbG8=',
                naturalWidth: 144,
                naturalHeight: 256,
                getBoundingClientRect: () => ({ left: 320, top: 120, width: 354, height: 433 })
            });

            setTimeout(() => {
                img.src = 'https://images-public.x.ai/xai-images-public/mj/images/sample.png';
                Object.defineProperty(img, 'naturalWidth', { configurable: true, value: 832 });
                Object.defineProperty(img, 'naturalHeight', { configurable: true, value: 1248 });
            }, 5);
        });
        document.body.appendChild(submit);

        const uninstallBridge = installContentEditableBridge();
        const uninstallMediaBridge = installMediaDataUrlBridge();

        try {
            await expect(
                runImagineSubmitStep(
                    {
                        runId: 'recreate_1',
                        generatedPrompt: 'A red cabin in snow.',
                        autoSubmit: true
                    },
                    {
                        documentRef: document,
                        timeoutMs: 100,
                        resultTimeoutMs: 100,
                        placeholderTimeoutMs: 100,
                        intervalMs: 1
                    }
                )
            ).resolves.toEqual(
                expect.objectContaining({
                    ok: true,
                    resultReady: true,
                    result: expect.objectContaining({
                        sourceKind: 'trusted-grok-media',
                        naturalWidth: 832,
                        naturalHeight: 1248,
                        byteLength: 12288,
                        openable: true
                    })
                })
            );
        } finally {
            uninstallMediaBridge();
            uninstallBridge();
        }
    });

    test('runImagineSubmitStep selects video mode and verifies generated video bytes', async () => {
        const imageMode = document.createElement('button');
        imageMode.textContent = 'Image';
        imageMode.setAttribute('data-state', 'checked');
        imageMode.disabled = false;
        makeVisibleElement(imageMode);
        document.body.appendChild(imageMode);

        const videoMode = document.createElement('button');
        videoMode.textContent = 'Video';
        videoMode.setAttribute('data-state', 'unchecked');
        videoMode.disabled = false;
        makeVisibleElement(videoMode);
        const videoModeEvents = recordClickEvents(videoMode);
        videoMode.addEventListener('click', () => {
            imageMode.setAttribute('data-state', 'unchecked');
            videoMode.setAttribute('data-state', 'checked');
        });
        document.body.appendChild(videoMode);

        const editor = document.createElement('div');
        editor.contentEditable = 'true';
        editor.setAttribute('aria-label', 'Ask Grok anything');
        makeVisibleElement(editor);
        document.body.appendChild(editor);

        const submit = document.createElement('button');
        submit.setAttribute('aria-label', 'Submit');
        submit.disabled = false;
        submit.getBoundingClientRect = () => ({ width: 40, height: 40, left: 0, top: 0 });
        submit.addEventListener('click', () => {
            appendGeneratedVideo({
                src: 'https://imagine-public.x.ai/imagine-public/share-videos/generated_1080_hd.mp4'
            });
        });
        document.body.appendChild(submit);

        global.fetch = jest.fn(() =>
            Promise.resolve({
                ok: true,
                blob: () => Promise.resolve(new Blob([Buffer.alloc(12 * 1024, 1)], { type: 'video/mp4' }))
            })
        );
        const uninstallBridge = installContentEditableBridge();

        try {
            await expect(
                runImagineSubmitStep(
                    {
                        runId: 'recreate_video_1',
                        generatedPrompt: 'A handheld 10-second embrace.',
                        targetMode: 'video',
                        autoSubmit: true
                    },
                    { documentRef: document, timeoutMs: 100, resultTimeoutMs: 100, intervalMs: 1 }
                )
            ).resolves.toEqual(
                expect.objectContaining({
                    ok: true,
                    mediaKind: 'video',
                    resultReady: true,
                    result: expect.objectContaining({
                        mediaKind: 'video',
                        sourceKind: 'trusted-grok-video',
                        url: 'https://imagine-public.x.ai/imagine-public/share-videos/generated_1080_hd.mp4',
                        byteLength: 12288,
                        outputMediaHash: expect.any(String),
                        openable: true
                    })
                })
            );
        } finally {
            uninstallBridge();
        }

        expect(videoModeEvents.map((event) => event.type)).toEqual(CLICK_EVENT_SEQUENCE);
    });

    test('runImagineSubmitStep verifies blob video bytes on an opened Imagine post', async () => {
        window.history.pushState({}, '', '/imagine/post/live-video-proof');

        const imageMode = document.createElement('button');
        imageMode.textContent = 'Image';
        imageMode.setAttribute('data-state', 'checked');
        imageMode.disabled = false;
        makeVisibleElement(imageMode);
        document.body.appendChild(imageMode);

        const videoMode = document.createElement('button');
        videoMode.textContent = 'Video';
        videoMode.setAttribute('data-state', 'unchecked');
        videoMode.disabled = false;
        makeVisibleElement(videoMode);
        videoMode.addEventListener('click', () => {
            imageMode.setAttribute('data-state', 'unchecked');
            videoMode.setAttribute('data-state', 'checked');
        });
        document.body.appendChild(videoMode);

        const editor = document.createElement('div');
        editor.contentEditable = 'true';
        editor.setAttribute('aria-label', 'Ask Grok anything');
        makeVisibleElement(editor);
        document.body.appendChild(editor);

        const submit = document.createElement('button');
        submit.setAttribute('aria-label', 'Submit');
        submit.disabled = false;
        submit.getBoundingClientRect = () => ({ width: 40, height: 40, left: 0, top: 0 });
        submit.addEventListener('click', () => {
            appendGeneratedVideo({
                src: 'blob:https://grok.com/generated-video-proof'
            });
        });
        document.body.appendChild(submit);

        global.fetch = jest.fn(() =>
            Promise.resolve({
                ok: true,
                blob: () => Promise.resolve(new Blob([Buffer.alloc(12 * 1024, 1)], { type: 'video/mp4' }))
            })
        );
        const uninstallBridge = installContentEditableBridge();

        try {
            await expect(
                runImagineSubmitStep(
                    {
                        runId: 'recreate_video_blob_1',
                        generatedPrompt: 'A handheld 10-second embrace.',
                        targetMode: 'video',
                        autoSubmit: true
                    },
                    { documentRef: document, timeoutMs: 100, resultTimeoutMs: 100, intervalMs: 1 }
                )
            ).resolves.toEqual(
                expect.objectContaining({
                    ok: true,
                    mediaKind: 'video',
                    resultReady: true,
                    result: expect.objectContaining({
                        mediaKind: 'video',
                        sourceKind: 'blob-url',
                        byteLength: 12288,
                        outputMediaHash: expect.any(String),
                        openable: true,
                        openableSurface: 'opened-post-blob-video'
                    })
                })
            );
        } finally {
            uninstallBridge();
        }
    });

    test('runImaginePostValidationStep verifies playable authenticated Grok video on an opened Imagine post', async () => {
        window.history.pushState({}, '', '/imagine/post/live-assets-video-proof');

        const trustedVideoUrl = 'https://assets.grok.com/users/test/generated/live-assets-video-proof/generated_video.mp4?cache=1';
        appendGeneratedVideo({
            src: trustedVideoUrl,
            readyState: 4,
            videoWidth: 416,
            videoHeight: 752,
            duration: 10
        });

        await expect(
            runImaginePostValidationStep(
                {
                    runId: 'recreate_video_post_1',
                    targetMode: 'video',
                    referenceKind: 'video'
                },
                { documentRef: document, resultTimeoutMs: 100, intervalMs: 1 }
            )
        ).resolves.toEqual(
            expect.objectContaining({
                ok: true,
                mediaKind: 'video',
                resultReady: true,
                result: expect.objectContaining({
                    mediaKind: 'video',
                    sourceKind: 'trusted-grok-video',
                    url: trustedVideoUrl,
                    byteLength: 0,
                    outputMediaHash: null,
                    openable: true,
                    openableSurface: 'opened-post-playable-video'
                })
            })
        );
    });

    test('runImagineSubmitStep opens full-size data result cards before accepting them', async () => {
        Object.defineProperty(window, 'innerHeight', { configurable: true, value: 996 });
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1728 });

        const editor = document.createElement('div');
        editor.contentEditable = 'true';
        editor.setAttribute('aria-label', 'Ask Grok anything');
        makeVisibleElement(editor);
        document.body.appendChild(editor);

        const submit = document.createElement('button');
        submit.setAttribute('aria-label', 'Submit');
        submit.disabled = false;
        submit.getBoundingClientRect = () => ({ width: 40, height: 40, left: 1328.5, top: 924 });
        document.body.appendChild(submit);

        const dataResultUrl = `data:image/jpeg;base64,${Buffer.alloc(130 * 1024, 1).toString('base64')}`;
        const trustedResultUrl = 'https://imagine-public.x.ai/imagine-public/images/manual-proof.jpg';
        const chromeRuntime = {
            sendMessage: jest.fn(() =>
                Promise.resolve({
                    ok: true,
                    dataUrl: LARGE_IMAGE_DATA_URL
                })
            )
        };
        global.fetch = jest.fn(() => Promise.reject(new Error('offline')));
        const nativeClicks = [];
        const nativeClick = jest.fn(async (click) => {
            nativeClicks.push(click);

            if (nativeClicks.length === 1) {
                appendGeneratedImage({
                    src: dataResultUrl,
                    naturalWidth: 720,
                    naturalHeight: 1280,
                    getBoundingClientRect: () => ({ left: 269, top: 758, width: 354, height: 629 })
                });
                return { ok: true };
            }

            window.history.pushState({}, '', '/imagine/post/manual-proof');
            document.body.innerHTML = '';
            appendGeneratedImage({
                src: trustedResultUrl,
                naturalWidth: 720,
                naturalHeight: 1280,
                getBoundingClientRect: () => ({ left: 757, top: 34.5, width: 471, height: 837 })
            });
            return { ok: true };
        });

        const uninstallBridge = installContentEditableBridge();
        const uninstallMediaBridge = installMediaDataUrlBridge();

        try {
            const pendingResult = runImagineSubmitStep(
                    {
                        runId: 'recreate_1',
                        generatedPrompt: 'Minimalist abstract geometric composition.',
                        autoSubmit: true
                    },
                    {
                        documentRef: document,
                        timeoutMs: 100,
                        resultTimeoutMs: 3000,
                        openedPostTimeoutMs: 500,
                        resultMediaFetchTimeoutMs: 1,
                        intervalMs: 1,
                        chromeRuntime,
                        nativeClick
                    }
                );
            await expect(pendingResult).resolves.toEqual(
                expect.objectContaining({
                    ok: true,
                    resultReady: true,
                    result: expect.objectContaining({
                        sourceKind: 'data-url',
                        openedSourceKind: 'trusted-grok-media',
                        openedUrl: trustedResultUrl,
                        postUrl: expect.stringContaining('/imagine/post/manual-proof'),
                        openableSurface: 'opened-post',
                        byteLength: 12288,
                        openable: true
                    })
                })
            );
        } finally {
            uninstallMediaBridge();
            uninstallBridge();
            window.history.pushState({}, '', '/');
        }

        expect(nativeClick).toHaveBeenCalledTimes(2);
        expect(chromeRuntime.sendMessage).toHaveBeenCalledWith({
            action: 'FETCH_GPT_RECREATE_REFERENCE_DATA_URL',
            url: trustedResultUrl
        });
        expect(nativeClicks[0]).toEqual({ x: 1348.5, y: 944 });
        expect(nativeClicks[1].x).toBe(446);
        expect(nativeClicks[1].y).toBeLessThan(830);
    });

    test('runImagineSubmitStep rejects full-size Grok media that cannot be fetched as image bytes', async () => {
        const editor = document.createElement('div');
        editor.contentEditable = 'true';
        editor.setAttribute('aria-label', 'Ask Grok anything');
        makeVisibleElement(editor);
        document.body.appendChild(editor);

        const submit = document.createElement('button');
        submit.setAttribute('aria-label', 'Submit');
        submit.disabled = false;
        submit.getBoundingClientRect = () => ({ width: 40, height: 40, left: 0, top: 0 });
        submit.addEventListener('click', () => {
            appendGeneratedImage({
                src: 'https://assets.grok.com/users/sample/unopenable-content',
                naturalWidth: 832,
                naturalHeight: 1248,
                getBoundingClientRect: () => ({ left: 320, top: 120, width: 354, height: 433 })
            });
        });
        document.body.appendChild(submit);

        const uninstallBridge = installContentEditableBridge();

        try {
            await expect(
                runImagineSubmitStep(
                    {
                        runId: 'recreate_1',
                        generatedPrompt: 'A red cabin in snow.',
                        autoSubmit: true
                    },
                    {
                        documentRef: document,
                        timeoutMs: 100,
                        resultTimeoutMs: 20,
                        resultMediaFetchTimeoutMs: 1,
                        intervalMs: 1
                    }
                )
            ).rejects.toMatchObject({
                code: 'imagine_result_unopenable',
                diagnostics: expect.objectContaining({
                    fullSizeResultCount: 1,
                    openableResultCount: 1,
                    openabilityError: 'result_media_fetch_failed'
                })
            });
        } finally {
            uninstallBridge();
        }
    });

    test('runImagineSubmitStep does not accept stale result cards that existed before submit', async () => {
        appendGeneratedImage();

        const editor = document.createElement('div');
        editor.contentEditable = 'true';
        editor.setAttribute('aria-label', 'Ask Grok anything');
        makeVisibleElement(editor);
        document.body.appendChild(editor);

        const submit = document.createElement('button');
        submit.setAttribute('aria-label', 'Submit');
        submit.disabled = false;
        submit.getBoundingClientRect = () => ({ width: 40, height: 40, left: 0, top: 0 });
        document.body.appendChild(submit);

        const uninstallBridge = installContentEditableBridge();

        try {
            await expect(
                runImagineSubmitStep(
                    {
                        runId: 'recreate_1',
                        generatedPrompt: 'A red cabin in snow.',
                        autoSubmit: true
                    },
                    { documentRef: document, timeoutMs: 100, resultTimeoutMs: 5, intervalMs: 1 }
                )
            ).rejects.toMatchObject({
                code: 'imagine_result_timeout',
                diagnostics: expect.objectContaining({
                    resultCandidateCount: 1,
                    newResultCandidateCount: 0
                })
            });
        } finally {
            uninstallBridge();
        }
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

        const uninstallBridge = installContentEditableBridge();

        try {
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
        } finally {
            uninstallBridge();
        }
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

        const uninstallBridge = installContentEditableBridge();

        try {
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
        } finally {
            uninstallBridge();
        }
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
            dataUrl: 'data:image/png;base64,bGVhaw==',
            videoDataUrl: 'data:video/mp4;base64,bGVhaw=='
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
        expect(JSON.stringify(response)).not.toContain('data:video/mp4');
        expect(JSON.stringify(response)).not.toContain('source.png');
    });

    test('records recreated video prompts as video history', async () => {
        const listeners = [];
        const request = {
            action: 'GPT_RECREATE_IMAGINE_STEP',
            runId: 'recreate_video_1',
            generatedPrompt: 'A handheld 10-second embrace.',
            targetMode: 'video'
        };
        const actions = {
            runImagineSubmitStep: jest.fn(async () => ({
                ok: true,
                runId: 'recreate_video_1',
                mediaKind: 'video',
                submitted: true,
                resultReady: true
            }))
        };
        const historyManager = {
            add: jest.fn()
        };
        const chromeRuntime = {
            onMessage: {
                addListener: jest.fn((listener) => {
                    listeners.push(listener);
                })
            }
        };
        const bridge = new RecreateWorkflowContentBridge(null, historyManager, {
            actions,
            chromeRuntime,
            documentRef: { title: 'Grok Imagine' },
            locationRef: { href: 'https://grok.com/imagine' }
        });

        bridge.setupListeners();
        const response = await new Promise((resolve) => {
            const keepAlive = listeners[0](request, {}, resolve);
            expect(keepAlive).toBe(true);
        });

        expect(response).toEqual(expect.objectContaining({ ok: true, mediaKind: 'video' }));
        expect(historyManager.add).toHaveBeenCalledWith('A handheld 10-second embrace.', 'video');
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
