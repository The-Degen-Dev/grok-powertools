function mockChromeForBackground() {
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
            local: {
                get: jest.fn(() => Promise.resolve({})),
                set: jest.fn(() => Promise.resolve())
            },
            onChanged: { addListener: jest.fn() }
        },
        tabs: {
            create: jest.fn(),
            onUpdated: { addListener: jest.fn() },
            query: jest.fn(),
            remove: jest.fn(),
            sendMessage: jest.fn()
        }
    };
}

describe('background recreate workflow wiring', () => {
    const originalFetch = global.fetch;

    afterEach(() => {
        delete global.chrome;
        if (typeof originalFetch === 'undefined') {
            delete global.fetch;
        } else {
            global.fetch = originalFetch;
        }
        jest.resetModules();
        jest.clearAllMocks();
    });

    test('uses a live-safe controller message timeout', () => {
        const createRecreateWorkflowController = jest.fn(() => ({ start: jest.fn(), abort: jest.fn() }));
        jest.doMock('../../recreateWorkflowBackground.js', () => ({ createRecreateWorkflowController }));

        global.chrome = mockChromeForBackground();
        const background = require('../../background.js');

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

        const background = require('../../background.js');
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

        const background = require('../../background.js');
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

        const background = require('../../background.js');
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

        const background = require('../../background.js');
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

        require('../../background.js');
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
});
