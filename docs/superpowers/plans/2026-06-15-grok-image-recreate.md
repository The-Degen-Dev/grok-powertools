# Grok Image Recreate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the extension-only two-tab Recreate Image workflow from `docs/superpowers/specs/2026-06-15-grok-image-recreate-design.md`.

**Architecture:** Add focused raw-JS helper files loaded by the MV3 service worker and content scripts, then wire them into the existing `background.js`, `content.js`, `bridge.js`, and overlay. `background.js` owns tab orchestration, `content.js` owns user-facing overlay/status wiring, and page DOM work lives in `recreateWorkflowContent.js`.

**Tech Stack:** Chrome MV3 extension, raw JavaScript, `chrome.tabs`, `chrome.runtime`, content scripts, DOM CustomEvents, Jest/jsdom, Playwright extension smoke tests.

---

## Scope Check

This plan implements Phase 1 only: extension overlay, two-tab Grok chat plus Grok Imagine workflow, fail-fast errors, prompt history, unit tests, mocked E2E, and live validation notes. It deliberately does not implement the future web app command bridge, queues, result downloads, or finished-generation polling.

## File Structure

- Create `recreateWorkflowUtils.js`: pure shared constants and functions for reference validation, data URL parsing, prompt extraction, instruction building, candidate scoring, run IDs, and failure response objects. Loaded by service worker via `importScripts`, by content scripts through `manifest.json`, and by Jest via `module.exports`.
- Create `recreateWorkflowContent.js`: browser-page helpers for current-image capture, file reconstruction, Grok upload/submit/injection, chat answer extraction, and Imagine prompt submission. Exposes `self.GrokRecreateContentActions` and `module.exports`.
- Create `recreateWorkflowBackground.js`: background workflow controller with injectable dependencies for tests. Owns active run state, tab creation/reuse, phase messaging, status routing, abort, and diagnostic-safe failure handling.
- Modify `manifest.json`: add `"tabs"` permission and load helper scripts before `content.js`.
- Modify `background.js`: import the new helper/controller files and route start/abort/status requests.
- Modify `content.js`: add overlay controls and a small content bridge class that connects overlay actions to background messages and content phase messages to `recreateWorkflowContent.js`.
- Modify `bridge.js`: keep existing editor helpers and add a data-URL fetch response event for trusted media capture when the content script cannot fetch directly.
- Add `tests/unit/recreateWorkflowUtils.test.js`.
- Add `tests/unit/recreateWorkflowContent.test.js`.
- Add `tests/unit/recreateWorkflowBackground.test.js`.
- Modify `tests/e2e/extension.spec.js`: evaluate helper scripts before `content.js` and add Recreate Image overlay smoke coverage.
- Modify `jest.setup.js`: add missing tab APIs used by the new background controller.
- Create `docs/superpowers/plans/2026-06-15-grok-image-recreate-implementation-notes.md` during live validation.

## Task 1: Shared Workflow Utilities

**Files:**
- Create: `recreateWorkflowUtils.js`
- Create: `tests/unit/recreateWorkflowUtils.test.js`

- [ ] **Step 1: Write failing utility tests**

Create `tests/unit/recreateWorkflowUtils.test.js`:

```js
const {
    ALLOWED_RECREATE_MIME_TYPES,
    buildRecreateChatInstruction,
    buildRecreateFailure,
    chooseBestGeneratedImageCandidate,
    extractFinalImaginePrompt,
    normalizeRecreateReference,
    parseRecreateDataUrl
} = require('../../recreateWorkflowUtils.js');

describe('recreate workflow utils', () => {
    const tinyPng = 'data:image/png;base64,aGVsbG8=';

    test('parses valid image data URLs', () => {
        const parsed = parseRecreateDataUrl(tinyPng);
        expect(parsed).toEqual({
            mimeType: 'image/png',
            base64: 'aGVsbG8=',
            byteLength: 5
        });
    });

    test('rejects invalid or unsupported data URLs', () => {
        expect(() => parseRecreateDataUrl('')).toThrow('reference_invalid');
        expect(() => parseRecreateDataUrl('data:text/plain;base64,aGVsbG8=')).toThrow('reference_invalid');
        expect(() => parseRecreateDataUrl('data:image/svg+xml;base64,aGVsbG8=')).toThrow('reference_invalid');
        expect(ALLOWED_RECREATE_MIME_TYPES).toContain('image/webp');
    });

    test('normalizes local reference payloads', () => {
        expect(normalizeRecreateReference({
            name: '  sample.png  ',
            mimeType: 'image/png',
            dataUrl: tinyPng,
            source: 'drop'
        })).toEqual({
            name: 'sample.png',
            mimeType: 'image/png',
            dataUrl: tinyPng,
            source: 'drop',
            byteLength: 5
        });
    });

    test('extracts only prompt text after the strict marker', () => {
        expect(extractFinalImaginePrompt('Notes\\nFINAL_IMAGINE_PROMPT:\\nA cinematic red cabin in snow.'))
            .toBe('A cinematic red cabin in snow.');
    });

    test('fails when final prompt marker is absent', () => {
        expect(() => extractFinalImaginePrompt('A cinematic red cabin in snow.'))
            .toThrow('chat_prompt_marker_missing');
    });

    test('builds chat instruction with and without Grok Search wording', () => {
        const withSearch = buildRecreateChatInstruction({ bestPracticesEnabled: true });
        const withoutSearch = buildRecreateChatInstruction({ bestPracticesEnabled: false });

        expect(withSearch).toContain('use Grok search');
        expect(withSearch).toContain('FINAL_IMAGINE_PROMPT:');
        expect(withoutSearch).not.toContain('use Grok search');
        expect(withoutSearch).toContain('FINAL_IMAGINE_PROMPT:');
    });

    test('chooses generated image nearest viewport center', () => {
        const best = chooseBestGeneratedImageCandidate([
            { src: 'data:image/png;base64,aaa=', alt: 'Generated image', naturalWidth: 720, naturalHeight: 720, rect: { left: 10, top: 10, width: 100, height: 100 } },
            { src: 'data:image/png;base64,bbb=', alt: 'Generated image', naturalWidth: 720, naturalHeight: 720, rect: { left: 450, top: 300, width: 100, height: 100 } },
            { src: 'data:image/png;base64,ccc=', alt: 'avatar', naturalWidth: 720, naturalHeight: 720, rect: { left: 500, top: 300, width: 100, height: 100 } }
        ], { width: 1000, height: 700 });

        expect(best.src).toBe('data:image/png;base64,bbb=');
    });

    test('builds safe failure responses without payloads', () => {
        const failure = buildRecreateFailure({
            runId: 'recreate_1',
            phase: 'chat',
            error: 'chat_submit_missing',
            diagnostics: {
                url: 'https://grok.com/',
                dataUrl: 'data:image/png;base64,secret',
                cookie: 'session=secret'
            }
        });

        expect(failure).toEqual({
            ok: false,
            runId: 'recreate_1',
            phase: 'chat',
            error: 'chat_submit_missing',
            diagnostics: { url: 'https://grok.com/' }
        });
    });
});
```

- [ ] **Step 2: Run the failing utility tests**

Run:

```bash
npm run test:unit -- tests/unit/recreateWorkflowUtils.test.js
```

Expected: fail with `Cannot find module '../../recreateWorkflowUtils.js'`.

- [ ] **Step 3: Add shared utility implementation**

Create `recreateWorkflowUtils.js`:

