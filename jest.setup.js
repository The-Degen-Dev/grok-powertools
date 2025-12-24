// Mock Chrome API
global.chrome = {
    runtime: {
        sendMessage: jest.fn(),
        onMessage: {
            addListener: jest.fn()
        }
    },
    storage: {
        local: {
            get: jest.fn((keys, callback) => callback({})),
            set: jest.fn((items, callback) => callback && callback())
        }
    }
};
