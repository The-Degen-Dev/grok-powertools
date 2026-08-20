const fs = require('fs');
const path = require('path');
const {
    VideoRetryManager,
    fetchGrokAssetMetadataViaBridge,
    fetchGrokConversationAssetInventoryViaBridge,
    fetchMediaDataUrlViaBridge
} = require('../../content.js');

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
    test('observing Grok uploads handles rejected fetches without replacing the original rejection', async () => {
        const originalFetch = window.fetch;
        const observerCatch = jest.fn();
        const originalRejection = new Error('network unavailable');
        const originalResponse = {
            then: jest.fn(() => ({ catch: observerCatch }))
        };
        window.fetch = jest.fn(() => originalResponse);

        try {
            eval(bridgeSource);

            const returned = window.fetch('/rest/app-chat/upload-file');

            expect(returned).toBe(originalResponse);
            expect(originalResponse.then).toHaveBeenCalledTimes(1);
            expect(observerCatch).toHaveBeenCalledWith(expect.any(Function));
            expect(() => observerCatch.mock.calls[0][0](originalRejection)).not.toThrow();
        } finally {
            window.fetch = originalFetch;
        }
    });

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
        const readyResults = [];
        const readyListener = (event) => {
            readyResults.push(event.detail);
        };
        document.addEventListener('__gpt_media_fetch_bridge_ready', readyListener);
        const metadataResults = [];
        let resolveMetadataResult;
        const metadataResultPromise = new Promise((resolve) => { resolveMetadataResult = resolve; });
        const metadataResultListener = (event) => {
            metadataResults.push(event.detail);
            resolveMetadataResult();
        };
        document.addEventListener('__gpt_fetch_asset_metadata_result', metadataResultListener);
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
            document.dispatchEvent(new CustomEvent('__gpt_media_fetch_bridge_probe', {
                detail: { requestId: 'probe-1' }
            }));
            expect(readyResults).toEqual([{ requestId: 'probe-1' }]);

            const conversationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
            const assetId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
            const decoyAssetId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
            fetchMock.mockImplementationOnce(async (url) => {
                expect(String(url)).toBe(`/rest/app-chat/conversations/${conversationId}/responses`);
                return {
                    ok: true,
                    json: async () => ({
                        responses: [
                            {
                                responseId: 'decoy-response',
                                fileAttachmentAssetMetadata: [{ assetId: decoyAssetId }],
                                mediaGenInput: { prompt: 'wrong prompt' }
                            },
                            {
                                responseId: 'target-response',
                                parentResponseId: 'parent-response',
                                rootResponseId: 'root-response',
                                fileAttachmentAssetMetadata: [{
                                    assetId,
                                    key: `users/example/generated/${assetId}/image.jpg`,
                                    mimeType: 'image/jpeg',
                                    width: 1024,
                                    height: 1024,
                                    accessToken: 'must-not-cross-the-bridge'
                                }],
                                mediaGenInput: {
                                    imageToVideo: {
                                        prompt: 'target prompt',
                                        inputAssets: [{
                                            sourceImageUrl: 'https://assets.grok.com/source.jpg?signature=secret'
                                        }]
                                    }
                                }
                            }
                        ]
                    })
                };
            });
            document.dispatchEvent(new CustomEvent('__gpt_fetch_asset_metadata', {
                detail: { requestId: 'metadata-1', conversationId, assetId }
            }));
            await metadataResultPromise;

            expect(metadataResults).toEqual([{
                requestId: 'metadata-1',
                metadata: expect.objectContaining({
                    schemaVersion: 2,
                    evidenceSource: 'grok_conversation_response',
                    conversationId,
                    assetId,
                    responseId: 'target-response',
                    parentResponseId: 'parent-response',
                    rootResponseId: 'root-response',
                    promptText: 'target prompt',
                    assetMetadata: expect.objectContaining({
                        assetId,
                        mimeType: 'image/jpeg',
                        width: 1024,
                        height: 1024
                    }),
                    mediaGenInput: expect.objectContaining({
                        imageToVideo: expect.objectContaining({
                            prompt: 'target prompt',
                            inputAssets: [{
                                sourceImageUrl: 'https://assets.grok.com/source.jpg'
                            }]
                        })
                    })
                })
            }]);
            expect(metadataResults[0].metadata.assetMetadata.accessToken).toBeUndefined();

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
            document.removeEventListener('__gpt_media_fetch_bridge_ready', readyListener);
            document.removeEventListener('__gpt_fetch_asset_metadata_result', metadataResultListener);
            setIntervalSpy.mockRestore();
        }
    });

    test('asset metadata helper returns only the exact bridge result', async () => {
        const root = document.createElement('div');
        const conversationId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
        const assetId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
        root.addEventListener('__gpt_media_fetch_bridge_probe', (event) => {
            root.dispatchEvent(new CustomEvent('__gpt_media_fetch_bridge_ready', {
                detail: { requestId: event.detail.requestId }
            }));
        });
        root.addEventListener('__gpt_fetch_asset_metadata', (event) => {
            root.dispatchEvent(new CustomEvent('__gpt_fetch_asset_metadata_result', {
                detail: {
                    requestId: event.detail.requestId,
                    metadata: {
                        schemaVersion: 2,
                        evidenceSource: 'grok_conversation_response',
                        conversationId,
                        assetId,
                        promptText: 'exact prompt',
                        assetMetadata: { assetId },
                        mediaGenInput: { prompt: 'exact prompt' }
                    }
                }
            }));
        });

        await expect(fetchGrokAssetMetadataViaBridge(
            conversationId,
            assetId,
            root,
            100
        )).resolves.toEqual(expect.objectContaining({
            conversationId,
            assetId,
            promptText: 'exact prompt'
        }));
    });

    test('conversation asset inventory returns every distinct sanitized attachment asset', async () => {
        const conversationId = '11111111-1111-4111-8111-111111111111';
        const imageAssetId = '22222222-2222-4222-8222-222222222222';
        const videoAssetId = '33333333-3333-4333-8333-333333333333';
        const payload = {
            responses: [{
                responseId: 'multi-asset-response',
                parentResponseId: 'multi-asset-parent',
                mediaGenInput: { prompt: 'candid friends at the beach' },
                fileAttachmentAssetMetadata: [
                    {
                        assetId: imageAssetId,
                        mimeType: 'image/jpeg',
                        url: `https://assets.grok.com/generated/${imageAssetId}/image.jpg?signature=image-secret`,
                        accessToken: 'image-token-must-not-cross-the-bridge'
                    },
                    {
                        assetId: videoAssetId,
                        mimeType: 'video/mp4',
                        url: `https://assets.grok.com/generated/${videoAssetId}/video.mp4?token=video-secret`,
                        cookie: 'video-cookie-must-not-cross-the-bridge'
                    }
                ]
            }]
        };
        const originalFetch = window.fetch;
        const fetchMock = jest.fn(async (url, options) => {
            expect(String(url)).toBe(`/rest/app-chat/conversations/${conversationId}/responses`);
            expect(options).toEqual({ credentials: 'include' });
            return {
                ok: true,
                json: async () => payload
            };
        });
        const inventoryResults = [];
        const resultListener = (event) => {
            inventoryResults.push(event.detail);
        };
        window.fetch = fetchMock;
        document.addEventListener('__gpt_fetch_conversation_asset_inventory_result', resultListener);

        if (!window.__gptPowerToolsBridgeInstalled) eval(bridgeSource);

        try {
            expect(payload.responses[0].fileAttachmentAssetMetadata).toHaveLength(2);
            document.dispatchEvent(new CustomEvent('__gpt_fetch_conversation_asset_inventory', {
                detail: { requestId: 'inventory-1', conversationId }
            }));
            await new Promise((resolve) => setTimeout(resolve, 0));

            expect(inventoryResults).toEqual([{
                requestId: 'inventory-1',
                inventory: {
                    schemaVersion: 1,
                    conversationId,
                    assets: [
                        expect.objectContaining({
                            assetId: imageAssetId,
                            responseId: 'multi-asset-response',
                            parentResponseId: 'multi-asset-parent',
                            mediaKind: 'image',
                            sourceUrl: `https://assets.grok.com/generated/${imageAssetId}/image.jpg`,
                            promptText: 'candid friends at the beach',
                            assetMetadata: expect.objectContaining({
                                assetId: imageAssetId,
                                mimeType: 'image/jpeg',
                                url: `https://assets.grok.com/generated/${imageAssetId}/image.jpg`
                            }),
                            mediaGenInput: { prompt: 'candid friends at the beach' }
                        }),
                        expect.objectContaining({
                            assetId: videoAssetId,
                            responseId: 'multi-asset-response',
                            parentResponseId: 'multi-asset-parent',
                            mediaKind: 'video',
                            sourceUrl: `https://assets.grok.com/generated/${videoAssetId}/video.mp4`,
                            promptText: 'candid friends at the beach',
                            assetMetadata: expect.objectContaining({
                                assetId: videoAssetId,
                                mimeType: 'video/mp4',
                                url: `https://assets.grok.com/generated/${videoAssetId}/video.mp4`
                            }),
                            mediaGenInput: { prompt: 'candid friends at the beach' }
                        })
                    ]
                }
            }]);
            expect(fetchMock).toHaveBeenCalledTimes(1);
            expect(JSON.stringify(inventoryResults)).not.toMatch(/image-secret|video-secret|must-not-cross/);
        } finally {
            window.fetch = originalFetch;
            document.removeEventListener('__gpt_fetch_conversation_asset_inventory_result', resultListener);
        }
    });

    test('conversation asset inventory derives the current Grok media URL from its object key', async () => {
        const conversationId = '44444444-4444-4444-8444-444444444444';
        const assetId = '55555555-5555-4555-8555-555555555555';
        const payload = {
            responses: [{
                responseId: 'key-only-response',
                mediaGenInput: { prompt: 'candid friends walking along the beach' },
                fileAttachmentAssetMetadata: [{
                    assetId,
                    key: `users/example/generated/${assetId}/image.jpg`,
                    mimeType: 'image/jpeg'
                }]
            }]
        };
        const originalFetch = window.fetch;
        window.fetch = jest.fn(async () => ({
            ok: true,
            json: async () => payload
        }));
        const resultPromise = new Promise((resolve) => {
            document.addEventListener('__gpt_fetch_conversation_asset_inventory_result', (event) => {
                if (event.detail?.requestId === 'inventory-key-only') resolve(event.detail);
            }, { once: true });
        });

        if (!window.__gptPowerToolsBridgeInstalled) eval(bridgeSource);

        try {
            document.dispatchEvent(new CustomEvent('__gpt_fetch_conversation_asset_inventory', {
                detail: { requestId: 'inventory-key-only', conversationId }
            }));

            await expect(resultPromise).resolves.toEqual({
                requestId: 'inventory-key-only',
                inventory: {
                    schemaVersion: 1,
                    conversationId,
                    assets: [expect.objectContaining({
                        assetId,
                        mediaKind: 'image',
                        sourceUrl: `https://assets.grok.com/users/example/generated/${assetId}/image.jpg`,
                        promptText: 'candid friends walking along the beach'
                    })]
                }
            });
        } finally {
            window.fetch = originalFetch;
        }
    });

    test('conversation asset inventory deduplicates repeated immutable media evidence across responses', async () => {
        const conversationId = '66666666-6666-4666-8666-666666666666';
        const assetId = '77777777-7777-4777-8777-777777777777';
        const assetMetadata = {
            assetId,
            key: `users/example/generated/${assetId}/image.jpg`,
            mimeType: 'image/jpeg'
        };
        const originalFetch = window.fetch;
        window.fetch = jest.fn(async () => ({
            ok: true,
            json: async () => ({
                data: {
                    responses: [
                        {
                            responseId: 'first-response',
                            mediaGenInput: { prompt: 'first prompt' },
                            fileAttachmentAssetMetadata: [{ ...assetMetadata }]
                        },
                        {
                            responseId: 'later-response',
                            parentResponseId: 'later-parent',
                            mediaGenInput: { prompt: 'later prompt' },
                            fileAttachmentAssetMetadata: [{ ...assetMetadata }]
                        }
                    ]
                }
            })
        }));
        const resultPromise = new Promise((resolve) => {
            document.addEventListener('__gpt_fetch_conversation_asset_inventory_result', (event) => {
                if (event.detail?.requestId === 'inventory-duplicate-agreement') resolve(event.detail);
            }, { once: true });
        });

        if (!window.__gptPowerToolsBridgeInstalled) eval(bridgeSource);

        try {
            document.dispatchEvent(new CustomEvent('__gpt_fetch_conversation_asset_inventory', {
                detail: { requestId: 'inventory-duplicate-agreement', conversationId }
            }));

            await expect(resultPromise).resolves.toEqual({
                requestId: 'inventory-duplicate-agreement',
                inventory: {
                    schemaVersion: 1,
                    conversationId,
                    assets: [expect.objectContaining({
                        assetId,
                        responseId: 'first-response',
                        promptText: 'first prompt'
                    })]
                }
            });
        } finally {
            window.fetch = originalFetch;
        }
    });

    test('conversation asset inventory rejects conflicting evidence for one asset identity', async () => {
        const conversationId = '88888888-8888-4888-8888-888888888888';
        const assetId = '99999999-9999-4999-8999-999999999999';
        const originalFetch = window.fetch;
        window.fetch = jest.fn(async () => ({
            ok: true,
            json: async () => ({
                responses: [
                    {
                        responseId: 'first-response',
                        fileAttachmentAssetMetadata: [{
                            assetId,
                            key: `users/example/generated/${assetId}/image.jpg`,
                            mimeType: 'image/jpeg'
                        }]
                    },
                    {
                        responseId: 'conflicting-response',
                        fileAttachmentAssetMetadata: [{
                            assetId,
                            key: `users/example/generated/${assetId}/image.png`,
                            mimeType: 'image/png'
                        }]
                    }
                ]
            })
        }));
        const resultPromise = new Promise((resolve) => {
            document.addEventListener('__gpt_fetch_conversation_asset_inventory_result', (event) => {
                if (event.detail?.requestId === 'inventory-duplicate-conflict') resolve(event.detail);
            }, { once: true });
        });

        if (!window.__gptPowerToolsBridgeInstalled) eval(bridgeSource);

        try {
            document.dispatchEvent(new CustomEvent('__gpt_fetch_conversation_asset_inventory', {
                detail: { requestId: 'inventory-duplicate-conflict', conversationId }
            }));

            await expect(resultPromise).resolves.toEqual({
                requestId: 'inventory-duplicate-conflict',
                error: 'conversation_asset_duplicate_conflict'
            });
        } finally {
            window.fetch = originalFetch;
        }
    });

    test('conversation asset inventory helper validates a key-derived current Grok asset', async () => {
        const root = document.createElement('div');
        const conversationId = '44444444-4444-4444-8444-444444444444';
        const assetId = '55555555-5555-4555-8555-555555555555';
        root.addEventListener('__gpt_media_fetch_bridge_probe', (event) => {
            root.dispatchEvent(new CustomEvent('__gpt_media_fetch_bridge_ready', {
                detail: { requestId: event.detail.requestId }
            }));
        });
        root.addEventListener('__gpt_fetch_conversation_asset_inventory', (event) => {
            root.dispatchEvent(new CustomEvent('__gpt_fetch_conversation_asset_inventory_result', {
                detail: {
                    requestId: event.detail.requestId,
                    inventory: {
                        schemaVersion: 1,
                        conversationId,
                        assets: [{
                            assetId,
                            responseId: 'response-1',
                            parentResponseId: 'parent-1',
                            mediaKind: 'image',
                            sourceUrl: `https://assets.grok.com/users/example/generated/${assetId}/image.jpg`,
                            promptText: 'candid friends at the beach',
                            assetMetadata: {
                                assetId,
                                key: `users/example/generated/${assetId}/image.jpg`,
                                mimeType: 'image/jpeg'
                            },
                            mediaGenInput: { prompt: 'candid friends at the beach' }
                        }]
                    }
                }
            }));
        });

        await expect(fetchGrokConversationAssetInventoryViaBridge(
            conversationId,
            root,
            100
        )).resolves.toEqual(expect.objectContaining({
            conversationId,
            assets: [expect.objectContaining({ assetId, mediaKind: 'image' })]
        }));
    });

    test('media helper uses the page-world data URL bridge without refetching a blob URL', async () => {
        const root = document.createElement('div');
        const removeListenerSpy = jest.spyOn(root, 'removeEventListener');
        const releases = [];
        const originalFetch = global.fetch;
        global.fetch = jest.fn(async () => {
            throw new Error('isolated-world blob URLs are not fetchable');
        });
        root.addEventListener('__gpt_media_fetch_bridge_probe', (event) => {
            root.dispatchEvent(new CustomEvent('__gpt_media_fetch_bridge_ready', {
                detail: { requestId: event.detail.requestId }
            }));
        });
        root.addEventListener('__gpt_fetch_media_data_url', (event) => {
            root.dispatchEvent(new CustomEvent('__gpt_fetch_media_data_url_result', {
                detail: {
                    requestId: event.detail.requestId,
                    dataUrl: 'data:video/mp4;base64,bWVkaWE=',
                    size: 5,
                    type: 'video/mp4'
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
            )).resolves.toEqual({
                dataUrl: 'data:video/mp4;base64,bWVkaWE=',
                size: 5,
                type: 'video/mp4'
            });
            expect(removeListenerSpy).toHaveBeenCalledWith(
                '__gpt_fetch_media_data_url_result',
                expect.any(Function)
            );
            expect(global.fetch).not.toHaveBeenCalled();
            expect(releases).toEqual([
                expect.objectContaining({ requestId: expect.stringMatching(/^fetch_/) })
            ]);
        } finally {
            global.fetch = originalFetch;
            removeListenerSpy.mockRestore();
        }
    });

    test('media helper waits for a delayed page-world bridge before dispatching its fetch', async () => {
        const root = document.createElement('div');
        const fetches = [];
        const eventOrder = [];
        let probeListener;
        let fetchListener;

        root.addEventListener('__gpt_fetch_media_data_url', () => {
            eventOrder.push('fetch-observed');
        });

        const installBridge = setTimeout(() => {
            probeListener = (event) => {
                eventOrder.push('ready');
                root.dispatchEvent(new CustomEvent('__gpt_media_fetch_bridge_ready', {
                    detail: { requestId: event.detail.requestId }
                }));
            };
            fetchListener = (event) => {
                fetches.push(event.detail);
                root.dispatchEvent(new CustomEvent('__gpt_fetch_media_data_url_result', {
                    detail: {
                        requestId: event.detail.requestId,
                        dataUrl: 'data:image/jpeg;base64,bWVkaWE=',
                        size: 5,
                        type: 'image/jpeg'
                    }
                }));
            };
            root.addEventListener('__gpt_media_fetch_bridge_probe', probeListener);
            root.addEventListener('__gpt_fetch_media_data_url', fetchListener);
        }, 25);

        try {
            await expect(fetchMediaDataUrlViaBridge(
                'https://assets.grok.com/users/example/image.jpg',
                root,
                250
            )).resolves.toEqual({
                dataUrl: 'data:image/jpeg;base64,bWVkaWE=',
                size: 5,
                type: 'image/jpeg'
            });
            expect(fetches).toHaveLength(1);
            expect(eventOrder).toEqual(['ready', 'fetch-observed']);
        } finally {
            clearTimeout(installBridge);
            if (probeListener) root.removeEventListener('__gpt_media_fetch_bridge_probe', probeListener);
            if (fetchListener) root.removeEventListener('__gpt_fetch_media_data_url', fetchListener);
        }
    });

    test('media helper fails clearly when the page-world bridge never becomes ready', async () => {
        const root = document.createElement('div');
        const fetchListener = jest.fn();
        root.addEventListener('__gpt_fetch_media_data_url', fetchListener);

        try {
            await expect(fetchMediaDataUrlViaBridge(
                'https://assets.grok.com/users/example/image.jpg',
                root,
                30
            )).rejects.toThrow('Media fetch bridge not ready');
            expect(fetchListener).not.toHaveBeenCalled();
        } finally {
            root.removeEventListener('__gpt_fetch_media_data_url', fetchListener);
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
