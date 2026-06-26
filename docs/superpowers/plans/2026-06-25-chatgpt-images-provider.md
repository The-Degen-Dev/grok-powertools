# ChatGPT Images Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add provider-aware ChatGPT Images text-to-image support to the Chrome extension without regressing the existing Grok Imagine workflows.

**Architecture:** Add small raw-JS helper modules for provider detection, ChatGPT Images page actions, and provider run ledger storage. Wire those helpers into the existing `content.js` overlay so Grok-only controls stay on Grok pages while `chatgpt.com/images` gets a focused text-to-image card.

**Tech Stack:** Chrome MV3 raw JavaScript, Jest with jsdom, Playwright extension fixture tests, Chrome storage APIs, live Chrome validation on `chatgpt.com/images` and `grok.com/imagine`.

---

## Spec And Current Repo Facts

Start from the design spec at `docs/superpowers/specs/2026-06-25-chatgpt-images-provider-design.md`.

Current repo constraints:

- Root extension has no build step.
- Existing browser-compatible helper files use UMD-style globals plus CommonJS exports.
- `content.js` is the overlay monolith and currently assumes Grok-first UI.
- Existing E2E tests load root scripts by reading files and evaluating them in a mocked browser page.
- Existing Grok recreate helpers live in `recreateWorkflowUtils.js`, `recreateWorkflowContent.js`, and `recreateWorkflowBackground.js`.
- This plan must preserve existing Grok tests and add ChatGPT tests before production code changes.

## File Structure

Create these files:

- `providerRegistry.js`: provider IDs, provider detection, and capability flags.
- `chatgptImagesContent.js`: DOM helpers for `chatgpt.com/images`, prompt submission, result snapshots, and result delta detection.
- `providerRunLedger.js`: provider-aware run history storage helpers.
- `tests/unit/providerRegistry.test.js`: provider detection and capability tests.
- `tests/unit/chatgptImagesContent.test.js`: ChatGPT Images DOM helper and workflow tests.
- `tests/unit/providerRunLedger.test.js`: ledger normalization and storage tests.
- `tests/unit/manifestProviderCoverage.test.js`: manifest coverage for ChatGPT script injection.
- `tests/unit/providerOverlay.test.js`: overlay provider UI tests.

Modify these files:

- `manifest.json`: add provider helper scripts and `https://chatgpt.com/images*` content-script match.
- `content.js`: load helper globals/CommonJS modules, detect provider, hide provider-incompatible controls, add ChatGPT Images card, run ChatGPT prompt workflow, write ledger entries.
- `tests/e2e/extension.spec.js`: load new helper scripts and add mocked Grok and ChatGPT provider overlay tests.
- `README.md`: document ChatGPT Images V1 text-to-image support after implementation passes.
- `HACKING.md`: document provider registry, ChatGPT selector notes, and validation loop.
- `AGENTS.md`: update planned-support language after implementation passes.
- `docs/AGENT_HANDOFF_PROMPT.md`: update provider-aware support language after implementation passes.

Keep `bridge.js`, `background.js`, and recreate workflow files unchanged unless a test proves they are directly needed for this first slice.

## Task 1: Provider Registry

**Files:**
- Create: `providerRegistry.js`
- Test: `tests/unit/providerRegistry.test.js`

- [ ] **Step 1: Write the failing provider registry test**

Create `tests/unit/providerRegistry.test.js`:

```js
const {
    PROVIDER_IDS,
    detectProvider,
    getProvider,
    hasProviderCapability
} = require('../../providerRegistry.js');

describe('provider registry', () => {
    test('detects Grok Imagine provider on Grok Imagine routes', () => {
        const provider = detectProvider('https://grok.com/imagine');

        expect(provider.id).toBe(PROVIDER_IDS.GROK_IMAGINE);
        expect(provider.label).toBe('Grok Imagine');
        expect(provider.capabilities.canUseProviderSearch).toBe(true);
        expect(provider.capabilities.canRunVideoGoals).toBe(true);
    });

    test('detects ChatGPT Images provider only on the Images route', () => {
        const provider = detectProvider('https://chatgpt.com/images/');

        expect(provider.id).toBe(PROVIDER_IDS.CHATGPT_IMAGES);
        expect(provider.label).toBe('ChatGPT Images');
        expect(provider.capabilities.canRunTextPrompt).toBe(true);
        expect(provider.capabilities.canCaptureGeneratedImages).toBe(true);
        expect(provider.capabilities.canUseProviderSearch).toBe(false);
        expect(provider.capabilities.canRunVideoGoals).toBe(false);
    });

    test('does not enable ChatGPT controls on unrelated ChatGPT routes', () => {
        const provider = detectProvider('https://chatgpt.com/c/abc123');

        expect(provider.id).toBe(PROVIDER_IDS.UNKNOWN);
        expect(provider.capabilities.canRunTextPrompt).toBe(false);
        expect(provider.capabilities.canCaptureGeneratedImages).toBe(false);
    });

    test('returns defensive copies of provider definitions', () => {
        const provider = getProvider(PROVIDER_IDS.CHATGPT_IMAGES);
        provider.capabilities.canRunVideoGoals = true;

        expect(getProvider(PROVIDER_IDS.CHATGPT_IMAGES).capabilities.canRunVideoGoals).toBe(false);
        expect(hasProviderCapability(PROVIDER_IDS.CHATGPT_IMAGES, 'canRunTextPrompt')).toBe(true);
        expect(hasProviderCapability(PROVIDER_IDS.CHATGPT_IMAGES, 'canUseReferenceVideo')).toBe(false);
    });
});
```

- [ ] **Step 2: Run the failing provider registry test**

Run:

```bash
npm run test:unit -- tests/unit/providerRegistry.test.js
```

Expected: FAIL with `Cannot find module '../../providerRegistry.js'`.

- [ ] **Step 3: Add provider registry implementation**

Create `providerRegistry.js`:

```js
(function (root, factory) {
    const api = factory();

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }

    if (root) {
        root.GrokPowerToolsProviderRegistry = api;
    }
})(typeof self !== 'undefined' ? self : typeof globalThis !== 'undefined' ? globalThis : this, function () {
    const PROVIDER_IDS = {
        GROK_IMAGINE: 'grok-imagine',
        CHATGPT_IMAGES: 'chatgpt-images',
        UNKNOWN: 'unknown'
    };

    const EMPTY_CAPABILITIES = Object.freeze({
        canRunTextPrompt: false,
        canUseReferenceImage: false,
        canUseReferenceVideo: false,
        canUseProviderSearch: false,
        canUseCurrentProviderMedia: false,
        canRunBatch: false,
        canRunVideoGoals: false,
        canCaptureGeneratedImages: false,
        canDownloadGeneratedImages: false
    });

    const PROVIDERS = Object.freeze({
        [PROVIDER_IDS.GROK_IMAGINE]: Object.freeze({
            id: PROVIDER_IDS.GROK_IMAGINE,
            label: 'Grok Imagine',
            capabilities: Object.freeze({
                ...EMPTY_CAPABILITIES,
                canRunTextPrompt: true,
                canUseReferenceImage: true,
                canUseReferenceVideo: true,
                canUseProviderSearch: true,
                canUseCurrentProviderMedia: true,
                canRunBatch: true,
                canRunVideoGoals: true,
                canCaptureGeneratedImages: true,
                canDownloadGeneratedImages: true
            })
        }),
        [PROVIDER_IDS.CHATGPT_IMAGES]: Object.freeze({
            id: PROVIDER_IDS.CHATGPT_IMAGES,
            label: 'ChatGPT Images',
            capabilities: Object.freeze({
                ...EMPTY_CAPABILITIES,
                canRunTextPrompt: true,
                canCaptureGeneratedImages: true,
                canDownloadGeneratedImages: false
            })
        }),
        [PROVIDER_IDS.UNKNOWN]: Object.freeze({
            id: PROVIDER_IDS.UNKNOWN,
            label: 'Unsupported page',
            capabilities: EMPTY_CAPABILITIES
        })
    });

    function copyProvider(provider) {
        return {
            id: provider.id,
            label: provider.label,
            capabilities: { ...provider.capabilities }
        };
    }

    function getProvider(providerId) {
        return copyProvider(PROVIDERS[providerId] || PROVIDERS[PROVIDER_IDS.UNKNOWN]);
    }

    function normalizeUrl(value) {
        if (value && typeof value.href === 'string') return new URL(value.href);
        if (typeof value === 'string') return new URL(value);
        if (typeof location !== 'undefined' && location.href) return new URL(location.href);
        return new URL('https://unsupported.invalid/');
    }

    function isGrokHost(hostname) {
        return hostname === 'grok.com' || hostname.endsWith('.grok.com');
    }

    function detectProvider(value) {
        let url;
        try {
            url = normalizeUrl(value);
        } catch {
            return getProvider(PROVIDER_IDS.UNKNOWN);
        }

        if (url.protocol === 'https:' && isGrokHost(url.hostname)) {
            return getProvider(PROVIDER_IDS.GROK_IMAGINE);
        }

        if (
            url.protocol === 'https:' &&
            url.hostname === 'chatgpt.com' &&
            (url.pathname === '/images' || url.pathname.startsWith('/images/'))
        ) {
            return getProvider(PROVIDER_IDS.CHATGPT_IMAGES);
        }

        return getProvider(PROVIDER_IDS.UNKNOWN);
    }

    function hasProviderCapability(providerOrId, capabilityName) {
        const provider = typeof providerOrId === 'string' ? getProvider(providerOrId) : providerOrId;
        return !!(provider && provider.capabilities && provider.capabilities[capabilityName]);
    }

    return {
        PROVIDER_IDS,
        detectProvider,
        getProvider,
        hasProviderCapability
    };
});
```

- [ ] **Step 4: Run provider registry test to verify it passes**

Run:

```bash
npm run test:unit -- tests/unit/providerRegistry.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit provider registry**

Run:

```bash
git add providerRegistry.js tests/unit/providerRegistry.test.js
git commit -m "feat: add provider registry"
```

## Task 2: ChatGPT Images Content Helpers

**Files:**
- Create: `chatgptImagesContent.js`
- Test: `tests/unit/chatgptImagesContent.test.js`

- [ ] **Step 1: Write failing ChatGPT Images content helper tests**

Create `tests/unit/chatgptImagesContent.test.js`:

```js
const {
    collectChatGptImageCandidates,
    createChatGptResultSnapshot,
    diffChatGptResultCandidates,
    fillChatGptPromptInput,
    findChatGptPromptInput,
    findChatGptSendButton,
    runChatGptImagePrompt
} = require('../../chatgptImagesContent.js');

function makeImage(src, overrides = {}) {
    const img = document.createElement('img');
    img.src = src;
    img.alt = overrides.alt || 'generated image';
    Object.defineProperty(img, 'complete', { configurable: true, value: true });
    Object.defineProperty(img, 'naturalWidth', { configurable: true, value: overrides.naturalWidth || 1024 });
    Object.defineProperty(img, 'naturalHeight', { configurable: true, value: overrides.naturalHeight || 1024 });
    img.getBoundingClientRect = overrides.getBoundingClientRect || (() => ({
        left: 100,
        top: 100,
        width: 320,
        height: 320
    }));
    document.body.appendChild(img);
    return img;
}

