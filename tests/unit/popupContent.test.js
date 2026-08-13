const fs = require('fs');
const path = require('path');

function getPopupButtonTitle(id) {
    const popup = fs.readFileSync(path.join(__dirname, '../../popup.html'), 'utf8');
    const container = document.createElement('div');
    container.innerHTML = popup;
    return container.querySelector(`#${id}`)?.getAttribute('title') || '';
}

describe('R2 media backup popup guidance', () => {
    test('names Saved scope and preserves media backup safety guidance', () => {
        const canaryTitle = getPopupButtonTitle('cloudMediaCanaryBtn');
        const backupTitle = getPopupButtonTitle('cloudMediaBackupBtn');

        expect(canaryTitle).toMatch(/Grok Imagine Saved/i);
        expect(backupTitle).toMatch(/Grok Imagine Saved/i);
        expect(canaryTitle).toMatch(/one unprocessed media item/i);
        expect(backupTitle).toMatch(/scans the complete Grok Imagine Saved view/i);
        expect(backupTitle).toMatch(/uploads unprocessed media/i);
        expect(`${canaryTitle} ${backupTitle}`).not.toMatch(/reset\s+processed\s+IDs/i);
    });
});

describe('processed ID reset ownership', () => {
    afterEach(() => {
        document.documentElement.innerHTML = '<head></head><body></body>';
        jest.resetModules();
        jest.clearAllMocks();
    });

    test('routes the popup reset button through the background mutation message', () => {
        document.documentElement.innerHTML = fs.readFileSync(path.join(__dirname, '../../popup.html'), 'utf8');
        chrome.runtime.sendMessage.mockImplementation((message, callback) => {
            const response = message.action === 'PROCESSED_IDS_RESET'
                ? { status: 'ok', processedIds: [] }
                : { ok: true, state: {} };
            if (typeof callback === 'function') callback(response);
            return Promise.resolve(response);
        });
        chrome.storage.local.get.mockImplementation((keys, callback) => {
            if (typeof callback === 'function') callback({});
            return Promise.resolve({});
        });

        require('../../popup.js');
        document.dispatchEvent(new Event('DOMContentLoaded'));
        document.getElementById('resetProcessedIdsBtn').click();

        expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
            { action: 'PROCESSED_IDS_RESET' },
            expect.any(Function)
        );
        expect(chrome.storage.local.set).not.toHaveBeenCalledWith(expect.objectContaining({
            processedIds: expect.any(Array)
        }));
    });
});