```js
(function(root, factory) {
    const utils = factory();
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = utils;
    }
    if (root) {
        root.GrokRecreateWorkflowUtils = utils;
    }
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this), function() {
    const ALLOWED_RECREATE_MIME_TYPES = [
        'image/jpeg',
        'image/png',
        'image/gif',
        'image/webp',
        'image/bmp',
        'image/tiff'
    ];
    const ALLOWED_SOURCE_VALUES = ['local', 'paste', 'drop', 'current-grok-image'];
    const FINAL_PROMPT_MARKER = 'FINAL_IMAGINE_PROMPT:';
    const MAX_REFERENCE_BYTES = 8 * 1024 * 1024;

    function createRecreateRunId(now = Date.now()) {
        return `recreate_${now}_${Math.random().toString(16).slice(2, 10)}`;
    }

    function fail(error) {
        const err = new Error(error);
        err.code = error;
        return err;
    }

    function byteLengthFromBase64(base64) {
        const clean = String(base64 || '').replace(/\s+/g, '');
        if (!clean) return 0;
        const padding = clean.endsWith('==') ? 2 : (clean.endsWith('=') ? 1 : 0);
        return Math.max(0, Math.floor(clean.length * 3 / 4) - padding);
    }

    function parseRecreateDataUrl(dataUrl) {
        const match = String(dataUrl || '').match(/^data:([^;,]+);base64,([a-zA-Z0-9+/=\\s]+)$/);
        if (!match) throw fail('reference_invalid');

        const mimeType = match[1].toLowerCase();
        if (!ALLOWED_RECREATE_MIME_TYPES.includes(mimeType)) throw fail('reference_invalid');

        const base64 = match[2].replace(/\s+/g, '');
        const byteLength = byteLengthFromBase64(base64);
        if (byteLength <= 0 || byteLength > MAX_REFERENCE_BYTES) throw fail('reference_invalid');

        return { mimeType, base64, byteLength };
    }

    function normalizeRecreateReference(input) {
        if (!input || typeof input !== 'object') throw fail('reference_missing');

        const parsed = parseRecreateDataUrl(input.dataUrl);
        const mimeType = String(input.mimeType || parsed.mimeType).toLowerCase();
        if (mimeType !== parsed.mimeType || !ALLOWED_RECREATE_MIME_TYPES.includes(mimeType)) {
            throw fail('reference_invalid');
        }

        const source = ALLOWED_SOURCE_VALUES.includes(input.source) ? input.source : 'local';
        const name = String(input.name || 'reference-image').trim().slice(0, 120) || 'reference-image';

        return {
            name,
            mimeType,
            dataUrl: String(input.dataUrl),
            source,
            byteLength: parsed.byteLength
        };
    }

    function extractFinalImaginePrompt(answerText) {
        const text = String(answerText || '');
        const markerIndex = text.indexOf(FINAL_PROMPT_MARKER);
        if (markerIndex < 0) throw fail('chat_prompt_marker_missing');

        const prompt = text.slice(markerIndex + FINAL_PROMPT_MARKER.length)
            .replace(/^\\s+/, '')
            .replace(/\\s+$/, '');
        if (!prompt) throw fail('chat_prompt_marker_missing');
        return prompt;
    }

    function buildRecreateChatInstruction(options = {}) {
        const bestPracticesLine = options.bestPracticesEnabled
            ? 'If best-practices mode is enabled, use Grok search to find current Grok Imagine prompt best practices and apply them.'
            : 'Use only your visual analysis of the attached image and the prompt-writing instructions below.';

        return [
            'You are creating a Grok Imagine prompt from the attached reference image.',
            '',
            'Analyze composition, subject, pose, camera angle, focal length, lighting, color, materials, mood, background, and style. Preserve the important visual structure while avoiding references to this instruction.',
            '',
            bestPracticesLine,
            '',
            'Return exactly one final prompt for Grok Imagine. Do not include alternatives, commentary, markdown tables, or explanations.',
            '',
            FINAL_PROMPT_MARKER,
            '<one ready-to-paste Grok Imagine prompt>'
        ].join('\\n');
    }

    function isTrustedGrokMediaUrl(value) {
        try {
            const url = new URL(String(value || ''));
            return url.protocol === 'https:'
                && (url.hostname === 'imagine-public.x.ai' || url.hostname === 'assets.grok.com');
        } catch {
            return false;
        }
    }

    function isSupportedCurrentImageSrc(src) {
        const value = String(src || '');
        return value.startsWith('data:image/')
            || value.startsWith('blob:')
            || isTrustedGrokMediaUrl(value);
    }

    function chooseBestGeneratedImageCandidate(candidates, viewport) {
        const centerX = (viewport && viewport.width ? viewport.width : 0) / 2;
        const centerY = (viewport && viewport.height ? viewport.height : 0) / 2;
        return (Array.isArray(candidates) ? candidates : [])
            .filter((candidate) => {
                if (!candidate || candidate.alt !== 'Generated image') return false;
                if (!isSupportedCurrentImageSrc(candidate.src)) return false;
                return Math.max(candidate.naturalWidth || 0, candidate.naturalHeight || 0) >= 256;
            })
            .map((candidate) => {
                const rect = candidate.rect || {};
                const x = Number(rect.left || 0) + Number(rect.width || 0) / 2;
                const y = Number(rect.top || 0) + Number(rect.height || 0) / 2;
                return {
                    ...candidate,
                    _distance: Math.hypot(x - centerX, y - centerY)
                };
            })
            .sort((a, b) => a._distance - b._distance)[0] || null;
    }

    function scrubDiagnostics(diagnostics) {
        const safe = {};
        const blockedKeys = new Set(['dataUrl', 'reference', 'cookie', 'authorization', 'token', 'apiKey', 'password']);
        Object.entries(diagnostics || {}).forEach(([key, value]) => {
            if (blockedKeys.has(key)) return;
            if (typeof value === 'string' && value.startsWith('data:image/')) return;
            safe[key] = value;
        });
        return safe;
    }

    function buildRecreateFailure({ runId, phase, error, diagnostics }) {
        return {
            ok: false,
            runId,
            phase,
            error,
            diagnostics: scrubDiagnostics(diagnostics)
        };
    }

    return {
        ALLOWED_RECREATE_MIME_TYPES,
        FINAL_PROMPT_MARKER,
        MAX_REFERENCE_BYTES,
        buildRecreateChatInstruction,
        buildRecreateFailure,
        chooseBestGeneratedImageCandidate,
        createRecreateRunId,
        extractFinalImaginePrompt,
        isSupportedCurrentImageSrc,
        isTrustedGrokMediaUrl,
        normalizeRecreateReference,
        parseRecreateDataUrl
    };
});
```

- [ ] **Step 4: Run utility tests until they pass**

Run:

```bash
npm run test:unit -- tests/unit/recreateWorkflowUtils.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit shared utilities**

Run:

```bash
git add recreateWorkflowUtils.js tests/unit/recreateWorkflowUtils.test.js
git commit -m "feat: add recreate workflow utilities"
```

## Task 2: Content Reference Capture Helpers

**Files:**
- Create: `recreateWorkflowContent.js`
- Create: `tests/unit/recreateWorkflowContent.test.js`

- [ ] **Step 1: Write failing content helper tests**

Create `tests/unit/recreateWorkflowContent.test.js`:

```js
const utils = require('../../recreateWorkflowUtils.js');
const {
    collectGeneratedImageCandidates,
    dataUrlToFile,
    readFileAsRecreateReference,
    selectCurrentGeneratedImage,
    waitForCondition
} = require('../../recreateWorkflowContent.js');

describe('recreate content helpers', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
    });

    test('reads local files into normalized references', async () => {
        const file = new File(['hello'], 'sample.png', { type: 'image/png' });
        const reference = await readFileAsRecreateReference(file, 'local');

        expect(reference).toEqual(expect.objectContaining({
            name: 'sample.png',
            mimeType: 'image/png',
            source: 'local',
            byteLength: 5
        }));
        expect(reference.dataUrl).toMatch(/^data:image\\/png;base64,/);
    });

    test('recreates a File from normalized reference data', () => {
        const file = dataUrlToFile({
            name: 'reference.png',
            mimeType: 'image/png',
            dataUrl: 'data:image/png;base64,aGVsbG8=',
            source: 'drop'
        });

        expect(file.name).toBe('reference.png');
        expect(file.type).toBe('image/png');
        expect(file.size).toBe(5);
    });

    test('collects visible generated image candidates', () => {
        const img = document.createElement('img');
        img.alt = 'Generated image';
        img.src = 'data:image/png;base64,aGVsbG8=';
        Object.defineProperty(img, 'naturalWidth', { value: 720 });
        Object.defineProperty(img, 'naturalHeight', { value: 720 });
        img.getBoundingClientRect = () => ({ left: 400, top: 300, width: 200, height: 200 });
        document.body.appendChild(img);

        const candidates = collectGeneratedImageCandidates(document);
        expect(candidates).toHaveLength(1);
        expect(candidates[0]).toEqual(expect.objectContaining({
            src: 'data:image/png;base64,aGVsbG8=',
            alt: 'Generated image',
            naturalWidth: 720,
            naturalHeight: 720
        }));
    });

    test('selects the current generated image using shared scoring', async () => {
        const img = document.createElement('img');
        img.alt = 'Generated image';
        img.src = 'data:image/png;base64,aGVsbG8=';
        Object.defineProperty(img, 'naturalWidth', { value: 720 });
        Object.defineProperty(img, 'naturalHeight', { value: 720 });
        img.getBoundingClientRect = () => ({ left: 400, top: 300, width: 200, height: 200 });
        document.body.appendChild(img);

        const selected = await selectCurrentGeneratedImage({ documentRef: document, utils });
        expect(selected).toEqual(expect.objectContaining({
            mimeType: 'image/png',
            source: 'current-grok-image'
        }));
    });

    test('waitForCondition resolves when predicate becomes true', async () => {
        let count = 0;
        const result = await waitForCondition(() => {
            count++;
            return count > 1 ? 'ready' : null;
        }, { timeoutMs: 100, intervalMs: 1 });

        expect(result).toBe('ready');
    });
});
```

- [ ] **Step 2: Run the failing content helper tests**

Run:

```bash
npm run test:unit -- tests/unit/recreateWorkflowContent.test.js
```

Expected: fail with `Cannot find module '../../recreateWorkflowContent.js'`.

- [ ] **Step 3: Add reference capture implementation**

Create `recreateWorkflowContent.js` with the reference functions first:

```js
(function(root, factory) {
    const utils = root && root.GrokRecreateWorkflowUtils
        ? root.GrokRecreateWorkflowUtils
        : (typeof require === 'function' ? require('./recreateWorkflowUtils.js') : null);
    const actions = factory(utils);
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = actions;
    }
    if (root) {
        root.GrokRecreateContentActions = actions;
    }
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this), function(utils) {
    function waitForCondition(predicate, options = {}) {
        const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 10000;
        const intervalMs = Number.isFinite(options.intervalMs) ? options.intervalMs : 250;
        const startedAt = Date.now();

        return new Promise((resolve, reject) => {
            function poll() {
                try {
                    const value = predicate();
                    if (value) {
                        resolve(value);
                        return;
                    }
                    if (Date.now() - startedAt >= timeoutMs) {
                        reject(new Error(options.timeoutError || 'timeout'));
                        return;
                    }
                    setTimeout(poll, intervalMs);
                } catch (error) {
                    reject(error);
                }
            }
            poll();
        });
    }

    function readBlobAsDataUrl(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ''));
            reader.onerror = () => reject(new Error('reference_capture_failed'));
            reader.readAsDataURL(blob);
        });
    }

    async function readFileAsRecreateReference(file, source = 'local') {
        if (!file) throw new Error('reference_missing');
        const dataUrl = await readBlobAsDataUrl(file);
        return utils.normalizeRecreateReference({
            name: file.name || 'reference-image',
            mimeType: file.type,
            dataUrl,
            source
        });
    }

    function dataUrlToFile(reference) {
        const normalized = utils.normalizeRecreateReference(reference);
        const parsed = utils.parseRecreateDataUrl(normalized.dataUrl);
        const binary = atob(parsed.base64);
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index++) {
            bytes[index] = binary.charCodeAt(index);
        }
        return new File([bytes], normalized.name || 'reference-image', { type: normalized.mimeType });
    }

    function isVisibleElement(element) {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 0
            && rect.height > 0
            && style.display !== 'none'
            && style.visibility !== 'hidden'
            && Number(style.opacity || 1) > 0;
    }

    function collectGeneratedImageCandidates(documentRef = document) {
        return Array.from(documentRef.querySelectorAll('img'))
            .filter(isVisibleElement)
            .map((img) => {
                const rect = img.getBoundingClientRect();
                return {
                    element: img,
                    src: img.currentSrc || img.src || '',
                    alt: img.getAttribute('alt') || '',
                    naturalWidth: img.naturalWidth || 0,
                    naturalHeight: img.naturalHeight || 0,
                    rect: {
                        left: rect.left,
                        top: rect.top,
                        width: rect.width,
                        height: rect.height
                    }
                };
            });
    }

    function fetchViaBridgeAsBlobUrl(url, options = {}) {
        const requestId = `recreate_fetch_${Date.now()}_${Math.random().toString(16).slice(2)}`;
        const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 15000;

        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                document.removeEventListener('__gpt_fetch_media_result', onResult);
                reject(new Error('reference_capture_failed'));
            }, timeoutMs);

            function onResult(event) {
                const detail = event.detail || {};
                if (detail.requestId !== requestId) return;
                clearTimeout(timer);
                document.removeEventListener('__gpt_fetch_media_result', onResult);
                if (detail.error) reject(new Error('reference_capture_failed'));
                else resolve(detail.blobUrl);
            }

            document.addEventListener('__gpt_fetch_media_result', onResult);
            document.dispatchEvent(new CustomEvent('__gpt_fetch_media', {
                detail: { url, requestId }
            }));
        });
    }

    async function sourceToDataUrl(src) {
        if (String(src || '').startsWith('data:image/')) return src;

        const fetchUrl = utils.isTrustedGrokMediaUrl(src)
            ? await fetchViaBridgeAsBlobUrl(src)
            : src;
        const response = await fetch(fetchUrl);
        if (!response.ok) throw new Error('reference_capture_failed');
        return readBlobAsDataUrl(await response.blob());
    }

    async function selectCurrentGeneratedImage(options = {}) {
        const documentRef = options.documentRef || document;
        const viewport = options.viewport || {
            width: window.innerWidth || documentRef.documentElement.clientWidth,
            height: window.innerHeight || documentRef.documentElement.clientHeight
        };
        const candidates = collectGeneratedImageCandidates(documentRef);
        const selected = utils.chooseBestGeneratedImageCandidate(candidates, viewport);
        if (!selected) throw new Error('reference_missing');

        const dataUrl = await sourceToDataUrl(selected.src);
        return utils.normalizeRecreateReference({
            name: 'current-grok-image.png',
            mimeType: utils.parseRecreateDataUrl(dataUrl).mimeType,
            dataUrl,
            source: 'current-grok-image'
        });
    }

    return {
        collectGeneratedImageCandidates,
        dataUrlToFile,
        readFileAsRecreateReference,
        selectCurrentGeneratedImage,
        waitForCondition
    };
});
```

- [ ] **Step 4: Run content helper tests until they pass**

Run:

```bash
npm run test:unit -- tests/unit/recreateWorkflowContent.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit content reference helpers**

