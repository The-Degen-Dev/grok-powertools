function createStorageArea(initial = {}) {
    const values = JSON.parse(JSON.stringify(initial));
    return {
        get: jest.fn(async (keys) => {
            if (keys === null || typeof keys === 'undefined') {
                return JSON.parse(JSON.stringify(values));
            }
            const requested = Array.isArray(keys) ? keys : [keys];
            return Object.fromEntries(requested
                .filter((key) => Object.prototype.hasOwnProperty.call(values, key))
                .map((key) => [key, JSON.parse(JSON.stringify(values[key]))]));
        }),
        set: jest.fn(async (items) => {
            Object.assign(values, JSON.parse(JSON.stringify(items)));
        }),
        remove: jest.fn(async (keys) => {
            for (const key of Array.isArray(keys) ? keys : [keys]) delete values[key];
        }),
        snapshot() {
            return JSON.parse(JSON.stringify(values));
        }
    };
}

function mockChromeForBackground() {
    const localStorage = createStorageArea();
    const sessionStorage = createStorageArea();
    return {
        alarms: {
            clear: jest.fn(() => Promise.resolve()),
            create: jest.fn(() => Promise.resolve()),
            onAlarm: { addListener: jest.fn() }
        },
        cookies: {
            getAll: jest.fn(() => Promise.resolve([]))
        },
        downloads: {
            cancel: jest.fn(),
            download: jest.fn(),
            erase: jest.fn(),
            onChanged: { addListener: jest.fn() },
            onDeterminingFilename: { addListener: jest.fn() },
            removeFile: jest.fn(),
            search: jest.fn()
        },
        debugger: {
            attach: jest.fn((target, version, callback) => callback()),
            detach: jest.fn((target, callback) => callback()),
            sendCommand: jest.fn((target, command, params, callback) => callback({}))
        },
        offscreen: {
            createDocument: jest.fn(() => Promise.resolve())
        },
        runtime: {
            getManifest: jest.fn(() => ({ version: 'test' })),
            getURL: jest.fn((path) => path),
            onMessage: { addListener: jest.fn() },
            sendMessage: jest.fn(() => Promise.resolve())
        },
        scripting: {
            executeScript: jest.fn()
        },
        storage: {
            local: localStorage,
            session: sessionStorage,
            onChanged: { addListener: jest.fn() }
        },
        tabs: {
            create: jest.fn(),
            onRemoved: { addListener: jest.fn() },
            onUpdated: { addListener: jest.fn() },
            query: jest.fn(),
            remove: jest.fn(),
            sendMessage: jest.fn((tabId, message, callback) => {
                const response = message?.action === 'INIT_SCRAPE'
                    ? {
                        status: 'started',
                        surface: 'saved_gallery',
                        runToken: message.runToken,
                        runEpoch: message.runEpoch
                    }
                    : { acknowledged: message?.action === 'GENERATION_RUN_CANCELLED' };
                if (typeof callback === 'function') callback(response);
                return Promise.resolve(response);
            })
        }
    };
}

function generationStartRequest() {
    return {
        action: 'GENERATION_RUN_START',
        kind: 'quick_batch',
        origin: {
            surface: 'results_gallery',
            url: 'https://grok.com/imagine?conversation=conversation-origin',
            scrollY: 0
        },
        items: [{
            version: 1,
            surface: 'results_gallery',
            sourceAssetId: 'asset-a',
            sourcePostId: 'post-a',
            conversationId: 'conversation-a'
        }],
        options: { maxRetries: 1 }
    };
}