describe('ChatGPT Images content helpers', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        jest.useRealTimers();
    });

    test('finds and fills the ChatGPT Images prompt textarea', () => {
        const input = document.createElement('textarea');
        input.name = 'prompt-textarea';
        input.placeholder = 'Describe a new image';
        document.body.appendChild(input);

        const seenEvents = [];
        input.addEventListener('input', () => seenEvents.push('input'));
        input.addEventListener('change', () => seenEvents.push('change'));

        expect(findChatGptPromptInput()).toBe(input);
        fillChatGptPromptInput('a glass lighthouse at sunrise');

        expect(input.value).toBe('a glass lighthouse at sunrise');
        expect(seenEvents).toEqual(['input', 'change']);
    });

    test('finds the send button and ignores disabled sends', async () => {
        const send = document.createElement('button');
        send.dataset.testid = 'send-button';
        send.setAttribute('aria-label', 'Send prompt');
        document.body.appendChild(send);

        expect(findChatGptSendButton()).toBe(send);
        send.disabled = true;
        await expect(runChatGptImagePrompt({ prompt: 'x', timeoutMs: 5 })).rejects.toThrow('chatgpt_send_disabled');
    });

    test('diffs generated images against a pre-submit snapshot', () => {
        makeImage('https://cdn.example.com/existing.png');
        const before = createChatGptResultSnapshot();
        makeImage('https://cdn.example.com/new-result.png', { alt: 'new result' });

        const afterCandidates = collectChatGptImageCandidates();
        const delta = diffChatGptResultCandidates(before, afterCandidates);

        expect(delta).toHaveLength(1);
        expect(delta[0].src).toBe('https://cdn.example.com/new-result.png');
    });

    test('submits a prompt and resolves only after a new image candidate appears', async () => {
        const input = document.createElement('textarea');
        input.name = 'prompt-textarea';
        document.body.appendChild(input);

        const send = document.createElement('button');
        send.dataset.testid = 'send-button';
        send.setAttribute('aria-label', 'Send prompt');
        document.body.appendChild(send);

        const result = await runChatGptImagePrompt({
            prompt: 'a tiny brass observatory',
            timeoutMs: 500,
            intervalMs: 10,
            afterSubmit: () => {
                makeImage('https://cdn.example.com/generated.png');
            }
        });

        expect(input.value).toBe('a tiny brass observatory');
        expect(result).toEqual(expect.objectContaining({
            ok: true,
            providerId: 'chatgpt-images',
            workflow: 'text-to-image',
            prompt: 'a tiny brass observatory',
            submitted: true
        }));
        expect(result.result.src).toBe('https://cdn.example.com/generated.png');
    });
});
```

- [ ] **Step 2: Run the failing ChatGPT content tests**

Run:

```bash
npm run test:unit -- tests/unit/chatgptImagesContent.test.js
```

Expected: FAIL with `Cannot find module '../../chatgptImagesContent.js'`.

- [ ] **Step 3: Add ChatGPT Images content helper implementation**

Create `chatgptImagesContent.js`:

```js
(function (root, factory) {
    const api = factory();

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }

    if (root) {
        root.ChatGPTImagesContentActions = api;
    }
})(typeof self !== 'undefined' ? self : typeof globalThis !== 'undefined' ? globalThis : this, function () {
    function fail(code) {
        const error = new Error(code);
        error.code = code;
        return error;
    }

    function waitForCondition(predicate, options = {}) {
        const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 180000;
        const intervalMs = Number.isFinite(options.intervalMs) ? options.intervalMs : 500;

        return new Promise((resolve, reject) => {
            let settled = false;
            let pollTimer = null;
            const deadlineTimer = setTimeout(() => finish(null, fail(options.timeoutError || 'chatgpt_result_timeout')), timeoutMs);

            function finish(value, error) {
                if (settled) return;
                settled = true;
                clearTimeout(deadlineTimer);
                if (pollTimer) clearTimeout(pollTimer);
                if (error) reject(error);
                else resolve(value);
            }

            function poll() {
                Promise.resolve()
                    .then(() => predicate())
                    .then((value) => {
                        if (settled) return;
                        if (value) {
                            finish(value);
                            return;
                        }
                        pollTimer = setTimeout(poll, intervalMs);
                    })
                    .catch((error) => finish(null, error));
            }

            poll();
        });
    }

    function getDocument(options = {}) {
        return options.documentRef || (typeof document !== 'undefined' ? document : null);
    }

    function isVisible(element) {
        if (!element || typeof element.getBoundingClientRect !== 'function') return true;
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
    }

    function findChatGptPromptInput(options = {}) {
        const documentRef = getDocument(options);
        if (!documentRef) return null;

        return (
            documentRef.querySelector('textarea[name="prompt-textarea"]') ||
            documentRef.querySelector('textarea[placeholder="Describe a new image"]') ||
            documentRef.querySelector('[role="textbox"][aria-label="Chat with ChatGPT"]')
        );
    }

    function findChatGptSendButton(options = {}) {
        const documentRef = getDocument(options);
        if (!documentRef) return null;

        return Array.from(
            documentRef.querySelectorAll('button[data-testid="send-button"], button[aria-label="Send prompt"]')
        ).find(isVisible) || null;
    }

    function dispatchEditableEvents(element) {
        const InputEventConstructor = typeof InputEvent === 'function' ? InputEvent : Event;
        element.dispatchEvent(new InputEventConstructor('input', { bubbles: true, inputType: 'insertText' }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function fillChatGptPromptInput(prompt, options = {}) {
        const input = findChatGptPromptInput(options);
        if (!input) throw fail('chatgpt_prompt_missing');

        const text = String(prompt || '').trim();
        if ('value' in input) {
            input.value = text;
        } else {
            input.textContent = text;
        }
        dispatchEditableEvents(input);
        return input;
    }

    function clickElement(element) {
        ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach((type) => {
            element.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
        });
    }

    function getImageSignature(candidate) {
        return [candidate.src, candidate.alt || '', candidate.href || ''].join('|');
    }

    function collectChatGptImageCandidates(options = {}) {
        const documentRef = getDocument(options);
        if (!documentRef) return [];

        return Array.from(documentRef.querySelectorAll('img'))
            .map((img) => {
                const rect = typeof img.getBoundingClientRect === 'function'
                    ? img.getBoundingClientRect()
                    : { left: 0, top: 0, width: 0, height: 0 };
                const src = String(img.currentSrc || img.src || '').trim();
                const href = img.closest('a') ? String(img.closest('a').href || '') : '';
                return {
                    src,
                    alt: img.getAttribute('alt') || '',
                    href,
                    naturalWidth: img.naturalWidth || 0,
                    naturalHeight: img.naturalHeight || 0,
                    rect: {
                        left: rect.left,
                        top: rect.top,
                        width: rect.width,
                        height: rect.height
                    },
                    signature: ''
                };
            })
            .filter((candidate) => {
                if (!candidate.src) return false;
                if (candidate.src.startsWith('data:image/gif;base64,R0lGODlhAQABA')) return false;
                if (candidate.rect.width <= 0 || candidate.rect.height <= 0) return false;
                if (candidate.naturalWidth > 0 && candidate.naturalWidth < 128) return false;
                if (candidate.naturalHeight > 0 && candidate.naturalHeight < 128) return false;
                return true;
            })
            .map((candidate) => ({
                ...candidate,
                signature: getImageSignature(candidate)
            }));
    }

    function createChatGptResultSnapshot(options = {}) {
        const candidates = collectChatGptImageCandidates(options);
        return {
            createdAt: Date.now(),
            signatures: candidates.map((candidate) => candidate.signature),
            candidates
        };
    }

    function diffChatGptResultCandidates(snapshot, candidates = []) {
        const known = new Set((snapshot && snapshot.signatures) || []);
        const seen = new Set();
        return candidates.filter((candidate) => {
            if (!candidate.signature || known.has(candidate.signature) || seen.has(candidate.signature)) return false;
            seen.add(candidate.signature);
            return true;
        });
    }

    function assertNoVisibleBlocker(options = {}) {
        const documentRef = getDocument(options);
        if (!documentRef) return;
        const text = String(documentRef.body && documentRef.body.innerText ? documentRef.body.innerText : '');
        if (/log in|sign up|upgrade|captcha|rate limit|usage limit|try again later/i.test(text)) {
            throw fail('chatgpt_blocked');
        }
    }

    async function runChatGptImagePrompt(request = {}, options = {}) {
        const prompt = String(request.prompt || '').trim();
        if (!prompt) throw fail('chatgpt_prompt_empty');

        assertNoVisibleBlocker(options);
        const before = createChatGptResultSnapshot(options);
        fillChatGptPromptInput(prompt, options);

        const send = findChatGptSendButton(options);
        if (!send) throw fail('chatgpt_send_missing');
        if (send.disabled || send.getAttribute('aria-disabled') === 'true') throw fail('chatgpt_send_disabled');

        clickElement(send);
        if (typeof request.afterSubmit === 'function') await request.afterSubmit();

        const result = await waitForCondition(() => {
            const delta = diffChatGptResultCandidates(before, collectChatGptImageCandidates(options));
            return delta[0] || null;
        }, {
            timeoutMs: request.timeoutMs,
            intervalMs: request.intervalMs,
            timeoutError: 'chatgpt_result_timeout'
        });

        return {
            ok: true,
            providerId: 'chatgpt-images',
            workflow: 'text-to-image',
            prompt,
            submitted: true,
            result
        };
    }

    return {
        collectChatGptImageCandidates,
        createChatGptResultSnapshot,
        diffChatGptResultCandidates,
        fillChatGptPromptInput,
        findChatGptPromptInput,
        findChatGptSendButton,
        runChatGptImagePrompt,
        waitForCondition
    };
});
```

- [ ] **Step 4: Run ChatGPT content tests to verify they pass**

Run:

```bash
npm run test:unit -- tests/unit/chatgptImagesContent.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit ChatGPT content helpers**

Run:

```bash
git add chatgptImagesContent.js tests/unit/chatgptImagesContent.test.js
git commit -m "feat: add chatgpt images content helpers"
```

## Task 3: Provider Run Ledger

**Files:**
- Create: `providerRunLedger.js`
- Test: `tests/unit/providerRunLedger.test.js`

- [ ] **Step 1: Write failing ledger tests**

Create `tests/unit/providerRunLedger.test.js`:

```js
const {
    PROVIDER_RUN_HISTORY_KEY,
    appendProviderRunLedgerEntry,
    createProviderRunId,
    normalizeProviderRunLedgerEntry
} = require('../../providerRunLedger.js');

function createStorage(initial = {}) {
    const state = { ...initial };
    return {
        state,
        get: jest.fn((keys) => {
            const list = Array.isArray(keys) ? keys : [keys];
            return Promise.resolve(list.reduce((acc, key) => {
                acc[key] = state[key];
                return acc;
            }, {}));
        }),
        set: jest.fn((next) => {
            Object.assign(state, next);
            return Promise.resolve();
        })
    };
}

describe('provider run ledger', () => {
    test('creates provider run ids with stable prefix', () => {
        expect(createProviderRunId({ now: () => 123, random: () => 0.5 })).toMatch(/^provider_run_123_/);
    });

    test('normalizes ChatGPT text-to-image run entries', () => {
        const entry = normalizeProviderRunLedgerEntry({
            runId: 'provider_run_1',
            providerId: 'chatgpt-images',
            workflow: 'text-to-image',
            prompt: '  a brass observatory  ',
            status: 'generated',
            result: {
                src: 'https://cdn.example.com/generated.png',
                href: 'https://chatgpt.com/images/abc'
            }
        }, { now: () => 456 });

        expect(entry).toEqual(expect.objectContaining({
            runId: 'provider_run_1',
            providerId: 'chatgpt-images',
            workflow: 'text-to-image',
            prompt: 'a brass observatory',
            status: 'generated',
            resultMediaUrl: 'https://cdn.example.com/generated.png',
            resultPageUrl: 'https://chatgpt.com/images/abc',
            downloadStatus: 'not_supported_yet',
            createdAt: 456
        }));
    });

    test('appends newest entries first and limits stored history', async () => {
        const storage = createStorage({
            [PROVIDER_RUN_HISTORY_KEY]: [{ runId: 'old', createdAt: 1 }]
        });

        await appendProviderRunLedgerEntry({
            runId: 'new',
            providerId: 'chatgpt-images',
            workflow: 'text-to-image',
            prompt: 'new prompt',
            status: 'generated'
        }, { storage, maxEntries: 1, now: () => 2 });

        expect(storage.set).toHaveBeenCalledWith({
            [PROVIDER_RUN_HISTORY_KEY]: [
                expect.objectContaining({ runId: 'new', createdAt: 2 })
            ]
        });
    });
});
```

- [ ] **Step 2: Run the failing ledger tests**

Run:

```bash
npm run test:unit -- tests/unit/providerRunLedger.test.js
```

Expected: FAIL with `Cannot find module '../../providerRunLedger.js'`.

- [ ] **Step 3: Add ledger implementation**

Create `providerRunLedger.js`:

```js
(function (root, factory) {
    const api = factory();

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }

    if (root) {
        root.GrokPowerToolsProviderRunLedger = api;
    }
})(typeof self !== 'undefined' ? self : typeof globalThis !== 'undefined' ? globalThis : this, function () {
    const PROVIDER_RUN_HISTORY_KEY = 'providerRunHistory';

    function createProviderRunId(options = {}) {
        const now = typeof options.now === 'function' ? options.now : Date.now;
        const random = typeof options.random === 'function' ? options.random : Math.random;
        return `provider_run_${now()}_${random().toString(16).slice(2, 10)}`;
    }

    function normalizeStatus(value) {
        const allowed = new Set(['draft', 'submitted', 'generating', 'generated', 'failed', 'blocked']);
        return allowed.has(value) ? value : 'submitted';
    }

    function normalizeProviderRunLedgerEntry(entry = {}, options = {}) {
        const now = typeof options.now === 'function' ? options.now : Date.now;
        const createdAt = Number.isFinite(entry.createdAt) ? entry.createdAt : now();
        const result = entry.result || {};

        return {
            runId: String(entry.runId || createProviderRunId(options)),
            providerId: String(entry.providerId || 'unknown'),
            workflow: String(entry.workflow || 'text-to-image'),
            createdAt,
            submittedAt: Number.isFinite(entry.submittedAt) ? entry.submittedAt : createdAt,
            completedAt: Number.isFinite(entry.completedAt) ? entry.completedAt : createdAt,
            prompt: String(entry.prompt || '').trim(),
            promptSource: String(entry.promptSource || 'typed'),
            status: normalizeStatus(entry.status),
            failureCode: entry.failureCode ? String(entry.failureCode) : '',
            resultPageUrl: String(entry.resultPageUrl || result.href || ''),
            resultMediaUrl: String(entry.resultMediaUrl || result.src || ''),
            resultThumbnailUrl: String(entry.resultThumbnailUrl || result.src || ''),
            downloadStatus: String(entry.downloadStatus || 'not_supported_yet'),
            diagnostics: entry.diagnostics && typeof entry.diagnostics === 'object' ? entry.diagnostics : {}
        };
    }

    function getStorage(options = {}) {
        if (options.storage) return options.storage;
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) return chrome.storage.local;
        throw new Error('provider_run_storage_missing');
    }

    async function appendProviderRunLedgerEntry(entry, options = {}) {
        const storage = getStorage(options);
        const maxEntries = Number.isFinite(options.maxEntries) ? Math.max(1, options.maxEntries) : 100;
        const normalized = normalizeProviderRunLedgerEntry(entry, options);
        const stored = await storage.get([PROVIDER_RUN_HISTORY_KEY]);
        const existing = Array.isArray(stored[PROVIDER_RUN_HISTORY_KEY]) ? stored[PROVIDER_RUN_HISTORY_KEY] : [];
        const next = [normalized, ...existing.filter((item) => item && item.runId !== normalized.runId)].slice(0, maxEntries);
        await storage.set({ [PROVIDER_RUN_HISTORY_KEY]: next });
        return normalized;
    }

    return {
        PROVIDER_RUN_HISTORY_KEY,
        appendProviderRunLedgerEntry,
        createProviderRunId,
        normalizeProviderRunLedgerEntry
    };
});
```

- [ ] **Step 4: Run ledger tests to verify they pass**

Run:

```bash
npm run test:unit -- tests/unit/providerRunLedger.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit provider run ledger**

Run:

```bash
git add providerRunLedger.js tests/unit/providerRunLedger.test.js
git commit -m "feat: add provider run ledger"
```

## Task 4: Manifest Provider Coverage

**Files:**
- Modify: `manifest.json`
- Test: `tests/unit/manifestProviderCoverage.test.js`

- [ ] **Step 1: Write failing manifest provider coverage test**

Create `tests/unit/manifestProviderCoverage.test.js`:

```js
const manifest = require('../../manifest.json');

describe('provider manifest coverage', () => {
    test('loads provider helpers before the main content script', () => {
        const scripts = manifest.content_scripts[0].js;

        expect(scripts.indexOf('providerRegistry.js')).toBeGreaterThanOrEqual(0);
        expect(scripts.indexOf('providerRunLedger.js')).toBeGreaterThan(scripts.indexOf('providerRegistry.js'));
        expect(scripts.indexOf('chatgptImagesContent.js')).toBeGreaterThan(scripts.indexOf('providerRunLedger.js'));
        expect(scripts.indexOf('content.js')).toBeGreaterThan(scripts.indexOf('chatgptImagesContent.js'));
    });

    test('injects content scripts on ChatGPT Images without dropping Grok matches', () => {
        const matches = manifest.content_scripts[0].matches;

        expect(matches).toContain('https://chatgpt.com/images*');
        expect(matches).toContain('*://grok.com/*');
        expect(matches).toContain('*://*.grok.com/*');
    });

    test('does not add a broader ChatGPT host permission than needed for V1', () => {
        const hostPermissions = manifest.host_permissions || [];
        expect(hostPermissions).not.toContain('https://*.chatgpt.com/*');
        expect(hostPermissions).not.toContain('*://*.chatgpt.com/*');
    });
});
```

- [ ] **Step 2: Run the failing manifest test**

Run:

```bash
npm run test:unit -- tests/unit/manifestProviderCoverage.test.js
```

Expected: FAIL because `providerRegistry.js` is not in the content script list and `https://chatgpt.com/images*` is missing.

- [ ] **Step 3: Update manifest content-script entries**

Modify the `content_scripts[0].matches` array in `manifest.json` so it contains:

```json
"matches": [
  "*://*.x.com/*",
  "*://*.grok.x.ai/*",
  "*://grok.com/*",
  "*://*.grok.com/*",
  "*://imagine-public.x.ai/*",
  "https://chatgpt.com/images*"
]
```

Modify the `content_scripts[0].js` array in `manifest.json` so it contains:

```json
"js": [
  "providerRegistry.js",
  "providerRunLedger.js",
  "chatgptImagesContent.js",
  "recreateWorkflowUtils.js",
  "recreateWorkflowContent.js",
  "content.js"
]
```

Do not add ChatGPT entries to `web_accessible_resources` in V1. Do not add `https://*.chatgpt.com/*` to `host_permissions`.

- [ ] **Step 4: Run manifest provider coverage test to verify it passes**

Run:

```bash
npm run test:unit -- tests/unit/manifestProviderCoverage.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit manifest coverage**

Run:

```bash
git add manifest.json tests/unit/manifestProviderCoverage.test.js
git commit -m "feat: inject provider scripts on chatgpt images"
```

## Task 5: Provider-Aware Overlay UI

**Files:**
- Modify: `content.js`
- Test: `tests/unit/providerOverlay.test.js`

- [ ] **Step 1: Write failing provider overlay tests**

Create `tests/unit/providerOverlay.test.js`:

```js
const ProviderRegistry = require('../../providerRegistry.js');
const ChatGPTImagesActions = require('../../chatgptImagesContent.js');
const ProviderRunLedger = require('../../providerRunLedger.js');
const { GrokOverlay } = require('../../content.js');

function createOverlay(providerUrl, overrides = {}) {
    const settings = {
        maxRetries: 3,
        videoGoal: 5,
        galleryBatchLimit: 10,
        autoRetryEnabled: true,
        retryCooldown: 8000,
        generationDelay: 8000,
        historyLimit: 50,
        devMode: false
    };

    const settingsManager = {
        settings,
        get: jest.fn((key) => settings[key]),
        set: jest.fn((key, value) => {
            settings[key] = value;
        }),
        subscribe: jest.fn()
    };

    const historyManager = {
        history: [],
        add: jest.fn(),
        clear: jest.fn(),
        subscribe: jest.fn()
    };

    const retryManager = {
        overlay: null,
        goalRunning: false,
        batchRunning: false,
        startGoal: jest.fn(),
        startBatch: jest.fn().mockResolvedValue(undefined),
        startQualityRepeat: jest.fn(),
        stopBatch: jest.fn(),
        stopQualityRepeat: jest.fn()
    };

    const scraper = { setOverlay: jest.fn() };
    const provider = ProviderRegistry.detectProvider(providerUrl);
    const overlay = new GrokOverlay(scraper, retryManager, settingsManager, historyManager, {
        provider,
        chatGptActions: overrides.chatGptActions || ChatGPTImagesActions,
        providerRunLedger: overrides.providerRunLedger || ProviderRunLedger
    });
    retryManager.overlay = overlay;
    return { overlay, historyManager, retryManager };
}

describe('provider-aware overlay', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        global.chrome = {
            storage: {
                local: {
                    get: jest.fn(() => Promise.resolve({})),
                    set: jest.fn(() => Promise.resolve())
                }
            },
            runtime: {
                sendMessage: jest.fn(() => Promise.resolve({ ok: true }))
            }
        };
    });

    afterEach(() => {
        delete global.chrome;
    });

    test('shows ChatGPT Images provider card and hides Grok-only sections', () => {
        const { overlay } = createOverlay('https://chatgpt.com/images/');

        expect(overlay.el.dataset.providerId).toBe('chatgpt-images');
        expect(overlay.el.querySelector('#gptProviderLabel').textContent).toBe('Provider: ChatGPT Images');
        expect(overlay.el.querySelector('#gptChatGptImageSection').style.display).not.toBe('none');
        expect(overlay.el.querySelector('#gptRecreateSection').style.display).toBe('none');
        expect(overlay.el.querySelector('#gptAutoRetrySection').style.display).toBe('none');
        expect(overlay.el.querySelector('#gptTemplateBatchSection').style.display).toBe('none');
        expect(overlay.el.querySelector('#gptQualityRepeatSection').style.display).toBe('none');
        expect(overlay.el.querySelector('#gptGalleryDownloadSection').style.display).toBe('none');
    });

    test('keeps Grok controls visible on Grok Imagine', () => {
        const { overlay } = createOverlay('https://grok.com/imagine');

        expect(overlay.el.dataset.providerId).toBe('grok-imagine');
        expect(overlay.el.querySelector('#gptProviderLabel').textContent).toBe('Provider: Grok Imagine');
        expect(overlay.el.querySelector('#gptChatGptImageSection').style.display).toBe('none');
        expect(overlay.el.querySelector('#gptRecreateSection').style.display).not.toBe('none');
        expect(overlay.el.querySelector('#gptAutoRetrySection').style.display).not.toBe('none');
    });

    test('runs ChatGPT image generation and writes provider run ledger entry', async () => {
        const runChatGptImagePrompt = jest.fn(() => Promise.resolve({
            ok: true,
            providerId: 'chatgpt-images',
            workflow: 'text-to-image',
            prompt: 'a brass observatory',
            result: {
                src: 'https://cdn.example.com/generated.png',
                href: 'https://chatgpt.com/images/generated'
            }
        }));
        const appendProviderRunLedgerEntry = jest.fn(() => Promise.resolve({ runId: 'provider_run_1' }));
        const { overlay, historyManager } = createOverlay('https://chatgpt.com/images/', {
            chatGptActions: { ...ChatGPTImagesActions, runChatGptImagePrompt },
            providerRunLedger: { ...ProviderRunLedger, appendProviderRunLedgerEntry }
        });

        overlay.el.querySelector('#gptChatGptPrompt').value = 'a brass observatory';
        overlay.el.querySelector('#gptChatGptGenerateBtn').click();
        await Promise.resolve();
        await Promise.resolve();

        expect(runChatGptImagePrompt).toHaveBeenCalledWith(expect.objectContaining({
            prompt: 'a brass observatory'
        }));
        expect(historyManager.add).toHaveBeenCalledWith('a brass observatory', 'image');
        expect(appendProviderRunLedgerEntry).toHaveBeenCalledWith(expect.objectContaining({
            providerId: 'chatgpt-images',
            workflow: 'text-to-image',
            prompt: 'a brass observatory',
            status: 'generated'
        }));
        expect(overlay.el.querySelector('#gptChatGptStatus').textContent).toBe('Generated image ready');
    });
});
```

- [ ] **Step 2: Run the failing provider overlay tests**

Run:

```bash
npm run test:unit -- tests/unit/providerOverlay.test.js
```

Expected: FAIL because `content.js` does not expose provider-aware UI.

- [ ] **Step 3: Add helper module references at the top of `content.js`**

Near the top of `content.js`, after the existing leading comments, add:

```js
const ProviderRegistry = (typeof globalThis !== 'undefined' && globalThis.GrokPowerToolsProviderRegistry)
    ? globalThis.GrokPowerToolsProviderRegistry
    : typeof require === 'function'
      ? require('./providerRegistry.js')
      : null;
