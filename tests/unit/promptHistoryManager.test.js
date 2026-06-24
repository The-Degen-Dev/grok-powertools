const { PromptHistoryManager } = require('../../content.js');

describe('PromptHistoryManager', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        delete document.documentElement.dataset.gptPromptCaptureType;
        jest.clearAllMocks();
    });

    test('uses recreate prompt capture hint for submit history type', () => {
        const manager = new PromptHistoryManager({});
        manager.add = jest.fn();

        const editor = document.createElement('div');
        editor.setAttribute('contenteditable', 'true');
        editor.textContent = 'A handheld 10-second embrace.';
        document.body.appendChild(editor);

        const submit = document.createElement('button');
        submit.setAttribute('aria-label', 'Submit');
        document.body.appendChild(submit);

        document.documentElement.dataset.gptPromptCaptureType = 'video';
        submit.dispatchEvent(new MouseEvent('click', { bubbles: true }));

        expect(manager.add).toHaveBeenCalledWith('A handheld 10-second embrace.', 'video');
        expect(document.documentElement.dataset.gptPromptCaptureType).toBeUndefined();
    });
});
