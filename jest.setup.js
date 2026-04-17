// Mock Chrome API
const addListenerMock = jest.fn();
const removeListenerMock = jest.fn();

global.chrome = {
    runtime: {
        // content.js calls this at module load to inject bridge.js; without it,
        // importing content.js from tests throws before any code under test runs.
        getURL: jest.fn((path) => `chrome-extension://test-id/${path}`),
        sendMessage: jest.fn(() => Promise.resolve()),
        onMessage: {
            addListener: addListenerMock,
            removeListener: removeListenerMock
        },
        lastError: null
    },
    tabs: {
        query: jest.fn(),
        sendMessage: jest.fn(),
        onUpdated: {
            addListener: jest.fn()
        },
        remove: jest.fn()
    },
    scripting: {
        executeScript: jest.fn()
    },
    downloads: {
        download: jest.fn(),
        cancel: jest.fn(),
        onDeterminingFilename: {
            addListener: jest.fn()
        }
    },
    alarms: {
        create: jest.fn(),
        clear: jest.fn(() => Promise.resolve(true)),
        onAlarm: {
            addListener: jest.fn()
        }
    },
    storage: {
        onChanged: {
            addListener: jest.fn(),
            removeListener: jest.fn()
        },
        local: {
            get: jest.fn((keys, callback) => {
                if (typeof callback === 'function') callback({});
                return Promise.resolve({});
            }),
            set: jest.fn((items, callback) => {
                if (typeof callback === 'function') callback();
                return Promise.resolve();
            })
        },
        sync: {
            get: jest.fn((keys, callback) => {
                if (typeof callback === 'function') callback({});
                return Promise.resolve({});
            }),
            set: jest.fn((items, callback) => {
                if (typeof callback === 'function') callback();
                return Promise.resolve();
            })
        }
    }
};