describe('background recreate workflow wiring', () => {
    const originalFetch = global.fetch;
    let backgroundUnderTest = null;

    function loadBackground() {
        backgroundUnderTest = require('../../background.js');
        return backgroundUnderTest;
    }

    afterEach(async () => {
        await backgroundUnderTest?.ensureBackgroundStateReady().catch(() => {});
        backgroundUnderTest = null;
        delete global.GrokPowerToolsGenerationRunController;
        delete global.GrokPowerToolsGenerationRunState;
        delete global.GrokRecreateWorkflowBackground;
        delete global.GrokRecreateWorkflowUtils;
        delete global.importScripts;
        delete global.chrome;
        if (typeof originalFetch === 'undefined') {
            delete global.fetch;
        } else {
            global.fetch = originalFetch;
        }
        jest.resetModules();
        jest.dontMock('../../recreateWorkflowBackground.js');
        jest.clearAllMocks();
    });

    test('uses a live-safe controller message timeout', () => {
        const createRecreateWorkflowController = jest.fn(() => ({ start: jest.fn(), abort: jest.fn() }));
        jest.doMock('../../recreateWorkflowBackground.js', () => ({ createRecreateWorkflowController }));

        global.chrome = mockChromeForBackground();
        const background = loadBackground();

        expect(background.RECREATE_WORKFLOW_MESSAGE_TIMEOUT_MS).toBeGreaterThanOrEqual(420000);
        expect(createRecreateWorkflowController).toHaveBeenCalledWith(expect.objectContaining({
            chromeApi: global.chrome,
            messageTimeoutMs: background.RECREATE_WORKFLOW_MESSAGE_TIMEOUT_MS
        }));
    });

    test('fetches public Imagine references as normalized data URLs', async () => {
        global.chrome = mockChromeForBackground();
        global.fetch = jest.fn(() =>
            Promise.resolve({
                ok: true,
                blob: () =>
                    Promise.resolve({
                        size: 5,
                        type: 'image/jpeg',
                        arrayBuffer: () => Promise.resolve(Uint8Array.from([104, 101, 108, 108, 111]).buffer)
                    })
            })
        );

        const background = loadBackground();
        await expect(
            background.fetchRecreateReferenceDataUrl(
                'https://imagine-public.x.ai/imagine-public/share-images/reference.jpg'
            )
        ).resolves.toEqual({
            dataUrl: 'data:image/jpeg;base64,aGVsbG8=',
            mimeType: 'image/jpeg',
            byteLength: 5
        });
        expect(global.fetch).toHaveBeenCalledWith(
            'https://imagine-public.x.ai/imagine-public/share-images/reference.jpg',
            { credentials: 'omit' }
        );
    });

    test('fetches public Grok result media from images-public host', async () => {
        global.chrome = mockChromeForBackground();
        global.fetch = jest.fn(() =>
            Promise.resolve({
                ok: true,
                blob: () =>
                    Promise.resolve({
                        size: 5,
                        type: 'image/png',
                        arrayBuffer: () => Promise.resolve(Uint8Array.from([104, 101, 108, 108, 111]).buffer)
                    })
            })
        );

        const background = loadBackground();
        await expect(
            background.fetchRecreateReferenceDataUrl(
                'https://images-public.x.ai/xai-images-public/mj/images/result.png'
            )
        ).resolves.toEqual({
            dataUrl: 'data:image/png;base64,aGVsbG8=',
            mimeType: 'image/png',
            byteLength: 5
        });
        expect(global.fetch).toHaveBeenCalledWith(
            'https://images-public.x.ai/xai-images-public/mj/images/result.png',
            { credentials: 'omit' }
        );
    });

    test('fetches public Grok shared videos as normalized video data URLs', async () => {
        global.chrome = mockChromeForBackground();
        global.fetch = jest.fn(() =>
            Promise.resolve({
                ok: true,
                blob: () =>
                    Promise.resolve({
                        size: 5,
                        type: 'video/mp4',
                        arrayBuffer: () => Promise.resolve(Uint8Array.from([104, 101, 108, 108, 111]).buffer)
                    })
            })
        );

        const background = loadBackground();
        await expect(
            background.fetchRecreateReferenceDataUrl(
                'https://imagine-public.x.ai/imagine-public/share-videos/reference_1080_hd.mp4'
            )
        ).resolves.toEqual({
            dataUrl: 'data:video/mp4;base64,aGVsbG8=',
            mimeType: 'video/mp4',
            byteLength: 5,
            kind: 'video'
        });
        expect(global.fetch).toHaveBeenCalledWith(
            'https://imagine-public.x.ai/imagine-public/share-videos/reference_1080_hd.mp4',
            { credentials: 'omit' }
        );
    });

    test('dispatches native clicks through the Chrome debugger API', async () => {
        global.chrome = mockChromeForBackground();

        const background = loadBackground();
        await expect(background.dispatchNativeClick(123, { x: 10, y: 20 })).resolves.toEqual({ ok: true });

        expect(global.chrome.debugger.attach).toHaveBeenCalledWith({ tabId: 123 }, '1.3', expect.any(Function));
        expect(global.chrome.debugger.sendCommand.mock.calls.map((call) => call[1])).toEqual([
            'Input.dispatchMouseEvent',
            'Input.dispatchMouseEvent',
            'Input.dispatchMouseEvent'
        ]);
        expect(global.chrome.debugger.sendCommand.mock.calls.map((call) => call[2].type)).toEqual([
            'mouseMoved',
            'mousePressed',
            'mouseReleased'
        ]);
        expect(global.chrome.debugger.sendCommand.mock.calls[1][2]).toEqual(
            expect.objectContaining({ x: 10, y: 20, button: 'left', buttons: 1, clickCount: 1 })
        );
        expect(global.chrome.debugger.detach).toHaveBeenCalledWith({ tabId: 123 }, expect.any(Function));
    });

    test('handles native click runtime messages from the sender tab', async () => {
        global.chrome = mockChromeForBackground();

        loadBackground();
        const listener = global.chrome.runtime.onMessage.addListener.mock.calls[0][0];
        const sendResponse = jest.fn();
        const keepAlive = listener(
            { action: 'GPT_RECREATE_NATIVE_CLICK', click: { x: 42, y: 84 } },
            { tab: { id: 321 } },
            sendResponse
        );

        expect(keepAlive).toBe(true);
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(sendResponse).toHaveBeenCalledWith({ ok: true });
        expect(global.chrome.debugger.attach).toHaveBeenCalledWith({ tabId: 321 }, '1.3', expect.any(Function));
    });

    test('handles prompted-video native clicks from the sender tab', async () => {
        global.chrome = mockChromeForBackground();

        loadBackground();
        const listener = global.chrome.runtime.onMessage.addListener.mock.calls[0][0];
        const sendResponse = jest.fn();
        const keepAlive = listener(
            { action: 'GPT_PROMPTED_VIDEO_NATIVE_CLICK', click: { x: 24, y: 48 } },
            { tab: { id: 654 } },
            sendResponse
        );

        expect(keepAlive).toBe(true);
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(sendResponse).toHaveBeenCalledWith({ ok: true });
        expect(global.chrome.debugger.attach).toHaveBeenCalledWith({ tabId: 654 }, '1.3', expect.any(Function));
    });

    test('hydrates generation authority during background readiness without console errors', async () => {
        global.chrome = mockChromeForBackground();
        const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

        try {
            const background = loadBackground();
            await expect(background.ensureBackgroundStateReady()).resolves.toBe(true);

            expect(background.getBackgroundStateForTest()).toEqual({ status: 'ready', error: null });
            expect(background.getGenerationRunControllerForTest()).not.toBeNull();
            expect(errorSpy).not.toHaveBeenCalled();
        } finally {
            errorSpy.mockRestore();
        }
    });

    test('routes generation run messages after background readiness', async () => {
        global.chrome = mockChromeForBackground();
        const background = loadBackground();
        await background.ensureBackgroundStateReady();
        const listener = global.chrome.runtime.onMessage.addListener.mock.calls[0][0];
        const request = {
            action: 'GENERATION_RUN_START',
            kind: 'quick_batch',
            origin: {
                surface: 'results_gallery',
                url: 'https://grok.com/imagine?conversation=conversation-origin',
                scrollY: 400
            },
            items: [{
                version: 1,
                surface: 'results_gallery',
                sourceAssetId: 'asset-a',
                sourcePostId: 'post-a',
                conversationId: 'conversation-a',
                mediaKind: 'image',
                hrefPath: '/imagine/post/post-a',
                initialOrder: 0
            }],
            options: { maxRetries: 1 }
        };

        const response = await new Promise((resolve) => {
            expect(listener(request, { tab: { id: 42 }, documentId: 'document-a' }, resolve)).toBe(true);
        });

        expect(response).toEqual(expect.objectContaining({
            status: 'started',
            run: expect.objectContaining({ kind: 'quick_batch', ownerTabId: 42 })
        }));
        expect(global.chrome.storage.session.snapshot().generationRunLease).toEqual(
            expect.objectContaining({ runId: response.run.runId, ownerTabId: 42 })
        );
        expect(global.chrome.storage.local.snapshot().generationRunJournal).toEqual(
            expect.objectContaining({ runId: response.run.runId, ownerTabId: 42 })
        );
    });

    test('dispatches all six generation authority messages through the controller', async () => {
        const methods = {
            initialize: jest.fn(async () => null),
            startGenerationRun: jest.fn(async () => ({ status: 'start' })),
            claimGenerationAction: jest.fn(async () => ({ status: 'claim' })),
            reportGenerationAction: jest.fn(async () => ({ status: 'report' })),
            retryFailedGenerationItems: jest.fn(async () => ({ status: 'retry' })),
            cancelGenerationRun: jest.fn(async () => ({ status: 'cancel' })),
            cancelGenerationRunForOwnerTab: jest.fn(async () => ({ status: 'ignored' })),
            getGenerationRunStatus: jest.fn(async () => ({ status: 'status' }))
        };
        global.GrokPowerToolsGenerationRunController = {
            createGenerationRunController: jest.fn(() => methods)
        };
        global.chrome = mockChromeForBackground();
        const background = loadBackground();
        await background.ensureBackgroundStateReady();
        const listener = global.chrome.runtime.onMessage.addListener.mock.calls[0][0];
        const sender = { tab: { id: 42 }, documentId: 'document-a' };
        const cases = [
            ['GENERATION_RUN_START', 'startGenerationRun', 'start'],
            ['GENERATION_RUN_CLAIM', 'claimGenerationAction', 'claim'],
            ['GENERATION_RUN_REPORT', 'reportGenerationAction', 'report'],
            ['GENERATION_RUN_RETRY_FAILED', 'retryFailedGenerationItems', 'retry'],
            ['GENERATION_RUN_CANCEL', 'cancelGenerationRun', 'cancel'],
            ['GENERATION_RUN_STATUS', 'getGenerationRunStatus', 'status']
        ];

        for (const [action, methodName, expectedStatus] of cases) {
            const request = { action, marker: action };
            const response = await new Promise((resolve) => {
                expect(listener(request, sender, resolve)).toBe(true);
            });
            expect(response).toEqual({ status: expectedStatus });
            expect(methods[methodName]).toHaveBeenCalledWith(request, sender);
        }
    });

    test('rejects generation while Recreate owns mutating workflow authority', async () => {
        jest.doMock('../../recreateWorkflowBackground.js', () => ({
            createRecreateWorkflowController: jest.fn(() => ({
                abort: jest.fn(),
                getActiveRunStatus: jest.fn(() => ({
                    kind: 'recreate',
                    status: 'running',
                    runId: 'recreate-active'
                })),
                start: jest.fn()
            }))
        }));
        global.chrome = mockChromeForBackground();
        const background = loadBackground();
        await background.ensureBackgroundStateReady();
        const listener = global.chrome.runtime.onMessage.addListener.mock.calls[0][0];
        const request = {
            action: 'GENERATION_RUN_START',
            kind: 'quick_batch',
            origin: {
                surface: 'results_gallery',
                url: 'https://grok.com/imagine?conversation=conversation-origin',
                scrollY: 0
            },
            items: [{
                version: 1,
                surface: 'results_gallery',
                sourceAssetId: 'asset-a',
                sourcePostId: 'post-a',
                conversationId: 'conversation-a'
            }],
            options: { maxRetries: 1 }
        };
        const response = await new Promise((resolve) => {
            listener(request, { tab: { id: 42 }, documentId: 'document-a' }, resolve);
        });

        expect(response).toEqual({
            status: 'conflict',
            activeWorkflow: {
                kind: 'recreate',
                status: 'running',
                runId: 'recreate-active'
            }
        });
    });

    test('fails generation closed when its worker helpers cannot load', async () => {
        global.importScripts = jest.fn((...paths) => {
            if (paths.includes('generationRunState.js')) throw new Error('load failed');
        });
        global.chrome = mockChromeForBackground();
        const background = loadBackground();
        await background.ensureBackgroundStateReady();
        const listener = global.chrome.runtime.onMessage.addListener.mock.calls[0][0];

        const response = await new Promise((resolve) => {
            listener(
                generationStartRequest(),
                {
                    tab: { id: 42, url: 'https://grok.com/imagine?conversation=conversation-origin' },
                    documentId: 'document-a'
                },
                resolve
            );
        });

        expect(response).toEqual({
            status: 'rejected',
            error: 'GENERATION_HELPERS_LOAD_FAILED'
        });
    });

    test('serializes concurrent Generation and Sync starts under one authority', async () => {
        global.chrome = mockChromeForBackground();
        const background = loadBackground();
        await background.ensureBackgroundStateReady();
        const listener = global.chrome.runtime.onMessage.addListener.mock.calls[0][0];
        const dispatch = (request, sender) => new Promise((resolve) => listener(request, sender, resolve));

        const [generation, sync] = await Promise.all([
            dispatch(generationStartRequest(), {
                tab: { id: 42, url: 'https://grok.com/imagine?conversation=conversation-origin' },
                documentId: 'document-a'
            }),
            dispatch({ action: 'START_SCRAPE' }, {
                tab: { id: 42, url: 'https://grok.com/imagine/saved' },
                documentId: 'document-a'
            })
        ]);

        const winners = [generation.status === 'started', sync.status === 'started'].filter(Boolean);
        expect(winners).toHaveLength(1);
        expect([generation, sync].some((response) => response.status === 'conflict'
            || response.activeWorkflow)).toBe(true);
    });

    test('serializes concurrent Generation and Recreate starts under one authority', async () => {
        let recreateActive = null;
        const recreateStart = jest.fn((request) => {
            recreateActive = { kind: 'recreate', status: 'running', runId: 'recreate-run' };
            return Promise.resolve({ ok: true, runId: 'recreate-run', marker: request.marker });
        });
        jest.doMock('../../recreateWorkflowBackground.js', () => ({
            createRecreateWorkflowController: jest.fn(() => ({
                abort: jest.fn(),
                getActiveRunStatus: jest.fn(() => recreateActive),
                start: recreateStart
            }))
        }));
        global.chrome = mockChromeForBackground();
        const background = loadBackground();
        await background.ensureBackgroundStateReady();
        const listener = global.chrome.runtime.onMessage.addListener.mock.calls[0][0];
        const dispatch = (request, sender) => new Promise((resolve) => listener(request, sender, resolve));
        const sender = {
            tab: { id: 42, url: 'https://grok.com/imagine?conversation=conversation-origin' },
            documentId: 'document-a'
        };

        const [generation, recreate] = await Promise.all([
            dispatch(generationStartRequest(), sender),
            dispatch({
                action: 'START_GPT_RECREATE',
                marker: 'recreate',
                reference: {
                    source: 'local',
                    kind: 'image',
                    name: 'reference.png',
                    mimeType: 'image/png',
                    dataUrl: 'data:image/png;base64,AAAA'
                }
            }, sender)
        ]);

        const generationWon = generation.status === 'started';
        const recreateWon = recreate.ok === true;
        expect([generationWon, recreateWon].filter(Boolean)).toHaveLength(1);
        expect(generation.status === 'conflict' || recreate.status === 'conflict').toBe(true);
    });
});