Run:

```bash
git add recreateWorkflowContent.js tests/unit/recreateWorkflowContent.test.js
git commit -m "feat: add recreate content reference helpers"
```

## Task 3: Chat and Imagine DOM Actions

**Files:**
- Modify: `recreateWorkflowContent.js`
- Modify: `tests/unit/recreateWorkflowContent.test.js`

- [ ] **Step 1: Add failing tests for chat and Imagine actions**

Append to `tests/unit/recreateWorkflowContent.test.js`:

```js
const {
    ensureGrokSearchEnabled,
    extractAssistantPromptFromPage,
    injectEditorText,
    runImagineSubmitStep,
    setFileInputFiles,
    submitVisibleButton
} = require('../../recreateWorkflowContent.js');

describe('recreate content DOM actions', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
    });

    test('sets files on a hidden file input and dispatches change', () => {
        const input = document.createElement('input');
        input.type = 'file';
        const changeHandler = jest.fn();
        input.addEventListener('change', changeHandler);
        document.body.appendChild(input);

        const file = new File(['hello'], 'reference.png', { type: 'image/png' });
        setFileInputFiles(input, file);

        expect(input.files).toHaveLength(1);
        expect(input.files[0].name).toBe('reference.png');
        expect(changeHandler).toHaveBeenCalledTimes(1);
    });

    test('injects editor text through bridge event', () => {
        const editor = document.createElement('div');
        editor.contentEditable = 'true';
        editor.setAttribute('aria-label', 'Ask Grok anything');
        document.body.appendChild(editor);

        const bridgeSpy = jest.fn();
        document.addEventListener('__gpt_set_editor_content', bridgeSpy);

        expect(injectEditorText('hello')).toBe(true);
        expect(bridgeSpy).toHaveBeenCalledTimes(1);
        expect(bridgeSpy.mock.calls[0][0].detail).toEqual({ text: 'hello' });
    });

    test('clicks enabled visible submit buttons only', () => {
        const hidden = document.createElement('button');
        hidden.setAttribute('aria-label', 'Submit');
        hidden.disabled = false;
        hidden.getBoundingClientRect = () => ({ width: 0, height: 0, left: 0, top: 0 });
        document.body.appendChild(hidden);

        const visible = document.createElement('button');
        visible.setAttribute('aria-label', 'Submit');
        visible.disabled = false;
        visible.getBoundingClientRect = () => ({ width: 40, height: 40, left: 0, top: 0 });
        visible.click = jest.fn();
        document.body.appendChild(visible);

        expect(submitVisibleButton(['Submit'])).toBe(true);
        expect(visible.click).toHaveBeenCalledTimes(1);
    });

    test('extracts assistant answer text with final prompt marker', () => {
        const answer = document.createElement('div');
        answer.setAttribute('data-testid', 'assistant-message');
        answer.textContent = 'FINAL_IMAGINE_PROMPT:\\nA red cabin in snow.';
        document.body.appendChild(answer);

        expect(extractAssistantPromptFromPage()).toBe('A red cabin in snow.');
    });

    test('fails when Grok Search cannot be verified as active', () => {
        const search = document.createElement('button');
        search.setAttribute('aria-label', 'Search');
        document.body.appendChild(search);

        expect(() => ensureGrokSearchEnabled()).toThrow('chat_search_unavailable');
    });

    test('submits Imagine prompt after editor injection enables submit', async () => {
        const editor = document.createElement('div');
        editor.contentEditable = 'true';
        editor.setAttribute('aria-label', 'Ask Grok anything');
        document.body.appendChild(editor);

        const submit = document.createElement('button');
        submit.setAttribute('aria-label', 'Submit');
        submit.disabled = false;
        submit.getBoundingClientRect = () => ({ width: 40, height: 40, left: 0, top: 0 });
        submit.click = jest.fn();
        document.body.appendChild(submit);

        const result = await runImagineSubmitStep({
            runId: 'recreate_1',
            generatedPrompt: 'A red cabin in snow.',
            autoSubmit: true
        }, { timeoutMs: 100, intervalMs: 1 });

        expect(result).toEqual({ ok: true, runId: 'recreate_1', submitted: true });
        expect(submit.click).toHaveBeenCalledTimes(1);
    });
});
```

- [ ] **Step 2: Run the failing DOM action tests**

Run:

```bash
npm run test:unit -- tests/unit/recreateWorkflowContent.test.js
```

Expected: fail with missing exports such as `ensureGrokSearchEnabled`.

- [ ] **Step 3: Add DOM action functions**

Modify `recreateWorkflowContent.js` by adding these functions before the final `return`:

```js
    function visibleElement(element) {
        if (!element) return false;
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 0
            && rect.height > 0
            && style.display !== 'none'
            && style.visibility !== 'hidden';
    }

    function setFileInputFiles(input, file) {
        if (!input || input.type !== 'file') throw new Error('chat_upload_input_missing');
        if (typeof DataTransfer !== 'undefined') {
            const dataTransfer = new DataTransfer();
            dataTransfer.items.add(file);
            input.files = dataTransfer.files;
        } else {
            Object.defineProperty(input, 'files', {
                configurable: true,
                value: {
                    0: file,
                    length: 1,
                    item: (index) => index === 0 ? file : null
                }
            });
        }
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function findEditor(documentRef = document) {
        return Array.from(documentRef.querySelectorAll('[contenteditable="true"], textarea'))
            .find((element) => {
                const label = element.getAttribute('aria-label') || '';
                return visibleElement(element) && /Ask Grok anything/i.test(label);
            }) || null;
    }

    function injectEditorText(text, documentRef = document) {
        const editor = findEditor(documentRef);
        if (!editor) return false;

        editor.focus();
        if (editor.tagName === 'TEXTAREA') {
            const tracker = editor._valueTracker;
            if (tracker) tracker.setValue('');
            const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
            setter.call(editor, text);
            editor.dispatchEvent(new Event('input', { bubbles: true }));
            editor.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
        }

        documentRef.dispatchEvent(new CustomEvent('__gpt_set_editor_content', {
            detail: { text }
        }));
        return true;
    }

    function buttonStateLooksActive(button) {
        return button.getAttribute('aria-pressed') === 'true'
            || button.getAttribute('data-state') === 'checked'
            || button.getAttribute('data-state') === 'on'
            || button.getAttribute('aria-checked') === 'true';
    }

    function ensureGrokSearchEnabled(documentRef = document) {
        const button = Array.from(documentRef.querySelectorAll('button[aria-label="Search"]'))
            .find(visibleElement);
        if (!button) throw new Error('chat_search_unavailable');
        if (!buttonStateLooksActive(button)) {
            button.click();
        }
        if (!buttonStateLooksActive(button)) throw new Error('chat_search_unavailable');
        return true;
    }

    function submitVisibleButton(labels, documentRef = document) {
        for (const label of labels) {
            const buttons = Array.from(documentRef.querySelectorAll(`button[aria-label="${label}"]`));
            const button = buttons.find((candidate) => visibleElement(candidate) && !candidate.disabled);
            if (button) {
                button.click();
                return true;
            }
        }
        return false;
    }

    function findUploadInput(documentRef = document) {
        return Array.from(documentRef.querySelectorAll('input[type="file"]'))
            .find((input) => {
                const accept = String(input.getAttribute('accept') || '');
                return !accept || accept.includes('image') || input.multiple;
            }) || null;
    }

    function uploadReferenceFile(reference, documentRef = document) {
        const input = findUploadInput(documentRef);
        if (!input) throw new Error('chat_upload_input_missing');
        setFileInputFiles(input, dataUrlToFile(reference));
        return true;
    }

    function hasUploadPreview(documentRef = document) {
        return Array.from(documentRef.querySelectorAll('img'))
            .some((img) => visibleElement(img) && Math.max(img.naturalWidth || 0, img.naturalHeight || 0) > 20);
    }

    function extractAssistantPromptFromPage(documentRef = document) {
        const containers = Array.from(documentRef.querySelectorAll(
            '[data-testid="assistant-message"], [data-testid*="assistant"], [class*="response"], [class*="markdown"], article'
        ));
        const texts = containers
            .map((element) => element.innerText || element.textContent || '')
            .filter((text) => text.includes(utils.FINAL_PROMPT_MARKER));
        if (!texts.length) throw new Error('chat_prompt_marker_missing');
        return utils.extractFinalImaginePrompt(texts[texts.length - 1]);
    }

    async function runChatPromptStep(request, options = {}) {
        const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 120000;
        const intervalMs = Number.isFinite(options.intervalMs) ? options.intervalMs : 750;
        const reference = utils.normalizeRecreateReference(request.reference);

        if (request.bestPracticesEnabled) {
            ensureGrokSearchEnabled();
        }
        uploadReferenceFile(reference);
        await waitForCondition(() => hasUploadPreview(), {
            timeoutMs: 15000,
            intervalMs,
            timeoutError: 'chat_upload_preview_missing'
        });

        if (!injectEditorText(utils.buildRecreateChatInstruction({
            bestPracticesEnabled: !!request.bestPracticesEnabled
        }))) {
            throw new Error('chat_editor_missing');
        }

        await waitForCondition(() => submitVisibleButton(['Submit', 'Send']), {
            timeoutMs: 10000,
            intervalMs,
            timeoutError: 'chat_submit_missing'
        });

        const generatedPrompt = await waitForCondition(() => {
            try {
                return extractAssistantPromptFromPage();
            } catch {
                return null;
            }
        }, {
            timeoutMs,
            intervalMs,
            timeoutError: 'chat_answer_timeout'
        });

        return {
            ok: true,
            runId: request.runId,
            generatedPrompt
        };
    }

    async function runImagineSubmitStep(request, options = {}) {
        const intervalMs = Number.isFinite(options.intervalMs) ? options.intervalMs : 250;
        const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 15000;

        const imageModeButton = Array.from(document.querySelectorAll('button'))
            .find((button) => visibleElement(button) && button.textContent.trim() === 'Image');
        if (imageModeButton) imageModeButton.click();

        if (!injectEditorText(request.generatedPrompt)) throw new Error('imagine_editor_missing');

        await waitForCondition(() => {
            const submit = Array.from(document.querySelectorAll('button[aria-label="Submit"]'))
                .find((button) => visibleElement(button));
            return submit && !submit.disabled ? submit : null;
        }, {
            timeoutMs,
            intervalMs,
            timeoutError: 'imagine_submit_disabled'
        });

        if (!submitVisibleButton(['Submit'])) throw new Error('imagine_submit_failed');
        return {
            ok: true,
            runId: request.runId,
            submitted: true
        };
    }
```

Update the `return` object in `recreateWorkflowContent.js`:

```js
    return {
        collectGeneratedImageCandidates,
        dataUrlToFile,
        ensureGrokSearchEnabled,
        extractAssistantPromptFromPage,
        injectEditorText,
        readFileAsRecreateReference,
        runChatPromptStep,
        runImagineSubmitStep,
        selectCurrentGeneratedImage,
        setFileInputFiles,
        submitVisibleButton,
        waitForCondition
    };
```

- [ ] **Step 4: Run DOM action tests until they pass**

Run:

```bash
npm run test:unit -- tests/unit/recreateWorkflowContent.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit DOM actions**

Run:

```bash
git add recreateWorkflowContent.js tests/unit/recreateWorkflowContent.test.js
git commit -m "feat: add recreate Grok page actions"
```

## Task 4: Background Workflow Controller

**Files:**
- Create: `recreateWorkflowBackground.js`
- Create: `tests/unit/recreateWorkflowBackground.test.js`
- Modify: `jest.setup.js`

- [ ] **Step 1: Write failing background controller tests**

Create `tests/unit/recreateWorkflowBackground.test.js`:

```js
const utils = require('../../recreateWorkflowUtils.js');
const { createRecreateWorkflowController } = require('../../recreateWorkflowBackground.js');

function createChromeHarness() {
    const messages = [];
    const createdTabs = [];
    const chromeApi = {
        tabs: {
            create: jest.fn((options, callback) => {
                const tab = { id: createdTabs.length + 10, url: options.url };
                createdTabs.push(tab);
                callback(tab);
            }),
            get: jest.fn((tabId, callback) => {
                callback(createdTabs.find((tab) => tab.id === tabId) || { id: tabId, url: 'https://grok.com/' });
            }),
            sendMessage: jest.fn((tabId, message, callback) => {
                messages.push({ tabId, message });
                if (message.action === 'GPT_RECREATE_CHAT_STEP') {
                    callback({ ok: true, runId: message.runId, generatedPrompt: 'A red cabin in snow.' });
                } else if (message.action === 'GPT_RECREATE_IMAGINE_STEP') {
                    callback({ ok: true, runId: message.runId, submitted: true });
                } else {
                    callback({ ok: true });
                }
            }),
            update: jest.fn((tabId, options, callback) => callback({ id: tabId, ...options }))
        },
        runtime: { lastError: null }
    };
    return { chromeApi, createdTabs, messages };
}