const ChatGPTImagesActions = (typeof globalThis !== 'undefined' && globalThis.ChatGPTImagesContentActions)
    ? globalThis.ChatGPTImagesContentActions
    : typeof require === 'function'
      ? require('./chatgptImagesContent.js')
      : null;
const ProviderRunLedger = (typeof globalThis !== 'undefined' && globalThis.GrokPowerToolsProviderRunLedger)
    ? globalThis.GrokPowerToolsProviderRunLedger
    : typeof require === 'function'
      ? require('./providerRunLedger.js')
      : null;
```

- [ ] **Step 4: Update `GrokOverlay` constructor**

Change the constructor signature from:

```js
constructor(scraper, retryManager, settingsManager, historyManager) {
```

to:

```js
constructor(scraper, retryManager, settingsManager, historyManager, options = {}) {
```

Inside the constructor body, before `this.render();`, add:

```js
this.provider = options.provider || (
    ProviderRegistry
        ? ProviderRegistry.detectProvider(typeof location !== 'undefined' ? location.href : '')
        : { id: 'grok-imagine', label: 'Grok Imagine', capabilities: {} }
);
this.chatGptActions = options.chatGptActions || ChatGPTImagesActions;
this.providerRunLedger = options.providerRunLedger || ProviderRunLedger;
```

- [ ] **Step 5: Add provider UI elements to `render()`**

Inside the header title block in `render()`, keep the title and add this line directly after `Grok Power Tools`:

```html
<div id="gptProviderLabel" style="font-size:10px; color:#9ca3af; margin-top:2px;">Provider: Grok Imagine</div>
```

Add IDs to existing Grok-only section wrappers:

```html
<div class="gpt-section" id="gptAutoRetrySection">
```

```html
<div class="gpt-section" id="gptTemplateBatchSection">
```

```html
<div class="gpt-section" id="gptQualityRepeatSection">
```

```html
<div class="gpt-section" id="gptGalleryDownloadSection">
```

Insert the ChatGPT Images card after the status section and before `gptRecreateSection`:

```html
<div class="gpt-section" id="gptChatGptImageSection" style="display:none;">
    <label class="gpt-row" style="font-weight:600; margin-bottom:4px;">Create Image</label>
    <textarea id="gptChatGptPrompt" class="gpt-input" rows="3" style="width:100%; min-height:64px; resize:vertical;" placeholder="Describe a new image"></textarea>
    <div class="gpt-row" style="margin-top:6px;">
        <button id="gptChatGptGenerateBtn" class="gpt-btn gpt-btn-primary" style="flex:1; background:#0ea5e9; font-size:11px;">Generate Image</button>
    </div>
    <div id="gptChatGptStatus" style="font-size:10px; color:#71767b; margin-top:4px;">Ready</div>
</div>
```

- [ ] **Step 6: Add provider UI methods to `GrokOverlay`**

Inside the `GrokOverlay` class, add these methods before `setupListeners()`:

```js
setProviderSectionVisible(sectionId, visible) {
    const section = this.el.querySelector(`#${sectionId}`);
    if (section) section.style.display = visible ? '' : 'none';
}

applyProviderUi() {
    const providerId = this.provider && this.provider.id ? this.provider.id : 'unknown';
    const capabilities = (this.provider && this.provider.capabilities) || {};
    this.el.dataset.providerId = providerId;

    const label = this.el.querySelector('#gptProviderLabel');
    if (label) label.textContent = `Provider: ${this.provider.label || 'Unsupported page'}`;

    const isChatGptImages = providerId === 'chatgpt-images';
    this.setProviderSectionVisible('gptChatGptImageSection', isChatGptImages && !!capabilities.canRunTextPrompt);
    this.setProviderSectionVisible('gptRecreateSection', !isChatGptImages && !!capabilities.canUseReferenceImage);
    this.setProviderSectionVisible('gptAutoRetrySection', !isChatGptImages && !!capabilities.canRunVideoGoals);
    this.setProviderSectionVisible('gptTemplateBatchSection', !isChatGptImages && !!capabilities.canRunBatch);
    this.setProviderSectionVisible('gptQualityRepeatSection', !isChatGptImages && !!capabilities.canRunBatch);
    this.setProviderSectionVisible('gptGalleryDownloadSection', !isChatGptImages && !!capabilities.canDownloadGeneratedImages);
}

setChatGptStatus(message, type = 'neutral') {
    const status = this.el.querySelector('#gptChatGptStatus');
    if (!status) return;
    status.textContent = message;
    status.style.color = type === 'error' ? '#f4212e' : type === 'success' ? '#22c55e' : '#71767b';
}

async startChatGptImageRun() {
    const promptInput = this.el.querySelector('#gptChatGptPrompt');
    const prompt = sanitizeSavedPromptText(promptInput ? promptInput.value : '');
    if (!prompt) {
        this.setChatGptStatus('Enter a prompt before generating.', 'error');
        return;
    }
    if (!this.chatGptActions || typeof this.chatGptActions.runChatGptImagePrompt !== 'function') {
        this.setChatGptStatus('chatgpt_workflow_unavailable', 'error');
        return;
    }

    this.setChatGptStatus('Submitting...', 'neutral');
    try {
        const result = await this.chatGptActions.runChatGptImagePrompt({ prompt });
        this.historyManager.add(prompt, 'image');
        if (this.providerRunLedger && typeof this.providerRunLedger.appendProviderRunLedgerEntry === 'function') {
            await this.providerRunLedger.appendProviderRunLedgerEntry({
                ...result,
                providerId: 'chatgpt-images',
                workflow: 'text-to-image',
                prompt,
                status: 'generated'
            });
        }
        this.setChatGptStatus('Generated image ready', 'success');
    } catch (error) {
        const code = error && (error.code || error.message) ? (error.code || error.message) : 'chatgpt_workflow_failed';
        if (this.providerRunLedger && typeof this.providerRunLedger.appendProviderRunLedgerEntry === 'function') {
            await this.providerRunLedger.appendProviderRunLedgerEntry({
                providerId: 'chatgpt-images',
                workflow: 'text-to-image',
                prompt,
                status: 'failed',
                failureCode: code
            });
        }
        this.setChatGptStatus(code, 'error');
    }
}
```

- [ ] **Step 7: Call `applyProviderUi()` and wire the ChatGPT button**

At the end of `render()`, after `document.body.appendChild(container);`, add:

```js
this.applyProviderUi();
```

In `setupListeners()`, add this near the other button listeners:

```js
const chatGptGenerateBtn = this.el.querySelector('#gptChatGptGenerateBtn');
if (chatGptGenerateBtn) {
    chatGptGenerateBtn.addEventListener('click', () => {
        this.startChatGptImageRun();
    });
}
```

- [ ] **Step 8: Run provider overlay tests to verify they pass**

Run:

```bash
npm run test:unit -- tests/unit/providerOverlay.test.js
```

Expected: PASS.

- [ ] **Step 9: Run existing saved prompt and prompt history tests**

Run:

```bash
npm run test:unit -- tests/unit/savedPrompts.test.js tests/unit/promptHistoryManager.test.js
```

Expected: PASS.

- [ ] **Step 10: Commit provider-aware overlay UI**

Run:

```bash
git add content.js tests/unit/providerOverlay.test.js
git commit -m "feat: add provider-aware overlay ui"
```

## Task 6: Mocked E2E Coverage

**Files:**
- Modify: `tests/e2e/extension.spec.js`

- [ ] **Step 1: Update E2E script loading to include provider helpers**

At the top of `tests/e2e/extension.spec.js`, add paths and file reads:

```js
const providerRegistryJsPath = path.join(__dirname, '../../providerRegistry.js');
const providerRunLedgerJsPath = path.join(__dirname, '../../providerRunLedger.js');
const chatGptImagesContentJsPath = path.join(__dirname, '../../chatgptImagesContent.js');
const providerRegistryJs = fs.readFileSync(providerRegistryJsPath, 'utf8');
const providerRunLedgerJs = fs.readFileSync(providerRunLedgerJsPath, 'utf8');
const chatGptImagesContentJs = fs.readFileSync(chatGptImagesContentJsPath, 'utf8');
```

Update `evaluateExtensionContent(page)` so it evaluates provider helpers before existing scripts:

```js
async function evaluateExtensionContent(page) {
    await page.evaluate(providerRegistryJs);
    await page.evaluate(providerRunLedgerJs);
    await page.evaluate(chatGptImagesContentJs);
    await page.evaluate(utilsJs);
    await page.evaluate(contentActionsJs);
    await page.evaluate(contentJs);
}
```

Update `evaluateExtensionContentWithMockedRecreateActions(page)` the same way, before `utilsJs`.

- [ ] **Step 2: Add mocked provider page helper**

Add this helper below `evaluateExtensionContentWithMockedRecreateActions(page)`:

```js
async function loadMockProviderPage(page, url, bodyHtml = '') {
    await page.route(url, (route) => route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: `<!doctype html><html><head><title>Provider Test</title></head><body>${bodyHtml}</body></html>`
    }));
    await page.goto(url);
    await page.addStyleTag({ content: styleCss });
}
```

- [ ] **Step 3: Replace about:blank setup for existing overlay smoke tests**

In the existing `Overlay should render on the page` and `Minimize button should work` tests, replace the `about:blank` assumption by calling:

```js
await loadMockProviderPage(page, 'https://grok.com/imagine');
await evaluateExtensionContent(page);
```

Expected text should still include `Grok Power Tools` and should now include `Provider: Grok Imagine`.

- [ ] **Step 4: Add mocked ChatGPT Images E2E test**

Append this test to `test.describe('Grok Power Tools E2E', () => { ... })`:

```js
test('ChatGPT Images provider renders focused card and completes mocked submit flow', async ({ page }) => {
    await loadMockProviderPage(page, 'https://chatgpt.com/images/', `
        <main>
            <textarea name="prompt-textarea" placeholder="Describe a new image"></textarea>
            <button data-testid="send-button" aria-label="Send prompt" disabled></button>
            <img src="https://cdn.example.com/existing.png" alt="existing image" width="320" height="320">
            <script>
                const textarea = document.querySelector('textarea[name="prompt-textarea"]');
                const send = document.querySelector('button[data-testid="send-button"]');
                textarea.addEventListener('input', () => { send.disabled = textarea.value.trim().length === 0; });
                send.addEventListener('click', () => {
                    const img = document.createElement('img');
                    img.src = 'https://cdn.example.com/generated-chatgpt.png';
                    img.alt = 'generated image';
                    img.width = 512;
                    img.height = 512;
                    img.getBoundingClientRect = () => ({ left: 100, top: 100, width: 512, height: 512 });
                    document.body.appendChild(img);
                });
            </script>
        </main>
    `);
    await evaluateExtensionContent(page);

    const overlay = page.locator('#grok-powertools-overlay');
    await expect(overlay).toBeVisible();
    await expect(overlay).toContainText('Provider: ChatGPT Images');
    await expect(page.locator('#gptChatGptImageSection')).toBeVisible();
    await expect(page.locator('#gptRecreateSection')).toBeHidden();
    await expect(page.locator('#gptAutoRetrySection')).toBeHidden();

    await page.locator('#gptChatGptPrompt').fill('a tiny brass observatory');
    await page.locator('#gptChatGptGenerateBtn').click();

    await expect(page.locator('#gptChatGptStatus')).toContainText('Generated image ready');
    const runtimePrompt = await page.locator('textarea[name="prompt-textarea"]').inputValue();
    expect(runtimePrompt).toBe('a tiny brass observatory');
});
```

- [ ] **Step 5: Run the E2E suite to verify mocked provider coverage**

Run:

```bash
npm run test:e2e
```

Expected: PASS.

- [ ] **Step 6: Commit E2E coverage**

Run:

```bash
git add tests/e2e/extension.spec.js
git commit -m "test: cover provider overlay e2e"
```

## Task 7: Context Documentation

**Files:**
- Modify: `README.md`
- Modify: `HACKING.md`
- Modify: `AGENTS.md`
- Modify: `docs/AGENT_HANDOFF_PROMPT.md`

- [ ] **Step 1: Update README feature summary after tests pass**

In `README.md`, change the opening description from:

```md
Chrome extension tools for Grok Imagine workflows, prompt management, retry automation, media backup, and local/web collection work.
```

to:

```md
Chrome extension tools for Grok Imagine workflows, ChatGPT Images prompt runs, prompt management, retry automation, media backup, and local/web collection work.
```

Add this bullet under `## Features`:

