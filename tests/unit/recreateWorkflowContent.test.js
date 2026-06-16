const utils = require('../../recreateWorkflowUtils.js');
const {
    collectGeneratedImageCandidates,
    dataUrlToFile,
    fetchViaBridgeAsBlobUrl,
    readBlobAsDataUrl,
    readFileAsRecreateReference,
    selectCurrentGeneratedImage,
    sourceToDataUrl,
    waitForCondition
} = require('../../recreateWorkflowContent.js');

const originalFetch = global.fetch;

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

    test('converts trusted Grok media sources to data URLs through the bridge', async () => {
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
        global.fetch = jest.fn(() =>
            Promise.resolve({
                ok: true,
                blob: () => Promise.resolve(new Blob(['hello'], { type: 'image/png' }))
            })
        );

        try {
            await expect(
                sourceToDataUrl('https://assets.grok.com/users/test/image.png', {
                    documentRef: document,
                    timeoutMs: 100,
                    utils
                })
            ).resolves.toBe('data:image/png;base64,aGVsbG8=');
            expect(global.fetch).toHaveBeenCalledWith('blob:test-reference');
        } finally {
            document.removeEventListener('__gpt_fetch_media', listener);
        }
    });

    test('maps trusted media conversion failures to reference_capture_failed', async () => {
        const originalRevokeObjectURL = URL.revokeObjectURL;
        URL.revokeObjectURL = jest.fn();

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
        global.fetch = jest.fn(() => Promise.reject(new Error('network failed')));

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
            expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test-reference');
        } finally {
            document.removeEventListener('__gpt_fetch_media', listener);
            URL.revokeObjectURL = originalRevokeObjectURL;
        }
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
