const {
    EXTENSION_CONTEXT_REFRESHED_MESSAGE,
    GrokScraper,
    isExtensionContextInvalidatedError,
    safeChromeRuntimeSendMessage,
    safeChromeStorageGet,
    safeChromeStorageSet
} = require('../../content.js');

function installChrome(overrides = {}) {
    global.chrome = {
        runtime: {
            id: 'extension-id',
            sendMessage: jest.fn(() => Promise.resolve({ ok: true })),
            ...overrides.runtime
        },
        storage: {
            local: {
                get: jest.fn(() => Promise.resolve({})),
                set: jest.fn(() => Promise.resolve()),
                ...overrides.local
            },
            sync: {
                get: jest.fn(() => Promise.resolve({})),
                set: jest.fn(() => Promise.resolve()),
                ...overrides.sync
            },
            onChanged: {
                addListener: jest.fn()
            },
            ...overrides.storage
        }
    };
}

describe('content script extension context invalidation guards', () => {
    afterEach(() => {
        delete global.chrome;
        jest.restoreAllMocks();
    });

    test('detects Chrome extension context invalidation errors', () => {
        expect(isExtensionContextInvalidatedError(new Error('Extension context invalidated.'))).toBe(true);
        expect(isExtensionContextInvalidatedError(new Error('Extension context was invalidated.'))).toBe(true);
        expect(isExtensionContextInvalidatedError(new Error('some other failure'))).toBe(false);
    });

    test('storage get returns fallback without console warning when runtime id disappears', async () => {
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
        installChrome({ runtime: { id: '' } });

        const result = await safeChromeStorageGet('local', ['overlayState'], { overlayState: null }, 'load overlay state');

        expect(result).toEqual({
            ok: false,
            invalidated: true,
            operation: 'load overlay state',
            value: { overlayState: null }
        });
        expect(console.warn).not.toHaveBeenCalled();
        warn.mockRestore();
    });

    test('storage set reports expected invalidation without console warning', async () => {
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
        const set = jest.fn(() => Promise.reject(new Error('Extension context invalidated.')));
        installChrome({ local: { set } });

        const result = await safeChromeStorageSet('local', { processedIds: ['media-1'] }, 'save backup processed IDs');

        expect(result).toEqual({
            ok: false,
            invalidated: true,
            operation: 'save backup processed IDs',
            value: undefined
        });
        expect(set).toHaveBeenCalledWith({ processedIds: ['media-1'] });
        expect(console.warn).not.toHaveBeenCalled();
        warn.mockRestore();
    });

    test('runtime send returns fallback without throwing on expected invalidation', async () => {
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
        installChrome({
            runtime: {
                sendMessage: jest.fn(() => Promise.reject(new Error('Extension context invalidated.')))
            }
        });

        const result = await safeChromeRuntimeSendMessage(
            { action: 'R2_BACKUP_UPLOAD' },
            'upload R2 backup',
            { status: 'not_sent' }
        );

        expect(result).toEqual({
            ok: false,
            invalidated: true,
            operation: 'upload R2 backup',
            value: { status: 'not_sent' }
        });
        expect(console.warn).not.toHaveBeenCalled();
        warn.mockRestore();
    });

    test('scraper context invalidation stops in-memory run and shows refresh status without clearing processed IDs', () => {
        installChrome();
        const scraper = new GrokScraper();
        const overlay = { setStatus: jest.fn() };
        scraper.setOverlay(overlay);
        scraper.state.isRunning = true;
        scraper.backupMode = true;
        scraper.processedIds = new Set(['already-backed-up']);

        expect(scraper.handleExtensionContextInvalidated()).toBe(true);

        expect(scraper.state.isRunning).toBe(false);
        expect(scraper.backupMode).toBe(false);
        expect(scraper.processedIds).toEqual(new Set(['already-backed-up']));
        expect(overlay.setStatus).toHaveBeenCalledWith(EXTENSION_CONTEXT_REFRESHED_MESSAGE, 'error');
    });
});
