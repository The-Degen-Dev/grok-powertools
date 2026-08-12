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