```md
- Provider-aware overlay support for ChatGPT Images text-to-image runs on `chatgpt.com/images`, with Grok-only controls hidden on ChatGPT pages.
```

Add this limitation under `## Known Limitations`:

```md
- ChatGPT Images support is text-to-image only in this release. Reference-image edit/recreate, provider-specific quality scoring, and ChatGPT gallery download hardening are separate follow-up slices.
```

- [ ] **Step 2: Update HACKING selector notes**

In `HACKING.md`, add this section after the Grok selector section:

```md
## ChatGPT Images provider notes

ChatGPT Images support is routed through `providerRegistry.js`, `chatgptImagesContent.js`, and `providerRunLedger.js`.

Selector anchors verified for the first slice:

- `textarea[name="prompt-textarea"]`
- `button[data-testid="send-button"]`
- `input[name="images-app-drop-container-input"]`

The first slice only controls text-to-image on `https://chatgpt.com/images/`. Do not reuse Grok-specific controls such as Grok Search, Recreate Media, Video Goals, Template Batch, Quality Repeat, or Grok gallery scraping on ChatGPT pages. If ChatGPT result detection changes, compare post-submit image candidates against the pre-submit snapshot instead of reading the full private gallery.
```

- [ ] **Step 3: Update AGENTS planned-support language**

In `AGENTS.md`, replace:

```md
- The extension is currently Grok-first. Planned ChatGPT Images support is scoped in `docs/superpowers/specs/2026-06-25-chatgpt-images-provider-design.md`; do not claim ChatGPT support is shipped until the implementation and live validation are complete.
```

with:

```md
- The extension is provider-aware: Grok Imagine remains the main surface, and ChatGPT Images text-to-image runs are supported on `chatgpt.com/images`. Reference-image ChatGPT recreate/edit is not part of the current slice.
```

- [ ] **Step 4: Update handoff prompt planned-support language**

In `docs/AGENT_HANDOFF_PROMPT.md`, replace:

```md
- Planned ChatGPT Images support is scoped in docs/superpowers/specs/2026-06-25-chatgpt-images-provider-design.md. It is provider-aware design work, not a shipped feature until implementation and live validation land.
```

with:

```md
- Provider-aware ChatGPT Images text-to-image support lives in providerRegistry.js, chatgptImagesContent.js, providerRunLedger.js, and content.js. Reference-image ChatGPT recreate/edit is a separate follow-up slice.
```

- [ ] **Step 5: Run docs grep checks**

Run:

```bash
rg -n "Planned ChatGPT Images support|not a shipped feature" README.md HACKING.md AGENTS.md docs/AGENT_HANDOFF_PROMPT.md
```

Expected: no matches.

Run:

```bash
rg -n "ChatGPT Images|provider-aware|providerRegistry|chatgptImagesContent" README.md HACKING.md AGENTS.md docs/AGENT_HANDOFF_PROMPT.md
```

Expected: matches in all four files.

- [ ] **Step 6: Commit docs**

Run:

```bash
git add README.md HACKING.md AGENTS.md docs/AGENT_HANDOFF_PROMPT.md
git commit -m "docs: document chatgpt images provider support"
```

## Task 8: Full Local Validation

**Files:**
- No file changes unless validation exposes a failing test that points to a specific earlier task.

- [ ] **Step 1: Run focused unit tests**

Run:

```bash
npm run test:unit -- tests/unit/providerRegistry.test.js tests/unit/chatgptImagesContent.test.js tests/unit/providerRunLedger.test.js tests/unit/manifestProviderCoverage.test.js tests/unit/providerOverlay.test.js
```

Expected: PASS.

- [ ] **Step 2: Run full unit suite**

Run:

```bash
npm run test:unit
```

Expected: PASS.

- [ ] **Step 3: Run extension E2E suite**

Run:

```bash
npm run test:e2e
```

Expected: PASS.

- [ ] **Step 4: Run lint**

Run:

```bash
npm run lint
```

Expected: PASS.

- [ ] **Step 5: Commit validation-only fixes if any were needed**

If validation required code or docs changes, run:

```bash
git add providerRegistry.js chatgptImagesContent.js providerRunLedger.js content.js manifest.json tests README.md HACKING.md AGENTS.md docs/AGENT_HANDOFF_PROMPT.md
git commit -m "fix: harden chatgpt images provider support"
```

Expected: commit only when files changed. If no files changed, skip this step and record the clean validation commands in the final handoff.

## Task 9: Live Chrome Validation

**Files:**
- Modify only if live validation reveals a bug in the implemented selectors or UI state.

- [ ] **Step 1: Reload the unpacked extension**

Manual/live action:

1. Open `chrome://extensions/`.
2. Reload `Grok Power Tools`.
3. Refresh any open `grok.com` or `chatgpt.com/images` tabs.

