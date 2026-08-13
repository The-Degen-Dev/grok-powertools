const fs = require('fs');
const path = require('path');
const { VideoRetryManager, fetchMediaDataUrlViaBridge } = require('../../content.js');

const bridgeSource = fs.readFileSync(path.resolve(__dirname, '../../bridge.js'), 'utf8');
const contentSource = fs.readFileSync(path.resolve(__dirname, '../../content.js'), 'utf8');

function evaluateContentBridgeBootstrap() {
    const start = contentSource.indexOf('(function injectPageWorldBridge()');
    const end = contentSource.indexOf('})();', start) + 4;
    const bootstrap = contentSource.slice(start, end);
    Function(
        'isGrokProvider',
        'detectCurrentProvider',
        'safeChromeRuntimeGetURL',
        `const module = undefined;\n${bootstrap}`
    )(
        () => true,
        () => 'grok',
        (pathValue) => pathValue
    );
}

describe('bridge prompted video editor targeting', () => {
    test('double evaluation writes once, settles once, succeeds, and cleans the marker', async () => {
        const preciseEditor = document.createElement('div');
        preciseEditor.setAttribute('contenteditable', 'true');
        preciseEditor.setAttribute('aria-label', 'Ask Grok anything');
        const composer = document.createElement('div');
        composer.className = 'query-bar';
        const videoEditor = document.createElement('div');
        videoEditor.setAttribute('contenteditable', 'true');
        videoEditor.setAttribute('role', 'textbox');
        videoEditor.setAttribute('aria-label', 'Ask Grok anything');
        const submit = document.createElement('button');
        submit.setAttribute('aria-label', 'Make video');
        jest.spyOn(submit, 'getBoundingClientRect').mockReturnValue({
            x: 0,
            y: 0,
            top: 0,
            left: 0,
            right: 40,
            bottom: 40,
            width: 40,
            height: 40
        });
        composer.append(videoEditor, submit);
        document.body.append(preciseEditor, composer);

        const results = [];
        const resultListener = (event) => {
            results.push(event.detail);
        };
        document.addEventListener('__gpt_set_prompted_video_content_result', resultListener);
        let writes = 0;
        videoEditor.addEventListener('input', () => { writes++; });
        const originalFetch = window.fetch;
        const originalCreateObjectURL = URL.createObjectURL;
        const fetchMock = jest.fn(async () => ({
            ok: true,
            blob: async () => new Blob(['media'], { type: 'image/png' })
        }));
        window.fetch = fetchMock;
        URL.createObjectURL = jest.fn(() => 'blob:bridge-fetch');
        const fetchResults = [];
        let resolveFetchResult;
        const fetchResultPromise = new Promise((resolve) => { resolveFetchResult = resolve; });
        const fetchResultListener = (event) => {
            fetchResults.push(event.detail);
            resolveFetchResult();
        };
        document.addEventListener('__gpt_fetch_media_result', fetchResultListener);
        const setIntervalSpy = jest.spyOn(global, 'setInterval').mockImplementation(() => 1);
        const retryManager = new VideoRetryManager(
            { setStatus: jest.fn(), el: document.createElement('div') },
            { settings: {}, subscribe: jest.fn() },
            { history: [], add: jest.fn() }
        );
        retryManager.promptedVideoComposerRoot = composer;

        eval(bridgeSource);
        eval(bridgeSource);

        try {
            expect(retryManager.injectPromptedVideoText('scoped video prompt')).toBe(true);

            expect(preciseEditor.textContent).toBe('');
            expect(videoEditor.textContent).toBe('scoped video prompt');
            expect(writes).toBe(1);
            expect(results).toHaveLength(1);
            expect(results[0]).toEqual(expect.objectContaining({ ok: true, error: null }));
            expect(videoEditor.hasAttribute('data-gpt-prompt-target')).toBe(false);

            document.dispatchEvent(new CustomEvent('__gpt_append_editor_content', {
                detail: { text: 'once' }
            }));
            document.dispatchEvent(new CustomEvent('__gpt_fetch_media', {
                detail: { requestId: 'fetch-1', url: 'https://assets.grok.com/media.png' }
            }));
            await fetchResultPromise;
            await Promise.resolve();
            expect(preciseEditor.textContent).toBe('once');
            expect(fetchMock).toHaveBeenCalledTimes(1);
            expect(fetchResults).toEqual([expect.objectContaining({
                requestId: 'fetch-1',
                blobUrl: 'blob:bridge-fetch',
                type: 'image/png'
            })]);

            let resolveLateFetch;
            fetchMock.mockImplementationOnce(() => new Promise((resolve) => {
                resolveLateFetch = resolve;
            }));
            document.dispatchEvent(new CustomEvent('__gpt_fetch_media', {
                detail: { requestId: 'fetch-late', url: 'https://assets.grok.com/late-media.png' }
            }));
            document.dispatchEvent(new CustomEvent('__gpt_fetch_media_release', {
                detail: { requestId: 'fetch-late' }
            }));
            resolveLateFetch({
                ok: true,
                blob: async () => new Blob(['late-media'], { type: 'image/png' })
            });
            await Promise.resolve();
            await Promise.resolve();
            await Promise.resolve();

            expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
        } finally {
            window.fetch = originalFetch;
            URL.createObjectURL = originalCreateObjectURL;
            retryManager.stopObserver();
            retryManager.generateMoreObserver.disconnect();
            document.removeEventListener('__gpt_set_prompted_video_content_result', resultListener);
            document.removeEventListener('__gpt_fetch_media_result', fetchResultListener);
            setIntervalSpy.mockRestore();
        }
    });

    test('media helper revokes the bridge blob URL and removes its listener when decoding fails', async () => {
        const root = document.createElement('div');
        const removeListenerSpy = jest.spyOn(root, 'removeEventListener');
        const releases = [];
        const originalFetch = global.fetch;
        const originalRevokeObjectURL = URL.revokeObjectURL;
        global.fetch = jest.fn(async () => {
            throw new Error('blob decode failed');
        });
        URL.revokeObjectURL = jest.fn();
        root.addEventListener('__gpt_fetch_media', (event) => {
            root.dispatchEvent(new CustomEvent('__gpt_fetch_media_result', {
                detail: {
                    requestId: event.detail.requestId,
                    blobUrl: 'blob:bridge-fetch-failure',
                    size: 5,
                    type: 'image/png'
                }
            }));
        });
        root.addEventListener('__gpt_fetch_media_release', (event) => {
            releases.push(event.detail);
        });

        try {
            await expect(fetchMediaDataUrlViaBridge(
                'https://assets.grok.com/media.png',
                root,
                100
            )).rejects.toThrow('blob decode failed');
            expect(removeListenerSpy).toHaveBeenCalledWith(
                '__gpt_fetch_media_result',
                expect.any(Function)
            );
            expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:bridge-fetch-failure');
            expect(releases).toEqual([
                expect.objectContaining({ requestId: expect.stringMatching(/^fetch_/) })
            ]);
        } finally {
            global.fetch = originalFetch;
            URL.revokeObjectURL = originalRevokeObjectURL;
            removeListenerSpy.mockRestore();
        }
    });

    test('a replaced content context restores its upload listener while preserving the page bridge marker', () => {
        const bridgeMarker = 'data-gpt-power-tools-page-bridge-injected';
        const listenerKey = '__gptPowerToolsUploadCompleteListener';
        const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

        delete globalThis[listenerKey];
        document.documentElement.removeAttribute(bridgeMarker);

        try {
            evaluateContentBridgeBootstrap();
            const oldListener = globalThis[listenerKey];
            expect(typeof oldListener).toBe('function');

            // Chrome keeps page DOM attributes across isolated-world replacement, but the
            // old content listener does not survive that replacement.
            document.removeEventListener('__gpt_upload_complete', oldListener);
            delete globalThis[listenerKey];
            evaluateContentBridgeBootstrap();

            const bridgeScripts = Array.from(document.querySelectorAll('script'))
                .filter((script) => script.src.endsWith('/bridge.js') || script.getAttribute('src') === 'bridge.js');
            expect(bridgeScripts).toHaveLength(1);
            expect(globalThis[listenerKey]).toEqual(expect.any(Function));
            expect(globalThis[listenerKey]).not.toBe(oldListener);

            document.dispatchEvent(new CustomEvent('__gpt_upload_complete', {
                detail: { imageUrl: 'https://assets.grok.com/uploaded-image.png' }
            }));

            expect(window._lastUploadedImageUrl).toBe('https://assets.grok.com/uploaded-image.png');
            expect(logSpy).toHaveBeenCalledTimes(1);
        } finally {
            document.documentElement.removeAttribute(bridgeMarker);
            document.querySelectorAll('script').forEach((script) => {
                if (script.src.endsWith('/bridge.js') || script.getAttribute('src') === 'bridge.js') {
                    script.dispatchEvent(new Event('error'));
                    script.remove();
                }
            });
            const listener = globalThis[listenerKey];
            if (listener) document.removeEventListener('__gpt_upload_complete', listener);
            delete globalThis[listenerKey];
            delete window._lastUploadedImageUrl;
            logSpy.mockRestore();
        }
    });

    test('a failed bridge script load clears its marker and permits one clean reinjection', () => {
        const bridgeMarker = 'data-gpt-power-tools-page-bridge-injected';
        const listenerKey = '__gptPowerToolsUploadCompleteListener';
        const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
        delete globalThis[listenerKey];
        document.documentElement.removeAttribute(bridgeMarker);
        document.querySelectorAll('script').forEach((script) => {
            if (script.src.endsWith('/bridge.js') || script.getAttribute('src') === 'bridge.js') script.remove();
        });

        try {
            evaluateContentBridgeBootstrap();
            const failedScript = Array.from(document.querySelectorAll('script'))
                .find((script) => script.src.endsWith('/bridge.js') || script.getAttribute('src') === 'bridge.js');
            expect(failedScript).toBeDefined();

            failedScript.dispatchEvent(new Event('error'));

            expect(document.documentElement.hasAttribute(bridgeMarker)).toBe(false);
            expect(failedScript.isConnected).toBe(false);
            expect(globalThis[listenerKey]).toBeUndefined();

            evaluateContentBridgeBootstrap();
            const bridgeScripts = Array.from(document.querySelectorAll('script'))
                .filter((script) => script.src.endsWith('/bridge.js') || script.getAttribute('src') === 'bridge.js');
            expect(bridgeScripts).toHaveLength(1);
            expect(bridgeScripts[0]).not.toBe(failedScript);

            document.dispatchEvent(new CustomEvent('__gpt_upload_complete', {
                detail: { imageUrl: 'https://assets.grok.com/reinjected-image.png' }
            }));

            expect(window._lastUploadedImageUrl).toBe('https://assets.grok.com/reinjected-image.png');
            expect(logSpy).toHaveBeenCalledTimes(1);
        } finally {
            document.documentElement.removeAttribute(bridgeMarker);
            document.querySelectorAll('script').forEach((script) => {
                if (script.src.endsWith('/bridge.js') || script.getAttribute('src') === 'bridge.js') script.remove();
            });
            const listener = globalThis[listenerKey];
            if (listener) document.removeEventListener('__gpt_upload_complete', listener);
            delete globalThis[listenerKey];
            delete window._lastUploadedImageUrl;
            logSpy.mockRestore();
        }
    });

});