describe('recreate background controller', () => {
    test('runs chat step before imagine step', async () => {
        const { chromeApi, createdTabs, messages } = createChromeHarness();
        const controller = createRecreateWorkflowController({
            chromeApi,
            utils,
            now: () => 1000,
            random: () => 0.5
        });

        const result = await controller.start({
            reference: {
                name: 'sample.png',
                mimeType: 'image/png',
                dataUrl: 'data:image/png;base64,aGVsbG8=',
                source: 'local'
            },
            bestPracticesEnabled: true
        }, {
            sourceTabId: 1,
            sourceTabUrl: 'https://grok.com/imagine'
        });

        expect(result).toEqual(expect.objectContaining({
            ok: true,
            generatedPrompt: 'A red cabin in snow.',
            submitted: true
        }));
        expect(createdTabs.map((tab) => tab.url)).toEqual(['https://grok.com/']);
        expect(messages.map((entry) => entry.message.action)).toEqual([
            'GPT_RECREATE_STATUS',
            'GPT_RECREATE_CHAT_STEP',
            'GPT_RECREATE_STATUS',
            'GPT_RECREATE_IMAGINE_STEP',
            'GPT_RECREATE_STATUS'
        ]);
    });

    test('opens Imagine tab when source tab is not Imagine', async () => {
        const { chromeApi, createdTabs } = createChromeHarness();
        const controller = createRecreateWorkflowController({ chromeApi, utils });

        await controller.start({
            reference: {
                name: 'sample.png',
                mimeType: 'image/png',
                dataUrl: 'data:image/png;base64,aGVsbG8=',
                source: 'local'
            },
            bestPracticesEnabled: false
        }, {
            sourceTabId: 1,
            sourceTabUrl: 'https://grok.com/'
        });

        expect(createdTabs.map((tab) => tab.url)).toEqual(['https://grok.com/', 'https://grok.com/imagine']);
    });

    test('fails safely when reference is invalid', async () => {
        const { chromeApi } = createChromeHarness();
        const controller = createRecreateWorkflowController({ chromeApi, utils });

        const result = await controller.start({
            reference: { dataUrl: 'data:text/plain;base64,aGVsbG8=' },
            bestPracticesEnabled: false
        }, {
            sourceTabId: 1,
            sourceTabUrl: 'https://grok.com/imagine'
        });

        expect(result).toEqual(expect.objectContaining({
            ok: false,
            error: 'reference_invalid'
        }));
        expect(JSON.stringify(result)).not.toContain('data:text/plain');
    });

    test('abort marks active workflow aborted', async () => {
        const { chromeApi, messages } = createChromeHarness();
        let chatCallback = null;
        chromeApi.tabs.sendMessage = jest.fn((tabId, message, callback) => {
            messages.push({ tabId, message });
            if (message.action === 'GPT_RECREATE_CHAT_STEP') {
                chatCallback = callback;
            } else {
                callback({ ok: true });
            }
        });
        const controller = createRecreateWorkflowController({ chromeApi, utils });

        const promise = controller.start({
            reference: {
                name: 'sample.png',
                mimeType: 'image/png',
                dataUrl: 'data:image/png;base64,aGVsbG8=',
                source: 'local'
            },
            bestPracticesEnabled: false
        }, {
            sourceTabId: 1,
            sourceTabUrl: 'https://grok.com/imagine'
        });

        const abortResult = controller.abort('user');
        expect(abortResult).toEqual(expect.objectContaining({ ok: true, aborted: true }));
        expect(typeof chatCallback).toBe('function');
        chatCallback({ ok: true, runId: 'recreate_1', generatedPrompt: 'A red cabin in snow.' });

        const result = await promise;
        expect(result).toEqual(expect.objectContaining({ ok: false, error: 'workflow_aborted' }));
    });
});
```

- [ ] **Step 2: Run failing background controller tests**

Run:

```bash
npm run test:unit -- tests/unit/recreateWorkflowBackground.test.js
```

Expected: fail with `Cannot find module '../../recreateWorkflowBackground.js'`.

- [ ] **Step 3: Add background controller implementation**

Create `recreateWorkflowBackground.js`:

```js
(function(root, factory) {
    const utils = root && root.GrokRecreateWorkflowUtils
        ? root.GrokRecreateWorkflowUtils
        : (typeof require === 'function' ? require('./recreateWorkflowUtils.js') : null);
    const api = factory(utils);
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    if (root) {
        root.GrokRecreateWorkflowBackground = api;
    }
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this), function(utils) {
    function createRecreateWorkflowController(options = {}) {
        const chromeApi = options.chromeApi || chrome;
        const now = options.now || Date.now;
        const random = options.random || Math.random;
        let activeRun = null;

        function tabsCreate(createOptions) {
            return new Promise((resolve, reject) => {
                chromeApi.tabs.create(createOptions, (tab) => {
                    if (chromeApi.runtime && chromeApi.runtime.lastError) {
                        reject(new Error(chromeApi.runtime.lastError.message));
                    } else {
                        resolve(tab);
                    }
                });
            });
        }

        function tabsSendMessage(tabId, message) {
            return new Promise((resolve, reject) => {
                chromeApi.tabs.sendMessage(tabId, message, (response) => {
                    if (chromeApi.runtime && chromeApi.runtime.lastError) {
                        reject(new Error(chromeApi.runtime.lastError.message));
                    } else {
                        resolve(response);
                    }
                });
            });
        }

        async function sendStatus(run, phase, message, type = 'info') {
            const payload = {
                action: 'GPT_RECREATE_STATUS',
                runId: run.runId,
                phase,
                message,
                type
            };
            if (!run.sourceTabId) return;
            try {
                await tabsSendMessage(run.sourceTabId, payload);
            } catch (error) {
                console.warn('Recreate status delivery failed:', error.message);
            }
        }

        function fail(run, phase, error, diagnostics = {}) {
            return utils.buildRecreateFailure({
                runId: run && run.runId,
                phase,
                error: error && error.code ? error.code : String(error && error.message ? error.message : error),
                diagnostics
            });
        }

        function ensureActive(run) {
            if (!activeRun || activeRun.runId !== run.runId || activeRun.aborted) {
                throw Object.assign(new Error('workflow_aborted'), { code: 'workflow_aborted' });
            }
        }

        async function start(request = {}, context = {}) {
            const run = {
                runId: utils.createRecreateRunId(now()),
                sourceTabId: context.sourceTabId,
                sourceTabUrl: context.sourceTabUrl,
                aborted: false,
                chatTabId: null,
                imagineTabId: null
            };

            const originalRandom = Math.random;
            if (random !== Math.random) {
                Math.random = random;
                run.runId = utils.createRecreateRunId(now());
                Math.random = originalRandom;
            }

            activeRun = run;

            try {
                const reference = utils.normalizeRecreateReference(request.reference);
                await sendStatus(run, 'chat', 'Opening Grok chat tab...', 'info');
                ensureActive(run);

                const chatTab = await tabsCreate({ url: 'https://grok.com/', active: false });
                run.chatTabId = chatTab.id;
                ensureActive(run);

                const chatResponse = await tabsSendMessage(run.chatTabId, {
                    action: 'GPT_RECREATE_CHAT_STEP',
                    runId: run.runId,
                    reference,
                    bestPracticesEnabled: !!request.bestPracticesEnabled
                });
                ensureActive(run);
                if (!chatResponse || !chatResponse.ok) {
                    return chatResponse || fail(run, 'chat', 'chat_answer_timeout');
                }

                await sendStatus(run, 'imagine', 'Submitting prompt in Grok Imagine...', 'info');
                ensureActive(run);

                let imagineTabId = context.sourceTabId;
                if (!String(context.sourceTabUrl || '').startsWith('https://grok.com/imagine')) {
                    const imagineTab = await tabsCreate({ url: 'https://grok.com/imagine', active: true });
                    imagineTabId = imagineTab.id;
                }
                run.imagineTabId = imagineTabId;
                ensureActive(run);

                const imagineResponse = await tabsSendMessage(run.imagineTabId, {
                    action: 'GPT_RECREATE_IMAGINE_STEP',
                    runId: run.runId,
                    generatedPrompt: chatResponse.generatedPrompt,
                    autoSubmit: true
                });
                ensureActive(run);
                if (!imagineResponse || !imagineResponse.ok) {
                    return imagineResponse || fail(run, 'imagine', 'imagine_submit_failed');
                }

                await sendStatus(run, 'done', 'Submitted to Grok Imagine.', 'success');
                activeRun = null;
                return {
                    ok: true,
                    runId: run.runId,
                    generatedPrompt: chatResponse.generatedPrompt,
                    submitted: true
                };
            } catch (error) {
                const result = fail(run, 'workflow', error, {
                    sourceTabUrl: run.sourceTabUrl,
                    chatTabId: run.chatTabId,
                    imagineTabId: run.imagineTabId
                });
                await sendStatus(run, result.phase, result.error, 'error');
                activeRun = null;
                return result;
            }
        }

        function abort(reason = 'user') {
            if (!activeRun) return { ok: true, aborted: false, reason: 'no_active_run' };
            activeRun.aborted = true;
            return {
                ok: true,
                runId: activeRun.runId,
                aborted: true,
                reason
            };
        }

        function getActiveRunForTest() {
            return activeRun ? { ...activeRun } : null;
        }

        return {
            abort,
            getActiveRunForTest,
            start
        };
    }

    return { createRecreateWorkflowController };
});
```

- [ ] **Step 4: Add tab mocks needed for controller tests**

Modify `jest.setup.js` inside `global.chrome.tabs`:

```js
        create: jest.fn((options, callback) => {
            if (typeof callback === 'function') callback({ id: 999, url: options.url });
        }),
        get: jest.fn((tabId, callback) => {
            if (typeof callback === 'function') callback({ id: tabId, url: 'https://grok.com/' });
        }),
        update: jest.fn((tabId, options, callback) => {
            if (typeof callback === 'function') callback({ id: tabId, ...options });
        }),
```

- [ ] **Step 5: Run background controller tests until they pass**

Run:

```bash
npm run test:unit -- tests/unit/recreateWorkflowBackground.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit background controller**

Run:

```bash
git add recreateWorkflowBackground.js tests/unit/recreateWorkflowBackground.test.js jest.setup.js
git commit -m "feat: add recreate background controller"
```

## Task 5: Extension Wiring

**Files:**
- Modify: `manifest.json`
- Modify: `background.js`
- Modify: `content.js`
- Modify: `tests/e2e/extension.spec.js`

- [ ] **Step 1: Add failing E2E expectation that helper scripts are loaded**

Modify `tests/e2e/extension.spec.js` near the top:

```js
const utilsJsPath = path.join(__dirname, '../../recreateWorkflowUtils.js');
const contentActionsJsPath = path.join(__dirname, '../../recreateWorkflowContent.js');
const utilsJs = fs.readFileSync(utilsJsPath, 'utf8');
const contentActionsJs = fs.readFileSync(contentActionsJsPath, 'utf8');
```

Modify each `await page.evaluate(contentJs);` in the file to this sequence:

```js
await page.evaluate(utilsJs);
await page.evaluate(contentActionsJs);
await page.evaluate(contentJs);
```

Add this test:

```js
    test('Recreate helper globals should be available before content script', async ({ page }) => {
        await page.evaluate(utilsJs);
        await page.evaluate(contentActionsJs);

        const globals = await page.evaluate(() => ({
            hasUtils: !!window.GrokRecreateWorkflowUtils,
            hasContentActions: !!window.GrokRecreateContentActions
        }));

        expect(globals).toEqual({ hasUtils: true, hasContentActions: true });
    });
```

- [ ] **Step 2: Run failing E2E helper-load test**

Run:

```bash
npm run test:e2e -- tests/e2e/extension.spec.js -g "Recreate helper globals"
```

Expected: fail until `recreateWorkflowContent.js` can run in the Playwright-evaluated page with the helper global.

- [ ] **Step 3: Update manifest script loading and permissions**

Modify `manifest.json`:

```json
  "permissions": [
    "storage",
    "activeTab",
    "tabs",
    "scripting",
    "downloads",
    "alarms",
    "cookies",
    "offscreen"
  ],
```

Modify the `content_scripts[0].js` array:

```json
      "js": [
        "recreateWorkflowUtils.js",
        "recreateWorkflowContent.js",
        "content.js"
      ],
```

- [ ] **Step 4: Import helper scripts in the service worker**

Modify the top of `background.js`:

```js
if (typeof importScripts === 'function') {
    try {
        importScripts('cloudSyncUtils.js');
    } catch (e) {
        console.warn('CloudSyncUtils failed to load.', e);
    }
    try {
        importScripts('recreateWorkflowUtils.js', 'recreateWorkflowBackground.js');
    } catch (e) {
        console.warn('Grok recreate workflow helpers failed to load.', e);
    }
}
```

After the `CloudSync` constant, add:

```js
const RecreateWorkflowUtils = (typeof self !== 'undefined' && self.GrokRecreateWorkflowUtils)
    ? self.GrokRecreateWorkflowUtils
    : (typeof require === 'function' ? require('./recreateWorkflowUtils.js') : null);
const RecreateWorkflowBackground = (typeof self !== 'undefined' && self.GrokRecreateWorkflowBackground)
    ? self.GrokRecreateWorkflowBackground
    : (typeof require === 'function' ? require('./recreateWorkflowBackground.js') : null);
const recreateWorkflowController = RecreateWorkflowBackground
    ? RecreateWorkflowBackground.createRecreateWorkflowController({ chromeApi: chrome, utils: RecreateWorkflowUtils })
    : null;
```

Inside `chrome.runtime.onMessage.addListener`, before the final `return false`, add:

```js
    if (request.action === 'START_GPT_RECREATE') {
        if (!recreateWorkflowController) {
            sendResponse({ ok: false, error: 'workflow_unavailable' });
            return false;
        }
        (async () => {
            const sourceTab = sender && sender.tab ? sender.tab : {};
            const response = await recreateWorkflowController.start(request, {
                sourceTabId: sourceTab.id,
                sourceTabUrl: sourceTab.url
            });
            sendResponse(response);
        })();
        return true;
    }

    if (request.action === 'ABORT_GPT_RECREATE') {
        if (!recreateWorkflowController) {
            sendResponse({ ok: false, error: 'workflow_unavailable' });
            return false;
        }
        sendResponse(recreateWorkflowController.abort('user'));
        return false;
    }
```

- [ ] **Step 5: Export background controller for tests**

Modify `module.exports` in `background.js`:

```js
        recreateWorkflowController,
```

- [ ] **Step 6: Add content-script message routing**

In `content.js`, before `class GrokScraper`, add:

```js
class RecreateWorkflowContentBridge {
    constructor(overlay, historyManager) {
        this.overlay = overlay;
        this.historyManager = historyManager;
        this.actions = typeof window !== 'undefined' ? window.GrokRecreateContentActions : null;
    }

    setupListeners() {
        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
            if (request.action === 'GPT_RECREATE_STATUS') {
                this.overlay?.setRecreateStatus?.(request.message, request.type || 'info');
                sendResponse({ ok: true });
                return false;
            }

            if (request.action === 'GPT_RECREATE_CHAT_STEP') {
                this.runAsyncStep(() => this.actions.runChatPromptStep(request), sendResponse);
                return true;
            }

            if (request.action === 'GPT_RECREATE_IMAGINE_STEP') {
                this.runAsyncStep(async () => {
                    const response = await this.actions.runImagineSubmitStep(request);
                    if (response.ok && request.generatedPrompt) {
                        this.historyManager.add(request.generatedPrompt, 'image');
                    }
                    return response;
                }, sendResponse);
                return true;
            }

            return false;
        });
    }

    runAsyncStep(fn, sendResponse) {
        (async () => {
            try {
                sendResponse(await fn());
            } catch (error) {
                sendResponse({
                    ok: false,
                    phase: 'content',
                    error: error.code || error.message || 'workflow_failed',
                    diagnostics: {
                        url: location.href,
                        title: document.title
                    }
                });
            }
        })();
    }
}
```

At the bottom initialization block in `content.js`, add:

```js
    const recreateBridge = new RecreateWorkflowContentBridge(overlay, history);
    recreateBridge.setupListeners();
```

Add `RecreateWorkflowContentBridge` to `module.exports`.

- [ ] **Step 7: Run E2E helper-load and existing overlay tests**

Run:

```bash
npm run test:e2e -- tests/e2e/extension.spec.js
```

Expected: PASS.

- [ ] **Step 8: Commit extension wiring**

Run:

```bash
git add manifest.json background.js content.js tests/e2e/extension.spec.js
git commit -m "feat: wire recreate workflow scripts"
```

## Task 6: Overlay Recreate Image UI

**Files:**
- Modify: `content.js`
- Modify: `tests/e2e/extension.spec.js`

- [ ] **Step 1: Add failing overlay smoke test**

Append to `tests/e2e/extension.spec.js`:

```js
    test('Recreate Image controls should render', async ({ page }) => {
        await page.evaluate(utilsJs);
        await page.evaluate(contentActionsJs);
        await page.evaluate(contentJs);

        const overlay = page.locator('#grok-powertools-overlay');
        await expect(overlay).toContainText('Recreate Image');
        await expect(page.locator('#gptRecreateStartBtn')).toBeVisible();
        await expect(page.locator('#gptRecreateBestPractices')).toBeVisible();
        await expect(page.locator('#gptRecreateFileInput')).toHaveCount(1);
    });
```

- [ ] **Step 2: Run failing overlay smoke test**

Run:

```bash
npm run test:e2e -- tests/e2e/extension.spec.js -g "Recreate Image controls"
```

Expected: fail because the controls do not exist.

- [ ] **Step 3: Add overlay state fields**

In `GrokOverlay.constructor`, add:

```js
        this.recreateReference = null;
        this.recreateRunning = false;
```

- [ ] **Step 4: Add Recreate Image markup**

In `GrokOverlay.render()`, insert this section after the status section and before Auto-Retry:

```html
                    <div class="gpt-section" id="gptRecreateSection">
                        <label class="gpt-row" style="font-weight:600; margin-bottom:4px;">Recreate Image</label>
                        <div id="gptRecreateDropzone" style="border:1px dashed rgba(255,255,255,0.25); border-radius:6px; padding:8px; font-size:11px; color:#c9d1d9; text-align:center;">
                            Drop, paste, choose image, or use current Grok image
                        </div>
                        <input type="file" id="gptRecreateFileInput" accept="image/jpeg,image/jpg,image/png,image/gif,image/webp,image/bmp,image/tiff" style="display:none;">
                        <div class="gpt-row" style="margin-top:6px; gap:4px;">
                            <button id="gptRecreateChooseBtn" class="gpt-btn gpt-btn-secondary" style="flex:1; font-size:11px;">Choose</button>
                            <button id="gptRecreateCurrentBtn" class="gpt-btn gpt-btn-secondary" style="flex:1; font-size:11px;">Current</button>
                        </div>
                        <div class="gpt-row" style="margin-top:6px; font-size:11px;">
                            <span>Grok Search</span>
                            <label class="gpt-toggle-switch">
                                <input type="checkbox" id="gptRecreateBestPractices" checked>
                                <span class="gpt-slider"></span>
                            </label>
                        </div>
                        <div class="gpt-row" style="margin-top:6px; gap:4px;">
                            <button id="gptRecreateStartBtn" class="gpt-btn gpt-btn-primary" style="flex:1; background:#0ea5e9; font-size:11px;">Start Recreate</button>
                            <button id="gptRecreateStopBtn" class="gpt-btn" style="flex:1; background:#f4212e; display:none; font-size:11px;">Stop</button>
                        </div>
                        <div id="gptRecreateStatus" style="font-size:10px; color:#71767b; margin-top:4px;">No reference selected.</div>
                    </div>
```

- [ ] **Step 5: Add overlay helper methods**

In `GrokOverlay`, after `captureTemplateImageUrl()`, add:

```js
    setRecreateStatus(text, type = 'neutral') {
        const status = this.el.querySelector('#gptRecreateStatus');
        if (status) status.textContent = text;
        if (type === 'error') this.toast.show(text, 'error');
        else if (type === 'success') this.toast.show(text, 'success');
    }

    setRecreateRunning(running) {
        this.recreateRunning = !!running;
        const startBtn = this.el.querySelector('#gptRecreateStartBtn');
        const stopBtn = this.el.querySelector('#gptRecreateStopBtn');
        if (startBtn) startBtn.style.display = running ? 'none' : '';
        if (stopBtn) stopBtn.style.display = running ? '' : 'none';
    }

    async setRecreateReferenceFromFile(file, source) {
        const actions = window.GrokRecreateContentActions;
        this.recreateReference = await actions.readFileAsRecreateReference(file, source);
        this.setRecreateStatus(`Selected ${this.recreateReference.name} (${Math.round(this.recreateReference.byteLength / 1024)} KB)`, 'success');
    }

    async setRecreateReferenceFromCurrentImage() {
        const actions = window.GrokRecreateContentActions;
        this.recreateReference = await actions.selectCurrentGeneratedImage();
        this.setRecreateStatus('Selected current Grok image.', 'success');
    }

    async startRecreateWorkflow() {
        if (!this.recreateReference) {
            this.setRecreateStatus('Select a reference image first.', 'error');
            return;
        }

        this.setRecreateRunning(true);
        this.setRecreateStatus('Starting recreate workflow...', 'info');
        const bestPracticesEnabled = !!this.el.querySelector('#gptRecreateBestPractices')?.checked;
        const response = await chrome.runtime.sendMessage({
            action: 'START_GPT_RECREATE',
            reference: this.recreateReference,
            bestPracticesEnabled
        });

        this.setRecreateRunning(false);
        if (response && response.ok) {
            this.setRecreateStatus('Submitted to Grok Imagine.', 'success');
        } else {
            this.setRecreateStatus((response && response.error) || 'Recreate workflow failed.', 'error');
        }
    }
```