Expected: no extension error card remains after reload.

- [ ] **Step 2: Run ChatGPT Images canary**

Manual/live action on `https://chatgpt.com/images/`:

1. Confirm the overlay appears.
2. Confirm `Provider: ChatGPT Images`.
3. Confirm `Create Image` is visible.
4. Confirm `Recreate Media`, `Grok Search`, `Auto-Retry`, `Template Batch`, `Quality Repeat`, and `Gallery Download` are hidden.
5. Enter this prompt in the overlay:

```text
a small blue glass lighthouse on a white table, simple studio lighting, square image, canary marker GPT-IMG-PROVIDER-001
```

6. Click `Generate Image`.
7. Wait for a new visible image result.
8. Confirm the overlay status becomes `Generated image ready`.
9. Confirm `providerRunHistory` in `chrome.storage.local` has a newest entry with `providerId: "chatgpt-images"`, `workflow: "text-to-image"`, and the canary prompt text.

Expected: success is based on a generated current-run image, not only a submitted prompt.

- [ ] **Step 3: Pause if ChatGPT requires account action or quota use beyond the canary**

Pause and ask the user if any of these appear:

- Login prompt
- CAPTCHA
- Upgrade prompt
- Rate limit
- Moderation blocker
- A second generation request would consume meaningful quota after the canary already proved the flow

