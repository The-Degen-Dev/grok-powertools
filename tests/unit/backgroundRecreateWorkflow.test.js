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
    afterEach(() => {
        delete global.chrome;
        jest.resetModules();
        jest.clearAllMocks();
    });

    test('uses a live-safe controller message timeout', () => {
        const createRecreateWorkflowController = jest.fn(() => ({ start: jest.fn(), abort: jest.fn() }));
        jest.doMock('../../recreateWorkflowBackground.js', () => ({ createRecreateWorkflowController }));

        global.chrome = mockChromeForBackground();
        const background = require('../../background.js');

        expect(background.RECREATE_WORKFLOW_MESSAGE_TIMEOUT_MS).toBeGreaterThanOrEqual(120000);
        expect(createRecreateWorkflowController).toHaveBeenCalledWith(expect.objectContaining({
            chromeApi: global.chrome,
            messageTimeoutMs: background.RECREATE_WORKFLOW_MESSAGE_TIMEOUT_MS
        }));
    });
});