- [ ] **Step 6: Wire overlay event listeners**

In `GrokOverlay.setupListeners()`, after existing tab/settings listeners and before Auto-Retry listeners, add:

```js
        const recreateFileInput = this.el.querySelector('#gptRecreateFileInput');
        const recreateDropzone = this.el.querySelector('#gptRecreateDropzone');

        this.el.querySelector('#gptRecreateChooseBtn').addEventListener('click', () => {
            recreateFileInput.click();
        });
        recreateFileInput.addEventListener('change', async (event) => {
            const file = event.target.files && event.target.files[0];
            if (!file) return;
            try {
                await this.setRecreateReferenceFromFile(file, 'local');
            } catch (error) {
                this.setRecreateStatus(error.message || 'reference_invalid', 'error');
            }
        });
        recreateDropzone.addEventListener('dragover', (event) => {
            event.preventDefault();
        });
        recreateDropzone.addEventListener('drop', async (event) => {
            event.preventDefault();
            const file = event.dataTransfer?.files?.[0];
            if (!file) return;
            try {
                await this.setRecreateReferenceFromFile(file, 'drop');
            } catch (error) {
                this.setRecreateStatus(error.message || 'reference_invalid', 'error');
            }
        });
        document.addEventListener('paste', async (event) => {
            if (!this.el || this.state.minimized) return;
            const item = Array.from(event.clipboardData?.items || [])
                .find((clipboardItem) => clipboardItem.type.startsWith('image/'));
            if (!item) return;
            try {
                await this.setRecreateReferenceFromFile(item.getAsFile(), 'paste');
            } catch (error) {
                this.setRecreateStatus(error.message || 'reference_invalid', 'error');
            }
        });
        this.el.querySelector('#gptRecreateCurrentBtn').addEventListener('click', async () => {
            try {
                await this.setRecreateReferenceFromCurrentImage();
            } catch (error) {
                this.setRecreateStatus(error.message || 'reference_missing', 'error');
            }
        });
        this.el.querySelector('#gptRecreateStartBtn').addEventListener('click', () => {
            this.startRecreateWorkflow();
        });
        this.el.querySelector('#gptRecreateStopBtn').addEventListener('click', async () => {
            await chrome.runtime.sendMessage({ action: 'ABORT_GPT_RECREATE' });
            this.setRecreateRunning(false);
            this.setRecreateStatus('Stopped.', 'neutral');
        });
```

- [ ] **Step 7: Run overlay tests**

Run:

```bash
npm run test:e2e -- tests/e2e/extension.spec.js -g "Recreate Image controls"
```

Expected: PASS.

- [ ] **Step 8: Commit overlay UI**

Run:

```bash
git add content.js tests/e2e/extension.spec.js
git commit -m "feat: add recreate image overlay controls"
```

## Task 7: Bridge Fetch Data URL Support

**Files:**
- Modify: `bridge.js`
- Modify: `recreateWorkflowContent.js`
- Modify: `tests/unit/recreateWorkflowContent.test.js`

- [ ] **Step 1: Add failing test for bridge data URL event contract**

Append to `tests/unit/recreateWorkflowContent.test.js`:

```js
describe('bridge fetch integration', () => {
    test('sourceToDataUrl uses bridge for trusted Grok media URLs', async () => {
        const { sourceToDataUrl } = require('../../recreateWorkflowContent.js');
        const listener = jest.fn((event) => {
            document.dispatchEvent(new CustomEvent('__gpt_fetch_media_data_url_result', {
                detail: {
                    requestId: event.detail.requestId,
                    dataUrl: 'data:image/png;base64,aGVsbG8='
                }
            }));
        });
        document.addEventListener('__gpt_fetch_media_data_url', listener);

        await expect(sourceToDataUrl('https://assets.grok.com/users/test/image.png'))
            .resolves.toBe('data:image/png;base64,aGVsbG8=');
        expect(listener).toHaveBeenCalledTimes(1);
    });
});
```

- [ ] **Step 2: Export `sourceToDataUrl` and run failing bridge integration test**

Add `sourceToDataUrl` to `recreateWorkflowContent.js` exports, then run:

```bash
npm run test:unit -- tests/unit/recreateWorkflowContent.test.js -t "sourceToDataUrl uses bridge"
```

Expected: fail because the helper still listens to `__gpt_fetch_media_result`.

- [ ] **Step 3: Add bridge data URL fetch event**

In `bridge.js`, after the existing `__gpt_fetch_media` listener, add:

```js
document.addEventListener('__gpt_fetch_media_data_url', function(e) {
    var url = e.detail && e.detail.url;
    var requestId = e.detail && e.detail.requestId;
    if (!url || !requestId) return;

    fetch(url, { credentials: 'include' })
        .then(function(resp) {
            if (!resp.ok) throw new Error('HTTP ' + resp.status);
            return resp.blob();
        })
        .then(function(blob) {
            return new Promise(function(resolve, reject) {
                var reader = new FileReader();
                reader.onload = function() {
                    resolve({ dataUrl: String(reader.result || ''), size: blob.size, type: blob.type });
                };
                reader.onerror = function() {
                    reject(new Error('FileReader failed'));
                };
                reader.readAsDataURL(blob);
            });
        })
        .then(function(result) {
            document.dispatchEvent(new CustomEvent('__gpt_fetch_media_data_url_result', {
                detail: { requestId: requestId, dataUrl: result.dataUrl, size: result.size, type: result.type }
            }));
        })
        .catch(function(err) {
            document.dispatchEvent(new CustomEvent('__gpt_fetch_media_data_url_result', {
                detail: { requestId: requestId, error: err.message }
            }));
        });
});
```

- [ ] **Step 4: Update content helper to use data URL bridge**

Replace `fetchViaBridgeAsBlobUrl` and the trusted URL branch in `sourceToDataUrl` with:

```js
    function fetchViaBridgeAsDataUrl(url, options = {}) {
        const requestId = `recreate_fetch_${Date.now()}_${Math.random().toString(16).slice(2)}`;
        const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 15000;

        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                document.removeEventListener('__gpt_fetch_media_data_url_result', onResult);
                reject(new Error('reference_capture_failed'));
            }, timeoutMs);

            function onResult(event) {
                const detail = event.detail || {};
                if (detail.requestId !== requestId) return;
                clearTimeout(timer);
                document.removeEventListener('__gpt_fetch_media_data_url_result', onResult);
                if (detail.error) reject(new Error('reference_capture_failed'));
                else resolve(detail.dataUrl);
            }

            document.addEventListener('__gpt_fetch_media_data_url_result', onResult);
            document.dispatchEvent(new CustomEvent('__gpt_fetch_media_data_url', {
                detail: { url, requestId }
            }));
        });
    }

    async function sourceToDataUrl(src) {
        if (String(src || '').startsWith('data:image/')) return src;
        if (utils.isTrustedGrokMediaUrl(src)) return fetchViaBridgeAsDataUrl(src);

        const response = await fetch(src);
        if (!response.ok) throw new Error('reference_capture_failed');
        return readBlobAsDataUrl(await response.blob());
    }
```

Add `fetchViaBridgeAsDataUrl` and `sourceToDataUrl` to the returned export object.

- [ ] **Step 5: Run content helper tests**

Run:

```bash
npm run test:unit -- tests/unit/recreateWorkflowContent.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit bridge fetch support**

Run:

```bash
git add bridge.js recreateWorkflowContent.js tests/unit/recreateWorkflowContent.test.js
git commit -m "feat: fetch recreate media through bridge"
```

## Task 8: Fail-Fast Diagnostics and Status Polish

**Files:**
- Modify: `recreateWorkflowContent.js`
- Modify: `recreateWorkflowBackground.js`
- Modify: `content.js`
- Modify: `tests/unit/recreateWorkflowBackground.test.js`
- Modify: `tests/unit/recreateWorkflowContent.test.js`

- [ ] **Step 1: Add tests for named failure shapes**

Append to `tests/unit/recreateWorkflowBackground.test.js`:

```js
test('chat phase failure is returned without continuing to Imagine', async () => {
    const { chromeApi, messages } = createChromeHarness();
    chromeApi.tabs.sendMessage = jest.fn((tabId, message, callback) => {
        messages.push({ tabId, message });
        if (message.action === 'GPT_RECREATE_CHAT_STEP') {
            callback({ ok: false, runId: message.runId, phase: 'chat', error: 'chat_upload_input_missing', diagnostics: { url: 'https://grok.com/' } });
        } else {
            callback({ ok: true });
        }
    });
    const controller = createRecreateWorkflowController({ chromeApi, utils });

    const result = await controller.start({
        reference: {
            name: 'sample.png',
            mimeType: 'image/png',
            dataUrl: 'data:image/png;base64,aGVsbG8=',
            source: 'local'
        },
        bestPracticesEnabled: false
    }, {
        sourceTabId: 1,
        sourceTabUrl: 'https://grok.com/imagine'
    });

    expect(result).toEqual(expect.objectContaining({
        ok: false,
        phase: 'chat',
        error: 'chat_upload_input_missing'
    }));
    expect(messages.some((entry) => entry.message.action === 'GPT_RECREATE_IMAGINE_STEP')).toBe(false);
});
```

Append to `tests/unit/recreateWorkflowContent.test.js`:

```js
test('runImagineSubmitStep fails when submit stays disabled', async () => {
    const { runImagineSubmitStep } = require('../../recreateWorkflowContent.js');
    const editor = document.createElement('div');
    editor.contentEditable = 'true';
    editor.setAttribute('aria-label', 'Ask Grok anything');
    document.body.appendChild(editor);

    const submit = document.createElement('button');
    submit.setAttribute('aria-label', 'Submit');
    submit.disabled = true;
    submit.getBoundingClientRect = () => ({ width: 40, height: 40, left: 0, top: 0 });
    document.body.appendChild(submit);

    await expect(runImagineSubmitStep({
        runId: 'recreate_1',
        generatedPrompt: 'A red cabin in snow.',
        autoSubmit: true
    }, { timeoutMs: 10, intervalMs: 1 })).rejects.toThrow('imagine_submit_disabled');
});
```

- [ ] **Step 2: Run failing diagnostics tests**

Run:

```bash
npm run test:unit -- tests/unit/recreateWorkflowBackground.test.js tests/unit/recreateWorkflowContent.test.js
```

Expected: fail if controller continues after chat failure or content errors are not named.

- [ ] **Step 3: Tighten background failure flow**

In `recreateWorkflowBackground.js`, after receiving `chatResponse`, keep this exact branch:

```js
                if (!chatResponse || !chatResponse.ok) {
                    const failed = chatResponse || fail(run, 'chat', 'chat_answer_timeout');
                    await sendStatus(run, failed.phase || 'chat', failed.error || 'chat_answer_timeout', 'error');
                    activeRun = null;
                    return failed;
                }