Expected: do not keep generating images to chase quality in this V1 validation pass.

- [ ] **Step 4: Run Grok smoke check**

Manual/live action on `https://grok.com/imagine`:

1. Confirm the overlay appears.
2. Confirm `Provider: Grok Imagine`.
3. Confirm `Recreate Media` and Grok-only controls are visible.
4. Do not start a Grok generation unless a selector regression is suspected.

Expected: existing Grok overlay surface still renders.

- [ ] **Step 5: Commit live-validation fixes if any were needed**

If live validation required code changes, run:

```bash
npm run test:unit -- tests/unit/chatgptImagesContent.test.js tests/unit/providerOverlay.test.js
npm run test:e2e
npm run lint
git add providerRegistry.js chatgptImagesContent.js providerRunLedger.js content.js manifest.json tests README.md HACKING.md AGENTS.md docs/AGENT_HANDOFF_PROMPT.md
git commit -m "fix: align chatgpt images live selectors"
```

Expected: PASS for all commands before commit.

## Task 10: Final Branch Handoff

**Files:**
- No file changes unless final checks expose an issue.

- [ ] **Step 1: Check branch state**

Run:

```bash
git status --short --branch
```

Expected: clean working tree on the feature branch.

- [ ] **Step 2: Review commit stack**

Run:

```bash
git log --oneline --decorate origin/main..HEAD
```

Expected: small commits matching the task boundaries in this plan.

- [ ] **Step 3: Push feature branch**

Run:

```bash
git push -u origin HEAD
```

Expected: branch pushed. Do not push to `main`.

- [ ] **Step 4: Create PR**

Run:

```bash
gh pr create --title "feat: add chatgpt images provider support" --body "This PR adds provider-aware ChatGPT Images text-to-image support while preserving the existing Grok Imagine workflows. It adds provider detection, ChatGPT Images DOM helpers, provider run history, mocked unit and E2E coverage, and docs for the new provider split."
```

Expected: PR created from the feature branch.

- [ ] **Step 5: Open PR URL in the default browser**

Run:

```bash
gh pr view --web
```

Expected: the PR opens in Chrome.

## Self-Review Notes

Spec coverage:

- Provider detection and capability flags: Tasks 1, 4, 5, 6.
- ChatGPT Images text-to-image workflow: Tasks 2, 5, 6, 9.
- Result detection with pre-submit snapshot: Task 2 and Task 6.
- Provider run history: Task 3 and Task 5.
- Manifest injection: Task 4.
- TDD-first implementation: every production task begins with a failing test.
- Live validation: Task 9.
- Docs updates: Task 7.
- Pause criteria: Task 9.

Known non-goals preserved:

- No ChatGPT reference-image recreate/edit.
- No ChatGPT video support.
- No ChatGPT MAIN-world bridge.
- No API-backed OpenAI image generation path.
- No broad rewrite or build step.
