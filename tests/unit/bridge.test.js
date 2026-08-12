const fs = require('fs');
const path = require('path');

const bridgeSource = fs.readFileSync(path.resolve(__dirname, '../../bridge.js'), 'utf8');

describe('bridge prompted video editor targeting', () => {
    test('writes only the marked editor and reports marker cleanup or a missing target', () => {
        const preciseEditor = document.createElement('div');
        preciseEditor.setAttribute('contenteditable', 'true');
        preciseEditor.setAttribute('aria-label', 'Ask Grok anything');
        const videoEditor = document.createElement('div');
        videoEditor.setAttribute('contenteditable', 'true');
        videoEditor.setAttribute('aria-label', 'Ask Grok anything');
        videoEditor.setAttribute('data-gpt-prompt-target', 'video-target');
        document.body.append(preciseEditor, videoEditor);

        const results = [];
        document.addEventListener('__gpt_set_prompted_video_content_result', (event) => {
            results.push(event.detail);
        });
        eval(bridgeSource);

        document.dispatchEvent(new CustomEvent('__gpt_set_prompted_video_content', {
            detail: { marker: 'video-target', text: 'scoped video prompt' }
        }));
        document.dispatchEvent(new CustomEvent('__gpt_set_prompted_video_content', {
            detail: { marker: 'missing-target', text: 'must not write' }
        }));

        expect(preciseEditor.textContent).toBe('');
        expect(videoEditor.textContent).toBe('scoped video prompt');
        expect(videoEditor.hasAttribute('data-gpt-prompt-target')).toBe(false);
        expect(results).toEqual([
            { marker: 'video-target', ok: true, error: null },
            { marker: 'missing-target', ok: false, error: 'Marked prompted video editor not found' }
        ]);
    });
});
