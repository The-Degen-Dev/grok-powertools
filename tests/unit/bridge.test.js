const fs = require('fs');
const path = require('path');
const { VideoRetryManager } = require('../../content.js');

const bridgeSource = fs.readFileSync(path.resolve(__dirname, '../../bridge.js'), 'utf8');

describe('bridge prompted video editor targeting', () => {
    test('double evaluation writes once, settles once, succeeds, and cleans the marker', () => {
        const preciseEditor = document.createElement('div');
        preciseEditor.setAttribute('contenteditable', 'true');
        preciseEditor.setAttribute('aria-label', 'Ask Grok anything');
        const composer = document.createElement('div');
        composer.className = 'query-bar';
        const videoEditor = document.createElement('div');
        videoEditor.setAttribute('contenteditable', 'true');
        videoEditor.setAttribute('role', 'textbox');
        videoEditor.setAttribute('aria-label', 'Ask Grok anything');
        const submit = document.createElement('button');
        submit.setAttribute('aria-label', 'Make video');
        jest.spyOn(submit, 'getBoundingClientRect').mockReturnValue({
            x: 0,
            y: 0,
            top: 0,
            left: 0,
            right: 40,
            bottom: 40,
            width: 40,
            height: 40
        });
        composer.append(videoEditor, submit);
        document.body.append(preciseEditor, composer);

        const results = [];
        const resultListener = (event) => {
            results.push(event.detail);
        };
        document.addEventListener('__gpt_set_prompted_video_content_result', resultListener);
        let writes = 0;
        videoEditor.addEventListener('input', () => { writes++; });
        const setIntervalSpy = jest.spyOn(global, 'setInterval').mockImplementation(() => 1);
        const retryManager = new VideoRetryManager(
            { setStatus: jest.fn(), el: document.createElement('div') },
            { settings: {}, subscribe: jest.fn() },
            { history: [], add: jest.fn() }
        );
        retryManager.promptedVideoComposerRoot = composer;

        eval(bridgeSource);
        eval(bridgeSource);

        try {
            expect(retryManager.injectPromptedVideoText('scoped video prompt')).toBe(true);

            expect(preciseEditor.textContent).toBe('');
            expect(videoEditor.textContent).toBe('scoped video prompt');
            expect(writes).toBe(1);
            expect(results).toHaveLength(1);
            expect(results[0]).toEqual(expect.objectContaining({ ok: true, error: null }));
            expect(videoEditor.hasAttribute('data-gpt-prompt-target')).toBe(false);
        } finally {
            retryManager.stopObserver();
            retryManager.generateMoreObserver.disconnect();
            document.removeEventListener('__gpt_set_prompted_video_content_result', resultListener);
            setIntervalSpy.mockRestore();
        }
    });
});
