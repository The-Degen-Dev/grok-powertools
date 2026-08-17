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
        expect(backupTitle).toMatch(/every Saved identity/i);
        expect(backupTitle).toMatch(/verifies current R2 presence/i);
        expect(backupTitle).toMatch(/uploads only missing media/i);
        expect(backupTitle).not.toMatch(/unprocessed media/i);
        expect(`${canaryTitle} ${backupTitle}`).not.toMatch(/reset\s+processed\s+IDs/i);
    });
});

describe('R2 durability completion labels', () => {
    afterEach(() => {
        jest.resetModules();
    });

    test.each([
        [{ stopReason: 'complete', pendingTransfers: 0, errors: 0 }, true, 'Complete'],
        [{ stopReason: 'canary_complete', pendingTransfers: 0, errors: 0 }, true, 'Canary complete'],
        [{ pendingTransfers: 0, errors: 0 }, false, 'Stopped'],
        [{ stopReason: 'complete', errors: 0 }, false, 'Incomplete'],
        [{ stopReason: 'complete', pendingTransfers: 1, errors: 0 }, false, 'Incomplete'],
        [{ stopReason: 'complete', pendingTransfers: 0, errors: 1 }, false, 'Incomplete'],
        [{ stopReason: 'durability_timeout', pendingTransfers: 0, errors: 0 }, false, 'Stopped'],
        [{ stopReason: 'durability_failed', pendingTransfers: 1, errors: 0 }, false, 'Stopped'],
        [{ stopReason: 'scan_limit', pendingTransfers: 0, errors: 0 }, false, 'Paused']
    ])('fails closed for completion state %#', (stats, successful, label) => {
        const {
            getR2BackupDoneStatusLabel,
            isR2BackupCompletionSuccessful
        } = require('../../popup.js');

        expect(isR2BackupCompletionSuccessful(stats)).toBe(successful);
        expect(getR2BackupDoneStatusLabel(stats)).toBe(label);
    });

    test('distinguishes cumulative queued transfers from current pending work', () => {
        const { formatR2BackupDetails } = require('../../popup.js');

        expect(formatR2BackupDetails({
            uploaded: 2,
            alreadyPresent: 3,
            queued: 1,
            pendingTransfers: 0,
            errors: 0
        })).toBe('2 uploaded / 3 already present / 1 queued total / 0 pending / 0 errors');
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

describe('authoritative scrape Stop UI', () => {
    afterEach(() => {
        document.documentElement.innerHTML = '<head></head><body></body>';
        jest.resetModules();
        jest.clearAllMocks();
    });

    test('keeps both run controls disabled until the background confirms durable Stop', () => {
        document.documentElement.innerHTML = fs.readFileSync(path.join(__dirname, '../../popup.html'), 'utf8');
        let stopCallback;
        chrome.runtime.sendMessage.mockImplementation((message, callback) => {
            if (message.action === 'STOP_SCRAPE') {
                stopCallback = callback;
                return undefined;
            }
            if (typeof callback === 'function') callback({ ok: true, state: {} });
            return Promise.resolve({ ok: true, state: {} });
        });
        chrome.storage.local.get.mockImplementation((_keys, callback) => {
            callback({ isScraping: true });
        });

        require('../../popup.js');
        document.dispatchEvent(new Event('DOMContentLoaded'));
        document.getElementById('stopBtn').click();

        expect(document.getElementById('startBtn').disabled).toBe(true);
        expect(document.getElementById('stopBtn').disabled).toBe(true);
        expect(document.getElementById('statusText').textContent).toBe('Stopping...');

        stopCallback({ status: 'stopped' });
        expect(document.getElementById('startBtn').disabled).toBe(false);
        expect(document.getElementById('stopBtn').disabled).toBe(true);
        expect(document.getElementById('statusText').textContent).toBe('Idle');
    });

    test('keeps R2 controls disabled until the background confirms durable Stop', () => {
        document.documentElement.innerHTML = fs.readFileSync(path.join(__dirname, '../../popup.html'), 'utf8');
        let stopCallback;
        chrome.runtime.sendMessage.mockImplementation((message, callback) => {
            if (message.action === 'STOP_R2_BACKUP') {
                stopCallback = callback;
                return undefined;
            }
            if (typeof callback === 'function') callback({ ok: true, state: {} });
            return Promise.resolve({ ok: true, state: {} });
        });
        chrome.storage.local.get.mockImplementation((_keys, callback) => {
            callback({ isR2Backup: true, r2BackupState: { isRunning: true } });
        });

        require('../../popup.js');
        document.dispatchEvent(new Event('DOMContentLoaded'));
        document.getElementById('r2BackupStopBtn').click();

        expect(document.getElementById('cloudMediaCanaryBtn').disabled).toBe(true);
        expect(document.getElementById('cloudMediaBackupBtn').disabled).toBe(true);
        expect(document.getElementById('r2BackupStopBtn').disabled).toBe(true);
        expect(document.getElementById('r2BackupStatus').textContent).toBe('Stopping...');

        stopCallback({ status: 'stopped' });
        expect(document.getElementById('cloudMediaCanaryBtn').disabled).toBe(false);
        expect(document.getElementById('cloudMediaBackupBtn').disabled).toBe(false);
        expect(document.getElementById('r2BackupStopBtn').disabled).toBe(false);
        expect(document.getElementById('r2BackupStatus').textContent).toBe('Stopped');
    });
});