```

After receiving `imagineResponse`, keep this exact branch:

```js
                if (!imagineResponse || !imagineResponse.ok) {
                    const failed = imagineResponse || fail(run, 'imagine', 'imagine_submit_failed');
                    await sendStatus(run, failed.phase || 'imagine', failed.error || 'imagine_submit_failed', 'error');
                    activeRun = null;
                    return failed;
                }
```

- [ ] **Step 4: Tighten content bridge failure responses**

In `RecreateWorkflowContentBridge.runAsyncStep`, replace the `catch` response with:

```js
    runAsyncStep(fn, sendResponse, runId) {
        (async () => {
            try {
                sendResponse(await fn());
            } catch (error) {
                sendResponse({
                    ok: false,
                    runId,
                    phase: 'content',
                    error: error.code || error.message || 'workflow_failed',
                    diagnostics: {
                        url: location.href,
                        title: document.title
                    }
                });
            }
        })();
    }
```

Pass `request.runId` from each caller:

```js
this.runAsyncStep(() => this.actions.runChatPromptStep(request), sendResponse, request.runId);
```

```js
this.runAsyncStep(async () => {
    const response = await this.actions.runImagineSubmitStep(request);
    if (response.ok && request.generatedPrompt) {
        this.historyManager.add(request.generatedPrompt, 'image');
    }
    return response;
}, sendResponse, request.runId);
```

- [ ] **Step 5: Run diagnostics tests**

Run:

```bash
npm run test:unit -- tests/unit/recreateWorkflowBackground.test.js tests/unit/recreateWorkflowContent.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit diagnostics polish**

Run:

```bash
git add recreateWorkflowBackground.js recreateWorkflowContent.js content.js tests/unit/recreateWorkflowBackground.test.js tests/unit/recreateWorkflowContent.test.js
git commit -m "fix: fail fast in recreate workflow"
```

## Task 9: Full Automated Validation

**Files:**
- No source files expected unless tests expose issues.

- [ ] **Step 1: Run root unit tests**

Run:

```bash
npm run test:unit
```

Expected: PASS. If existing unrelated tests fail, capture the failing test names and do not hide them.

- [ ] **Step 2: Run root E2E tests**

Run:

```bash
npm run test:e2e
```

Expected: PASS.

- [ ] **Step 3: Run root lint**

Run:

```bash
npm run lint
```

Expected: PASS. Fix lint errors in files touched by this plan. Do not refactor unrelated files.

- [ ] **Step 4: Commit any test or lint fixes**

If fixes were needed, run:

```bash
git add recreateWorkflowUtils.js recreateWorkflowContent.js recreateWorkflowBackground.js content.js background.js bridge.js manifest.json jest.setup.js tests/unit/recreateWorkflowUtils.test.js tests/unit/recreateWorkflowContent.test.js tests/unit/recreateWorkflowBackground.test.js tests/e2e/extension.spec.js
git commit -m "test: stabilize recreate workflow validation"
```

If no fixes were needed, do not create an empty commit.

## Task 10: Live Grok Validation

**Files:**
- Create: `docs/superpowers/plans/2026-06-15-grok-image-recreate-implementation-notes.md`
- Modify source files only if live validation exposes selector drift or a real bug.

- [ ] **Step 1: Prepare a harmless reference image**

Use an existing local image or create a simple non-sensitive image outside the repo, for example a small PNG with colored shapes. Do not use private photos or sensitive images for validation.

- [ ] **Step 2: Reload the unpacked extension**

Manual Chrome steps:

```text
1. Open chrome://extensions/
2. Find Grok Power Tools
3. Click the reload icon
4. Refresh the Grok tab
```

- [ ] **Step 3: Run one live workflow from Grok Imagine**

Manual Chrome steps:

```text
1. Open https://grok.com/imagine
2. Confirm the Grok Power Tools overlay appears
3. Open Recreate Image
4. Choose the harmless reference image
5. Keep Grok Search enabled
6. Click Start Recreate
7. Watch the workflow open/use a chat tab, extract a prompt, then submit in Imagine
```

Expected: The overlay reports `Submitted to Grok Imagine.` and the Imagine composer submits. The workflow stops after submit; it does not wait for generated images.

- [ ] **Step 4: Record validation notes**

Create `docs/superpowers/plans/2026-06-15-grok-image-recreate-implementation-notes.md`:

```markdown
# Grok Image Recreate Implementation Notes

## Automated Validation

- `npm run test:unit`: PASS
- `npm run test:e2e`: PASS
- `npm run lint`: PASS

## Live Grok Validation

- Date: 2026-06-15
- Start page: `https://grok.com/imagine`
- Reference source: harmless local image
- Grok Search enabled: yes
- Chat upload verified: yes
- Chat answer marker extracted: yes
- Imagine prompt injected: yes
- Imagine submit clicked: yes
- Final overlay status: `Submitted to Grok Imagine.`

## Selector Notes

- Chat editor:
- Chat attach or file input:
- Chat Search active-state signal:
- Chat submit:
- Assistant answer container:
- Imagine editor:
- Imagine submit:

## Follow-Ups

- Add web app command bridge after extension workflow remains stable.
```

Fill each selector note with the actual observed selector, attribute, or active-state signal from the live run. The fields above are required; do not remove any line.

- [ ] **Step 5: Commit validation notes and any live fixes**

If live validation passes without source changes:

```bash
git add docs/superpowers/plans/2026-06-15-grok-image-recreate-implementation-notes.md
git commit -m "docs: record recreate workflow validation"
```

If live validation requires selector fixes:

```bash
git add recreateWorkflowContent.js content.js docs/superpowers/plans/2026-06-15-grok-image-recreate-implementation-notes.md
git commit -m "fix: align recreate workflow with live Grok UI"
```

## Task 11: Final Review

**Files:**
- Review only unless a defect is found.

- [ ] **Step 1: Inspect final git state**

Run:

```bash
git status --short
```

Expected: no modified tracked files. The pre-existing untracked file `docs/superpowers/plans/2026-06-14-live-browser-ui-qa-implementation-notes.html` may still appear and should not be staged unless the user asks.

- [ ] **Step 2: Review final diff summary**

Run:

```bash
git log --oneline -8
```

Expected: recent commits include this feature’s semantic commits.

- [ ] **Step 3: Report completion with validation**

Final response must include:

```text
Implemented the extension-only Grok Image Recreate workflow.

Validation:
- npm run test:unit: PASS
- npm run test:e2e: PASS
- npm run lint: PASS
- Live Grok validation: PASS, submitted one harmless reference workflow
```

If any validation fails, do not claim completion. Report the exact command or live step that failed and the current blocker.

## Self-Review Checklist

- Spec coverage:
  - Overlay controls: Task 6.
  - Local/paste/drop/current image references: Tasks 2 and 6.
  - Data URL, blob, trusted Grok media support: Tasks 2 and 7.
  - Two-tab workflow: Tasks 4 and 5.
  - Chat instruction and marker extraction: Tasks 1 and 3.
  - Best-practices Grok Search toggle: Tasks 3 and 6.
  - Imagine injection and auto-submit: Task 3.
  - Fail-fast errors and safe diagnostics: Tasks 1, 4, 8.
  - Tests and live validation: Tasks 1 through 10.
  - Web app deferred: Scope Check and no web files touched.
- Placeholder scan: no placeholder markers, deferred-work markers, or missing code snippets should remain in this plan.
- Type consistency:
  - Shared global is `GrokRecreateWorkflowUtils`.
  - Content global is `GrokRecreateContentActions`.
  - Background global is `GrokRecreateWorkflowBackground`.
  - Start action is `START_GPT_RECREATE`.
  - Abort action is `ABORT_GPT_RECREATE`.
  - Status action is `GPT_RECREATE_STATUS`.
  - Chat phase action is `GPT_RECREATE_CHAT_STEP`.
  - Imagine phase action is `GPT_RECREATE_IMAGINE_STEP`.
