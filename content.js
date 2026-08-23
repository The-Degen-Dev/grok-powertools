// Grok Power Tools - Content Script
(function () {

const ProviderRegistry = (typeof globalThis !== 'undefined' && globalThis.GrokPowerToolsProviderRegistry)
    ? globalThis.GrokPowerToolsProviderRegistry
    : (typeof require === 'function' ? require('./providerRegistry.js') : null);
const ChatGPTImagesActions = (typeof globalThis !== 'undefined' && globalThis.ChatGPTImagesContentActions)
    ? globalThis.ChatGPTImagesContentActions
    : (typeof require === 'function' ? require('./chatgptImagesContent.js') : null);
const ProviderRunLedger = (typeof globalThis !== 'undefined' && globalThis.GrokPowerToolsProviderRunLedger)
    ? globalThis.GrokPowerToolsProviderRunLedger
    : (typeof require === 'function' ? require('./providerRunLedger.js') : null);
const GrokImagineAdapter = (typeof globalThis !== 'undefined' && globalThis.GrokPowerToolsGrokImagineAdapter)
    ? globalThis.GrokPowerToolsGrokImagineAdapter
    : (typeof require === 'function' ? require('./grokImagineAdapter.js') : null);

function detectCurrentProvider(value) {
    if (ProviderRegistry && typeof ProviderRegistry.detectProvider === 'function') {
        return ProviderRegistry.detectProvider(value || (typeof location !== 'undefined' ? location.href : ''));
    }

    return {
        id: 'grok-imagine',
        label: 'Grok Imagine',
        capabilities: {
            canRunTextPrompt: true,
            canUseReferenceImage: true,
            canUseReferenceVideo: true,
            canUseProviderSearch: true,
            canUseCurrentProviderMedia: true,
            canRunBatch: true,
            canRunVideoGoals: true,
            canCaptureGeneratedImages: true,
            canDownloadGeneratedImages: true
        }
    };
}

function isGrokProvider(provider) {
    return provider && provider.id === 'grok-imagine';
}

function isChatGptImagesProvider(provider) {
    return provider && provider.id === 'chatgpt-images';
}

function isUsableGrokComposer(element) {
    if (!element || !element.isConnected || element.closest('#grok-powertools-overlay')) return false;
    if (element.disabled || element.readOnly || element.getAttribute('aria-disabled') === 'true') return false;
    const style = window.getComputedStyle ? window.getComputedStyle(element) : null;
    if (style && (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity || 1) <= 0)) {
        return false;
    }
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    if (rect.bottom <= 0 || rect.right <= 0 || rect.top >= window.innerHeight || rect.left >= window.innerWidth) return false;
    if (element instanceof HTMLTextAreaElement) return true;
    const editable = String(element.getAttribute('contenteditable') || element.contentEditable || '').toLowerCase();
    return editable === 'true' || editable === 'plaintext-only' || element.isContentEditable;
}

function getGrokComposerCandidates(root = document) {
    return Array.from(root.querySelectorAll(
        'textarea[aria-required="true"], textarea[aria-label], textarea[placeholder], '
        + '[contenteditable="true"][role="textbox"], [contenteditable="plaintext-only"][role="textbox"]'
    )).filter(isUsableGrokComposer);
}

function getGrokComposerContractText(element) {
    return [
        element.getAttribute('aria-label'),
        element.getAttribute('placeholder'),
        element.getAttribute('data-placeholder')
    ].filter(Boolean).join(' ');
}

function resolveVisibleGrokComposer(triggerElement = null) {
    const candidates = getGrokComposerCandidates();
    if (!candidates.length) return null;
    const triggerRoot = triggerElement?.closest?.('.query-bar, form, [role="dialog"], aside[aria-label="Post details"]');
    const activeElement = document.activeElement;
    const scored = candidates.map((element, index) => {
        let score = 0;
        if (element === activeElement) score += 100;
        if (triggerRoot && triggerRoot.contains(element)) score += 80;
        if (element.closest('.query-bar')) score += 20;
        if (/ask\s+grok|message\s+grok|prompt/i.test(getGrokComposerContractText(element))) score += 10;
        if (element instanceof HTMLTextAreaElement && element.getAttribute('aria-required') === 'true') score += 5;
        return { element, index, score };
    }).sort((left, right) => right.score - left.score || left.index - right.index);
    if (scored.length > 1 && scored[0].score === scored[1].score) return null;
    return scored[0].element;
}

function markGrokComposerForBridge(composer) {
    if (!composer) return { marker: '', release: () => {} };
    const marker = `gpt_prompt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    composer.setAttribute('data-gpt-prompt-target', marker);
    return {
        marker,
        release: () => {
            if (composer.getAttribute('data-gpt-prompt-target') === marker) {
                composer.removeAttribute('data-gpt-prompt-target');
            }
        }
    };
}

const EXTENSION_CONTEXT_REFRESHED_MESSAGE = 'Grok Power Tools reloaded. Refresh this Grok tab before continuing.';
const SCRAPE_RUN_STATE_WRITE_TIMEOUT_MS = 1000;
const SCRAPE_CRITICAL_RUN_STATE_WRITE_TIMEOUT_MS = 3000;
const MAX_SYNC_ENTRY_LIMIT = 100;
const GENERATION_MUTATING_WORKFLOW_KINDS = new Set(['quick_batch', 'prompted_batch', 'video_goal']);
const MUTATING_WORKFLOW_LABELS = {
    sync: 'Sync',
    r2_backup: 'R2 Backup',
    quick_batch: 'Quick Batch',
    prompted_batch: 'Prompted Batch',
    video_goal: 'Video Goal',
    recreate: 'Recreate',
    template_batch: 'Template Batch',
    quality_repeat: 'Quality Repeat',
    authority_conflict: 'workflow authority conflict'
};
const ownedPageWorkflowAuthorities = new Map();

function getMutatingWorkflowLabel(kind) {
    return MUTATING_WORKFLOW_LABELS[kind] || 'another workflow';
}

async function startOwnedPageWorkflow(kind, counts = null) {
    const result = await safeChromeRuntimeSendMessage({
        action: 'PAGE_WORKFLOW_START',
        kind,
        counts
    }, `start ${kind}`);
    if (result.invalidated) return { status: 'invalidated', authority: null };
    const workflow = result.value?.activeWorkflow;
    const response = {
        status: result.value?.status || 'rejected',
        error: result.value?.error || '',
        activeWorkflow: workflow || null,
        authority: result.value?.status === 'started' && workflow?.authority
            ? { ...workflow.authority }
            : null
    };
    if (response.authority) {
        ownedPageWorkflowAuthorities.set(response.authority.runId, response.authority);
    }
    return response;
}

async function updateOwnedPageWorkflow(authority, counts = null) {
    if (!authority) return false;
    const result = await safeChromeRuntimeSendMessage({
        action: 'PAGE_WORKFLOW_UPDATE',
        ...authority,
        counts
    }, `update ${authority.kind}`);
    return !result.invalidated && result.value?.status === 'updated';
}

async function finishOwnedPageWorkflow(authority, action = 'PAGE_WORKFLOW_COMPLETE') {
    if (!authority) return false;
    const result = await safeChromeRuntimeSendMessage({
        action,
        ...authority
    }, `finish ${authority.kind}`);
    const finished = !result.invalidated
        && (result.value?.status === 'completed' || result.value?.status === 'stopped');
    if (finished || result.value?.reason === 'stale_authority') {
        ownedPageWorkflowAuthorities.delete(authority.runId);
    }
    return finished;
}

function startOwnedPageWorkflowHeartbeat(authority, getCounts, onAuthorityLost) {
    if (!authority) return () => {};
    let stopped = false;
    let inFlight = false;
    const beat = async () => {
        if (stopped || inFlight) return;
        inFlight = true;
        try {
            const current = ownedPageWorkflowAuthorities.get(authority.runId);
            if (!current) {
                stopped = true;
                return;
            }
            const counts = typeof getCounts === 'function' ? getCounts() : null;
            const updated = await updateOwnedPageWorkflow(authority, counts);
            if (!updated) {
                stopped = true;
                ownedPageWorkflowAuthorities.delete(authority.runId);
                onAuthorityLost?.();
            }
        } finally {
            inFlight = false;
        }
    };
    const timer = setInterval(beat, 10000);
    return () => {
        stopped = true;
        clearInterval(timer);
    };
}

const pageWorkflowPingListenerKey = '__gptPowerToolsPageWorkflowPingListenerInstalled';
if (typeof module !== 'undefined' || !globalThis[pageWorkflowPingListenerKey]) {
    const installed = safeChromeAddListener(() => chrome.runtime.onMessage, (request, _sender, sendResponse) => {
        if (request?.action !== 'PAGE_WORKFLOW_PING') return false;
        const authority = ownedPageWorkflowAuthorities.get(String(request.runId || ''));
        const alive = Boolean(
            authority
            && authority.kind === request.kind
            && authority.runId === request.runId
            && authority.epoch === request.epoch
        );
        sendResponse({
            alive,
            runId: alive ? authority.runId : '',
            epoch: alive ? authority.epoch : null
        });
        return false;
    }, 'listen for page workflow heartbeat probes');
    if (typeof module === 'undefined' && installed.ok) {
        globalThis[pageWorkflowPingListenerKey] = true;
    }
}

async function mutatePromptHistoryStorage(operation, payload = {}) {
    const result = await safeChromeRuntimeSendMessage({
        action: 'PROMPT_HISTORY_MUTATE',
        operation,
        ...payload
    }, `${operation} prompt history`);
    if (result.invalidated) return { ok: false, invalidated: true, promptHistory: [] };
    return {
        ok: result.value?.status === 'ok',
        invalidated: false,
        error: result.value?.error || '',
        promptHistory: Array.isArray(result.value?.promptHistory) ? result.value.promptHistory : []
    };
}

async function mutateSavedPromptsStorage(operation, payload = {}) {
    const result = await safeChromeRuntimeSendMessage({
        action: 'SAVED_PROMPTS_MUTATE',
        operation,
        ...payload
    }, `${operation} saved prompts`);
    if (result.invalidated) return { ok: false, invalidated: true, savedPrompts: [] };
    return {
        ok: result.value?.status === 'ok',
        invalidated: false,
        error: result.value?.error || '',
        savedPrompts: Array.isArray(result.value?.savedPrompts) ? result.value.savedPrompts : []
    };
}
const extensionContextState = {
    invalidated: false,
    messageShown: false,
    handlers: new Set()
};

function isExtensionContextActive() {
    if (extensionContextState.invalidated) return false;
    if (typeof module !== 'undefined') return true;
    if (getChromeRuntime()) return true;
    latchExtensionContextInvalidated();
    return false;
}

function latchExtensionContextInvalidated() {
    if (extensionContextState.invalidated) return false;
    extensionContextState.invalidated = true;
    extensionContextState.handlers.forEach((handler) => {
        try {
            handler();
        } catch {
            // Every handler is best-effort after the extension context is gone.
        }
    });
    return true;
}

function registerExtensionContextInvalidationHandler(handler) {
    if (typeof handler !== 'function') return () => {};
    extensionContextState.handlers.add(handler);
    if (extensionContextState.invalidated) handler();
    return () => extensionContextState.handlers.delete(handler);
}

function isExtensionContextInvalidatedError(error) {
    const message = String(error && (error.message || error) || '');
    return message.includes('Extension context invalidated') || message.includes('Extension context was invalidated');
}

function getChromeRuntime() {
    try {
        if (typeof chrome === 'undefined' || !chrome.runtime) return null;
        if (Object.prototype.hasOwnProperty.call(chrome.runtime, 'id') && !chrome.runtime.id) return null;
        return chrome.runtime;
    } catch {
        return null;
    }
}

function getChromeStorageArea(areaName, methodName) {
    try {
        if (!getChromeRuntime()) return null;
        const area = chrome.storage && chrome.storage[areaName];
        if (!area || typeof area[methodName] !== 'function') return null;
        return area;
    } catch {
        return null;
    }
}

function contextInvalidatedResult(operation, value) {
    if (typeof module === 'undefined') latchExtensionContextInvalidated();
    return { ok: false, invalidated: true, operation, value };
}

async function safeChromeStorageGet(areaName, keys, fallback = {}, operation = 'load storage') {
    const area = getChromeStorageArea(areaName, 'get');
    if (!area) return contextInvalidatedResult(operation, fallback);
    try {
        return { ok: true, invalidated: false, operation, value: await area.get(keys) };
    } catch (error) {
        if (isExtensionContextInvalidatedError(error)) return contextInvalidatedResult(operation, fallback);
        throw error;
    }
}

async function safeChromeStorageSet(areaName, values, operation = 'save storage') {
    const area = getChromeStorageArea(areaName, 'set');
    if (!area) return contextInvalidatedResult(operation, undefined);
    try {
        await area.set(values);
        return { ok: true, invalidated: false, operation };
    } catch (error) {
        if (isExtensionContextInvalidatedError(error)) return contextInvalidatedResult(operation, undefined);
        throw error;
    }
}

async function safeChromeRuntimeSendMessage(message, operation = 'send message', fallback = undefined) {
    const runtime = getChromeRuntime();
    if (!runtime || typeof runtime.sendMessage !== 'function') return contextInvalidatedResult(operation, fallback);
    try {
        const mockImplementation = typeof runtime.sendMessage.getMockImplementation === 'function'
            ? runtime.sendMessage.getMockImplementation()
            : null;
        const expectsCallback = runtime.sendMessage.length >= 2 || (mockImplementation && mockImplementation.length >= 2);

        if (expectsCallback) {
            const value = await new Promise((resolve, reject) => {
                let settled = false;
                let fallbackTimer = null;
                const settle = (nextValue) => {
                    if (settled) return;
                    settled = true;
                    if (fallbackTimer) clearTimeout(fallbackTimer);
                    resolve(nextValue);
                };
                try {
                    const maybePromise = runtime.sendMessage(message, settle);
                    if (maybePromise && typeof maybePromise.then === 'function') {
                        maybePromise.then((nextValue) => {
                            if (typeof nextValue !== 'undefined') settle(nextValue);
                        }, reject);
                    }
                    const longRunningActions = new Set([
                        'START_GPT_RECREATE',
                        'R2_BACKUP_UPLOAD',
                        'DOWNLOAD_MEDIA'
                    ]);
                    const timeoutMs = longRunningActions.has(message?.action)
                        ? 30 * 60 * 1000
                        : 30 * 1000;
                    fallbackTimer = setTimeout(() => {
                        if (settled) return;
                        settled = true;
                        reject(new Error(`${message?.action || 'runtime_message'}_timeout`));
                    }, timeoutMs);
                } catch (error) {
                    reject(error);
                }
            });
            return { ok: true, invalidated: false, operation, value };
        }

        return { ok: true, invalidated: false, operation, value: await runtime.sendMessage(message) };
    } catch (error) {
        if (isExtensionContextInvalidatedError(error)) return contextInvalidatedResult(operation, fallback);
        throw error;
    }
}

function safeChromeRuntimeSendMessageSoon(message, operation = 'send message') {
    safeChromeRuntimeSendMessage(message, operation).catch(() => {});
}

function safeChromeAddListener(getTarget, listener, operation = 'add listener') {
    if (!getChromeRuntime()) return contextInvalidatedResult(operation, false);
    try {
        const target = getTarget();
        if (!target || typeof target.addListener !== 'function') return contextInvalidatedResult(operation, false);
        target.addListener(listener);
        return { ok: true, invalidated: false, operation, value: true };
    } catch (error) {
        if (isExtensionContextInvalidatedError(error)) return contextInvalidatedResult(operation, false);
        throw error;
    }
}

function safeChromeRuntimeGetURL(path) {
    const runtime = getChromeRuntime();
    if (!runtime || typeof runtime.getURL !== 'function') return null;
    try {
        return runtime.getURL(path);
    } catch (error) {
        if (isExtensionContextInvalidatedError(error)) return null;
        throw error;
    }
}

function showExtensionContextRefreshed(target) {
    if (extensionContextState.messageShown) return;
    if (target && typeof target.setStatus === 'function') {
        extensionContextState.messageShown = true;
        target.setStatus(EXTENSION_CONTEXT_REFRESHED_MESSAGE, 'error');
    }
}

// --- PAGE-WORLD BRIDGE ---
// Loads bridge.js in the page's MAIN world (bypasses CSP since it's a file, not inline).
// bridge.js provides access to TipTap editor and Grok's fetch via custom DOM events.
(function injectPageWorldBridge() {
    if (typeof module !== 'undefined') return;
    if (!isGrokProvider(detectCurrentProvider())) return;
    const bridgeRoot = document.documentElement;
    const bridgeMarker = 'data-gpt-power-tools-page-bridge-injected';
    const listenerKey = '__gptPowerToolsUploadCompleteListener';
    if (!bridgeRoot) return;
    const installUploadCompleteListener = () => {
        const existing = globalThis[listenerKey];
        if (typeof existing === 'function') return existing;
        const listener = (event) => {
            const dialog = Array.from(document.querySelectorAll('[role="dialog"]'))
                .find((candidate) => candidate.getBoundingClientRect().width > 0 && candidate.getBoundingClientRect().height > 0);
            window._lastUploadedImageReceipt = {
                imageUrl: event.detail && event.detail.imageUrl,
                capturedAt: Date.now(),
                dialog: dialog || null
            };
            console.log('GrokPowerTools: Captured uploaded image URL');
        };
        globalThis[listenerKey] = listener;
        document.addEventListener('__gpt_upload_complete', listener);
        return listener;
    };
    const removeUploadCompleteListener = (listener) => {
        document.removeEventListener('__gpt_upload_complete', listener);
        if (globalThis[listenerKey] === listener) delete globalThis[listenerKey];
    };

    if (bridgeRoot.hasAttribute(bridgeMarker)) {
        installUploadCompleteListener();
        return;
    }
    const bridgeUrl = safeChromeRuntimeGetURL('bridge.js');
    if (!bridgeUrl) return;

    const handleUploadComplete = installUploadCompleteListener();
    bridgeRoot.setAttribute(bridgeMarker, '');
    const script = document.createElement('script');
    script.src = bridgeUrl;
    script.addEventListener('load', () => {
        script.remove();
    }, { once: true });
    script.addEventListener('error', () => {
        removeUploadCompleteListener(handleUploadComplete);
        bridgeRoot.removeAttribute(bridgeMarker);
        script.remove();
    }, { once: true });
    (document.head || document.documentElement).appendChild(script);
})();

// --- CONFIGURATION DEFAULTS ---
const SettingsDefaults = {
    maxRetries: 3,
    videoGoal: 10,
    galleryBatchLimit: 10,
    autoRetryEnabled: true,
    retryCooldown: 8000,
    generationDelay: 8000,
    historyLimit: 50,
    devMode: false
};

const SAVED_PROMPT_TYPES = {
    partial: 'partial',
    full: 'full'
};
const SAVED_PROMPT_DELIMITER = ', ';

function sanitizeSavedPromptText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function sanitizeSavedPromptName(value, fallbackText = '') {
    const trimmed = String(value || '').trim();
    if (trimmed) return trimmed.slice(0, 80);
    const fallback = sanitizeSavedPromptText(fallbackText);
    return fallback ? fallback.slice(0, 40) : 'Untitled Prompt';
}

function normalizeSavedPromptType(value) {
    return value === SAVED_PROMPT_TYPES.partial ? SAVED_PROMPT_TYPES.partial : SAVED_PROMPT_TYPES.full;
}

function legacySavedPromptId(now, index) {
    return `saved_${now}_${index}`;
}

function createSavedPromptId() {
    return `saved_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
}

function normalizeSavedPrompts(raw, options = {}) {
    const now = Number.isFinite(options.now) ? options.now : Date.now();
    const input = Array.isArray(raw) ? raw : [];
    const normalized = [];

    input.forEach((entry, index) => {
        const source = (entry && typeof entry === 'object')
            ? entry
            : { text: typeof entry === 'string' ? entry : '' };

        const text = sanitizeSavedPromptText(source.text);
        if (!text) return;

        const type = normalizeSavedPromptType(source.type);
        const createdAt = Number.isFinite(source.createdAt) && source.createdAt > 0 ? source.createdAt : now;
        const updatedAt = Number.isFinite(source.updatedAt) && source.updatedAt > 0 ? source.updatedAt : createdAt;
        const id = typeof source.id === 'string' && source.id.trim() ? source.id.trim() : legacySavedPromptId(now, index);
        const name = sanitizeSavedPromptName(source.name, text);

        normalized.push({
            id,
            name,
            text,
            type,
            createdAt,
            updatedAt
        });
    });

    return normalized;
}

function filterSavedPrompts(prompts, type = SAVED_PROMPT_TYPES.partial, search = '') {
    const targetType = normalizeSavedPromptType(type);
    const query = String(search || '').trim().toLowerCase();
    const list = Array.isArray(prompts) ? prompts : [];

    return list.filter((item) => {
        if (normalizeSavedPromptType(item.type) !== targetType) return false;
        if (!query) return true;
        const haystack = `${item.name || ''} ${item.text || ''}`.toLowerCase();
        return haystack.includes(query);
    });
}

function promptContainsToken(currentText, tokenText) {
    const current = sanitizeSavedPromptText(currentText);
    const token = sanitizeSavedPromptText(tokenText);
    if (!current || !token) return false;
    const tokenLc = token.toLowerCase();
    return current
        .split(',')
        .map((part) => sanitizeSavedPromptText(part).toLowerCase())
        .filter(Boolean)
        .includes(tokenLc);
}

function mergePromptTextForAppend(currentText, snippetText, delimiter = SAVED_PROMPT_DELIMITER) {
    const current = sanitizeSavedPromptText(currentText);
    const snippet = sanitizeSavedPromptText(snippetText);
    if (!snippet) return current;
    if (!current) return snippet;
    if (promptContainsToken(current, snippet)) return current;

    const base = current.replace(/[,\s]+$/, '');
    return `${base}${delimiter}${snippet}`;
}

function appendSnippetAtCursor(currentText, snippetText, start, end, delimiter = SAVED_PROMPT_DELIMITER) {
    const text = String(currentText || '');
    const snippet = sanitizeSavedPromptText(snippetText);
    const safeStart = Number.isFinite(start) ? Math.max(0, Math.min(text.length, Math.floor(start))) : text.length;
    const safeEnd = Number.isFinite(end)
        ? Math.max(safeStart, Math.min(text.length, Math.floor(end)))
        : safeStart;

    if (!snippet) {
        return { text, caret: safeStart };
    }

    if (promptContainsToken(text, snippet)) {
        return { text, caret: safeStart };
    }

    const before = text.slice(0, safeStart).replace(/\s+$/, '');
    const after = text.slice(safeEnd).replace(/^\s+/, '');
    const needsLeftDelimiter = before.length > 0 && !/[,\n]$/.test(before);
    const needsRightDelimiter = after.length > 0 && !/^[,\n]/.test(after);
    const inserted = `${needsLeftDelimiter ? delimiter : ''}${snippet}${needsRightDelimiter ? delimiter : ''}`;
    const nextText = `${before}${inserted}${after}`;
    const caret = (before + (needsLeftDelimiter ? delimiter : '') + snippet).length;

    return { text: nextText, caret };
}

function getBackupMediaElementSrc(el) {
    if (!el) return '';
    if (el.tagName && el.tagName.toLowerCase() === 'video') {
        return el.src || el.currentSrc || el.querySelector?.('source')?.src || '';
    }
    return el.currentSrc || el.src || '';
}

const SCRAPE_SURFACES = Object.freeze({
    savedGallery: 'saved_gallery',
    agentMedia: 'agent_media',
    legacyDetail: 'legacy_detail',
    unsupported: 'unsupported'
});

function getScrapePathname(locationValue) {
    const href = typeof locationValue === 'string'
        ? locationValue
        : (locationValue && locationValue.href) || '';
    try {
        return new URL(href, 'https://grok.com').pathname;
    } catch {
        return '';
    }
}

function detectGrokScrapeSurface(_root = document, locationValue = window.location) {
    const pathname = getScrapePathname(locationValue);
    if (/^\/imagine\/agent(?:\/|$)/.test(pathname)) return SCRAPE_SURFACES.agentMedia;
    if (/^\/imagine\/post(?:\/|$)/.test(pathname)) return SCRAPE_SURFACES.legacyDetail;
    if (/^\/imagine\/saved(?:\/|$)/.test(pathname)) return SCRAPE_SURFACES.savedGallery;
    return SCRAPE_SURFACES.unsupported;
}

const SAVED_GALLERY_SCOPES = Object.freeze({
    all: 'all',
    liked: 'liked',
    unknown: 'unknown'
});

function isVisibleSavedScopeControl(control) {
    if (!control?.isConnected || control.hidden || control.getAttribute('aria-hidden') === 'true') return false;
    const style = window.getComputedStyle(control);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    const rect = control.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
}

function getSavedScopeControlSelection(control) {
    const attributeStates = [
        ['aria-selected', new Set(['true']), new Set(['false'])],
        ['aria-pressed', new Set(['true']), new Set(['false'])],
        ['data-state', new Set(['active', 'selected', 'checked', 'on']), new Set(['inactive', 'unselected', 'unchecked', 'off'])]
    ];
    const resolvedStates = [];
    for (const [attribute, selectedValues, unselectedValues] of attributeStates) {
        if (!control.hasAttribute(attribute)) continue;
        const value = String(control.getAttribute(attribute) || '').trim().toLowerCase();
        if (selectedValues.has(value)) resolvedStates.push(true);
        else if (unselectedValues.has(value)) resolvedStates.push(false);
        else return null;
    }
    if (resolvedStates.length) {
        return resolvedStates.every((state) => state === resolvedStates[0])
            ? resolvedStates[0]
            : null;
    }

    const classTokens = new Set(String(control.className || '').split(/\s+/).filter(Boolean));
    return classTokens.has('bg-primary') && classTokens.has('text-background');
}

function detectSavedGalleryScope(root = document) {
    const controls = Array.from(root.querySelectorAll('button'))
        .filter(isVisibleSavedScopeControl);
    const exactControls = (label) => controls.filter((control) => (
        String(control.textContent || '').trim().toLowerCase() === label
    ));
    const allControls = exactControls('all');
    const likedControls = exactControls('liked');
    if (allControls.length !== 1 || likedControls.length !== 1) return SAVED_GALLERY_SCOPES.unknown;

    const allSelected = getSavedScopeControlSelection(allControls[0]);
    const likedSelected = getSavedScopeControlSelection(likedControls[0]);
    if (allSelected === true && likedSelected === false) return SAVED_GALLERY_SCOPES.all;
    if (likedSelected === true && allSelected === false) return SAVED_GALLERY_SCOPES.liked;
    return SAVED_GALLERY_SCOPES.unknown;
}

function getGrokMediaIdentity(value) {
    const text = String(value ?? '').trim();
    if (!text) return '';
    const uuidPattern = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
    const bareUuid = text.match(new RegExp(`^${uuidPattern.source}$`, 'i'));
    if (bareUuid) return bareUuid[0].toLowerCase();
    try {
        const url = new URL(text, 'https://grok.com');
        const generatedSegment = url.pathname.match(/\/generated\/([^/]+)/i)?.[1] || '';
        const generatedUuid = generatedSegment.match(uuidPattern);
        if (generatedUuid) return generatedUuid[0].toLowerCase();
        const pathnameUuids = url.pathname.match(new RegExp(uuidPattern.source, 'gi'));
        if (pathnameUuids?.length) return pathnameUuids[pathnameUuids.length - 1].toLowerCase();
        return `${url.origin}${url.pathname}`;
    } catch {
        return text.split('?')[0];
    }
}

function getGrokConversationId(value) {
    try {
        const url = new URL(String(value || ''), 'https://grok.com');
        const candidate = url.searchParams.get('conversation') || url.searchParams.get('conversationId') || '';
        return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(candidate)
            ? candidate.toLowerCase()
            : '';
    } catch {
        return '';
    }
}

function normalizeSyncEntryLimit(value) {
    const limit = Number(value);
    return Number.isInteger(limit) && limit > 0 && limit <= MAX_SYNC_ENTRY_LIMIT
        ? limit
        : null;
}

function normalizeSyncEntryLimitState(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const entryLimit = normalizeSyncEntryLimit(value.entryLimit);
    if (!entryLimit) return null;
    const completedConversationIds = Array.from(new Set(
        (Array.isArray(value.completedConversationIds) ? value.completedConversationIds : [])
            .map((conversationId) => getGrokConversationId(
                `https://grok.com/?conversation=${conversationId}`
            ))
            .filter(Boolean)
    )).slice(0, entryLimit);
    const attemptedConversationIds = Array.from(new Set([
        ...completedConversationIds,
        ...(Array.isArray(value.attemptedConversationIds) ? value.attemptedConversationIds : [])
            .map((conversationId) => getGrokConversationId(
                `https://grok.com/?conversation=${conversationId}`
            ))
            .filter(Boolean)
    ])).slice(0, entryLimit);
    return {
        version: 2,
        entryLimit,
        attemptedConversationIds,
        completedConversationIds
    };
}

function getSavedCardConversationId(card) {
    if (!card) return '';
    const ownedLinks = [
        ...(card.matches?.('a[href]') ? [card] : []),
        ...Array.from(card.querySelectorAll('a[href]'))
    ];
    const conversationIds = new Set(ownedLinks
        .filter((link) => findMediaCardRoot(link) === card)
        .map((link) => getGrokConversationId(link.href))
        .filter(Boolean));
    return conversationIds.size === 1 ? Array.from(conversationIds)[0] : '';
}

function findMatchingAgentMedia(root = document, expectedIdentity = '') {
    const normalizedExpected = getGrokMediaIdentity(expectedIdentity);
    if (!normalizedExpected) return { status: 'missing', media: null, sourceUrl: '' };

    const matchingNodes = Array.from(root.querySelectorAll('.react-flow__node-asset'))
        .map((node) => {
            const candidates = Array.from(node.querySelectorAll('video, img'))
                .map((media) => ({ media, sourceUrl: getBackupMediaElementSrc(media) }))
                .filter((candidate) => candidate.sourceUrl && getGrokMediaIdentity(candidate.sourceUrl) === normalizedExpected);
            const preferred = candidates.find((candidate) => candidate.media.tagName?.toLowerCase() === 'video') || candidates[0];
            return preferred ? {
                ...preferred,
                assetNode: node,
                assetNodeId: String(node.getAttribute('data-id') || '').trim()
            } : null;
        })
        .filter(Boolean);

    if (matchingNodes.length === 1) return { status: 'matched', ...matchingNodes[0] };
    if (matchingNodes.length > 1) return { status: 'ambiguous', media: null, sourceUrl: '' };
    return { status: 'missing', media: null, sourceUrl: '' };
}

function isGrokGeneratedCardImage(image) {
    const sourceUrl = String(image?.currentSrc || image?.src || image?.getAttribute?.('src') || '');
    if (!sourceUrl) return false;
    const alt = String(image.getAttribute?.('alt') || '').trim();
    if (!alt && /^data:image\/(?:jpeg|jpg|png|webp);base64,/i.test(sourceUrl)) return true;
    try {
        const url = new URL(sourceUrl, 'https://grok.com');
        const hasMediaIdentity = !!getGrokMediaIdentity(url.pathname);
        if (url.hostname === 'assets.grok.com'
            && url.pathname.includes('/generated/')
            && hasMediaIdentity) {
            return true;
        }
        if (url.hostname === 'imagine-public.x.ai'
            && /\/(?:images|share-images)\//i.test(url.pathname)
            && hasMediaIdentity) {
            return true;
        }
    } catch {
        // The provider can briefly expose data URLs before the public result URL is ready.
    }
    return alt === 'Generated image';
}

function getGrokGeneratedCardImages(root = document) {
    return Array.from(root?.querySelectorAll?.('img') || []).filter(isGrokGeneratedCardImage);
}

function findMediaCardRoot(element) {
    const masonryCard = element?.closest?.('[class*="media-post-masonry-card"]');
    if (getGrokGeneratedCardImages(masonryCard).length > 0) return masonryCard;
    const listItem = element?.closest?.('[role="listitem"]');
    if (getGrokGeneratedCardImages(listItem).length > 0) return listItem;
    return masonryCard || null;
}

function getSavedCardIdentity(card, fallbackIdentity = '') {
    if (!card) return getGrokMediaIdentity(fallbackIdentity);
    const ownedPostLinks = [
        ...(card.matches?.('a[href*="/imagine/post/"]') ? [card] : []),
        ...Array.from(card.querySelectorAll('a[href*="/imagine/post/"]'))
    ];
    const postIdentities = new Set(ownedPostLinks
        .filter((link) => findMediaCardRoot(link) === card)
        .map((link) => getGrokMediaIdentity(link.href))
        .filter(Boolean));
    if (postIdentities.size === 1) return Array.from(postIdentities)[0];
    if (postIdentities.size > 1) return '';
    return getGrokMediaIdentity(fallbackIdentity);
}

function dispatchFullPointerClick(element) {
    if (!element?.dispatchEvent) return false;
    const rect = element.getBoundingClientRect();
    const clientX = rect.x + rect.width / 2;
    const clientY = rect.y + rect.height / 2;
    const baseOptions = {
        bubbles: true,
        cancelable: true,
        view: window,
        button: 0,
        clientX,
        clientY
    };
    const PointerEventConstructor = typeof PointerEvent === 'function' ? PointerEvent : MouseEvent;

    element.dispatchEvent(new PointerEventConstructor('pointerdown', {
        ...baseOptions,
        buttons: 1,
        pointerId: 1,
        pointerType: 'mouse',
        isPrimary: true
    }));
    element.dispatchEvent(new MouseEvent('mousedown', { ...baseOptions, buttons: 1 }));
    element.dispatchEvent(new PointerEventConstructor('pointerup', {
        ...baseOptions,
        buttons: 0,
        pointerId: 1,
        pointerType: 'mouse',
        isPrimary: true
    }));
    element.dispatchEvent(new MouseEvent('mouseup', { ...baseOptions, buttons: 0 }));
    element.dispatchEvent(new MouseEvent('click', { ...baseOptions, buttons: 0 }));
    return true;
}

const GALLERY_RECEIPT_VERSION = 3;

function captureGalleryReceipt({ identities, sourceIdentity, origin, scrollTop = 0 }) {
    const normalized = identities.map(getGrokMediaIdentity).filter(Boolean);
    const source = getGrokMediaIdentity(sourceIdentity);
    const sourceIndexes = normalized.flatMap((value, index) => value === source ? [index] : []);
    if (!source || sourceIndexes.length !== 1) return null;
    const index = sourceIndexes[0];
    return {
        version: GALLERY_RECEIPT_VERSION,
        sourceIdentity: source,
        expectedNextIdentity: normalized[index + 1] || null,
        beforeIdentities: normalized.slice(Math.max(0, index - 2), index),
        afterIdentities: normalized.slice(index + 1, index + 3),
        visibleIdentities: normalized.slice(0, 16),
        origin: {
            pathname: String(origin?.pathname || ''),
            conversationId: String(origin?.conversationId || ''),
            scope: String(origin?.scope || '')
        },
        scrollTop: Math.max(0, Number(scrollTop) || 0)
    };
}

function evaluateGalleryReceipt({
    identities,
    receipt,
    currentOrigin,
    allowSourceReplacement = false
} = {}) {
    if (receipt?.version !== GALLERY_RECEIPT_VERSION) {
        return { status: 'different', reason: 'receipt_version' };
    }
    if (!receipt.origin
        || !Array.isArray(receipt.beforeIdentities)
        || !Array.isArray(receipt.afterIdentities)
        || !Array.isArray(receipt.visibleIdentities)) {
        return { status: 'different', reason: 'invalid_receipt' };
    }

    const sourceIdentity = getGrokMediaIdentity(receipt.sourceIdentity);
    const expectedNextIdentity = getGrokMediaIdentity(receipt.expectedNextIdentity) || null;
    const beforeIdentities = receipt.beforeIdentities.map(getGrokMediaIdentity).filter(Boolean);
    const afterIdentities = receipt.afterIdentities.map(getGrokMediaIdentity).filter(Boolean);
    if (!sourceIdentity) return { status: 'different', reason: 'invalid_receipt' };

    const capturedOrigin = {
        pathname: String(receipt.origin.pathname || ''),
        conversationId: String(receipt.origin.conversationId || ''),
        scope: String(receipt.origin.scope || '')
    };
    const normalizedCurrentOrigin = {
        pathname: String(currentOrigin?.pathname || ''),
        conversationId: String(currentOrigin?.conversationId || ''),
        scope: String(currentOrigin?.scope || '')
    };
    if (normalizedCurrentOrigin.pathname !== capturedOrigin.pathname
        || normalizedCurrentOrigin.scope !== capturedOrigin.scope
        || (capturedOrigin.conversationId
            && normalizedCurrentOrigin.conversationId !== capturedOrigin.conversationId)) {
        return { status: 'different', reason: 'origin_mismatch' };
    }

    const anchors = [...beforeIdentities, ...afterIdentities];
    const capturedIdentities = [sourceIdentity, ...anchors];
    if (new Set(capturedIdentities).size !== capturedIdentities.length) {
        return { status: 'ambiguous', reason: 'duplicate_identity' };
    }
    if (expectedNextIdentity !== (afterIdentities[0] || null)) {
        return { status: 'different', reason: 'invalid_receipt' };
    }

    const normalized = (Array.isArray(identities) ? identities : [])
        .map(getGrokMediaIdentity)
        .filter(Boolean);
    const relevantIdentities = new Set(capturedIdentities);
    const counts = new Map();
    for (const identity of normalized) {
        if (relevantIdentities.has(identity)) {
            counts.set(identity, (counts.get(identity) || 0) + 1);
        }
    }
    if (Array.from(counts.values()).some((count) => count > 1)) {
        return { status: 'ambiguous', reason: 'duplicate_identity' };
    }

    const sourceIndex = normalized.indexOf(sourceIdentity);
    if (sourceIndex >= 0) {
        if (expectedNextIdentity && normalized[sourceIndex + 1] !== expectedNextIdentity) {
            return { status: 'different', reason: 'expected_next_mismatch' };
        }
        const capturedOrder = [...beforeIdentities, sourceIdentity, ...afterIdentities];
        const currentCapturedOrder = normalized.filter((identity) => relevantIdentities.has(identity));
        let previousIndex = -1;
        for (const identity of currentCapturedOrder) {
            const capturedIndex = capturedOrder.indexOf(identity);
            if (capturedIndex <= previousIndex) {
                return { status: 'different', reason: 'anchor_order_mismatch' };
            }
            previousIndex = capturedIndex;
        }
        return { status: 'matched', reason: 'source_identity' };
    }

    if (!allowSourceReplacement) return { status: 'different', reason: 'source_missing' };
    const currentAnchors = normalized.filter((identity) => anchors.includes(identity));
    if (currentAnchors.length < 2) {
        return { status: 'ambiguous', reason: 'insufficient_stable_anchors' };
    }
    let previousAnchorIndex = -1;
    for (const identity of currentAnchors) {
        const anchorIndex = anchors.indexOf(identity);
        if (anchorIndex <= previousAnchorIndex) {
            return { status: 'ambiguous', reason: 'anchor_order_mismatch' };
        }
        previousAnchorIndex = anchorIndex;
    }
    return { status: 'matched', reason: 'source_replaced_with_stable_anchors' };
}

function getSavedGalleryEntries(root = document) {
    if (GrokImagineAdapter?.listGalleryItems && GrokImagineAdapter?.resolveGalleryItem) {
        const listed = GrokImagineAdapter.listGalleryItems({
            root,
            surface: 'saved_gallery'
        });
        if (listed.status !== 'ok') return [];
        return listed.items.map((descriptor) => {
            const resolved = GrokImagineAdapter.resolveGalleryItem({
                root,
                descriptor
            });
            if (resolved.status !== 'matched') return null;
            const mediaCandidates = Array.from(resolved.card.querySelectorAll('video, img'))
                .filter((media) => (
                    findMediaCardRoot(media) === resolved.card
                    && getGrokMediaIdentity(getBackupMediaElementSrc(media))
                        === descriptor.sourceAssetId
                ));
            const preferredTag = descriptor.mediaKind === 'video' ? 'video' : 'img';
            const media = mediaCandidates.find((candidate) => (
                candidate.tagName?.toLowerCase() === preferredTag
            )) || mediaCandidates[0];
            const sourceUrl = getBackupMediaElementSrc(media);
            return media && sourceUrl ? {
                card: resolved.card,
                image: media,
                sourceUrl,
                sourceIdentity: descriptor.sourceAssetId,
                cardIdentity: descriptor.sourcePostId,
                conversationId: descriptor.conversationId
                    || getSavedCardConversationId(resolved.card),
                mediaKind: descriptor.mediaKind,
                descriptor
            } : null;
        }).filter(Boolean);
    }
    return getGrokGeneratedCardImages(root)
        .map((image) => {
            const card = findMediaCardRoot(image);
            const sourceUrl = image.currentSrc || image.src || '';
            const sourceIdentity = getGrokMediaIdentity(sourceUrl);
            return card && sourceUrl ? {
                card,
                image,
                sourceUrl,
                sourceIdentity,
                cardIdentity: getSavedCardIdentity(card, sourceIdentity)
            } : null;
        })
        .filter((entry) => entry?.sourceIdentity && entry?.cardIdentity);
}

const GROK_CURRENT_SOURCE_HINT_SESSION_KEY = 'gptCurrentGrokSourceHint';

function captureCurrentGrokSourceHint(event) {
    if (!GrokImagineAdapter?.listGalleryItems || !GrokImagineAdapter?.resolveGalleryItem) return;
    const surface = GrokImagineAdapter.detectGrokSurface({
        root: document,
        location: window.location
    });
    if (surface !== 'saved_gallery' && surface !== 'results_gallery') return;
    const target = event?.target;
    if (!target || typeof target.closest !== 'function') return;
    const listed = GrokImagineAdapter.listGalleryItems({
        root: document,
        surface
    });
    if (listed.status !== 'ok') return;
    const matches = listed.items.filter((descriptor) => {
        const resolved = GrokImagineAdapter.resolveGalleryItem({ root: document, descriptor });
        return resolved.status === 'matched' && resolved.card.contains(target);
    });
    if (matches.length !== 1) return;
    const descriptor = matches[0];
    try {
        window.sessionStorage.setItem(GROK_CURRENT_SOURCE_HINT_SESSION_KEY, JSON.stringify({
            sourceAssetId: descriptor.sourceAssetId,
            sourcePostId: descriptor.sourcePostId,
            conversationId: descriptor.conversationId || '',
            capturedAt: Date.now()
        }));
    } catch { }
}

function getCurrentGrokSourcePostIdHint() {
    let hint;
    try {
        hint = JSON.parse(window.sessionStorage.getItem(GROK_CURRENT_SOURCE_HINT_SESSION_KEY) || 'null');
    } catch {
        return '';
    }
    const sourceAssetId = getGrokMediaIdentity(hint?.sourceAssetId);
    const sourcePostId = getGrokMediaIdentity(hint?.sourcePostId);
    const currentConversationId = getGrokConversationId(window.location.href);
    if (!sourceAssetId || !sourcePostId) return '';
    if (hint.conversationId && currentConversationId && hint.conversationId !== currentConversationId) return '';
    const selectedNodes = Array.from(document.querySelectorAll('.react-flow__node-asset'))
        .filter((node) => (
            node.classList.contains('selected')
            || node.getAttribute('aria-selected') === 'true'
            || node.getAttribute('data-state') === 'selected'
        ));
    if (selectedNodes.length !== 1) return '';
    const selectedAssetIds = new Set(Array.from(selectedNodes[0].querySelectorAll('img, video'))
        .map((media) => getGrokMediaIdentity(getBackupMediaElementSrc(media)))
        .filter(Boolean));
    return selectedAssetIds.size === 1 && selectedAssetIds.has(sourceAssetId)
        ? sourcePostId
        : '';
}

function setupCurrentGrokSourceHintCapture() {
    document.addEventListener('pointerdown', captureCurrentGrokSourceHint, true);
}

function getSavedGalleryEntryMediaType(entry) {
    const card = entry?.card;
    if (!card) return null;
    const explicitType = String(
        card.getAttribute('data-media-type')
        || card.querySelector('[data-media-type]')?.getAttribute('data-media-type')
        || ''
    ).trim().toLowerCase();
    if (explicitType === 'image' || explicitType === 'video') return explicitType;
    if (card.querySelector('video')) return 'video';

    const labels = Array.from(card.querySelectorAll('[aria-label]'))
        .map((element) => String(element.getAttribute('aria-label') || '').trim().toLowerCase());
    if (labels.some((label) => label === 'play' || label.includes('play video'))) return 'video';
    if (labels.some((label) => label === 'make video' || label.startsWith('make video '))) return 'image';

    const sourceUrl = String(entry.sourceUrl || '').split('?')[0].toLowerCase();
    if (/\.(?:mp4|webm)$/.test(sourceUrl)) return 'video';
    return null;
}

function getSavedGalleryList(entries) {
    const listCounts = new Map();
    for (const entry of entries) {
        const list = entry.card.closest('[role="list"]');
        if (list) listCounts.set(list, (listCounts.get(list) || 0) + 1);
    }
    if (listCounts.size) {
        return listCounts.size === 1 ? Array.from(listCounts.keys())[0] : null;
    }

    const parents = new Set(entries.map((entry) => entry.card.parentElement).filter(Boolean));
    return parents.size === 1 ? Array.from(parents)[0] : null;
}

function hasOrderedSavedNeighborhood(entries, receipt) {
    return evaluateGalleryReceipt({
        identities: entries.map((entry) => (
            receipt?.identityKind === 'saved_post'
                ? entry?.cardIdentity
                : entry?.sourceIdentity
        )),
        receipt,
        currentOrigin: {
            pathname: window.location.pathname,
            conversationId: new URLSearchParams(window.location.search).get('conversation') || '',
            scope: detectSavedGalleryScope(document)
        },
        allowSourceReplacement: false
    }).status === 'matched';
}

function isSavedGalleryScrollableElement(element) {
    if (!element || element === document.body || element === document.documentElement) return false;
    const className = String(element.className || '');
    const style = window.getComputedStyle(element);
    const declaresOverflow = /(?:^|\s)overflow-(?:auto|scroll)(?:\s|$)/.test(className)
        || /^(?:auto|scroll|overlay)$/.test(style.overflowY)
        || /^(?:auto|scroll|overlay)$/.test(style.overflow);
    const hasScrollableRange = Number(element.scrollHeight || 0) > Number(element.clientHeight || 0) + 1;
    return declaresOverflow && hasScrollableRange;
}

function getSavedGalleryScroller(list) {
    for (let candidate = list; candidate && candidate !== document.body; candidate = candidate.parentElement) {
        if (isSavedGalleryScrollableElement(candidate)) return candidate;
    }
    return window;
}

function getSavedGalleryContext(root = document) {
    const entries = getSavedGalleryEntries(root);
    if (!entries.length) return null;
    const list = getSavedGalleryList(entries);
    if (!list) return null;
    const scroller = getSavedGalleryScroller(list);
    return {
        entries: entries.filter((entry) => list.contains(entry.card)),
        list,
        scroller,
        savedSurfaceRoot: scroller === window ? list : scroller
    };
}

function getSavedScrollerSnapshot(scroller) {
    if (scroller === window) {
        return {
            scrollTop: Math.round(window.scrollY || document.documentElement.scrollTop || 0),
            scrollHeight: document.documentElement.scrollHeight || 0,
            clientHeight: document.documentElement.clientHeight || window.innerHeight || 0
        };
    }
    return {
        scrollTop: Math.round(scroller.scrollTop || 0),
        scrollHeight: scroller.scrollHeight || 0,
        clientHeight: scroller.clientHeight || 0
    };
}

function setSavedGalleryScrollTop(scroller, scrollTop) {
    const target = Math.max(0, Number(scrollTop) || 0);
    if (scroller === window) {
        window.scrollTo(0, target);
        return true;
    }
    scroller.scrollTop = target;
    scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
    return Math.abs(Number(scroller.scrollTop || 0) - target) <= 2;
}

function captureSavedViewportReceipt({
    root = document,
    sourceIdentity,
    expectedNextIdentity = null,
    fallbackScroller = window
} = {}) {
    const normalizedSource = getGrokMediaIdentity(sourceIdentity);
    if (!normalizedSource) return null;
    const scope = detectSavedGalleryScope(document);
    if (scope !== SAVED_GALLERY_SCOPES.all) return null;
    const context = getSavedGalleryContext(root);
    if (!context) return null;
    const sourceIndices = context.entries
        .map((entry, index) => entry.cardIdentity === normalizedSource ? index : -1)
        .filter((index) => index >= 0);
    if (sourceIndices.length !== 1) return null;
    const derivedNextIdentity = context.entries[sourceIndices[0] + 1]?.cardIdentity || null;
    const requestedNextIdentity = getGrokMediaIdentity(expectedNextIdentity) || null;
    if (requestedNextIdentity && requestedNextIdentity !== derivedNextIdentity) return null;
    const captured = captureGalleryReceipt({
        identities: context.entries.map((entry) => entry.cardIdentity),
        sourceIdentity: normalizedSource,
        origin: {
            pathname: window.location.pathname,
            conversationId: new URLSearchParams(window.location.search).get('conversation') || '',
            scope
        },
        scrollTop: getSavedScrollerSnapshot(context.scroller || fallbackScroller).scrollTop
    });
    const receipt = captured ? { ...captured, identityKind: 'saved_post' } : null;
    return hasOrderedSavedNeighborhood(context.entries, receipt) ? receipt : null;
}

function normalizeSavedViewportReceipt(value = {}) {
    const receipt = value.savedViewportReceipt || value.viewportReceipt || value;
    if (receipt.version !== GALLERY_RECEIPT_VERSION
        || !receipt.origin
        || !Array.isArray(receipt.beforeIdentities)
        || !Array.isArray(receipt.afterIdentities)
        || !Array.isArray(receipt.visibleIdentities)) return null;
    const sourceIdentity = getGrokMediaIdentity(
        receipt.sourceIdentity || value.expectedIdentity || value.sourceId || value.currentItemId
    );
    if (!sourceIdentity) return null;
    return {
        version: GALLERY_RECEIPT_VERSION,
        identityKind: receipt.identityKind === 'saved_post' ? 'saved_post' : 'media',
        sourceIdentity,
        expectedNextIdentity: getGrokMediaIdentity(receipt.expectedNextIdentity) || null,
        beforeIdentities: receipt.beforeIdentities.map(getGrokMediaIdentity).filter(Boolean),
        afterIdentities: receipt.afterIdentities.map(getGrokMediaIdentity).filter(Boolean),
        visibleIdentities: receipt.visibleIdentities.map(getGrokMediaIdentity).filter(Boolean),
        origin: {
            pathname: String(receipt.origin.pathname || ''),
            conversationId: String(receipt.origin.conversationId || ''),
            scope: String(receipt.origin.scope || '')
        },
        scrollTop: Math.max(
            0,
            Number(receipt.scrollTop ?? value.galleryScrollTop ?? value.scrollY) || 0
        )
    };
}

async function restoreSavedViewportReceipt(receiptValue, {
    isActive,
    isScopeValid,
    sleep,
    timeoutMs = 10000,
    pollInterval = 200
} = {}) {
    const receipt = normalizeSavedViewportReceipt(receiptValue);
    if (!receipt) return { status: 'invalid_receipt' };
    const attempts = Math.max(1, Math.ceil(timeoutMs / pollInterval));
    const hasValidScope = () => typeof isScopeValid !== 'function' || isScopeValid();

    for (let attempt = 0; attempt < attempts; attempt++) {
        if (isActive && !isActive()) return { status: 'cancelled' };
        if (!hasValidScope()) return { status: 'invalid_scope', receipt };
        if (detectGrokScrapeSurface(document, window.location) === SCRAPE_SURFACES.savedGallery) {
            const context = getSavedGalleryContext(document);
            if (attempt > 0 && context && !hasOrderedSavedNeighborhood(context.entries, receipt)) {
                if (!hasValidScope()) return { status: 'invalid_scope', receipt };
                setSavedGalleryScrollTop(context.scroller, receipt.scrollTop);
            }
            if (context && hasOrderedSavedNeighborhood(context.entries, receipt)) {
                if (!hasValidScope()) return { status: 'invalid_scope', receipt };
                const positionRestored = setSavedGalleryScrollTop(context.scroller, receipt.scrollTop);
                const verifiedContext = getSavedGalleryContext(document);
                if (!verifiedContext || verifiedContext.scroller !== context.scroller) {
                    if (typeof sleep === 'function') {
                        await sleep(pollInterval);
                        if (!hasValidScope()) return { status: 'invalid_scope', receipt };
                    }
                    continue;
                }
                if (positionRestored && hasOrderedSavedNeighborhood(verifiedContext.entries, receipt)) {
                    return { status: 'restored', context: verifiedContext, receipt };
                }
            }
        }
        if (typeof sleep === 'function') {
            await sleep(pollInterval);
            if (!hasValidScope()) return { status: 'invalid_scope', receipt };
        }
    }

    return { status: 'timeout', receipt };
}

function isSuccessfulMediaTransferStatus(status) {
    return status === 'queued'
        || status === 'cloud_queued'
        || status === 'uploaded'
        || status === 'already_present'
        || status === 'conflict_uploaded';
}

function shouldStopScraperForStorageChanges(changes = {}, backupMode = false) {
    if (changes.scraperState?.newValue === 'idle') return true;
    if (backupMode) {
        return changes.isR2Backup?.newValue === false
            || changes.r2BackupState?.newValue?.isRunning === false;
    }
    return changes.isScraping?.newValue === false;
}

function waitForMediaFetchBridgeReady(root = document, timeoutMs = 5000, pollIntervalMs = 100) {
    const requestId = `probe_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    return new Promise((resolve, reject) => {
        let settled = false;
        let pollTimer = null;
        let timeoutTimer = null;
        const cleanup = () => {
            root.removeEventListener('__gpt_media_fetch_bridge_ready', handleReady);
            if (pollTimer !== null) clearInterval(pollTimer);
            if (timeoutTimer !== null) clearTimeout(timeoutTimer);
        };
        const finish = (error) => {
            if (settled) return;
            settled = true;
            cleanup();
            if (error) reject(error);
            else resolve();
        };
        function handleReady(event) {
            if (event.detail?.requestId !== requestId) return;
            finish();
        }
        const probe = () => {
            root.dispatchEvent(new CustomEvent('__gpt_media_fetch_bridge_probe', {
                detail: { requestId }
            }));
        };

        root.addEventListener('__gpt_media_fetch_bridge_ready', handleReady);
        timeoutTimer = setTimeout(() => {
            finish(new Error('Media fetch bridge not ready'));
        }, timeoutMs);
        probe();
        if (!settled) pollTimer = setInterval(probe, pollIntervalMs);
    });
}

const MEDIA_DATA_URL_INLINE_MAX_BYTES = 8 * 1024 * 1024;

async function fetchMediaDataUrlViaBridge(sourceUrl, root = document, timeoutMs = 30000) {
    await waitForMediaFetchBridgeReady(root, Math.min(5000, timeoutMs));
    const requestId = `fetch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    try {
        const result = await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                root.removeEventListener('__gpt_fetch_media_data_url_result', handleResult);
                reject(new Error('Bridge fetch timeout'));
            }, timeoutMs);
            function handleResult(event) {
                if (event.detail?.requestId !== requestId) return;
                root.removeEventListener('__gpt_fetch_media_data_url_result', handleResult);
                clearTimeout(timeout);
                if (event.detail.error) reject(new Error(event.detail.error));
                else resolve(event.detail);
            }
            root.addEventListener('__gpt_fetch_media_data_url_result', handleResult);
            root.dispatchEvent(new CustomEvent('__gpt_fetch_media_data_url', {
                detail: {
                    url: sourceUrl,
                    requestId,
                    maxInlineBytes: MEDIA_DATA_URL_INLINE_MAX_BYTES
                }
            }));
        });

        if (result.dataUrl) return { dataUrl: result.dataUrl, size: result.size || 0, type: result.type || '' };
        if (result.tooLarge) {
            return {
                dataUrl: null,
                size: result.size || 0,
                type: result.type || '',
                tooLarge: true
            };
        }
        throw new Error('Bridge fetch returned no media data');
    } finally {
        root.dispatchEvent(new CustomEvent('__gpt_fetch_media_release', { detail: { requestId } }));
    }
}

async function fetchGrokAssetMetadataViaBridge(
    conversationId,
    assetId,
    root = document,
    timeoutMs = 30000
) {
    await waitForMediaFetchBridgeReady(root, Math.min(5000, timeoutMs));
    const normalizedConversationId = getGrokConversationId(`https://grok.com/?conversation=${conversationId}`);
    const normalizedAssetId = getGrokMediaIdentity(assetId);
    if (!normalizedConversationId || !normalizedAssetId) throw new Error('asset_metadata_identity_missing');
    const requestId = `metadata_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const metadata = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            root.removeEventListener('__gpt_fetch_asset_metadata_result', handleResult);
            reject(new Error('Asset metadata bridge timeout'));
        }, timeoutMs);
        function handleResult(event) {
            if (event.detail?.requestId !== requestId) return;
            root.removeEventListener('__gpt_fetch_asset_metadata_result', handleResult);
            clearTimeout(timeout);
            if (event.detail.error) reject(new Error(event.detail.error));
            else resolve(event.detail.metadata);
        }
        root.addEventListener('__gpt_fetch_asset_metadata_result', handleResult);
        root.dispatchEvent(new CustomEvent('__gpt_fetch_asset_metadata', {
            detail: {
                requestId,
                conversationId: normalizedConversationId,
                assetId: normalizedAssetId
            }
        }));
    });

    if (!metadata || typeof metadata !== 'object') throw new Error('asset_metadata_missing');
    if (getGrokConversationId(`https://grok.com/?conversation=${metadata.conversationId}`) !== normalizedConversationId) {
        throw new Error('asset_metadata_conversation_mismatch');
    }
    if (getGrokMediaIdentity(metadata.assetId) !== normalizedAssetId) {
        throw new Error('asset_metadata_asset_mismatch');
    }
    return metadata;
}

const GROK_CONVERSATION_INVENTORY_MAX_ASSETS = 2048;
const GROK_CONVERSATION_INVENTORY_MAX_BYTES = 2097152;
const GROK_INVENTORY_SENSITIVE_KEY_PATTERN = /(?:authorization|bearer|cookie|credential|password|secret|signature|token)/i;

function normalizeGrokInventoryMetadataValue(value, depth = 0) {
    if (depth > 8) throw new Error('conversation_asset_metadata_too_deep');
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) throw new Error('conversation_asset_metadata_invalid');
        return value;
    }
    if (typeof value === 'string') {
        if (/^https?:\/\//i.test(value)) {
            let parsed;
            try {
                parsed = new URL(value);
            } catch {
                throw new Error('conversation_asset_metadata_invalid');
            }
            if (parsed.search || parsed.hash) throw new Error('conversation_asset_metadata_not_sanitized');
        }
        return value;
    }
    if (Array.isArray(value)) {
        return value.map((item) => normalizeGrokInventoryMetadataValue(item, depth + 1));
    }
    if (!value || typeof value !== 'object') {
        throw new Error('conversation_asset_metadata_invalid');
    }
    return Object.keys(value).sort().reduce((result, key) => {
        if (GROK_INVENTORY_SENSITIVE_KEY_PATTERN.test(key)) {
            throw new Error('conversation_asset_metadata_sensitive');
        }
        result[key] = normalizeGrokInventoryMetadataValue(value[key], depth + 1);
        return result;
    }, {});
}

function getGrokSerializedByteLength(value) {
    return new Blob([value]).size;
}

function encodeGrokInventoryHashInput(value) {
    if (typeof TextEncoder === 'function') return new TextEncoder().encode(value);
    const encoded = unescape(encodeURIComponent(value));
    return Uint8Array.from(encoded, (character) => character.charCodeAt(0));
}

function normalizeGrokConversationAssetInventory(value, conversationId) {
    const normalizedConversationId = getGrokConversationId(`https://grok.com/?conversation=${conversationId}`);
    if (!normalizedConversationId || !value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('conversation_inventory_invalid');
    }
    if (value.schemaVersion !== 1) throw new Error('conversation_inventory_schema_invalid');
    if (getGrokConversationId(`https://grok.com/?conversation=${value.conversationId}`) !== normalizedConversationId) {
        throw new Error('conversation_inventory_conversation_mismatch');
    }
    if (!Array.isArray(value.assets) || value.assets.length === 0) {
        throw new Error('conversation_inventory_empty');
    }
    if (value.assets.length > GROK_CONVERSATION_INVENTORY_MAX_ASSETS) {
        throw new Error('conversation_inventory_asset_limit');
    }
    const failureCount = Number(value.failureCount || 0);
    const inflightResponseCount = Number(value.inflightResponseCount || 0);
    if (!Number.isInteger(failureCount) || failureCount < 0
        || !Number.isInteger(inflightResponseCount) || inflightResponseCount < 0) {
        throw new Error('conversation_inventory_state_invalid');
    }
    const normalizeResponseIdentities = (records, code) => {
        if (records === undefined) return [];
        if (!Array.isArray(records)) throw new Error(code);
        const seen = new Set();
        return records.map((record) => {
            if (!record || typeof record !== 'object' || Array.isArray(record)) {
                throw new Error(code);
            }
            const responseId = String(record.responseId || '').trim().toLowerCase();
            const parentResponseId = String(record.parentResponseId || '').trim().toLowerCase();
            if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(responseId)
                || (parentResponseId
                    && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(parentResponseId))
                || seen.has(responseId)) {
                throw new Error(code);
            }
            seen.add(responseId);
            return { responseId, parentResponseId };
        });
    };
    const failedResponses = normalizeResponseIdentities(
        value.failedResponses,
        'conversation_inventory_failed_response_invalid'
    );
    const inflightResponses = normalizeResponseIdentities(
        value.inflightResponses,
        'conversation_inventory_inflight_response_invalid'
    );
    const videoGenerationResponses = normalizeResponseIdentities(
        value.videoGenerationResponses,
        'conversation_inventory_video_response_invalid'
    );
    if (getGrokSerializedByteLength(JSON.stringify(value)) > GROK_CONVERSATION_INVENTORY_MAX_BYTES) {
        throw new Error('conversation_inventory_too_large');
    }

    const assetIds = new Set();
    const assets = value.assets.map((candidate) => {
        if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
            throw new Error('conversation_asset_invalid');
        }
        const assetId = getGrokMediaIdentity(candidate.assetId);
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(assetId)) {
            throw new Error('conversation_asset_id_invalid');
        }
        if (assetIds.has(assetId)) throw new Error('conversation_asset_duplicate');
        assetIds.add(assetId);
        const mediaKind = candidate.mediaKind === 'image' || candidate.mediaKind === 'video'
            ? candidate.mediaKind
            : '';
        if (!mediaKind) throw new Error('conversation_asset_media_type_missing');
        const responseId = String(candidate.responseId || '').trim().toLowerCase();
        const parentResponseId = String(candidate.parentResponseId || '').trim().toLowerCase();
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(responseId)
            || (parentResponseId
                && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(parentResponseId))) {
            throw new Error('conversation_asset_response_identity_invalid');
        }

        let parsed;
        try {
            parsed = new URL(String(candidate.sourceUrl || ''));
        } catch {
            throw new Error('conversation_asset_source_invalid');
        }
        if (
            parsed.protocol !== 'https:'
            || parsed.username
            || parsed.password
            || (parsed.port && parsed.port !== '443')
            || parsed.search
            || parsed.hash
            || (parsed.hostname !== 'assets.grok.com' && parsed.hostname !== 'imagine-public.x.ai')
            || getGrokMediaIdentity(parsed.toString()) !== assetId
        ) throw new Error('conversation_asset_source_invalid');

        const promptText = String(candidate.promptText || '');
        const promptEvidenceSource = [
            'response_media_gen_input',
            'asset_media_gen_input',
            'unavailable'
        ].includes(candidate.promptEvidenceSource)
            ? candidate.promptEvidenceSource
            : (promptText.trim() ? 'response_media_gen_input' : 'unavailable');

        return {
            assetId,
            responseId,
            parentResponseId,
            mediaKind,
            sourceUrl: parsed.toString(),
            promptText,
            promptEvidenceSource,
            assetMetadata: candidate.assetMetadata && typeof candidate.assetMetadata === 'object'
                ? normalizeGrokInventoryMetadataValue(candidate.assetMetadata)
                : null,
            mediaGenInput: candidate.mediaGenInput === undefined
                ? null
                : normalizeGrokInventoryMetadataValue(candidate.mediaGenInput)
        };
    });

    return {
        schemaVersion: 1,
        conversationId: normalizedConversationId,
        failureCount,
        inflightResponseCount,
        failedResponses,
        inflightResponses,
        videoGenerationResponses,
        assets
    };
}

async function fetchGrokConversationAssetInventoryViaBridge(
    conversationId,
    root = document,
    timeoutMs = 30000
) {
    await waitForMediaFetchBridgeReady(root, Math.min(5000, timeoutMs));
    const normalizedConversationId = getGrokConversationId(`https://grok.com/?conversation=${conversationId}`);
    if (!normalizedConversationId) throw new Error('conversation_inventory_identity_invalid');
    const requestId = `inventory_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const inventory = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            root.removeEventListener('__gpt_fetch_conversation_asset_inventory_result', handleResult);
            reject(new Error('Conversation inventory bridge timeout'));
        }, timeoutMs);
        function handleResult(event) {
            if (event.detail?.requestId !== requestId) return;
            root.removeEventListener('__gpt_fetch_conversation_asset_inventory_result', handleResult);
            clearTimeout(timeout);
            if (event.detail.error) reject(new Error(event.detail.error));
            else resolve(event.detail.inventory);
        }
        root.addEventListener('__gpt_fetch_conversation_asset_inventory_result', handleResult);
        root.dispatchEvent(new CustomEvent('__gpt_fetch_conversation_asset_inventory', {
            detail: { requestId, conversationId: normalizedConversationId }
        }));
    });
    return normalizeGrokConversationAssetInventory(inventory, normalizedConversationId);
}

if (typeof globalThis !== 'undefined') {
    globalThis.GrokPowerToolsFetchConversationAssetInventory = fetchGrokConversationAssetInventoryViaBridge;
}

function stableSerializeGrokInventoryValue(value) {
    if (Array.isArray(value)) return `[${value.map(stableSerializeGrokInventoryValue).join(',')}]`;
    if (value && typeof value === 'object') {
        return `{${Object.keys(value).sort().map((key) => (
            `${JSON.stringify(key)}:${stableSerializeGrokInventoryValue(value[key])}`
        )).join(',')}}`;
    }
    return JSON.stringify(value);
}

async function hashGrokConversationAssetInventory(inventory) {
    if (!globalThis.crypto?.subtle) throw new Error('conversation_inventory_hash_unavailable');
    const canonical = stableSerializeGrokInventoryValue({
        schemaVersion: inventory.schemaVersion,
        conversationId: inventory.conversationId,
        failureCount: inventory.failureCount,
        inflightResponseCount: inventory.inflightResponseCount,
        failedResponses: inventory.failedResponses,
        inflightResponses: inventory.inflightResponses,
        assets: inventory.assets
    });
    const digest = await globalThis.crypto.subtle.digest(
        'SHA-256',
        encodeGrokInventoryHashInput(canonical)
    );
    const hex = Array.from(new Uint8Array(digest))
        .map((value) => value.toString(16).padStart(2, '0'))
        .join('');
    return `sha256:${inventory.assets.length}:${hex}`;
}

function buildCaptureMetadataFromConversationAsset(inventory, asset) {
    return {
        schemaVersion: 2,
        evidenceSource: 'grok_conversation_response',
        conversationId: inventory.conversationId,
        assetId: asset.assetId,
        responseId: asset.responseId,
        parentResponseId: asset.parentResponseId,
        promptText: asset.promptText,
        promptEvidenceSource: asset.promptEvidenceSource,
        assetMetadata: asset.assetMetadata,
        mediaGenInput: asset.mediaGenInput
    };
}

function createConversationAssetMediaDescriptor(asset) {
    return {
        tagName: asset.mediaKind === 'video' ? 'VIDEO' : 'IMG',
        src: asset.sourceUrl,
        currentSrc: asset.sourceUrl,
        querySelector: () => null
    };
}

function getBackupElementBox(el) {
    const rect = el.getBoundingClientRect?.() || { width: 0, height: 0, top: 0, bottom: 0 };
    return {
        width: rect.width || 0,
        height: rect.height || 0,
        top: rect.top || 0,
        bottom: rect.bottom || 0,
        area: (rect.width || 0) * (rect.height || 0)
    };
}

function isBackupMediaHost(src) {
    return src.includes('imagine-public.x.ai')
        || src.includes('assets.grok.com/users/')
        || src.includes('assets.grok.com/videos/');
}

function getVerifiedSavedCardVideoSource(card, expectedIdentity) {
    const normalizedExpected = getGrokMediaIdentity(expectedIdentity);
    if (!card || !normalizedExpected) return '';
    const candidates = new Set(Array.from(card.querySelectorAll('video'))
        .map(getBackupMediaElementSrc)
        .filter((sourceUrl) => (
            sourceUrl
            && getGrokMediaIdentity(sourceUrl) === normalizedExpected
        )));
    return candidates.size === 1 ? Array.from(candidates)[0] : '';
}

function createVerifiedSavedMediaFallback(pendingNavigation) {
    const expectedMediaType = pendingNavigation?.expectedMediaType;
    if (expectedMediaType !== 'image' && expectedMediaType !== 'video') return null;
    const sourceUrl = String(
        expectedMediaType === 'video'
            ? pendingNavigation.sourceTransferUrl
            : pendingNavigation.sourceUrl
    ).trim();
    const expectedIdentity = getGrokMediaIdentity(pendingNavigation.expectedIdentity);
    if (!sourceUrl || !expectedIdentity || getGrokMediaIdentity(sourceUrl) !== expectedIdentity) return null;

    let parsed;
    try {
        parsed = new URL(sourceUrl);
    } catch {
        return null;
    }
    if (
        parsed.protocol !== 'https:'
        || parsed.username
        || parsed.password
        || (parsed.port && parsed.port !== '443')
    ) return null;

    const trustedPath = parsed.hostname === 'assets.grok.com'
        ? parsed.pathname.startsWith('/users/')
        : expectedMediaType === 'image' && parsed.hostname === 'imagine-public.x.ai';
    const isVideoUrl = /\.(?:mp4|webm)$/i.test(parsed.pathname);
    if (!trustedPath || isVideoUrl !== (expectedMediaType === 'video')) return null;

    return {
        tagName: expectedMediaType === 'video' ? 'VIDEO' : 'IMG',
        src: sourceUrl,
        currentSrc: sourceUrl
    };
}

function isVisibleBackupMediaCandidate(el) {
    const box = getBackupElementBox(el);
    const viewportHeight = typeof window !== 'undefined' ? window.innerHeight || 0 : 0;
    const verticallyVisible = !viewportHeight || (box.bottom >= 0 && box.top <= viewportHeight);
    return verticallyVisible && box.width >= 100 && box.height >= 100;
}

function isGeneratedDetailImageCandidate(img) {
    const src = getBackupMediaElementSrc(img);
    if (!src) return false;
    const alt = String(img.alt || '').toLowerCase();
    const cleanSrc = src.split('?')[0].toLowerCase();
    if (alt === 'pfp' || cleanSrc.includes('profile-picture')) return false;
    if (alt.includes('most recent favorite')) return false;
    if (!isBackupMediaHost(src)) return false;

    return isVisibleBackupMediaCandidate(img);
}

function isGeneratedDetailVideoCandidate(video) {
    const src = getBackupMediaElementSrc(video);
    if (!src || !isBackupMediaHost(src)) return false;
    return isVisibleBackupMediaCandidate(video);
}

function selectBackupMediaElement(root = document) {
    const videos = Array.from(root.querySelectorAll('video'));
    const videoCandidate = videos.find(isGeneratedDetailVideoCandidate);
    if (videoCandidate) return videoCandidate;

    const candidates = Array.from(root.querySelectorAll('img[src*="imagine-public.x.ai"], img[src*="assets.grok.com/users/"]'))
        .filter(isGeneratedDetailImageCandidate)
        .map((img) => ({
            img,
            area: getBackupElementBox(img).area,
            naturalArea: (img.naturalWidth || 0) * (img.naturalHeight || 0)
        }))
        .sort((a, b) => (b.area - a.area) || (b.naturalArea - a.naturalArea));

    return candidates[0]?.img || null;
}

function selectMatchingLegacyDetailMedia(root = document, expectedIdentity = '') {
    const normalizedExpected = getGrokMediaIdentity(expectedIdentity);
    if (!normalizedExpected) return selectBackupMediaElement(root);

    const videos = Array.from(root.querySelectorAll('video'))
        .filter(isGeneratedDetailVideoCandidate)
        .filter((video) => getGrokMediaIdentity(getBackupMediaElementSrc(video)) === normalizedExpected)
        .map((video) => ({ media: video, area: getBackupElementBox(video).area }));
    const images = Array.from(root.querySelectorAll('img[src*="imagine-public.x.ai"], img[src*="assets.grok.com/users/"]'))
        .filter(isGeneratedDetailImageCandidate)
        .filter((image) => getGrokMediaIdentity(getBackupMediaElementSrc(image)) === normalizedExpected)
        .map((image) => ({
            media: image,
            area: getBackupElementBox(image).area,
            naturalArea: (image.naturalWidth || 0) * (image.naturalHeight || 0)
        }));

    videos.sort((a, b) => b.area - a.area);
    images.sort((a, b) => (b.area - a.area) || (b.naturalArea - a.naturalArea));
    return videos[0]?.media || images[0]?.media || null;
}

function isBackupScrollerAtBottom(state) {
    return (state.scrollTop || 0) + (state.clientHeight || 0) >= (state.scrollHeight || 0) - 8;
}

const REQUIRED_STABLE_BOTTOM_ROUNDS = 8;
const MINIMUM_STABLE_BOTTOM_MS = 6000;
const SAVED_SCAN_MAX_SCROLL_ATTEMPTS = 5000;
const SAVED_BOTTOM_PROBE_WAIT_MS = 750;
const CANARY_TARGET_TYPE_SETTLE_ATTEMPTS = 10;
const CANARY_TARGET_TYPE_SETTLE_INTERVAL_MS = 200;
const SAVED_SCAN_MAX_VERIFICATION_RESTARTS = 3;

function getSyncDestinationsForCloudMode(mode) {
    if (mode === 'cloud_only') return ['r2'];
    if (mode === 'dual_write') return ['local', 'r2'];
    return ['local'];
}

function normalizeScrapeDestinations(values) {
    const destinations = Array.isArray(values)
        ? values.filter((value) => value === 'local' || value === 'r2')
        : [];
    return Array.from(new Set(destinations)).sort();
}

function scrapeDestinationsMatch(left, right) {
    const normalizedLeft = normalizeScrapeDestinations(left);
    const normalizedRight = normalizeScrapeDestinations(right);
    return normalizedLeft.length === normalizedRight.length
        && normalizedLeft.every((value, index) => value === normalizedRight[index]);
}

function appendUniqueIdentity(order, value) {
    if (value && !order.includes(value)) order.push(value);
}

function createSavedScanLedger(now = Date.now()) {
    return {
        seenIdentities: new Set(),
        durableIdentities: new Set(),
        identityOccurrenceCounts: new Map(),
        lastWindowIdentities: [],
        lastWindowPosition: null,
        stableBottomRounds: 0,
        lastNewIdentityAt: now,
        scanAttempts: 0
    };
}

function recordSavedScan(ledger, { identities, windowPosition = null, now = Date.now() }) {
    const normalizedIdentities = identities.map(getGrokMediaIdentity).filter(Boolean);
    let newIdentityCount = 0;
    for (const value of normalizedIdentities) {
        if (ledger.seenIdentities.has(value)) continue;
        ledger.seenIdentities.add(value);
        newIdentityCount++;
    }

    const previousWindow = Array.isArray(ledger.lastWindowIdentities)
        ? ledger.lastWindowIdentities
        : [];
    const sameWindowPosition = Number.isFinite(windowPosition)
        && Number.isFinite(ledger.lastWindowPosition)
        && Math.abs(windowPosition - ledger.lastWindowPosition) <= 2;
    const sameWindow = sameWindowPosition
        && previousWindow.length === normalizedIdentities.length
        && previousWindow.every((identity, index) => identity === normalizedIdentities[index]);
    const hasWindowPositions = Number.isFinite(windowPosition)
        && Number.isFinite(ledger.lastWindowPosition);
    const windowPositionDelta = hasWindowPositions
        ? windowPosition - ledger.lastWindowPosition
        : 0;
    let stableOverlap = sameWindow
        ? { currentStart: 0, length: normalizedIdentities.length }
        : null;

    if (!stableOverlap && previousWindow.length && normalizedIdentities.length) {
        let longestLength = 0;
        const candidates = [];
        for (let previousStart = 0; previousStart < previousWindow.length; previousStart++) {
            for (let currentStart = 0; currentStart < normalizedIdentities.length; currentStart++) {
                let length = 0;
                while (
                    previousStart + length < previousWindow.length
                    && currentStart + length < normalizedIdentities.length
                    && previousWindow[previousStart + length] === normalizedIdentities[currentStart + length]
                ) length++;
                const overlap = normalizedIdentities.slice(currentStart, currentStart + length);
                const logicalOffset = previousStart - currentStart;
                const directionAligned = !hasWindowPositions
                    || (windowPositionDelta > 2 && logicalOffset >= 0)
                    || (windowPositionDelta < -2 && logicalOffset <= 0)
                    || (Math.abs(windowPositionDelta) <= 2 && logicalOffset === 0);
                const movedWholeWindow = length === previousWindow.length
                    && length === normalizedIdentities.length
                    && !sameWindowPosition;
                if (length < 2
                    || new Set(overlap).size < 2
                    || movedWholeWindow
                    || !directionAligned) continue;
                if (length > longestLength) {
                    longestLength = length;
                    candidates.length = 0;
                }
                if (length === longestLength) candidates.push({ previousStart, currentStart, length });
            }
        }
        if (candidates.length === 1) stableOverlap = candidates[0];
    }

    normalizedIdentities.forEach((identity, index) => {
        if (stableOverlap
            && index >= stableOverlap.currentStart
            && index < stableOverlap.currentStart + stableOverlap.length) return;
        ledger.identityOccurrenceCounts.set(
            identity,
            (ledger.identityOccurrenceCounts.get(identity) || 0) + 1
        );
    });
    ledger.lastWindowIdentities = normalizedIdentities;
    ledger.lastWindowPosition = Number.isFinite(windowPosition) ? windowPosition : null;

    if (newIdentityCount > 0) {
        ledger.lastNewIdentityAt = now;
        ledger.stableBottomRounds = 0;
    }
    ledger.scanAttempts++;
    return { newIdentityCount, totalUniqueSeen: ledger.seenIdentities.size };
}

function getSavedScanSummary(ledger) {
    return {
        totalUniqueSeen: ledger.seenIdentities.size,
        durableIdentityCount: ledger.durableIdentities.size,
        stableBottomRounds: ledger.stableBottomRounds,
        lastNewIdentityAt: ledger.lastNewIdentityAt,
        scanAttempts: ledger.scanAttempts,
        updatedAt: Date.now()
    };
}

function isSavedGalleryLoading(root) {
    if (!root || typeof root.querySelectorAll !== 'function') return false;
    return Array.from(root.querySelectorAll('[aria-busy="true"], [role="progressbar"]'))
        .some((element) => element.getClientRects().length > 0);
}

function resolveBackupScrollAttempt({
    before,
    after,
    beforeSignature,
    afterSignature,
    newIdentityCount = 0,
    loading = false,
    contextStable = true,
    transferPending = false,
    stableBottomRounds,
    lastNewIdentityAt = Date.now(),
    now = Date.now(),
    scanAttempts = 0,
    maxScrollAttempts = Number.POSITIVE_INFINITY,
    requiredStableBottomRounds = REQUIRED_STABLE_BOTTOM_ROUNDS,
    minimumStableBottomMs = MINIMUM_STABLE_BOTTOM_MS,
    staleRetries = 0,
    maxStaleRetries = 30
}) {
    const scrollMoved = Math.abs((after.scrollTop || 0) - (before.scrollTop || 0)) > 1;
    const heightChanged = Math.abs((after.scrollHeight || 0) - (before.scrollHeight || 0)) > 1;
    const signatureChanged = beforeSignature !== afterSignature;
    const progressed = scrollMoved || heightChanged || signatureChanged;
    const atBottom = isBackupScrollerAtBottom(after);

    if (stableBottomRounds === undefined) {
        const nextStaleRetries = atBottom && !progressed ? staleRetries + 1 : 0;
        return {
            progressed,
            atBottom,
            nextStaleRetries,
            exhausted: nextStaleRetries >= maxStaleRetries
        };
    }

    if (scanAttempts >= maxScrollAttempts) {
        return { progressed, atBottom, stableBottomRounds, exhausted: false, reason: 'scan_limit' };
    }
    if (!contextStable) {
        return { progressed, atBottom, stableBottomRounds: 0, exhausted: false, reason: 'saved_context_missing' };
    }
    if (newIdentityCount > 0) {
        return { progressed, atBottom, stableBottomRounds: 0, exhausted: false, reason: 'new_identity' };
    }
    if (loading) {
        return { progressed, atBottom, stableBottomRounds: 0, exhausted: false, reason: 'loading' };
    }
    if (transferPending) {
        return { progressed, atBottom, stableBottomRounds: 0, exhausted: false, reason: 'transfer_pending' };
    }
    if (!atBottom) {
        return { progressed, atBottom, stableBottomRounds: 0, exhausted: false, reason: 'not_at_bottom' };
    }
    if (scrollMoved || heightChanged || signatureChanged) {
        return { progressed, atBottom, stableBottomRounds: 0, exhausted: false, reason: 'gallery_changed' };
    }

    const nextStableBottomRounds = stableBottomRounds + 1;
    const exhausted = nextStableBottomRounds >= requiredStableBottomRounds
        && now - lastNewIdentityAt >= minimumStableBottomMs;

    return {
        progressed,
        atBottom,
        stableBottomRounds: nextStableBottomRounds,
        exhausted,
        reason: exhausted ? 'exhausted' : 'stable_bottom'
    };
}

function recordBackupUploadStatus(stats, status) {
    if (!stats) return false;
    if (status === 'uploaded' || status === 'conflict_uploaded') {
        stats.uploaded = (stats.uploaded || 0) + 1;
        return true;
    }
    if (status === 'already_present') {
        stats.alreadyPresent = (stats.alreadyPresent || 0) + 1;
        return true;
    }
    if (status === 'queued') {
        stats.queued = (stats.queued || 0) + 1;
        return true;
    }
    return false;
}

function shouldPersistBackupProcessedId(status) {
    return status === 'uploaded' || status === 'already_present' || status === 'conflict_uploaded';
}

function formatBackupMediaLog(status, value, details = {}) {
    const mediaId = getGrokMediaIdentity(value);
    const stableId = /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(mediaId) ? mediaId : '';
    const fields = [
        `media=${stableId ? `...${stableId.slice(-8)}` : 'unknown'}`,
        `status=${String(status || 'unknown').replace(/[^a-z0-9_-]/gi, '_')}`
    ];
    if (Number.isFinite(details.bytes)) fields.push(`bytes=${details.bytes}`);
    return fields.join(' ');
}

function formatBackupMediaError(stage, code, value) {
    const mediaId = getGrokMediaIdentity(value);
    const stableId = /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(mediaId) ? mediaId : '';
    const safeToken = (token, fallback) => String(token || '')
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 40) || fallback;
    return [
        `stage=${safeToken(stage, 'runtime')}`,
        `code=${safeToken(code, 'media_failure')}`,
        `media=${stableId ? `...${stableId.slice(-8)}` : 'unknown'}`
    ].join(' ');
}

function getSafeSavedEntryFailureDetail(value) {
    const text = String(value || '').trim();
    if (/^[a-z0-9_-]{1,80}$/i.test(text)) return text;
    if (/^stage=[a-z0-9_-]+ code=[a-z0-9_-]+ media=(?:unknown|\.\.\.[a-f0-9]{8})$/i.test(text)) {
        return text;
    }
    return '';
}

function getR2BackupCanaryStopReason(options = {}, stats = {}) {
    if (options.mode !== 'canary') return null;
    const limit = Number.isFinite(options.limit) && options.limit > 0 ? options.limit : 1;
    const r2PresentCount = (stats.uploaded || 0) + (stats.alreadyPresent || 0);
    if (r2PresentCount >= limit) return 'canary_complete';
    const attemptedCount = r2PresentCount + (stats.queued || 0) + (stats.errors || 0);
    if (attemptedCount >= limit) return 'canary_incomplete';
    return null;
}

function getR2BackupPageCommandOptions(detail = {}) {
    const command = detail && typeof detail === 'object' ? detail : {};
    const targetIdentity = getGrokMediaIdentity(command.targetIdentity);
    const targetMediaType = command.targetMediaType === 'image' || command.targetMediaType === 'video'
        ? command.targetMediaType
        : null;
    const targetOptions = {
        ...(targetIdentity ? { targetIdentity } : {}),
        ...(targetMediaType ? { targetMediaType } : {})
    };
    const acceptance = command.runId && command.correlationId && command.keyPrefix
        ? {
            runId: String(command.runId),
            correlationId: String(command.correlationId),
            keyPrefix: String(command.keyPrefix)
        }
        : null;
    if (command.action === 'INIT_R2_CANARY') {
        return {
            mode: 'canary',
            limit: 1,
            options: { stopAfterMediaAttempt: true, ...targetOptions },
            ...(acceptance ? { acceptance } : {})
        };
    }

    if (command.action !== 'INIT_R2_BACKUP' || command.mode !== 'canary') return null;

    const options = command.options && typeof command.options === 'object' ? command.options : {};
    return {
        mode: 'canary',
        limit: 1,
        options: { ...options, ...targetOptions, stopAfterMediaAttempt: true },
        ...(acceptance ? { acceptance } : {})
    };
}

// --- UTILS ---
class ToastManager {
    constructor() {
        this.container = document.createElement('div');
        this.container.id = 'gpt-toaster';
        document.body.appendChild(this.container);
    }

    show(msg, type = 'info') {
        const toast = document.createElement('div');
        toast.className = `gpt-toast ${type}`;
        toast.textContent = msg;
        this.container.appendChild(toast);
        setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }
}

class LogViewer {
    constructor() {
        this.el = null;
        this.isMinimized = false;
        this.render();
        this.setupListeners();
    }

    render() {
        if (this.el) return;
        const div = document.createElement('div');
        div.id = 'gpt-logs-panel';
        div.innerHTML = `
            <div class="gpt-logs-header" id="gptLogsHeader">
                <span>System Logs</span>
                <div style="display:flex; gap:8px">
                    <button class="gpt-btn-icon" id="gptLogsMinBtn" title="Minimize/Maximize">_</button>
                    <button class="gpt-btn-icon" id="gptLogsClearBtn" title="Clear">Ø</button>
                    <button class="gpt-btn-icon" id="gptLogsCloseBtn" title="Close Logs">x</button>
                </div>
            </div>
            <div class="gpt-logs-content" id="gptLogsContent"></div>
        `;
        document.body.appendChild(div);
        this.el = div;
    }

    setupListeners() {
        const header = this.el.querySelector('#gptLogsHeader');
        let isDragging = false, startX, startY, initialLeft, initialTop;

        header.addEventListener('mousedown', (e) => {
            if (e.target.closest('button')) return;
            isDragging = true;
            startX = e.clientX; startY = e.clientY;
            const rect = this.el.getBoundingClientRect();
            initialLeft = rect.left; initialTop = rect.top;
        });
        this._onMouseMove = (e) => {
            if (!isDragging) return;
            this.el.style.left = `${initialLeft + (e.clientX - startX)}px`;
            this.el.style.top = `${initialTop + (e.clientY - startY)}px`;
            this.el.style.bottom = 'auto';
        };
        this._onMouseUp = () => isDragging = false;
        document.addEventListener('mousemove', this._onMouseMove);
        document.addEventListener('mouseup', this._onMouseUp);

        this.el.querySelector('#gptLogsMinBtn').addEventListener('click', () => {
            this.isMinimized = !this.isMinimized;
            this.el.classList.toggle('minimized', this.isMinimized);
        });
        this.el.querySelector('#gptLogsClearBtn').addEventListener('click', () => {
            this.el.querySelector('#gptLogsContent').innerHTML = '';
        });
        this.el.querySelector('#gptLogsCloseBtn').addEventListener('click', () => this.destroy());
    }

    addLog(msg, type = 'neutral') {
        if (!this.el) return;
        const container = this.el.querySelector('#gptLogsContent');
        const row = document.createElement('div');
        row.className = `gpt-log-entry ${type}`;
        const time = new Date().toLocaleTimeString().split(' ')[0];
        row.innerHTML = `<span class="gpt-log-timestamp">[${time}]</span> ${msg}`;
        container.insertBefore(row, container.firstChild);
        if (container.children.length > 100) container.removeChild(container.lastChild);
    }
    destroy() {
        if (this._onMouseMove) document.removeEventListener('mousemove', this._onMouseMove);
        if (this._onMouseUp) document.removeEventListener('mouseup', this._onMouseUp);
        if (this.el) { this.el.remove(); this.el = null; }
    }
}

class SettingsManager {
    constructor() {
        this.settings = { ...SettingsDefaults };
        this.listeners = new Set();
        this.init();
    }
    async init() {
        const storedResult = await safeChromeStorageGet('sync', ['gptGlobalSettings'], {}, 'load settings');
        if (storedResult.invalidated) return;
        const stored = storedResult.value;
        if (stored.gptGlobalSettings) {
            this.settings = { ...this.settings, ...stored.gptGlobalSettings };
        }
        this.notify();
        safeChromeAddListener(() => chrome.storage.onChanged, (changes, area) => {
            if (area === 'sync' && changes.gptGlobalSettings) {
                this.settings = { ...this.settings, ...changes.gptGlobalSettings.newValue };
                this.notify();
            }
        }, 'listen for settings changes');
    }
    get(key) { return this.settings[key]; }
    set(key, value) { this.settings[key] = value; this.save({ [key]: value }); this.notify(); }
    setAll(updates) { this.settings = { ...this.settings, ...updates }; this.save(updates); this.notify(); }
    save(updates) {
        safeChromeRuntimeSendMessage({
            action: 'GLOBAL_SETTINGS_PATCH',
            updates
        }, 'save settings').then((result) => {
            if (result.invalidated) this.notify();
        }).catch(() => {});
    }
    subscribe(cb) { this.listeners.add(cb); return () => this.listeners.delete(cb); }
    notify() { this.listeners.forEach(cb => cb(this.settings)); }
    export() { return JSON.stringify(this.settings, null, 2); }
    import(json) {
        try {
            const parsed = JSON.parse(json);
            // 1. Settings
            if (parsed.gptGlobalSettings || parsed.maxRetries) {
                // Handle both wrapped and flat formats
                const settingsUpdates = parsed.gptGlobalSettings || parsed;
                // Filter out non-settings keys if flat
                const cleanSettings = {};
                Object.keys(SettingsDefaults).forEach(k => {
                    if (settingsUpdates[k] !== undefined) cleanSettings[k] = settingsUpdates[k];
                });
                this.setAll(cleanSettings);
            }

            // 2. Processed IDs (History)
            if (parsed.processedIds && Array.isArray(parsed.processedIds)) {
                safeChromeRuntimeSendMessage({
                    action: 'PROCESSED_IDS_ADD',
                    ids: parsed.processedIds
                }, 'import processed IDs').then((result) => {
                    if (result.invalidated) return;
                    const total = Array.isArray(result.value?.processedIds) ? result.value.processedIds.length : 0;
                    console.log(`Imported ${parsed.processedIds.length} IDs. Total: ${total}`);
                }).catch(console.error);
            }
            return true;
        }
        catch (e) { console.error(e); return false; }
    }
    reset() {
        this.settings = { ...SettingsDefaults };
        this.save(this.settings);
        this.notify();
    }
}

class PromptHistoryManager {
    constructor(settingsManager) {
        this.settingsManager = settingsManager;
        this.history = [];
        this.listeners = new Set();
        this.captureEnabled = true;
        this.init();
        this.setupCapture();
        this.setupStorageSync();
    }
    async init() {
        const storedResult = await safeChromeStorageGet('local', ['promptHistory'], {}, 'load history');
        if (storedResult.invalidated) return;
        if (storedResult.value.promptHistory) { this.history = storedResult.value.promptHistory; this.notify(); }
    }
    setupCapture() {
        // Use Capture Phase ({capture: true}) to intercept events BEFORE the app handles/clears them.

        // Clicks (Video or Submit)
        window.addEventListener('click', (e) => {
            if (!this.captureEnabled) return;
            // Video Button
            const btn = e.target.closest('button[aria-label="Make video" i]');
            if (btn) {
                console.log('GPT: Make Video clicked');
                this.captureCurrentPrompt('video', btn);
            }

            // Image Submit Button
            const submitBtn = e.target.closest('button[aria-label="Submit"], button[aria-label="Send"]');
            if (submitBtn) {
                console.log('GPT: Submit clicked');
                this.captureCurrentPrompt(this.consumePromptCaptureHint() || 'image', submitBtn);
            }
        }, true); // <--- Capture Phase

        // Enter Key in Textarea
        window.addEventListener('keydown', (e) => {
            if (!this.captureEnabled) return;
            if (e.key === 'Enter' && !e.shiftKey) {
                const composer = e.target.closest(
                    'textarea[aria-required="true"], '
                    + 'div[contenteditable="true"][role="textbox"][aria-label="Ask Grok anything"], '
                    + '#prompt-textarea[contenteditable="true"][role="textbox"]'
                );
                if (composer) {
                    this.captureCurrentPrompt(this.consumePromptCaptureHint() || 'image', composer);
                }
            }
        }, true); // <--- Capture Phase
    }

    setupStorageSync() {
        safeChromeAddListener(() => chrome.storage.onChanged, (changes, area) => {
            if (area !== 'local' || !changes.promptHistory) return;
            this.history = Array.isArray(changes.promptHistory.newValue)
                ? changes.promptHistory.newValue
                : [];
            this.notify();
        }, 'listen for prompt history changes');
    }

    setCaptureEnabled(enabled) {
        this.captureEnabled = !!enabled;
    }

    consumePromptCaptureHint() {
        const root = document.documentElement;
        const hintedType = root?.dataset?.gptPromptCaptureType;
        if (hintedType !== 'video' && hintedType !== 'image') return '';
        delete root.dataset.gptPromptCaptureType;
        return hintedType;
    }

    captureCurrentPrompt(type = 'image', triggerEl = null) {
        let text = '';
        const composer = resolveVisibleGrokComposer(triggerEl);

        if (composer instanceof HTMLTextAreaElement && composer.value && composer.value.trim().length > 0) {
            text = composer.value.trim();
        } else if (composer && composer.textContent && composer.textContent.trim().length > 0) {
            text = composer.textContent.trim();
        }

        // 2. If 'video' and text is empty, try to find context from trigger element (Card)
        if (!text && type === 'video' && triggerEl) {
            // Heuristic: The button is usually in a card. Find parent container.
            // Look for closest article or div.group or just parents.
            let container = triggerEl.closest('article');
            if (!container) container = triggerEl.closest('div.group');
            if (!container) container = triggerEl.parentElement?.parentElement;

            if (container) {
                // Try Image Alt
                const img = container.querySelector('img');
                if (img && img.alt) {
                    text = img.alt.trim();
                    console.log('GPT: Found prompt from Image Alt:', text.substring(0, 20));
                } else {
                    // Try Paragraph text (for text-only cards?)
                    const p = container.querySelector('p');
                    if (p) text = p.innerText.trim();
                }
            }
        }

        if (text && text.length > 0) {
            this.add(text, type);
        } else {
            console.log(`GPT: Failed to capture ${type} prompt. Text empty.`);
        }
    }

    async add(text, type = 'image') {
        const timestamp = Date.now();
        const limit = this.settingsManager.get('historyLimit') || 50;
        const result = await mutatePromptHistoryStorage('add', {
            entry: {
                id: `history_${timestamp}_${Math.random().toString(16).slice(2, 10)}`,
                text,
                type,
                timestamp
            },
            limit
        });
        if (!result.ok) return false;
        this.history = result.promptHistory;
        this.notify();
        return true;
    }
    async clear() {
        const result = await mutatePromptHistoryStorage('clear');
        if (!result.ok) return false;
        this.history = result.promptHistory;
        this.notify();
        return true;
    }
    subscribe(cb) { this.listeners.add(cb); return () => this.listeners.delete(cb); }
    notify() { this.listeners.forEach(cb => cb(this.history)); }
}

// --- MAIN OVERLAY ---

class GrokOverlay {
    constructor(scraper, retryManager, settingsManager, historyManager, options = {}) {
        this.scraper = scraper;
        this.retryManager = retryManager;
        this.settingsManager = settingsManager;
        this.historyManager = historyManager;
        this.provider = options.provider || detectCurrentProvider();
        this.chatGptActions = options.chatGptActions || ChatGPTImagesActions;
        this.providerRunLedger = options.providerRunLedger || ProviderRunLedger;

        this.logViewer = null;
        this.toast = new ToastManager();
        this.state = { minimized: false, width: 380, height: null };
        this.savedPrompts = [];
        this.savedPromptType = SAVED_PROMPT_TYPES.partial;
        this.savedPromptSearch = '';
        this.recreateReference = null;
        this.recreateRunning = false;
        this.recreateAbortRequested = false;
        this.recreateUiRunSequence = 0;
        this.recreateRetryAvailable = false;
        this.recreateActiveRunId = '';
        this.recreatePasteHandler = null;
        this.chatGptImageRunning = false;
        this.activeWorkflowStatus = { status: 'idle', activeWorkflow: null };
        this.activeWorkflowRefreshPromise = null;

        if (typeof document !== 'undefined') {
            this.render();
            this.setupListeners();
            this.restoreState();
            this.settingsManager.subscribe(s => this.onSettingsChange(s));
            this.historyManager.subscribe(h => this.renderHistoryList(h));
            this.setupSavedPromptsStorageSync();
        }
    }

    setupSavedPromptsStorageSync() {
        safeChromeAddListener(() => chrome.storage.onChanged, (changes, area) => {
            if (area !== 'local' || !changes.savedPrompts) return;
            this.savedPrompts = normalizeSavedPrompts(changes.savedPrompts.newValue);
            this.renderSavedList();
        }, 'listen for saved prompt changes');
    }

    async restoreState() {
        const storedResult = await safeChromeStorageGet('local', ['overlayState'], {}, 'load overlay state');
        if (storedResult.invalidated) {
            showExtensionContextRefreshed(this);
            return;
        }
        const stored = storedResult.value;
        if (stored.overlayState) {
            this.state = { ...this.state, ...stored.overlayState };
            if (this.state.minimized) this.minimize(true);
            if (this.state.width) this.el.style.width = `${this.state.width}px`;
            if (this.state.height) this.el.style.height = `${this.state.height}px`;
        }
        this.loadSavedPrompts();
        this.renderHistoryList(this.historyManager.history);
        if (this.settingsManager.get('devMode')) this.setDevMode(true);
    }

    onSettingsChange(settings) {
        const retryToggle = this.el.querySelector('#gptRetryToggle');
        const goalInput = this.el.querySelector('#gptVideoGoal');
        const galleryLimitInput = this.el.querySelector('#gptGalleryLimit');
        if (retryToggle) retryToggle.checked = settings.autoRetryEnabled;
        if (goalInput && !this.retryManager.goalRunning && !this.retryManager.batchRunning) {
            goalInput.value = settings.videoGoal || 1;
        }
        if (galleryLimitInput && !this.retryManager.batchRunning) {
            galleryLimitInput.value = settings.galleryBatchLimit || settings.videoGoal || 1;
        }
        if (settings.devMode && !this.logViewer) this.setDevMode(true);
        else if (!settings.devMode && this.logViewer) this.setDevMode(false);
    }

    saveState() {
        safeChromeStorageSet('local', { overlayState: this.state }, 'save overlay state').then((result) => {
            if (result.invalidated) showExtensionContextRefreshed(this);
        }).catch(() => {});
    }

    render() {
        const container = document.createElement('div');
        container.id = 'grok-powertools-overlay';
        container.innerHTML = `
                <div class="gpt-minimized-icon">
                    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M13 3L11 3V11L3 11V13L11 13V21L13 21V13H21V11H13V3Z" /></svg>
                </div>
                
                <div class="gpt-header" id="gptHeader">
                    <div class="gpt-title">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V5h14v14z"/></svg>
                        Grok Power Tools
                    </div>
                    <div class="gpt-controls" style="display:flex; align-items:center;">
                        <button class="gpt-btn-icon" id="gptSettingsBtn" title="Settings" style="margin-right:8px">
                           <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
                        </button>
                        <button class="gpt-btn-icon" id="gptMinBtn" title="Minimize">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                        </button>
                    </div>
                </div>

                <!-- MAIN VIEW -->
                <div class="gpt-content" id="gptMainView">
                    <div class="gpt-section">
                        <div class="gpt-row">
                            <span style="font-size:12px; font-weight:600; color:#e7e9ea">STATUS</span>
                            <span id="gptStatusBadge" class="gpt-badge gpt-badge-success">Ready</span>
                        </div>
                        <div id="gptProviderLabel" style="font-size:11px; color:#71767b; margin-top:6px;">Provider: Grok Imagine</div>
                    </div>

                    <div class="gpt-section" id="gptRecreateSection">
                        <label class="gpt-row" style="font-weight:600; margin-bottom:4px;">Recreate Media</label>
                        <div id="gptRecreateDropzone" tabindex="0" style="border:1px dashed rgba(255,255,255,0.25); border-radius:6px; padding:8px; font-size:11px; color:#c9d1d9; text-align:center;">
                            Drop, paste, choose image/video/GIF, or use current Grok image
                        </div>
                        <input type="file" id="gptRecreateFileInput" accept="image/jpeg,image/jpg,image/png,image/gif,image/webp,image/bmp,image/tiff,video/mp4,video/quicktime,video/webm" style="display:none;">
                        <div class="gpt-row" style="margin-top:6px; gap:4px;">
                            <button id="gptRecreateChooseBtn" class="gpt-btn gpt-btn-secondary" style="flex:1; font-size:11px;">Choose</button>
                            <button id="gptRecreateCurrentBtn" class="gpt-btn gpt-btn-secondary" style="flex:1; font-size:11px;">Current</button>
                        </div>
                        <div class="gpt-row" style="margin-top:6px; font-size:11px;">
                            <span>Grok Search</span>
                            <label class="gpt-toggle-switch">
                                <input type="checkbox" id="gptRecreateBestPractices">
                                <span class="gpt-slider"></span>
                            </label>
                        </div>
                        <div class="gpt-row" style="margin-top:6px; gap:4px;">
                            <button id="gptRecreateStartBtn" class="gpt-btn gpt-btn-primary" style="flex:1; background:#0ea5e9; font-size:11px;">Start Recreate</button>
                            <button id="gptRecreateStopBtn" class="gpt-btn" style="flex:1; background:#f4212e; display:none; font-size:11px;">Stop</button>
                        </div>
                        <div id="gptRecreateStatus" style="font-size:10px; color:#71767b; margin-top:4px;">No reference selected.</div>
                    </div>

                    <div class="gpt-section" id="gptAutoRetrySection">
                        <div class="gpt-row">
                             <span>Auto-Retry</span>
                             <label class="gpt-toggle-switch">
                                 <input type="checkbox" id="gptRetryToggle">
                                 <span class="gpt-slider"></span>
                             </label>
                        </div>
                        <div class="gpt-row" style="margin-top:8px; font-size:11px; color:#71767b">
                            <span>Retries Used</span>
                            <span id="gptRetryCounter" class="gpt-badge gpt-badge-neutral" style="font-size:10px">0/0</span>
                        </div>
                         <div class="gpt-row" style="margin-top:4px; font-size:11px; color:#71767b">
                            <span id="gptProgressLabel">Videos Generated</span>
                            <span id="gptVideoCounter" class="gpt-badge gpt-badge-neutral" style="font-size:10px">0/0</span>
                        </div>
                        <div class="gpt-row" style="margin-top:8px">
                             <span># of Videos</span>
                             <input type="number" id="gptVideoGoal" class="gpt-input" value="1" min="1" max="50">
                        </div>
                        <div class="gpt-row" style="margin-top:8px" id="gptGalleryLimitRow">
                             <span>Gallery Limit</span>
                             <input type="number" id="gptGalleryLimit" class="gpt-input" value="10" min="1" max="200">
                        </div>
                         <div class="gpt-row" style="margin-top:12px">
                            <button id="gptStartGoalBtn" class="gpt-btn gpt-btn-primary">Start Video Goal</button>
                        </div>
                        <div class="gpt-row" style="margin-top:8px">
                            <button id="gptQuickBatchBtn" class="gpt-btn gpt-btn-secondary" style="flex:1; background:#1d9bf0; font-size:11px;">Quick Batch</button>
                            <button id="gptPromptedBatchBtn" class="gpt-btn gpt-btn-secondary" style="flex:1; margin-left:4px; background:#7c3aed; font-size:11px;">Prompted Batch</button>
                            <button id="gptBatchStopBtn" class="gpt-btn" style="flex:1; background:#f4212e; display:none; font-size:11px;">Stop Batch</button>
                        </div>
                        <div class="gpt-row" id="gptBatchRecoveryRow" style="margin-top:8px; gap:4px; display:none;">
                            <button id="gptBatchResumeBtn" class="gpt-btn gpt-btn-secondary" style="flex:1; background:#1d9bf0; font-size:11px; display:none;">Resume Run</button>
                            <button id="gptBatchRetryFailedBtn" class="gpt-btn gpt-btn-secondary" style="flex:1; background:#d97706; font-size:11px; display:none;">Retry Failed</button>
                            <button id="gptBatchCancelRunBtn" class="gpt-btn" style="flex:1; background:#f4212e; font-size:11px; display:none;">Cancel Run</button>
                        </div>
                        <div class="gpt-row" style="margin-top:4px; font-size:10px; color:#71767b; display:none;" id="gptBatchStatus">
                            Batch Mode: Active
                        </div>
                    </div>

                    <div class="gpt-section" id="gptTemplateBatchSection">
                        <label class="gpt-row" style="font-weight:600; margin-bottom:4px;">Template Batch</label>
                        <div class="gpt-row" style="gap:6px; align-items:center;">
                            <select id="gptTemplateSelect" style="flex:1; padding:4px 6px; border-radius:4px; border:1px solid #555; background:#222; color:#fff; font-size:11px;">
                                <option value="c666d4b7-5c53-418a-8448-99ad7c5ca649">Funky Dance</option>
                            </select>
                            <label style="font-size:11px; white-space:nowrap;">×</label>
                            <input type="number" id="gptTemplateBatchCount" min="1" max="50" value="10" style="width:48px; padding:4px; border-radius:4px; border:1px solid #555; background:#222; color:#fff; font-size:11px;">
                        </div>
                        <div class="gpt-row" style="margin-top:6px; gap:4px;">
                            <button id="gptTemplateBatchBtn" class="gpt-btn gpt-btn-primary" style="flex:1; background:#e67e22; font-size:11px;">Start Template Batch</button>
                            <button id="gptTemplateBatchStopBtn" class="gpt-btn" style="flex:1; background:#f4212e; display:none; font-size:11px;">Stop</button>
                        </div>
                        <div id="gptTemplateBatchStatus" style="font-size:10px; color:#71767b; margin-top:4px;"></div>
                    </div>

                    <div class="gpt-section" id="gptQualityRepeatSection">
                        <label class="gpt-row" style="font-weight:600; margin-bottom:4px;">Quality Repeat</label>
                        <div class="gpt-row" style="gap:6px; align-items:center;">
                            <span style="font-size:11px;">Repeats:</span>
                            <input type="number" id="gptQualityRepeatCount" class="gpt-input" value="5" min="1" max="50" style="width:48px;">
                            <span id="gptQualityRepeatCalc" style="font-size:10px; color:#71767b;">(x4 = 20 images)</span>
                        </div>
                        <div class="gpt-row" style="margin-top:6px; gap:4px;">
                            <button id="gptQualityRepeatBtn" class="gpt-btn gpt-btn-primary" style="flex:1; background:#8b5cf6; font-size:11px;">Start Quality Repeat</button>
                            <button id="gptQualityRepeatStopBtn" class="gpt-btn" style="flex:1; background:#f4212e; display:none; font-size:11px;">Stop</button>
                        </div>
                        <div id="gptQualityRepeatStatus" style="font-size:10px; color:#71767b; margin-top:4px;"></div>
                    </div>

                    <div class="gpt-section" id="gptGalleryDownloadSection">
                        <label class="gpt-row" style="font-weight:600; margin-bottom:4px;">Gallery Download</label>
                        <div class="gpt-row" style="margin-top:6px; gap:4px;">
                            <button id="gptScrapeDownloadBtn" class="gpt-btn gpt-btn-primary" style="flex:1; background:#22c55e; font-size:11px;">Download Gallery</button>
                            <button id="gptScrapeStopBtn" class="gpt-btn" style="flex:1; background:#f4212e; display:none; font-size:11px;">Stop</button>
                        </div>
                        <div id="gptScrapeStatus" style="font-size:10px; color:#71767b; margin-top:4px;">Scrolls through gallery, clicks into each item, downloads all media.</div>
                    </div>

                    <div class="gpt-section">
                        <div style="display:flex; gap:8px; margin-bottom:8px; border-bottom:1px solid rgba(255,255,255,0.1); padding-bottom:8px;">
                             <div class="gpt-tab active" id="tab-btn-history" style="flex:1; text-align:center;">History</div>
                             <div class="gpt-tab" id="tab-btn-saved" style="flex:1; text-align:center;">Saved</div>
                        </div>

                        <div id="view-history">
                            <input type="text" id="gptHistorySearch" class="gpt-history-search" placeholder="Search history...">
                            <div class="gpt-history-list" id="gptHistoryList"></div>
                            <button id="gptClearHistoryBtn" class="gpt-btn" style="margin-top:8px; width:100%; justify-content:center; background:rgba(244,33,46,0.2); color:#f4212e;">
                                Clear History
                            </button>
                        </div>

                        <div id="view-saved" style="display:none;">
                            <div class="gpt-saved-toolbar">
                                <div class="gpt-saved-type-tabs">
                                    <button id="gptSavedTypePartial" class="gpt-tab gpt-tab-sm active">Partials</button>
                                    <button id="gptSavedTypeFull" class="gpt-tab gpt-tab-sm">Full Prompts</button>
                                </div>
                                <input type="text" id="gptSavedSearch" class="gpt-history-search" placeholder="Search saved...">
                            </div>
                            <div class="gpt-prompt-list" id="gptPromptList">
                                 <div style="font-size:11px; color:#71767b; width:100%; text-align:center; padding:8px;">No saved prompts</div>
                            </div>
                            <button id="gptAddPromptBtn" class="gpt-btn" style="margin-top:8px; width:100%; justify-content:center;">
                                + Add Prompt Partial
                            </button>
                        </div>
                    </div>
                </div>

                <!-- SETTINGS VIEW -->
                <div class="gpt-content gpt-settings-view" id="gptSettingsView" style="display:none;">
                    <button class="gpt-btn" id="gptBackBtn" style="width: auto; padding: 4px 8px; margin-bottom:10px;">
                        ← Back
                    </button>

                    <div class="gpt-tabs">
                        <div class="gpt-tab active" data-tab="defaults">Defaults</div>
                        <div class="gpt-tab" data-tab="timing">Timing</div>
                        <div class="gpt-tab" data-tab="advanced">Advanced</div>
                    </div>

                    <!-- DEFAULTS TAB -->
                    <div class="gpt-settings-panel active" id="tab-defaults">
                        <div class="gpt-input-group">
                            <div class="gpt-input-label">Default Max Retries
                                <span class="gpt-badge-sm" id="lblMaxRetries"></span>
                            </div>
                            <input type="number" id="setMaxRetries" class="gpt-input" min="1" max="50">
                        </div>
                        <div class="gpt-input-group">
                            <div class="gpt-input-label">Default Video Goal
                                <span class="gpt-badge-sm" id="lblVideoGoal"></span>
                            </div>
                            <input type="number" id="setVideoGoal" class="gpt-input" min="1" max="50">
                        </div>
                    </div>

                    <!-- TIMING TAB -->
                    <div class="gpt-settings-panel" id="tab-timing">
                        <div class="gpt-input-group">
                            <div class="gpt-input-label">Retry Cooldown (ms)
                                <span class="gpt-badge-sm" id="lblCooldown"></span>
                            </div>
                            <input type="number" id="setCooldown" class="gpt-input" step="1000">
                        </div>
                         <div class="gpt-input-group">
                            <div class="gpt-input-label">Generation Delay (ms)
                                <span class="gpt-badge-sm" id="lblGenDelay"></span>
                            </div>
                            <input type="number" id="setGenDelay" class="gpt-input" step="1000">
                        </div>
                    </div>

                    <!-- ADVANCED TAB -->
                    <div class="gpt-settings-panel" id="tab-advanced">
                         <div class="gpt-row">
                            <span>Developer Mode</span>
                            <label class="gpt-toggle-switch">
                                <input type="checkbox" id="setDevMode">
                                <span class="gpt-slider"></span>
                            </label>
                        </div>
                         <div class="gpt-input-group" style="margin-top:8px;">
                            <div class="gpt-input-label">Prompt History Limit</div>
                            <input type="number" id="setHistoryLimit" class="gpt-input" min="1" max="200">
                        </div>
                         <div class="gpt-section" style="margin-top:12px; padding-top:12px; border-top:1px solid rgba(255,255,255,0.1);">
                            <div style="display:flex; gap:8px;">
                                <button id="btnExport" class="gpt-btn" style="flex:1">Export JSON</button>
                                <button id="btnImport" class="gpt-btn" style="flex:1">Import JSON</button>
                                <button id="btnReset" class="gpt-btn" style="background:#f4212e33; color:#f4212e; flex:1">Reset</button>
                            </div>
                             <input type="file" id="fileImport" accept=".json" style="display:none;" />
                        </div>
                    </div>
                </div>
                
                <div class="gpt-resize-handle"></div>
            `;
        document.body.appendChild(container);
        this.el = container;
        this.applyProviderUi();
    }

    hasProviderCapability(name) {
        if (ProviderRegistry && typeof ProviderRegistry.hasProviderCapability === 'function') {
            return ProviderRegistry.hasProviderCapability(this.provider, name);
        }
        return !!(this.provider && this.provider.capabilities && this.provider.capabilities[name]);
    }

    applyProviderUi() {
        if (!this.el) return;

        this.el.dataset.providerId = this.provider.id || 'unknown';
        const label = this.el.querySelector('#gptProviderLabel');
        if (label) label.textContent = `Provider: ${this.provider.label || 'Unsupported page'}`;

        const isGrok = isGrokProvider(this.provider);
        const show = (selector, visible) => {
            const element = this.el.querySelector(selector);
            if (element) element.style.display = visible ? '' : 'none';
        };

        show('#gptRecreateSection', isGrok && this.hasProviderCapability('canUseReferenceImage'));
        show('#gptAutoRetrySection', isGrok && this.hasProviderCapability('canRunVideoGoals'));
        show('#gptTemplateBatchSection', isGrok && this.hasProviderCapability('canRunBatch'));
        show('#gptQualityRepeatSection', isGrok && this.hasProviderCapability('canRunBatch'));
        show('#gptGalleryDownloadSection', isGrok && this.hasProviderCapability('canDownloadGeneratedImages'));
    }

    setupListeners() {
        const header = this.el.querySelector('#gptHeader');
        let isDragging = false, startX, startY, initialLeft, initialTop;
        header.addEventListener('mousedown', (e) => {
            if (e.target.closest('button')) return;
            isDragging = true;
            const rect = this.el.getBoundingClientRect();
            startX = e.clientX; startY = e.clientY;
            initialLeft = rect.left; initialTop = rect.top;
        });
        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            this.el.style.left = (initialLeft + (e.clientX - startX)) + 'px';
            this.el.style.top = (initialTop + (e.clientY - startY)) + 'px';
            this.el.style.bottom = 'auto'; this.el.style.right = 'auto';
        });
        document.addEventListener('mouseup', () => isDragging = false);

        // --- RESIZE LOGIC ---
        const resizeHandle = this.el.querySelector('.gpt-resize-handle');
        let isResizing = false, resizeStartX, startWidth;
        resizeHandle.addEventListener('mousedown', (e) => {
            isResizing = true;
            resizeStartX = e.clientX;
            startWidth = this.el.offsetWidth;
            e.stopPropagation();
            e.preventDefault();
        });
        document.addEventListener('mousemove', (e) => {
            if (!isResizing) return;
            const newWidth = startWidth + (e.clientX - resizeStartX);
            this.el.style.width = Math.max(300, newWidth) + 'px';
            // this.el.style.height = Math.max(200, newHeight) + 'px'; 
            this.state.width = Math.max(300, newWidth);
            // this.state.height = Math.max(200, newHeight);
        });
        document.addEventListener('mouseup', () => {
            if (isResizing) {
                isResizing = false;
                this.saveState();
            }
        });

        // UI Nav
        this.el.querySelector('#gptSettingsBtn').addEventListener('click', () => {
            this.populateSettingsForm();
            this.el.querySelector('#gptMainView').style.display = 'none';
            this.el.querySelector('#gptSettingsView').style.display = 'block';
        });
        this.el.querySelector('#gptBackBtn').addEventListener('click', () => {
            this.el.querySelector('#gptSettingsView').style.display = 'none';
            this.el.querySelector('#gptMainView').style.display = 'block';
        });
        this.el.querySelector('#gptMinBtn').addEventListener('click', (e) => {
            e.stopPropagation();
            this.minimize(true);
        });
        this.el.addEventListener('click', () => {
            if (this.state.minimized && !isDragging) this.minimize(false);
        });

        const tabHistory = this.el.querySelector('#tab-btn-history');
        const tabSaved = this.el.querySelector('#tab-btn-saved');
        const viewHistory = this.el.querySelector('#view-history');
        const viewSaved = this.el.querySelector('#view-saved');

        tabHistory.addEventListener('click', () => {
            tabHistory.classList.add('active'); tabSaved.classList.remove('active');
            viewHistory.style.display = 'block'; viewSaved.style.display = 'none';
        });
        tabSaved.addEventListener('click', () => {
            tabSaved.classList.add('active'); tabHistory.classList.remove('active');
            viewSaved.style.display = 'block'; viewHistory.style.display = 'none';
            this.renderSavedList();
        });

        const searchInput = this.el.querySelector('#gptHistorySearch');
        searchInput.addEventListener('input', (e) => {
            this.renderHistoryList(this.historyManager.history, e.target.value);
        });
        const savedSearchInput = this.el.querySelector('#gptSavedSearch');
        if (savedSearchInput) {
            savedSearchInput.addEventListener('input', (e) => {
                this.savedPromptSearch = e.target.value || '';
                this.renderSavedList();
            });
        }
        const savedPartialTab = this.el.querySelector('#gptSavedTypePartial');
        const savedFullTab = this.el.querySelector('#gptSavedTypeFull');
        if (savedPartialTab) {
            savedPartialTab.addEventListener('click', () => {
                this.savedPromptType = SAVED_PROMPT_TYPES.partial;
                this.renderSavedList();
            });
        }
        if (savedFullTab) {
            savedFullTab.addEventListener('click', () => {
                this.savedPromptType = SAVED_PROMPT_TYPES.full;
                this.renderSavedList();
            });
        }
        this.el.querySelector('#gptClearHistoryBtn').addEventListener('click', () => {
            if (confirm('Clear all prompt history?')) this.historyManager.clear();
        });
        this.setupChatGptNativeSubmitTracking();

        this.el.querySelectorAll('.gpt-settings-view .gpt-tab').forEach(t => {
            t.addEventListener('click', () => {
                this.el.querySelectorAll('.gpt-settings-view .gpt-tab').forEach(x => x.classList.remove('active'));
                this.el.querySelectorAll('.gpt-settings-panel').forEach(x => x.classList.remove('active'));
                t.classList.add('active');
                this.el.querySelector(`#tab-${t.dataset.tab}`).classList.add('active');
            });
        });

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
        if (this.recreatePasteHandler) {
            document.removeEventListener('paste', this.recreatePasteHandler);
        }
        this.recreatePasteHandler = async (event) => {
            if (!this.el || this.state.minimized || !this.isRecreatePasteTarget(event)) return;
            const item = Array.from(event.clipboardData?.items || [])
                .find((clipboardItem) => {
                    const type = String(clipboardItem.type || '');
                    return type.startsWith('image/') || type.startsWith('video/');
                });
            try {
                if (item) {
                    await this.setRecreateReferenceFromFile(item.getAsFile(), 'paste');
                    return;
                }

                const pastedText = String(event.clipboardData?.getData('text/plain') || '').trim();
                if (!pastedText) return;
                this.setRecreateReferenceFromUrl(pastedText);
            } catch (error) {
                this.setRecreateStatus(error.message || 'reference_invalid', 'error');
            }
        };
        document.addEventListener('paste', this.recreatePasteHandler);
        this.el.querySelector('#gptRecreateCurrentBtn').addEventListener('click', async () => {
            try {
                await this.setRecreateReferenceFromCurrentImage();
            } catch (error) {
                this.setRecreateStatus(`Current image: ${error.message || 'reference_missing'}`, 'error');
            }
        });
        this.el.querySelector('#gptRecreateStartBtn').addEventListener('click', () => {
            this.startRecreateWorkflow();
        });
        this.el.querySelector('#gptRecreateStopBtn').addEventListener('click', async () => {
            if (!this.recreateRunning) return;
            const chromeRuntime = getChromeRuntime();
            if (!chromeRuntime || typeof chromeRuntime.sendMessage !== 'function') {
                this.setRecreateStatus('workflow_unavailable', 'error');
                return;
            }
            try {
                const authority = await this.getOwnedWorkflowAuthority('recreate');
                if (!authority) {
                    this.setRecreateStatus('Recreate authority changed. Refresh this Grok tab.', 'error');
                    return;
                }
                this.recreateAbortRequested = true;
                this.setRecreateStopping(true);
                this.setRecreateStatus('Stopping...', 'info');
                const result = await safeChromeRuntimeSendMessage({
                    action: 'ABORT_GPT_RECREATE',
                    ...authority
                }, 'abort recreate workflow');
                if (result.invalidated) {
                    this.recreateAbortRequested = false;
                    this.setRecreateStopping(false);
                    this.setRecreateStatus(EXTENSION_CONTEXT_REFRESHED_MESSAGE, 'error');
                    return;
                }
                if (result.value?.aborted) {
                    const stopped = result.value.status === 'stopped'
                        || await this.waitForRecreateAuthorityClear();
                    if (!stopped) {
                        this.setRecreateStatus(
                            'Still stopping. Refresh this page before starting another Recreate.',
                            'error'
                        );
                        return;
                    }
                    const retrySafe = result.value.retrySafe === true
                        || result.value.retrySafeWhenStopped === true;
                    this.recreateUiRunSequence++;
                    this.recreateAbortRequested = false;
                    this.recreateRetryAvailable = !!this.recreateReference && retrySafe;
                    this.setRecreateRunning(false);
                    await this.refreshActiveWorkflowStatus();
                    this.setRecreateStatus(
                        retrySafe
                            ? 'Cancelled. Reference retained for retry.'
                            : 'Cancelled after submission. Verify the result before starting again.',
                        'neutral'
                    );
                }
            } catch (error) {
                this.recreateAbortRequested = false;
                this.setRecreateStopping(false);
                this.setRecreateStatus(error.message || 'Stop failed.', 'error');
            }
        });

        this.el.querySelector('#gptRetryToggle').addEventListener('change', (e) => this.settingsManager.set('autoRetryEnabled', e.target.checked));
        this.el.querySelector('#gptVideoGoal').addEventListener('change', (e) => this.settingsManager.set('videoGoal', parseInt(e.target.value)));
        this.el.querySelector('#gptGalleryLimit').addEventListener('change', (e) => {
            const limit = Math.max(1, parseInt(e.target.value, 10) || 1);
            e.target.value = limit;
            this.settingsManager.set('galleryBatchLimit', limit);
        });
        this.el.querySelector('#gptStartGoalBtn').addEventListener('click', async () => {
            const count = parseInt(this.el.querySelector('#gptVideoGoal').value, 10);
            await this.retryManager.startGoal(count);
        });
        this.el.querySelector('#gptQuickBatchBtn').addEventListener('click', async () => {
            const galleryLimit = Math.max(
                1,
                parseInt(this.el.querySelector('#gptGalleryLimit').value, 10) || 1
            );
            await this.retryManager.startBatch('quick', null, { galleryLimit });
        });
        this.el.querySelector('#gptPromptedBatchBtn').addEventListener('click', async () => {
            const prompt = this.readCurrentPromptInput();
            if (!prompt) {
                this.toast.show('Enter a prompt in the input bar before starting Prompted Batch', 'error');
                return;
            }
            const videoGoal = Math.max(1, parseInt(this.el.querySelector('#gptVideoGoal').value, 10) || 1);
            const galleryLimit = Math.max(1, parseInt(this.el.querySelector('#gptGalleryLimit').value, 10) || videoGoal);
            await this.retryManager.startBatch('prompted', prompt, { videoGoal, galleryLimit });
        });
        this.el.querySelector('#gptBatchStopBtn').addEventListener('click', async () => {
            await this.retryManager.stopBatch();
        });
        this.el.querySelector('#gptBatchResumeBtn').addEventListener('click', async () => {
            await this.retryManager.resumeGenerationRun();
        });
        this.el.querySelector('#gptBatchRetryFailedBtn').addEventListener('click', async () => {
            await this.retryManager.retryFailedGenerationRun();
        });
        this.el.querySelector('#gptBatchCancelRunBtn').addEventListener('click', async () => {
            await this.retryManager.stopBatch();
        });
        this.el.querySelector('#gptAddPromptBtn').addEventListener('click', () => this.saveCurrentPrompt(this.savedPromptType));

        // --- Template Batch ---
        this.templateBatchManager = new TemplateBatchManager(this.toast, this);
        this.el.querySelector('#gptTemplateBatchBtn').addEventListener('click', async () => {
            const count = parseInt(this.el.querySelector('#gptTemplateBatchCount').value, 10) || 10;
            const templateId = this.el.querySelector('#gptTemplateSelect').value;
            if (!templateId) {
                this.toast.show('Select a template', 'error');
                return;
            }
            const imageUrl = this.captureTemplateImageUrl();
            if (!imageUrl) {
                this.toast.show('Upload an image in the template dialog first', 'error');
                return;
            }
            this.el.querySelector('#gptTemplateBatchBtn').style.display = 'none';
            this.el.querySelector('#gptTemplateBatchStopBtn').style.display = '';
            await this.templateBatchManager.start(templateId, imageUrl, count);
            this.el.querySelector('#gptTemplateBatchBtn').style.display = '';
            this.el.querySelector('#gptTemplateBatchStopBtn').style.display = 'none';
        });
        this.el.querySelector('#gptTemplateBatchStopBtn').addEventListener('click', async () => {
            await this.templateBatchManager.stop();
            this.el.querySelector('#gptTemplateBatchBtn').style.display = '';
            this.el.querySelector('#gptTemplateBatchStopBtn').style.display = 'none';
        });
        // Quality Repeat controls
        this.el.querySelector('#gptQualityRepeatCount').addEventListener('input', (e) => {
            const count = Math.max(1, parseInt(e.target.value, 10) || 1);
            const calcEl = this.el.querySelector('#gptQualityRepeatCalc');
            if (calcEl) calcEl.textContent = '(x4 = ' + (count * 4) + ' images)';
        });
        this.el.querySelector('#gptQualityRepeatBtn').addEventListener('click', () => {
            const count = Math.max(1, parseInt(this.el.querySelector('#gptQualityRepeatCount').value, 10) || 5);
            this.retryManager.startQualityRepeat(count);
        });
        this.el.querySelector('#gptQualityRepeatStopBtn').addEventListener('click', async () => {
            await this.retryManager.stopQualityRepeat();
        });

        this.el.querySelector('#gptScrapeDownloadBtn').addEventListener('click', async () => {
            const btn = this.el.querySelector('#gptScrapeDownloadBtn');
            const stopBtn = this.el.querySelector('#gptScrapeStopBtn');
            const status = this.el.querySelector('#gptScrapeStatus');
            const entryLimit = normalizeSyncEntryLimit(btn.dataset.syncEntryLimit);
            delete btn.dataset.syncEntryLimit;
            btn.style.display = 'none';
            stopBtn.style.display = '';
            status.textContent = 'Starting gallery scan...';
            const result = await safeChromeRuntimeSendMessage({
                action: 'START_SCRAPE',
                ...(entryLimit ? { entryLimit } : {})
            }, 'start overlay scrape');
            if (result.invalidated || result.value?.status !== 'started') {
                btn.style.display = '';
                stopBtn.style.display = 'none';
                status.textContent = result.value?.error || EXTENSION_CONTEXT_REFRESHED_MESSAGE;
            }
            await this.refreshActiveWorkflowStatus();
        });
        this.el.querySelector('#gptScrapeStopBtn').addEventListener('click', async () => {
            const btn = this.el.querySelector('#gptScrapeDownloadBtn');
            const stopBtn = this.el.querySelector('#gptScrapeStopBtn');
            const status = this.el.querySelector('#gptScrapeStatus');
            const authority = await this.getOwnedWorkflowAuthority('sync');
            if (!authority) {
                status.textContent = 'Sync authority changed. Refresh this Grok tab.';
                return;
            }
            btn.style.display = 'none';
            stopBtn.style.display = '';
            stopBtn.disabled = true;
            status.textContent = 'Stopping...';
            const result = await safeChromeRuntimeSendMessage({
                action: 'STOP_SCRAPE',
                ...authority
            }, 'stop overlay scrape');
            if (!result.invalidated && result.value?.status === 'stopped') {
                await this.refreshActiveWorkflowStatus();
                btn.style.display = '';
                stopBtn.style.display = 'none';
                stopBtn.disabled = false;
                status.textContent = result.value.refreshOwnerRecommended
                    ? 'Stopped. Refresh this Grok tab before starting another run.'
                    : 'Stopped.';
                return;
            }
            await this.refreshActiveWorkflowStatus();
            stopBtn.disabled = false;
            status.textContent = result.value?.status === 'stopping'
                ? 'Still stopping. Refresh this Grok tab if Retry Stop does not clear it.'
                : (result.value?.error || EXTENSION_CONTEXT_REFRESHED_MESSAGE);
        });

        const bindInput = (id, key, type = 'int') => {
            this.el.querySelector('#' + id).addEventListener('change', (e) => {
                let val = e.target.value;
                if (type === 'int') val = parseInt(val, 10);
                if (type === 'bool') val = e.target.checked;
                this.settingsManager.set(key, val);
                this.toast.show('Setting Saved', 'success');
                this.populateSettingsForm();
            });
        };
        bindInput('setMaxRetries', 'maxRetries');
        bindInput('setVideoGoal', 'videoGoal');
        bindInput('setCooldown', 'retryCooldown');
        bindInput('setGenDelay', 'generationDelay');
        bindInput('setHistoryLimit', 'historyLimit');
        bindInput('setDevMode', 'devMode', 'bool');

        this.el.querySelector('#btnExport').addEventListener('click', () => {
            const json = this.settingsManager.export();
            const blob = new Blob([json], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url; a.download = 'grok_settings.json';
            a.click();
        });
        this.el.querySelector('#btnReset').addEventListener('click', () => {
            if (confirm('Reset all settings?')) {
                this.settingsManager.reset();
                this.populateSettingsForm();
                this.toast.show('Settings Reset', 'success');
            }
        });
        this.el.querySelector('#btnImport').addEventListener('click', () => this.el.querySelector('#fileImport').click());
        this.el.querySelector('#fileImport').addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (ev) => {
                if (this.settingsManager.import(ev.target.result)) {
                    this.populateSettingsForm();
                    this.toast.show('Settings Imported', 'success');
                } else {
                    this.toast.show('Import Failed', 'error');
                }
            };
            reader.readAsText(file);
        });
    }

    populateSettingsForm() {
        const s = this.settingsManager.settings;
        const setVal = (id, val, textId) => {
            const el = this.el.querySelector('#' + id);
            if (el) el.value = val;
            const txt = this.el.querySelector('#' + textId);
            if (txt) txt.textContent = val;
        };
        setVal('setMaxRetries', s.maxRetries, 'lblMaxRetries');
        setVal('setVideoGoal', s.videoGoal, 'lblVideoGoal');
        setVal('setCooldown', s.retryCooldown, 'lblCooldown');
        setVal('setGenDelay', s.generationDelay, 'lblGenDelay');
        this.el.querySelector('#setHistoryLimit').value = s.historyLimit;
        this.el.querySelector('#setDevMode').checked = s.devMode;

        const mainGoal = this.el.querySelector('#gptVideoGoal');
        const galleryLimit = this.el.querySelector('#gptGalleryLimit');
        if (mainGoal && !this.retryManager.goalRunning) mainGoal.value = s.videoGoal;
        if (galleryLimit && !this.retryManager.batchRunning) galleryLimit.value = s.galleryBatchLimit || s.videoGoal || 1;
    }

    minimize(isMin) {
        this.state.minimized = isMin;
        this.el.classList.toggle('minimized', isMin);
        this.saveState();
    }
    setDevMode(enabled) {
        if (enabled && !this.logViewer) {
            this.logViewer = new LogViewer();
            this.logViewer.addLog('Dev Mode Active');
        } else if (!enabled && this.logViewer) {
            this.logViewer.destroy();
            this.logViewer = null;
        }
    }
    setStatus(msg, type) {
        const badge = this.el.querySelector('#gptStatusBadge');
        if (badge) { badge.textContent = msg; badge.className = `gpt-badge gpt-badge-${type}`; }
        if (this.logViewer) this.logViewer.addLog(msg, type);
    }

    handleExtensionContextInvalidated() {
        this.recreateAbortRequested = true;
        this.templateBatchManager?.stop();
        [
            '#gptRecreateStartBtn',
            '#gptRecreateStopBtn',
            '#gptStartGoalBtn',
            '#gptQuickBatchBtn',
            '#gptPromptedBatchBtn',
            '#gptBatchStopBtn',
            '#gptBatchResumeBtn',
            '#gptBatchRetryFailedBtn',
            '#gptBatchCancelRunBtn',
            '#gptTemplateBatchBtn',
            '#gptTemplateBatchStopBtn',
            '#gptQualityRepeatBtn',
            '#gptQualityRepeatStopBtn',
            '#gptScrapeDownloadBtn',
            '#gptScrapeStopBtn'
        ].forEach((selector) => {
            const control = this.el?.querySelector(selector);
            if (control) control.disabled = true;
        });
        showExtensionContextRefreshed(this);
    }

    setWorkflowMessage(element, message) {
        if (!element) return;
        if (element.dataset.workflowMessage !== 'true') {
            element.dataset.workflowPreviousText = element.textContent || '';
        }
        element.dataset.workflowMessage = 'true';
        element.textContent = message;
    }

    clearWorkflowMessage(element) {
        if (!element || element.dataset.workflowMessage !== 'true') return;
        element.textContent = element.dataset.workflowPreviousText || '';
        delete element.dataset.workflowMessage;
        delete element.dataset.workflowPreviousText;
    }

    applyActiveWorkflowStatus(response) {
        const normalized = response && typeof response === 'object'
            ? response
            : { status: 'idle', activeWorkflow: null };
        this.activeWorkflowStatus = normalized;
        const workflow = normalized.status === 'active' || normalized.status === 'conflict'
            ? normalized.activeWorkflow
            : null;
        const activeKind = workflow?.kind || '';
        const activeLabel = getMutatingWorkflowLabel(activeKind);
        const isGeneration = GENERATION_MUTATING_WORKFLOW_KINDS.has(activeKind);
        const isOwner = workflow?.isOwner === true;
        const blockedSuffix = isOwner ? '' : ' in another Grok tab';

        const generationButtons = [
            '#gptStartGoalBtn',
            '#gptQuickBatchBtn',
            '#gptPromptedBatchBtn'
        ];
        generationButtons.forEach((selector) => {
            const button = this.el?.querySelector(selector);
            if (button) button.disabled = Boolean(workflow);
        });
        const batchStatus = this.el?.querySelector('#gptBatchStatus');
        if (workflow && !isGeneration) {
            if (batchStatus) batchStatus.style.display = 'block';
            this.setWorkflowMessage(batchStatus, `Generation blocked by ${activeLabel}${blockedSuffix}.`);
        } else {
            this.clearWorkflowMessage(batchStatus);
            if (batchStatus && !this.retryManager?.batchRunning && !this.retryManager?.goalRunning) {
                batchStatus.style.display = 'none';
            }
        }

        const recreateStart = this.el?.querySelector('#gptRecreateStartBtn');
        const recreateStop = this.el?.querySelector('#gptRecreateStopBtn');
        const recreateStatus = this.el?.querySelector('#gptRecreateStatus');
        if (activeKind === 'recreate' && isOwner) {
            this.setRecreateRunning(true);
            this.setRecreateStopping(workflow.status === 'stopping');
            this.setWorkflowMessage(
                recreateStatus,
                workflow.status === 'stopping'
                    ? 'Recreate is still stopping. Refresh this Grok tab if it does not clear.'
                    : `Recreate active: ${workflow.phase || 'workflow'}.`
            );
        } else if (workflow) {
            if (recreateStart) recreateStart.disabled = true;
            if (recreateStop && !this.recreateRunning) recreateStop.style.display = 'none';
            this.setWorkflowMessage(recreateStatus, `Recreate blocked by ${activeLabel}${blockedSuffix}.`);
        } else {
            if (recreateStart) recreateStart.disabled = false;
            this.clearWorkflowMessage(recreateStatus);
            this.setRecreateRunning(false);
        }

        const scrapeStart = this.el?.querySelector('#gptScrapeDownloadBtn');
        const scrapeStop = this.el?.querySelector('#gptScrapeStopBtn');
        const scrapeStatus = this.el?.querySelector('#gptScrapeStatus');
        if (activeKind === 'sync' && isOwner) {
            if (scrapeStart) scrapeStart.style.display = 'none';
            if (scrapeStop) {
                scrapeStop.style.display = '';
                scrapeStop.disabled = false;
                scrapeStop.textContent = workflow.status === 'stopping' ? 'Retry Stop' : 'Stop';
            }
            this.setWorkflowMessage(
                scrapeStatus,
                workflow.status === 'stopping'
                    ? 'Sync is still stopping. Refresh this Grok tab if it does not clear.'
                    : 'Sync active.'
            );
        } else if (workflow) {
            if (scrapeStart) {
                scrapeStart.style.display = '';
                scrapeStart.disabled = true;
            }
            if (scrapeStop) scrapeStop.style.display = 'none';
            this.setWorkflowMessage(scrapeStatus, `Gallery Sync blocked by ${activeLabel}${blockedSuffix}.`);
        } else {
            if (scrapeStart) {
                scrapeStart.style.display = '';
                scrapeStart.disabled = false;
            }
            if (scrapeStop) {
                scrapeStop.style.display = 'none';
                scrapeStop.disabled = false;
                scrapeStop.textContent = 'Stop';
            }
            this.clearWorkflowMessage(scrapeStatus);
        }

        ['#gptTemplateBatchBtn', '#gptQualityRepeatBtn'].forEach((selector) => {
            const button = this.el?.querySelector(selector);
            if (button) button.disabled = Boolean(workflow);
        });
        return normalized;
    }

    async refreshActiveWorkflowStatus() {
        if (this.activeWorkflowRefreshPromise) return this.activeWorkflowRefreshPromise;
        this.activeWorkflowRefreshPromise = (async () => {
            const result = await safeChromeRuntimeSendMessage(
                { action: 'GET_ACTIVE_WORKFLOW_STATUS' },
                'load active workflow status'
            );
            if (result.invalidated) {
                this.handleExtensionContextInvalidated();
                return null;
            }
            return this.applyActiveWorkflowStatus(result.value);
        })();
        try {
            return await this.activeWorkflowRefreshPromise;
        } finally {
            this.activeWorkflowRefreshPromise = null;
        }
    }

    async getOwnedWorkflowAuthority(kind) {
        const status = await this.refreshActiveWorkflowStatus();
        const workflow = status?.activeWorkflow;
        if (status?.status !== 'active'
            || workflow?.kind !== kind
            || workflow?.isOwner !== true
            || !workflow.authority) {
            return null;
        }
        return { ...workflow.authority };
    }

    setChatGptStatus(text, type = 'neutral') {
        this.setStatus(text, type === 'info' ? 'neutral' : type);
    }

    setChatGptRunning(running) {
        this.chatGptImageRunning = !!running;
    }

    async appendProviderRun(entry) {
        if (!this.providerRunLedger || typeof this.providerRunLedger.appendProviderRunLedgerEntry !== 'function') {
            return null;
        }
        try {
            const result = await safeChromeRuntimeSendMessage({
                action: 'PROVIDER_RUN_LEDGER_APPEND',
                entry
            }, 'append provider run');
            if (result.invalidated) {
                showExtensionContextRefreshed(this);
                return null;
            }
            if (result.value?.status !== 'ok') {
                throw new Error(result.value?.error || 'provider_run_ledger_failed');
            }
            return result.value.entry || null;
        } catch (error) {
            if (isExtensionContextInvalidatedError(error)) {
                showExtensionContextRefreshed(this);
                return null;
            }
            throw error;
        }
    }

    setupChatGptNativeSubmitTracking() {
        if (!isChatGptImagesProvider(this.provider)) return;

        document.addEventListener('click', (event) => {
            if (this.chatGptImageRunning) return;
            const actions = this.chatGptActions;
            if (!actions || typeof actions.findChatGptSendButton !== 'function') return;

            const clickedButton = event.target && event.target.closest
                ? event.target.closest('button')
                : null;
            const sendButton = actions.findChatGptSendButton();
            if (!clickedButton || !sendButton || clickedButton !== sendButton) return;
            if (sendButton.disabled || sendButton.getAttribute('aria-disabled') === 'true') return;

            const prompt = this.readCurrentPromptInput();
            if (!prompt) return;

            const before = typeof actions.createChatGptResultSnapshot === 'function'
                ? actions.createChatGptResultSnapshot()
                : null;
            setTimeout(() => {
                this.startChatGptImageWorkflow({ prompt, before, alreadySubmitted: true });
            }, 0);
        }, true);
    }

    async startChatGptImageWorkflow(options = {}) {
        if (!isChatGptImagesProvider(this.provider) || this.chatGptImageRunning) return;

        const prompt = sanitizeSavedPromptText(options.prompt || this.readCurrentPromptInput());
        if (!prompt) {
            this.setChatGptStatus('Enter a prompt first.', 'error');
            this.toast.show('Enter a prompt first.', 'error');
            return;
        }

        const actions = this.chatGptActions;
        if (!actions || typeof actions.runChatGptImagePrompt !== 'function') {
            this.setChatGptStatus('workflow_unavailable', 'error');
            return;
        }

        const runId = this.providerRunLedger && typeof this.providerRunLedger.createProviderRunId === 'function'
            ? this.providerRunLedger.createProviderRunId()
            : `provider_run_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;

        this.setChatGptRunning(true);
        this.setChatGptStatus('Submitting...', 'info');
        this.setStatus('Submitting', 'neutral');

        try {
            await this.appendProviderRun({
                runId,
                providerId: 'chatgpt-images',
                workflow: 'text-to-image',
                prompt,
                status: 'submitted'
            });

            const result = options.alreadySubmitted && typeof actions.waitForChatGptResultDelta === 'function'
                ? await actions.waitForChatGptResultDelta(options.before, { runId, prompt })
                : await actions.runChatGptImagePrompt({ prompt, runId });
            this.historyManager.add(prompt, 'image');
            await this.appendProviderRun({
                runId,
                providerId: 'chatgpt-images',
                workflow: 'text-to-image',
                prompt,
                status: 'generated',
                result: result && result.result ? result.result : null,
                diagnostics: {
                    submitted: !!(result && result.submitted)
                }
            });
            this.setChatGptStatus('Generated image ready', 'success');
            this.setStatus('Generated image ready', 'success');
        } catch (error) {
            const failureCode = error && (error.code || error.message) ? (error.code || error.message) : 'chatgpt_generation_failed';
            await this.appendProviderRun({
                runId,
                providerId: 'chatgpt-images',
                workflow: 'text-to-image',
                prompt,
                status: failureCode === 'chatgpt_blocked' ? 'blocked' : 'failed',
                failureCode
            });
            this.setChatGptStatus(failureCode, 'error');
            this.setStatus('Failed', 'error');
        } finally {
            this.setChatGptRunning(false);
        }
    }

    async loadSavedPrompts() {
        const storedResult = await safeChromeStorageGet('local', ['savedPrompts'], {}, 'load saved prompts');
        if (storedResult.invalidated) {
            showExtensionContextRefreshed(this);
            return;
        }
        const stored = storedResult.value;
        const original = Array.isArray(stored.savedPrompts) ? stored.savedPrompts : [];
        const normalized = normalizeSavedPrompts(original);
        const migrated = JSON.stringify(original) !== JSON.stringify(normalized);

        this.savedPrompts = normalized;
        if (migrated) {
            const result = await mutateSavedPromptsStorage('normalize');
            if (result.invalidated) {
                showExtensionContextRefreshed(this);
                return;
            }
            if (!result.ok) {
                this.toast.show('Saved prompts could not be migrated', 'error');
                return;
            }
            this.savedPrompts = normalizeSavedPrompts(result.savedPrompts);
        }
        this.renderSavedList();
    }

    renderSavedList(prompts = this.savedPrompts) {
        this.savedPrompts = normalizeSavedPrompts(prompts);
        const list = this.el.querySelector('#gptPromptList');
        const searchInput = this.el.querySelector('#gptSavedSearch');
        const addBtn = this.el.querySelector('#gptAddPromptBtn');
        const partialTab = this.el.querySelector('#gptSavedTypePartial');
        const fullTab = this.el.querySelector('#gptSavedTypeFull');
        if (!list) return;

        if (searchInput && searchInput.value !== this.savedPromptSearch) {
            searchInput.value = this.savedPromptSearch;
        }
        if (addBtn) {
            addBtn.textContent = this.savedPromptType === SAVED_PROMPT_TYPES.partial
                ? '+ Add Prompt Partial'
                : '+ Save Full Prompt';
        }
        if (partialTab) partialTab.classList.toggle('active', this.savedPromptType === SAVED_PROMPT_TYPES.partial);
        if (fullTab) fullTab.classList.toggle('active', this.savedPromptType === SAVED_PROMPT_TYPES.full);

        const filtered = filterSavedPrompts(this.savedPrompts, this.savedPromptType, this.savedPromptSearch);
        list.innerHTML = '';
        if (filtered.length === 0) {
            const emptyState = document.createElement('div');
            emptyState.style.cssText = 'display:flex; flex-direction:column; align-items:center; gap:8px; padding:12px;';

            const msg = document.createElement('div');
            msg.textContent = this.savedPromptType === SAVED_PROMPT_TYPES.partial
                ? 'No saved partials'
                : 'No saved full prompts';
            msg.style.cssText = 'font-size:11px; color:#71767b;';

            const loadBtn = document.createElement('button');
            loadBtn.className = 'gpt-btn';
            loadBtn.textContent = 'Load Examples';
            loadBtn.style.fontSize = '11px';
            loadBtn.style.padding = '4px 8px';
            loadBtn.onclick = () => this.loadExamplePrompts();

            emptyState.appendChild(msg);
            emptyState.appendChild(loadBtn);
            list.appendChild(emptyState);
            return;
        }

        filtered.forEach((item) => {
            const wrapper = document.createElement('div');
            wrapper.className = 'gpt-saved-item';

            const main = document.createElement('button');
            main.className = 'gpt-prompt-tag gpt-saved-main';
            main.textContent = item.name || item.text.substring(0, 24);
            main.title = item.text;
            main.onclick = () => this.injectPrompt(
                item.text,
                item.type === SAVED_PROMPT_TYPES.full ? 'replace' : 'append'
            );

            const actions = document.createElement('div');
            actions.className = 'gpt-prompt-actions';

            const edit = document.createElement('button');
            edit.className = 'gpt-prompt-action';
            edit.textContent = 'Edit';
            edit.onclick = (e) => {
                e.stopPropagation();
                this.editSavedPrompt(item.id);
            };

            const del = document.createElement('button');
            del.className = 'gpt-prompt-action danger';
            del.textContent = 'Delete';
            del.onclick = (e) => {
                e.stopPropagation();
                this.deleteSavedPrompt(item.id);
            };

            actions.appendChild(edit);
            actions.appendChild(del);
            wrapper.appendChild(main);
            wrapper.appendChild(actions);
            list.appendChild(wrapper);
        });
    }

    renderHistoryList(history, search = '') {
        const list = this.el.querySelector('#gptHistoryList');
        if (!list) return;
        list.innerHTML = '';
        let filtered = history;
        if (search) {
            const q = search.toLowerCase();
            filtered = history.filter(h => h.text.toLowerCase().includes(q));
        }
        if (filtered.length === 0) {
            list.innerHTML = '<div style="font-size:11px; color:#71767b; text-align:center; padding:12px;">No history found</div>';
            return;
        }
        filtered.forEach(h => {
            const item = document.createElement('div');
            item.className = 'gpt-history-item';
            item.onclick = () => this.injectPrompt(h.text, 'replace');

            const timeStr = new Date(h.timestamp).toLocaleTimeString();
            const typeIcon = h.type === 'video' ? '🎥' : '🖼️';
            const typeClass = h.type === 'video' ? 'video' : 'image';

            const text = document.createElement('div');
            text.className = 'gpt-history-text';
            text.textContent = h.text;
            const meta = document.createElement('div');
            meta.className = 'gpt-history-meta';
            const type = document.createElement('span');
            type.className = `gpt-history-type ${typeClass}`;
            type.textContent = typeIcon;
            const time = document.createElement('span');
            time.textContent = timeStr;
            meta.append(type, time);
            item.append(text, meta);
            list.appendChild(item);
        });
    }

    async mutateSavedPrompts(operation, payload = {}) {
        const result = await mutateSavedPromptsStorage(operation, payload);
        if (result.invalidated) {
            showExtensionContextRefreshed(this);
            return false;
        }
        if (!result.ok) {
            this.toast.show(result.error || 'Saved prompt change failed', 'error');
            return false;
        }
        this.savedPrompts = normalizeSavedPrompts(result.savedPrompts);
        this.renderSavedList();
        return true;
    }

    async saveCurrentPrompt(type = SAVED_PROMPT_TYPES.partial) {
        const text = sanitizeSavedPromptText(this.readCurrentPromptInput());
        if (!text) {
            this.toast.show('Input is empty!', 'error');
            return;
        }

        const normalizedType = normalizeSavedPromptType(type);
        const defaultName = sanitizeSavedPromptName('', text);
        const label = normalizedType === SAVED_PROMPT_TYPES.partial ? 'prompt partial' : 'full prompt';
        const nameInput = prompt(`Name for this ${label}:`, defaultName);
        if (nameInput === null) return;

        const now = Date.now();
        const item = {
            id: createSavedPromptId(),
            name: sanitizeSavedPromptName(nameInput, text),
            text,
            type: normalizedType,
            createdAt: now,
            updatedAt: now
        };

        if (!await this.mutateSavedPrompts('add', { item })) return;
        this.toast.show(normalizedType === SAVED_PROMPT_TYPES.partial ? 'Partial Saved' : 'Prompt Saved', 'success');
    }

    async editSavedPrompt(itemId) {
        const index = this.savedPrompts.findIndex((item) => item.id === itemId);
        if (index === -1) return;

        const current = this.savedPrompts[index];
        const nextName = prompt('Edit saved prompt name:', current.name);
        if (nextName === null) return;
        const nextTextRaw = prompt('Edit saved prompt text:', current.text);
        if (nextTextRaw === null) return;
        const nextText = sanitizeSavedPromptText(nextTextRaw);
        if (!nextText) {
            this.toast.show('Prompt text cannot be empty', 'error');
            return;
        }

        const nextTypeRaw = prompt('Type ("partial" or "full"):', current.type);
        if (nextTypeRaw === null) return;

        const nextType = normalizeSavedPromptType(String(nextTypeRaw || '').trim().toLowerCase());
        const updated = {
            ...current,
            name: sanitizeSavedPromptName(nextName, nextText),
            text: nextText,
            type: nextType,
            updatedAt: Date.now()
        };

        if (!await this.mutateSavedPrompts('update', { itemId, item: updated })) return;
        this.toast.show('Saved prompt updated', 'success');
    }

    async deleteSavedPrompt(itemId) {
        const target = this.savedPrompts.find((item) => item.id === itemId);
        if (!target) return;
        if (!confirm(`Delete "${target.name}"?`)) return;

        if (!await this.mutateSavedPrompts('delete', { itemId })) return;
        this.toast.show('Saved prompt deleted', 'success');
    }

    async loadExamplePrompts() {
        if (!confirm('Load example prompts?')) return;
        const now = Date.now();
        const examples = [
            {
                id: createSavedPromptId(),
                name: 'Cinematic Camera Style',
                text: 'cinematic lighting, dramatic shadows, 35mm lens look',
                type: SAVED_PROMPT_TYPES.partial,
                createdAt: now,
                updatedAt: now
            },
            {
                id: createSavedPromptId(),
                name: 'Loopable Motion Prompt',
                text: 'smooth dolly-in movement, subtle subject motion, seamless loop ending',
                type: SAVED_PROMPT_TYPES.full,
                createdAt: now,
                updatedAt: now
            }
        ];
        if (!await this.mutateSavedPrompts('merge', { items: examples })) return;
        this.toast.show('Examples Loaded', 'success');
    }

    readCurrentPromptInput() {
        if (isChatGptImagesProvider(this.provider) && this.chatGptActions && typeof this.chatGptActions.readChatGptPromptInput === 'function') {
            const chatGptPrompt = this.chatGptActions.readChatGptPromptInput();
            if (chatGptPrompt) return chatGptPrompt;
        }

        const composer = resolveVisibleGrokComposer();
        if (composer instanceof HTMLTextAreaElement && composer.value && composer.value.trim()) {
            return composer.value.trim();
        }
        if (composer && composer.textContent && composer.textContent.trim()) return composer.textContent.trim();
        return '';
    }

    captureTemplateImageUrl() {
        const isTrustedUploadUrl = (value) => {
            try {
                const url = new URL(String(value || ''));
                return url.protocol === 'https:'
                    && url.hostname === 'assets.grok.com'
                    && url.pathname.startsWith('/users/')
                    && !url.pathname.includes('/share-images/')
                    && !url.pathname.includes('/share-videos/');
            } catch {
                return false;
            }
        };
        const visibleDialogs = Array.from(document.querySelectorAll('[role="dialog"]')).filter((dialog) => {
            const rect = dialog.getBoundingClientRect();
            return dialog.isConnected && rect.width > 0 && rect.height > 0;
        });
        if (visibleDialogs.length !== 1) {
            delete window._lastUploadedImageReceipt;
            return null;
        }
        const dialog = visibleDialogs[0];
        const imageUrls = Array.from(new Set(
            Array.from(dialog.querySelectorAll('img'))
                .map((image) => image.currentSrc || image.src || '')
                .filter(isTrustedUploadUrl)
        ));
        if (imageUrls.length === 1) {
            delete window._lastUploadedImageReceipt;
            return imageUrls[0];
        }
        if (imageUrls.length > 1) {
            delete window._lastUploadedImageReceipt;
            return null;
        }

        const receipt = window._lastUploadedImageReceipt;
        const receiptValid = receipt
            && receipt.dialog === dialog
            && dialog.isConnected
            && Date.now() - Number(receipt.capturedAt || 0) <= 10 * 60 * 1000
            && isTrustedUploadUrl(receipt.imageUrl);
        delete window._lastUploadedImageReceipt;
        if (receiptValid) return receipt.imageUrl;
        return null;
    }

    getRecreateActions() {
        const actions = typeof window !== 'undefined' ? window.GrokRecreateContentActions : null;
        if (!actions) throw new Error('workflow_unavailable');
        return actions;
    }

    getRecreateUtils() {
        const utils = typeof window !== 'undefined' ? window.GrokRecreateWorkflowUtils : null;
        if (!utils) throw new Error('workflow_unavailable');
        return utils;
    }

    validateRecreateFile(file) {
        if (!file) throw new Error('reference_missing');

        const utils = this.getRecreateUtils();
        const allowedTypes = Array.isArray(utils.ALLOWED_RECREATE_MIME_TYPES)
            ? utils.ALLOWED_RECREATE_MIME_TYPES
            : [];
        const mediaKind = typeof utils.getReferenceKindFromMimeType === 'function'
            ? utils.getReferenceKindFromMimeType(file.type)
            : (String(file.type || '').startsWith('video/') ? 'video' : 'image');
        const maxBytes = mediaKind === 'video'
            ? Number(utils.MAX_VIDEO_REFERENCE_BYTES) || 0
            : Number(utils.MAX_REFERENCE_BYTES) || 0;

        if (!allowedTypes.includes(file.type) || file.size <= 0 || (maxBytes > 0 && file.size > maxBytes)) {
            throw new Error('reference_invalid');
        }
    }

    getRecreateReferenceKind() {
        return this.recreateReference && this.recreateReference.kind === 'video' ? 'video' : 'image';
    }

    isRecreatePasteTarget(event) {
        const section = this.el.querySelector('#gptRecreateSection');
        if (!section) return false;

        const target = event && event.target;
        const activeElement = document.activeElement;
        return (target && section.contains(target)) || (activeElement && section.contains(activeElement));
    }

    formatRecreateStatus(response, fallback = 'Recreate workflow failed.') {
        if (response?.activeWorkflow?.kind) {
            return `Recreate blocked by ${getMutatingWorkflowLabel(response.activeWorkflow.kind)}.`;
        }
        if (!response || !response.error) return fallback;
        if (response.phase && response.phase !== 'done') return `${response.phase}: ${response.error}`;
        return response.error;
    }

    setRecreateStatus(text, type = 'neutral') {
        const message = text || '';
        const status = this.el.querySelector('#gptRecreateStatus');
        const colors = {
            error: '#f4212e',
            success: '#22c55e',
            info: '#1d9bf0',
            neutral: '#71767b'
        };
        if (status) {
            status.textContent = message;
            status.style.color = colors[type] || colors.neutral;
        }
        if (type === 'error') this.toast.show(message, 'error');
        else if (type === 'success') this.toast.show(message, 'success');
    }

    handleRecreateStatus(request = {}) {
        const runId = String(request.runId || '');
        if (this.recreateActiveRunId && runId && this.recreateActiveRunId !== runId) return;
        if (runId) this.recreateActiveRunId = runId;
        const message = request.phase && request.phase !== 'done'
            ? `${request.phase}: ${request.message || request.error || ''}`
            : (request.message || request.error || '');
        this.setRecreateStatus(message, request.type || 'info');
        if (request.terminal !== true) return;

        this.recreateAbortRequested = false;
        this.recreateRetryAvailable = !!this.recreateReference && request.retrySafe === true;
        this.recreateActiveRunId = '';
        this.setRecreateRunning(false);
        this.refreshActiveWorkflowStatus().catch(() => {});
    }

    setRecreateRunning(running) {
        this.recreateRunning = !!running;
        const startBtn = this.el.querySelector('#gptRecreateStartBtn');
        const stopBtn = this.el.querySelector('#gptRecreateStopBtn');
        if (startBtn) {
            startBtn.style.display = running ? 'none' : '';
            startBtn.textContent = this.recreateRetryAvailable ? 'Retry Recreate' : 'Start Recreate';
        }
        if (stopBtn) {
            stopBtn.style.display = running ? '' : 'none';
            stopBtn.disabled = false;
            stopBtn.textContent = 'Stop';
        }
        [
            '#gptStartGoalBtn',
            '#gptQuickBatchBtn',
            '#gptPromptedBatchBtn',
            '#gptScrapeDownloadBtn',
            '#gptTemplateBatchBtn',
            '#gptQualityRepeatBtn'
        ].forEach((selector) => {
            const control = this.el.querySelector(selector);
            if (control) control.disabled = !!running;
        });
    }

    setRecreateStopping(stopping) {
        const stopBtn = this.el.querySelector('#gptRecreateStopBtn');
        if (!stopBtn) return;
        stopBtn.disabled = !!stopping;
        stopBtn.textContent = stopping ? 'Stopping...' : 'Stop';
    }

    async waitForRecreateAuthorityClear(timeoutMs = 15000) {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            const result = await safeChromeRuntimeSendMessage(
                { action: 'GET_GPT_RECREATE_STATUS' },
                'check recreate workflow status'
            );
            if (result.invalidated) return false;
            if (result.value?.ok !== true) return false;
            if (!result.value.activeRun) return true;
            await new Promise((resolve) => setTimeout(resolve, 250));
        }
        return false;
    }

    async setRecreateReferenceFromFile(file, source) {
        this.recreateReference = null;
        this.validateRecreateFile(file);

        const actions = this.getRecreateActions();
        if (typeof actions.readFileAsRecreateReference !== 'function') throw new Error('workflow_unavailable');

        this.recreateReference = await actions.readFileAsRecreateReference(file, source);
        this.recreateRetryAvailable = false;
        const byteLength = Number(this.recreateReference && this.recreateReference.byteLength) || 0;
        const sizeText = byteLength > 0 ? ` (${Math.round(byteLength / 1024)} KB)` : '';
        this.setRecreateStatus(`Selected ${this.getRecreateReferenceKind()}: ${this.recreateReference.name}${sizeText}`, 'success');
    }

    async setRecreateReferenceFromCurrentImage() {
        this.recreateReference = null;
        const actions = this.getRecreateActions();
        const selectCurrent = actions.selectCurrentGeneratedMedia || actions.selectCurrentGeneratedImage;
        if (typeof selectCurrent !== 'function') throw new Error('workflow_unavailable');

        const sourcePostIdHint = getCurrentGrokSourcePostIdHint();
        this.recreateReference = await selectCurrent(
            sourcePostIdHint ? { sourcePostIdHint } : {}
        );
        this.recreateRetryAvailable = false;
        this.setRecreateStatus(`Selected current Grok ${this.getRecreateReferenceKind()}.`, 'success');
    }

    setRecreateReferenceFromUrl(url) {
        this.recreateReference = null;
        const utils = this.getRecreateUtils();
        const value = String(url || '').trim();
        if (
            !value ||
            !(
                typeof utils.isTrustedGrokPostUrl === 'function' && utils.isTrustedGrokPostUrl(value) ||
                typeof utils.isTrustedGrokVideoUrl === 'function' && utils.isTrustedGrokVideoUrl(value)
            )
        ) {
            throw new Error('reference_invalid');
        }

        const source = typeof utils.isTrustedGrokPostUrl === 'function' && utils.isTrustedGrokPostUrl(value)
            ? 'grok-post-url'
            : 'grok-video-url';
        this.recreateReference = utils.normalizeRecreateReference({
            kind: 'video',
            name: source === 'grok-post-url' ? 'grok-post-video.mp4' : 'grok-reference-video.mp4',
            url: value,
            source
        });
        this.recreateRetryAvailable = false;
        this.setRecreateStatus(source === 'grok-post-url' ? 'Selected Grok post video URL.' : 'Selected Grok video URL.', 'success');
    }

    async startRecreateWorkflow() {
        if (this.recreateRunning) return;

        if (!this.recreateReference) {
            this.setRecreateStatus('Select a reference media file first.', 'error');
            return;
        }

        const chromeRuntime = getChromeRuntime();
        if (!chromeRuntime || typeof chromeRuntime.sendMessage !== 'function') {
            this.setRecreateStatus('workflow_unavailable', 'error');
            return;
        }

        this.recreateAbortRequested = false;
        this.recreateActiveRunId = '';
        const uiRunSequence = ++this.recreateUiRunSequence;
        this.setRecreateRunning(true);
        this.setRecreateStatus('Starting recreate workflow...', 'info');
        let acknowledgedRun = false;

        try {
            const bestPracticesEnabled = !!this.el.querySelector('#gptRecreateBestPractices')?.checked;
            const responseResult = await safeChromeRuntimeSendMessage({
                action: 'START_GPT_RECREATE',
                reference: this.recreateReference,
                bestPracticesEnabled
            }, 'start recreate workflow');
            if (responseResult.invalidated) {
                this.setRecreateStatus(EXTENSION_CONTEXT_REFRESHED_MESSAGE, 'error');
                return;
            }
            const response = responseResult.value;

            if (this.recreateAbortRequested || uiRunSequence !== this.recreateUiRunSequence) {
                return;
            }

            if (response && response.ok && response.started === true) {
                acknowledgedRun = true;
                this.recreateActiveRunId = String(response.runId || this.recreateActiveRunId || '');
                this.setRecreateStatus('Recreate running in dedicated Grok work tabs...', 'info');
            } else if (response && response.ok) {
                this.recreateRetryAvailable = false;
                const label = response.referenceKind === 'video' || this.getRecreateReferenceKind() === 'video' ? 'video' : 'image';
                this.setRecreateStatus(`Generated ${label} ready.`, 'success');
            } else {
                this.recreateRetryAvailable = !!this.recreateReference && response?.retrySafe === true;
                this.setRecreateStatus(this.formatRecreateStatus(response), 'error');
            }
        } catch (error) {
            if (!this.recreateAbortRequested && uiRunSequence === this.recreateUiRunSequence) {
                this.recreateRetryAvailable = false;
                this.setRecreateStatus(error.message || 'Recreate workflow failed.', 'error');
            }
        } finally {
            if (uiRunSequence !== this.recreateUiRunSequence) return;
            if (this.recreateAbortRequested) return;
            if (acknowledgedRun) return;
            this.setRecreateRunning(false);
            await this.refreshActiveWorkflowStatus();
        }
    }

    injectPrompt(text, mode = 'replace') {
        if (mode === 'append') {
            return this.appendPromptText(text);
        }

        if (isChatGptImagesProvider(this.provider)
            && typeof this.chatGptActions?.fillChatGptPromptInput === 'function') {
            try {
                this.chatGptActions.fillChatGptPromptInput(text);
                return true;
            } catch {
                return false;
            }
        }

        const ta = resolveVisibleGrokComposer();
        if (ta) {
            if (!(ta instanceof HTMLTextAreaElement)) {
                const target = markGrokComposerForBridge(ta);
                ta.focus();
                document.dispatchEvent(new CustomEvent('__gpt_set_editor_content', {
                    detail: { text, marker: target.marker }
                }));
                setTimeout(target.release, 0);
                return true;
            }
            ta.focus();
            // Reset React's internal value tracker so it detects our programmatic change
            const tracker = ta._valueTracker;
            if (tracker) {
                tracker.setValue('');
            }
            const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
                window.HTMLTextAreaElement.prototype,
                "value"
            ).set;
            nativeInputValueSetter.call(ta, text);
            ta.dispatchEvent(new Event('input', { bubbles: true }));
            ta.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
        }
        return false;
    }

    appendPromptText(text) {
        const snippet = sanitizeSavedPromptText(text);
        if (!snippet) return false;

        if (isChatGptImagesProvider(this.provider)
            && typeof this.chatGptActions?.fillChatGptPromptInput === 'function'
            && typeof this.chatGptActions?.readChatGptPromptInput === 'function') {
            try {
                const current = this.chatGptActions.readChatGptPromptInput();
                const next = mergePromptTextForAppend(current, snippet, SAVED_PROMPT_DELIMITER);
                this.chatGptActions.fillChatGptPromptInput(next);
                return true;
            } catch {
                return false;
            }
        }

        const ta = resolveVisibleGrokComposer();
        if (ta) {
            if (!(ta instanceof HTMLTextAreaElement)) {
                const target = markGrokComposerForBridge(ta);
                ta.focus();
                document.dispatchEvent(new CustomEvent('__gpt_append_editor_content', {
                    detail: { text: SAVED_PROMPT_DELIMITER + snippet, marker: target.marker }
                }));
                setTimeout(target.release, 0);
                return true;
            }
            ta.focus();
            const start = Number.isFinite(ta.selectionStart) ? ta.selectionStart : ta.value.length;
            const end = Number.isFinite(ta.selectionEnd) ? ta.selectionEnd : start;
            const next = appendSnippetAtCursor(ta.value, snippet, start, end, SAVED_PROMPT_DELIMITER);
            const tracker = ta._valueTracker;
            if (tracker) {
                tracker.setValue('');
            }
            const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
            setter.call(ta, next.text);
            ta.dispatchEvent(new Event('input', { bubbles: true }));
            ta.dispatchEvent(new Event('change', { bubbles: true }));
            ta.setSelectionRange(next.caret, next.caret);
            return true;
        }

        return false;
    }

    getContentEditableSelectionOffsets(element) {
        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0) return null;
        const range = selection.getRangeAt(0);
        if (!element.contains(range.startContainer) || !element.contains(range.endContainer)) {
            return null;
        }

        const startRange = range.cloneRange();
        startRange.selectNodeContents(element);
        startRange.setEnd(range.startContainer, range.startOffset);

        const endRange = range.cloneRange();
        endRange.selectNodeContents(element);
        endRange.setEnd(range.endContainer, range.endOffset);

        return {
            start: startRange.toString().length,
            end: endRange.toString().length
        };
    }

    setContentEditableCaret(element, offset) {
        const targetOffset = Math.max(0, Number.isFinite(offset) ? Math.floor(offset) : 0);
        const range = document.createRange();
        const selection = window.getSelection();
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);

        let remaining = targetOffset;
        let node = walker.nextNode();
        if (!node) {
            node = document.createTextNode('');
            element.appendChild(node);
        }

        while (node) {
            const length = node.textContent.length;
            if (remaining <= length) {
                range.setStart(node, remaining);
                range.collapse(true);
                selection.removeAllRanges();
                selection.addRange(range);
                return;
            }
            remaining -= length;
            const next = walker.nextNode();
            if (!next) {
                range.setStart(node, length);
                range.collapse(true);
                selection.removeAllRanges();
                selection.addRange(range);
                return;
            }
            node = next;
        }
    }
}

const PROMPTED_VIDEO_FOCUS_POLL_MS = 100;
const PROMPTED_VIDEO_FOCUS_WAIT_ATTEMPTS = 20;
const PROMPTED_VIDEO_FOCUS_QUIESCENCE_MS = 500;
const PROMPTED_VIDEO_SUBMIT_ACCEPTANCE_TIMEOUT_MS = 3000;
const GENERATION_CAPACITY_WAIT_MS = 15 * 60 * 1000;
const GENERATION_CAPACITY_POLL_MS = 1000;
const GENERATION_ACCEPTANCE_POLL_MS = 250;
const GENERATION_ACCEPTANCE_TIMEOUT_MS = 15000;
const GENERATION_RESULT_POLL_MS = 500;
const GENERATION_RESULT_TIMEOUT_MS = 180000;
const VIDEO_GOAL_HARD_RESULT_WAIT_MS = 720000;
const AGENT_ACTION_QUIESCENCE_MS = 500;
const PROMPTED_VIDEO_INPUT_SELECTOR =
    'div[contenteditable="true"][role="textbox"][aria-label="Ask Grok anything"]';
const PROMPTED_VIDEO_LEGACY_SUBMIT_SELECTOR = 'button[aria-label="Make video" i]';
const PROMPTED_VIDEO_GROK2_SUBMIT_SELECTOR = 'button[aria-label="Send"]';
const PROMPTED_VIDEO_SUBMIT_SELECTOR =
    `${PROMPTED_VIDEO_LEGACY_SUBMIT_SELECTOR}, ${PROMPTED_VIDEO_GROK2_SUBMIT_SELECTOR}`;
const GROK2_VIDEO_RADIO_GROUPS = [
    ['Generation mode', ['Image', 'Video', 'Agent'], 'Video'],
    ['Video resolution', ['480p', '720p', '1080p'], null],
    ['Video duration', ['6s', '10s', '15s'], null]
];

class VideoRetryManager {
    constructor(overlay, settingsManager, historyManager) {
        this.overlay = overlay;
        this.settingsManager = settingsManager;
        this.historyManager = historyManager;
        this.BUTTON_SELECTOR = 'button[aria-label="Make video" i]';
        this.PROGRESS_SELECTOR = 'button[aria-label="Video Options"]';
        this.currentRetry = 0;
        this.lastClickTime = 0;
        this.goalRunning = false;
        this.batchRunning = false;
        this.goalTotal = 0;
        this.goalCount = 0;

        // Scoped targeting: the card container we're operating on
        this.targetContext = null;

        // State for managing async verify step
        this.isVerifying = false;
        this.verifyStartTime = 0;
        this.lastSuccessTime = 0;
        this.preClickButtonCount = 0;

        // Interval management
        this.intervalId = null;

        // Batch state
        this.batchQueue = [];
        this.batchIndex = 0;
        this.batchAborted = false;
        this.batchMode = null;       // 'quick' or 'prompted'
        this.batchPrompt = null;     // Prompt text for prompted mode
        this.scrollAttempts = 0;
        this.batchContext = null;    // 'gallery', 'results_gallery', or 'detail'
        this.batchRunToken = null;
        this.batchStartPending = false;
        this.promptedVideoComposerRoot = null;
        this.generationRun = null;
        this.generationResumePending = false;
        this.generationCancellationListenerInstalled = false;

        // Quality Repeat state
        this.qualityRepeatRunning = false;
        this.qualityRepeatTotal = 0;
        this.qualityRepeatCompleted = 0;
        this.qualityRepeatGeneratedImages = 0;
        this.qualityRepeatWorkflowAuthority = null;
        this.qualityRepeatKnownIdentities = new Set();
        this.qualityRepeatButtonIndex = -1;
        this.qualityRepeatButtonCount = 0;
        this.qualityRepeatInlineContainer = null;
        this.qualityRepeatInlineSources = new WeakMap();

        this.settingsManager.subscribe(() => this.updateConfig());
        this.updateConfig();
        this.startObserver();

        // Watch for "Generate More" button appearing on the page
        this.generateMoreObserver = new MutationObserver(() => {
            const btn = this.findGenerateMoreButton();
            if (btn && !btn.parentElement.querySelector('.gpt-quality-repeat-inline')) {
                this.injectQuickRepeatButtons(btn);
            }
        });
        this.generateMoreObserver.observe(document.body, { childList: true, subtree: true });
    }

    updateConfig() { }

    // --- Fix 1: Safe overlay access ---
    safeStatus(msg, type) {
        if (this.overlay && this.overlay.setStatus) this.overlay.setStatus(msg, type);
    }

    handleExtensionContextInvalidated() {
        this.batchAborted = true;
        this.batchRunning = false;
        this.goalRunning = false;
        this.batchStartPending = false;
        this.batchRunToken = null;
        this.qualityRepeatRunning = false;
        this.isVerifying = false;
        this.targetContext = null;
        this._clearPromptedVideoComposerRoot();
        this.stopObserver();
        if (this.generateMoreObserver) this.generateMoreObserver.disconnect();
        this.updateBatchButtons(false);
        this.updateQualityRepeatUI(false, 'Stopped: refresh this page to reconnect the extension.');
        showExtensionContextRefreshed(this.overlay);
    }

    // --- Fix 2: Find the card container closest to viewport center ---
    findTargetContext() {
        const buttons = Array.from(document.querySelectorAll(this.BUTTON_SELECTOR))
            .filter((button) => findMediaCardRoot(button));
        if (buttons.length === 0) return null;
        if (buttons.length === 1) return findMediaCardRoot(buttons[0]);

        const viewportCenterY = window.innerHeight / 2;
        let bestBtn = null;
        let bestDist = Infinity;
        for (const btn of buttons) {
            const rect = btn.getBoundingClientRect();
            const dist = Math.abs(rect.top + rect.height / 2 - viewportCenterY);
            if (dist < bestDist) {
                bestDist = dist;
                bestBtn = btn;
            }
        }
        return findMediaCardRoot(bestBtn);
    }

    // Scoped query helper: search within targetContext if available, else document
    _queryRoot() {
        return (this.targetContext && this.targetContext.isConnected) ? this.targetContext : document;
    }

    detectBatchContext() {
        const surface = detectGrokScrapeSurface(document, window.location);
        if (surface === SCRAPE_SURFACES.savedGallery) return 'gallery';
        if (surface === SCRAPE_SURFACES.agentMedia || surface === SCRAPE_SURFACES.legacyDetail) return 'detail';
        if (/^\/imagine\/?$/.test(window.location.pathname)
            && this._getQualifiedResultsGalleryItems().length > 0) {
            return 'results_gallery';
        }
        return 'unsupported';
    }

    _getResultsGalleryEntries() {
        if (!/^\/imagine\/?$/.test(window.location.pathname)) return [];
        const seenCards = new Set();
        return getGrokGeneratedCardImages(document)
            .map((image) => {
                const container = findMediaCardRoot(image);
                if (!container || !image || seenCards.has(container)) return null;
                seenCards.add(container);
                const sourceId = this._getResultsCardSourceId(container);
                if (!sourceId) return null;
                const rect = container.getBoundingClientRect();
                return {
                    container,
                    image,
                    sourceId,
                    top: rect.top + window.scrollY,
                    left: rect.left + window.scrollX
                };
            })
            .filter(Boolean)
            .sort((a, b) => {
                if (Math.abs(a.top - b.top) > 20) return a.top - b.top;
                return a.left - b.left;
            });
    }

    _getQualifiedResultsGalleryItems() {
        return this._getResultsGalleryEntries()
            .map((entry) => {
                const buttons = Array.from(entry.container.querySelectorAll(this.BUTTON_SELECTOR))
                    .filter((button) => findMediaCardRoot(button) === entry.container);
                if (buttons.length !== 1) return null;
                return {
                    ...entry,
                    button: buttons[0]
                };
            })
            .filter(Boolean);
    }

    _isResultsGallerySurface() {
        return /^\/imagine\/?$/.test(window.location.pathname)
            && this._getResultsGalleryEntries().length > 0;
    }

    createBatchRunToken() {
        return `batch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    }

    isBatchRunActive(runToken = this.batchRunToken) {
        return isExtensionContextActive()
            && !!runToken
            && (this.batchRunning || this.goalRunning)
            && !this.batchAborted
            && this.batchRunToken === runToken;
    }

    isPromptedBatchTokenActive(runToken) {
        return !runToken || this.isBatchRunActive(runToken);
    }

    injectPromptText(text) {
        if (!text) return false;

        const input = this._findPromptedVideoInput();
        if (!input) return false;

        if (input.tagName?.toLowerCase() === 'textarea') {
            input.focus();
            // Reset React's internal value tracker so it detects our programmatic change
            const tracker = input._valueTracker;
            if (tracker) {
                tracker.setValue('');
            }
            const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
            setter.call(input, text);
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
        }

        input.focus();
        // Use page-world bridge — editor internals are not accessible from isolated world.
        document.dispatchEvent(new CustomEvent('__gpt_set_editor_content', {
            detail: { text }
        }));
        return true;
    }

    injectPromptedVideoText(text) {
        if (!text) return false;

        const composer = this._getVerifiedPromptedVideoComposer(
            this.promptedVideoComposerRoot,
            false
        );
        const input = composer?.input;
        if (!input) return false;

        const marker = `gpt_prompted_video_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        let injected = false;
        let settled = false;
        const handleResult = (event) => {
            const detail = event.detail || {};
            if (detail.marker !== marker || settled) return;
            settled = true;
            injected = detail.ok === true;
        };

        input.setAttribute('data-gpt-prompt-target', marker);
        document.addEventListener('__gpt_set_prompted_video_content_result', handleResult);
        try {
            document.dispatchEvent(new CustomEvent('__gpt_set_prompted_video_content', {
                detail: { marker, text }
            }));
        } catch {
            injected = false;
        } finally {
            document.removeEventListener('__gpt_set_prompted_video_content_result', handleResult);
            input.removeAttribute('data-gpt-prompt-target');
        }

        return injected;
    }

    // --- Prompted Batch Helpers ---

    // Dispatches a full pointer event sequence that works with Radix UI dropdowns
    // (bare .click() does NOT trigger Grok's Radix-based dropdowns/menus)
    simulateClick(el) {
        dispatchFullPointerClick(el);
    }

    // Detects censored/blurred gallery cards that would redirect to homepage if clicked
    isCensoredCard(container) {
        const img = this._getCardGeneratedImage(container);
        if (!img) return true;

        // Walk up from img to container checking for CSS blur filter
        let el = img;
        while (el && el !== container.parentElement) {
            const style = window.getComputedStyle(el);
            if (style.filter && style.filter.includes('blur')) return true;
            if (style.opacity && parseFloat(style.opacity) < 0.5) return true;
            el = el.parentElement;
        }

        // Check for blur-related classes
        const classes = container.className + ' ' + (img.className || '');
        if (/blur|censor|blocked|nsfw|flagged/i.test(classes)) return true;

        return false;
    }

    // Gets a stable identifier for a gallery card (image src survives React re-renders)
    _getCardGeneratedImage(container) {
        const images = getGrokGeneratedCardImages(container)
            .filter((image) => findMediaCardRoot(image) === container);
        const identities = new Set(images
            .map((image) => getGrokMediaIdentity(image.currentSrc || image.src || ''))
            .filter(Boolean));
        if (identities.size === 1) return images[0] || null;
        if (identities.size !== 0 || images.length !== 1) return null;
        const assetScopedPostIds = new Set(
            Array.from(container?.querySelectorAll?.('a[href*="/imagine/post/"]') || [])
                .filter((link) => findMediaCardRoot(link) === container)
                .filter((link) => {
                    try {
                        return new URL(link.href).searchParams.get('scope') === 'asset';
                    } catch {
                        return false;
                    }
                })
                .map((link) => getGrokMediaIdentity(link.href))
                .filter(Boolean)
        );
        return assetScopedPostIds.size === 1 ? images[0] : null;
    }

    _getCardImageSrc(container) {
        const img = this._getCardGeneratedImage(container);
        return img?.src || '';
    }

    _getCardSourceId(container) {
        const sourceUrl = this._getCardImageSrc(container);
        return getGrokMediaIdentity(sourceUrl) || sourceUrl;
    }

    _getResultsCardSourceId(container) {
        const postLinks = Array.from(container?.querySelectorAll?.('a[href*="/imagine/post/"]') || [])
            .filter((link) => findMediaCardRoot(link) === container);
        if (postLinks.length) {
            const postIds = new Set(postLinks
                .map((link) => getGrokMediaIdentity(link.href))
                .filter(Boolean));
            return postIds.size === 1 ? Array.from(postIds)[0] : '';
        }
        return this._getCardSourceId(container);
    }

    _isVisibleAutomationTarget(element, maxWidth = Infinity) {
        if (!element || !element.isConnected) return false;
        const rect = element.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0 || rect.width > maxWidth) return false;
        const style = window.getComputedStyle(element);
        return style.display !== 'none' && style.visibility !== 'hidden';
    }

    _isActionableAutomationTarget(element, maxWidth = Infinity) {
        return this._isVisibleAutomationTarget(element, maxWidth)
            && !element.disabled
            && element.getAttribute('aria-disabled') !== 'true';
    }

    _isSelectedAgentAssetNode(node) {
        return !!node && (
            node.classList.contains('selected')
            || node.getAttribute('aria-selected') === 'true'
            || node.getAttribute('data-state') === 'selected'
        );
    }

    _getSelectedAgentAssetNodes() {
        return Array.from(document.querySelectorAll('.react-flow__node-asset'))
            .filter((node) => this._isSelectedAgentAssetNode(node));
    }

    _getAgentAssetNodeById(assetNodeId) {
        if (!assetNodeId) return null;
        const matches = Array.from(document.querySelectorAll('.react-flow__node-asset'))
            .filter((node) => node.getAttribute('data-id') === assetNodeId);
        return matches.length === 1 ? matches[0] : null;
    }

    _createAgentMediaBinding(match, expectedIdentity) {
        if (match?.status !== 'matched' || !match.assetNodeId) return null;
        return {
            assetNodeId: match.assetNodeId,
            sourceIdentity: getGrokMediaIdentity(expectedIdentity || match.sourceUrl),
            sourceUrl: match.sourceUrl,
            assetNode: match.assetNode,
            media: match.media
        };
    }

    _captureSelectedAgentMediaBinding() {
        const selectedNodes = this._getSelectedAgentAssetNodes();
        if (selectedNodes.length !== 1) return null;
        const assetNode = selectedNodes[0];
        const assetNodeId = String(assetNode.getAttribute('data-id') || '').trim();
        if (!assetNodeId) return null;
        const media = assetNode.querySelector('video, img');
        const sourceUrl = getBackupMediaElementSrc(media);
        return {
            assetNodeId,
            sourceIdentity: getGrokMediaIdentity(sourceUrl),
            sourceUrl,
            assetNode,
            media
        };
    }

    _resolveCurrentAgentMediaBinding(binding) {
        if (!binding?.assetNodeId) return null;
        const assetNode = this._getAgentAssetNodeById(binding.assetNodeId);
        if (!assetNode) return null;
        const selectedNodes = this._getSelectedAgentAssetNodes();
        if (selectedNodes.length !== 1 || selectedNodes[0] !== assetNode) return null;

        if (binding.sourceIdentity) {
            const match = findMatchingAgentMedia(document, binding.sourceIdentity);
            if (match.status !== 'matched' || match.assetNodeId !== binding.assetNodeId) return null;
            return {
                ...binding,
                sourceUrl: match.sourceUrl,
                assetNode,
                media: match.media
            };
        }

        return { ...binding, assetNode };
    }

    _getBoundAgentMakeVideoTriggers(binding) {
        if (!this._resolveCurrentAgentMediaBinding(binding)) return [];
        return Array.from(document.querySelectorAll(
            'button[aria-label="Make Video" i][aria-haspopup="menu"]'
        )).filter((button) => this._isActionableAutomationTarget(button)
            && !button.closest('.react-flow, .react-flow__node-asset, .react-flow__node-toolbar'));
    }

    async _waitForStableBoundAgentMakeVideoTrigger(binding, runToken, timeoutMs = 2000) {
        const pollInterval = PROMPTED_VIDEO_FOCUS_POLL_MS;
        const maxAttempts = Math.max(1, Math.ceil(timeoutMs / pollInterval));
        const requiredStablePolls = Math.max(2, Math.ceil(AGENT_ACTION_QUIESCENCE_MS / pollInterval));
        let stableTrigger = null;
        let stablePolls = 0;

        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            if (!this.isPromptedBatchTokenActive(runToken)
                || !this._resolveCurrentAgentMediaBinding(binding)) return null;
            const candidates = this._getBoundAgentMakeVideoTriggers(binding);
            if (candidates.length > 1) return null;
            const candidate = candidates[0] || null;
            if (candidate && candidate === stableTrigger) {
                stablePolls++;
            } else {
                stableTrigger = candidate;
                stablePolls = candidate ? 1 : 0;
            }
            if (stableTrigger && stablePolls >= requiredStablePolls) return stableTrigger;
            await this.sleep(pollInterval);
        }

        return null;
    }

    _findCurrentMakeVideoTrigger(agentBinding = null) {
        if (agentBinding) {
            const candidates = this._getBoundAgentMakeVideoTriggers(agentBinding);
            return candidates.length === 1 ? candidates[0] : null;
        }
        return Array.from(document.querySelectorAll(
            'button[aria-label="Make Video" i][aria-haspopup="menu"]'
        )).find((button) => this._isActionableAutomationTarget(button)) || null;
    }

    _findPromptedVideoInput() {
        return document.querySelector('textarea[aria-required="true"]')
            || document.querySelector('[contenteditable="true"]');
    }

    _clearPromptedVideoComposerRoot() {
        this.promptedVideoComposerRoot = null;
    }

    _getPromptedVideoRadioLabel(radio) {
        return (radio?.getAttribute?.('aria-label') || radio?.textContent || '').trim();
    }

    _getExactPromptedVideoRadioGroup(root, groupLabel, expectedLabels, requiredSelection) {
        const groups = Array.from(root.querySelectorAll('[role="radiogroup"]'))
            .filter((group) => group.getAttribute('aria-label') === groupLabel);
        if (groups.length !== 1) return null;

        const group = groups[0];
        const radios = Array.from(group.querySelectorAll('[role="radio"]'))
            .filter((radio) => radio.closest('[role="radiogroup"]') === group);
        const labels = radios.map((radio) => this._getPromptedVideoRadioLabel(radio));
        if (labels.length !== expectedLabels.length
            || new Set(labels).size !== expectedLabels.length
            || expectedLabels.some((label) => !labels.includes(label))) {
            return null;
        }

        const selected = radios.filter((radio) => radio.getAttribute('aria-checked') === 'true');
        if (selected.length !== 1) return null;
        if (requiredSelection
            && this._getPromptedVideoRadioLabel(selected[0]) !== requiredSelection) {
            return null;
        }
        return group;
    }

    _getPromptedVideoComposerKind(root) {
        if (!root || root === document.body || root === document.documentElement) return null;
        if (root.matches('.query-bar')) return 'legacy';
        const hasExactGrok2Contract = GROK2_VIDEO_RADIO_GROUPS.every(([
            groupLabel,
            expectedLabels,
            requiredSelection
        ]) => this._getExactPromptedVideoRadioGroup(
            root,
            groupLabel,
            expectedLabels,
            requiredSelection
        ));
        return hasExactGrok2Contract ? 'grok2' : null;
    }

    _findPromptedVideoComposerRoot(member) {
        let root = member;
        while (root && root !== document.body && root !== document.documentElement) {
            if (this._getPromptedVideoComposerKind(root)) return root;
            root = root.parentElement;
        }
        return null;
    }

    _getVerifiedPromptedVideoComposer(root, requireActionableSubmit = true) {
        if (!root?.isConnected) return null;
        const kind = this._getPromptedVideoComposerKind(root);
        if (!kind) return null;

        const inputs = Array.from(root.querySelectorAll(PROMPTED_VIDEO_INPUT_SELECTOR))
            .filter((candidate) => this._findPromptedVideoComposerRoot(candidate) === root);
        if (inputs.length !== 1) return null;

        const input = inputs[0];
        const submitSelector = kind === 'grok2'
            ? PROMPTED_VIDEO_GROK2_SUBMIT_SELECTOR
            : PROMPTED_VIDEO_LEGACY_SUBMIT_SELECTOR;
        const submitButtons = Array.from(root.querySelectorAll(submitSelector))
            .filter((candidate) => this._findPromptedVideoComposerRoot(candidate) === root
                && this._isVisibleAutomationTarget(candidate, 72));
        if (submitButtons.length !== 1) return null;
        if (requireActionableSubmit
            && !this._isActionableAutomationTarget(submitButtons[0], 72)) {
            return null;
        }

        return { root, input, submitButton: submitButtons[0], kind };
    }

    _findPromptedVideoSubmitButton() {
        return this._getVerifiedPromptedVideoComposer(this.promptedVideoComposerRoot)?.submitButton || null;
    }

    async _waitForPromptedVideoSubmitButton(runToken, agentBinding = null) {
        for (let attempt = 0; attempt < PROMPTED_VIDEO_FOCUS_WAIT_ATTEMPTS; attempt++) {
            if (!this.isPromptedBatchTokenActive(runToken)) return null;
            if (agentBinding && !this._resolveCurrentAgentMediaBinding(agentBinding)) return null;
            const submitButton = this._findPromptedVideoSubmitButton();
            if (submitButton) return submitButton;
            await this.sleep(PROMPTED_VIDEO_FOCUS_POLL_MS);
        }
        return null;
    }

    async _waitForPromptedResultsSubmitButton(runToken, agentBinding = null) {
        const immediate = await this._waitForPromptedVideoSubmitButton(runToken, agentBinding);
        if (immediate) return immediate;

        const attempts = Math.max(1, Math.ceil(
            GENERATION_CAPACITY_WAIT_MS / PROMPTED_VIDEO_FOCUS_POLL_MS
        ));
        let announcedWait = false;
        for (let attempt = 0; attempt < attempts; attempt++) {
            if (!this.isPromptedBatchTokenActive(runToken)) return null;
            if (agentBinding && !this._resolveCurrentAgentMediaBinding(agentBinding)) return null;

            const composer = this._getVerifiedPromptedVideoComposer(
                this.promptedVideoComposerRoot,
                false
            );
            if (!composer) return null;
            const promptValue = composer.input instanceof HTMLTextAreaElement
                ? composer.input.value
                : composer.input.textContent;
            if (String(promptValue || '').trim() !== String(this.batchPrompt || '').trim()) {
                return null;
            }

            const submitButton = this._findPromptedVideoSubmitButton();
            if (submitButton) return submitButton;
            if (!announcedWait) {
                announcedWait = true;
                this.safeStatus('Prompted Batch [results]: Waiting for Grok capacity...', 'neutral');
            }
            await this.sleep(PROMPTED_VIDEO_FOCUS_POLL_MS);
        }
        return null;
    }

    _getVerifiedPromptedVideoComposers(requireActionableSubmit = true) {
        const roots = new Set(Array.from(document.querySelectorAll(PROMPTED_VIDEO_INPUT_SELECTOR))
            .map((input) => this._findPromptedVideoComposerRoot(input))
            .filter(Boolean));
        return Array.from(roots)
            .map((root) => this._getVerifiedPromptedVideoComposer(root, requireActionableSubmit))
            .filter(Boolean);
    }

    _capturePromptedVideoComposerBaseline() {
        const roots = new Set(Array.from(document.querySelectorAll(PROMPTED_VIDEO_INPUT_SELECTOR))
            .map((input) => input.closest('.query-bar') || this._findPromptedVideoComposerRoot(input))
            .filter((root) => this._isVisibleAutomationTarget(root)));
        if (roots.size !== 1) return { root: null, input: null, submitCount: 0 };

        const root = Array.from(roots)[0];
        const inputs = Array.from(root.querySelectorAll(PROMPTED_VIDEO_INPUT_SELECTOR))
            .filter((input) => (input.closest('.query-bar') || this._findPromptedVideoComposerRoot(input)) === root);
        const submitCount = Array.from(root.querySelectorAll(PROMPTED_VIDEO_LEGACY_SUBMIT_SELECTOR))
            .filter((button) => this._isVisibleAutomationTarget(button, 72)).length;
        return {
            root,
            input: inputs.length === 1 ? inputs[0] : null,
            submitCount
        };
    }

    _isExactCurrentVideoComposer(composer) {
        return !!composer
            && !!this._getExactPromptedVideoRadioGroup(
                composer.root,
                'Generation mode',
                ['Image', 'Video'],
                'Video'
            );
    }

    async _waitForSameRootPromptedVideoComposer(runToken, baseline) {
        if (!baseline?.root || !baseline.input || baseline.submitCount !== 0) return null;
        const requiredStablePolls = Math.max(
            2,
            Math.ceil(PROMPTED_VIDEO_FOCUS_QUIESCENCE_MS / PROMPTED_VIDEO_FOCUS_POLL_MS)
        );
        let stableComposer = null;
        let stablePolls = 0;

        for (let attempt = 0; attempt < PROMPTED_VIDEO_FOCUS_WAIT_ATTEMPTS; attempt++) {
            if (!this.isPromptedBatchTokenActive(runToken)) return null;
            const composers = this._getVerifiedPromptedVideoComposers(false);
            if (composers.length > 1) return null;
            const composer = composers[0] || null;
            if (composer && composer.root !== baseline.root) return null;
            if (composer
                && composer.root === baseline.root
                && composer.input === baseline.input
                && this._isExactCurrentVideoComposer(composer)) {
                if (stableComposer?.submitButton === composer.submitButton) {
                    stablePolls += 1;
                } else {
                    stableComposer = composer;
                    stablePolls = 1;
                }
                if (stablePolls >= requiredStablePolls) {
                    this.promptedVideoComposerRoot = composer.root;
                    return composer;
                }
            } else {
                stableComposer = null;
                stablePolls = 0;
            }
            await this.sleep(PROMPTED_VIDEO_FOCUS_POLL_MS);
        }
        return null;
    }

    async _waitForLegacyPromptedVideoSubmitButton(runToken) {
        for (let attempt = 0; attempt < 20; attempt++) {
            if (!this.isPromptedBatchTokenActive(runToken)) return null;
            const composer = this._getVerifiedPromptedVideoComposers()[0];
            if (composer) {
                this.promptedVideoComposerRoot = composer.root;
                return composer.submitButton;
            }
            await this.sleep(100);
        }
        return null;
    }

    async _waitForLegacyPromptedVideoComposer(runToken) {
        const submitButton = await this._waitForLegacyPromptedVideoSubmitButton(runToken);
        const composer = this._getVerifiedPromptedVideoComposer(this.promptedVideoComposerRoot);
        return submitButton && composer ? composer : null;
    }

    _getOpenLinkedMakeVideoMenus(trigger) {
        const triggerId = trigger?.id;
        const menuId = trigger?.getAttribute('aria-controls');
        if (!triggerId || !menuId
            || trigger.getAttribute('aria-expanded') !== 'true'
            || trigger.getAttribute('data-state') !== 'open') {
            return [];
        }

        return Array.from(document.querySelectorAll('[role="menu"]'))
            .filter((menu) => menu.id === menuId
                && menu.getAttribute('aria-labelledby') === triggerId
                && menu.getAttribute('data-state') === 'open'
                && this._isVisibleAutomationTarget(menu));
    }

    _getExactAddPromptItems(menu) {
        return Array.from(menu.querySelectorAll('[role="menuitem"]'))
            .filter((item) => item.closest('[role="menu"]') === menu
                && item.textContent.trim() === 'Add Prompt'
                && this._isVisibleAutomationTarget(item));
    }

    async _waitForLinkedAddPromptMenuItem(trigger, runToken) {
        for (let attempt = 0; attempt < 20; attempt++) {
            if (!this.isPromptedBatchTokenActive(runToken)) return null;
            const menus = this._getOpenLinkedMakeVideoMenus(trigger);
            if (menus.length > 1) return null;
            const items = menus.length === 1 ? this._getExactAddPromptItems(menus[0]) : [];
            if (items.length > 1) return null;
            const addPromptItem = items[0];
            if (addPromptItem) {
                await this.sleep(100);
                if (!this.isPromptedBatchTokenActive(runToken)) return null;
                const confirmedMenus = this._getOpenLinkedMakeVideoMenus(trigger);
                if (confirmedMenus.length !== 1) return null;
                const confirmedItems = this._getExactAddPromptItems(confirmedMenus[0]);
                return confirmedItems.length === 1 ? confirmedItems[0] : null;
            }
            await this.sleep(100);
        }
        return null;
    }

    _isRecordedActionablePromptedVideoSubmit(button) {
        if (!button.matches(PROMPTED_VIDEO_SUBMIT_SELECTOR)
            || button.disabled
            || button.hidden
            || button.getAttribute('aria-disabled') === 'true') {
            return false;
        }
        const style = window.getComputedStyle(button);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        const rect = button.getBoundingClientRect();
        return rect.width <= 72
            && (!button.isConnected || (rect.width > 0 && rect.height > 0));
    }

    _mutationNodeContainsPromptedVideoContractMember(node, candidateRoot) {
        if (node?.nodeType !== 1) return false;
        const inputs = node.matches(PROMPTED_VIDEO_INPUT_SELECTOR) ? [node] : [];
        inputs.push(...node.querySelectorAll(PROMPTED_VIDEO_INPUT_SELECTOR));
        const submitButtons = node.matches(PROMPTED_VIDEO_SUBMIT_SELECTOR) ? [node] : [];
        submitButtons.push(...node.querySelectorAll(PROMPTED_VIDEO_SUBMIT_SELECTOR));
        const radioMembers = node.matches('[role="radiogroup"], [role="radio"]') ? [node] : [];
        radioMembers.push(...node.querySelectorAll('[role="radiogroup"], [role="radio"]'));
        return [...inputs, ...submitButtons, ...radioMembers].some((candidate) => {
            const root = this._findPromptedVideoComposerRoot(candidate);
            if (root && root !== candidateRoot) return false;
            return candidate.matches(PROMPTED_VIDEO_INPUT_SELECTOR)
                || this._isRecordedActionablePromptedVideoSubmit(candidate)
                || candidate.matches('[role="radiogroup"], [role="radio"]');
        });
    }

    _didPromptedVideoContractMembershipChange(records, candidateRoot) {
        return records.some((record) => (
            record.type === 'attributes' && record.attributeName === 'aria-checked'
        ) || (
            record.type === 'childList'
            && [...record.addedNodes, ...record.removedNodes].some((node) => (
                this._mutationNodeContainsPromptedVideoContractMember(node, candidateRoot)
            ))
        ));
    }

    _recordPromptedVideoFocus(focusTransition, input) {
        const root = this._findPromptedVideoComposerRoot(input);
        if (!focusTransition.focusTransitioned) {
            const leftActiveElement = input !== focusTransition.activeElement;
            const leftActiveRoot = !focusTransition.root || root !== focusTransition.root;
            focusTransition.focusTransitioned = leftActiveElement && leftActiveRoot;
        }
        if (!focusTransition.focusTransitioned
            || (focusTransition.root && root === focusTransition.root)
            || !input?.matches(PROMPTED_VIDEO_INPUT_SELECTOR)) {
            if (focusTransition.candidateRoot) focusTransition.focusLeftCandidate = true;
            return null;
        }

        const composer = this._getVerifiedPromptedVideoComposer(root, false);
        if (composer?.input !== input) {
            if (focusTransition.candidateRoot) {
                if (root === focusTransition.candidateRoot) {
                    focusTransition.cardinalityDrifted = true;
                } else {
                    focusTransition.focusLeftCandidate = true;
                }
            }
            return null;
        }
        focusTransition.observedRoots.add(composer.root);
        if (!focusTransition.candidateRoot) {
            focusTransition.candidateRoot = composer.root;
            focusTransition.candidateInput = composer.input;
            focusTransition.observer = new MutationObserver((records) => {
                if (this._didPromptedVideoContractMembershipChange(
                    records,
                    focusTransition.candidateRoot
                )) {
                    focusTransition.cardinalityDrifted = true;
                    return;
                }
                const verified = this._getVerifiedPromptedVideoComposer(
                    focusTransition.candidateRoot,
                    false
                );
                if (!verified || verified.input !== focusTransition.candidateInput) {
                    focusTransition.cardinalityDrifted = true;
                }
            });
            focusTransition.observer.observe(composer.root, {
                attributes: true,
                childList: true,
                subtree: true,
                attributeFilter: [
                    'aria-checked',
                    'aria-disabled',
                    'aria-label',
                    'class',
                    'contenteditable',
                    'disabled',
                    'hidden',
                    'role',
                    'style'
                ]
            });
        }
        return composer;
    }

    _startPromptedVideoFocusTransition() {
        const activeElement = document.activeElement;
        const focusTransition = {
            activeElement,
            root: this._findPromptedVideoComposerRoot(activeElement),
            focusTransitioned: false,
            observedRoots: new Set(),
            candidateRoot: null,
            candidateInput: null,
            focusLeftCandidate: false,
            cardinalityDrifted: false,
            listener: null,
            focusOutListener: null,
            observer: null
        };
        focusTransition.listener = (event) => {
            this._recordPromptedVideoFocus(focusTransition, event.target);
        };
        focusTransition.focusOutListener = (event) => {
            if (focusTransition.candidateInput === event.target) {
                focusTransition.focusLeftCandidate = true;
            }
        };
        document.addEventListener('focusin', focusTransition.listener, true);
        document.addEventListener('focusout', focusTransition.focusOutListener, true);
        return focusTransition;
    }

    _stopPromptedVideoFocusTransition(focusTransition) {
        document.removeEventListener('focusin', focusTransition.listener, true);
        document.removeEventListener('focusout', focusTransition.focusOutListener, true);
        focusTransition.observer?.disconnect();
    }

    _isPromptedVideoFocusTransitionInvalid(focusTransition) {
        return focusTransition.observedRoots.size !== 1
            || focusTransition.focusLeftCandidate
            || focusTransition.cardinalityDrifted;
    }

    async _waitForFocusedPromptedVideoComposer(runToken, focusTransition) {
        for (let attempt = 0; attempt < PROMPTED_VIDEO_FOCUS_WAIT_ATTEMPTS; attempt++) {
            if (!this.isPromptedBatchTokenActive(runToken)) return null;
            const composer = this._recordPromptedVideoFocus(
                focusTransition,
                document.activeElement
            );
            if (focusTransition.observedRoots.size > 1) return null;
            if (focusTransition.candidateRoot
                && this._isPromptedVideoFocusTransitionInvalid(focusTransition)) {
                return null;
            }
            if (composer?.root === focusTransition.candidateRoot) break;
            await this.sleep(PROMPTED_VIDEO_FOCUS_POLL_MS);
        }

        if (!focusTransition.candidateRoot
            || this._isPromptedVideoFocusTransitionInvalid(focusTransition)) {
            return null;
        }

        const quiescencePolls = Math.ceil(
            PROMPTED_VIDEO_FOCUS_QUIESCENCE_MS / PROMPTED_VIDEO_FOCUS_POLL_MS
        );
        for (let poll = 0; poll < quiescencePolls; poll++) {
            if (!this.isPromptedBatchTokenActive(runToken)) return null;
            const composer = this._recordPromptedVideoFocus(
                focusTransition,
                document.activeElement
            );
            if (this._isPromptedVideoFocusTransitionInvalid(focusTransition)
                || composer?.root !== focusTransition.candidateRoot) {
                return null;
            }
            await this.sleep(PROMPTED_VIDEO_FOCUS_POLL_MS);
        }

        if (!this.isPromptedBatchTokenActive(runToken)) return null;
        const confirmed = this._recordPromptedVideoFocus(
            focusTransition,
            document.activeElement
        );
        if (this._isPromptedVideoFocusTransitionInvalid(focusTransition)
            || confirmed?.root !== focusTransition.candidateRoot
            || confirmed.input !== document.activeElement) {
            return null;
        }

        this.promptedVideoComposerRoot = confirmed.root;
        return confirmed;
    }

    // Opens Grok's custom video prompt mode. The current UI uses
    // Make Video > Add Prompt; older post pages use a direct mode button.
    async selectMakeVideoMode(runToken, readyMakeVideoTrigger = null, agentBinding = null) {
        if (!this.isPromptedBatchTokenActive(runToken)) return false;
        this.promptedVideoModeContract = null;
        this._clearPromptedVideoComposerRoot();
        const validateAgentBinding = () => !agentBinding
            || !!this._resolveCurrentAgentMediaBinding(agentBinding);
        if (!validateAgentBinding()) return false;
        const existingComposers = this._getVerifiedPromptedVideoComposers(false)
            .filter((composer) => this._isExactCurrentVideoComposer(composer));
        if (existingComposers.length > 1) return false;
        if (existingComposers.length === 1) {
            this.promptedVideoComposerRoot = existingComposers[0].root;
            this.promptedVideoModeContract = 'current_menu';
            return true;
        }
        let currentTrigger = null;
        if (agentBinding) {
            if (readyMakeVideoTrigger) {
                const boundTriggers = this._getBoundAgentMakeVideoTriggers(agentBinding);
                if (boundTriggers.length !== 1) return false;
                currentTrigger = boundTriggers[0];
            } else {
                currentTrigger = await this._waitForStableBoundAgentMakeVideoTrigger(
                    agentBinding,
                    runToken
                );
                if (!currentTrigger) return false;
            }
        } else {
            currentTrigger = this._isActionableAutomationTarget(readyMakeVideoTrigger)
                ? readyMakeVideoTrigger
                : this._findCurrentMakeVideoTrigger();
        }

        if (currentTrigger) {
            if (!this.isPromptedBatchTokenActive(runToken) || !validateAgentBinding()) return false;
            this.simulateClick(currentTrigger);
            const addPromptItem = await this._waitForLinkedAddPromptMenuItem(currentTrigger, runToken);
            if (!addPromptItem) {
                console.log('VideoRetryManager: Add Prompt option not found');
                return false;
            }

            if (!this.isPromptedBatchTokenActive(runToken) || !validateAgentBinding()) return false;
            const composerBaseline = this._capturePromptedVideoComposerBaseline();
            const focusTransition = this._startPromptedVideoFocusTransition();
            let composer;
            try {
                this.simulateClick(addPromptItem);
                composer = await this._waitForSameRootPromptedVideoComposer(
                    runToken,
                    composerBaseline
                );
                if (!composer) {
                    composer = await this._waitForFocusedPromptedVideoComposer(
                        runToken,
                        focusTransition
                    );
                }
            } finally {
                this._stopPromptedVideoFocusTransition(focusTransition);
            }
            if (!composer) {
                console.log('VideoRetryManager: Video prompt composer did not open');
                return false;
            }
            if (!validateAgentBinding()) {
                this._clearPromptedVideoComposerRoot();
                return false;
            }
            this.promptedVideoModeContract = 'current_menu';
            return true;
        }

        const legacyVideoButtons = Array.from(document.querySelectorAll('button[aria-label="Video"]'))
            .filter((button) => this._isActionableAutomationTarget(button));
        const videoBtn = legacyVideoButtons.length === 1 ? legacyVideoButtons[0] : null;
        if (!videoBtn) {
            console.log('VideoRetryManager: Video mode button not found');
            return false;
        }
        if (!this.isPromptedBatchTokenActive(runToken)) return false;
        this.simulateClick(videoBtn);
        const composer = await this._waitForLegacyPromptedVideoComposer(runToken);
        if (!composer) {
            console.log('VideoRetryManager: Legacy video prompt composer did not open');
            return false;
        }
        this.promptedVideoModeContract = 'legacy';
        return true;
    }

    _getPromptedBatchNativeClickPoint(target) {
        const rect = target?.getBoundingClientRect?.();
        if (!rect || rect.width <= 0 || rect.height <= 0) return null;
        const viewportWidth = window.innerWidth || document.documentElement?.clientWidth || 0;
        const viewportHeight = window.innerHeight || document.documentElement?.clientHeight || 0;
        const visibleLeft = Math.max(0, rect.left);
        const visibleTop = Math.max(0, rect.top);
        const visibleRight = Math.min(viewportWidth, rect.right);
        const visibleBottom = Math.min(viewportHeight, rect.bottom);
        if (visibleRight <= visibleLeft || visibleBottom <= visibleTop) return null;
        return {
            x: visibleLeft + ((visibleRight - visibleLeft) / 2),
            y: visibleTop + ((visibleBottom - visibleTop) / 2)
        };
    }

    async _clickPromptedBatchNativeControl(
        target,
        runToken,
        operation,
        validateTarget,
        generationDispatch = null
    ) {
        if (!this.isPromptedBatchTokenActive(runToken) || !target) return false;
        const click = this._getPromptedBatchNativeClickPoint(target);
        if (!click) return false;

        const overlay = document.querySelector('#grok-powertools-overlay');
        const previousPointerEvents = overlay?.style.pointerEvents;
        if (overlay && !overlay.contains(target)) overlay.style.pointerEvents = 'none';
        try {
            if (!this.isPromptedBatchTokenActive(runToken)) return false;
            if (validateTarget && !validateTarget()) return false;
            if (typeof document.elementFromPoint === 'function') {
                const hitTarget = document.elementFromPoint(click.x, click.y);
                if (hitTarget && hitTarget !== target && !target.contains(hitTarget)) return false;
            }

            const response = await safeChromeRuntimeSendMessage({
                action: 'GPT_PROMPTED_VIDEO_NATIVE_CLICK',
                click,
                ...(generationDispatch ? { generationDispatch } : {})
            }, operation);
            if (!response.ok || response.invalidated || response.value?.ok !== true) {
                if (response.invalidated) showExtensionContextRefreshed(this.overlay);
                return false;
            }
            if (generationDispatch) {
                if (!['submitted', 'accepted'].includes(response.value?.generation?.status)) {
                    return false;
                }
                this._rememberGenerationRun(response.value.generation);
            }
            return this.isPromptedBatchTokenActive(runToken);
        } catch (error) {
            if (isExtensionContextInvalidatedError(error)) showExtensionContextRefreshed(this.overlay);
            return false;
        } finally {
            if (overlay && !overlay.contains(target)) overlay.style.pointerEvents = previousPointerEvents;
        }
    }

    // Clicks only a proven video query-bar submit. Current Grok rejects untrusted
    // synthetic submit events, so dispatch through the sender tab's native click channel.
    async clickPromptedVideoSubmitButton(runToken, agentBinding = null) {
        if (!this.isPromptedBatchTokenActive(runToken)) return false;
        if (agentBinding && !this._resolveCurrentAgentMediaBinding(agentBinding)) return false;
        const button = this._findPromptedVideoSubmitButton();
        if (!button || button.disabled) return false;
        const clicked = await this._clickPromptedBatchNativeControl(
            button,
            runToken,
            'click prompted video submit',
            () => this._findPromptedVideoSubmitButton() === button
                && (!agentBinding || !!this._resolveCurrentAgentMediaBinding(agentBinding))
        );
        if (!clicked || !this.isPromptedBatchTokenActive(runToken)) return false;
        return !agentBinding || !!this._resolveCurrentAgentMediaBinding(agentBinding);
    }

    _capturePromptedVideoSubmissionReceipt() {
        const composer = this._getVerifiedPromptedVideoComposer(
            this.promptedVideoComposerRoot,
            false
        );
        if (!composer) return null;
        const inputValue = composer.input instanceof HTMLTextAreaElement
            ? composer.input.value
            : composer.input.textContent;
        return {
            composerRoot: composer.root,
            input: composer.input,
            inputValue: String(inputValue || '').trim(),
            submitButton: composer.submitButton,
            postId: this._getImaginePostId(window.location.href),
            conversationId: this._getImagineConversationId(window.location.href)
        };
    }

    async _waitForPromptedVideoSubmissionAccepted(
        receipt,
        runToken,
        timeoutMs = PROMPTED_VIDEO_SUBMIT_ACCEPTANCE_TIMEOUT_MS
    ) {
        if (!receipt?.composerRoot || !receipt.submitButton || !receipt.input) return false;
        const attempts = Math.max(1, Math.ceil(timeoutMs / PROMPTED_VIDEO_FOCUS_POLL_MS));

        for (let attempt = 0; attempt < attempts; attempt++) {
            if (!this.isBatchRunActive(runToken)) return false;
            const currentPostId = this._getImaginePostId(window.location.href);
            const currentConversationId = this._getImagineConversationId(window.location.href);
            const acceptedPostOpened = !!receipt.postId
                && !!receipt.conversationId
                && !!currentPostId
                && currentPostId !== receipt.postId
                && !!currentConversationId
                && currentConversationId === receipt.conversationId;

            if (acceptedPostOpened) return true;
            await this.sleep(PROMPTED_VIDEO_FOCUS_POLL_MS);
        }

        return false;
    }

    _getImaginePostId(url) {
        try {
            const pathname = new URL(url, window.location.origin).pathname;
            return pathname.match(/^\/imagine\/post\/([^/]+)/)?.[1] || null;
        } catch {
            return null;
        }
    }

    _getImagineConversationId(url) {
        try {
            return new URL(url, window.location.origin).searchParams.get('conversation') || null;
        } catch {
            return null;
        }
    }

    _getPromptedVideoSource(video) {
        return video.currentSrc || video.src || video.querySelector('source[src]')?.src || '';
    }

    _getPromptedVideoSourceIdentity(video) {
        const source = this._getPromptedVideoSource(video);
        return getGrokMediaIdentity(source) || source;
    }

    _getPromptedVideoSourceIdentities(searchRoot, selector = 'video', readyOnly = false) {
        return Array.from(searchRoot.querySelectorAll(selector))
            .filter((video) => !readyOnly || video.readyState >= 2)
            .map((video) => this._getPromptedVideoSourceIdentity(video))
            .filter(Boolean);
    }

    _getReadyPromptedVideoSources(searchRoot) {
        return Array.from(searchRoot.querySelectorAll('video'))
            .filter((video) => video.readyState >= 2)
            .map((video) => this._getPromptedVideoSource(video))
            .filter(Boolean);
    }

    _getAgentAssetSources(searchRoot) {
        const assets = searchRoot.matches?.('.react-flow__node-asset')
            ? [searchRoot]
            : Array.from(searchRoot.querySelectorAll('.react-flow__node-asset'));
        return assets
            .flatMap((asset) => Array.from(asset.querySelectorAll('img[src], video[src], source[src]')))
            .map((media) => media.currentSrc || media.src || '')
            .filter(Boolean);
    }

    _getReadyAgentAssetVideoSources(searchRoot) {
        const selector = searchRoot.matches?.('.react-flow__node-asset')
            ? 'video'
            : '.react-flow__node-asset video';
        return Array.from(searchRoot.querySelectorAll(selector))
            .filter((video) => video.readyState >= 2)
            .map((video) => this._getPromptedVideoSource(video))
            .filter(Boolean);
    }

    _getAgentAssetVideoSourceIdentities(searchRoot, readyOnly = false) {
        const selector = searchRoot.matches?.('.react-flow__node-asset')
            ? 'video'
            : '.react-flow__node-asset video';
        return this._getPromptedVideoSourceIdentities(
            searchRoot,
            selector,
            readyOnly
        );
    }

    capturePromptedVideoResultBaseline(searchRoot, agentBinding = null) {
        const surface = detectGrokScrapeSurface(document, window.location);
        const resolvedAgentBinding = surface === SCRAPE_SURFACES.agentMedia
            ? this._resolveCurrentAgentMediaBinding(
                agentBinding || this._captureSelectedAgentMediaBinding()
            )
            : null;
        const agentAssetRoot = resolvedAgentBinding?.assetNode || null;
        return {
            pageUrl: window.location.href,
            postId: this._getImaginePostId(window.location.href),
            surface,
            completeCount: searchRoot.querySelectorAll('button[aria-label="Video Generation Complete"]').length,
            videoSources: this._getReadyPromptedVideoSources(searchRoot),
            videoSourceIdentities: this._getPromptedVideoSourceIdentities(searchRoot),
            agentAssetNodeId: resolvedAgentBinding?.assetNodeId || null,
            agentAssetSourceIdentity: resolvedAgentBinding?.sourceIdentity || '',
            agentAssetSources: agentAssetRoot ? this._getAgentAssetSources(agentAssetRoot) : [],
            agentAssetVideoSources: agentAssetRoot ? this._getReadyAgentAssetVideoSources(agentAssetRoot) : [],
            agentAssetVideoSourceIdentities: agentAssetRoot
                ? this._getAgentAssetVideoSourceIdentities(agentAssetRoot)
                : []
        };
    }

    _hasNewPromptedVideoResult(searchRoot, baseline) {
        const currentSurface = detectGrokScrapeSurface(document, window.location);
        if (baseline.surface === SCRAPE_SURFACES.agentMedia) {
            if (currentSurface !== SCRAPE_SURFACES.agentMedia || !baseline.agentAssetNodeId) return false;
            const currentBinding = this._resolveCurrentAgentMediaBinding({
                assetNodeId: baseline.agentAssetNodeId,
                sourceIdentity: baseline.agentAssetSourceIdentity || '',
                sourceUrl: ''
            });
            if (!currentBinding) return false;
            const baselineAgentVideoIdentities = new Set(
                baseline.agentAssetVideoSourceIdentities || []
            );
            return this._getAgentAssetVideoSourceIdentities(currentBinding.assetNode, true)
                .some((identity) => !baselineAgentVideoIdentities.has(identity));
        }
        const baselineVideoIdentities = new Set(
            baseline.videoSourceIdentities
            || (baseline.videoSources || []).map((source) => getGrokMediaIdentity(source) || source)
        );
        const hasNewReadyVideo = this._getPromptedVideoSourceIdentities(searchRoot, 'video', true)
            .some((identity) => !baselineVideoIdentities.has(identity));
        if (!hasNewReadyVideo) return false;

        const currentUrl = window.location.href;
        const currentPostId = this._getImaginePostId(currentUrl);
        const navigatedToNewPost = !!currentPostId
            && !!baseline.postId
            && currentPostId !== baseline.postId;
        const completionCount = searchRoot.querySelectorAll(
            'button[aria-label="Video Generation Complete"]'
        ).length;

        return navigatedToNewPost
            || currentUrl !== baseline.pageUrl
            || completionCount > (baseline.completeCount || 0);
    }

    async _sendGenerationMessage(message, operation) {
        const result = await safeChromeRuntimeSendMessage(message, operation);
        if (result.invalidated) {
            showExtensionContextRefreshed(this.overlay);
            return null;
        }
        return result.ok ? result.value : null;
    }

    _rememberGenerationRun(response) {
        if (response?.run) this.generationRun = response.run;
        if (this.generationRun?.counts) {
            const isVideoGoal = this.generationRun.kind === 'video_goal';
            this.goalCount = isVideoGoal
                ? this.generationRun.goalProgress
                : this.generationRun.counts.accepted;
            this.goalTotal = isVideoGoal
                ? this.generationRun.options.goalCount
                : this.generationRun.items.length;
            if (isVideoGoal) {
                const goalItem = this.generationRun.items[0];
                this.currentRetry = Math.max(
                    0,
                    Number(goalItem?.attemptsThisRound || 0)
                        - (goalItem?.lastOutcome === 'accepted' ? 1 : 0)
                );
            }
            this.batchIndex = this.generationRun.counts.accepted
                + this.generationRun.counts.failed
                + this.generationRun.counts.skipped;
            this.updateCounters();
        }
        return response;
    }

    _getGenerationOrigin(surface, descriptor = null) {
        let viewportReceipt = null;
        if (descriptor && surface === 'saved_gallery') {
            viewportReceipt = captureSavedViewportReceipt({
                sourceIdentity: descriptor.sourcePostId
            });
        } else if (descriptor && surface === 'results_gallery') {
            const sourceIds = new Set([
                descriptor.sourcePostId,
                descriptor.sourceAssetId
            ].filter(Boolean));
            const originItem = this._getQualifiedResultsGalleryItems()
                .find((item) => sourceIds.has(item.sourceId));
            if (originItem) viewportReceipt = this._captureResultsGalleryReceipt(originItem);
        }
        return {
            surface,
            url: window.location.href,
            pathname: window.location.pathname,
            scrollY: viewportReceipt?.scrollTop
                ?? Math.round(window.scrollY || document.documentElement.scrollTop || 0),
            ...(viewportReceipt ? { viewportReceipt } : {}),
            ...(descriptor ? {
                hrefPath: descriptor.hrefPath || '',
                sourceAssetId: descriptor.sourceAssetId,
                sourcePostId: descriptor.sourcePostId,
                conversationId: descriptor.conversationId
            } : {})
        };
    }

    _detectGenerationSurface() {
        if (!GrokImagineAdapter) return 'unsupported';
        return GrokImagineAdapter.detectGrokSurface({
            root: document,
            location: {
                pathname: window.location.pathname,
                search: window.location.search
            }
        });
    }

    _getActiveGenerationDescriptor(run = this.generationRun) {
        return run?.items?.find((item) => (
            item.status === 'targeting'
            || item.status === 'composer_ready'
            || item.status === 'submitted'
        ))?.descriptor
            || run?.items?.find((item) => item.status === 'queued')?.descriptor
            || run?.items?.[0]?.descriptor
            || null;
    }

    _buildGenerationResumeProof(descriptor = this._getActiveGenerationDescriptor()) {
        const surface = this._detectGenerationSurface();
        if (surface === 'unsupported') return null;
        const url = window.location.href;

        if (surface === 'results_gallery' || surface === 'saved_gallery') {
            if (surface !== this.generationRun?.origin?.surface) return null;
            if (!descriptor) return null;
            const resolved = GrokImagineAdapter.resolveGalleryItem({
                root: document,
                descriptor
            });
            if (resolved.status !== 'matched') return null;
            return {
                surface,
                url,
                sourceAssetId: descriptor.sourceAssetId,
                sourcePostId: descriptor.sourcePostId
            };
        }

        if (!descriptor) return null;
        const activeItem = this.generationRun?.items?.find((item) => (
            item.status === 'targeting'
            || item.status === 'composer_ready'
            || item.status === 'submitted'
        )) || null;
        if (activeItem?.status === 'submitted' && surface === 'legacy_detail') {
            const checkpoint = this._restoreAdapterSubmissionReceipt(activeItem.receipt);
            const submissionStatus = checkpoint
                ? GrokImagineAdapter.evaluateSubmissionReceipt({ root: document, receipt: checkpoint })
                : 'pending';
            if (submissionStatus === 'accepted'
                || submissionStatus === 'rejected'
                || submissionStatus === 'usage_limited') {
                return {
                    surface,
                    url,
                    sourceAssetId: descriptor.sourceAssetId,
                    sourcePostId: descriptor.sourcePostId,
                    submissionChild: true
                };
            }
        }
        const currentConversationId = getGrokConversationId(url);
        if (this.generationRun?.kind === 'video_goal'
            && activeItem?.status === 'submitted'
            && descriptor.conversationId
            && currentConversationId === descriptor.conversationId
            && (surface === 'legacy_detail' || surface === 'agent_media')) {
            return {
                surface,
                url,
                conversationId: currentConversationId,
                videoGoalSubmitted: true
            };
        }
        const identityReceipt = GrokImagineAdapter.captureSubmissionReceipt({
            root: document,
            descriptor,
            action: 'resume_identity'
        });
        if (!identityReceipt) return null;
        return {
            surface,
            url,
            sourceAssetId: descriptor.sourceAssetId,
            sourcePostId: descriptor.sourcePostId
        };
    }

    async _startGenerationRun(kind, surface, items, prompt = '', options = {}) {
        const response = await this._sendGenerationMessage({
            action: 'GENERATION_RUN_START',
            kind,
            origin: this._getGenerationOrigin(surface, items[0] || null),
            items,
            prompt,
            options
        }, `start ${kind}`);
        this._rememberGenerationRun(response);
        await this.overlay?.refreshActiveWorkflowStatus?.();
        return response;
    }

    async _claimGenerationAction(options = {}) {
        if (!this.generationRun) return null;
        const resumeOptions = {};
        if (this.generationResumePending) {
            const resumeProof = this._buildGenerationResumeProof();
            if (!resumeProof) {
                return {
                    status: 'rejected',
                    error: 'GENERATION_RESUME_SURFACE_UNPROVEN',
                    run: this.generationRun
                };
            }
            resumeOptions.resume = true;
            resumeOptions.resumeProof = resumeProof;
        }
        const response = await this._sendGenerationMessage({
            action: 'GENERATION_RUN_CLAIM',
            runId: this.generationRun.runId,
            epoch: this.generationRun.epoch,
            ...resumeOptions,
            ...options
        }, 'claim generation action');
        this._rememberGenerationRun(response);
        if (response && response.status !== 'rejected') this.generationResumePending = false;
        return response;
    }

    setupGenerationCancellationListener() {
        if (this.generationCancellationListenerInstalled) return;
        const listener = (request, _sender, sendResponse) => {
            if (request?.action !== 'GENERATION_RUN_CANCELLED') return false;
            const localActive = this.generationRun
                && !['completed', 'cancelled', 'failed'].includes(this.generationRun.status);
            const differentActiveRun = localActive && request.runId !== this.generationRun.runId;
            const acknowledged = Boolean(request.runId) && !differentActiveRun;
            const matches = acknowledged
                && this.generationRun
                && request.runId === this.generationRun.runId;
            if (acknowledged) {
                this.batchAborted = true;
                this.batchRunning = false;
                this.goalRunning = false;
                this.batchRunToken = null;
                if (matches) {
                    this.generationRun = {
                        ...this.generationRun,
                        epoch: request.epoch,
                        status: 'cancelled'
                    };
                }
                this._clearPromptedVideoComposerRoot();
                this.updateBatchButtons(false);
                this.updateGenerationRunControls(this.generationRun);
                this.safeStatus('Generation run cancelled', 'neutral');
            }
            sendResponse({ acknowledged });
            return false;
        };
        const installed = safeChromeAddListener(
            () => chrome.runtime.onMessage,
            listener,
            'listen for generation cancellation'
        );
        if (installed.ok) {
            this.generationCancellationListenerInstalled = true;
        }
    }

    async resumeGenerationRunIfNeeded() {
        const response = await this._sendGenerationMessage({
            action: 'GENERATION_RUN_STATUS'
        }, 'load generation run status');
        if (!response?.isOwner || response.status !== 'active' || !response.run) return false;
        this._rememberGenerationRun(response);
        this.updateGenerationRunControls(this.generationRun);
        if (this.generationRun.status === 'retryable_failed') {
            this.safeStatus(
                `${this.generationRun.kind}: ${this.generationRun.counts.accepted} accepted, ${this.generationRun.counts.failed} failed.${this._getGenerationFailureSummary(this.generationRun)} Retry Failed or Cancel Run.`,
                'warning'
            );
            return true;
        }
        return this.resumeGenerationRun({ automatic: true });
    }

    _getGenerationFailureSummary(run = this.generationRun) {
        const codes = Array.from(new Set((run?.items || [])
            .map((item) => item.failureCode)
            .filter(Boolean)));
        if (codes.length === 0) return '';
        const labels = {
            provider_usage_limit: ' Grok usage limit reached.',
            provider_rejected: ' Grok rejected the generation.',
            submission_outcome_unconfirmed: ' Grok did not expose a verifiable launch receipt.',
            provider_capacity: ' Grok generation capacity is unavailable.'
        };
        return labels[codes[0]] || ` Failure: ${codes[0].replace(/_/g, ' ')}.`;
    }

    async resumeGenerationRun(options = {}) {
        if (!this.generationRun) {
            const response = await this._sendGenerationMessage({
                action: 'GENERATION_RUN_STATUS'
            }, 'load generation run status');
            if (!response?.isOwner || response.status !== 'active' || !response.run) return false;
            this._rememberGenerationRun(response);
        }
        if (this.generationRun.status === 'retryable_failed') {
            this.updateGenerationRunControls(this.generationRun);
            return false;
        }

        const descriptor = this._getActiveGenerationDescriptor();
        let runtimePrepared = false;
        const prepareRuntime = () => {
            if (runtimePrepared) return;
            this.batchAborted = false;
            this.batchContext = this.generationRun.origin.surface;
            this.batchRunToken = this.createBatchRunToken();
            if (this.generationRun.kind === 'video_goal') {
                this.goalRunning = true;
                this.batchRunning = false;
                this.batchMode = null;
                this.goalTotal = this.generationRun.options.goalCount;
                this.goalCount = this.generationRun.goalProgress;
            } else {
                this.goalRunning = false;
                this.batchRunning = true;
                this.batchMode = this.generationRun.kind === 'quick_batch' ? 'quick' : 'prompted';
                this.goalTotal = this.generationRun.items.length;
            }
            runtimePrepared = true;
            this.updateCounters();
        };
        const clearPreparedRuntime = () => {
            if (!runtimePrepared) return;
            this.batchRunning = false;
            this.goalRunning = false;
            this.batchRunToken = null;
            runtimePrepared = false;
        };

        let resumeProof = this._buildGenerationResumeProof(descriptor);
        const originSurface = this.generationRun.origin?.surface;
        if (!resumeProof
            && (originSurface === 'results_gallery' || originSurface === 'saved_gallery')) {
            let originPath = '';
            try {
                originPath = new URL(this.generationRun.origin.url).pathname;
            } catch { }
            if (originPath && window.location.pathname === originPath) {
                prepareRuntime();
                await this._waitForGenerationOrigin(this.batchRunToken, 15000);
                resumeProof = this._buildGenerationResumeProof(descriptor);
                if (!resumeProof) clearPreparedRuntime();
            }
        }

        if (!resumeProof) {
            const originUrl = this.generationRun.origin?.url;
            if (!originUrl || options.automatic) {
                this.safeStatus('Resume Run: return to the original Grok source', 'warning');
                this.updateGenerationRunControls(this.generationRun, { resume: true });
                return false;
            }
            window.location.assign(originUrl);
            return true;
        }

        prepareRuntime();
        this.generationResumePending = true;
        this.updateGenerationRunControls(this.generationRun);
        if (this.generationRun.kind === 'video_goal') {
            await this._runVideoGoal(this.batchRunToken);
            return true;
        }
        this.updateBatchButtons(true);
        if (this.generationRun.kind === 'quick_batch') {
            await this._runQuickBatch(this.batchRunToken);
            return true;
        }
        if (this.generationRun.kind === 'prompted_batch') {
            await this._runPromptedBatch(this.batchRunToken);
            return true;
        }
        this.safeStatus('Resume Run: unsupported generation workflow', 'warning');
        this.updateGenerationRunControls(this.generationRun, { resume: true });
        return false;
    }

    async retryFailedGenerationRun() {
        if (!this.generationRun || this.generationRun.status !== 'retryable_failed') return false;
        const response = await this._sendGenerationMessage({
            action: 'GENERATION_RUN_RETRY_FAILED',
            runId: this.generationRun.runId,
            epoch: this.generationRun.epoch
        }, 'retry failed generation items');
        this._rememberGenerationRun(response);
        if (response?.status !== 'updated') {
            this.safeStatus(`Retry Failed: ${response?.error || 'Could not resume'}`, 'warning');
            return false;
        }
        this.generationResumePending = false;
        return this.resumeGenerationRun();
    }

    async _reportGenerationAction(claim, outcome, failureCode = '', receipt = null) {
        const response = await this._sendGenerationMessage({
            action: 'GENERATION_RUN_REPORT',
            runId: claim.runId,
            epoch: claim.epoch,
            itemId: claim.itemId,
            claimId: claim.claimId,
            outcome,
            failureCode,
            receipt
        }, `report generation ${outcome}`);
        this._rememberGenerationRun(response);
        return response;
    }

    _createGenerationReceipt(claim, observedState, extra = {}) {
        return {
            sourceAssetId: claim.descriptor.sourceAssetId,
            sourcePostId: claim.descriptor.sourcePostId,
            observedState,
            observedAt: Date.now(),
            ...extra
        };
    }

    _createCheckpointedGenerationReceipt(claim, observedState, checkpoint) {
        return this._createGenerationReceipt(claim, observedState, {
            checkpointVersion: checkpoint.version,
            checkpointAction: checkpoint.action,
            checkpointSourceKind: checkpoint.sourceKind,
            checkpointSourceNodeId: checkpoint.sourceNodeId || '',
            baselineAcceptedCount: checkpoint.baseline.acceptedCount,
            baselineRejectedCount: checkpoint.baseline.rejectedCount
        });
    }

    _createGenerationDispatch(claim, checkpoint) {
        return {
            runId: claim.runId,
            epoch: claim.epoch,
            itemId: claim.itemId,
            claimId: claim.claimId,
            acceptOnClick: true,
            receipt: this._createCheckpointedGenerationReceipt(
                claim,
                'submit_dispatched',
                checkpoint
            )
        };
    }

    _restoreAdapterSubmissionReceipt(receipt) {
        if (receipt?.checkpointVersion !== 1
            || !Number.isInteger(receipt.baselineAcceptedCount)
            || !Number.isInteger(receipt.baselineRejectedCount)) {
            return null;
        }
        return {
            version: 1,
            action: receipt.checkpointAction,
            sourceKind: receipt.checkpointSourceKind,
            sourceNodeId: receipt.checkpointSourceNodeId || '',
            sourceAssetId: receipt.sourceAssetId,
            sourcePostId: receipt.sourcePostId,
            baseline: {
                acceptedCount: receipt.baselineAcceptedCount,
                rejectedCount: receipt.baselineRejectedCount
            }
        };
    }

    _createVideoGoalReceipt(claim, observedState, checkpoint, resultBaseline, extra = {}) {
        const providerBaseline = resultBaseline?.version === 1
            ? {
                resultBaselineVersion: resultBaseline.version,
                baselineResultAssetIds: [...resultBaseline.mediaAssetIds],
                baselineFailureCount: resultBaseline.failureCount,
                sourceResponseId: resultBaseline.sourceResponseId,
                baselineFailureResponseIds: [...resultBaseline.failureResponseIds],
                baselineInflightResponseIds: [...(resultBaseline.inflightResponseIds || [])],
                baselineVideoGenerationResponseIds: [
                    ...(resultBaseline.videoGenerationResponseIds || [])
                ]
            }
            : {};
        return {
            ...this._createCheckpointedGenerationReceipt(claim, observedState, checkpoint),
            ...providerBaseline,
            ...extra
        };
    }

    _createDomResultBaselineReceiptFields(baseline) {
        if (baseline?.version !== 1
            || !Array.isArray(baseline.mediaAssetIds)
            || !Number.isInteger(baseline.failureCount)) {
            return {};
        }
        return {
            domResultBaselineVersion: baseline.version,
            baselineDomResultAssetIds: [...baseline.mediaAssetIds],
            baselineDomFailureCount: baseline.failureCount
        };
    }

    _createVideoGoalDispatch(claim, checkpoint, resultBaseline, extra = {}) {
        return {
            runId: claim.runId,
            epoch: claim.epoch,
            itemId: claim.itemId,
            claimId: claim.claimId,
            receipt: this._createVideoGoalReceipt(
                claim,
                'submit_dispatched',
                checkpoint,
                resultBaseline,
                extra
            )
        };
    }

    _restoreGeneratedResultBaseline(receipt) {
        if (receipt?.resultBaselineVersion !== 1
            || !Array.isArray(receipt.baselineResultAssetIds)
            || !Number.isInteger(receipt.baselineFailureCount)
            || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
                String(receipt.sourceResponseId || '')
            )
            || !Array.isArray(receipt.baselineFailureResponseIds)) {
            return null;
        }
        return {
            version: 1,
            mediaAssetIds: [...receipt.baselineResultAssetIds],
            failureCount: receipt.baselineFailureCount,
            sourceResponseId: receipt.sourceResponseId.toLowerCase(),
            failureResponseIds: [...receipt.baselineFailureResponseIds],
            inflightResponseIds: Array.isArray(receipt.baselineInflightResponseIds)
                ? [...receipt.baselineInflightResponseIds]
                : [],
            videoGenerationResponseIds: Array.isArray(receipt.baselineVideoGenerationResponseIds)
                ? [...receipt.baselineVideoGenerationResponseIds]
                : null
        };
    }

    _restoreDomGeneratedResultBaseline(receipt) {
        if (receipt?.domResultBaselineVersion !== 1
            || !Array.isArray(receipt.baselineDomResultAssetIds)
            || !Number.isInteger(receipt.baselineDomFailureCount)) {
            return null;
        }
        return {
            version: 1,
            mediaAssetIds: [...receipt.baselineDomResultAssetIds],
            failureCount: receipt.baselineDomFailureCount
        };
    }

    async _captureVideoGoalInventoryBaseline(descriptor) {
        const conversationId = getGrokConversationId(
            `https://grok.com/?conversation=${descriptor?.conversationId || ''}`
        );
        if (!conversationId) return null;
        const inventory = await fetchGrokConversationAssetInventoryViaBridge(conversationId);
        const sourceAsset = inventory.assets.find((asset) => (
            asset.assetId === descriptor?.sourceAssetId
        ));
        const sourceResponseId = String(sourceAsset?.responseId || '').toLowerCase();
        if (!sourceResponseId) return null;
        return {
            version: 1,
            mediaAssetIds: inventory.assets
                .filter((asset) => (
                    asset.mediaKind === 'video'
                    && asset.parentResponseId === sourceResponseId
                ))
                .map((asset) => asset.assetId)
                .sort(),
            failureCount: inventory.failureCount,
            sourceResponseId,
            failureResponseIds: inventory.failedResponses
                .filter((response) => response.parentResponseId === sourceResponseId)
                .map((response) => response.responseId)
                .sort(),
            inflightResponseIds: inventory.inflightResponses
                .filter((response) => response.parentResponseId === sourceResponseId)
                .map((response) => response.responseId)
                .sort(),
            videoGenerationResponseIds: inventory.videoGenerationResponses
                .filter((response) => response.parentResponseId === sourceResponseId)
                .map((response) => response.responseId)
                .sort()
        };
    }

    _findPlayableVideoByAssetId(assetId) {
        const matches = Array.from(document.querySelectorAll('video'))
            .filter((video) => getGrokMediaIdentity(getBackupMediaElementSrc(video)) === assetId);
        if (matches.length > 1) {
            const playable = matches.filter((video) => (
                Number(video.readyState) >= 2
                && Number.isFinite(Number(video.duration))
                && Number(video.duration) > 0
                && Number(video.videoWidth) > 0
                && Number(video.videoHeight) > 0
            ));
            return playable.length === 1 ? playable[0] : null;
        }
        const video = matches[0];
        return video
            && Number(video.readyState) >= 2
            && Number.isFinite(Number(video.duration))
            && Number(video.duration) > 0
            && Number(video.videoWidth) > 0
            && Number(video.videoHeight) > 0
            ? video
            : null;
    }

    async _verifyPlayableVideoSource(asset, runToken, timeoutMs = 20000) {
        if (!asset?.assetId || !asset.sourceUrl || !this.isBatchRunActive(runToken)) return false;
        if (this._findPlayableVideoByAssetId(asset.assetId)) return true;

        const probe = document.createElement('video');
        probe.preload = 'metadata';
        probe.muted = true;
        return new Promise((resolve) => {
            let settled = false;
            const finish = (value) => {
                if (settled) return;
                settled = true;
                clearTimeout(timeoutId);
                probe.removeAttribute('src');
                try { probe.load(); } catch { }
                resolve(value && this.isBatchRunActive(runToken));
            };
            const verify = () => finish(
                Number.isFinite(Number(probe.duration))
                && Number(probe.duration) > 0
                && Number(probe.videoWidth) > 0
                && Number(probe.videoHeight) > 0
            );
            const timeoutId = setTimeout(() => finish(false), timeoutMs);
            probe.addEventListener('loadedmetadata', verify, { once: true });
            probe.addEventListener('canplay', verify, { once: true });
            probe.addEventListener('error', () => finish(false), { once: true });
            probe.src = asset.sourceUrl;
            try { probe.load(); } catch { finish(false); }
        });
    }

    async _inspectVideoGoalInventoryResult(descriptor, before, runToken, timeoutMs = 30000) {
        const conversationId = getGrokConversationId(
            `https://grok.com/?conversation=${descriptor?.conversationId || ''}`
        );
        if (!conversationId || before?.version !== 1
            || !Array.isArray(before.mediaAssetIds)
            || !Number.isInteger(before.failureCount)
            || !before.sourceResponseId
            || !Array.isArray(before.failureResponseIds)) {
            return { status: 'ambiguous', resultAssetId: '' };
        }
        const inventory = await fetchGrokConversationAssetInventoryViaBridge(
            conversationId,
            document,
            timeoutMs
        );
        if (inventory.failureCount < before.failureCount) {
            return { status: 'ambiguous', resultAssetId: '' };
        }
        const baselineAssetIds = new Set(before.mediaAssetIds.map(getGrokMediaIdentity).filter(Boolean));
        const baselineFailureIds = new Set(before.failureResponseIds);
        const baselineInflightIds = new Set(before.inflightResponseIds || []);
        const failures = inventory.failedResponses.filter((response) => (
            response.parentResponseId === before.sourceResponseId
            && !baselineFailureIds.has(response.responseId)
        ));
        const candidates = inventory.assets.filter((asset) => (
            asset.mediaKind === 'video'
            && asset.parentResponseId === before.sourceResponseId
            && !baselineAssetIds.has(asset.assetId)
        ));
        if (failures.length > 1 || candidates.length > 1
            || (failures.length === 1 && candidates.length === 1)) {
            return { status: 'ambiguous', resultAssetId: '' };
        }
        if (failures.length === 1) return { status: 'failed', resultAssetId: '' };
        if (candidates.length === 1) {
            const playable = await this._verifyPlayableVideoSource(
                candidates[0],
                runToken,
                timeoutMs
            );
            if (playable) return { status: 'ready', resultAssetId: candidates[0].assetId };
        }
        const sourceInflight = inventory.inflightResponses.filter((response) => (
            response.parentResponseId === before.sourceResponseId
            && !baselineInflightIds.has(response.responseId)
        ));
        const inflight = sourceInflight.length > 0;
        return {
            status: inflight ? 'inflight' : 'pending',
            resultAssetId: '',
            progressSignature: JSON.stringify({
                candidates: candidates.map((asset) => asset.assetId).sort(),
                failures: failures.map((response) => response.responseId).sort(),
                inflight: sourceInflight.map((response) => response.responseId).sort(),
                inflightCount: inventory.inflightResponseCount
            })
        };
    }

    async _waitForVideoGoalInventoryResult(
        descriptor,
        before,
        runToken,
        timeoutMs = GENERATION_RESULT_TIMEOUT_MS
    ) {
        if (before?.version !== 1) return { status: 'ambiguous', resultAssetId: '' };
        const idleTimeoutMs = Math.max(1000, Number(timeoutMs) || GENERATION_RESULT_TIMEOUT_MS);
        const startedAt = Date.now();
        const hardDeadline = startedAt + Math.max(
            idleTimeoutMs + 120000,
            VIDEO_GOAL_HARD_RESULT_WAIT_MS
        );
        let idleDeadline = startedAt + idleTimeoutMs;
        let lastProgressSignature = '';
        while (this.isBatchRunActive(runToken)
            && Date.now() < hardDeadline
            && Date.now() < idleDeadline) {
            let inspection;
            try {
                inspection = await this._inspectVideoGoalInventoryResult(
                    descriptor,
                    before,
                    runToken,
                    Math.min(30000, Math.max(1000, hardDeadline - Date.now()))
                );
            } catch {
                if (!this.isBatchRunActive(runToken)) {
                    return { status: 'cancelled', resultAssetId: '' };
                }
                await this.sleep(Math.min(2000, Math.max(0, idleDeadline - Date.now())));
                continue;
            }
            if (inspection.status !== 'pending' && inspection.status !== 'inflight') {
                return inspection;
            }
            if (inspection.progressSignature !== lastProgressSignature) {
                lastProgressSignature = inspection.progressSignature;
                idleDeadline = Math.min(hardDeadline, Date.now() + idleTimeoutMs);
            }
            await this.sleep(Math.min(2000, Math.max(0, idleDeadline - Date.now())));
        }
        return {
            status: this.isBatchRunActive(runToken) ? 'timeout' : 'cancelled',
            resultAssetId: ''
        };
    }

    async _waitForAdapterSubmission(receipt, runToken, timeoutMs = GENERATION_ACCEPTANCE_TIMEOUT_MS) {
        const attempts = Math.max(1, Math.ceil(timeoutMs / GENERATION_ACCEPTANCE_POLL_MS));
        for (let attempt = 0; attempt < attempts; attempt++) {
            if (!this.isBatchRunActive(runToken)) return 'cancelled';
            const status = GrokImagineAdapter.evaluateSubmissionReceipt({ root: document, receipt });
            if (status !== 'pending') return status;
            await this.sleep(GENERATION_ACCEPTANCE_POLL_MS);
        }
        return 'pending';
    }

    async _inspectPromptedProviderAcceptance(descriptor, baseline, checkpoint, runToken) {
        const adapterStatus = checkpoint
            ? GrokImagineAdapter.evaluateSubmissionReceipt({ root: document, receipt: checkpoint })
            : 'pending';
        if (adapterStatus === 'accepted'
            || adapterStatus === 'rejected'
            || adapterStatus === 'usage_limited') {
            return adapterStatus;
        }
        if (!baseline?.sourceResponseId || !descriptor?.conversationId) {
            return adapterStatus === 'ambiguous' ? 'ambiguous' : 'pending';
        }

        const inventory = await fetchGrokConversationAssetInventoryViaBridge(
            descriptor.conversationId,
            document,
            10000
        );
        if (!this.isBatchRunActive(runToken)) return 'cancelled';
        const baselineAssetIds = new Set(baseline.mediaAssetIds || []);
        const baselineFailureIds = new Set(baseline.failureResponseIds || []);
        const baselineInflightIds = new Set(baseline.inflightResponseIds || []);
        const baselineVideoGenerationIds = Array.isArray(baseline.videoGenerationResponseIds)
            ? new Set(baseline.videoGenerationResponseIds)
            : null;
        const newFailures = inventory.failedResponses.filter((response) => (
            response.parentResponseId === baseline.sourceResponseId
            && !baselineFailureIds.has(response.responseId)
        ));
        const newVideos = inventory.assets.filter((asset) => (
            asset.mediaKind === 'video'
            && asset.parentResponseId === baseline.sourceResponseId
            && !baselineAssetIds.has(asset.assetId)
        ));
        const inflight = inventory.inflightResponses.filter((response) => (
            response.parentResponseId === baseline.sourceResponseId
            && !baselineInflightIds.has(response.responseId)
        ));
        const videoGenerationResponses = baselineVideoGenerationIds
            ? inventory.videoGenerationResponses.filter((response) => (
                response.parentResponseId === baseline.sourceResponseId
                && !baselineVideoGenerationIds.has(response.responseId)
            ))
            : [];
        const responseIds = new Set([
            ...newFailures.map((response) => response.responseId),
            ...newVideos.map((asset) => asset.responseId),
            ...inflight.map((response) => response.responseId),
            ...videoGenerationResponses.map((response) => response.responseId)
        ].filter(Boolean));
        if (responseIds.size > 1) return 'ambiguous';
        if (newFailures.length === 1) return 'rejected';
        if (newVideos.length > 0 || inflight.length > 0 || videoGenerationResponses.length > 0) {
            return 'accepted';
        }
        return adapterStatus === 'ambiguous' ? 'ambiguous' : 'pending';
    }

    async _waitForPromptedProviderAcceptance(
        descriptor,
        baseline,
        checkpoint,
        runToken,
        timeoutMs = GENERATION_ACCEPTANCE_TIMEOUT_MS
    ) {
        const deadline = Date.now() + Math.max(1000, Number(timeoutMs) || GENERATION_ACCEPTANCE_TIMEOUT_MS);
        while (this.isBatchRunActive(runToken) && Date.now() < deadline) {
            try {
                const status = await this._inspectPromptedProviderAcceptance(
                    descriptor,
                    baseline,
                    checkpoint,
                    runToken
                );
                if (status !== 'pending') return status;
            } catch {
                if (!this.isBatchRunActive(runToken)) return 'cancelled';
            }
            await this.sleep(Math.min(1000, Math.max(0, deadline - Date.now())));
        }
        return this.isBatchRunActive(runToken) ? 'pending' : 'cancelled';
    }

    async _waitForGeneratedResult(
        descriptor,
        before,
        runToken,
        timeoutMs = GENERATION_RESULT_TIMEOUT_MS
    ) {
        const attempts = Math.max(1, Math.ceil(timeoutMs / GENERATION_RESULT_POLL_MS));
        for (let attempt = 0; attempt < attempts; attempt++) {
            if (!this.isBatchRunActive(runToken)) {
                return { status: 'cancelled', resultAssetId: '' };
            }
            const result = GrokImagineAdapter.inspectGeneratedResult({
                root: document,
                before,
                expected: {
                    sourceAssetId: descriptor.sourceAssetId,
                    sourcePostId: descriptor.sourcePostId,
                    mediaKind: 'video'
                }
            });
            if (result.status !== 'pending') return result;
            await this.sleep(GENERATION_RESULT_POLL_MS);
        }
        return { status: 'timeout', resultAssetId: '' };
    }

    _getCapacityDescriptor(run = this.generationRun) {
        return run?.items?.find((item) => (
            item.status === 'queued' && item.failureCode === 'provider_capacity'
        ))?.descriptor || null;
    }

    _isGenerationActionAvailable(descriptor, action) {
        const resolved = GrokImagineAdapter.resolveMediaAction({ root: document, descriptor, action });
        const control = resolved?.control;
        return resolved?.status === 'matched'
            && !!control
            && !control.disabled
            && control.getAttribute('aria-disabled') !== 'true';
    }

    async _settleQuickBatchSubmission(claim, checkpoint, runToken) {
        // Quick Batch promises a bounded native dispatch, not completed provider output.
        // Give Grok time to apply immediate rejection or navigation state before returning.
        await this.sleep(1200);
        if (!this.isBatchRunActive(runToken)) return 'cancelled';
        if (this._getGenerationItem(claim.itemId)?.status === 'accepted') {
            return this._returnToGenerationOrigin(runToken);
        }
        const acceptance = GrokImagineAdapter.evaluateSubmissionReceipt({
            root: document,
            receipt: checkpoint
        });
        if (acceptance === 'accepted') {
            await this._reportGenerationAction(
                claim,
                'accepted',
                '',
                this._createGenerationReceipt(claim, 'provider_accepted')
            );
        } else if (acceptance === 'usage_limited') {
            await this._reportGenerationAction(
                claim,
                'retryable_failed',
                'provider_usage_limit'
            );
        } else if (acceptance === 'rejected') {
            await this._reportGenerationAction(claim, 'retryable_failed', 'provider_rejected');
        } else if (acceptance === 'ambiguous') {
            await this._reportGenerationAction(
                claim,
                'permanent_failed',
                'acceptance_ambiguous'
            );
        } else {
            await this._reportGenerationAction(
                claim,
                'accepted',
                '',
                this._createGenerationReceipt(claim, 'native_click_dispatched')
            );
        }
        return this._returnToGenerationOrigin(runToken);
    }

    async _runQuickBatch(runToken) {
        const retryBudget = Math.max(0, Number(this.generationRun?.options?.maxRetries) || 0);
        const maxSteps = Math.max(10, this.goalTotal * (retryBudget + 3));
        const maxIterations = maxSteps + Math.max(
            1,
            Math.ceil((this.generationRun?.options?.capacityTimeoutMs || 120000) / GENERATION_CAPACITY_POLL_MS)
        );
        let steps = 0;
        let iterations = 0;
        while (this.isBatchRunActive(runToken) && steps < maxSteps && iterations < maxIterations) {
            iterations += 1;
            const waitingDescriptor = this.generationRun?.status === 'waiting_capacity'
                ? this._getCapacityDescriptor()
                : null;
            if (waitingDescriptor) await this.sleep(GENERATION_CAPACITY_POLL_MS);
            const claimResponse = await this._claimGenerationAction(waitingDescriptor ? {
                capacityAvailable: this._isGenerationActionAvailable(waitingDescriptor, 'quick_video')
            } : {});
            if (!claimResponse || claimResponse.status === 'rejected') {
                this.safeStatus(`Quick Batch: ${claimResponse?.error || 'Run authority unavailable'}`, 'error');
                break;
            }
            if (claimResponse.status === 'waiting') {
                if (['completed', 'cancelled', 'retryable_failed', 'failed'].includes(this.generationRun?.status)) break;
                continue;
            }
            if (claimResponse.status !== 'claimed' && claimResponse.status !== 'resumed') break;

            const claim = claimResponse.claim;
            const descriptor = claim.descriptor;
            const persistedItem = this._getGenerationItem(claim.itemId);
            if (persistedItem?.status === 'submitted') {
                steps += 1;
                const checkpoint = this._restoreAdapterSubmissionReceipt(persistedItem.receipt);
                if (!checkpoint) {
                    await this._reportGenerationAction(
                        claim,
                        'permanent_failed',
                        'submission_checkpoint_missing'
                    );
                    const returned = await this._returnToGenerationOrigin(runToken);
                    if (returned === 'navigating' || returned === 'cancelled') return;
                    continue;
                }
                const settled = await this._settleQuickBatchSubmission(
                    claim,
                    checkpoint,
                    runToken
                );
                if (settled === 'navigating' || settled === 'cancelled') return;
                await this.sleep(500);
                continue;
            }
            const located = await this._locateGenerationGalleryDescriptor(descriptor, runToken);
            if (located.status !== 'matched') {
                steps += 1;
                await this._reportGenerationAction(
                    claim,
                    located.status === 'ambiguous' ? 'permanent_failed' : 'retryable_failed',
                    located.reason || 'gallery_item_missing'
                );
                continue;
            }
            const resolved = GrokImagineAdapter.resolveMediaAction({
                root: document,
                descriptor,
                action: 'quick_video'
            });
            if (resolved.status !== 'matched') {
                steps += 1;
                await this._reportGenerationAction(
                    claim,
                    resolved.status === 'ambiguous' ? 'permanent_failed' : 'retryable_failed',
                    resolved.reason || 'media_action_missing'
                );
                continue;
            }
            if (resolved.control.disabled || resolved.control.getAttribute('aria-disabled') === 'true') {
                await this._reportGenerationAction(claim, 'capacity', 'provider_capacity');
                continue;
            }

            resolved.control.scrollIntoView({ behavior: 'smooth', block: 'center' });
            await this.sleep(150);
            if (!this.isBatchRunActive(runToken)) break;
            const reacquired = GrokImagineAdapter.resolveMediaAction({
                root: document,
                descriptor,
                action: 'quick_video'
            });
            if (reacquired.status !== 'matched') {
                steps += 1;
                await this._reportGenerationAction(claim, 'retryable_failed', 'media_action_remounted');
                continue;
            }
            const receipt = GrokImagineAdapter.captureSubmissionReceipt({
                root: document,
                descriptor,
                action: 'quick_video'
            });
            if (!receipt) {
                steps += 1;
                await this._reportGenerationAction(claim, 'retryable_failed', 'submission_receipt_missing');
                continue;
            }
            const clicked = await this._clickPromptedBatchNativeControl(
                reacquired.control,
                runToken,
                'click Quick Batch Make Video',
                () => GrokImagineAdapter.resolveMediaAction({
                    root: document,
                    descriptor,
                    action: 'quick_video'
                }).control === reacquired.control,
                this._createGenerationDispatch(claim, receipt)
            );
            if (!clicked) {
                steps += 1;
                await this._reportGenerationAction(claim, 'retryable_failed', 'native_click_failed');
                continue;
            }
            steps += 1;
            const settled = await this._settleQuickBatchSubmission(
                claim,
                receipt,
                runToken
            );
            if (settled === 'navigating' || settled === 'cancelled') return;
            await this.sleep(500);
        }

        const run = this.generationRun;
        const stopped = this.batchAborted || run?.status === 'cancelled';
        this.batchRunning = false;
        this.batchRunToken = null;
        this.updateBatchButtons(false);
        this.updateCounters();
        if (stopped) {
            this.safeStatus(`Quick Batch: Stopped (${this.goalCount}/${this.goalTotal})`, 'neutral');
        } else if (run?.status === 'completed' && run.counts.failed === 0) {
            this.safeStatus(`Quick Batch: Dispatched (${run.counts.accepted}/${run.items.length})`, 'success');
        } else {
            const failed = run?.counts?.failed || 0;
            const pending = run?.counts?.pending || 0;
            const retrySuffix = run?.status === 'retryable_failed'
                ? ' Retry Failed is available.'
                : '';
            this.safeStatus(
                `Quick Batch: ${run?.counts?.accepted || 0} dispatched, ${failed} failed, ${pending} pending.${this._getGenerationFailureSummary(run)}${retrySuffix}`,
                'warning'
            );
        }
        await this.overlay?.refreshActiveWorkflowStatus?.();
    }

    _getGenerationItem(itemId) {
        return this.generationRun?.items?.find((item) => item.itemId === itemId) || null;
    }

    _getPromptedOpenTarget(descriptor) {
        const resolved = GrokImagineAdapter.resolveGalleryItem({ root: document, descriptor });
        if (resolved.status !== 'matched') return { status: resolved.status, reason: resolved.reason };
        const links = Array.from(resolved.card.querySelectorAll('a[href*="/imagine/post/"]'))
            .filter((link) => {
                try {
                    return new URL(link.href).pathname === `/imagine/post/${descriptor.sourcePostId}`;
                } catch {
                    return false;
                }
            });
        const hrefs = new Set(links.map((link) => link.href));
        if (hrefs.size > 1) return { status: 'ambiguous', reason: 'source_open_target_ambiguous' };
        const control = links[0]
            || this._getCardGeneratedImage(resolved.card)
            || resolved.card.querySelector('video');
        return control
            ? { status: 'matched', control, card: resolved.card }
            : { status: 'missing', reason: 'source_open_target_missing' };
    }

    _getGenerationGalleryContext(surface) {
        if (!GrokImagineAdapter?.resolveGallerySurface) {
            return { status: 'missing', reason: 'gallery_adapter_unavailable' };
        }
        const resolved = GrokImagineAdapter.resolveGallerySurface({
            root: document,
            surface
        });
        if (resolved.status !== 'matched') return resolved;
        return {
            ...resolved,
            scroller: getSavedGalleryScroller(resolved.galleryRoot)
        };
    }

    async _collectGenerationGalleryItems(surface, requestedLimit) {
        const limit = Math.max(1, Number(requestedLimit) || 1);
        const gallery = this._getGenerationGalleryContext(surface);
        if (gallery.status !== 'matched') {
            return { status: gallery.status, reason: gallery.reason, items: [] };
        }
        const scroller = gallery.scroller;
        const original = getSavedScrollerSnapshot(scroller);
        const collected = new Map();
        let stableBottomRounds = 0;
        let lastScrollHeight = -1;

        setSavedGalleryScrollTop(scroller, 0);
        await this.sleep(300);
        try {
            for (let step = 0; step < 100 && collected.size < limit; step++) {
                const listed = GrokImagineAdapter.listGalleryItems({ root: document, surface });
                if (listed.status !== 'ok') return listed;
                for (const descriptor of listed.items) {
                    const key = `${descriptor.sourceAssetId}:${descriptor.sourcePostId}`;
                    if (!collected.has(key)) collected.set(key, descriptor);
                    if (collected.size >= limit) break;
                }
                if (collected.size >= limit) break;

                const before = getSavedScrollerSnapshot(scroller);
                const maxTop = Math.max(0, before.scrollHeight - before.clientHeight);
                const nextTop = Math.min(maxTop, before.scrollTop + Math.max(320, before.clientHeight * 0.8));
                setSavedGalleryScrollTop(scroller, nextTop);
                await this.sleep(350);
                const after = getSavedScrollerSnapshot(scroller);
                const atBottom = after.scrollTop >= Math.max(0, after.scrollHeight - after.clientHeight - 2);
                const stableHeight = after.scrollHeight === lastScrollHeight;
                stableBottomRounds = atBottom && stableHeight ? stableBottomRounds + 1 : 0;
                lastScrollHeight = after.scrollHeight;
                if (stableBottomRounds >= 3) break;
            }
        } finally {
            setSavedGalleryScrollTop(scroller, original.scrollTop);
            await this.sleep(250);
        }

        const items = Array.from(collected.values()).slice(0, limit);
        return {
            status: 'ok',
            items: items.map((descriptor, index) => ({
                ...descriptor,
                initialOrder: index,
                beforeAssetId: items[index - 1]?.sourceAssetId || '',
                afterAssetId: items[index + 1]?.sourceAssetId || ''
            }))
        };
    }

    async _locateGenerationGalleryDescriptor(descriptor, runToken) {
        let resolved = GrokImagineAdapter.resolveGalleryItem({ root: document, descriptor });
        if (resolved.status === 'matched' || resolved.status === 'ambiguous') return resolved;
        const surface = descriptor.surface;
        if (surface !== 'results_gallery' && surface !== 'saved_gallery') return resolved;

        const gallery = this._getGenerationGalleryContext(surface);
        if (gallery.status !== 'matched') return gallery;
        const scroller = gallery.scroller;
        const original = getSavedScrollerSnapshot(scroller);
        let stableBottomRounds = 0;
        let lastScrollHeight = -1;
        setSavedGalleryScrollTop(scroller, 0);
        await this.sleep(250);

        for (let step = 0; step < 100 && this.isBatchRunActive(runToken); step++) {
            resolved = GrokImagineAdapter.resolveGalleryItem({ root: document, descriptor });
            if (resolved.status === 'matched' || resolved.status === 'ambiguous') return resolved;
            const before = getSavedScrollerSnapshot(scroller);
            const maxTop = Math.max(0, before.scrollHeight - before.clientHeight);
            const nextTop = Math.min(maxTop, before.scrollTop + Math.max(320, before.clientHeight * 0.8));
            setSavedGalleryScrollTop(scroller, nextTop);
            await this.sleep(300);
            const after = getSavedScrollerSnapshot(scroller);
            const atBottom = after.scrollTop >= Math.max(0, after.scrollHeight - after.clientHeight - 2);
            const stableHeight = after.scrollHeight === lastScrollHeight;
            stableBottomRounds = atBottom && stableHeight ? stableBottomRounds + 1 : 0;
            lastScrollHeight = after.scrollHeight;
            if (stableBottomRounds >= 3) break;
        }
        setSavedGalleryScrollTop(scroller, original.scrollTop);
        return resolved;
    }

    _isPromptedCapacityAvailable(descriptor, prompt) {
        const checkpoint = GrokImagineAdapter.captureSubmissionReceipt({
            root: document,
            descriptor,
            action: 'prompted_video'
        });
        if (!checkpoint) return false;
        const composer = this._getVerifiedPromptedVideoComposer(
            this.promptedVideoComposerRoot,
            false
        );
        if (!composer) return false;
        const value = composer.input instanceof HTMLTextAreaElement
            ? composer.input.value
            : composer.input.textContent;
        return (!prompt || String(value || '').trim() === String(prompt).trim())
            && this._isActionableAutomationTarget(composer.submitButton, 72);
    }

    async _waitForGenerationOrigin(runToken, timeoutMs = 10000) {
        const origin = this.generationRun?.origin;
        if (!origin?.url) return false;
        let originUrl;
        try {
            originUrl = new URL(origin.url);
        } catch {
            return false;
        }
        const attempts = Math.max(1, Math.ceil(timeoutMs / 200));
        let restoredScroll = false;
        for (let attempt = 0; attempt < attempts; attempt++) {
            if (!this.isBatchRunActive(runToken)) return false;
            const surface = this._detectGenerationSurface();
            const originConversationId = getGrokConversationId(originUrl.toString());
            const currentConversationId = getGrokConversationId(window.location.href);
            const routeMatches = window.location.pathname === originUrl.pathname
                && (!originConversationId || originConversationId === currentConversationId);
            if (routeMatches && origin.viewportReceipt && origin.surface === 'results_gallery') {
                return this._waitForPromptedBatchResultsSurface(
                    origin.viewportReceipt,
                    runToken,
                    Math.max(200, timeoutMs - (attempt * 200))
                );
            }
            if (surface === origin.surface && routeMatches) {
                if (origin.viewportReceipt && surface === 'saved_gallery') {
                    const restored = await restoreSavedViewportReceipt(origin.viewportReceipt, {
                        isActive: () => this.isBatchRunActive(runToken),
                        isScopeValid: () => this._detectGenerationSurface() === 'saved_gallery'
                            && window.location.pathname === originUrl.pathname
                            && (!originConversationId
                                || getGrokConversationId(window.location.href) === originConversationId),
                        sleep: (delay) => this.sleep(delay),
                        timeoutMs: Math.max(200, timeoutMs - (attempt * 200)),
                        pollInterval: 200
                    });
                    return restored.status === 'restored';
                }
                if (!restoredScroll && typeof window.scrollTo === 'function') {
                    window.scrollTo({ top: origin.scrollY || 0, behavior: 'instant' });
                    restoredScroll = true;
                    await this.sleep(200);
                    if (!this.isBatchRunActive(runToken)) return false;
                }
                return true;
            }
            await this.sleep(200);
        }
        return false;
    }

    async _returnToGenerationOrigin(runToken) {
        const origin = this.generationRun?.origin;
        const supportedSurfaces = new Set([
            'results_gallery',
            'saved_gallery',
            'legacy_detail',
            'agent_media'
        ]);
        if (!origin || !supportedSurfaces.has(origin.surface)) {
            return 'returned';
        }
        if (await this._waitForGenerationOrigin(runToken, 200)) return 'returned';

        const detailOrigin = origin.surface === 'legacy_detail' || origin.surface === 'agent_media';
        if (detailOrigin && typeof window.history?.back === 'function') {
            window.history.back();
            if (await this._waitForGenerationOrigin(runToken)) return 'returned';
        }

        if (!detailOrigin) {
            const backControl = this._findPromptedBatchBackControl();
            let nativeBackDispatched = false;
            if (backControl) {
                nativeBackDispatched = await this._clickPromptedBatchNativeControl(
                    backControl,
                    runToken,
                    'return to generation origin',
                    () => this._findPromptedBatchBackControl() === backControl
                );
                if (nativeBackDispatched
                    && await this._waitForGenerationOrigin(runToken)) return 'returned';
            }
            if (typeof window.history?.back === 'function') {
                window.history.back();
                if (await this._waitForGenerationOrigin(runToken)) return 'returned';
            }
        }

        if (!this.isBatchRunActive(runToken)) return 'cancelled';
        this.safeStatus('Generation run: recovering the original source...', 'warning');
        window.location.assign(origin.url);
        return 'navigating';
    }

    async _reportPromptedFailure(claim, code, permanent = false) {
        return this._reportGenerationAction(
            claim,
            permanent ? 'permanent_failed' : 'retryable_failed',
            code
        );
    }

    async _openPromptedDescriptor(claim, runToken) {
        const descriptor = claim.descriptor;
        const surface = this._detectGenerationSurface();
        if (surface === 'results_gallery' || surface === 'saved_gallery') {
            const located = await this._locateGenerationGalleryDescriptor(descriptor, runToken);
            if (located.status !== 'matched') {
                return { status: located.status, reason: located.reason || 'gallery_item_missing' };
            }
            const resolved = this._getPromptedOpenTarget(descriptor);
            if (resolved.status !== 'matched') {
                return { status: resolved.status, reason: resolved.reason };
            }
            if (this.isCensoredCard(resolved.card)) {
                return { status: 'rejected', reason: 'source_censored' };
            }
            resolved.control.scrollIntoView?.({ behavior: 'instant', block: 'center' });
            if (!this.isBatchRunActive(runToken)) return { status: 'cancelled' };
            const clicked = await this._clickPromptedBatchNativeControl(
                resolved.control,
                runToken,
                'open prompted batch source',
                () => this._getPromptedOpenTarget(descriptor).control === resolved.control
            );
            if (!clicked) return { status: 'missing', reason: 'source_open_failed' };
        }

        const editor = await this.waitForPromptedBatchEditorReady(
            descriptor.sourceAssetId,
            runToken
        );
        if (!this.isBatchRunActive(runToken)) return { status: 'cancelled' };
        if (editor.status !== 'ready') {
            return {
                status: editor.status === 'ambiguous' ? 'ambiguous' : 'missing',
                reason: editor.status === 'ambiguous'
                    ? 'source_identity_ambiguous'
                    : 'source_editor_unavailable'
            };
        }
        const identity = GrokImagineAdapter.captureSubmissionReceipt({
            root: document,
            descriptor,
            action: 'prompted_video'
        });
        if (!identity) return { status: 'missing', reason: 'source_identity_unproven' };
        return { status: 'ready', editor };
    }

    async _preparePromptedComposer(claim, editor, runToken) {
        const expectedPrompt = String(claim.prompt || '');
        let composer = this._getVerifiedPromptedVideoComposer(
            this.promptedVideoComposerRoot,
            false
        );
        const currentValue = composer
            ? (composer.input instanceof HTMLTextAreaElement
                ? composer.input.value
                : composer.input.textContent)
            : '';
        if (!composer || String(currentValue || '').trim() !== expectedPrompt.trim()) {
            const modeReady = await this.selectMakeVideoMode(
                runToken,
                editor.makeVideoTrigger,
                editor.agentBinding || null
            );
            if (!modeReady || !this.isBatchRunActive(runToken)) {
                return { status: 'missing', reason: 'add_prompt_unavailable' };
            }
            if (!this.injectPromptedVideoText(expectedPrompt)) {
                return { status: 'missing', reason: 'prompt_injection_failed' };
            }
            composer = this._getVerifiedPromptedVideoComposer(
                this.promptedVideoComposerRoot,
                false
            );
        }
        if (!composer) return { status: 'missing', reason: 'prompted_composer_missing' };

        const submit = await this._waitForPromptedVideoSubmitButton(
            runToken,
            editor.agentBinding || null
        );
        if (!submit) {
            const retained = this._getVerifiedPromptedVideoComposer(
                this.promptedVideoComposerRoot,
                false
            );
            return retained
                ? { status: 'capacity', reason: 'provider_capacity' }
                : { status: 'missing', reason: 'prompted_composer_lost' };
        }
        return { status: 'ready', editor, submit };
    }

    async _finishPromptedClaimOnOrigin(_claim, runToken) {
        const originSurface = this.generationRun?.origin?.surface;
        if (!['results_gallery', 'saved_gallery', 'legacy_detail', 'agent_media']
            .includes(originSurface)) {
            return 'returned';
        }
        const returned = await this._returnToGenerationOrigin(runToken);
        if (returned === 'returned') {
            this.safeStatus(
                `Prompted Batch: ${this.generationRun.counts.accepted}/${this.generationRun.items.length} accepted`,
                'info'
            );
        }
        return returned;
    }

    async _executePromptedClaim(claim, runToken) {
        this.batchPrompt = claim.prompt;
        const persistedItem = this._getGenerationItem(claim.itemId);
        if (persistedItem?.status === 'submitted') {
            const checkpoint = this._restoreAdapterSubmissionReceipt(persistedItem.receipt);
            const baseline = this._restoreGeneratedResultBaseline(persistedItem.receipt);
            const acceptance = await this._waitForPromptedProviderAcceptance(
                claim.descriptor,
                baseline,
                checkpoint,
                runToken,
                claim.options.acceptanceTimeoutMs || GENERATION_ACCEPTANCE_TIMEOUT_MS
            );
            if (acceptance === 'accepted') {
                await this._reportGenerationAction(
                    claim,
                    'accepted',
                    '',
                    this._createGenerationReceipt(claim, 'provider_accepted')
                );
            } else if (acceptance === 'usage_limited') {
                await this._reportPromptedFailure(claim, 'provider_usage_limit');
            } else if (acceptance === 'rejected') {
                await this._reportPromptedFailure(claim, 'provider_rejected');
            } else if (acceptance !== 'cancelled') {
                await this._reportPromptedFailure(claim, 'submission_outcome_unconfirmed');
            }
            return this._finishPromptedClaimOnOrigin(claim, runToken);
        }

        const opened = await this._openPromptedDescriptor(claim, runToken);
        if (opened.status !== 'ready') {
            if (opened.status !== 'cancelled') {
                await this._reportPromptedFailure(
                    claim,
                    opened.reason || 'source_editor_unavailable',
                    opened.status === 'ambiguous' || opened.status === 'rejected'
                );
            }
            return this._finishPromptedClaimOnOrigin(claim, runToken);
        }

        const prepared = await this._preparePromptedComposer(claim, opened.editor, runToken);
        if (prepared.status === 'capacity') {
            await this._reportGenerationAction(claim, 'capacity', 'provider_capacity');
            return 'capacity';
        }
        if (prepared.status !== 'ready') {
            await this._reportPromptedFailure(claim, prepared.reason || 'prompted_composer_unavailable');
            return this._finishPromptedClaimOnOrigin(claim, runToken);
        }

        const checkpoint = GrokImagineAdapter.captureSubmissionReceipt({
            root: document,
            descriptor: claim.descriptor,
            action: 'prompted_video'
        });
        if (!checkpoint) {
            await this._reportPromptedFailure(claim, 'submission_checkpoint_missing');
            return this._finishPromptedClaimOnOrigin(claim, runToken);
        }
        let resultBaseline;
        try {
            resultBaseline = await this._captureVideoGoalInventoryBaseline(claim.descriptor);
        } catch {
            resultBaseline = null;
        }
        if (persistedItem?.status !== 'composer_ready') {
            const composerCheckpoint = await this._reportGenerationAction(
                claim,
                'composer_ready',
                '',
                this._createCheckpointedGenerationReceipt(claim, 'composer_ready', checkpoint)
            );
            if (composerCheckpoint?.status === 'rejected') return 'stopped';
        }

        const submissionReceipt = this._capturePromptedVideoSubmissionReceipt();
        if (!submissionReceipt) {
            await this._reportPromptedFailure(claim, 'submission_receipt_missing');
            return this._finishPromptedClaimOnOrigin(claim, runToken);
        }

        const submitted = await this._clickPromptedBatchNativeControl(
            prepared.submit,
            runToken,
            'click prompted video submit',
            () => this._findPromptedVideoSubmitButton() === prepared.submit
                && (!opened.editor.agentBinding
                    || !!this._resolveCurrentAgentMediaBinding(opened.editor.agentBinding)),
            this._createVideoGoalDispatch(claim, checkpoint, resultBaseline)
        );
        if (!submitted) {
            await this._reportPromptedFailure(claim, 'native_submit_failed');
            return this._finishPromptedClaimOnOrigin(claim, runToken);
        }
        const acceptance = await this._waitForPromptedProviderAcceptance(
            claim.descriptor,
            resultBaseline,
            checkpoint,
            runToken,
            claim.options.acceptanceTimeoutMs || GENERATION_ACCEPTANCE_TIMEOUT_MS
        );
        if (acceptance === 'accepted') {
            await this._reportGenerationAction(
                claim,
                'accepted',
                '',
                this._createGenerationReceipt(claim, 'provider_accepted')
            );
        } else if (acceptance === 'usage_limited') {
            await this._reportPromptedFailure(claim, 'provider_usage_limit');
        } else if (acceptance === 'rejected') {
            await this._reportPromptedFailure(claim, 'provider_rejected');
        } else if (acceptance !== 'cancelled') {
            await this._reportPromptedFailure(claim, 'submission_outcome_unconfirmed');
        }
        return this._finishPromptedClaimOnOrigin(claim, runToken);
    }

    async _runPromptedBatch(runToken) {
        const maxSteps = Math.max(
            10,
            this.goalTotal * ((this.generationRun?.options?.maxRetries || 0) + 3)
        );
        const maxIterations = maxSteps + Math.max(
            1,
            Math.ceil((this.generationRun?.options?.capacityTimeoutMs || 120000) / GENERATION_CAPACITY_POLL_MS)
        );
        let steps = 0;
        let iterations = 0;
        while (this.isBatchRunActive(runToken) && steps < maxSteps && iterations < maxIterations) {
            iterations += 1;
            const waitingDescriptor = this.generationRun?.status === 'waiting_capacity'
                ? this._getCapacityDescriptor()
                : null;
            if (waitingDescriptor) await this.sleep(GENERATION_CAPACITY_POLL_MS);
            const claimResponse = await this._claimGenerationAction(waitingDescriptor ? {
                capacityAvailable: this._isPromptedCapacityAvailable(
                    waitingDescriptor,
                    this.batchPrompt
                )
            } : {});
            if (!claimResponse || claimResponse.status === 'rejected') {
                const recoverable = claimResponse?.error === 'GENERATION_RESUME_SURFACE_UNPROVEN';
                this.safeStatus(
                    recoverable
                        ? 'Prompted Batch: return to the original source, then Resume Run'
                        : `Prompted Batch: ${claimResponse?.error || 'Run authority unavailable'}`,
                    'warning'
                );
                this.updateGenerationRunControls(this.generationRun, { resume: recoverable });
                break;
            }
            if (claimResponse.status === 'waiting') {
                if (['completed', 'cancelled', 'retryable_failed', 'failed'].includes(this.generationRun?.status)) break;
                continue;
            }
            if (claimResponse.status === 'capacity_timeout') {
                const returned = await this._returnToGenerationOrigin(runToken);
                if (returned === 'navigating' || returned === 'cancelled') return;
                if (this.generationRun?.status === 'retryable_failed') break;
                continue;
            }
            if (claimResponse.status !== 'claimed' && claimResponse.status !== 'resumed') break;

            const result = await this._executePromptedClaim(claimResponse.claim, runToken);
            if (result !== 'capacity') steps += 1;
            if (result === 'navigating' || result === 'stopped' || result === 'cancelled') return;
        }

        const run = this.generationRun;
        this.batchRunning = false;
        this.batchRunToken = null;
        this.updateBatchButtons(false);
        this.updateGenerationRunControls(run);
        this.updateCounters();
        if (run?.status === 'completed' && run.counts.failed === 0) {
            this.safeStatus(`Prompted Batch: Complete (${run.counts.accepted}/${run.items.length})`, 'success');
        } else if (run?.status === 'retryable_failed' || (run?.counts?.failed || 0) > 0) {
            const retrySuffix = run.status === 'retryable_failed'
                ? ' Retry Failed is available.'
                : '';
            this.safeStatus(
                `Prompted Batch: ${run.counts.accepted} accepted, ${run.counts.failed} failed.${this._getGenerationFailureSummary(run)}${retrySuffix}`,
                'warning'
            );
        } else if (run?.status === 'cancelled' || this.batchAborted) {
            this.safeStatus(`Prompted Batch: Stopped (${run?.counts?.accepted || 0}/${run?.items?.length || 0})`, 'neutral');
        }
        await this.overlay?.refreshActiveWorkflowStatus?.();
    }

    async _startPromptedBatchDurable(prompt, options = {}) {
        if (!GrokImagineAdapter?.describeCurrentSource) {
            this.safeStatus('Prompted Batch: Grok adapter unavailable. Reload the extension.', 'error');
            return false;
        }
        const surface = this._detectGenerationSurface();
        let items = [];
        let galleryLimit = 0;
        let videoGoal = 0;
        if (surface === 'results_gallery' || surface === 'saved_gallery') {
            const mounted = GrokImagineAdapter.listGalleryItems({ root: document, surface });
            if (mounted.status !== 'ok') {
                this.safeStatus(`Prompted Batch: ${mounted.reason || 'Gallery identity is ambiguous'}`, 'warning');
                return false;
            }
            galleryLimit = Math.max(1, parseInt(options.galleryLimit, 10) || mounted.items.length);
            const listed = await this._collectGenerationGalleryItems(surface, galleryLimit);
            if (listed.status !== 'ok') {
                this.safeStatus(`Prompted Batch: ${listed.reason || 'Gallery identity is ambiguous'}`, 'warning');
                return false;
            }
            items = listed.items.filter((descriptor) => descriptor.mediaKind === 'image').slice(0, galleryLimit);
        } else if (surface === 'agent_media' || surface === 'legacy_detail') {
            const sourcePostIdHint = getCurrentGrokSourcePostIdHint();
            const described = GrokImagineAdapter.describeCurrentSource({
                root: document,
                surface,
                location: {
                    pathname: window.location.pathname,
                    search: window.location.search
                },
                ...(sourcePostIdHint ? { sourcePostIdHint } : {})
            });
            if (described.status !== 'matched') {
                this.safeStatus(`Prompted Batch: ${described.reason || 'Select one generated source'}`, 'warning');
                return false;
            }
            videoGoal = Math.max(1, parseInt(options.videoGoal, 10) || 1);
            items = Array.from({ length: videoGoal }, () => ({ ...described.descriptor }));
        } else {
            this.safeStatus('Prompted Batch: Open generated results, Saved, or one generated source', 'warning');
            return false;
        }
        if (!items.length) {
            this.safeStatus('Prompted Batch: No eligible generated images found', 'warning');
            return false;
        }

        this._clearPromptedVideoComposerRoot();
        this.batchRunning = true;
        this.goalRunning = false;
        this.batchAborted = false;
        this.batchRunToken = this.createBatchRunToken();
        this.batchMode = 'prompted';
        this.batchContext = surface;
        this.batchPrompt = prompt;
        this.goalCount = 0;
        this.goalTotal = items.length;
        this.currentRetry = 0;
        this.generationRun = null;
        if (prompt && this.historyManager?.add) this.historyManager.add(prompt, 'video');

        const retryEnabled = this.settingsManager.settings.autoRetryEnabled === true;
        const runOptions = {
            maxRetries: retryEnabled
                ? Math.max(0, Number(this.settingsManager.settings.maxRetries) || 0)
                : 0,
            action: 'prompted_video',
            acceptanceTimeoutMs: GENERATION_ACCEPTANCE_TIMEOUT_MS,
            capacityTimeoutMs: GENERATION_CAPACITY_WAIT_MS
        };
        if (galleryLimit) runOptions.galleryLimit = galleryLimit;
        if (videoGoal) runOptions.videoGoal = videoGoal;
        const started = await this._startGenerationRun(
            'prompted_batch',
            surface,
            items,
            prompt,
            runOptions
        );
        if (started?.status !== 'started') {
            this.batchRunning = false;
            this.batchRunToken = null;
            this.safeStatus(
                started?.activeWorkflow?.kind
                    ? `Prompted Batch blocked by ${getMutatingWorkflowLabel(started.activeWorkflow.kind)}.`
                    : `Prompted Batch: ${started?.error || 'Could not start'}`,
                'warning'
            );
            return false;
        }
        this.updateCounters();
        this.updateBatchButtons(true);
        this.updateGenerationRunControls(this.generationRun);
        this.safeStatus(`Prompted Batch: Starting ${items.length} source${items.length === 1 ? '' : 's'}`, 'info');
        await this._runPromptedBatch(this.batchRunToken);
        return true;
    }

    // --- Goal Mode ---
    async _reportVideoGoalFailure(claim, code, permanent = false) {
        return this._reportGenerationAction(
            claim,
            permanent ? 'permanent_failed' : 'retryable_failed',
            code
        );
    }

    async _prepareVideoGoalControl(claim, runToken) {
        let resolved = GrokImagineAdapter.resolveMediaAction({
            root: document,
            descriptor: claim.descriptor,
            action: 'goal_video'
        });
        if (resolved.status !== 'matched') return resolved;

        if (resolved.stage === 'open_goal_menu') {
            if (resolved.control.disabled
                || resolved.control.getAttribute('aria-disabled') === 'true') {
                return { status: 'capacity', reason: 'provider_capacity' };
            }
            const trigger = resolved.control;
            const opened = await this._clickPromptedBatchNativeControl(
                trigger,
                runToken,
                'open Video Goal Make Video menu',
                () => {
                    const current = GrokImagineAdapter.resolveMediaAction({
                        root: document,
                        descriptor: claim.descriptor,
                        action: 'goal_video'
                    });
                    return current.status === 'matched'
                        && current.stage === 'open_goal_menu'
                        && current.control === trigger;
                }
            );
            if (!opened) return { status: 'missing', reason: 'goal_menu_open_failed' };

            for (let attempt = 0; attempt < 20; attempt++) {
                if (!this.isBatchRunActive(runToken)) return { status: 'cancelled' };
                resolved = GrokImagineAdapter.resolveMediaAction({
                    root: document,
                    descriptor: claim.descriptor,
                    action: 'goal_video'
                });
                if (resolved.status === 'ambiguous') return resolved;
                if (resolved.status === 'matched'
                    && resolved.stage === 'select_quick_animate') {
                    break;
                }
                await this.sleep(100);
            }
        }

        if (resolved.status !== 'matched'
            || (resolved.stage !== 'submit_direct'
                && resolved.stage !== 'select_quick_animate')) {
            return {
                status: resolved.status === 'ambiguous' ? 'ambiguous' : 'missing',
                reason: resolved.reason || 'goal_action_missing'
            };
        }
        if (resolved.control.disabled
            || resolved.control.getAttribute('aria-disabled') === 'true') {
            return { status: 'capacity', reason: 'provider_capacity' };
        }
        return { status: 'ready', action: resolved };
    }

    async _completeVideoGoalClaim(claim, resultAssetId) {
        const completedResponse = await this._reportGenerationAction(
            claim,
            'completed',
            '',
            this._createGenerationReceipt(claim, 'playable_result', { resultAssetId })
        );
        if (!completedResponse || completedResponse.status === 'rejected') return 'stopped';
        if (completedResponse.run?.status === 'running') {
            const source = GrokImagineAdapter.resolveMediaAction({
                root: document,
                descriptor: claim.descriptor,
                action: 'goal_video'
            });
            const originUrl = completedResponse.run.origin?.url;
            if (source.status !== 'matched' && originUrl) {
                this.safeStatus('Video Goal: returning to the original source...', 'info');
                window.location.assign(originUrl);
                return 'navigating';
            }
        }
        return 'completed';
    }

    _captureVideoGoalDomBaseline(descriptor) {
        return GrokImagineAdapter.captureGeneratedResultBaseline({
            root: document,
            descriptor,
            mediaKind: 'video'
        });
    }

    _inspectVideoGoalDomResult(descriptor, before, checkpoint, resultPostId = '') {
        const submissionStatus = checkpoint
            ? GrokImagineAdapter.evaluateSubmissionReceipt({ root: document, receipt: checkpoint })
            : 'pending';
        if (submissionStatus === 'usage_limited') {
            return {
                status: 'failed',
                resultAssetId: '',
                failureCode: 'provider_usage_limit'
            };
        }
        if (submissionStatus === 'rejected') {
            return {
                status: 'failed',
                resultAssetId: '',
                failureCode: 'provider_result_failed'
            };
        }
        const result = GrokImagineAdapter.inspectGeneratedResult({
            root: document,
            before,
            expected: {
                sourceAssetId: descriptor.sourceAssetId,
                sourcePostId: descriptor.sourcePostId,
                resultPostId,
                mediaKind: 'video'
            }
        });
        if (result.status === 'pending' && submissionStatus === 'accepted') {
            return { ...result, status: 'inflight' };
        }
        return result;
    }

    async _waitForVideoGoalDomResult(
        descriptor,
        before,
        checkpoint,
        resultPostId,
        runToken,
        timeoutMs = GENERATION_RESULT_TIMEOUT_MS
    ) {
        const deadline = Date.now() + Math.max(1000, Number(timeoutMs) || GENERATION_RESULT_TIMEOUT_MS);
        while (this.isBatchRunActive(runToken) && Date.now() < deadline) {
            const result = this._inspectVideoGoalDomResult(
                descriptor,
                before,
                checkpoint,
                resultPostId
            );
            if (result.status !== 'pending' && result.status !== 'inflight') return result;
            await this.sleep(Math.min(GENERATION_RESULT_POLL_MS, Math.max(0, deadline - Date.now())));
        }
        return {
            status: this.isBatchRunActive(runToken) ? 'timeout' : 'cancelled',
            resultAssetId: ''
        };
    }

    async _finishVideoGoalFailureOnOrigin(claim, code, permanent, runToken) {
        await this._reportVideoGoalFailure(claim, code, permanent);
        const returned = await this._returnToGenerationOrigin(runToken);
        return returned === 'navigating' || returned === 'cancelled' ? returned : 'failed';
    }

    async _executeVideoGoalClaim(claim, runToken) {
        const persistedItem = this._getGenerationItem(claim.itemId);
        let checkpoint = this._restoreAdapterSubmissionReceipt(persistedItem?.receipt);
        let resultBaseline = this._restoreGeneratedResultBaseline(persistedItem?.receipt);
        let domResultBaseline = this._restoreDomGeneratedResultBaseline(persistedItem?.receipt);
        let resultPostId = String(persistedItem?.receipt?.resultPostId || '');
        const composerReadyAlready = persistedItem?.status === 'composer_ready';
        const dispatchedAlready = persistedItem?.status === 'submitted';
        const acceptedAlready = dispatchedAlready && persistedItem?.lastOutcome === 'accepted';
        let resumedPriorDispatch = false;
        const resultBaselineAvailable = () => !!resultBaseline || !!domResultBaseline;
        const receiptExtra = () => {
            const currentPostId = this._getImaginePostId(window.location.href);
            if (currentPostId
                && currentPostId !== claim.descriptor.sourcePostId
                && currentPostId !== claim.descriptor.sourceAssetId) {
                resultPostId = currentPostId;
            }
            return {
                ...this._createDomResultBaselineReceiptFields(domResultBaseline),
                ...(resultPostId ? { resultPostId } : {})
            };
        };

        if (persistedItem?.lastOutcome === 'retry_reconcile'
            && checkpoint
            && resultBaselineAvailable()) {
            let inspection = { status: 'pending', resultAssetId: '' };
            try {
                inspection = resultBaseline
                    ? await this._inspectVideoGoalInventoryResult(
                        claim.descriptor,
                        resultBaseline,
                        runToken,
                        15000
                    )
                    : this._inspectVideoGoalDomResult(
                        claim.descriptor,
                        domResultBaseline,
                        checkpoint,
                        resultPostId
                    );
            } catch {
                inspection = { status: 'pending', resultAssetId: '' };
            }
            if (inspection.failureCode === 'provider_usage_limit') {
                return this._finishVideoGoalFailureOnOrigin(
                    claim,
                    'provider_usage_limit',
                    false,
                    runToken
                );
            }
            if (inspection.status === 'ambiguous') {
                await this._reportVideoGoalFailure(claim, 'result_ambiguous', true);
                return 'ambiguous';
            }
            if (inspection.status === 'ready' || inspection.status === 'inflight') {
                const submittedResponse = await this._reportGenerationAction(
                    claim,
                    'submitted',
                    '',
                    this._createVideoGoalReceipt(
                        claim,
                        'submit_dispatched',
                        checkpoint,
                        resultBaseline,
                        receiptExtra()
                    )
                );
                if (!submittedResponse || submittedResponse.status === 'rejected') return 'stopped';
                const acceptedResponse = await this._reportGenerationAction(
                    claim,
                    'accepted',
                    '',
                    this._createVideoGoalReceipt(
                        claim,
                        'submit_dispatched',
                        checkpoint,
                        resultBaseline,
                        receiptExtra()
                    )
                );
                if (!acceptedResponse || acceptedResponse.status === 'rejected') return 'stopped';
                if (inspection.status === 'ready') {
                    return this._completeVideoGoalClaim(claim, inspection.resultAssetId);
                }
                resumedPriorDispatch = true;
            } else {
                checkpoint = null;
                resultBaseline = null;
                domResultBaseline = null;
            }
        }

        if (dispatchedAlready || resumedPriorDispatch) {
            if (!checkpoint || !resultBaselineAvailable()) {
                await this._reportVideoGoalFailure(claim, 'goal_checkpoint_missing', true);
                return 'failed';
            }
            if (!acceptedAlready && !resumedPriorDispatch) {
                const acceptance = await this._waitForPromptedProviderAcceptance(
                    claim.descriptor,
                    resultBaseline,
                    checkpoint,
                    runToken,
                    claim.options.acceptanceTimeoutMs || GENERATION_ACCEPTANCE_TIMEOUT_MS
                );
                if (acceptance === 'usage_limited') {
                    return this._finishVideoGoalFailureOnOrigin(
                        claim,
                        'provider_usage_limit',
                        false,
                        runToken
                    );
                }
                if (acceptance === 'rejected') {
                    return this._finishVideoGoalFailureOnOrigin(
                        claim,
                        'provider_rejected',
                        false,
                        runToken
                    );
                }
                if (acceptance === 'cancelled') return 'cancelled';
                if (acceptance !== 'accepted') {
                    return this._finishVideoGoalFailureOnOrigin(
                        claim,
                        'submission_outcome_unconfirmed',
                        false,
                        runToken
                    );
                }
                const acceptedResponse = await this._reportGenerationAction(
                    claim,
                    'accepted',
                    '',
                    this._createVideoGoalReceipt(
                        claim,
                        'submit_dispatched',
                        checkpoint,
                        resultBaseline,
                        receiptExtra()
                    )
                );
                if (!acceptedResponse || acceptedResponse.status === 'rejected') return 'stopped';
            }
        } else {
            if (!composerReadyAlready) {
                try {
                    resultBaseline = await this._captureVideoGoalInventoryBaseline(claim.descriptor);
                } catch {
                    resultBaseline = null;
                }
                domResultBaseline = this._captureVideoGoalDomBaseline(claim.descriptor);
            }
            if (!resultBaselineAvailable()) {
                await this._reportVideoGoalFailure(claim, 'goal_checkpoint_missing', true);
                return 'failed';
            }

            const prepared = await this._prepareVideoGoalControl(claim, runToken);
            if (prepared.status === 'cancelled') return 'cancelled';
            if (prepared.status === 'capacity') {
                await this._reportGenerationAction(claim, 'capacity', 'provider_capacity');
                return 'capacity';
            }
            if (prepared.status !== 'ready') {
                await this._reportVideoGoalFailure(
                    claim,
                    prepared.reason || 'goal_action_missing',
                    prepared.status === 'ambiguous'
                );
                return prepared.status;
            }
            if (!composerReadyAlready) {
                checkpoint = GrokImagineAdapter.captureSubmissionReceipt({
                    root: document,
                    descriptor: claim.descriptor,
                    action: 'goal_video'
                });
            }
            if (!checkpoint) {
                await this._reportVideoGoalFailure(claim, 'goal_checkpoint_missing', true);
                return 'failed';
            }

            if (!composerReadyAlready) {
                const readyCheckpoint = await this._reportGenerationAction(
                    claim,
                    'composer_ready',
                    '',
                    this._createVideoGoalReceipt(
                        claim,
                        'composer_ready',
                        checkpoint,
                        resultBaseline,
                        receiptExtra()
                    )
                );
                if (readyCheckpoint?.status === 'rejected') return 'stopped';
            }

            const dispatchPrepared = await this._prepareVideoGoalControl(claim, runToken);
            if (dispatchPrepared.status === 'cancelled') return 'cancelled';
            if (dispatchPrepared.status === 'capacity') {
                await this._reportGenerationAction(claim, 'capacity', 'provider_capacity');
                return 'capacity';
            }
            if (dispatchPrepared.status !== 'ready') {
                await this._reportVideoGoalFailure(
                    claim,
                    dispatchPrepared.reason || 'goal_action_missing',
                    dispatchPrepared.status === 'ambiguous'
                );
                return dispatchPrepared.status;
            }
            const resolved = dispatchPrepared.action;

            const clicked = await this._clickPromptedBatchNativeControl(
                resolved.control,
                runToken,
                resolved.stage === 'select_quick_animate'
                    ? 'click Video Goal Quick Animate'
                    : 'click Video Goal Make Video',
                () => {
                    const current = GrokImagineAdapter.resolveMediaAction({
                        root: document,
                        descriptor: claim.descriptor,
                        action: 'goal_video'
                    });
                    return current.status === 'matched'
                        && current.stage === resolved.stage
                        && current.control === resolved.control;
                },
                this._createVideoGoalDispatch(
                    claim,
                    checkpoint,
                    resultBaseline,
                    receiptExtra()
                )
            );
            if (!clicked) {
                await this._reportVideoGoalFailure(claim, 'native_click_failed');
                return 'failed';
            }

            const acceptance = await this._waitForPromptedProviderAcceptance(
                claim.descriptor,
                resultBaseline,
                checkpoint,
                runToken,
                claim.options.acceptanceTimeoutMs || GENERATION_ACCEPTANCE_TIMEOUT_MS
            );
            if (acceptance === 'usage_limited') {
                return this._finishVideoGoalFailureOnOrigin(
                    claim,
                    'provider_usage_limit',
                    false,
                    runToken
                );
            }
            if (acceptance === 'rejected') {
                return this._finishVideoGoalFailureOnOrigin(
                    claim,
                    'provider_rejected',
                    false,
                    runToken
                );
            }
            if (acceptance === 'cancelled') return 'cancelled';
            if (acceptance !== 'accepted') {
                return this._finishVideoGoalFailureOnOrigin(
                    claim,
                    'submission_outcome_unconfirmed',
                    false,
                    runToken
                );
            }

            const acceptedResponse = await this._reportGenerationAction(
                claim,
                'accepted',
                '',
                this._createVideoGoalReceipt(
                    claim,
                    'submit_dispatched',
                    checkpoint,
                    resultBaseline,
                    receiptExtra()
                )
            );
            if (!acceptedResponse || acceptedResponse.status === 'rejected') return 'stopped';
        }

        if (!checkpoint || !resultBaselineAvailable()) {
            await this._reportVideoGoalFailure(claim, 'goal_result_baseline_missing', true);
            return 'failed';
        }
        this.safeStatus(
            `Video Goal: waiting for playable result ${this.goalCount + 1}/${this.goalTotal}`,
            'info'
        );
        const result = resultBaseline
            ? await this._waitForVideoGoalInventoryResult(
                claim.descriptor,
                resultBaseline,
                runToken,
                claim.options.resultTimeoutMs || GENERATION_RESULT_TIMEOUT_MS
            )
            : await this._waitForVideoGoalDomResult(
                claim.descriptor,
                domResultBaseline,
                checkpoint,
                resultPostId,
                runToken,
                claim.options.resultTimeoutMs || GENERATION_RESULT_TIMEOUT_MS
            );
        if (result.status === 'ready') {
            return this._completeVideoGoalClaim(claim, result.resultAssetId);
        }
        if (result.status !== 'cancelled') {
            return this._finishVideoGoalFailureOnOrigin(
                claim,
                result.failureCode
                    || (result.status === 'failed'
                        ? 'provider_result_failed'
                        : `result_${result.status}`),
                result.status === 'ambiguous',
                runToken
            );
        }
        return result.status;
    }

    async _runVideoGoal(runToken) {
        const retryBudget = Number(this.generationRun?.options?.maxRetries) || 0;
        const maxSteps = Math.max(1, this.goalTotal * (retryBudget + 1));
        const maxIterations = maxSteps + Math.max(
            1,
            Math.ceil((this.generationRun?.options?.capacityTimeoutMs || 120000) / GENERATION_CAPACITY_POLL_MS)
        );
        let steps = 0;
        let iterations = 0;
        while (this.isBatchRunActive(runToken) && steps < maxSteps && iterations < maxIterations) {
            iterations += 1;
            const waitingDescriptor = this.generationRun?.status === 'waiting_capacity'
                ? this._getCapacityDescriptor()
                : null;
            if (waitingDescriptor) await this.sleep(GENERATION_CAPACITY_POLL_MS);
            const claimResponse = await this._claimGenerationAction(waitingDescriptor ? {
                capacityAvailable: this._isGenerationActionAvailable(waitingDescriptor, 'goal_video')
            } : {});
            if (!claimResponse || claimResponse.status === 'rejected') {
                const recoverable = claimResponse?.error === 'GENERATION_RESUME_SURFACE_UNPROVEN';
                this.safeStatus(
                    recoverable
                        ? 'Video Goal: reselect the original source, then Resume Run'
                        : `Video Goal: ${claimResponse?.error || 'Run authority unavailable'}`,
                    'warning'
                );
                this.updateGenerationRunControls(this.generationRun, { resume: recoverable });
                break;
            }
            if (claimResponse.status === 'waiting') {
                if (['completed', 'cancelled', 'retryable_failed', 'failed'].includes(this.generationRun?.status)) break;
                continue;
            }
            if (claimResponse.status !== 'claimed' && claimResponse.status !== 'resumed') break;

            const outcome = await this._executeVideoGoalClaim(claimResponse.claim, runToken);
            if (outcome !== 'capacity') steps += 1;
            if (outcome === 'stopped' || outcome === 'cancelled' || outcome === 'navigating') break;
        }

        const run = this.generationRun;
        this.goalRunning = false;
        this.batchRunToken = null;
        this.updateCounters();
        this.updateGenerationRunControls(run);
        if (run?.status === 'completed') {
            this.safeStatus(`Video Goal: Complete (${run.goalProgress}/${run.options.goalCount})`, 'success');
        } else if (run?.status === 'retryable_failed') {
            this.safeStatus(
                `Video Goal: ${run.goalProgress}/${run.options.goalCount} complete.${this._getGenerationFailureSummary(run)} Retry Failed is available.`,
                'warning'
            );
        } else if (run?.status === 'failed') {
            this.safeStatus(
                `Video Goal: stopped safely (${run.items?.[0]?.failureCode || 'result could not be verified'})`,
                'error'
            );
        } else if (run?.status === 'cancelled' || this.batchAborted) {
            this.safeStatus(`Video Goal: Stopped (${run?.goalProgress || 0}/${run?.options?.goalCount || 0})`, 'neutral');
        }
        await this.overlay?.refreshActiveWorkflowStatus?.();
    }

    async _startVideoGoalDurable(count) {
        if (!GrokImagineAdapter?.describeCurrentSource
            || !GrokImagineAdapter?.resolveMediaAction) {
            this.safeStatus('Video Goal: Grok adapter unavailable. Reload the extension.', 'error');
            return false;
        }
        const surface = this._detectGenerationSurface();
        if (surface !== 'agent_media' && surface !== 'legacy_detail') {
            this.safeStatus('Video Goal: select one generated source in Agent or detail view', 'warning');
            return false;
        }
        const sourcePostIdHint = getCurrentGrokSourcePostIdHint();
        const described = GrokImagineAdapter.describeCurrentSource({
            root: document,
            surface,
            location: {
                pathname: window.location.pathname,
                search: window.location.search
            },
            ...(sourcePostIdHint ? { sourcePostIdHint } : {})
        });
        if (described.status !== 'matched') {
            this.safeStatus(`Video Goal: ${described.reason || 'Select one generated source'}`, 'warning');
            return false;
        }
        if (!described.descriptor.conversationId) {
            this.safeStatus(
                'Video Goal: this source has no conversation identity. Reopen it from results or Saved.',
                'warning'
            );
            return false;
        }
        const action = GrokImagineAdapter.resolveMediaAction({
            root: document,
            descriptor: described.descriptor,
            action: 'goal_video'
        });
        if (action.status !== 'matched') {
            this.safeStatus(`Video Goal: ${action.reason || 'Make Video is unavailable for this source'}`, 'warning');
            return false;
        }

        const goalCount = Math.max(1, parseInt(count, 10) || 1);
        const retryEnabled = this.settingsManager.settings.autoRetryEnabled === true;
        this.goalRunning = true;
        this.batchRunning = false;
        this.batchAborted = false;
        this.batchRunToken = this.createBatchRunToken();
        this.batchMode = null;
        this.batchContext = surface;
        this.goalTotal = goalCount;
        this.goalCount = 0;
        this.currentRetry = 0;
        this.generationRun = null;

        const started = await this._startGenerationRun(
            'video_goal',
            surface,
            [described.descriptor],
            '',
            {
                maxRetries: retryEnabled
                    ? Math.max(0, Number(this.settingsManager.settings.maxRetries) || 0)
                    : 0,
                goalCount,
                action: 'goal_video',
                mediaKind: 'video',
                acceptanceTimeoutMs: GENERATION_ACCEPTANCE_TIMEOUT_MS,
                resultTimeoutMs: GENERATION_RESULT_TIMEOUT_MS,
                claimTimeoutMs: VIDEO_GOAL_HARD_RESULT_WAIT_MS + 60000,
                capacityTimeoutMs: GENERATION_CAPACITY_WAIT_MS
            }
        );
        if (started?.status !== 'started') {
            this.goalRunning = false;
            this.batchRunToken = null;
            this.safeStatus(
                started?.activeWorkflow?.kind
                    ? `Video Goal blocked by ${getMutatingWorkflowLabel(started.activeWorkflow.kind)}.`
                    : `Video Goal: ${started?.error || 'Could not start'}`,
                'warning'
            );
            return false;
        }
        this.updateCounters();
        this.updateGenerationRunControls(this.generationRun);
        this.safeStatus(`Video Goal: Starting ${goalCount} playable video${goalCount === 1 ? '' : 's'}`, 'info');
        await this._runVideoGoal(this.batchRunToken);
        return true;
    }

    async startGoal(count) {
        if (this.batchRunning || this.goalRunning || this.batchStartPending) {
            this.safeStatus('A generation run is already active', 'warning');
            return false;
        }
        this.batchStartPending = true;
        try {
            return await this._startVideoGoalDurable(count);
        } finally {
            this.batchStartPending = false;
        }
    }

    // --- Batch Mode (Quick + Prompted) ---
    async startBatch(mode = 'quick', prompt = null, options = {}) {
        if (this.batchRunning || this.goalRunning || this.batchStartPending) {
            this.safeStatus('A generation run is already active', 'warning');
            return false;
        }

        this.batchStartPending = true;
        try {
            return await this._startBatch(mode, prompt, options);
        } finally {
            this.batchStartPending = false;
        }
    }

    async _startBatch(mode = 'quick', prompt = null, options = {}) {
        const normalizedMode = mode === 'prompted' ? 'prompted' : 'quick';

        if (normalizedMode === 'prompted') {
            return this._startPromptedBatchDurable(prompt, options);
        }

        if (!GrokImagineAdapter) {
            this.safeStatus('Quick Batch: Grok adapter unavailable. Reload the extension.', 'error');
            return false;
        }
        const surface = GrokImagineAdapter.detectGrokSurface({
            root: document,
            location: {
                pathname: window.location.pathname,
                search: window.location.search
            }
        });
        if (surface !== 'results_gallery' && surface !== 'saved_gallery') {
            this.safeStatus('Quick Batch: Open generated results or Saved first', 'warning');
            return false;
        }
        const mounted = GrokImagineAdapter.listGalleryItems({ root: document, surface });
        if (mounted.status !== 'ok') {
            this.safeStatus(`Quick Batch: ${mounted.reason || 'Gallery identity is ambiguous'}`, 'error');
            return false;
        }
        const galleryLimit = Math.max(
            1,
            parseInt(options.galleryLimit, 10)
                || this.settingsManager.get('galleryBatchLimit')
                || mounted.items.length
        );
        const listed = await this._collectGenerationGalleryItems(surface, galleryLimit);
        if (listed.status !== 'ok') {
            this.safeStatus(`Quick Batch: ${listed.reason || 'Gallery identity is ambiguous'}`, 'error');
            return false;
        }
        const items = listed.items.filter((descriptor) => descriptor.mediaKind === 'image')
            .slice(0, galleryLimit);
        if (items.length === 0) {
            this.safeStatus('Quick Batch: No eligible image cards found', 'warning');
            return false;
        }

        this.batchRunning = true;
        this.goalRunning = false;
        this.batchAborted = false;
        this.batchIndex = 0;
        this.batchMode = 'quick';
        this.batchContext = surface === 'saved_gallery' ? 'gallery' : 'results_gallery';
        this.batchPrompt = null;
        this.batchRunToken = this.createBatchRunToken();
        this.scrollAttempts = 0;
        this.goalCount = 0;
        this.goalTotal = items.length;
        this.currentRetry = 0;
        this.generationRun = null;

        const retryEnabled = this.settingsManager.settings.autoRetryEnabled === true;
        const started = await this._startGenerationRun('quick_batch', surface, items, '', {
            maxRetries: retryEnabled
                ? Math.max(0, Number(this.settingsManager.settings.maxRetries) || 0)
                : 0,
            galleryLimit,
            action: 'quick_video',
            acceptanceTimeoutMs: GENERATION_ACCEPTANCE_TIMEOUT_MS
        });
        if (started?.status !== 'started') {
            this.batchRunning = false;
            this.batchRunToken = null;
            const active = started?.activeWorkflow?.kind;
            this.safeStatus(
                active
                    ? `Quick Batch blocked by ${getMutatingWorkflowLabel(active)}.`
                    : `Quick Batch: ${started?.error || 'Could not start'}`,
                'warning'
            );
            return false;
        }

        this.safeStatus(`Quick Batch: Starting ${items.length} sources`, 'info');
        this.updateCounters();
        this.updateBatchButtons(true);
        await this._runQuickBatch(this.batchRunToken);
        return true;
    }

    async startPromptedBatchFromGallery(prompt, galleryLimit, runToken = this.createBatchRunToken()) {
        this._clearPromptedVideoComposerRoot();
        this.batchRunning = true;
        this.goalRunning = false;
        this.batchAborted = false;
        this.batchRunToken = runToken;
        this.batchIndex = 0;
        this.batchMode = 'prompted';
        this.batchContext = 'gallery';
        this.batchPrompt = prompt;
        this.batchGalleryUrl = window.location.href;
        this.batchProcessedSrcs = new Set();
        this.scrollAttempts = 0;
        this.goalCount = 0;
        this.goalTotal = Math.max(1, galleryLimit);
        this.currentRetry = 0;
        this.batchFailureMessage = null;

        this.batchQueue = this.buildBatchQueue();
        if (this.batchQueue.length === 0) {
            this.safeStatus('Prompted Batch [gallery]: No images found', 'warning');
            this.batchRunning = false;
            this.updateCounters();
            return;
        }

        console.log(`Prompted Batch [gallery]: Starting with ${this.batchQueue.length} images (limit ${this.goalTotal}).`);
        this.safeStatus(`Prompted Batch [gallery]: Starting 0/${this.goalTotal}`, 'info');
        this.updateCounters();
        this.updateBatchButtons(true);

        while (this.isBatchRunActive(runToken) && this.goalCount < this.goalTotal) {
            if (this.batchIndex >= this.batchQueue.length) {
                const foundMore = await this.scrollForMore(runToken);
                if (!this.isBatchRunActive(runToken)) break;
                if (!foundMore) break;
            }

            const item = this.batchQueue[this.batchIndex];
            if (!item || !item.button || !item.button.isConnected) {
                this.batchIndex++;
                continue;
            }

            if (item.container.querySelector(this.PROGRESS_SELECTOR)) {
                this.batchIndex++;
                continue;
            }

            // Skip already-processed or censored images
            const itemSourceId = this._getCardSourceId(item.container);
            if (itemSourceId && this.batchProcessedSrcs?.has(itemSourceId)) {
                this.batchIndex++;
                continue;
            }
            if (this.isCensoredCard(item.container)) {
                console.log(`Prompted Batch [gallery]: Item ${this.batchIndex + 1} is censored, skipping.`);
                if (itemSourceId) this.batchProcessedSrcs?.add(itemSourceId);
                this.batchIndex++;
                continue;
            }

            if (!this.isBatchRunActive(runToken)) break;
            this.safeStatus(`Prompted Batch [gallery]: ${this.goalCount + 1}/${this.goalTotal}`, 'info');
            await this.processBatchItemPrompted(item, runToken);
        }

        if (this.batchRunToken !== runToken) return;
        const hitLimit = this.goalCount >= this.goalTotal;
        const wasAborted = this.batchAborted;
        this._clearPromptedVideoComposerRoot();
        this.batchRunning = false;
        this.batchAborted = false;
        this.batchRunToken = null;
        this.updateBatchButtons(false);
        this.updateCounters();
        if (hitLimit) {
            this.safeStatus(`Prompted Batch [gallery]: Complete (${this.goalCount}/${this.goalTotal})`, 'success');
        } else if (wasAborted) {
            this.safeStatus(`Prompted Batch [gallery]: Stopped (${this.goalCount}/${this.goalTotal})`, 'neutral');
        } else if (this.batchFailureMessage) {
            this.safeStatus(this.batchFailureMessage, 'warning');
        } else {
            this.safeStatus(`Prompted Batch [gallery]: Queue exhausted (${this.goalCount}/${this.goalTotal})`, 'neutral');
        }
    }

    _getResultsGalleryContext() {
        const entries = this._getResultsGalleryEntries();
        if (!entries.length) return null;
        const list = getSavedGalleryList(entries.map((entry) => ({ card: entry.container })))
            || document.body;
        return {
            entries: list === document.body
                ? entries
                : entries.filter((entry) => list.contains(entry.container)),
            list,
            scroller: getSavedGalleryScroller(list)
        };
    }

    _evaluatePromptedResultsReceipt(identities, receipt) {
        return evaluateGalleryReceipt({
            identities,
            receipt,
            currentOrigin: {
                pathname: window.location.pathname,
                conversationId: new URLSearchParams(window.location.search).get('conversation') || '',
                scope: 'results'
            },
            allowSourceReplacement: true
        });
    }

    _hasOrderedResultsNeighborhood(entries, receipt) {
        const capturedIdentities = new Set([
            receipt?.sourceIdentity,
            ...(receipt?.beforeIdentities || []),
            ...(receipt?.afterIdentities || []),
            ...(receipt?.visibleIdentities || [])
        ].filter(Boolean));
        const identities = entries
            .filter((entry) => {
                if (capturedIdentities.has(entry.sourceId)) return true;
                const actions = Array.from(entry.container?.querySelectorAll?.(this.BUTTON_SELECTOR) || [])
                    .filter((button) => findMediaCardRoot(button) === entry.container);
                return actions.length === 1;
            })
            .map((entry) => entry.sourceId);
        return this._evaluatePromptedResultsReceipt(identities, receipt).status === 'matched';
    }

    _captureResultsGalleryReceipt(item) {
        const context = this._getResultsGalleryContext();
        const sourceId = this._getResultsCardSourceId(item?.container);
        if (!context || !sourceId || sourceId !== item?.sourceId) return null;
        const qualifiedItems = this._getQualifiedResultsGalleryItems();
        const qualifiedSourceIndices = qualifiedItems
            .map((entry, index) => entry.sourceId === sourceId ? index : -1)
            .filter((index) => index >= 0);
        if (qualifiedSourceIndices.length !== 1) return null;
        const receipt = captureGalleryReceipt({
            identities: qualifiedItems.map((entry) => entry.sourceId),
            sourceIdentity: sourceId,
            origin: {
                pathname: window.location.pathname,
                conversationId: new URLSearchParams(window.location.search).get('conversation') || '',
                scope: 'results'
            },
            scrollTop: getSavedScrollerSnapshot(context.scroller).scrollTop
        });
        return this._hasOrderedResultsNeighborhood(context.entries, receipt) ? receipt : null;
    }

    async _waitForPromptedBatchResultsSurface(receipt, runToken, timeoutMs = 10000) {
        const pollInterval = 200;
        const attempts = Math.max(1, Math.ceil(timeoutMs / pollInterval));
        for (let attempt = 0; attempt < attempts; attempt++) {
            if (!this.isBatchRunActive(runToken)) return false;
            if (this._isResultsGallerySurface()) {
                const context = this._getResultsGalleryContext();
                if (context && this._hasOrderedResultsNeighborhood(context.entries, receipt)) {
                    setSavedGalleryScrollTop(context.scroller, receipt.scrollTop);
                    const verified = this._getResultsGalleryContext();
                    if (verified
                        && verified.scroller === context.scroller
                        && this._hasOrderedResultsNeighborhood(verified.entries, receipt)) {
                        return true;
                    }
                }
            }
            await this.sleep(pollInterval);
        }
        return false;
    }

    _restorePromptedBatchResultsState(receipt, runToken) {
        if (!this.isBatchRunActive(runToken)) return false;
        const queue = this._getQualifiedResultsGalleryItems()
            .filter((item) => !item.container.querySelector(this.PROGRESS_SELECTOR)
                && !this.isCensoredCard(item.container)
                && !this.batchProcessedSrcs?.has(item.sourceId));
        const queueById = new Map(queue.map((item) => [item.sourceId, item]));
        const nextQueueIdentity = receipt.afterIdentities
            .find((sourceId) => queueById.has(sourceId));
        const nextQueueIndex = nextQueueIdentity
            ? queue.findIndex((item) => item.sourceId === nextQueueIdentity)
            : -1;
        this.batchQueue = nextQueueIndex >= 0 ? queue.slice(nextQueueIndex) : [];
        this.batchIndex = 0;
        this.targetContext = null;
        this._clearPromptedVideoComposerRoot();
        return true;
    }

    async _returnToPromptedBatchResults(receipt, runToken) {
        if (!this.isBatchRunActive(runToken)) return 'cancelled';
        const backControl = this._findPromptedBatchBackControl();
        if (!backControl) return 'failed';
        const clicked = await this._clickPromptedBatchNativeControl(
            backControl,
            runToken,
            'return to prompted batch results',
            () => this._findPromptedBatchBackControl() === backControl
        );
        if (!clicked) return this.isBatchRunActive(runToken) ? 'failed' : 'cancelled';
        const returned = await this._waitForPromptedBatchResultsSurface(receipt, runToken);
        if (!this.isBatchRunActive(runToken)) return 'cancelled';
        if (returned) {
            return this._restorePromptedBatchResultsState(receipt, runToken)
                ? 'returned'
                : 'failed';
        }
        return this.isBatchRunActive(runToken) ? 'failed' : 'cancelled';
    }

    async _stopPromptedResultsItem(message, receipt, runToken) {
        if (!this.isBatchRunActive(runToken)) return false;
        this.batchFailureMessage = message;
        this.safeStatus(message, 'warning');
        this._clearPromptedVideoComposerRoot();
        if (!this._isResultsGallerySurface() && receipt) {
            const returnStatus = await this._returnToPromptedBatchResults(receipt, runToken);
            if (returnStatus === 'cancelled') return false;
            if (returnStatus === 'failed') {
                const originalFailure = /[.!?]$/.test(message) ? message : `${message}.`;
                const recoveryFailure = `${originalFailure} Also could not return to the original results. `
                    + 'Use Back to recover the gallery.';
                this.batchFailureMessage = recoveryFailure;
                this.safeStatus(recoveryFailure, 'warning');
            }
        }
        if (!this.isBatchRunActive(runToken)) return false;
        this.batchRunning = false;
        this.batchRunToken = null;
        this.targetContext = null;
        this.updateCounters();
        this.updateBatchButtons(false);
        return false;
    }

    _getResultsGalleryOpenTarget(item) {
        const links = Array.from(item.container.querySelectorAll('a[href*="/imagine/post/"]'))
            .filter((link) => findMediaCardRoot(link) === item.container);
        if (!links.length) return item.image;
        const hrefs = new Set(links.map((link) => link.href));
        if (hrefs.size !== 1) return null;
        return links.find((link) => link.contains(item.image)) || links[0];
    }

    async _processPromptedResultsItem(item, runToken) {
        if (!this.isBatchRunActive(runToken)) return false;
        const receipt = this._captureResultsGalleryReceipt(item);
        const openTarget = this._getResultsGalleryOpenTarget(item);
        if (!receipt || !openTarget || this.detectBatchContext() !== 'results_gallery') {
            return this._stopPromptedResultsItem(
                'Prompted Batch [results]: Result card changed before it could be opened',
                receipt,
                runToken
            );
        }

        openTarget.scrollIntoView({ behavior: 'instant', block: 'center' });
        if (!this.isBatchRunActive(runToken)) return false;
        const opened = await this._clickPromptedBatchNativeControl(
            openTarget,
            runToken,
            'open prompted batch result',
            () => this.detectBatchContext() === 'results_gallery'
                && this._getResultsGalleryOpenTarget(item) === openTarget
        );
        if (!opened) {
            return this._stopPromptedResultsItem(
                'Prompted Batch [results]: Could not open result card',
                receipt,
                runToken
            );
        }

        const editorReady = await this.waitForPromptedBatchEditorReady(receipt.sourceIdentity, runToken);
        if (!this.isBatchRunActive(runToken)) return false;
        if (editorReady.status !== 'ready') {
            return this._stopPromptedResultsItem(
                'Prompted Batch [results]: Selected result did not open a supported video editor',
                receipt,
                runToken
            );
        }

        const modeReady = await this.selectMakeVideoMode(
            runToken,
            editorReady.makeVideoTrigger,
            editorReady.agentBinding || null
        );
        if (!this.isBatchRunActive(runToken)) return false;
        if (!modeReady) {
            return this._stopPromptedResultsItem(
                'Prompted Batch [results]: Could not open Make Video > Add Prompt',
                receipt,
                runToken
            );
        }

        if (!this.injectPromptedVideoText(this.batchPrompt)) {
            return this._stopPromptedResultsItem(
                'Prompted Batch [results]: Video prompt field not found',
                receipt,
                runToken
            );
        }
        const submitReady = await this._waitForPromptedResultsSubmitButton(
            runToken,
            editorReady.agentBinding || null
        );
        if (!this.isBatchRunActive(runToken)) return false;
        if (!submitReady) {
            return this._stopPromptedResultsItem(
                'Prompted Batch [results]: Grok video capacity did not become available',
                receipt,
                runToken
            );
        }

        const submissionReceipt = this._capturePromptedVideoSubmissionReceipt();
        if (!submissionReceipt) {
            return this._stopPromptedResultsItem(
                'Prompted Batch [results]: Video submit state could not be verified',
                receipt,
                runToken
            );
        }
        if (!await this.clickPromptedVideoSubmitButton(runToken, editorReady.agentBinding || null)) {
            return this._stopPromptedResultsItem(
                'Prompted Batch [results]: Video submit button not ready',
                receipt,
                runToken
            );
        }
        this.lastClickTime = Date.now();

        await this._waitForPromptedVideoSubmissionAccepted(
            submissionReceipt,
            runToken
        );
        if (!this.isBatchRunActive(runToken)) return false;

        const returnStatus = await this._returnToPromptedBatchResults(receipt, runToken);
        if (returnStatus !== 'returned' || !this.isBatchRunActive(runToken)) {
            if (returnStatus === 'failed') {
                return this._stopPromptedResultsItem(
                    'Prompted Batch [results]: Could not return to the original results',
                    null,
                    runToken
                );
            }
            return false;
        }
        this.batchProcessedSrcs?.add(receipt.sourceIdentity);
        this._restorePromptedBatchResultsState(receipt, runToken);

        this.goalCount++;
        this.currentRetry = 0;
        this.updateCounters();
        return true;
    }

    async startPromptedBatchFromResultsGallery(prompt, galleryLimit, runToken = this.createBatchRunToken()) {
        this._clearPromptedVideoComposerRoot();
        this.batchRunning = true;
        this.goalRunning = false;
        this.batchAborted = false;
        this.batchRunToken = runToken;
        this.batchIndex = 0;
        this.batchMode = 'prompted';
        this.batchContext = 'results_gallery';
        this.batchPrompt = prompt;
        this.batchProcessedSrcs = new Set();
        this.scrollAttempts = 0;
        this.goalCount = 0;
        this.goalTotal = Math.max(1, galleryLimit);
        this.currentRetry = 0;
        this.batchFailureMessage = null;
        this.batchQueue = this._getQualifiedResultsGalleryItems();

        if (!this.batchQueue.length) {
            this.batchRunning = false;
            this.batchRunToken = null;
            this.safeStatus('Prompted Batch [results]: No generated images found', 'warning');
            this.updateCounters();
            return;
        }

        this.safeStatus(`Prompted Batch [results]: Starting 0/${this.goalTotal}`, 'info');
        this.updateCounters();
        this.updateBatchButtons(true);

        while (this.isBatchRunActive(runToken) && this.goalCount < this.goalTotal) {
            if (this.batchIndex >= this.batchQueue.length) {
                const foundMore = await this.scrollForMore(runToken);
                if (!this.isBatchRunActive(runToken) || !foundMore) break;
            }
            const item = this.batchQueue[this.batchIndex];
            if (!item?.button?.isConnected || !item.container?.isConnected) {
                this.batchIndex++;
                continue;
            }
            if (item.container.querySelector(this.PROGRESS_SELECTOR)
                || this.batchProcessedSrcs.has(item.sourceId)
                || this.isCensoredCard(item.container)) {
                this.batchIndex++;
                continue;
            }
            this.safeStatus(`Prompted Batch [results]: ${this.goalCount + 1}/${this.goalTotal}`, 'info');
            await this._processPromptedResultsItem(item, runToken);
        }

        if (this.batchRunToken !== runToken) return;
        const hitLimit = this.goalCount >= this.goalTotal;
        const wasAborted = this.batchAborted;
        this._clearPromptedVideoComposerRoot();
        this.batchRunning = false;
        this.batchAborted = false;
        this.batchRunToken = null;
        this.updateBatchButtons(false);
        this.updateCounters();
        if (hitLimit) {
            this.safeStatus(`Prompted Batch [results]: Complete (${this.goalCount}/${this.goalTotal})`, 'success');
        } else if (wasAborted) {
            this.safeStatus(`Prompted Batch [results]: Stopped (${this.goalCount}/${this.goalTotal})`, 'neutral');
        } else if (this.batchFailureMessage) {
            this.safeStatus(this.batchFailureMessage, 'warning');
        } else {
            this.safeStatus(`Prompted Batch [results]: Queue exhausted (${this.goalCount}/${this.goalTotal})`, 'neutral');
        }
    }

    async startPromptedBatchFromDetail(prompt, videoGoal, runToken = this.createBatchRunToken()) {
        this._clearPromptedVideoComposerRoot();
        this.batchRunning = true;
        this.goalRunning = false;
        this.batchAborted = false;
        this.batchRunToken = runToken;
        this.batchIndex = 0;
        this.batchMode = 'prompted';
        this.batchContext = 'detail';
        this.batchPrompt = prompt;
        this.scrollAttempts = 0;
        this.goalCount = 0;
        this.goalTotal = Math.max(1, videoGoal);
        this.currentRetry = 0;
        this.targetContext = this.findTargetContext();
        this.batchFailureMessage = null;

        if (prompt && this.historyManager && typeof this.historyManager.add === 'function') {
            this.historyManager.add(prompt, 'video');
        }

        this.safeStatus(`Prompted Batch [detail]: Starting 0/${this.goalTotal}`, 'info');
        this.updateCounters();
        this.updateBatchButtons(true);

        while (this.isBatchRunActive(runToken) && this.goalCount < this.goalTotal) {
            const currentSurface = detectGrokScrapeSurface(document, window.location);
            const agentBinding = currentSurface === SCRAPE_SURFACES.agentMedia
                ? this._captureSelectedAgentMediaBinding()
                : null;
            if (currentSurface === SCRAPE_SURFACES.agentMedia && !agentBinding) {
                this.batchFailureMessage = 'Prompted Batch [detail]: Select one Agent asset before starting';
                this.safeStatus(this.batchFailureMessage, 'warning');
                break;
            }
            if (this.batchPrompt) {
                const modeReady = agentBinding
                    ? await this.selectMakeVideoMode(runToken, null, agentBinding)
                    : await this.selectMakeVideoMode(runToken);
                if (!this.isBatchRunActive(runToken)) break;
                if (!modeReady) {
                    this.batchFailureMessage = 'Prompted Batch [detail]: Could not open Make Video > Add Prompt';
                    this.safeStatus(this.batchFailureMessage, 'warning');
                    break;
                }
                if (!this.injectPromptedVideoText(this.batchPrompt)) {
                    this.batchFailureMessage = 'Prompted Batch [detail]: Video prompt field not found';
                    this.safeStatus(this.batchFailureMessage, 'warning');
                    break;
                }
                if (!this.isBatchRunActive(runToken)) break;
            }

            const submitReady = await this._waitForPromptedVideoSubmitButton(
                runToken,
                agentBinding
            );
            if (!this.isBatchRunActive(runToken)) break;
            if (!submitReady) {
                this.batchFailureMessage = 'Prompted Batch [detail]: Video submit button not ready';
                this.safeStatus(this.batchFailureMessage, 'warning');
                break;
            }

            if (!this.isBatchRunActive(runToken)) break;
            const videoResultBaseline = agentBinding
                ? this.capturePromptedVideoResultBaseline(document, agentBinding)
                : this.capturePromptedVideoResultBaseline(document);
            this.preClickButtonCount = document.querySelectorAll(this.PROGRESS_SELECTOR).length;
            const submitted = agentBinding
                ? await this.clickPromptedVideoSubmitButton(runToken, agentBinding)
                : await this.clickPromptedVideoSubmitButton(runToken);
            if (!submitted) {
                this.batchFailureMessage = 'Prompted Batch [detail]: Video submit button not ready';
                this.safeStatus(this.batchFailureMessage, 'warning');
                break;
            }
            this.lastClickTime = Date.now();
            console.log(`Prompted Batch [detail]: Submitted video (${this.goalCount + 1}/${this.goalTotal}).`);

            const result = await this.awaitBatchItemCompletion(document, {
                allowRetry: true,
                labelPrefix: 'Prompted Batch [detail]',
                videoResultBaseline,
                runToken
            });

            if (!this.isBatchRunActive(runToken)) break;
            if (result === 'success') {
                this.goalCount++;
                this.currentRetry = 0;
                this.updateCounters();
                this.safeStatus(`Prompted Batch [detail]: Progress ${this.goalCount}/${this.goalTotal}`, 'success');
                continue;
            }

            if (result === 'aborted') break;

            this.safeStatus('Prompted Batch [detail]: Stopped after failed attempt', 'warning');
            break;
        }

        if (this.batchRunToken !== runToken) return;
        const hitGoal = this.goalCount >= this.goalTotal;
        const wasAborted = this.batchAborted;
        this._clearPromptedVideoComposerRoot();
        this.batchRunning = false;
        this.batchAborted = false;
        this.batchRunToken = null;
        this.updateBatchButtons(false);
        this.updateCounters();
        if (hitGoal) {
            this.safeStatus(`Prompted Batch [detail]: Complete (${this.goalCount}/${this.goalTotal})`, 'success');
        } else if (wasAborted) {
            this.safeStatus(`Prompted Batch [detail]: Stopped (${this.goalCount}/${this.goalTotal})`, 'neutral');
        } else if (this.batchFailureMessage) {
            this.safeStatus(this.batchFailureMessage, 'warning');
        } else {
            this.safeStatus(`Prompted Batch [detail]: Stopped (${this.goalCount}/${this.goalTotal})`, 'neutral');
        }
    }

    async stopBatch() {
        const activeRun = this.generationRun;
        const label = activeRun?.kind === 'video_goal' ? 'Video Goal' : 'Batch';
        this._clearPromptedVideoComposerRoot();
        this.batchRunning = false;
        this.batchAborted = true;
        this.batchRunToken = null;
        this.goalRunning = false;
        this.isVerifying = false;
        this.targetContext = null;
        this.batchContext = null;
        this.batchProcessedSrcs = null;
        this.safeStatus(`${label}: Stopping...`, 'neutral');
        this.updateCounters();
        this.updateBatchButtons(Boolean(activeRun));
        if (activeRun && !['completed', 'cancelled', 'failed'].includes(activeRun.status)) {
            const response = await this._sendGenerationMessage({
                action: 'GENERATION_RUN_CANCEL',
                runId: activeRun.runId,
                epoch: activeRun.epoch
            }, 'cancel generation run');
            this._rememberGenerationRun(response);
            if (response?.status === 'cancelling') {
                this.updateGenerationRunControls(this.generationRun);
                const cleared = await this.waitForGenerationAuthorityClear(activeRun.runId);
                if (!cleared) {
                    this.safeStatus(
                        `${label}: Still stopping. Refresh this Grok tab before starting another workflow.`,
                        'warning'
                    );
                    return false;
                }
            } else if (response?.status !== 'cancelled') {
                this.safeStatus(`${label}: ${response?.error || 'Stop was not acknowledged'}`, 'warning');
                return false;
            }
        }
        this.updateBatchButtons(false);
        this.updateGenerationRunControls(this.generationRun);
        this.safeStatus(`${label} Stopped`, 'neutral');
        await this.overlay?.refreshActiveWorkflowStatus?.();
        return true;
    }

    async waitForGenerationAuthorityClear(runId, timeoutMs = 15000) {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            const response = await this._sendGenerationMessage({
                action: 'GENERATION_RUN_STATUS'
            }, 'check generation run status');
            this._rememberGenerationRun(response);
            if (!response || response.status === 'rejected') return false;
            if (response.status !== 'active' || response.run?.runId !== runId) return true;
            await this.sleep(250);
        }
        return false;
    }

    buildBatchQueue() {
        const surface = detectGrokScrapeSurface(document, window.location);
        let items = [];
        if (surface === SCRAPE_SURFACES.savedGallery) {
            const context = getSavedGalleryContext(document);
            if (!context) return [];
            items = context.entries.map((entry) => {
                const buttons = Array.from(entry.card.querySelectorAll(this.BUTTON_SELECTOR))
                    .filter((button) => findMediaCardRoot(button) === entry.card);
                if (buttons.length !== 1) return null;
                const rect = entry.card.getBoundingClientRect();
                return {
                    button: buttons[0],
                    container: entry.card,
                    top: rect.top + window.scrollY,
                    left: rect.left + window.scrollX
                };
            }).filter(Boolean);
        } else {
            const buttons = Array.from(document.querySelectorAll(this.BUTTON_SELECTOR));
            items = buttons.map(btn => {
                const container = findMediaCardRoot(btn);
                if (!container) return null;
                const rect = container.getBoundingClientRect();
                return { button: btn, container, top: rect.top + window.scrollY, left: rect.left + window.scrollX };
            }).filter(Boolean);
            items.sort((a, b) => {
                if (Math.abs(a.top - b.top) > 20) return a.top - b.top;
                return a.left - b.left;
            });
        }
        // Filter out completed, censored, or already-processed items
        return items.filter(item =>
            !item.container.querySelector(this.PROGRESS_SELECTOR)
            && !this.isCensoredCard(item.container)
            && !this.batchProcessedSrcs?.has(this._getCardSourceId(item.container))
        );
    }

    async processBatchNext() {
        if (!this.batchRunning || this.batchAborted) return;

        // If queue exhausted, try auto-scrolling for more
        if (this.batchIndex >= this.batchQueue.length) {
            const foundMore = await this.scrollForMore();
            if (!foundMore) {
                this.safeStatus(`Batch Complete! ${this.goalCount} videos`, 'success');
                this.batchRunning = false;
                this.updateBatchButtons(false);
                return;
            }
            // Continue with the newly found items
        }

        const item = this.batchQueue[this.batchIndex];

        // Skip if button detached from DOM
        if (!item.button.isConnected) {
            console.log(`Batch: Item ${this.batchIndex} detached, skipping.`);
            this.batchIndex++;
            return this.processBatchNext();
        }

        // Skip if already has video
        if (item.container.querySelector(this.PROGRESS_SELECTOR)) {
            console.log(`Batch: Item ${this.batchIndex} already has video, skipping.`);
            this.batchIndex++;
            this.goalCount++;
            this.updateCounters();
            return this.processBatchNext();
        }

        this.safeStatus(`Batch: ${this.batchIndex + 1}/${this.batchQueue.length} (${this.batchMode})`, 'info');

        if (this.batchMode === 'quick') {
            await this.processBatchItemQuick(item);
        } else {
            await this.processBatchItemPrompted(item);
        }
    }

    // Mode A: Quick batch — fire-and-forget, click all "Make video" buttons rapidly
    async processBatchItemQuick(item) {
        item.button.scrollIntoView({ behavior: 'smooth', block: 'center' });
        await this.sleep(500);

        item.button.click();
        this.goalCount++;
        this.updateCounters();
        console.log(`Batch Quick: Fired item ${this.batchIndex + 1}.`);
        this.safeStatus(`Batch: Fired ${this.batchIndex + 1}/${this.batchQueue.length}`, 'info');

        this.batchIndex++;
        await this.sleep(1500); // Brief pause between clicks
        if (this.batchRunning && !this.batchAborted) await this.processBatchNext();
    }

    createPromptedBatchNavigationSnapshot(item) {
        const sourceUrl = this._getCardImageSrc(item.container);
        const sourceId = getGrokMediaIdentity(sourceUrl) || sourceUrl;
        const sourceCardIdentity = getSavedCardIdentity(item.container, sourceId);
        const savedViewportReceipt = captureSavedViewportReceipt({
            sourceIdentity: sourceCardIdentity
        });
        return {
            galleryUrl: this.batchGalleryUrl || window.location.href,
            sourceId,
            sourceCardIdentity,
            savedViewportReceipt,
            scrollY: savedViewportReceipt?.scrollTop
                ?? Math.round(window.scrollY || document.documentElement.scrollTop || 0)
        };
    }

    async waitForPromptedBatchEditorReady(expectedIdentity, runToken, timeoutMs = 10000) {
        const pollInterval = 200;
        const maxAttempts = Math.max(1, Math.ceil(timeoutMs / pollInterval));
        let lastSurface = SCRAPE_SURFACES.savedGallery;
        let lastMatchStatus = 'missing';
        let selectionAttemptedAssetNode = null;
        let stableAction = null;
        let stableActionPolls = 0;
        const requiredStableActionPolls = Math.max(
            2,
            Math.ceil(AGENT_ACTION_QUIESCENCE_MS / pollInterval)
        );

        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            if (!this.isBatchRunActive(runToken)) return { status: 'cancelled', surface: lastSurface };
            lastSurface = detectGrokScrapeSurface(document, window.location);
            if (lastSurface === SCRAPE_SURFACES.unsupported) {
                if (this._isResultsGallerySurface()) {
                    await this.sleep(pollInterval);
                    continue;
                }
                return { status: 'unsupported', surface: lastSurface };
            }
            if (lastSurface === SCRAPE_SURFACES.legacyDetail) {
                const described = GrokImagineAdapter.describeCurrentSource({
                    root: document,
                    surface: 'legacy_detail',
                    location: window.location
                });
                lastMatchStatus = described.status;
                if (described.status === 'ambiguous') {
                    return { status: 'ambiguous', surface: lastSurface };
                }
                if (described.status === 'matched') {
                    const expectedSourceId = getGrokMediaIdentity(expectedIdentity);
                    const descriptor = described.descriptor;
                    if (expectedSourceId
                        && descriptor.sourceAssetId !== expectedSourceId
                        && descriptor.sourcePostId !== expectedSourceId) {
                        return { status: 'ambiguous', surface: lastSurface };
                    }
                    const makeVideoTrigger = this._findCurrentMakeVideoTrigger();
                    if (makeVideoTrigger === stableAction) {
                        stableActionPolls++;
                    } else {
                        stableAction = makeVideoTrigger;
                        stableActionPolls = makeVideoTrigger ? 1 : 0;
                    }
                    if (stableAction && stableActionPolls >= requiredStableActionPolls) {
                        return {
                            status: 'ready',
                            surface: lastSurface,
                            makeVideoTrigger
                        };
                    }
                }
                await this.sleep(pollInterval);
                continue;
            }
            if (lastSurface === SCRAPE_SURFACES.agentMedia) {
                const match = findMatchingAgentMedia(document, expectedIdentity);
                lastMatchStatus = match.status;
                if (match.status === 'ambiguous') {
                    return { status: 'ambiguous', surface: lastSurface };
                }
                if (match.status === 'matched') {
                    const agentBinding = this._createAgentMediaBinding(match, expectedIdentity);
                    if (!agentBinding) return { status: 'unbound', surface: lastSurface };
                    const currentBinding = this._resolveCurrentAgentMediaBinding(agentBinding);
                    if (!currentBinding) {
                        const selectedNodes = this._getSelectedAgentAssetNodes();
                        if (selectedNodes.length > 1) {
                            return { status: 'ambiguous_selection', surface: lastSurface };
                        }
                        if (selectionAttemptedAssetNode !== match.assetNode) {
                            selectionAttemptedAssetNode = match.assetNode;
                            this.simulateClick(match.assetNode);
                        }
                        stableAction = null;
                        stableActionPolls = 0;
                        await this.sleep(pollInterval);
                        continue;
                    }
                    const makeVideoTriggers = this._getBoundAgentMakeVideoTriggers(currentBinding);
                    if (makeVideoTriggers.length > 1) {
                        return { status: 'ambiguous_action', surface: lastSurface };
                    }
                    const makeVideoTrigger = makeVideoTriggers[0] || null;
                    if (!makeVideoTrigger) {
                        stableAction = null;
                        stableActionPolls = 0;
                        await this.sleep(pollInterval);
                        continue;
                    }
                    if (makeVideoTrigger === stableAction) {
                        stableActionPolls++;
                    } else {
                        stableAction = makeVideoTrigger;
                        stableActionPolls = 1;
                    }
                    if (stableActionPolls < requiredStableActionPolls) {
                        await this.sleep(pollInterval);
                        continue;
                    }
                    return {
                        status: 'ready',
                        surface: lastSurface,
                        makeVideoTrigger,
                        media: match.media,
                        agentBinding: currentBinding
                    };
                }
            }
            await this.sleep(pollInterval);
        }

        return { status: 'timeout', surface: lastSurface, matchStatus: lastMatchStatus };
    }

    async waitForPromptedBatchSavedSurface(snapshot, runToken, timeoutMs = 10000) {
        const receipt = normalizeSavedViewportReceipt(snapshot);
        if (!receipt) return false;
        const result = await restoreSavedViewportReceipt(receipt, {
            isActive: () => this.isBatchRunActive(runToken),
            isScopeValid: () => {
                const currentScope = detectSavedGalleryScope(document);
                return currentScope === SAVED_GALLERY_SCOPES.unknown
                    || currentScope === receipt.origin.scope;
            },
            sleep: (delay) => this.sleep(delay),
            timeoutMs
        });
        return result.status === 'restored';
    }

    _findPromptedBatchBackControl() {
        const candidates = Array.from(document.querySelectorAll('[aria-label="Back"]'));
        for (const candidate of candidates) {
            const clickTarget = candidate.matches('button, a, [role="button"]')
                ? candidate
                : candidate.closest('button, a, [role="button"]');
            if (this._isActionableAutomationTarget(clickTarget)) return clickTarget;
        }
        return null;
    }

    restorePromptedBatchSavedState(snapshot, runToken) {
        if (!this.isBatchRunActive(runToken)) return false;
        this.batchQueue = this.buildBatchQueue();
        const receipt = normalizeSavedViewportReceipt(snapshot);
        const context = getSavedGalleryContext(document);
        if (!receipt || !context || !hasOrderedSavedNeighborhood(context.entries, receipt)) return false;
        const getEntryIdentity = (entry) => (
            receipt.identityKind === 'saved_post' ? entry.cardIdentity : entry.sourceIdentity
        );
        const sourceIndices = context.entries
            .map((entry, index) => getEntryIdentity(entry) === receipt.sourceIdentity ? index : -1)
            .filter((index) => index >= 0);
        if (sourceIndices.length !== 1) return false;
        const queueIndexByIdentity = new Map(this.batchQueue.map((item, index) => (
            [receipt.identityKind === 'saved_post'
                ? getSavedCardIdentity(item.container, this._getCardSourceId(item.container))
                : this._getCardSourceId(item.container), index]
        )));
        const nextQueueIndex = context.entries
            .slice(sourceIndices[0] + 1)
            .map((entry) => queueIndexByIdentity.get(getEntryIdentity(entry)))
            .find((index) => Number.isInteger(index));
        this.batchQueue = Number.isInteger(nextQueueIndex)
            ? this.batchQueue.slice(nextQueueIndex)
            : [];
        this.batchIndex = 0;
        this.targetContext = null;
        this._clearPromptedVideoComposerRoot();
        return true;
    }

    navigateToPromptedBatchGallery(galleryUrl) {
        window.location.assign(galleryUrl);
    }

    recoverPromptedBatchToGallery(snapshot, runToken) {
        if (!this.isBatchRunActive(runToken)) return false;
        this.stopBatch();
        this.safeStatus('Prompted Batch: could not return to Saved. Returning you to Saved. Restart the batch after the page reloads.', 'warning');
        this.navigateToPromptedBatchGallery(snapshot.galleryUrl);
        return false;
    }

    async stopPromptedBatchItem(message, snapshot, runToken) {
        if (!this.isBatchRunActive(runToken)) return false;
        this.batchFailureMessage = message;
        this.safeStatus(message, 'warning');
        this._clearPromptedVideoComposerRoot();
        if (detectGrokScrapeSurface(document, window.location) !== SCRAPE_SURFACES.savedGallery) {
            const returnStatus = await this.batchGoBack(snapshot, runToken);
            if (returnStatus === 'failed') return this.recoverPromptedBatchToGallery(snapshot, runToken);
        }
        if (!this.isBatchRunActive(runToken)) return false;
        this.batchRunning = false;
        this.batchRunToken = null;
        this.targetContext = null;
        this.updateCounters();
        this.updateBatchButtons(false);
        return false;
    }

    // Mode B: Prompted batch — enter a supported editor, submit once, then restore Saved.
    async processBatchItemPrompted(item, runToken = this.batchRunToken) {
        if (!this.isBatchRunActive(runToken)) return false;
        const img = this._getCardGeneratedImage(item.container);
        if (!img) {
            return this.stopPromptedBatchItem(
                'Prompted Batch [gallery]: Generated image was not found',
                this.createPromptedBatchNavigationSnapshot(item),
                runToken
            );
        }

        const snapshot = this.createPromptedBatchNavigationSnapshot(item);
        if (!snapshot.sourceId || detectGrokScrapeSurface(document, window.location) !== SCRAPE_SURFACES.savedGallery) {
            return this.stopPromptedBatchItem(
                'Prompted Batch [gallery]: Saved source changed before navigation',
                snapshot,
                runToken
            );
        }

        img.scrollIntoView({ behavior: 'instant', block: 'center' });
        if (!this.isBatchRunActive(runToken)) return false;
        img.click();

        const editorReady = await this.waitForPromptedBatchEditorReady(snapshot.sourceId, runToken);
        if (!this.isBatchRunActive(runToken)) return false;
        if (editorReady.status === 'unsupported') {
            return this.stopPromptedBatchItem(
                'Prompted Batch [gallery]: Selected image opened an unsupported route',
                snapshot,
                runToken
            );
        }
        if (editorReady.status === 'ambiguous') {
            return this.stopPromptedBatchItem(
                'Prompted Batch [gallery]: Agent Mode exposed more than one match for the selected Saved image',
                snapshot,
                runToken
            );
        }
        if (editorReady.status !== 'ready') {
            const message = editorReady.surface === SCRAPE_SURFACES.agentMedia
                ? 'Prompted Batch [gallery]: Agent Mode did not become ready for the selected Saved image'
                : 'Prompted Batch [gallery]: Selected image did not open an editor';
            return this.stopPromptedBatchItem(message, snapshot, runToken);
        }

        if (!this.isBatchRunActive(runToken)) return false;
        const modeReady = await this.selectMakeVideoMode(
            runToken,
            editorReady.makeVideoTrigger,
            editorReady.agentBinding || null
        );
        if (!this.isBatchRunActive(runToken)) return false;
        if (!modeReady) {
            return this.stopPromptedBatchItem(
                'Prompted Batch [gallery]: Could not open Make Video > Add Prompt',
                snapshot,
                runToken
            );
        }

        if (!this.isBatchRunActive(runToken)) return false;
        if (!this.injectPromptedVideoText(this.batchPrompt)) {
            return this.stopPromptedBatchItem(
                'Prompted Batch [gallery]: Video prompt field not found',
                snapshot,
                runToken
            );
        }

        if (!this.isBatchRunActive(runToken)) return false;
        const submitReady = await this._waitForPromptedVideoSubmitButton(
            runToken,
            editorReady.agentBinding || null
        );
        if (!this.isBatchRunActive(runToken)) return false;
        if (!submitReady) {
            return this.stopPromptedBatchItem(
                'Prompted Batch [gallery]: Video submit button not ready',
                snapshot,
                runToken
            );
        }

        if (!this.isBatchRunActive(runToken)) return false;
        const submissionReceipt = this._capturePromptedVideoSubmissionReceipt();
        if (!submissionReceipt) {
            return this.stopPromptedBatchItem(
                'Prompted Batch [gallery]: Video submit state could not be verified',
                snapshot,
                runToken
            );
        }
        const submitted = await this.clickPromptedVideoSubmitButton(
            runToken,
            editorReady.agentBinding || null
        );
        if (!submitted) {
            return this.stopPromptedBatchItem(
                'Prompted Batch [gallery]: Video submit button not ready',
                snapshot,
                runToken
            );
        }

        if (!this.isBatchRunActive(runToken)) return false;
        this.lastClickTime = Date.now();
        console.log(`Prompted Batch [gallery]: Submitted video for item ${this.batchIndex + 1}.`);

        const submissionAccepted = await this._waitForPromptedVideoSubmissionAccepted(
            submissionReceipt,
            runToken
        );
        if (!this.isBatchRunActive(runToken)) return false;
        if (!submissionAccepted) {
            return this.stopPromptedBatchItem(
                'Prompted Batch [gallery]: Video submission was not accepted',
                snapshot,
                runToken
            );
        }
        this.batchProcessedSrcs?.add(snapshot.sourceId);

        const returnStatus = await this.batchGoBack(snapshot, runToken);
        if (returnStatus === 'failed') return this.recoverPromptedBatchToGallery(snapshot, runToken);
        if (returnStatus !== 'returned' || !this.isBatchRunActive(runToken)) return false;

        this.goalCount++;
        this.targetContext = null;
        this.currentRetry = 0;
        this.updateCounters();
        return true;
    }

    async batchGoBack(snapshot, runToken = this.batchRunToken) {
        if (!this.isBatchRunActive(runToken)) return 'cancelled';
        const backBtn = this._findPromptedBatchBackControl();
        if (backBtn) {
            const clicked = await this._clickPromptedBatchNativeControl(
                backBtn,
                runToken,
                'return to prompted batch saved gallery',
                () => this._findPromptedBatchBackControl() === backBtn
            );
            if (!clicked) return this.isBatchRunActive(runToken) ? 'failed' : 'cancelled';
            const returned = await this.waitForPromptedBatchSavedSurface(snapshot, runToken);
            if (!this.isBatchRunActive(runToken)) return 'cancelled';
            if (returned) return this.restorePromptedBatchSavedState(snapshot, runToken) ? 'returned' : 'cancelled';
            return 'failed';
        }

        if (!this.isBatchRunActive(runToken)) return 'cancelled';
        if (window.history.length > 1) {
            window.history.back();
            const returned = await this.waitForPromptedBatchSavedSurface(snapshot, runToken);
            if (!this.isBatchRunActive(runToken)) return 'cancelled';
            if (returned) return this.restorePromptedBatchSavedState(snapshot, runToken) ? 'returned' : 'cancelled';
        }

        return this.isBatchRunActive(runToken) ? 'failed' : 'cancelled';
    }

    async awaitBatchItemCompletion(searchRoot, options = {}) {
        const TIMEOUT = 120000;
        const POLL_INTERVAL = 1500;
        const startTime = Date.now();
        const s = this.settingsManager.settings;
        const allowRetry = options.allowRetry !== false;
        const labelPrefix = options.labelPrefix || 'Batch';
        const runToken = options.runToken;

        while (this.isPromptedBatchTokenActive(runToken) && this.batchRunning && !this.batchAborted) {
            await this.sleep(POLL_INTERVAL);
            if (!this.isPromptedBatchTokenActive(runToken) || !this.batchRunning) return 'aborted';

            const elapsed = Date.now() - startTime;

            if (options.videoResultBaseline) {
                if (this._hasNewPromptedVideoResult(searchRoot, options.videoResultBaseline)) {
                    return 'success';
                }
                this.safeStatus(`${labelPrefix}: Generating...`, 'info');
                if (elapsed > TIMEOUT) {
                    console.log(`${labelPrefix}: Timed out waiting for a new video result.`);
                    this.safeStatus(`${labelPrefix}: Timed out`, 'warning');
                    return 'failed';
                }
                continue;
            }

            // Check if "Make video" button reappeared (generation done)
            const btnBack = searchRoot.querySelector(this.BUTTON_SELECTOR);
            if (!btnBack) {
                this.safeStatus(`${labelPrefix}: Generating...`, 'info');
                if (elapsed > TIMEOUT) {
                    console.log(`${labelPrefix}: Timed out on item.`);
                    this.safeStatus(`${labelPrefix}: Timed out`, 'warning');
                    return 'failed';
                }
                continue;
            }

            // Button is back — did it succeed?
            const currentCompleted = searchRoot.querySelectorAll(this.PROGRESS_SELECTOR).length;
            if (currentCompleted > this.preClickButtonCount) {
                return 'success';
            } else {
                if (!allowRetry) {
                    return 'failed';
                }

                // Failure — retry
                if (this.currentRetry >= s.maxRetries) {
                    console.log(`${labelPrefix}: Max retries on item.`);
                    this.safeStatus(`${labelPrefix}: Max retries hit`, 'warning');
                    return 'failed';
                }

                this.currentRetry++;
                this.safeStatus(`${labelPrefix}: Retry ${this.currentRetry}/${s.maxRetries}`, 'warning');
                this.preClickButtonCount = currentCompleted;
                this.updateCounters();

                await this.sleep(s.retryCooldown);
                if (!this.isPromptedBatchTokenActive(runToken) || !this.batchRunning) return 'aborted';

                const retryBtn = searchRoot.querySelector(this.BUTTON_SELECTOR);
                if (retryBtn && this.isPromptedBatchTokenActive(runToken)) {
                    this.lastClickTime = Date.now();
                    retryBtn.click();
                }
            }
        }

        return this.batchAborted ? 'aborted' : 'failed';
    }

    async scrollForMore(runToken) {
        if (runToken && !this.isBatchRunActive(runToken)) return false;
        if (runToken
            && this.batchMode === 'prompted'
            && ((this.batchContext === 'gallery'
                && detectGrokScrapeSurface(document, window.location) !== SCRAPE_SURFACES.savedGallery)
                || (this.batchContext === 'results_gallery'
                    && !this._isResultsGallerySurface()))) {
            return false;
        }
        if (this.scrollAttempts >= 3) return false;
        this.scrollAttempts++;

        const galleryContext = this.batchContext === 'results_gallery'
            ? this._getResultsGalleryContext()
            : getSavedGalleryContext(document);
        const scroller = galleryContext?.scroller || window;
        const scrollAmount = getSavedScrollerSnapshot(scroller).clientHeight
            || window.innerHeight
            || 800;
        if (scroller === window) {
            window.scrollBy(0, scrollAmount);
        } else if (typeof scroller.scrollBy === 'function') {
            scroller.scrollBy(0, scrollAmount);
        } else {
            scroller.scrollTop = Number(scroller.scrollTop || 0) + scrollAmount;
            scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
        }
        await this.sleep(2500); // Wait for lazy load
        if (runToken && !this.isBatchRunActive(runToken)) return false;

        const newQueue = this.batchContext === 'results_gallery'
            ? this._getQualifiedResultsGalleryItems().filter((item) => (
                !item.container.querySelector(this.PROGRESS_SELECTOR)
                && !this.isCensoredCard(item.container)
                && !this.batchProcessedSrcs?.has(item.sourceId)
            ))
            : this.buildBatchQueue();
        // Only add genuinely new items (not already in queue)
        const existingKeys = new Set(this.batchQueue.map((item) => (
            this.batchContext === 'results_gallery'
                ? item.sourceId
                : item.container
        )));
        const newItems = newQueue.filter((item) => !existingKeys.has(
            this.batchContext === 'results_gallery'
                ? item.sourceId
                : item.container
        ));

        if (newItems.length > 0) {
            this.batchQueue.push(...newItems);
            if (!(this.batchMode === 'prompted'
                && (this.batchContext === 'gallery' || this.batchContext === 'results_gallery'))) {
                this.goalTotal = this.batchQueue.length;
            }
            this.scrollAttempts = 0; // Reset on success
            this.updateCounters();
            console.log(`Batch: Scrolled and found ${newItems.length} new items.`);
            return true;
        }

        console.log(`Batch: Scroll attempt ${this.scrollAttempts}/3 found no new items.`);
        return false;
    }

    updateBatchButtons(running) {
        if (!this.overlay || !this.overlay.el) return;
        const quickBtn = this.overlay.el.querySelector('#gptQuickBatchBtn');
        const promptedBtn = this.overlay.el.querySelector('#gptPromptedBatchBtn');
        const goalBtn = this.overlay.el.querySelector('#gptStartGoalBtn');
        const stopBtn = this.overlay.el.querySelector('#gptBatchStopBtn');
        const batchStatus = this.overlay.el.querySelector('#gptBatchStatus');
        const galleryLimitRow = this.overlay.el.querySelector('#gptGalleryLimitRow');

        if (quickBtn) quickBtn.style.display = running ? 'none' : '';
        if (promptedBtn) promptedBtn.style.display = running ? 'none' : '';
        if (goalBtn) goalBtn.style.display = running ? 'none' : '';
        if (stopBtn) stopBtn.style.display = running ? '' : 'none';
        if (batchStatus) batchStatus.style.display = running ? 'block' : 'none';
        if (galleryLimitRow) galleryLimitRow.style.display = running ? 'none' : '';
        if (batchStatus) {
            const ctx = this.batchContext ? ` [${this.batchContext}]` : '';
            batchStatus.textContent = running ? `Batch Mode${ctx}: Active` : 'Batch Mode: Active';
        }
    }

    updateGenerationRunControls(run = this.generationRun, options = {}) {
        if (!this.overlay?.el) return;
        const quickBtn = this.overlay.el.querySelector('#gptQuickBatchBtn');
        const promptedBtn = this.overlay.el.querySelector('#gptPromptedBatchBtn');
        const goalBtn = this.overlay.el.querySelector('#gptStartGoalBtn');
        const stopBtn = this.overlay.el.querySelector('#gptBatchStopBtn');
        const recoveryRow = this.overlay.el.querySelector('#gptBatchRecoveryRow');
        const resumeBtn = this.overlay.el.querySelector('#gptBatchResumeBtn');
        const retryBtn = this.overlay.el.querySelector('#gptBatchRetryFailedBtn');
        const cancelBtn = this.overlay.el.querySelector('#gptBatchCancelRunBtn');
        const active = run && !['completed', 'cancelled', 'failed'].includes(run.status);
        const cancelling = active && run.status === 'cancelling';
        const retryable = active && run.status === 'retryable_failed';
        const resumable = active && options.resume === true;
        const recovering = retryable || resumable;

        if (quickBtn) quickBtn.style.display = active ? 'none' : '';
        if (promptedBtn) promptedBtn.style.display = active ? 'none' : '';
        if (goalBtn) goalBtn.style.display = active ? 'none' : '';
        if (stopBtn) {
            stopBtn.style.display = active && !recovering ? '' : 'none';
            stopBtn.disabled = cancelling;
            stopBtn.textContent = cancelling ? 'Stopping...' : 'Stop Batch';
        }
        if (recoveryRow) recoveryRow.style.display = recovering ? 'flex' : 'none';
        if (resumeBtn) resumeBtn.style.display = resumable ? '' : 'none';
        if (retryBtn) retryBtn.style.display = retryable ? '' : 'none';
        if (cancelBtn) cancelBtn.style.display = recovering ? '' : 'none';
    }

    // --- Observer (1s polling for Goal mode only) ---
    startObserver() {
        if (this.intervalId) clearInterval(this.intervalId);
        this.intervalId = setInterval(() => this.checkAndAct(), 1000);
    }

    stopObserver() {
        if (this.intervalId) { clearInterval(this.intervalId); this.intervalId = null; }
    }

    updateCounters() {
        if (!this.overlay || !this.overlay.el) return;
        const retryB = this.overlay.el.querySelector('#gptRetryCounter');
        const vidB = this.overlay.el.querySelector('#gptVideoCounter');
        const progressLabel = this.overlay.el.querySelector('#gptProgressLabel');
        const s = this.settingsManager.settings;
        const isGalleryPrompted = this.batchRunning
            && this.batchMode === 'prompted'
            && (this.batchContext === 'gallery'
                || this.batchContext === 'results_gallery'
                || this.batchContext === 'saved_gallery');
        if (progressLabel) {
            progressLabel.textContent = isGalleryPrompted ? 'Images Processed' : 'Videos Generated';
        }
        if (retryB) retryB.textContent = `${this.currentRetry}/${s.maxRetries}`;
        if (vidB) vidB.textContent = `${this.goalCount}/${this.goalTotal}`;
    }

    checkAndAct() {
        if (this.generationRun
            && !['completed', 'cancelled', 'failed'].includes(this.generationRun.status)) return;
        // Batch mode uses its own async loop
        if (this.batchRunning) return;
        // Only act during active goals
        if (!this.goalRunning) return;
        if (typeof document === 'undefined') return;

        // Context-loss detection: if target was detached, stop
        if (this.targetContext && !this.targetContext.isConnected) {
            console.log('VideoRetryManager: Target context detached. Stopping.');
            this.goalRunning = false;
            this.isVerifying = false;
            this.targetContext = null;
            this.safeStatus('Stopped (context lost)', 'warning');
            return;
        }

        const root = this._queryRoot();
        const makeVideoBtn = root.querySelector(this.BUTTON_SELECTOR);
        const isGenerating = !makeVideoBtn;

        if (isGenerating) {
            this.safeStatus('Generating...', 'info');
            // Verify timeout: 2 minutes
            if (this.isVerifying && (Date.now() - this.verifyStartTime > 120000)) {
                console.log('VideoRetryManager: Verification timed out.');
                this.isVerifying = false;
                this.safeStatus('Generation timed out', 'error');
            }
            return;
        }

        if (this.isVerifying) {
            const currentCompleted = root.querySelectorAll(this.PROGRESS_SELECTOR).length;

            if (currentCompleted > this.preClickButtonCount) {
                console.log('VideoRetryManager: SUCCESS detected.');
                this.goalCount++;
                this.currentRetry = 0;
                this.updateCounters();
                this.safeStatus('Success! Next...', 'success');

                if (this.goalCount >= this.goalTotal) {
                    console.log('VideoRetryManager: Goal Reached.');
                    this.goalRunning = false;
                    this.safeStatus('Goal Complete', 'success');
                    this.isVerifying = false;
                    this.targetContext = null;
                    return;
                }

                this.isVerifying = false;
                // Fall through to click logic
            } else {
                console.log('VideoRetryManager: FAILURE detected.');
                this.isVerifying = false;
                this.attemptRetry();
                return;
            }
        }

        // Click logic: ready to click next?
        const s = this.settingsManager.settings;
        if (makeVideoBtn && !makeVideoBtn.disabled && (Date.now() - this.lastClickTime > s.retryCooldown)) {
            this.clickMakeVideo();
        }
    }

    attemptRetry() {
        const s = this.settingsManager.settings;
        if (Date.now() - this.lastClickTime < s.retryCooldown) return;

        // Check if auto-retry is enabled
        if (!s.autoRetryEnabled) {
            this.safeStatus('Failed (auto-retry off)', 'error');
            this.goalRunning = false;
            this.targetContext = null;
            return;
        }

        if (this.currentRetry >= s.maxRetries) {
            this.safeStatus('Max Retries Hit', 'error');
            this.goalRunning = false;
            this.targetContext = null;
            return;
        }

        this.currentRetry++;
        console.log(`VideoRetryManager: Retrying... Attempt ${this.currentRetry}`);
        this.updateCounters();
        this.safeStatus(`Retrying... (${this.currentRetry})`, 'warning');
        this.clickMakeVideo();
    }

    clickMakeVideo() {
        const root = this._queryRoot();
        const btn = root.querySelector(this.BUTTON_SELECTOR);
        if (btn) {
            // Ensure prompt is present
            const ta = document.querySelector('textarea[aria-required="true"]');
            if (ta && (!ta.value || ta.value.trim() === '')) {
                if (this.historyManager && this.historyManager.history.length > 0) {
                    const lastPrompt = this.historyManager.history[0].text;
                    if (lastPrompt) {
                        ta.focus();
                        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
                        nativeInputValueSetter.call(ta, lastPrompt);
                        ta.dispatchEvent(new Event('input', { bubbles: true }));
                        console.log('VideoRetryManager: Re-injected prompt');
                    }
                }
            }

            this.lastClickTime = Date.now();
            this.isVerifying = true;
            this.verifyStartTime = Date.now();

            // Record state BEFORE click (scoped)
            this.preClickButtonCount = root.querySelectorAll(this.PROGRESS_SELECTOR).length;

            btn.click();
            console.log('VideoRetryManager: Clicked Make Video.');
        }
    }

    // --- Quality Repeat: auto-click "Generate More" N times ---

    isQualityRepeatButtonUsable(button) {
        if (!button?.isConnected || button.hidden || button.disabled) return false;
        if (button.getAttribute('aria-hidden') === 'true'
            || button.getAttribute('aria-disabled') === 'true') return false;
        const style = window.getComputedStyle(button);
        return style.display !== 'none' && style.visibility !== 'hidden';
    }

    findGenerateMoreButtons(root = document) {
        return Array.from(root.querySelectorAll('button')).filter((button) => (
            button.textContent.trim() === 'Generate More'
            && this.isQualityRepeatButtonUsable(button)
        ));
    }

    findGenerateMoreButton(root = document) {
        const buttons = this.findGenerateMoreButtons(root);
        return buttons.length === 1 ? buttons[0] : null;
    }

    getQualityRepeatScope(button) {
        let node = button?.parentElement || null;
        while (node && node !== document.body) {
            const matchingButtons = this.findGenerateMoreButtons(node);
            const hasMedia = Boolean(node.querySelector('img[src], video[src], video source[src]'));
            if (matchingButtons.length === 1 && matchingButtons[0] === button && hasMedia) return node;
            if (matchingButtons.length > 1) break;
            node = node.parentElement;
        }
        return null;
    }

    captureQualityRepeatIdentities(scope) {
        const identities = new Set();
        for (const media of scope?.querySelectorAll?.('img[src], video[src], video source[src]') || []) {
            const source = getBackupMediaElementSrc(media);
            const identity = getGrokMediaIdentity(source);
            if (identity) identities.add(identity);
        }
        return identities;
    }

    resolveQualityRepeatTarget(preferredButton = null) {
        const buttons = this.findGenerateMoreButtons();
        if (preferredButton && buttons.includes(preferredButton)) {
            const scope = this.getQualityRepeatScope(preferredButton);
            if (!scope) return null;
            return { button: preferredButton, scope, buttons };
        }
        const matched = buttons.map((button) => {
            const scope = this.getQualityRepeatScope(button);
            if (!scope) return null;
            const identities = this.captureQualityRepeatIdentities(scope);
            const overlap = Array.from(identities).some((identity) => (
                this.qualityRepeatKnownIdentities.has(identity)
            ));
            return { button, scope, identities, overlap };
        }).filter((candidate) => candidate?.overlap);
        if (matched.length === 1) return { ...matched[0], buttons };
        return null;
    }

    async waitForGenerationComplete(baseline, timeout = 45000) {
        const startedAt = Date.now();
        let stableSignature = '';
        let stableSince = 0;
        while (Date.now() - startedAt < timeout) {
            if (!this.qualityRepeatRunning || !isExtensionContextActive()) {
                return { status: 'stopped', newIdentities: [] };
            }
            const target = this.resolveQualityRepeatTarget();
            if (target) {
                const current = this.captureQualityRepeatIdentities(target.scope);
                const newIdentities = Array.from(current).filter((identity) => !baseline.has(identity));
                if (newIdentities.length > 0 && this.isQualityRepeatButtonUsable(target.button)) {
                    const signature = Array.from(current).sort().join('|');
                    if (signature !== stableSignature) {
                        stableSignature = signature;
                        stableSince = Date.now();
                    } else if (Date.now() - stableSince >= 1000) {
                        return { status: 'accepted', newIdentities };
                    }
                } else {
                    stableSignature = '';
                    stableSince = 0;
                }
            }
            await this.sleep(250);
        }
        return { status: 'timeout', newIdentities: [] };
    }

    updateQualityRepeatUI(running, finalStatus = '') {
        if (!this.overlay || !this.overlay.el) return;
        const startBtn = this.overlay.el.querySelector('#gptQualityRepeatBtn');
        const stopBtn = this.overlay.el.querySelector('#gptQualityRepeatStopBtn');
        const statusEl = this.overlay.el.querySelector('#gptQualityRepeatStatus');
        if (startBtn) startBtn.style.display = running ? 'none' : '';
        if (stopBtn) stopBtn.style.display = running ? '' : 'none';
        if (statusEl) {
            if (running) {
                statusEl.textContent = 'Generating: ' + this.qualityRepeatGeneratedImages + ' new images (' + this.qualityRepeatCompleted + '/' + this.qualityRepeatTotal + ' repeats)';
            } else if (finalStatus) {
                statusEl.textContent = finalStatus;
            } else if (this.qualityRepeatCompleted > 0) {
                statusEl.textContent = 'Done: ' + this.qualityRepeatGeneratedImages + ' new images (' + this.qualityRepeatCompleted + '/' + this.qualityRepeatTotal + ' repeats)';
            } else {
                statusEl.textContent = '';
            }
        }
    }

    async startQualityRepeat(targetRepeats, preferredButton = null) {
        if (this.qualityRepeatRunning) return { status: 'already_running' };
        const initialTarget = this.resolveQualityRepeatTarget(preferredButton);
        if (!initialTarget) {
            this.safeStatus('Quality Repeat: Select a result with one unambiguous Generate More button', 'warning');
            return { status: 'target_ambiguous' };
        }
        const reservation = await startOwnedPageWorkflow('quality_repeat', {
            accepted: 0,
            failed: 0,
            pending: targetRepeats
        });
        if (!reservation.authority) {
            const blocker = reservation.activeWorkflow
                ? getMutatingWorkflowLabel(reservation.activeWorkflow.kind)
                : 'another workflow';
            this.safeStatus(`Quality Repeat blocked by ${blocker}`, 'warning');
            return { status: reservation.status, error: reservation.error };
        }
        this.qualityRepeatWorkflowAuthority = reservation.authority;
        this.qualityRepeatRunning = true;
        this.qualityRepeatTotal = targetRepeats;
        this.qualityRepeatCompleted = 0;
        this.qualityRepeatGeneratedImages = 0;
        this.qualityRepeatKnownIdentities = this.captureQualityRepeatIdentities(initialTarget.scope);
        this.qualityRepeatInlineContainer = preferredButton?.parentElement?.querySelector('.gpt-quality-repeat-inline') || null;
        this.qualityRepeatStopHeartbeat = startOwnedPageWorkflowHeartbeat(
            this.qualityRepeatWorkflowAuthority,
            () => ({
                accepted: this.qualityRepeatCompleted,
                failed: 0,
                pending: Math.max(0, this.qualityRepeatTotal - this.qualityRepeatCompleted)
            }),
            () => {
                this.qualityRepeatRunning = false;
            }
        );
        if (this.qualityRepeatInlineContainer) this._showOnPageProgress(this.qualityRepeatInlineContainer);
        this.updateQualityRepeatUI(true);
        this.safeStatus('Quality Repeat: Starting 0/' + targetRepeats, 'info');
        await this.overlay?.refreshActiveWorkflowStatus?.();

        let failure = '';
        try {
            while (this.qualityRepeatCompleted < this.qualityRepeatTotal && this.qualityRepeatRunning) {
                const authorized = await updateOwnedPageWorkflow(this.qualityRepeatWorkflowAuthority, {
                    accepted: this.qualityRepeatCompleted,
                    failed: failure ? 1 : 0,
                    pending: Math.max(0, this.qualityRepeatTotal - this.qualityRepeatCompleted)
                });
                if (!authorized) {
                    failure = 'workflow authority changed';
                    break;
                }
                const target = this.resolveQualityRepeatTarget();
                if (!target) {
                    failure = 'target became ambiguous';
                    break;
                }
                if (!location.href.includes('/imagine')) {
                    failure = 'navigated away from Imagine';
                    break;
                }
                const baseline = this.captureQualityRepeatIdentities(target.scope);
                if (baseline.size === 0) {
                    failure = 'result identity unavailable';
                    break;
                }
                const clicked = dispatchFullPointerClick(target.button);
                if (!clicked) {
                    failure = 'Generate More did not accept the click';
                    break;
                }
                const receipt = await this.waitForGenerationComplete(baseline);
                if (!this.qualityRepeatRunning || receipt.status === 'stopped') break;
                if (receipt.status !== 'accepted') {
                    failure = 'new result set was not verified';
                    break;
                }
                receipt.newIdentities.forEach((identity) => this.qualityRepeatKnownIdentities.add(identity));
                this.qualityRepeatGeneratedImages += receipt.newIdentities.length;
                this.qualityRepeatCompleted++;
                this.updateQualityRepeatUI(true);
                this.safeStatus('Quality Repeat: ' + this.qualityRepeatCompleted + '/' + this.qualityRepeatTotal, 'info');
                await this.sleep(1000);
            }

            const done = this.qualityRepeatCompleted >= this.qualityRepeatTotal;
            const stopped = !this.qualityRepeatRunning;
            this.qualityRepeatRunning = false;
            this.qualityRepeatStopHeartbeat?.();
            this.qualityRepeatStopHeartbeat = null;
            const finalStatus = done
                ? `Done: ${this.qualityRepeatGeneratedImages} new images (${this.qualityRepeatCompleted}/${this.qualityRepeatTotal} repeats)`
                : (failure
                    ? `Stopped: ${failure} (${this.qualityRepeatCompleted}/${this.qualityRepeatTotal} repeats)`
                    : `Stopped: ${this.qualityRepeatGeneratedImages} new images (${this.qualityRepeatCompleted}/${this.qualityRepeatTotal} repeats)`);
            this.updateQualityRepeatUI(false, finalStatus);
            if (done) {
                this.safeStatus(`Quality Repeat: Complete (${this.qualityRepeatGeneratedImages} new images)`, 'success');
            } else if (failure) {
                this.safeStatus(`Quality Repeat stopped: ${failure}`, 'error');
            } else {
                this.safeStatus(`Quality Repeat: Stopped (${this.qualityRepeatGeneratedImages} new images)`, 'neutral');
            }
            if (this.qualityRepeatWorkflowAuthority) {
                await finishOwnedPageWorkflow(
                    this.qualityRepeatWorkflowAuthority,
                    stopped || failure ? 'PAGE_WORKFLOW_STOP' : 'PAGE_WORKFLOW_COMPLETE'
                );
                this.qualityRepeatWorkflowAuthority = null;
            }
            return {
                status: done ? 'completed' : (failure ? 'failed' : 'stopped'),
                repeats: this.qualityRepeatCompleted,
                images: this.qualityRepeatGeneratedImages,
                error: failure
            };
        } finally {
            this.qualityRepeatStopHeartbeat?.();
            this.qualityRepeatStopHeartbeat = null;
            if (this.qualityRepeatWorkflowAuthority) {
                await finishOwnedPageWorkflow(this.qualityRepeatWorkflowAuthority, 'PAGE_WORKFLOW_STOP');
                this.qualityRepeatWorkflowAuthority = null;
            }
            this.updateOnPageButtons(false);
            await this.overlay?.refreshActiveWorkflowStatus?.();
        }
    }

    async stopQualityRepeat() {
        this.qualityRepeatRunning = false;
        this.qualityRepeatStopHeartbeat?.();
        this.qualityRepeatStopHeartbeat = null;
        if (this.qualityRepeatWorkflowAuthority) {
            await finishOwnedPageWorkflow(this.qualityRepeatWorkflowAuthority, 'PAGE_WORKFLOW_STOP');
            this.qualityRepeatWorkflowAuthority = null;
        }
        this.updateQualityRepeatUI(
            false,
            `Stopped: ${this.qualityRepeatGeneratedImages} new images (${this.qualityRepeatCompleted}/${this.qualityRepeatTotal} repeats)`
        );
        this.updateOnPageButtons(false);
        await this.overlay?.refreshActiveWorkflowStatus?.();
    }

    // --- On-page quick buttons next to "Generate More" ---

    injectQuickRepeatButtons(generateMoreBtn) {
        if (generateMoreBtn.parentElement.querySelector('.gpt-quality-repeat-inline')) return;

        const container = document.createElement('span');
        container.className = 'gpt-quality-repeat-inline';
        container.style.cssText = 'display:inline-flex; gap:4px; margin-left:8px; align-items:center;';
        this.qualityRepeatInlineSources.set(container, generateMoreBtn);
        this._buildQuickButtons(container, generateMoreBtn);
        generateMoreBtn.parentElement.appendChild(container);
    }

    _buildQuickButtons(container, sourceButton = null) {
        if (sourceButton) this.qualityRepeatInlineSources.set(container, sourceButton);
        while (container.firstChild) container.removeChild(container.firstChild);
        [2, 5, 10].forEach(count => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.textContent = 'x' + count;
            btn.style.cssText = 'padding:4px 10px; font-size:11px; font-weight:600; border-radius:9999px; border:none; cursor:pointer; background:rgba(139,92,246,0.15); color:#a78bfa; transition:background 0.2s;';
            btn.addEventListener('mouseenter', () => { btn.style.background = 'rgba(139,92,246,0.3)'; });
            btn.addEventListener('mouseleave', () => { btn.style.background = 'rgba(139,92,246,0.15)'; });
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const boundSource = this.qualityRepeatInlineSources.get(container);
                const localButtons = this.findGenerateMoreButtons(container.parentElement);
                const currentSource = this.isQualityRepeatButtonUsable(boundSource)
                    ? boundSource
                    : (localButtons.length === 1 ? localButtons[0] : null);
                if (currentSource) this.qualityRepeatInlineSources.set(container, currentSource);
                await this.startQualityRepeat(count, currentSource);
            });
            container.appendChild(btn);
        });
    }

    _showOnPageProgress(container) {
        while (container.firstChild) container.removeChild(container.firstChild);

        const status = document.createElement('span');
        status.className = 'gpt-qr-inline-status';
        status.style.cssText = 'font-size:11px; color:#a78bfa; font-weight:600;';
        status.textContent = 'Starting...';
        container.appendChild(status);

        const stopBtn = document.createElement('button');
        stopBtn.type = 'button';
        stopBtn.textContent = 'Stop';
        stopBtn.style.cssText = 'padding:2px 8px; font-size:11px; font-weight:600; border-radius:9999px; border:none; cursor:pointer; background:rgba(244,33,46,0.2); color:#f4212e; margin-left:6px;';
        stopBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            await this.stopQualityRepeat();
        });
        container.appendChild(stopBtn);

        const interval = setInterval(() => {
            if (!this.qualityRepeatRunning) {
                clearInterval(interval);
                this._buildQuickButtons(container, this.qualityRepeatInlineSources.get(container));
                return;
            }
            status.textContent = this.qualityRepeatCompleted + '/' + this.qualityRepeatTotal + '...';
        }, 500);
    }

    updateOnPageButtons(running) {
        const container = document.querySelector('.gpt-quality-repeat-inline');
        if (!container) return;
        if (!running) this._buildQuickButtons(container, this.qualityRepeatInlineSources.get(container));
    }

    sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
}

class TemplateBatchManager {
    constructor(toast, overlay = null) {
        this.toast = toast;
        this.overlay = overlay;
        this.running = false;
        this.aborted = false;
        this.count = 0;
        this.total = 0;
        this.failed = 0;
        this.workflowAuthority = null;
        this.stopHeartbeat = null;
        this.abortController = null;
        this.releaseDelay = null;
    }

    async readSubmissionReceipt(response) {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        if (response.status === 201 || response.status === 202 || response.status === 204) {
            return { status: response.status === 202 ? 'accepted' : 'created' };
        }
        const text = await response.text();
        if (!text.trim()) throw new Error('template_submission_unconfirmed');
        let payload;
        try {
            payload = JSON.parse(text);
        } catch {
            throw new Error('template_submission_invalid_response');
        }
        const records = [payload, payload?.data, payload?.result]
            .filter((value) => value && typeof value === 'object' && !Array.isArray(value));
        if (records.some((record) => record.success === false || record.error)) {
            throw new Error('template_submission_rejected');
        }
        const acceptedStatuses = new Set([
            'accepted', 'created', 'queued', 'running', 'processing', 'submitted', 'success'
        ]);
        const accepted = records.some((record) => (
            record.success === true
            || ['runId', 'jobId', 'responseId', 'id'].some((key) => (
                typeof record[key] === 'string' && record[key].trim()
            ))
            || acceptedStatuses.has(String(record.status || '').toLowerCase())
        ));
        if (!accepted) throw new Error('template_submission_unconfirmed');
        return { status: 'accepted' };
    }

    async start(templateId, imageUrl, count) {
        if (this.running) return { status: 'already_running' };
        const reservation = await startOwnedPageWorkflow('template_batch', {
            accepted: 0,
            failed: 0,
            pending: count
        });
        if (!reservation.authority) {
            const blocker = reservation.activeWorkflow
                ? getMutatingWorkflowLabel(reservation.activeWorkflow.kind)
                : 'another workflow';
            this.updateStatus(`Blocked by ${blocker}`);
            this.toast.show(`Template Batch blocked by ${blocker}`, 'error');
            return { status: reservation.status, error: reservation.error };
        }
        this.workflowAuthority = reservation.authority;
        this.running = true;
        this.aborted = false;
        this.count = 0;
        this.total = count;
        this.failed = 0;
        this.stopHeartbeat = startOwnedPageWorkflowHeartbeat(
            this.workflowAuthority,
            () => ({
                accepted: this.count,
                failed: this.failed,
                pending: Math.max(0, this.total - this.count - this.failed)
            }),
            () => {
                this.aborted = true;
                this.running = false;
                this.abortController?.abort();
                this.releaseDelay?.();
            }
        );
        this.updateStatus(`Starting 0/${count}...`);
        await this.overlay?.refreshActiveWorkflowStatus?.();

        try {
            for (let i = 0; i < count && this.running && !this.aborted; i++) {
                const authorized = await updateOwnedPageWorkflow(this.workflowAuthority, {
                    accepted: this.count,
                    failed: this.failed,
                    pending: Math.max(0, this.total - this.count - this.failed)
                });
                if (!authorized) {
                    this.aborted = true;
                    this.running = false;
                    this.updateStatus('Stopped: workflow authority changed');
                    break;
                }
                try {
                    this.abortController = new AbortController();
                    const resp = await fetch('https://grok.com/rest/media/pipeline/run', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        credentials: 'include',
                        signal: this.abortController.signal,
                        body: JSON.stringify({
                            templateId,
                            inputs: [{ name: 'photo', imageUrl }]
                        })
                    });
                    this.abortController = null;
                    if (!this.running || this.aborted) break;
                    await this.readSubmissionReceipt(resp);
                    this.count++;
                    this.updateStatus(`Submitted ${this.count}/${this.total}`);
                } catch (error) {
                    this.abortController = null;
                    if (this.aborted || error?.name === 'AbortError') break;
                    this.failed++;
                    this.updateStatus(`Failed ${this.failed}; submitted ${this.count}/${this.total}`);
                }
                if (i + 1 < count && this.running && !this.aborted) {
                    await this.waitBetweenSubmissions(2000);
                }
            }

            const stopped = this.aborted || !this.running;
            this.running = false;
            this.stopHeartbeat?.();
            this.stopHeartbeat = null;
            if (this.workflowAuthority) {
                await finishOwnedPageWorkflow(
                    this.workflowAuthority,
                    stopped ? 'PAGE_WORKFLOW_STOP' : 'PAGE_WORKFLOW_COMPLETE'
                );
                this.workflowAuthority = null;
            }
            if (stopped) {
                this.updateStatus(`Stopped: ${this.count}/${this.total} submitted`);
                this.toast.show(`Template batch stopped: ${this.count}/${this.total}`, 'neutral');
                return { status: 'stopped', submitted: this.count, failed: this.failed };
            }
            if (this.failed > 0 || this.count !== this.total) {
                this.updateStatus(`Finished: ${this.count}/${this.total} submitted, ${this.failed} failed`);
                this.toast.show(`Template batch finished with ${this.failed} failed`, 'error');
                return { status: 'partial', submitted: this.count, failed: this.failed };
            }
            this.updateStatus(`Done: ${this.count}/${this.total} submitted`);
            this.toast.show(`Template batch complete: ${this.count}/${this.total}`, 'success');
            return { status: 'completed', submitted: this.count, failed: 0 };
        } finally {
            this.stopHeartbeat?.();
            this.stopHeartbeat = null;
            this.abortController = null;
            this.releaseDelay?.();
            this.releaseDelay = null;
            if (this.workflowAuthority) {
                await finishOwnedPageWorkflow(this.workflowAuthority, 'PAGE_WORKFLOW_STOP');
                this.workflowAuthority = null;
            }
            await this.overlay?.refreshActiveWorkflowStatus?.();
        }
    }

    waitBetweenSubmissions(ms) {
        return new Promise((resolve) => {
            const timer = setTimeout(() => {
                this.releaseDelay = null;
                resolve();
            }, ms);
            this.releaseDelay = () => {
                clearTimeout(timer);
                this.releaseDelay = null;
                resolve();
            };
        });
    }

    async stop() {
        this.aborted = true;
        this.running = false;
        this.stopHeartbeat?.();
        this.stopHeartbeat = null;
        this.abortController?.abort();
        this.abortController = null;
        this.releaseDelay?.();
        this.updateStatus(`Stopped at ${this.count}/${this.total}`);
        if (this.workflowAuthority) {
            await finishOwnedPageWorkflow(this.workflowAuthority, 'PAGE_WORKFLOW_STOP');
            this.workflowAuthority = null;
        }
        await this.overlay?.refreshActiveWorkflowStatus?.();
    }

    updateStatus(text) {
        const el = document.querySelector('#gptTemplateBatchStatus');
        if (el) el.textContent = text;
    }
}

function isSensitiveRecreateDiagnosticKey(key) {
    const normalizedKey = String(key || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (normalizedKey === 'dataurl' || normalizedKey === 'reference') return true;

    return ['cookie', 'authheader', 'authorization', 'token', 'apikey', 'password', 'secret', 'bearer'].some(
        (substring) => normalizedKey.includes(substring)
    );
}

function scrubRecreateDiagnosticValue(value) {
    if (
        typeof value === 'string' &&
        (
            value.trimStart().startsWith('data:image/') ||
            value.trimStart().startsWith('data:video/')
        )
    ) return undefined;

    if (Array.isArray(value)) {
        return value.map((entry) => scrubRecreateDiagnosticValue(entry)).filter((entry) => typeof entry !== 'undefined');
    }

    if (value && typeof value === 'object') return scrubRecreateDiagnostics(value);
    return value;
}

function scrubRecreateDiagnostics(diagnostics) {
    const safe = {};

    Object.entries(diagnostics || {}).forEach(([key, value]) => {
        if (isSensitiveRecreateDiagnosticKey(key)) return;

        const scrubbed = scrubRecreateDiagnosticValue(value);
        if (typeof scrubbed !== 'undefined') safe[key] = scrubbed;
    });

    return safe;
}

class RecreateWorkflowContentBridge {
    constructor(overlay, historyManager, options = {}) {
        this.overlay = overlay;
        this.historyManager = historyManager;
        this.actions = options.actions || (typeof window !== 'undefined' ? window.GrokRecreateContentActions : null);
        this.chromeRuntime = options.chromeRuntime || getChromeRuntime();
        this.documentRef = options.documentRef || (typeof document !== 'undefined' ? document : null);
        this.locationRef = options.locationRef || (typeof window !== 'undefined' ? window.location : null);
        this.activeOperations = new Map();
        this.messageListener = null;
    }

    setupListeners() {
        if (!this.chromeRuntime || !this.chromeRuntime.onMessage || this.messageListener) return;

        const listener = (request, _sender, sendResponse) => {
            if (request.action === 'GPT_RECREATE_STATUS') {
                this.handleStatus(request);
                sendResponse({ ok: true, runId: request.runId });
                return false;
            }

            if (request.action === 'GPT_RECREATE_CANCEL') {
                const cancelled = this.cancelRunOperations(request);
                sendResponse({
                    ok: true,
                    acknowledged: true,
                    runId: request.runId,
                    cancelled
                });
                return false;
            }

            if (request.action === 'GPT_RECREATE_CHAT_STEP') {
                this.runAsyncStep(
                    (operationOptions) => this.getAction('runChatPromptStep')(request, operationOptions),
                    sendResponse,
                    request
                );
                return true;
            }

            if (request.action === 'GPT_RECREATE_IMAGINE_STEP') {
                this.runAsyncStep(async (operationOptions) => {
                    const response = await this.getAction('runImagineSubmitStep')(request, operationOptions);
                    if (response && response.ok && request.generatedPrompt) {
                        this.recordGeneratedPrompt(request.generatedPrompt, request.targetMode || request.referenceKind || response.mediaKind);
                    }
                    return response;
                }, sendResponse, request);
                return true;
            }

            if (request.action === 'GPT_RECREATE_IMAGINE_POST_VALIDATION_STEP') {
                this.runAsyncStep(
                    (operationOptions) => this.getAction('runImaginePostValidationStep')(request, operationOptions),
                    sendResponse,
                    request
                );
                return true;
            }

            return false;
        };
        this.messageListener = listener;

        if (this.chromeRuntime === getChromeRuntime()) {
            safeChromeAddListener(() => chrome.runtime.onMessage, listener, 'listen for recreate workflow messages');
            return;
        }

        this.chromeRuntime.onMessage.addListener(listener);
    }

    getOperationKey(request) {
        return [
            String(request?.runId || ''),
            Number.isInteger(request?.epoch) ? request.epoch : 0,
            String(request?.operationId || request?.action || '')
        ].join(':');
    }

    getOperationAuthority(request) {
        return {
            runId: String(request?.runId || ''),
            epoch: Number.isInteger(request?.epoch) ? request.epoch : 0,
            operationId: String(request?.operationId || request?.action || ''),
            phase: String(request?.phase || '')
        };
    }

    cancelRunOperations(request) {
        let cancelled = 0;
        for (const operation of this.activeOperations.values()) {
            if (operation.runId !== String(request?.runId || '')) continue;
            if (Number.isInteger(request?.epoch) && operation.epoch !== request.epoch) continue;
            if (!operation.controller.signal.aborted) {
                operation.controller.abort();
                cancelled++;
            }
        }
        return cancelled;
    }

    cancelAllOperations() {
        let cancelled = 0;
        for (const operation of this.activeOperations.values()) {
            if (!operation.controller.signal.aborted) {
                operation.controller.abort();
                cancelled++;
            }
        }
        this.activeOperations.clear();
        return cancelled;
    }

    handleStatus(request) {
        const message = request.phase && request.phase !== 'done'
            ? `${request.phase}: ${request.message || request.error || ''}`
            : (request.message || request.error || '');
        const type = request.type || 'info';

        if (this.overlay && typeof this.overlay.handleRecreateStatus === 'function') {
            this.overlay.handleRecreateStatus(request);
        } else if (this.overlay && typeof this.overlay.setRecreateStatus === 'function') {
            this.overlay.setRecreateStatus(message, type);
        } else if (this.overlay && typeof this.overlay.setStatus === 'function') {
            this.overlay.setStatus(message, type);
        }
    }

    getAction(name) {
        if (this.actions && typeof this.actions[name] === 'function') return this.actions[name];

        const error = new Error('workflow_unavailable');
        error.code = 'workflow_unavailable';
        throw error;
    }

    recordGeneratedPrompt(prompt, mediaKind = 'image') {
        if (this.historyManager && typeof this.historyManager.add === 'function') {
            this.historyManager.add(prompt, mediaKind === 'video' ? 'video' : 'image');
        }
    }

    runAsyncStep(fn, sendResponse, request) {
        const runId = String(request?.runId || '');
        const epoch = Number.isInteger(request?.epoch) ? request.epoch : 0;
        const operationKey = this.getOperationKey(request);
        const prior = this.activeOperations.get(operationKey);
        if (prior && !prior.controller.signal.aborted) prior.controller.abort();

        const controller = new AbortController();
        const operation = { runId, epoch, controller };
        this.activeOperations.set(operationKey, operation);
        (async () => {
            try {
                const response = await fn({
                    signal: controller.signal,
                    authority: this.getOperationAuthority(request)
                });
                if (controller.signal.aborted) {
                    const error = new Error('workflow_aborted');
                    error.code = 'workflow_aborted';
                    throw error;
                }
                sendResponse(response && typeof response === 'object' ? response : { ok: true, runId });
            } catch (error) {
                sendResponse({
                    ok: false,
                    runId,
                    phase: 'content',
                    error: (error && error.code) || 'workflow_failed',
                    diagnostics: {
                        ...scrubRecreateDiagnostics(error && error.diagnostics ? error.diagnostics : {}),
                        url: this.locationRef ? this.locationRef.href : '',
                        title: this.documentRef ? this.documentRef.title : ''
                    }
                });
            } finally {
                if (this.activeOperations.get(operationKey) === operation) {
                    this.activeOperations.delete(operationKey);
                }
            }
        })();
    }
}


function initializeGrokScraperState(scraper) {
    scraper.overlay = null;
    scraper.processedIds = new Set();
    scraper.processedLocalIds = new Set();
    scraper.processedR2Ids = new Set();
    scraper.legacyUnscopedProcessedIds = new Set();
    scraper.requiredDestinations = [];
    scraper.state = { isRunning: false, currentIndex: 0, mode: 'IDLE' };
    scraper.backupMode = false;
    scraper.backupOptions = { mode: 'full', limit: null, options: {} };
    scraper.backupStats = {
            totalSeen: 0,
            uploaded: 0,
            alreadyPresent: 0,
            queued: 0,
            pendingTransfers: 0,
            errors: 0
    };
    scraper._backupVisited = new Set();
    scraper._runVisited = new Set();
    scraper.syncEntryLimit = null;
    scraper._attemptedConversationIds = new Set();
    scraper._completedConversationIds = new Set();
    scraper._savedScanLedger = null;
    scraper._savedScanPhase = 'process';
    scraper._savedFirstPassOrder = [];
    scraper._savedVerificationOrder = [];
    scraper._savedVerificationVisited = new Set();
    scraper._savedVerificationRestarts = 0;
    scraper._savedScanNeedsRewind = true;
    scraper._scrapeFailures = new Map();
    scraper._listCoordinatorPromise = null;
    scraper.runToken = null;
    scraper.runEpoch = null;
    scraper.pendingNavigation = null;
    scraper._backupStartPending = false;
    scraper._pendingInitLease = null;
    scraper._runInvalidationVersion = 0;
    scraper._listenersRegistered = false;
    scraper._runStateWriteQueue = Promise.resolve();
    scraper._returnToSavedInFlight = null;
    scraper._activeStopReturn = null;
    scraper._lastStoppedRun = null;
    scraper.Config = { actionWait: 600, navWait: 800, surfaceWait: 10000, historyWait: 1500 };
    return scraper;
}

class GrokScraper {
    constructor() {
        initializeGrokScraperState(this);
        this.setupListeners();
        this._initPromise = this.init();
    }
    setOverlay(overlay) { this.overlay = overlay; }

    handleExtensionContextInvalidated() {
        this._backupStartPending = false;
        this.backupMode = false;
        this.state.isRunning = false;
        this.runToken = null;
        this.runEpoch = null;
        this.pendingNavigation = null;
        this.invalidateRunMemory();
        showExtensionContextRefreshed(this.overlay);
        return true;
    }

    ensureRunStateWriteQueue() {
        if (!this._runStateWriteQueue || typeof this._runStateWriteQueue.then !== 'function') {
            this._runStateWriteQueue = Promise.resolve();
        }
        return this._runStateWriteQueue;
    }

    getRunInvalidationVersion() {
        if (!Number.isInteger(this._runInvalidationVersion)) this._runInvalidationVersion = 0;
        return this._runInvalidationVersion;
    }

    matchesRunLease(runToken, runEpoch) {
        return Boolean(
            this.state.isRunning
            && runToken
            && Number.isInteger(runEpoch)
            && this.runToken === runToken
            && this.runEpoch === runEpoch
        );
    }

    queueRunStateWrite(values, operation, guard = null) {
        const writeGuard = guard ? {
            ...guard,
            invalidationVersion: Number.isInteger(guard.invalidationVersion)
                ? guard.invalidationVersion
                : this.getRunInvalidationVersion(),
            kind: guard.kind || (this.backupMode ? 'r2_backup' : 'sync'),
            timeoutMs: Number.isFinite(guard.timeoutMs)
                ? Math.max(0, guard.timeoutMs)
                : SCRAPE_RUN_STATE_WRITE_TIMEOUT_MS
        } : null;
        const isCurrent = () => Boolean(
            writeGuard
            && this.getRunInvalidationVersion() === writeGuard.invalidationVersion
            && this.matchesRunLease(writeGuard.runToken, writeGuard.runEpoch)
        );
        const write = this.ensureRunStateWriteQueue().then(async () => {
            if (!isCurrent()) {
                return { ok: false, invalidated: false, skipped: true, operation };
            }
            if (Number.isFinite(writeGuard.deadline) && Date.now() >= writeGuard.deadline) {
                return { ok: false, invalidated: false, skipped: true, timedOut: true, operation };
            }
            const deadlineAt = Math.min(
                Number.isFinite(writeGuard.deadline) ? writeGuard.deadline : Number.POSITIVE_INFINITY,
                Date.now() + writeGuard.timeoutMs
            );
            const responsePromise = safeChromeRuntimeSendMessage({
                action: 'SCRAPE_RUN_STATE_WRITE',
                runToken: writeGuard.runToken,
                runEpoch: writeGuard.runEpoch,
                kind: writeGuard.kind,
                deadlineAt,
                values
            }, operation);
            let timeoutId = null;
            const timeout = Symbol('scrape_run_state_write_timeout');
            const response = await Promise.race([
                responsePromise,
                new Promise((resolve) => {
                    timeoutId = setTimeout(
                        () => resolve(timeout),
                        Math.max(0, deadlineAt - Date.now())
                    );
                })
            ]);
            if (timeoutId !== null) clearTimeout(timeoutId);
            if (!isCurrent()) {
                return { ok: false, invalidated: false, skipped: true, operation };
            }
            if (Number.isFinite(writeGuard.deadline) && Date.now() >= writeGuard.deadline) {
                return { ok: false, invalidated: false, skipped: true, timedOut: true, operation };
            }
            if (response === timeout) {
                return { ok: false, invalidated: false, skipped: true, timedOut: true, operation };
            }
            if (response.invalidated) return response;
            return {
                ok: response.value?.status === 'ok',
                invalidated: false,
                skipped: response.value?.status !== 'ok',
                operation,
                reason: response.value?.reason
            };
        });
        this._runStateWriteQueue = write.catch(() => {});
        return write;
    }

    async queueCriticalRunStateWrite(values, operation, guard) {
        let result = null;
        for (let attempt = 0; attempt < 2; attempt++) {
            result = await this.queueRunStateWrite(values, operation, {
                ...guard,
                timeoutMs: SCRAPE_CRITICAL_RUN_STATE_WRITE_TIMEOUT_MS
            });
            if (
                result.ok
                || result.invalidated
                || !this.matchesRunLease(guard.runToken, guard.runEpoch)
            ) return result;
            if (attempt === 0) await this.sleep(100);
        }
        return result;
    }

    invalidateRunMemory() {
        this._runInvalidationVersion = this.getRunInvalidationVersion() + 1;
        this._backupStartPending = false;
        this._pendingInitLease = null;
        this.backupMode = false;
        this.backupOptions = { mode: 'full', limit: null, options: {} };
        this.state.isRunning = false;
        this.state.mode = 'IDLE';
        this.state.currentIndex = 0;
        this.runToken = null;
        this.runEpoch = null;
        this.pendingNavigation = null;
        this.requiredDestinations = [];
        this._runVisited = new Set();
        this.syncEntryLimit = null;
        this._attemptedConversationIds = new Set();
        this._completedConversationIds = new Set();
        this._backupVisited = new Set();
        this._savedScanLedger = null;
        this._savedScanPhase = 'process';
        this._savedFirstPassOrder = [];
        this._savedVerificationOrder = [];
        this._savedVerificationVisited = new Set();
        this._savedVerificationRestarts = 0;
        this._savedScanNeedsRewind = true;
        this._scrapeFailures = new Map();
        this._listCoordinatorPromise = null;
    }

    async clearStaleRunState(stopReason = 'stale_session') {
        this.invalidateRunMemory();
        this.log(`Scrape session cleared in this tab (${stopReason}).`, 'neutral');
    }

    async init() {
        const initInvalidationVersion = this.getRunInvalidationVersion();
        const storedResult = await safeChromeStorageGet('local', [
            'scraperState',
            'currentIndex',
            'processedIds',
            'processedLocalIds',
            'processedR2Ids',
            'scrapeRunToken',
            'scrapeRunEpoch',
            'scrapeNavigation',
            'scrapeFailures',
            'scrapeBackupOptions',
            'isR2Backup',
            'r2BackupState',
            'scrapeDestinations',
            'scrapeEntryLimitState'
        ], {}, 'load scraper state');
        if (storedResult.invalidated) {
            this.handleExtensionContextInvalidated();
            return;
        }
        if (this.getRunInvalidationVersion() !== initInvalidationVersion) return;
        const activeStateResult = await safeChromeRuntimeSendMessage({
            action: 'GET_ACTIVE_SCRAPE_RUN_STATE'
        }, 'load active scrape state');
        if (activeStateResult.invalidated) {
            this.handleExtensionContextInvalidated();
            return;
        }
        if (this.getRunInvalidationVersion() !== initInvalidationVersion) return;
        const activeState = activeStateResult.value?.status === 'ok'
            && activeStateResult.value.state
            && typeof activeStateResult.value.state === 'object'
            ? activeStateResult.value.state
            : null;
        const stored = activeState ? { ...storedResult.value, ...activeState } : storedResult.value;
        if (stored.processedIds) {
            this.processedIds = new Set(stored.processedIds);
            console.log(`Loaded ${this.processedIds.size} processed items.`);
        }
        this.processedLocalIds = new Set(
            Array.isArray(stored.processedLocalIds) ? stored.processedLocalIds : []
        );
        this.processedR2Ids = new Set(
            Array.isArray(stored.processedR2Ids) ? stored.processedR2Ids : []
        );
        this.rebuildLegacyUnscopedProcessedIds();
        this.state.isRunning = stored.scraperState === 'running';
        this.state.currentIndex = stored.currentIndex || 0;
        this.runToken = stored.scrapeRunToken || null;
        this.runEpoch = Number.isInteger(stored.scrapeRunEpoch) ? stored.scrapeRunEpoch : null;
        this.pendingNavigation = stored.scrapeNavigation || null;
        this._scrapeFailures = new Map(
            (Array.isArray(stored.scrapeFailures) ? stored.scrapeFailures : [])
                .filter((failure) => (
                    failure
                    && typeof failure.key === 'string'
                    && failure.key.length > 0
                    && failure.key.length <= 512
                ))
                .map((failure) => [failure.key, { ...failure }])
        );
        this.backupMode = stored.isR2Backup === true;
        const entryLimitState = this.backupMode
            ? null
            : normalizeSyncEntryLimitState(stored.scrapeEntryLimitState);
        this.syncEntryLimit = entryLimitState?.entryLimit || null;
        this._attemptedConversationIds = new Set(entryLimitState?.attemptedConversationIds || []);
        this._completedConversationIds = new Set(entryLimitState?.completedConversationIds || []);
        if (this.syncEntryLimit) {
            this.state.currentIndex = this._attemptedConversationIds.size;
            for (const conversationId of this._completedConversationIds) {
                this._runVisited.add(`conversation:${conversationId}`);
            }
        }
        this.requiredDestinations = normalizeScrapeDestinations(stored.scrapeDestinations);
        if (this.backupMode && !this.requiredDestinations.length) this.requiredDestinations = ['r2'];
        if (this.backupMode) {
            this.backupOptions = stored.scrapeBackupOptions || this.backupOptions;
            this.backupStats = {
                ...this.backupStats,
                ...(stored.r2BackupState || {})
            };
        }

        if (this.state.isRunning) {
            const validationResult = this.runToken && Number.isInteger(this.runEpoch)
                ? await safeChromeRuntimeSendMessage({
                    action: 'VALIDATE_SCRAPE_RESUME',
                    runToken: this.runToken,
                    runEpoch: this.runEpoch,
                    kind: this.backupMode ? 'r2_backup' : 'sync'
                }, 'validate scrape resume')
                : { invalidated: false, value: { valid: false } };
            if (validationResult.invalidated) {
                this.handleExtensionContextInvalidated();
                return;
            }
            if (!validationResult.value?.valid) {
                await this.clearStaleRunState('stale_session');
            }
        }
        if (this.state.isRunning) this._savedScanLedger = createSavedScanLedger();

        // --- USER IDENTIFICATION LOGIC (Restored) ---
        try {
            const pfpImg = document.querySelector('img[alt="pfp"]');
            if (pfpImg && pfpImg.src) {
                const parts = pfpImg.src.split('users/');
                if (parts.length > 1) {
                    const userId = parts[1].split('/')[0];
                    if (userId && userId.length > 5) {
                        safeChromeStorageGet('local', ['activeGrokUserId'], {}, 'load active Grok user').then((res) => {
                            if (res.invalidated) return this.handleExtensionContextInvalidated();
                            if (res.value.activeGrokUserId !== userId) {
                                console.log('Switching Account Context to:', userId);
                                safeChromeStorageSet('local', { activeGrokUserId: userId }, 'save active Grok user').then((result) => {
                                    if (result.invalidated) this.handleExtensionContextInvalidated();
                                }).catch(() => {});
                            }
                        }).catch(() => {});
                    }
                }
            }
        } catch { }

        if (this.state.isRunning) {
            console.log(`Resuming Scraper. Index: ${this.state.currentIndex}`);
            Promise.resolve(this.determineModeAndExecute(this.runToken, this.runEpoch)).catch((error) => {
                if (this.state.isRunning) this.failRun(error.message || 'Scrape resume failed.', 'resume_failed');
            });
        }

        this.setupListeners();
    }

    setupListeners() {
        if (this._listenersRegistered) return;
        this._listenersRegistered = true;
        safeChromeAddListener(() => chrome.runtime.onMessage, (request, sender, sendResponse) => {
            if (request.action === 'INIT_SCRAPE') {
                const pendingLease = {
                    kind: 'sync',
                    runToken: request.runToken,
                    runEpoch: request.runEpoch,
                    invalidationVersion: this.getRunInvalidationVersion()
                };
                this._pendingInitLease = pendingLease;
                Promise.resolve(this._initPromise).then(() => {
                    if (
                        this._pendingInitLease !== pendingLease
                        || pendingLease.invalidationVersion !== this.getRunInvalidationVersion()
                    ) return { status: 'error', surface: this.getCurrentSurface(), error: 'Start was cancelled.' };
                    this._pendingInitLease = null;
                    return this.start(request);
                }).then(sendResponse, (error) => {
                    sendResponse({ status: 'error', surface: this.getCurrentSurface(), error: error.message });
                });
                return true;
            } else if (request.action === 'ABORT_SCRAPE') {
                const stop = () => this.stop('stopped', {
                    notifyBackground: false,
                    expectedRunToken: request.runToken,
                    expectedRunEpoch: request.runEpoch,
                    stopNavigation: request.stopNavigation || null
                });
                const stopping = request.stopNavigation
                    ? stop()
                    : Promise.resolve(this._initPromise).then(stop);
                Promise.resolve(stopping).then(sendResponse, (error) => {
                    sendResponse({ status: 'error', error: error.message });
                });
                return true;
            } else if (request.action === 'INIT_R2_BACKUP') {
                const pendingLease = {
                    kind: 'r2_backup',
                    runToken: request.runToken,
                    runEpoch: request.runEpoch,
                    invalidationVersion: this.getRunInvalidationVersion()
                };
                this._pendingInitLease = pendingLease;
                Promise.resolve(this._initPromise).then(() => {
                    if (
                        this._pendingInitLease !== pendingLease
                        || pendingLease.invalidationVersion !== this.getRunInvalidationVersion()
                    ) return { status: 'error', surface: this.getCurrentSurface(), error: 'Start was cancelled.' };
                    this._pendingInitLease = null;
                    return this.startBackupMode(request);
                }).then(sendResponse, (error) => {
                    sendResponse({ status: 'error', surface: this.getCurrentSurface(), error: error.message });
                });
                return true;
            } else if (request.action === 'ABORT_R2_BACKUP') {
                const stop = () => this.stopBackupMode('stopped', {
                    notifyBackground: false,
                    expectedRunToken: request.runToken,
                    expectedRunEpoch: request.runEpoch,
                    stopNavigation: request.stopNavigation || null
                });
                const stopping = request.stopNavigation
                    ? stop()
                    : Promise.resolve(this._initPromise).then(stop);
                Promise.resolve(stopping).then(sendResponse, (error) => {
                    sendResponse({ status: 'error', error: error.message });
                });
                return true;
            } else if (request.action === 'RESET_PROCESSED_IDS') {
                this.processedIds = new Set();
                this.processedLocalIds = new Set();
                this.processedR2Ids = new Set();
                this.legacyUnscopedProcessedIds = new Set();
                console.log('Processed IDs cleared in-memory.');
                sendResponse({ status: 'cleared', size: 0 });
            }
            return false;
        }, 'listen for scraper messages');

        // Fallback stop signal via storage.onChanged. chrome.tabs.sendMessage can be
        // dropped silently (stale currentTabId, invalidated context, etc.), leaving the
        // scraper running after a Stop click. Storage-change events always reach every
        // context, so this catches stops the direct-message path misses.
        safeChromeAddListener(() => chrome.storage.onChanged, (changes, area) => {
            if (area !== 'local') return;
            if (Array.isArray(changes.processedIds?.newValue)) {
                this.processedIds = new Set(changes.processedIds.newValue);
            }
            if (Array.isArray(changes.processedLocalIds?.newValue)) {
                this.processedLocalIds = new Set(changes.processedLocalIds.newValue);
            }
            if (Array.isArray(changes.processedR2Ids?.newValue)) {
                this.processedR2Ids = new Set(changes.processedR2Ids.newValue);
            }
            if (changes.processedIds || changes.processedLocalIds || changes.processedR2Ids) {
                this.rebuildLegacyUnscopedProcessedIds();
            }
            const pendingBackup = this._backupStartPending || this._pendingInitLease?.kind === 'r2_backup';
            const stopSignal = shouldStopScraperForStorageChanges(changes, this.backupMode || pendingBackup);
            const hasRunAuthority = this.state.isRunning
                || this._backupStartPending
                || Boolean(this._pendingInitLease)
                || Boolean(this.runToken)
                || Number.isInteger(this.runEpoch)
                || Boolean(changes.scrapeNavigation?.oldValue);
            if (stopSignal && hasRunAuthority) {
                console.log('GrokScraper: stop signal received via storage.onChanged');
                const storedNavigation = changes.scrapeNavigation?.oldValue || null;
                const stopBackup = this.backupMode
                    || pendingBackup
                    || changes.isR2Backup?.oldValue === true
                    || changes.r2BackupState?.oldValue?.isRunning === true;
                const expectedRunToken = this.runToken
                    || this._pendingInitLease?.runToken
                    || storedNavigation?.runToken;
                const expectedRunEpoch = Number.isInteger(this.runEpoch)
                    ? this.runEpoch
                    : (Number.isInteger(this._pendingInitLease?.runEpoch)
                        ? this._pendingInitLease.runEpoch
                        : storedNavigation?.runEpoch);
                const pendingOnly = !this.state.isRunning
                    && !this.runToken
                    && Boolean(this._pendingInitLease || this._backupStartPending);
                if (pendingOnly) {
                    this.invalidateRunMemory();
                    this._lastStoppedRun = {
                        runToken: expectedRunToken,
                        runEpoch: expectedRunEpoch,
                        cleanupPromise: Promise.resolve(false)
                    };
                    return;
                }
                const options = {
                    notifyBackground: false,
                    expectedRunToken,
                    expectedRunEpoch,
                    stopNavigation: storedNavigation
                };
                const stopping = stopBackup
                    ? this.stopBackupMode('stopped', options)
                    : this.stop('stopped', options);
                Promise.resolve(stopping).catch(() => {});
            }
        }, 'listen for scraper stop signals');

        // Page-world bridge: allows triggering actions via DOM CustomEvents
        // (useful for browser automation tools that run in the page context)
        document.addEventListener('grok-powertools-command', (e) => {
            this.handlePageCommand(e.detail);
        });
    }

    handlePageCommand(detail = {}) {
        const command = detail && typeof detail === 'object' ? detail : {};
        const action = command.action;
        const backupOptions = getR2BackupPageCommandOptions(command);

        if (backupOptions) {
            safeChromeRuntimeSendMessageSoon({ action: 'START_R2_BACKUP', ...backupOptions }, 'start page-command R2 backup');
        } else if (action === 'INIT_R2_BACKUP') {
            console.warn('[GrokScraper] ignored page-origin R2 backup command without canary mode');
        } else if (action === 'ABORT_R2_BACKUP') {
            safeChromeRuntimeSendMessageSoon({
                action: 'STOP_R2_BACKUP',
                runToken: this.runToken || this._pendingInitLease?.runToken || null,
                runEpoch: Number.isInteger(this.runEpoch)
                    ? this.runEpoch
                    : this._pendingInitLease?.runEpoch,
                kind: 'r2_backup'
            }, 'stop page-command R2 backup');
        } else if (action === 'INIT_SCRAPE') {
            safeChromeRuntimeSendMessageSoon({ action: 'START_SCRAPE' }, 'start page-command scrape');
        } else if (action === 'ABORT_SCRAPE') {
            safeChromeRuntimeSendMessageSoon({
                action: 'STOP_SCRAPE',
                runToken: this.runToken || this._pendingInitLease?.runToken || null,
                runEpoch: Number.isInteger(this.runEpoch)
                    ? this.runEpoch
                    : this._pendingInitLease?.runEpoch,
                kind: 'sync'
            }, 'stop page-command scrape');
        } else if (action === 'RESET_PROCESSED_IDS') {
            this.processedIds = new Set();
            this.processedLocalIds = new Set();
            this.processedR2Ids = new Set();
            this.legacyUnscopedProcessedIds = new Set();
            safeChromeRuntimeSendMessageSoon({ action: 'PROCESSED_IDS_RESET' }, 'reset processed IDs');
            console.log('[GrokScraper] processedIds cleared via custom event');
        }
    }

    getCleanId(url) { if (!url) return null; try { return url.split('?')[0]; } catch { return url; } }

    getProcessedIdentityCandidates(value) {
        const stableId = getGrokMediaIdentity(value);
        const canonicalAssetId = /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(stableId)
            ? `media_${stableId}`
            : '';
        return Array.from(new Set([
            this.getCleanId(value),
            stableId,
            canonicalAssetId
        ].filter(Boolean)));
    }

    isMediaProcessed(value) {
        return this.getProcessedIdentityCandidates(value).some((id) => this.processedIds.has(id));
    }

    rebuildLegacyUnscopedProcessedIds() {
        const scoped = new Set([
            ...this.processedLocalIds,
            ...this.processedR2Ids
        ]);
        this.legacyUnscopedProcessedIds = new Set(
            Array.from(this.processedIds).filter((id) => !scoped.has(id))
        );
    }

    hasDestinationReceipt(value, destination) {
        const candidates = this.getProcessedIdentityCandidates(value);
        if (!candidates.length) return false;
        const destinationSet = destination === 'r2'
            ? this.processedR2Ids
            : this.processedLocalIds;
        return candidates.some((id) => (
            destinationSet.has(id)
            || (destination === 'local' && this.legacyUnscopedProcessedIds.has(id))
        ));
    }

    isAssetDestinationSatisfied(value) {
        return this.requiredDestinations.length > 0
            && this.requiredDestinations.every((destination) => (
                this.hasDestinationReceipt(value, destination)
            ));
    }

    async loadCurrentSyncDestinations(runToken = this.runToken) {
        const configResult = await safeChromeRuntimeSendMessage(
            { action: 'GET_CLOUD_CONFIG' },
            'load Sync destination mode'
        );
        if (configResult.invalidated) {
            this.handleExtensionContextInvalidated();
            return null;
        }
        if (runToken && !this.isRunActive(runToken)) return null;
        return getSyncDestinationsForCloudMode(configResult.value?.config?.mode);
    }

    async ensureRunDestinationContract(runToken = this.runToken) {
        if (!this.isRunActive(runToken)) return false;
        if (this.backupMode) {
            if (!this.requiredDestinations.length) this.requiredDestinations = ['r2'];
            return scrapeDestinationsMatch(this.requiredDestinations, ['r2']);
        }
        const currentDestinations = await this.loadCurrentSyncDestinations(runToken);
        if (!currentDestinations || !this.isRunActive(runToken)) return false;
        if (!this.requiredDestinations.length) {
            this.requiredDestinations = currentDestinations;
            const result = await this.queueRunStateWrite({
                scrapeDestinations: this.requiredDestinations
            }, 'bind resumed Sync destinations', { runToken, runEpoch: this.runEpoch });
            if (result.invalidated) this.handleExtensionContextInvalidated();
            return result.ok && this.isRunActive(runToken);
        }
        if (scrapeDestinationsMatch(this.requiredDestinations, currentDestinations)) return true;
        await this.failRun(
            'Backup Mode changed while Sync was running. Restore the original mode before restarting.',
            'sync_destination_drift'
        );
        return false;
    }

    getCurrentSurface() {
        return detectGrokScrapeSurface(document, window.location);
    }

    getSavedGalleryScope() {
        return detectSavedGalleryScope(document);
    }

    getSavedGalleryScopeDrift(scope = this.getSavedGalleryScope()) {
        if (scope === SAVED_GALLERY_SCOPES.all) return null;
        return {
            scope,
            error: scope === SAVED_GALLERY_SCOPES.liked
                ? 'Saved scope changed to Liked. Switch Grok Saved to All before continuing.'
                : 'Could not verify Grok Saved scope. Switch Grok Saved to All before continuing.'
        };
    }

    async waitForSavedGalleryScope(runToken = this.runToken, runEpoch = this.runEpoch) {
        let scope = this.getSavedGalleryScope();
        if (scope !== SAVED_GALLERY_SCOPES.unknown) return scope;

        const startedAt = Date.now();
        while (
            this.isRunActive(runToken, runEpoch)
            && Date.now() - startedAt < this.Config.surfaceWait
        ) {
            await this.sleep(100);
            scope = this.getSavedGalleryScope();
            if (scope !== SAVED_GALLERY_SCOPES.unknown) return scope;
        }
        return scope;
    }

    async ensureSavedGalleryAllScope(runToken = this.runToken, runEpoch = this.runEpoch) {
        if (!this.isRunActive(runToken, runEpoch)) return false;
        const scope = await this.waitForSavedGalleryScope(runToken, runEpoch);
        if (!this.isRunActive(runToken, runEpoch)) return false;
        const drift = this.getSavedGalleryScopeDrift(scope);
        if (!drift) return true;
        await this.failRun(drift.error, 'saved_scope_drift');
        return false;
    }

    async abortStartForSavedGalleryScopeDrift(kind, runToken, runEpoch, surface, drift) {
        this.log(drift.error, 'error');
        const options = { expectedRunToken: runToken, expectedRunEpoch: runEpoch };
        if (kind === 'r2_backup') {
            await this.stopBackupMode('saved_scope_drift', options);
        } else {
            await this.stop('saved_scope_drift', options);
        }
        return { status: 'invalid_context', surface, scope: drift.scope, error: drift.error };
    }

    isRunActive(runToken = this.runToken, runEpoch = this.runEpoch) {
        return isExtensionContextActive() && this.matchesRunLease(runToken, runEpoch);
    }

    getGalleryScroller() {
        return getSavedGalleryContext(document)?.scroller || window;
    }

    getScrollerSnapshot(scroller) {
        return getSavedScrollerSnapshot(scroller);
    }

    getGalleryCardSignature() {
        const context = getSavedGalleryContext(document);
        return (context?.entries || [])
            .map((entry) => entry.cardIdentity)
            .filter(Boolean)
            .join('|');
    }

    getSavedScanLedger() {
        if (!this._savedScanLedger) this._savedScanLedger = createSavedScanLedger();
        return this._savedScanLedger;
    }

    async processUniqueCanaryTarget({
        runToken,
        targetIdentity,
        targetMediaType,
        targetLabel,
        galleryContext
    }) {
        const runEpoch = this.runEpoch;
        if (!this.isRunActive(runToken, runEpoch)) return true;
        const failCurrentRun = async (message, stopReason) => {
            if (!this.isRunActive(runToken, runEpoch)) return false;
            await this.failRun(message, stopReason);
            return true;
        };
        let currentContext = galleryContext;
        let matches = (galleryContext?.entries || [])
            .map((entry, index) => ({ entry, index }))
            .filter(({ entry }) => entry.sourceIdentity === targetIdentity);
        if (matches.length > 1) {
            await failCurrentRun(
                `Canary target ${targetLabel} is ambiguous in Saved.`,
                'canary_target_ambiguous'
            );
            return true;
        }
        if (matches.length === 0) return false;

        let { entry, index } = matches[0];
        let actualMediaType = getSavedGalleryEntryMediaType(entry);
        for (
            let attempt = 0;
            targetMediaType && !actualMediaType && attempt < CANARY_TARGET_TYPE_SETTLE_ATTEMPTS;
            attempt++
        ) {
            await this.sleep(CANARY_TARGET_TYPE_SETTLE_INTERVAL_MS);
            if (!this.isRunActive(runToken, runEpoch)) return true;
            if (this.getCurrentSurface() !== SCRAPE_SURFACES.savedGallery) {
                await failCurrentRun(
                    `Canary target ${targetLabel} left Saved before its media type could be verified.`,
                    'canary_target_seek_failed'
                );
                return true;
            }
            if (!await this.ensureSavedGalleryAllScope(runToken, runEpoch)) return true;
            if (!this.isRunActive(runToken, runEpoch)) return true;

            const refreshedContext = getSavedGalleryContext(document);
            currentContext = refreshedContext;
            matches = (refreshedContext?.entries || [])
                .map((candidate, candidateIndex) => ({ entry: candidate, index: candidateIndex }))
                .filter(({ entry: candidate }) => candidate.sourceIdentity === targetIdentity);
            if (matches.length > 1) {
                await failCurrentRun(
                    `Canary target ${targetLabel} is ambiguous in Saved.`,
                    'canary_target_ambiguous'
                );
                return true;
            }
            if (matches.length === 0) continue;
            ({ entry, index } = matches[0]);
            actualMediaType = getSavedGalleryEntryMediaType(entry);
        }
        if (!this.isRunActive(runToken, runEpoch)) return true;
        if (targetMediaType && !actualMediaType) {
            if (matches.length === 0) {
                await failCurrentRun(
                    `Could not reacquire canary target ${targetLabel} in Saved.`,
                    'canary_target_seek_failed'
                );
            } else {
                await failCurrentRun(
                    `Could not verify whether canary target ${targetLabel} is an image or video.`,
                    'canary_target_type_unknown'
                );
            }
            return true;
        }
        if (targetMediaType && actualMediaType !== targetMediaType) {
            await failCurrentRun(
                `Canary target ${targetLabel} is ${actualMediaType}, expected ${targetMediaType}.`,
                'canary_target_type_mismatch'
            );
            return true;
        }

        const cleanId = this.getCleanId(entry.sourceUrl);
        if (!cleanId) {
            await failCurrentRun(
                `Could not identify canary target ${targetLabel} in Saved.`,
                'canary_target_seek_failed'
            );
            return true;
        }
        if (!this.isRunActive(runToken, runEpoch)) return true;
        const expectedNextIdentity = currentContext?.entries?.[index + 1]?.cardIdentity || null;
        this.log(`new item: ...${cleanId.slice(-6)}`, 'success');
        const outcome = await this.processItem(
            entry.image,
            cleanId,
            runToken,
            runEpoch,
            expectedNextIdentity
        );
        return outcome?.status ? outcome : true;
    }

    async queryRunDurabilitySnapshot(runToken = this.runToken) {
        const runEpoch = this.runEpoch;
        const kind = this.backupMode ? 'r2_backup' : 'sync';
        const timeout = Symbol('scrape_durability_query_timeout');
        let timeoutId = null;
        let result;
        try {
            result = await Promise.race([
                safeChromeRuntimeSendMessage({
                    action: 'GET_SCRAPE_DURABILITY',
                    runToken,
                    runEpoch,
                    kind
                }, 'probe scrape durability'),
                new Promise((resolve) => {
                    timeoutId = setTimeout(() => resolve(timeout), 1000);
                })
            ]);
        } catch {
            return this.isRunActive(runToken, runEpoch)
                ? { status: 'pending', reason: 'query_failed' }
                : { status: 'ignored', reason: 'stale_authority' };
        } finally {
            if (timeoutId !== null) clearTimeout(timeoutId);
        }
        if (!this.isRunActive(runToken, runEpoch)) return { status: 'ignored', reason: 'stale_authority' };
        if (result === timeout) return { status: 'pending', reason: 'query_timeout' };
        if (result.invalidated) return { status: 'ignored', reason: 'context_invalidated' };
        return result.value && typeof result.value === 'object'
            ? result.value
            : { status: 'pending', reason: 'missing_response' };
    }

    async start(options = {}) {
        const surface = this.getCurrentSurface();
        if (surface !== SCRAPE_SURFACES.savedGallery) {
            const error = 'Open Grok Imagine Saved before starting sync.';
            this.log(error, 'error');
            return { status: 'invalid_context', surface, error };
        }
        const scope = this.getSavedGalleryScope();
        if (scope !== SAVED_GALLERY_SCOPES.all) {
            const error = 'Switch Grok Saved to All before starting.';
            this.log(error, 'error');
            return { status: 'invalid_context', surface, scope, error };
        }
        if (this.state.isRunning) {
            return { status: 'error', surface, error: 'Sync is already running.' };
        }
        const runToken = typeof options.runToken === 'string' ? options.runToken : '';
        const runEpoch = Number.isInteger(options.runEpoch) ? options.runEpoch : null;
        if (!runToken || runEpoch === null) {
            return { status: 'error', surface, error: 'Background run lease is missing.' };
        }
        const startInvalidationVersion = this.getRunInvalidationVersion();

        this.log('Scraping initialized.', 'success');
        this.state.isRunning = true;
        this.state.currentIndex = 0;
        this.runToken = runToken;
        this.runEpoch = runEpoch;
        this.pendingNavigation = null;
        this.backupMode = false;
        this.syncEntryLimit = normalizeSyncEntryLimit(options.entryLimit);
        this._attemptedConversationIds = new Set();
        this._completedConversationIds = new Set();
        this.requiredDestinations = await this.loadCurrentSyncDestinations(runToken);
        if (!this.requiredDestinations || !this.isRunActive(runToken, runEpoch)) {
            if (this.runToken === runToken && this.runEpoch === runEpoch) this.invalidateRunMemory();
            return { status: 'error', surface, error: 'Could not bind Sync to its destination mode.' };
        }
        this._runVisited = new Set();
        this._savedScanLedger = createSavedScanLedger();
        this._savedScanPhase = 'process';
        this._savedFirstPassOrder = [];
        this._savedVerificationOrder = [];
        this._savedVerificationVisited = new Set();
        this._savedVerificationRestarts = 0;
        this._savedScanNeedsRewind = true;
        this._scrapeFailures = new Map();
        const result = await this.queueRunStateWrite({
            scraperState: 'running',
            currentIndex: 0,
            scrapeRunToken: runToken,
            scrapeRunEpoch: runEpoch,
            scrapeNavigation: null,
            currentItemId: null,
            scrapeFailures: [],
            scrapeBackupOptions: null,
            scrapeEntryLimitState: this.syncEntryLimit ? {
                version: 2,
                entryLimit: this.syncEntryLimit,
                attemptedConversationIds: [],
                completedConversationIds: []
            } : null,
            scrapeDestinations: this.requiredDestinations,
            isScraping: true,
            isR2Backup: false
        }, 'start scrape', { runToken, runEpoch });
        if (result.invalidated) {
            this.handleExtensionContextInvalidated();
            return { status: 'error', surface, error: EXTENSION_CONTEXT_REFRESHED_MESSAGE };
        }
        let scopeDrift = this.getSavedGalleryScopeDrift();
        if (scopeDrift) {
            return this.abortStartForSavedGalleryScopeDrift('sync', runToken, runEpoch, surface, scopeDrift);
        }
        if (result.skipped || !this.isRunActive(runToken, runEpoch)) {
            return { status: 'error', surface, error: 'Start was cancelled.' };
        }
        const validationResult = await safeChromeRuntimeSendMessage({
            action: 'VALIDATE_SCRAPE_RESUME',
            runToken,
            runEpoch,
            kind: 'sync'
        }, 'validate scrape start');
        if (validationResult.invalidated) {
            this.handleExtensionContextInvalidated();
            return { status: 'error', surface, error: EXTENSION_CONTEXT_REFRESHED_MESSAGE };
        }
        scopeDrift = this.getSavedGalleryScopeDrift();
        if (scopeDrift) {
            return this.abortStartForSavedGalleryScopeDrift('sync', runToken, runEpoch, surface, scopeDrift);
        }
        if (
            this.getRunInvalidationVersion() !== startInvalidationVersion
            || !this.isRunActive(runToken, runEpoch)
        ) return { status: 'error', surface, error: 'Start was cancelled.' };
        if (!validationResult.value?.valid) {
            await this.clearStaleRunState('stale_session');
            return { status: 'error', surface, error: 'Start was cancelled.' };
        }
        scopeDrift = this.getSavedGalleryScopeDrift();
        if (scopeDrift) {
            return this.abortStartForSavedGalleryScopeDrift('sync', runToken, runEpoch, surface, scopeDrift);
        }
        Promise.resolve(this.determineModeAndExecute(runToken, runEpoch)).catch((error) => {
            if (this.isRunActive(runToken, runEpoch)) this.failRun(error.message || 'Sync failed to start.', 'start_failed');
        });
        await this.overlay?.refreshActiveWorkflowStatus?.();
        return {
            status: 'started',
            surface,
            runToken,
            runEpoch,
            ...(this.syncEntryLimit ? { entryLimit: this.syncEntryLimit } : {})
        };
    }

    async waitForRunDurability(runToken = this.runToken, {
        timeoutMs = 60000,
        pollMs = 250,
        hardTimeoutMs = Math.max(timeoutMs, 15 * 60 * 1000)
    } = {}) {
        const runEpoch = this.runEpoch;
        const invalidationVersion = this.getRunInvalidationVersion();
        const backupMode = this.backupMode;
        const kind = backupMode ? 'r2_backup' : 'sync';
        const startedAt = Date.now();
        const hardDeadline = startedAt + Math.max(timeoutMs, hardTimeoutMs);
        let lastProgressAt = startedAt;
        let lastProgressSignature = null;
        const isCurrentRun = () => (
            this.getRunInvalidationVersion() === invalidationVersion
            && this.isRunActive(runToken, runEpoch)
        );
        const ignored = () => ({ status: 'ignored', reason: 'stale_authority' });
        const getActiveDeadline = () => Math.min(
            hardDeadline,
            lastProgressAt + Math.max(0, timeoutMs)
        );
        const timedOut = () => ({
            status: 'timeout',
            reason: Date.now() >= hardDeadline ? 'hard_deadline_exceeded' : 'progress_stalled'
        });
        const awaitBeforeDeadline = async (promise) => {
            const deadline = getActiveDeadline();
            const remainingMs = deadline - Date.now();
            if (remainingMs <= 0) return { expired: true };
            let timeoutId = null;
            const settled = Promise.resolve(promise).then(
                (value) => ({ value }),
                (error) => ({ error })
            );
            const expired = new Promise((resolve) => {
                timeoutId = setTimeout(() => resolve({ expired: true }), remainingMs);
            });
            const result = await Promise.race([settled, expired]);
            if (timeoutId !== null) clearTimeout(timeoutId);
            return Date.now() >= deadline ? { expired: true } : result;
        };

        while (isCurrentRun()) {
            if (Date.now() >= getActiveDeadline()) return timedOut();
            let query;
            try {
                query = safeChromeRuntimeSendMessage({
                    action: 'GET_SCRAPE_DURABILITY',
                    runToken,
                    runEpoch,
                    kind
                }, 'check scrape durability');
            } catch {
                return { status: 'failed', reason: 'query_failed' };
            }
            const queryResult = await awaitBeforeDeadline(query);
            if (!isCurrentRun()) return ignored();
            if (queryResult.expired) return timedOut();
            if (queryResult.error) return { status: 'failed', reason: 'query_failed' };
            const result = queryResult.value;
            if (result.invalidated) return { status: 'ignored', reason: 'context_invalidated' };
            const snapshot = result.value && typeof result.value === 'object'
                ? result.value
                : { status: 'failed', reason: 'missing_response' };
            const progressSignature = JSON.stringify({
                status: snapshot.status,
                pendingDownloads: Number(snapshot.pendingDownloads || 0),
                pendingOperations: Number(snapshot.pendingOperations || 0),
                pendingQueueItems: Number(snapshot.pendingQueueItems || 0),
                inFlightTasks: Number(snapshot.inFlightTasks || 0),
                queueRevision: Number(snapshot.queueRevision || 0),
                operationRevision: Number(snapshot.operationRevision || 0)
            });
            if (progressSignature !== lastProgressSignature) {
                lastProgressSignature = progressSignature;
                lastProgressAt = Date.now();
            }
            if (backupMode) {
                this.backupStats.pendingTransfers = Number(snapshot.pendingDownloads || 0)
                    + Number(snapshot.pendingOperations || 0)
                    + Number(snapshot.pendingQueueItems || 0)
                    + Number(snapshot.inFlightTasks || 0);
                if (Date.now() >= getActiveDeadline()) return timedOut();
                let progress;
                try {
                    const deadline = getActiveDeadline();
                    progress = this.persistBackupProgress(runToken, {
                        runEpoch,
                        invalidationVersion,
                        deadline,
                        timeoutMs: Math.max(0, deadline - Date.now())
                    });
                } catch {
                    return { status: 'failed', reason: 'progress_persist_failed' };
                }
                const progressResult = await awaitBeforeDeadline(progress);
                if (!isCurrentRun()) return ignored();
                if (progressResult.expired) return timedOut();
                if (progressResult.error) return { status: 'failed', reason: 'progress_persist_failed' };
                if (progressResult.value !== true) {
                    return { status: 'failed', reason: 'progress_persist_failed' };
                }
            }
            if (snapshot.status !== 'pending') return snapshot;
            if (Date.now() >= getActiveDeadline()) return timedOut();
            let sleep;
            try {
                sleep = this.sleep(Math.min(
                    pollMs,
                    Math.max(0, getActiveDeadline() - Date.now())
                ));
            } catch {
                return { status: 'failed', reason: 'poll_sleep_failed' };
            }
            const sleepResult = await awaitBeforeDeadline(sleep);
            if (!isCurrentRun()) return ignored();
            if (sleepResult.expired) return timedOut();
            if (sleepResult.error) return { status: 'failed', reason: 'poll_sleep_failed' };
        }
        return isCurrentRun()
            ? timedOut()
            : ignored();
    }

    async getDurableCompletionStopReason(stopReason, runToken = this.runToken) {
        if (stopReason !== 'complete' && stopReason !== 'canary_complete') return stopReason;
        let snapshot;
        try {
            snapshot = await this.waitForRunDurability(runToken);
        } catch {
            snapshot = { status: 'failed' };
        }
        if (snapshot?.status === 'durable') return stopReason;
        if (snapshot?.status === 'timeout') return 'durability_timeout';
        if (snapshot?.status === 'ignored') return 'stale_authority';
        return 'durability_failed';
    }

    async stop(stopReason = 'stopped', options = {}) {
        const providedNavigation = options.stopNavigation || null;
        if (
            providedNavigation
            && this._lastStoppedRun?.runToken === providedNavigation.runToken
            && this._lastStoppedRun?.runEpoch === providedNavigation.runEpoch
        ) {
            await this._lastStoppedRun.cleanupPromise;
            return { status: 'stopped' };
        }
        const previousToken = this.runToken
            || this._pendingInitLease?.runToken
            || providedNavigation?.runToken
            || null;
        const previousEpoch = Number.isInteger(this.runEpoch)
            ? this.runEpoch
            : (Number.isInteger(this._pendingInitLease?.runEpoch)
                ? this._pendingInitLease.runEpoch
                : (Number.isInteger(providedNavigation?.runEpoch) ? providedNavigation.runEpoch : null));
        if (
            options.expectedRunToken
            && (previousToken !== options.expectedRunToken || previousEpoch !== options.expectedRunEpoch)
        ) {
            if (
                this._lastStoppedRun?.runToken === options.expectedRunToken
                && this._lastStoppedRun?.runEpoch === options.expectedRunEpoch
            ) {
                await this._lastStoppedRun.cleanupPromise;
                return { status: 'stopped' };
            }
            return { status: 'ignored' };
        }
        if (stopReason === 'complete' || stopReason === 'canary_complete') {
            stopReason = await this.getDurableCompletionStopReason(stopReason, previousToken);
        }
        const stopNavigation = this.captureStopNavigation(
            previousToken,
            previousEpoch,
            providedNavigation
        );
        const finalStats = {
            stopReason,
            failureCount: this._scrapeFailures.size,
            attemptedEntries: this.syncEntryLimit
                ? this._attemptedConversationIds.size
                : this.state.currentIndex,
            completedEntries: this.syncEntryLimit
                ? this._completedConversationIds.size
                : this.state.currentIndex,
            entryLimit: this.syncEntryLimit
        };
        console.log('Stopping scrape run.');
        this.invalidateRunMemory();
        this.log('Scraping stopped.', 'neutral');
        const cleanupPromise = this.returnToSavedAfterStop(stopNavigation);
        this._lastStoppedRun = { runToken: previousToken, runEpoch: previousEpoch, cleanupPromise };
        await cleanupPromise;
        if (options.notifyBackground !== false && previousToken && Number.isInteger(previousEpoch)) {
            await safeChromeRuntimeSendMessage({
                action: 'SCRAPE_COMPLETE',
                runToken: previousToken,
                runEpoch: previousEpoch,
                kind: 'sync',
                stats: finalStats
            }, 'complete scrape');
        }
        if (options.notifyBackground === false) {
            setTimeout(() => this.overlay?.refreshActiveWorkflowStatus?.(), 250);
        } else {
            await this.overlay?.refreshActiveWorkflowStatus?.();
        }
        return { status: 'stopped' };
    }

    async startBackupMode(options = {}) {
        const surface = this.getCurrentSurface();
        if (surface !== SCRAPE_SURFACES.savedGallery) {
            const error = 'Open Grok Imagine Saved before starting backup.';
            this.log(error, 'error');
            return { status: 'invalid_context', surface, error };
        }
        const scope = this.getSavedGalleryScope();
        if (scope !== SAVED_GALLERY_SCOPES.all) {
            const error = 'Switch Grok Saved to All before starting.';
            this.log(error, 'error');
            return { status: 'invalid_context', surface, scope, error };
        }
        if (this._backupStartPending || this.state.isRunning) {
            this.log('R2 Backup already running or starting.', 'warning');
            return { status: 'error', surface, error: 'R2 Backup is already running or starting.' };
        }
        const runToken = typeof options.runToken === 'string' ? options.runToken : '';
        const runEpoch = Number.isInteger(options.runEpoch) ? options.runEpoch : null;
        if (!runToken || runEpoch === null) {
            return { status: 'error', surface, error: 'Background run lease is missing.' };
        }
        const startInvalidationVersion = this.getRunInvalidationVersion();

        this._backupStartPending = true;
        this.runToken = runToken;
        this.runEpoch = runEpoch;
        // Validate cloud config before starting R2 backup
        try {
            const validationResult = await safeChromeRuntimeSendMessage({ action: 'VALIDATE_CLOUD_CONFIG' }, 'validate cloud config');
            if (validationResult.invalidated) {
                this.handleExtensionContextInvalidated();
                return { status: 'error', surface, error: EXTENSION_CONTEXT_REFRESHED_MESSAGE };
            }
            const scopeDrift = this.getSavedGalleryScopeDrift();
            if (scopeDrift) {
                return this.abortStartForSavedGalleryScopeDrift(
                    'r2_backup',
                    runToken,
                    runEpoch,
                    surface,
                    scopeDrift
                );
            }
            const validation = validationResult.value;
            if (!validation?.valid) {
                this.log(`R2 Backup aborted: ${validation?.error || 'Cloud config invalid.'}`, 'error');
                console.error('R2 Backup config validation failed:', validation?.error);
                if (this.runToken === runToken && this.runEpoch === runEpoch) this.invalidateRunMemory();
                return { status: 'error', surface, error: validation?.error || 'Cloud config invalid.' };
            }
        } catch {
            this.log('R2 Backup aborted: Could not validate cloud config.', 'error');
            if (this.runToken === runToken && this.runEpoch === runEpoch) this.invalidateRunMemory();
            return { status: 'error', surface, error: 'Could not validate cloud config.' };
        } finally {
            this._backupStartPending = false;
        }
        if (
            this.getRunInvalidationVersion() !== startInvalidationVersion
            || this.runToken !== runToken
            || this.runEpoch !== runEpoch
        ) {
            return { status: 'error', surface, error: 'Start was cancelled.' };
        }

        this.backupMode = true;
        this.requiredDestinations = ['r2'];
        this.backupOptions = {
            mode: options.mode === 'canary' ? 'canary' : 'full',
            limit: Number.isFinite(options.limit) && options.limit > 0 ? options.limit : null,
            options: options.options && typeof options.options === 'object' ? options.options : {},
            acceptance: options.acceptance || null
        };
        this.backupStats = {
            totalSeen: 0,
            uploaded: 0,
            alreadyPresent: 0,
            queued: 0,
            pendingTransfers: 0,
            errors: 0,
            startedAt: Date.now()
        };
        this._backupVisited = new Set();
        this._runVisited = new Set();
        this._savedScanLedger = createSavedScanLedger();
        this._savedScanPhase = 'process';
        this._savedFirstPassOrder = [];
        this._savedVerificationOrder = [];
        this._savedVerificationVisited = new Set();
        this._savedVerificationRestarts = 0;
        this._savedScanNeedsRewind = true;
        this._scrapeFailures = new Map();
        this.backupStats.scan = getSavedScanSummary(this._savedScanLedger);
        this.state.isRunning = true;
        this.state.currentIndex = 0;
        this.pendingNavigation = null;
        const startResult = await this.queueRunStateWrite({
            scraperState: 'running',
            currentIndex: 0,
            scrapeRunToken: runToken,
            scrapeRunEpoch: runEpoch,
            scrapeNavigation: null,
            currentItemId: null,
            scrapeFailures: [],
            scrapeBackupOptions: this.backupOptions,
            scrapeDestinations: this.requiredDestinations,
            isScraping: true,
            isR2Backup: true,
            r2BackupState: { ...this.backupStats, isRunning: true }
        }, 'start R2 backup', { runToken, runEpoch });
        if (startResult.invalidated) {
            this.handleExtensionContextInvalidated();
            return { status: 'error', surface, error: EXTENSION_CONTEXT_REFRESHED_MESSAGE };
        }
        let scopeDrift = this.getSavedGalleryScopeDrift();
        if (scopeDrift) {
            return this.abortStartForSavedGalleryScopeDrift('r2_backup', runToken, runEpoch, surface, scopeDrift);
        }
        if (startResult.skipped || !this.isRunActive(runToken, runEpoch)) {
            return { status: 'error', surface, error: 'Start was cancelled.' };
        }
        const authorityResult = await safeChromeRuntimeSendMessage({
            action: 'VALIDATE_SCRAPE_RESUME',
            runToken,
            runEpoch,
            kind: 'r2_backup'
        }, 'validate R2 backup start');
        if (authorityResult.invalidated) {
            this.handleExtensionContextInvalidated();
            return { status: 'error', surface, error: EXTENSION_CONTEXT_REFRESHED_MESSAGE };
        }
        scopeDrift = this.getSavedGalleryScopeDrift();
        if (scopeDrift) {
            return this.abortStartForSavedGalleryScopeDrift('r2_backup', runToken, runEpoch, surface, scopeDrift);
        }
        if (
            this.getRunInvalidationVersion() !== startInvalidationVersion
            || !this.isRunActive(runToken, runEpoch)
        ) return { status: 'error', surface, error: 'Start was cancelled.' };
        if (!authorityResult.value?.valid) {
            await this.clearStaleRunState('stale_session');
            return { status: 'error', surface, error: 'Start was cancelled.' };
        }
        scopeDrift = this.getSavedGalleryScopeDrift();
        if (scopeDrift) {
            return this.abortStartForSavedGalleryScopeDrift('r2_backup', runToken, runEpoch, surface, scopeDrift);
        }
        this.log(this.backupOptions.mode === 'canary' ? 'R2 Canary Backup started.' : 'R2 Full Media Backup started.', 'success');
        Promise.resolve(this.determineModeAndExecute(runToken, runEpoch)).catch((error) => {
            if (this.isRunActive(runToken, runEpoch)) this.failRun(error.message || 'R2 Backup failed to start.', 'start_failed');
        });
        await this.overlay?.refreshActiveWorkflowStatus?.();
        return { status: 'started', surface, runToken, runEpoch };
    }

    async stopBackupMode(stopReason = 'stopped', options = {}) {
        const providedNavigation = options.stopNavigation || null;
        if (
            providedNavigation
            && this._lastStoppedRun?.runToken === providedNavigation.runToken
            && this._lastStoppedRun?.runEpoch === providedNavigation.runEpoch
        ) {
            await this._lastStoppedRun.cleanupPromise;
            return { status: 'stopped' };
        }
        const previousToken = this.runToken
            || this._pendingInitLease?.runToken
            || providedNavigation?.runToken
            || null;
        const previousEpoch = Number.isInteger(this.runEpoch)
            ? this.runEpoch
            : (Number.isInteger(this._pendingInitLease?.runEpoch)
                ? this._pendingInitLease.runEpoch
                : (Number.isInteger(providedNavigation?.runEpoch) ? providedNavigation.runEpoch : null));
        if (
            options.expectedRunToken
            && (previousToken !== options.expectedRunToken || previousEpoch !== options.expectedRunEpoch)
        ) {
            if (
                this._lastStoppedRun?.runToken === options.expectedRunToken
                && this._lastStoppedRun?.runEpoch === options.expectedRunEpoch
            ) {
                await this._lastStoppedRun.cleanupPromise;
                return { status: 'stopped' };
            }
            return { status: 'ignored' };
        }
        if (stopReason === 'complete' || stopReason === 'canary_complete') {
            stopReason = await this.getDurableCompletionStopReason(stopReason, previousToken);
        }
        const finalStats = {
            ...this.backupStats,
            stopReason,
            failureCount: this._scrapeFailures.size
        };
        const stopNavigation = this.captureStopNavigation(
            previousToken,
            previousEpoch,
            providedNavigation
        );
        this.invalidateRunMemory();
        this.log(`R2 Backup stopped. Uploaded: ${this.backupStats.uploaded}, Already present: ${this.backupStats.alreadyPresent || 0}, Queued total: ${this.backupStats.queued || 0}, Pending: ${this.backupStats.pendingTransfers ?? 'unknown'}, Errors: ${this.backupStats.errors}`, 'neutral');
        const cleanupPromise = this.returnToSavedAfterStop(stopNavigation);
        this._lastStoppedRun = { runToken: previousToken, runEpoch: previousEpoch, cleanupPromise };
        await cleanupPromise;
        if (options.notifyBackground !== false && previousToken && Number.isInteger(previousEpoch)) {
            await safeChromeRuntimeSendMessage({
                action: 'R2_BACKUP_COMPLETE',
                runToken: previousToken,
                runEpoch: previousEpoch,
                kind: 'r2_backup',
                stats: finalStats
            }, 'complete R2 backup');
        }
        if (options.notifyBackground === false) {
            setTimeout(() => this.overlay?.refreshActiveWorkflowStatus?.(), 250);
        } else {
            await this.overlay?.refreshActiveWorkflowStatus?.();
        }
        return { status: 'stopped' };
    }

    async determineModeAndExecute(runToken = this.runToken) {
        if (!this.isRunActive(runToken)) return;
        if (!await this.ensureRunDestinationContract(runToken)) {
            if (this.isRunActive(runToken)) {
                await this.failRun(
                    'Could not confirm the active Sync destination after resume.',
                    'resume_destination_unavailable',
                    false
                );
            }
            return;
        }

        while (this.isRunActive(runToken)) {
            const surface = this.getCurrentSurface();
            if (surface === SCRAPE_SURFACES.savedGallery) {
                if (!await this.ensureSavedGalleryAllScope(runToken)) return;
                this.state.mode = 'LIST';
                const restored = await this.restorePendingGalleryContext(runToken);
                if (!restored || !this.isRunActive(runToken)) {
                    if (this.isRunActive(runToken)) {
                        await this.failRun(
                            'Could not restore the pending Saved entry after resume.',
                            'resume_gallery_restore_failed',
                            false
                        );
                    }
                    return;
                }
                const outcome = await this.executeListView(runToken);
                if (outcome?.status === 'surface_changed' || outcome?.status === 'navigating') continue;
                if (this.isRunActive(runToken)) {
                    await this.failRun(
                        'Sync coordinator exited without a terminal result.',
                        'coordinator_exited_without_terminal_state',
                        false
                    );
                }
                return;
            }
            if (surface === SCRAPE_SURFACES.agentMedia) {
                this.state.mode = 'AGENT';
                await this.executeAgentView(runToken);
                continue;
            }
            if (surface === SCRAPE_SURFACES.legacyDetail) {
                this.state.mode = 'DETAIL';
                await this.executeDetailView(runToken);
                continue;
            }

            await this.failRun(
                'Sync left Grok Imagine Saved and did not reach supported media.',
                'unsupported_surface'
            );
            return;
        }
    }

    async failRun(message, stopReason = 'error', countBackupError = true) {
        if (!this.state.isRunning) return;
        this.log(message, 'error');
        if (this.backupMode) {
            if (countBackupError) this.backupStats.errors++;
            await this.stopBackupMode(stopReason);
        } else {
            await this.stop(stopReason);
        }
    }

    async persistBackupProgress(runToken = this.runToken, {
        runEpoch = this.runEpoch,
        invalidationVersion = this.getRunInvalidationVersion(),
        deadline = Number.POSITIVE_INFINITY,
        timeoutMs = SCRAPE_RUN_STATE_WRITE_TIMEOUT_MS
    } = {}) {
        const isCurrent = () => Boolean(
            this.backupMode
            && this.getRunInvalidationVersion() === invalidationVersion
            && this.matchesRunLease(runToken, runEpoch)
        );
        if (!isCurrent() || Date.now() >= deadline) return false;
        const stats = { ...this.backupStats };
        const result = await this.queueRunStateWrite({
            r2BackupState: { isRunning: true, ...stats }
        }, 'save R2 backup progress', {
            runToken,
            runEpoch,
            invalidationVersion,
            kind: 'r2_backup',
            deadline,
            timeoutMs
        });
        if (result.invalidated) {
            if (isCurrent()) this.handleExtensionContextInvalidated();
            return false;
        }
        if (Date.now() >= deadline || !isCurrent() || !result.ok) return false;
        safeChromeRuntimeSendMessageSoon({
            action: 'R2_BACKUP_PROGRESS',
            runToken,
            runEpoch,
            kind: 'r2_backup',
            stats
        }, 'send R2 backup progress');
        return true;
    }

    async waitForSurface(predicate, runToken = this.runToken, timeout = this.Config.surfaceWait) {
        const startedAt = Date.now();
        while (this.isRunActive(runToken) && Date.now() - startedAt < timeout) {
            const surface = this.getCurrentSurface();
            if (predicate(surface)) return surface;
            await this.sleep(200);
        }
        return null;
    }

    async restorePendingGalleryContext(runToken = this.runToken) {
        const pending = this.pendingNavigation;
        if (!pending) return true;
        if (pending.runToken !== runToken || pending.runEpoch !== this.runEpoch) return false;
        let verifiedAllScope = false;
        const restored = await restoreSavedViewportReceipt(pending, {
            isActive: () => this.isRunActive(runToken),
            isScopeValid: () => {
                const scope = this.getSavedGalleryScope();
                if (scope === SAVED_GALLERY_SCOPES.all) {
                    verifiedAllScope = true;
                    return true;
                }
                return scope === SAVED_GALLERY_SCOPES.unknown && !verifiedAllScope;
            },
            sleep: (delay) => this.sleep(delay),
            timeoutMs: 10000
        });
        if (restored.status === 'cancelled') return false;
        if (restored.status === 'invalid_scope') {
            await this.ensureSavedGalleryAllScope(runToken);
            return false;
        }
        if (restored.status !== 'restored') {
            await this.failRun(
                'Saved returned without the selected media neighborhood. Refresh Saved before restarting.',
                'gallery_restore_timeout'
            );
            return false;
        }
        const activeReturn = this._returnToSavedInFlight;
        if (
            activeReturn
            && activeReturn.runToken === runToken
            && activeReturn.runEpoch === this.runEpoch
        ) activeReturn.viewportRestored = true;
        if (!this.isRunActive(runToken)) return false;
        if (!await this.ensureSavedGalleryAllScope(runToken)) return false;
        if (pending.conversationId && pending.inventoryComplete !== true) {
            const outcome = await this.processPendingConversationInventory(runToken);
            if (outcome?.status !== 'completed' || !this.isRunActive(runToken)) return false;
            if (!this.pendingNavigation) return true;
        }
        const result = await this.queueRunStateWrite({
            scrapeNavigation: null,
            currentItemId: null
        }, 'clear completed scrape navigation', { runToken, runEpoch: this.runEpoch });
        if (result.invalidated) {
            this.handleExtensionContextInvalidated();
            return false;
        }
        if (!result.ok || !this.isRunActive(runToken)) return false;
        this.pendingNavigation = null;
        return true;
    }

    getSavedEntryRunKey(entry) {
        const conversationId = entry?.conversationId || getSavedCardConversationId(entry?.card);
        if (conversationId) return `conversation:${conversationId}`;
        const cardIdentity = entry?.cardIdentity
            || entry?.sourceIdentity
            || getGrokMediaIdentity(entry?.sourceUrl);
        return cardIdentity ? `card:${cardIdentity}` : '';
    }

    getScrapeFailureKey(pending = this.pendingNavigation) {
        if (!pending || typeof pending !== 'object') return '';
        return [
            pending.entryRunKey,
            pending.sourceEntryRunKey,
            pending.conversationId ? `conversation:${pending.conversationId}` : '',
            pending.sourceCardIdentity ? `card:${pending.sourceCardIdentity}` : '',
            pending.expectedIdentity ? `asset:${pending.expectedIdentity}` : ''
        ].find((value) => typeof value === 'string' && value.length > 0) || '';
    }

    serializeScrapeFailures(failures = this._scrapeFailures) {
        return Array.from(failures.values()).map((failure) => ({ ...failure }));
    }

    markSavedEntryVisited(pending, fallbackKey = '') {
        const keys = new Set([
            fallbackKey,
            pending?.entryRunKey,
            pending?.sourceEntryRunKey,
            pending?.conversationId ? `conversation:${pending.conversationId}` : ''
        ].filter(Boolean));
        for (const key of keys) {
            this._runVisited.add(key);
            if (this._savedScanPhase === 'verify') this._savedVerificationVisited.add(key);
        }
    }

    getBoundedSyncEntryLimitState(
        attemptedConversationIds = this._attemptedConversationIds,
        completedConversationIds = this._completedConversationIds
    ) {
        if (!this.syncEntryLimit || this.backupMode) return null;
        return {
            version: 2,
            entryLimit: this.syncEntryLimit,
            attemptedConversationIds: Array.from(attemptedConversationIds),
            completedConversationIds: Array.from(completedConversationIds)
        };
    }

    async stopIfBoundedSyncEntryLimitReached(runToken = this.runToken) {
        if (
            !this.syncEntryLimit
            || this.backupMode
            || this._attemptedConversationIds.size < this.syncEntryLimit
            || !this.isRunActive(runToken)
        ) return false;
        this.log(
            `Bounded Sync reached ${this._attemptedConversationIds.size} attempted Saved entries (${this._completedConversationIds.size} durable).`,
            this._scrapeFailures.size > 0 ? 'warning' : 'success'
        );
        await this.stop('entry_limit');
        return true;
    }

    async recordBoundedConversationAttempt(conversationId, runToken = this.runToken) {
        if (!this.syncEntryLimit || this.backupMode) {
            return {
                status: 'ok',
                count: this.state.currentIndex,
                limitReached: false
            };
        }
        const normalizedConversationId = getGrokConversationId(
            `https://grok.com/?conversation=${conversationId}`
        );
        if (!normalizedConversationId || !this.isRunActive(runToken)) {
            if (this.isRunActive(runToken)) {
                await this.failRun(
                    'Bounded Sync found a Saved entry without a stable conversation UUID.',
                    'entry_limit_identity_missing',
                    false
                );
            }
            return { status: 'stopped', count: this._attemptedConversationIds.size, limitReached: false };
        }
        if (this._attemptedConversationIds.has(normalizedConversationId)) {
            return {
                status: 'ok',
                count: this._attemptedConversationIds.size,
                limitReached: this._attemptedConversationIds.size >= this.syncEntryLimit
            };
        }
        if (this._attemptedConversationIds.size >= this.syncEntryLimit) {
            await this.stopIfBoundedSyncEntryLimitReached(runToken);
            return { status: 'stopped', count: this._attemptedConversationIds.size, limitReached: true };
        }

        const attemptedConversationIds = new Set(this._attemptedConversationIds);
        attemptedConversationIds.add(normalizedConversationId);
        const count = attemptedConversationIds.size;
        const result = await this.queueRunStateWrite({
            currentIndex: count,
            scrapeEntryLimitState: this.getBoundedSyncEntryLimitState(
                attemptedConversationIds,
                this._completedConversationIds
            )
        }, 'record bounded Sync conversation attempt', {
            runToken,
            runEpoch: this.runEpoch
        });
        if (result.invalidated) {
            this.handleExtensionContextInvalidated();
            return { status: 'stopped', count: this.state.currentIndex, limitReached: false };
        }
        if (!result.ok || !this.isRunActive(runToken)) {
            if (this.isRunActive(runToken)) {
                await this.failRun(
                    'Bounded Sync could not persist its attempted-entry receipt.',
                    'entry_limit_progress_persist_failed',
                    false
                );
            }
            return { status: 'stopped', count: this.state.currentIndex, limitReached: false };
        }
        this._attemptedConversationIds = attemptedConversationIds;
        this.state.currentIndex = count;
        this.log(
            `Bounded Sync: ${count}/${this.syncEntryLimit} attempted Saved entries (${this._completedConversationIds.size} durable).`,
            'neutral'
        );
        return {
            status: 'ok',
            count,
            limitReached: count >= this.syncEntryLimit
        };
    }

    async recordRecoverableSavedEntryFailure(
        pending,
        code,
        message,
        runToken = this.runToken
    ) {
        const runEpoch = pending?.runEpoch;
        if (!pending || !this.isRunActive(runToken, runEpoch)) return { status: 'stopped' };
        const key = this.getScrapeFailureKey(pending);
        if (!key) {
            await this.failRun(
                'A failed Saved entry did not retain a stable identity.',
                'scrape_failure_identity_missing'
            );
            return { status: 'stopped' };
        }

        const now = Date.now();
        const prior = this._scrapeFailures.get(key);
        const nextFailures = new Map(this._scrapeFailures);
        nextFailures.set(key, {
            key,
            code: String(code || 'entry_failed').slice(0, 128),
            message: String(message || 'Saved entry failed.').slice(0, 500),
            sourceCardIdentity: pending.sourceCardIdentity || '',
            conversationId: pending.conversationId || '',
            expectedIdentity: pending.expectedIdentity || '',
            attempts: Math.max(0, Number(prior?.attempts || 0)) + 1,
            firstFailedAt: Number(prior?.firstFailedAt || now),
            lastFailedAt: now,
            phase: this._savedScanPhase
        });

        const currentSurface = this.getCurrentSurface();
        const onSaved = currentSurface === SCRAPE_SURFACES.savedGallery;
        const resumablePending = onSaved ? null : {
            ...pending,
            inventoryComplete: true,
            failureRecorded: true
        };
        const nextBackupStats = this.backupMode && !prior
            ? { ...this.backupStats, errors: Number(this.backupStats.errors || 0) + 1 }
            : null;
        const values = {
            scrapeFailures: this.serializeScrapeFailures(nextFailures),
            scrapeNavigation: resumablePending,
            currentItemId: resumablePending?.currentItemId || null,
            ...(nextBackupStats
                ? { r2BackupState: { ...nextBackupStats, isRunning: true } }
                : {})
        };
        const result = await this.queueRunStateWrite(
            values,
            'record recoverable Saved entry failure',
            { runToken, runEpoch }
        );
        if (result.invalidated) {
            this.handleExtensionContextInvalidated();
            return { status: 'stopped' };
        }
        if (!result.ok || !this.isRunActive(runToken, runEpoch)) {
            if (this.isRunActive(runToken, runEpoch)) {
                await this.failRun(
                    'Could not preserve the failed Saved entry for retry.',
                    'scrape_failure_persist_failed',
                    false
                );
            }
            return { status: 'stopped' };
        }

        this._scrapeFailures = nextFailures;
        if (nextBackupStats) this.backupStats = nextBackupStats;
        this.pendingNavigation = resumablePending;
        this.markSavedEntryVisited(pending, key);
        const safeDetail = getSafeSavedEntryFailureDetail(message);
        this.log(
            `Saved entry deferred for verification (${code || 'entry_failed'})${safeDetail ? `: ${safeDetail}` : ''}.`,
            'warning'
        );

        if (await this.stopIfBoundedSyncEntryLimitReached(runToken)) {
            return { status: 'stopped', failed: true, entryLimitReached: true };
        }

        if (onSaved) return { status: 'completed', failed: true };
        await this.returnToSavedGallery(runToken);
        return this.isRunActive(runToken, runEpoch)
            ? { status: 'surface_changed', failed: true }
            : { status: 'stopped' };
    }

    async clearRecoverableSavedEntryFailure(pending, runToken = this.runToken) {
        const key = this.getScrapeFailureKey(pending);
        if (!key || !this._scrapeFailures.has(key)) return true;
        if (!this.isRunActive(runToken, pending?.runEpoch)) return false;
        const nextFailures = new Map(this._scrapeFailures);
        nextFailures.delete(key);
        const result = await this.queueRunStateWrite({
            scrapeFailures: this.serializeScrapeFailures(nextFailures)
        }, 'clear recovered Saved entry failure', {
            runToken,
            runEpoch: pending.runEpoch
        });
        if (result.invalidated) {
            this.handleExtensionContextInvalidated();
            return false;
        }
        if (!result.ok || !this.isRunActive(runToken, pending.runEpoch)) return false;
        this._scrapeFailures = nextFailures;
        return true;
    }

    async recordDurableConversationCompletion(conversationId, runToken = this.runToken) {
        if (!this.syncEntryLimit || this.backupMode) {
            return { status: 'ok', count: this.state.currentIndex, limitReached: false };
        }
        const normalizedConversationId = getGrokConversationId(
            `https://grok.com/?conversation=${conversationId}`
        );
        if (!normalizedConversationId || !this.isRunActive(runToken)) {
            if (this.isRunActive(runToken)) {
                await this.failRun(
                    'Bounded Sync could not persist a stable conversation identity.',
                    'entry_limit_identity_missing',
                    false
                );
            }
            return { status: 'stopped', count: this.state.currentIndex, limitReached: false };
        }
        if (this._completedConversationIds.has(normalizedConversationId)) {
            return {
                status: 'ok',
                count: this._completedConversationIds.size,
                attemptedCount: this._attemptedConversationIds.size,
                limitReached: this._attemptedConversationIds.size >= this.syncEntryLimit
            };
        }

        const completedConversationIds = new Set(this._completedConversationIds);
        completedConversationIds.add(normalizedConversationId);
        const count = completedConversationIds.size;
        const result = await this.queueRunStateWrite({
            currentIndex: this._attemptedConversationIds.size,
            scrapeEntryLimitState: this.getBoundedSyncEntryLimitState(
                this._attemptedConversationIds,
                completedConversationIds
            )
        }, 'record bounded Sync conversation completion', {
            runToken,
            runEpoch: this.runEpoch
        });
        if (result.invalidated) {
            this.handleExtensionContextInvalidated();
            return { status: 'stopped', count: this.state.currentIndex, limitReached: false };
        }
        if (!result.ok || !this.isRunActive(runToken)) {
            if (this.isRunActive(runToken)) {
                await this.failRun(
                    'Bounded Sync could not persist its completed-entry receipt.',
                    'entry_limit_progress_persist_failed',
                    false
                );
            }
            return { status: 'stopped', count: this.state.currentIndex, limitReached: false };
        }
        this._completedConversationIds = completedConversationIds;
        this.state.currentIndex = this._attemptedConversationIds.size;
        this.log(
            `Bounded Sync: ${this._attemptedConversationIds.size}/${this.syncEntryLimit} attempted Saved entries (${count} durable).`,
            'neutral'
        );
        return {
            status: 'ok',
            count,
            attemptedCount: this._attemptedConversationIds.size,
            limitReached: this._attemptedConversationIds.size >= this.syncEntryLimit
        };
    }

    async rewindSavedScanPass(runToken = this.runToken) {
        if (!this.isRunActive(runToken)) return false;
        if (!await this.ensureSavedGalleryAllScope(runToken)) return false;
        let context = null;
        for (let attempt = 0; attempt < 20 && this.isRunActive(runToken); attempt++) {
            context = getSavedGalleryContext(document);
            if (!context) {
                await this.sleep(150);
                continue;
            }
            setSavedGalleryScrollTop(context.scroller, 0);
            await this.sleep(150);
            const refreshed = getSavedGalleryContext(document);
            if (!refreshed) continue;
            const snapshot = this.getScrollerSnapshot(refreshed.scroller);
            if (snapshot.scrollTop <= 2) {
                this._savedScanLedger = createSavedScanLedger();
                this._savedScanNeedsRewind = false;
                return true;
            }
            setSavedGalleryScrollTop(refreshed.scroller, 0);
        }
        if (this.isRunActive(runToken)) {
            await this.failRun(
                'Could not rewind Grok Saved to the beginning for a complete scan.',
                'gallery_rewind_failed'
            );
        }
        return false;
    }

    recordSavedPassOrder(entries) {
        const order = this._savedScanPhase === 'verify'
            ? this._savedVerificationOrder
            : this._savedFirstPassOrder;
        for (const entry of entries) appendUniqueIdentity(order, this.getSavedEntryRunKey(entry));
    }

    async executeListView(runToken = this.runToken) {
        if (this._listCoordinatorPromise) return this._listCoordinatorPromise;
        const coordinator = this.runSavedGalleryCoordinator(runToken);
        this._listCoordinatorPromise = coordinator;
        try {
            return await coordinator;
        } finally {
            if (this._listCoordinatorPromise === coordinator) this._listCoordinatorPromise = null;
        }
    }

    async runSavedGalleryCoordinator(runToken = this.runToken) {
        if (!this.isRunActive(runToken)) return { status: 'stopped' };
        if (this.getCurrentSurface() !== SCRAPE_SURFACES.savedGallery) {
            return { status: 'surface_changed' };
        }
        if (!await this.ensureSavedGalleryAllScope(runToken)) return { status: 'stopped' };
        if (!await this.ensureRunDestinationContract(runToken)) return { status: 'stopped' };
        if (this._savedScanNeedsRewind && !await this.rewindSavedScanPass(runToken)) {
            return { status: 'stopped' };
        }

        const MAX_MISSING_CONTEXT_RETRIES = this.backupMode ? 30 : 15;
        const MAX_SCROLL_ATTEMPTS = SAVED_SCAN_MAX_SCROLL_ATTEMPTS;
        const canaryOptions = this.backupMode && this.backupOptions?.mode === 'canary'
            ? this.backupOptions.options || {}
            : {};
        const canaryTargetIdentity = getGrokMediaIdentity(canaryOptions.targetIdentity);
        const canaryTargetMediaType = canaryOptions.targetMediaType === 'image'
            || canaryOptions.targetMediaType === 'video'
            ? canaryOptions.targetMediaType
            : null;
        const canaryTargetLabel = canaryTargetIdentity
            ? `...${canaryTargetIdentity.slice(-8)}`
            : '';

        while (this.isRunActive(runToken)) {
            let missingContextRetries = 0;
            let scrollAttempts = 0;
            let exhausted = false;
            let scanLimitReached = false;
            const scanLedger = this.getSavedScanLedger();
            await this.sleep(300);

            while (this.isRunActive(runToken) && scrollAttempts < MAX_SCROLL_ATTEMPTS) {
                if (await this.stopIfBoundedSyncEntryLimitReached(runToken)) {
                    return { status: 'stopped', entryLimitReached: true };
                }
                if (this.getCurrentSurface() !== SCRAPE_SURFACES.savedGallery) {
                    return { status: 'surface_changed' };
                }
                if (!await this.ensureSavedGalleryAllScope(runToken)) return { status: 'stopped' };
                if (!await this.ensureRunDestinationContract(runToken)) return { status: 'stopped' };
                const galleryContext = getSavedGalleryContext(document);
                if (!galleryContext) {
                    missingContextRetries++;
                    if (missingContextRetries >= MAX_MISSING_CONTEXT_RETRIES) {
                        await this.failRun(
                            'Could not identify one semantic Saved gallery. Refresh Saved before restarting.',
                            'gallery_context_missing'
                        );
                        return { status: 'stopped' };
                    }
                    await this.sleep(400);
                    continue;
                }
                missingContextRetries = 0;
                const semanticItems = galleryContext.entries;
                const identitylessEntry = semanticItems.find((entry) => !this.getSavedEntryRunKey(entry));
                if (identitylessEntry) {
                    await this.failRun(
                        'A Saved entry did not expose any stable card, conversation, or media identity.',
                        'gallery_identity_missing'
                    );
                    return { status: 'stopped' };
                }
                const completedSet = this._savedScanPhase === 'verify'
                    ? this._savedVerificationVisited
                    : this._runVisited;
                const malformedEntries = semanticItems.filter((entry) => (
                    !this.getCleanId(entry.sourceUrl)
                    && !completedSet.has(this.getSavedEntryRunKey(entry))
                ));
                for (const malformedEntry of malformedEntries) {
                    if (this.syncEntryLimit) {
                        const boundedAttempt = await this.recordBoundedConversationAttempt(
                            malformedEntry.conversationId,
                            runToken
                        );
                        if (boundedAttempt.status !== 'ok') return { status: 'stopped' };
                    }
                    const entryRunKey = this.getSavedEntryRunKey(malformedEntry);
                    const outcome = await this.recordRecoverableSavedEntryFailure({
                        runToken,
                        runEpoch: this.runEpoch,
                        currentItemId: null,
                        expectedIdentity: malformedEntry.sourceIdentity || '',
                        sourceCardIdentity: malformedEntry.cardIdentity || '',
                        conversationId: malformedEntry.conversationId || '',
                        entryRunKey,
                        sourceEntryRunKey: entryRunKey,
                        galleryUrl: window.location.href,
                        savedViewportReceipt: null
                    }, 'gallery_media_identity_missing',
                    'Saved exposed a card without a stable media identity.', runToken);
                    if (outcome.status === 'stopped') return outcome;
                }
                this.recordSavedPassOrder(semanticItems);
                const scan = recordSavedScan(scanLedger, {
                    identities: semanticItems.map((entry) => entry.cardIdentity),
                    windowPosition: this.getScrollerSnapshot(galleryContext.scroller).scrollTop
                });

                if (canaryTargetIdentity) {
                    const handled = await this.processUniqueCanaryTarget({
                        runToken,
                        targetIdentity: canaryTargetIdentity,
                        targetMediaType: canaryTargetMediaType,
                        targetLabel: canaryTargetLabel,
                        galleryContext
                    });
                    if (handled?.status === 'surface_changed' || handled?.status === 'navigating') {
                        return handled;
                    }
                    if (handled) return { status: 'canary_terminal' };
                }

                if (scrollAttempts % 5 === 0) {
                    this.log(`Scanning Saved... (${semanticItems.length} entries visible)`);
                }

                let targetEntry = null;
                let targetIndex = -1;
                if (!canaryTargetIdentity) {
                    targetIndex = semanticItems.findIndex((entry) => {
                        const cleanId = this.getCleanId(entry.sourceUrl);
                        return cleanId && !completedSet.has(this.getSavedEntryRunKey(entry));
                    });
                    targetEntry = targetIndex >= 0 ? semanticItems[targetIndex] : null;
                }
                if (targetEntry) {
                    const targetCleanId = this.getCleanId(targetEntry.sourceUrl);
                    this.log(`Processing Saved entry ...${targetCleanId.slice(-6)}`, 'success');
                    const outcome = await this.processItem(
                        targetEntry.image,
                        targetCleanId,
                        runToken,
                        this.runEpoch,
                        semanticItems[targetIndex + 1]?.cardIdentity || null
                    );
                    if (!this.isRunActive(runToken)) return { status: 'stopped' };
                    if (outcome?.status === 'navigating' || outcome?.status === 'surface_changed') {
                        return outcome;
                    }
                    if (outcome?.status !== 'completed') return outcome || { status: 'stopped' };
                    continue;
                }

                const durability = await this.queryRunDurabilitySnapshot(runToken);
                if (!this.isRunActive(runToken)) return { status: 'stopped' };
                const transferPending = durability.status !== 'durable';
                if (this.backupMode) {
                    this.backupStats.scan = getSavedScanSummary(scanLedger);
                    if (!await this.persistBackupProgress(runToken)) {
                        if (this.isRunActive(runToken)) {
                            await this.failRun(
                                'Could not persist Saved scan progress.',
                                'scan_progress_persist_failed'
                            );
                        }
                        return { status: 'stopped' };
                    }
                }

                const scroller = galleryContext.scroller;
                const before = this.getScrollerSnapshot(scroller);
                const beforeSignature = this.getGalleryCardSignature();
                const scrollAmount = before.clientHeight || window.innerHeight || 800;
                if (scroller === window) window.scrollBy(0, scrollAmount);
                else if (typeof scroller.scrollBy === 'function') scroller.scrollBy(0, scrollAmount);
                else {
                    scroller.scrollTop = Number(scroller.scrollTop || 0) + scrollAmount;
                    scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
                }
                await this.sleep(SAVED_BOTTOM_PROBE_WAIT_MS);
                if (!this.isRunActive(runToken)) return { status: 'stopped' };
                if (!await this.ensureSavedGalleryAllScope(runToken)) return { status: 'stopped' };
                const after = this.getScrollerSnapshot(scroller);
                const afterSignature = this.getGalleryCardSignature();
                const afterContext = getSavedGalleryContext(document);
                this.recordSavedPassOrder(afterContext?.entries || []);
                const afterScan = recordSavedScan(scanLedger, {
                    identities: (afterContext?.entries || []).map((entry) => entry.cardIdentity),
                    windowPosition: after.scrollTop
                });
                scrollAttempts++;
                const outcome = resolveBackupScrollAttempt({
                    before,
                    after,
                    beforeSignature,
                    afterSignature,
                    newIdentityCount: scan.newIdentityCount + afterScan.newIdentityCount,
                    loading: afterContext?.savedSurfaceRoot
                        ? isSavedGalleryLoading(afterContext.savedSurfaceRoot)
                        : false,
                    contextStable: Boolean(afterContext?.savedSurfaceRoot),
                    transferPending,
                    stableBottomRounds: scanLedger.stableBottomRounds,
                    lastNewIdentityAt: scanLedger.lastNewIdentityAt,
                    now: Date.now(),
                    scanAttempts: scrollAttempts,
                    maxScrollAttempts: MAX_SCROLL_ATTEMPTS,
                    requiredStableBottomRounds: REQUIRED_STABLE_BOTTOM_ROUNDS,
                    minimumStableBottomMs: MINIMUM_STABLE_BOTTOM_MS
                });
                scanLedger.stableBottomRounds = outcome.stableBottomRounds;
                if (this.backupMode) this.backupStats.scan = getSavedScanSummary(scanLedger);
                if (outcome.reason === 'scan_limit') {
                    scanLimitReached = true;
                    break;
                }
                if (outcome.exhausted) {
                    exhausted = true;
                    break;
                }
            }

            if (!this.isRunActive(runToken)) return { status: 'stopped' };
            if (canaryTargetIdentity) {
                await this.failRun(
                    exhausted
                        ? `Canary target ${canaryTargetLabel} was not found before Saved was exhausted.`
                        : `Canary target ${canaryTargetLabel} was not found before the Saved scan safety limit.`,
                    exhausted ? 'canary_target_not_found' : 'canary_target_scan_limit'
                );
                return { status: 'stopped' };
            }
            if (!exhausted || scanLimitReached || scrollAttempts >= MAX_SCROLL_ATTEMPTS) {
                this.log('Saved scan paused: safety limit reached before confirming the gallery end.', 'warning');
                if (this.backupMode) await this.stopBackupMode('scan_limit');
                else await this.stop('scan_limit');
                return { status: 'stopped' };
            }

            const durability = await this.waitForRunDurability(runToken, {
                timeoutMs: this.backupMode ? 300000 : 180000
            });
            if (!this.isRunActive(runToken)) return { status: 'stopped' };
            if (durability.status !== 'durable') {
                const stopReason = durability.status === 'timeout'
                    ? 'durability_timeout'
                    : (durability.status === 'ignored' ? 'stale_authority' : 'durability_failed');
                if (this.backupMode) await this.stopBackupMode(stopReason);
                else await this.stop(stopReason);
                return { status: 'stopped' };
            }
            if (!await this.refreshProcessedIds(runToken)) return { status: 'stopped' };

            if (this._savedScanPhase === 'process') {
                this._savedScanPhase = 'verify';
                this._savedVerificationOrder = [];
                this._savedVerificationVisited = new Set();
                this._savedScanNeedsRewind = true;
                this.log('Verifying the complete Saved scan from the beginning...', 'neutral');
                if (!await this.rewindSavedScanPass(runToken)) return { status: 'stopped' };
                continue;
            }

            const sameOrder = this._savedFirstPassOrder.length === this._savedVerificationOrder.length
                && this._savedFirstPassOrder.every((value, index) => (
                    value === this._savedVerificationOrder[index]
                ));
            const allVerified = this._savedVerificationOrder.every((value) => (
                this._savedVerificationVisited.has(value)
            ));
            if (!sameOrder || !allVerified) {
                this._savedVerificationRestarts++;
                if (this._savedVerificationRestarts > SAVED_SCAN_MAX_VERIFICATION_RESTARTS) {
                    await this.failRun(
                        'Grok Saved changed during repeated verification passes. Restart when the gallery is stable.',
                        'gallery_changed_during_verification'
                    );
                    return { status: 'stopped' };
                }
                this._savedScanPhase = 'process';
                this._savedFirstPassOrder = [];
                this._savedVerificationOrder = [];
                this._savedVerificationVisited = new Set();
                this._savedScanNeedsRewind = true;
                this.log('Saved changed during verification. Rechecking the full gallery...', 'warning');
                if (!await this.rewindSavedScanPass(runToken)) return { status: 'stopped' };
                continue;
            }

            this.log(`Verified ${this._savedVerificationOrder.length} Saved entries.`, 'success');
            if (this._scrapeFailures.size > 0) {
                const failureCount = this._scrapeFailures.size;
                this.log(
                    `${failureCount} Saved entr${failureCount === 1 ? 'y needs' : 'ies need'} retry; completed assets remain preserved.`,
                    'error'
                );
                if (this.backupMode) await this.stopBackupMode('partial_failure');
                else await this.stop('partial_failure');
                return { status: 'partial_failure', failureCount };
            }
            if (this.backupMode) await this.stopBackupMode('complete');
            else await this.stop('complete');
            return { status: 'complete' };
        }
        return { status: 'stopped' };
    }

    async processItem(
        targetItem,
        cleanId,
        runToken = this.runToken,
        runEpoch = this.runEpoch,
        expectedNextIdentity = null
    ) {
        if (!this.isRunActive(runToken, runEpoch)) return { status: 'stopped' };
        if (!await this.ensureSavedGalleryAllScope(runToken)) return { status: 'stopped' };
        const sourceUrl = targetItem.currentSrc || targetItem.src || '';
        const expectedIdentity = getGrokMediaIdentity(sourceUrl);
        if (!expectedIdentity) {
            await this.failRun('Could not identify the selected Saved media.', 'gallery_identity_missing');
            return { status: 'stopped' };
        }
        const sourceCard = findMediaCardRoot(targetItem);
        const sourceCardIdentity = getSavedCardIdentity(sourceCard, expectedIdentity);
        if (!sourceCardIdentity) {
            await this.failRun('Could not identify the selected Saved card.', 'gallery_identity_missing');
            return { status: 'stopped' };
        }
        const conversationId = getSavedCardConversationId(sourceCard);
        const expectedMediaType = getSavedGalleryEntryMediaType({
            card: sourceCard,
            image: targetItem,
            sourceUrl
        });
        const sourceTransferUrl = expectedMediaType === 'video'
            ? getVerifiedSavedCardVideoSource(sourceCard, expectedIdentity)
            : sourceUrl;

        const scroller = this.getGalleryScroller();
        const savedViewportReceipt = captureSavedViewportReceipt({
            sourceIdentity: sourceCardIdentity,
            expectedNextIdentity,
            fallbackScroller: scroller
        });
        if (!savedViewportReceipt) {
            await this.failRun('Could not capture the selected Saved media neighborhood.', 'gallery_context_missing');
            return { status: 'stopped' };
        }
        if (this.syncEntryLimit) {
            const boundedAttempt = await this.recordBoundedConversationAttempt(conversationId, runToken);
            if (boundedAttempt.status !== 'ok') return { status: 'stopped' };
        }
        const pendingNavigation = {
            runToken,
            runEpoch,
            currentItemId: cleanId,
            expectedIdentity,
            expectedMediaType,
            sourceCardIdentity,
            conversationId,
            entryRunKey: conversationId
                ? `conversation:${conversationId}`
                : `card:${sourceCardIdentity}`,
            sourceEntryRunKey: conversationId
                ? `conversation:${conversationId}`
                : `card:${sourceCardIdentity}`,
            sourceUrl,
            sourceTransferUrl,
            galleryUrl: window.location.href,
            savedViewportReceipt,
            galleryScrollTop: savedViewportReceipt.scrollTop,
            createdAt: Date.now()
        };
        targetItem.style.outline = "2px solid rgba(29,155,240,0.5)";
        this.log(`Opening item...`);
        const result = await this.queueRunStateWrite({
            currentItemId: cleanId,
            scrapeNavigation: pendingNavigation
        }, 'save scrape navigation', { runToken, runEpoch });
        if (result.invalidated) {
            this.handleExtensionContextInvalidated();
            return { status: 'stopped' };
        }
        if (!this.isRunActive(runToken, runEpoch)) return { status: 'stopped' };
        if (!await this.ensureSavedGalleryAllScope(runToken)) return { status: 'stopped' };
        this.pendingNavigation = pendingNavigation;
        if (conversationId) {
            return this.processPendingConversationInventory(runToken);
        }

        dispatchFullPointerClick(targetItem);
        const nextSurface = await this.waitForSurface(
            (surface) => surface !== SCRAPE_SURFACES.savedGallery,
            runToken
        );
        if (!this.isRunActive(runToken, runEpoch)) return { status: 'stopped' };
        if (!nextSurface) {
            return this.recordRecoverableSavedEntryFailure(
                pendingNavigation,
                'surface_transition_timeout',
                'The selected Saved card did not expose a conversation inventory surface.',
                runToken
            );
        }
        return { status: 'surface_changed', surface: nextSurface };
    }

    async persistPendingConversationProgress(pending, operation, runToken = this.runToken) {
        if (!pending || !this.isRunActive(runToken, pending.runEpoch)) return false;
        const result = await this.queueCriticalRunStateWrite({
            currentItemId: pending.currentItemId,
            scrapeNavigation: pending
        }, operation, { runToken, runEpoch: pending.runEpoch });
        if (result.invalidated) {
            this.handleExtensionContextInvalidated();
            return false;
        }
        if (!result.ok || !this.isRunActive(runToken, pending.runEpoch)) {
            if (this.isRunActive(runToken, pending.runEpoch)) {
                await this.failRun(
                    'Could not persist conversation inventory progress after resume.',
                    'conversation_progress_persist_failed',
                    false
                );
            }
            return false;
        }
        this.pendingNavigation = pending;
        return true;
    }

    async refreshProcessedIds(runToken = this.runToken) {
        const storedResult = await safeChromeStorageGet('local', [
            'processedIds',
            'processedLocalIds',
            'processedR2Ids'
        ], {}, 'refresh processed destination receipts');
        if (storedResult.invalidated) {
            this.handleExtensionContextInvalidated();
            return false;
        }
        if (!this.isRunActive(runToken)) return false;
        this.processedIds = new Set(Array.isArray(storedResult.value.processedIds)
            ? storedResult.value.processedIds
            : []);
        this.processedLocalIds = new Set(Array.isArray(storedResult.value.processedLocalIds)
            ? storedResult.value.processedLocalIds
            : []);
        this.processedR2Ids = new Set(Array.isArray(storedResult.value.processedR2Ids)
            ? storedResult.value.processedR2Ids
            : []);
        this.rebuildLegacyUnscopedProcessedIds();
        return true;
    }

    async fetchTerminalConversationInventory(conversationId, runToken = this.runToken) {
        const runEpoch = this.runEpoch;
        const startedAt = Date.now();
        let lastProgressAt = startedAt;
        let priorSignature = '';
        while (this.isRunActive(runToken, runEpoch)) {
            const inventory = await fetchGrokConversationAssetInventoryViaBridge(conversationId);
            if (!this.isRunActive(runToken, runEpoch)) return null;
            const inflightIds = Array.isArray(inventory.inflightResponses)
                ? inventory.inflightResponses.map((response) => response.responseId).filter(Boolean)
                : [];
            const inflightCount = Math.max(
                Number(inventory.inflightResponseCount || 0),
                inflightIds.length
            );
            if (inflightCount === 0) return inventory;
            const signature = `${inflightCount}:${inflightIds.join('|')}`;
            if (signature !== priorSignature) {
                priorSignature = signature;
                lastProgressAt = Date.now();
            }
            if (Date.now() - startedAt >= 10 * 60 * 1000
                || Date.now() - lastProgressAt >= 2 * 60 * 1000) {
                const error = new Error('conversation_inventory_inflight_timeout');
                error.code = 'conversation_inventory_inflight_timeout';
                throw error;
            }
            await this.sleep(500);
        }
        return null;
    }

    async processPendingConversationInventory(runToken = this.runToken) {
        const pending = this.pendingNavigation;
        if (
            !pending
            || pending.runToken !== runToken
            || pending.runEpoch !== this.runEpoch
            || !pending.expectedIdentity
        ) {
            await this.failRun(
                'Saved media inventory resumed without its conversation identity.',
                'conversation_inventory_context_missing'
            );
            return;
        }
        if (!this.isRunActive(runToken, pending.runEpoch)) return;
        const startingSurface = this.getCurrentSurface();
        const supportedSurface = startingSurface === SCRAPE_SURFACES.savedGallery
            || startingSurface === SCRAPE_SURFACES.agentMedia
            || startingSurface === SCRAPE_SURFACES.legacyDetail;
        if (!supportedSurface) {
            await this.failRun(
                'Conversation inventory processing reached an unsupported Grok surface.',
                'conversation_inventory_surface_changed'
            );
            return;
        }
        if (startingSurface === SCRAPE_SURFACES.savedGallery
            && !await this.ensureSavedGalleryAllScope(runToken)) return;

        const conversationId = pending.conversationId || getGrokConversationId(window.location.href);
        if (!conversationId) {
            await this.failRun(
                'Could not identify the Saved conversation needed to inventory all media.',
                'conversation_identity_missing'
            );
            return;
        }
        if (!await this.ensureRunDestinationContract(runToken)) return { status: 'stopped' };
        const boundedAttempt = await this.recordBoundedConversationAttempt(conversationId, runToken);
        if (boundedAttempt.status !== 'ok') return { status: 'stopped' };

        let inventory;
        try {
            inventory = await this.fetchTerminalConversationInventory(conversationId, runToken);
        } catch (error) {
            if (!this.isRunActive(runToken, pending.runEpoch)) return;
            const detail = error?.code || error?.message || 'inventory_failed';
            if (detail === 'conversation_asset_unrecognized_media_shape') {
                await this.failRun(
                    'Grok returned a media shape Sync cannot inventory safely.',
                    'conversation_inventory_shape_unsupported'
                );
                return { status: 'stopped' };
            }
            return this.recordRecoverableSavedEntryFailure(
                pending,
                detail === 'conversation_inventory_inflight_timeout'
                    ? 'conversation_inventory_inflight_timeout'
                    : 'conversation_inventory_failed',
                `Could not inventory every asset in the selected Saved entry (${detail}).`,
                runToken
            );
        }
        if (!inventory || !this.isRunActive(runToken, pending.runEpoch)) return { status: 'stopped' };
        if (startingSurface === SCRAPE_SURFACES.savedGallery
            && !await this.ensureSavedGalleryAllScope(runToken)) return;

        const selectedAssetIndex = inventory.assets.findIndex((asset) => asset.assetId === pending.expectedIdentity);
        if (selectedAssetIndex < 0) {
            await this.failRun(
                'The selected Saved preview was not present in its authoritative conversation inventory.',
                'conversation_inventory_selected_asset_missing'
            );
            return;
        }
        let inventoryHash;
        try {
            inventoryHash = await hashGrokConversationAssetInventory(inventory);
        } catch (error) {
            if (!this.isRunActive(runToken, pending.runEpoch)) return;
            await this.failRun(
                `Could not verify the Saved conversation inventory (${error?.message || 'inventory_hash_failed'}).`,
                'conversation_inventory_failed'
            );
            return;
        }
        const assetIds = inventory.assets.map((asset) => asset.assetId);
        if (Array.isArray(pending.assetIds) && pending.assetIds.length) {
            const sameAssetIds = pending.assetIds.length === assetIds.length
                && pending.assetIds.every((assetId, index) => assetId === assetIds[index]);
            if (!sameAssetIds || pending.inventoryHash !== inventoryHash) {
                await this.failRun(
                    'The selected Saved conversation changed while Sync was active. Restart Sync to re-inventory it.',
                    'conversation_inventory_changed'
                );
                return;
            }
            const existingDurability = await this.queryRunDurabilitySnapshot(runToken);
            if (!this.isRunActive(runToken, pending.runEpoch)) return;
            if (existingDurability.status === 'pending') {
                const settled = await this.waitForRunDurability(runToken, {
                    timeoutMs: this.backupMode ? 300000 : 180000
                });
                if (!this.isRunActive(runToken, pending.runEpoch)) return;
                if (settled.status !== 'durable') {
                    if (settled.status === 'ignored') {
                        await this.failRun(
                            'Resumed conversation transfer authority was lost.',
                            'stale_authority',
                            false
                        );
                        return { status: 'stopped' };
                    }
                    return this.recordRecoverableSavedEntryFailure(
                        pending,
                        settled.status === 'timeout' ? 'durability_timeout' : 'durability_failed',
                        'Resumed conversation transfers did not settle before retry.',
                        runToken
                    );
                }
            } else if (existingDurability.status !== 'durable') {
                if (existingDurability.status === 'ignored') {
                    await this.failRun(
                        'Resumed conversation transfer authority was lost.',
                        'stale_authority',
                        false
                    );
                    return { status: 'stopped' };
                }
                return this.recordRecoverableSavedEntryFailure(
                    pending,
                    'durability_failed',
                    'Resumed conversation transfers are not in a retry-safe state.',
                    runToken
                );
            }
        }

        if (!await this.refreshProcessedIds(runToken)) return;
        const firstMissingProcessedIndex = assetIds.findIndex((assetId) => (
            !this.isAssetDestinationSatisfied(assetId)
        ));
        const firstUnconfirmedIndex = firstMissingProcessedIndex < 0
            ? assetIds.length
            : firstMissingProcessedIndex;
        let activePending = {
            ...pending,
            conversationId: inventory.conversationId,
            entryRunKey: `conversation:${inventory.conversationId}`,
            inventoryHash,
            assetIds,
            inventoryProgressVersion: 2,
            nextAssetIndex: firstUnconfirmedIndex
        };
        if (!await this.persistPendingConversationProgress(
            activePending,
            'save conversation inventory progress',
            runToken
        )) return;

        const isTargetedCanary = this.backupMode
            && this.backupOptions?.mode === 'canary'
            && getGrokMediaIdentity(this.backupOptions?.options?.targetIdentity);
        const indexes = isTargetedCanary
            ? [selectedAssetIndex]
            : inventory.assets.map((_asset, index) => index)
                .filter((index) => index >= activePending.nextAssetIndex);
        for (const index of indexes) {
            if (!this.isRunActive(runToken, activePending.runEpoch)) return;
            if (this.getCurrentSurface() !== startingSurface) {
                await this.failRun(
                    'Grok changed surfaces while a conversation inventory was being transferred.',
                    'conversation_inventory_surface_changed'
                );
                return;
            }
            if (startingSurface === SCRAPE_SURFACES.savedGallery
                && !await this.ensureSavedGalleryAllScope(runToken)) return;
            const asset = inventory.assets[index];
            const alreadyTerminal = this.isAssetDestinationSatisfied(asset.assetId);
            if (!alreadyTerminal && !this._runVisited.has(`asset:${asset.assetId}`)) {
                if (this.backupMode && !this._backupVisited.has(asset.assetId)) {
                    this._backupVisited.add(asset.assetId);
                    this.backupStats.totalSeen++;
                    if (!await this.persistBackupProgress(runToken)) return;
                }
                const captureMetadata = buildCaptureMetadataFromConversationAsset(inventory, asset);
                const response = await this.performDownload(
                    createConversationAssetMediaDescriptor(asset),
                    asset.assetId,
                    runToken,
                    captureMetadata
                );
                if (!this.isRunActive(runToken, activePending.runEpoch)) return;
                if (!isSuccessfulMediaTransferStatus(response?.status)) {
                    return this.recordRecoverableSavedEntryFailure(
                        activePending,
                        'media_transfer_failed',
                        response?.error || 'A conversation asset could not be transferred.',
                        runToken
                    );
                }
                this._runVisited.add(`asset:${asset.assetId}`);
                if (shouldPersistBackupProcessedId(response.status)) {
                    if (!await this.refreshProcessedIds(runToken)) return { status: 'stopped' };
                }
            }

            if (!isTargetedCanary) {
                const nextMissingIndex = assetIds.findIndex((assetId) => (
                    !this.isAssetDestinationSatisfied(assetId)
                ));
                const nextConfirmedIndex = nextMissingIndex < 0 ? assetIds.length : nextMissingIndex;
                if (nextConfirmedIndex !== activePending.nextAssetIndex) {
                    activePending = { ...activePending, nextAssetIndex: nextConfirmedIndex };
                    if (!await this.persistPendingConversationProgress(
                        activePending,
                        'advance durable conversation inventory progress',
                        runToken
                    )) return;
                }
            }

            const canaryStopReason = getR2BackupCanaryStopReason(this.backupOptions, this.backupStats);
            if (this.backupMode && canaryStopReason) {
                await this.stopBackupMode(canaryStopReason);
                return;
            }
        }

        const durability = await this.waitForRunDurability(runToken, {
            timeoutMs: this.backupMode ? 300000 : 180000
        });
        if (!this.isRunActive(runToken, activePending.runEpoch)) return;
        if (durability.status !== 'durable') {
            const reason = durability.status === 'timeout'
                ? 'durability_timeout'
                : (durability.status === 'ignored' ? 'stale_authority' : 'durability_failed');
            if (reason === 'stale_authority') {
                await this.failRun(
                    'Conversation transfer authority was lost.',
                    reason,
                    false
                );
                return { status: 'stopped' };
            }
            return this.recordRecoverableSavedEntryFailure(
                activePending,
                reason,
                'Conversation asset transfers did not become durable.',
                runToken
            );
        }
        if (!await this.refreshProcessedIds(runToken)) return;
        const requiredAssetIds = isTargetedCanary
            ? [inventory.assets[selectedAssetIndex].assetId]
            : assetIds;
        const missingReceipt = requiredAssetIds.find((assetId) => (
            !this.isAssetDestinationSatisfied(assetId)
        ));
        if (missingReceipt) {
            const missingIndex = assetIds.indexOf(missingReceipt);
            activePending = {
                ...activePending,
                nextAssetIndex: Math.max(0, missingIndex)
            };
            if (!await this.persistPendingConversationProgress(
                activePending,
                'rewind conversation inventory to missing receipt',
                runToken
            )) return;
            return this.recordRecoverableSavedEntryFailure(
                activePending,
                'conversation_asset_receipt_missing',
                'A conversation asset completed without a durable processed-ID receipt.',
                runToken
            );
        }

        const completedKeys = new Set([
            activePending.entryRunKey,
            activePending.sourceEntryRunKey,
            `conversation:${inventory.conversationId}`
        ].filter(Boolean));
        if (!await this.clearRecoverableSavedEntryFailure(activePending, runToken)) {
            if (this.isRunActive(runToken, activePending.runEpoch)) {
                await this.failRun(
                    'Could not clear the recovered Saved entry failure receipt.',
                    'scrape_failure_persist_failed',
                    false
                );
            }
            return { status: 'stopped' };
        }
        for (const key of completedKeys) {
            this._runVisited.add(key);
            if (this._savedScanPhase === 'verify') this._savedVerificationVisited.add(key);
        }
        if (activePending.sourceCardIdentity) {
            this.getSavedScanLedger().durableIdentities.add(activePending.sourceCardIdentity);
        }
        const completion = await this.recordDurableConversationCompletion(
            inventory.conversationId,
            runToken
        );
        if (completion.status !== 'ok' || !this.isRunActive(runToken, activePending.runEpoch)) {
            return { status: 'stopped' };
        }
        if (completion.limitReached) {
            this.log(
                `Bounded Sync reached ${completion.attemptedCount} attempted Saved entries (${completion.count} durable).`,
                this._scrapeFailures.size > 0 ? 'warning' : 'success'
            );
            await this.stop('entry_limit');
            return { status: 'stopped', entryLimitReached: true };
        }
        activePending = { ...activePending, nextAssetIndex: assetIds.length };
        if (startingSurface !== SCRAPE_SURFACES.savedGallery) {
            activePending = { ...activePending, inventoryComplete: true };
            if (!await this.persistPendingConversationProgress(
                activePending,
                'complete conversation inventory before Saved return',
                runToken
            )) return;
            await this.returnToSavedGallery(runToken);
            return this.isRunActive(runToken)
                ? { status: 'surface_changed' }
                : { status: 'stopped' };
        }
        const clearResult = await this.queueRunStateWrite({
            scrapeNavigation: null,
            currentItemId: null
        }, 'complete conversation inventory', { runToken, runEpoch: activePending.runEpoch });
        if (clearResult.invalidated) {
            this.handleExtensionContextInvalidated();
            return;
        }
        if (!clearResult.ok || !this.isRunActive(runToken, activePending.runEpoch)) return;
        this.pendingNavigation = null;
        return { status: 'completed' };
    }

    async waitForMatchingAgentMedia(expectedIdentity, runToken = this.runToken) {
        const startedAt = Date.now();
        let lastResult = { status: 'missing', media: null, sourceUrl: '' };
        while (this.isRunActive(runToken) && Date.now() - startedAt < this.Config.surfaceWait) {
            lastResult = findMatchingAgentMedia(document, expectedIdentity);
            if (lastResult.status === 'matched') return lastResult;
            await this.sleep(200);
        }
        return lastResult;
    }

    async waitForConversationId(runToken = this.runToken, timeout = this.Config.surfaceWait) {
        const startedAt = Date.now();
        while (this.isRunActive(runToken) && Date.now() - startedAt < timeout) {
            const conversationId = getGrokConversationId(window.location.href);
            if (conversationId) return conversationId;
            await this.sleep(200);
        }
        return getGrokConversationId(window.location.href);
    }

    async waitForMatchingLegacyDetailMedia(expectedIdentity, runToken = this.runToken) {
        const startedAt = Date.now();
        while (this.isRunActive(runToken) && Date.now() - startedAt < this.Config.surfaceWait) {
            const media = selectMatchingLegacyDetailMedia(document, expectedIdentity);
            if (media) return media;
            await this.sleep(200);
        }
        return null;
    }

    async executeAgentView(runToken = this.runToken) {
        if (!this.isRunActive(runToken)) return;
        const pending = this.pendingNavigation;
        if (
            !pending
            || pending.runToken !== runToken
            || pending.runEpoch !== this.runEpoch
            || !pending.expectedIdentity
        ) {
            await this.failRun('Agent Mode opened without a pending Saved media identity.', 'agent_identity_missing');
            return;
        }

        const conversationId = pending.conversationId || await this.waitForConversationId(runToken);
        if (conversationId) {
            if (pending.conversationId !== conversationId) {
                const updatedPending = {
                    ...pending,
                    conversationId,
                    entryRunKey: `conversation:${conversationId}`
                };
                if (!await this.persistPendingConversationProgress(
                    updatedPending,
                    'save Agent conversation identity',
                    runToken
                )) return;
            }
            await this.processPendingConversationInventory(runToken);
            return;
        }
        if (!this.isRunActive(runToken)) return;
        await this.failRun(
            'Agent Mode did not expose the Saved conversation identity needed to inventory every asset.',
            'conversation_identity_missing'
        );
    }

    async returnToSavedGallery(runToken = this.runToken, options = {}) {
        if (!this.isRunActive(runToken)) return;
        const stopBackupReason = typeof options.stopBackupReason === 'string'
            ? options.stopBackupReason
            : null;
        const galleryUrl = this.pendingNavigation?.galleryUrl;
        const returnContext = {
            runToken,
            runEpoch: this.runEpoch,
            galleryUrl,
            viewportRestored: false
        };
        this._returnToSavedInFlight = returnContext;
        try {
            this.log('Returning to Saved...', 'neutral');
            window.history.back();
            const returnedSurface = await this.waitForSurface(
                (surface) => surface === SCRAPE_SURFACES.savedGallery,
                runToken,
                this.Config.historyWait || 1500
            );
            if (!this.isRunActive(runToken)) return;
            if (returnedSurface) {
                if (!await this.ensureSavedGalleryAllScope(runToken)) return;
                this.state.mode = 'LIST';
                const restored = await this.restorePendingGalleryContext(runToken);
                if (!restored || !this.isRunActive(runToken)) return;
                if (!stopBackupReason) {
                    return { status: 'returned' };
                }
                await this.stopBackupMode(stopBackupReason);
                return;
            }
            if (!galleryUrl) {
                await this.failRun('Could not return to Grok Imagine Saved.', 'gallery_return_failed');
                return;
            }
            try {
                this.navigateToGalleryUrl(galleryUrl);
            } catch {
                await this.failRun('Could not return to Grok Imagine Saved.', 'gallery_return_failed');
                return;
            }
            const fallbackSurface = await this.waitForSurface(
                (surface) => surface === SCRAPE_SURFACES.savedGallery,
                runToken,
                this.Config.surfaceWait
            );
            if (!this.isRunActive(runToken)) return;
            if (!fallbackSurface) {
                await this.failRun('Could not return to Grok Imagine Saved.', 'gallery_return_failed');
                return;
            }
            if (!await this.ensureSavedGalleryAllScope(runToken)) return;
            this.state.mode = 'LIST';
            const restored = await this.restorePendingGalleryContext(runToken);
            if (!restored || !this.isRunActive(runToken)) return;
            if (stopBackupReason) await this.stopBackupMode(stopBackupReason);
            else return { status: 'returned' };
        } finally {
            if (this._returnToSavedInFlight === returnContext) this._returnToSavedInFlight = null;
        }
    }

    captureStopNavigation(runToken, runEpoch, fallbackNavigation = null) {
        const pending = this.pendingNavigation || fallbackNavigation;
        if (
            !runToken
            || !Number.isInteger(runEpoch)
            || !pending
            || pending.runToken !== runToken
            || pending.runEpoch !== runEpoch
            || !pending.galleryUrl
        ) return null;
        const returnInFlight = this._returnToSavedInFlight;
        return {
            runToken,
            runEpoch,
            galleryUrl: pending.galleryUrl,
            savedViewportReceipt: pending.savedViewportReceipt || null,
            viewportRestored: returnInFlight?.viewportRestored === true,
            returnAlreadyInFlight: Boolean(
                returnInFlight
                && returnInFlight.runToken === runToken
                && returnInFlight.runEpoch === runEpoch
            )
        };
    }

    async returnToSavedAfterStop(stopNavigation) {
        if (!stopNavigation) return false;
        const cleanupKey = `${stopNavigation.runEpoch}:${stopNavigation.runToken}`;
        if (this._activeStopReturn?.key === cleanupKey) return this._activeStopReturn.promise;

        const activeReturn = { key: cleanupKey, promise: null };
        this._activeStopReturn = activeReturn;
        activeReturn.promise = (async () => {
            const timeoutMs = this.Config.historyWait || 1500;
            const isCurrent = () => (
                this._activeStopReturn === activeReturn
                && !this.state.isRunning
            );
            const waitForSaved = async (waitMs = timeoutMs) => {
                const deadline = Date.now() + waitMs;
                while (isCurrent() && Date.now() < deadline) {
                    if (this.getCurrentSurface() === SCRAPE_SURFACES.savedGallery) return true;
                    await this.sleep(100);
                }
                return this.getCurrentSurface() === SCRAPE_SURFACES.savedGallery;
            };

            let surface = this.getCurrentSurface();
            if (surface === SCRAPE_SURFACES.savedGallery && !stopNavigation.returnAlreadyInFlight) {
                await this.sleep(Math.min(this.Config.navWait || 800, timeoutMs, 800));
                if (!isCurrent()) return false;
                surface = this.getCurrentSurface();
            }
            if (
                surface !== SCRAPE_SURFACES.savedGallery
                && !stopNavigation.returnAlreadyInFlight
            ) window.history.back();

            const returned = surface === SCRAPE_SURFACES.savedGallery
                || await waitForSaved(timeoutMs);
            if (!isCurrent()) return false;
            if (!returned) {
                this.navigateToGalleryUrl(stopNavigation.galleryUrl);
                if (!await waitForSaved(this.Config.surfaceWait || 5000)) return false;
                if (!isCurrent()) return false;
            }

            const receipt = normalizeSavedViewportReceipt(stopNavigation.savedViewportReceipt || {});
            const galleryContext = receipt ? getSavedGalleryContext(document) : null;
            if (
                !stopNavigation.viewportRestored
                && galleryContext
                && hasOrderedSavedNeighborhood(galleryContext.entries, receipt)
            ) {
                setSavedGalleryScrollTop(galleryContext.scroller, receipt.scrollTop);
            }
            return true;
        })();

        try {
            return await activeReturn.promise;
        } finally {
            if (this._activeStopReturn === activeReturn) this._activeStopReturn = null;
        }
    }

    navigateToGalleryUrl(galleryUrl) {
        window.location.assign(galleryUrl);
    }

    async executeDetailView(runToken = this.runToken) {
        if (!this.isRunActive(runToken)) return;

        let pendingConversationId = this.pendingNavigation?.conversationId || '';
        if (this.pendingNavigation?.expectedIdentity && !pendingConversationId) {
            pendingConversationId = await this.waitForConversationId(runToken);
        }
        if (this.pendingNavigation?.expectedIdentity && pendingConversationId) {
            if (this.pendingNavigation.conversationId !== pendingConversationId) {
                const updatedPending = {
                    ...this.pendingNavigation,
                    conversationId: pendingConversationId,
                    entryRunKey: `conversation:${pendingConversationId}`
                };
                if (!await this.persistPendingConversationProgress(
                    updatedPending,
                    'save detail conversation identity',
                    runToken
                )) return;
            }
            await this.processPendingConversationInventory(runToken);
            return;
        }
        if (this.pendingNavigation?.expectedIdentity) {
            if (!this.isRunActive(runToken)) return;
            await this.recordRecoverableSavedEntryFailure(
                this.pendingNavigation,
                'conversation_identity_missing',
                'Detail view did not expose the Saved conversation identity needed to inventory every asset.',
                runToken
            );
            return;
        }

        // Deduplication
        const storedStateResult = await safeChromeStorageGet('local', ['currentItemId'], {}, 'load current item ID');
        if (storedStateResult.invalidated) {
            this.handleExtensionContextInvalidated();
            return;
        }
        const storedState = storedStateResult.value;
        let currentId = this.pendingNavigation?.currentItemId || storedState.currentItemId;
        const expectedIdentity = this.pendingNavigation?.expectedIdentity || getGrokMediaIdentity(currentId);
        if (!currentId) {
            const mediaEl = selectBackupMediaElement(document);
            if (mediaEl) {
                const src = getBackupMediaElementSrc(mediaEl);
                currentId = this.getCleanId(src);
            }
        }

        if (currentId && this.backupMode) {
            this._backupVisited.add(currentId);
            this.backupStats.totalSeen++;
            await this.persistBackupProgress(runToken);
            if (!this.isRunActive(runToken)) return;
        }

        this.log('Processing selected Saved media...');
        const matchedMediaEl = await this.waitForMatchingLegacyDetailMedia(expectedIdentity, runToken);
        if (!this.isRunActive(runToken)) return;
        const mediaEl = matchedMediaEl || createVerifiedSavedMediaFallback(this.pendingNavigation);
        if (!mediaEl) {
            await this.recordRecoverableSavedEntryFailure(
                this.pendingNavigation,
                'legacy_media_missing',
                'Legacy detail view did not expose the selected Saved media.',
                runToken
            );
            return;
        }
        if (!matchedMediaEl) {
            this.log(
                `Detail media differed; transferring the exact Saved ${this.pendingNavigation.expectedMediaType} source.`,
                'warning'
            );
        }
        const response = await this.performDownload(mediaEl, currentId, runToken);
        if (!this.isRunActive(runToken)) return;
        if (!isSuccessfulMediaTransferStatus(response?.status)) {
            await this.recordRecoverableSavedEntryFailure(
                this.pendingNavigation,
                'media_transfer_failed',
                response?.error || 'Legacy media download failed.',
                runToken
            );
            return;
        }
        const canaryStopReason = getR2BackupCanaryStopReason(this.backupOptions, this.backupStats);
        if (this.backupMode && canaryStopReason) {
            await this.returnToSavedGallery(runToken, { stopBackupReason: canaryStopReason });
            return;
        }

        if (!this.backupMode) {
            const durability = await this.waitForRunDurability(runToken, { timeoutMs: 180000 });
            if (!this.isRunActive(runToken)) return;
            if (durability.status !== 'durable' || !await this.refreshProcessedIds(runToken)) {
                if (durability.status === 'ignored') {
                    await this.failRun(
                        'Legacy media transfer authority was lost.',
                        'stale_authority',
                        false
                    );
                    return;
                }
                await this.recordRecoverableSavedEntryFailure(
                    this.pendingNavigation,
                    durability.status === 'timeout' ? 'durability_timeout' : 'durability_failed',
                    'Legacy media transfer did not become durable.',
                    runToken
                );
                return;
            }
            if (!this.isAssetDestinationSatisfied(expectedIdentity || currentId)) {
                await this.recordRecoverableSavedEntryFailure(
                    this.pendingNavigation,
                    'conversation_asset_receipt_missing',
                    'Legacy media transfer completed without its destination receipt.',
                    runToken
                );
                return;
            }
        }
        if (!await this.clearRecoverableSavedEntryFailure(this.pendingNavigation, runToken)) {
            if (this.isRunActive(runToken)) {
                await this.failRun(
                    'Could not clear the recovered Saved entry failure receipt.',
                    'scrape_failure_persist_failed',
                    false
                );
            }
            return;
        }
        const completedKeys = [
            this.pendingNavigation?.entryRunKey,
            this.pendingNavigation?.sourceEntryRunKey,
            currentId
        ].filter(Boolean);
        for (const key of completedKeys) {
            this._runVisited.add(key);
            if (this._savedScanPhase === 'verify') this._savedVerificationVisited.add(key);
        }
        if (!this.isRunActive(runToken)) return;
        await this.returnToSavedGallery(runToken);
    }

    _getVideoSrc(videoEl) {
        if (!videoEl) return null;
        return videoEl.src || videoEl.currentSrc || videoEl.querySelector?.('source')?.src || null;
    }

    async loadAuthoritativeCaptureMetadata(mediaIdentity, runToken = this.runToken) {
        if (!this.isRunActive(runToken)) throw new Error('Sync stopped.');
        const assetId = getGrokMediaIdentity(mediaIdentity);
        const conversationId = this.pendingNavigation?.conversationId
            || getGrokConversationId(window.location.href);
        if (!assetId || !conversationId) throw new Error('asset_metadata_identity_missing');
        const metadata = await fetchGrokAssetMetadataViaBridge(conversationId, assetId);
        if (!this.isRunActive(runToken)) throw new Error('Sync stopped.');
        return metadata;
    }

    async performBackupUpload(
        mediaEl = null,
        currentItemId = null,
        runToken = this.runToken,
        captureMetadataOverride = null
    ) {
        if (!this.isRunActive(runToken)) return { status: 'error', error: 'Backup stopped.' };

        const mediaStart = Date.now();
        while (!mediaEl && this.isRunActive(runToken) && Date.now() - mediaStart < 3000) {
            mediaEl = selectBackupMediaElement(document);
            if (mediaEl && getBackupMediaElementSrc(mediaEl)) break;
            await this.sleep(200);
        }

        const src = getBackupMediaElementSrc(mediaEl);
        const isVideo = mediaEl?.tagName?.toLowerCase() === 'video';

        console.log('[BackupUpload]', isVideo ? 'VIDEO' : 'IMAGE', formatBackupMediaLog('preparing', src));

        if (!src) {
            this.backupStats.errors++;
            this.log('No media element found for backup.', 'error');
            return { status: 'error', error: 'No media element found for backup.' };
        }

        try {
            let captureMetadata;
            try {
                captureMetadata = captureMetadataOverride
                    || await this.loadAuthoritativeCaptureMetadata(src, runToken);
            } catch (error) {
                if (!this.isRunActive(runToken)) return { status: 'error', error: 'Backup stopped.' };
                this.backupStats.errors++;
                this.log('Could not prove the selected Saved asset metadata. Backup stopped.', 'error');
                return { status: 'error', error: error?.message || 'asset_metadata_failed' };
            }
            if (!this.isRunActive(runToken)) return { status: 'error', error: 'Backup stopped.' };
            const promptText = captureMetadata.promptText || '';
            const presenceResult = await safeChromeRuntimeSendMessage({
                action: 'R2_BACKUP_CHECK_PRESENT',
                runToken,
                runEpoch: this.runEpoch,
                kind: 'r2_backup',
                url: src,
                isVideo,
                promptText,
                captureMetadata,
                acceptance: this.backupOptions && this.backupOptions.acceptance
            }, 'check R2 backup presence');
            if (presenceResult.invalidated) {
                this.handleExtensionContextInvalidated();
                return { status: 'error', error: EXTENSION_CONTEXT_REFRESHED_MESSAGE };
            }
            if (!this.isRunActive(runToken)) return { status: 'error', error: 'Backup stopped.' };
            const presence = presenceResult.value;
            if (presence?.status === 'already_present') {
                return this.recordDurableBackupResult(presence, src, currentItemId, runToken);
            }
            if (presence?.status !== 'missing') {
                return this.recordDurableBackupResult({
                    status: 'error',
                    error: presence?.error || 'r2_presence_check_failed'
                }, src, currentItemId, runToken);
            }

            const alreadyLocal = this.hasDestinationReceipt(src, 'local')
                || this.hasDestinationReceipt(currentItemId, 'local');
            let blobData = null;
            try {
                if (isVideo) throw new Error('stage_video_download');
                const result = await fetchMediaDataUrlViaBridge(src);
                blobData = result.tooLarge ? null : result.dataUrl;
                console.log('[BackupUpload]', formatBackupMediaLog(
                    result.tooLarge ? 'staging_download' : 'bridge_fetched',
                    src,
                    { bytes: result.size }
                ));
            } catch (error) {
                if (error?.message === 'stage_video_download') {
                    console.log('[BackupUpload]', formatBackupMediaLog('staging_download', src));
                } else {
                console.warn('[BackupUpload]', formatBackupMediaLog('bridge_retry', src));
                }
            }

            if (!this.isRunActive(runToken)) return { status: 'error', error: 'Backup stopped.' };

            const responseResult = await safeChromeRuntimeSendMessage({
                action: 'R2_BACKUP_UPLOAD',
                runToken,
                runEpoch: this.runEpoch,
                kind: 'r2_backup',
                url: src,
                isVideo,
                promptText,
                captureMetadata,
                blobDataUrl: blobData,
                skipLocalDownload: alreadyLocal,
                acceptance: this.backupOptions && this.backupOptions.acceptance
            }, 'upload R2 backup');
            if (responseResult.invalidated) {
                this.handleExtensionContextInvalidated();
                return { status: 'error', error: EXTENSION_CONTEXT_REFRESHED_MESSAGE };
            }
            const response = responseResult.value;
            if (!this.isRunActive(runToken)) return { status: 'error', error: 'Backup stopped.' };
            return this.recordDurableBackupResult(response, src, currentItemId, runToken);
        } catch {
            this.backupStats.errors++;
            return {
                status: 'error',
                error: formatBackupMediaError('backup_runtime', 'backup_failed', src)
            };
        }
    }

    async recordDurableBackupResult(response, src, currentItemId, runToken = this.runToken) {
        if (!this.isRunActive(runToken)) return { status: 'error', error: 'Backup stopped.' };
        if (recordBackupUploadStatus(this.backupStats, response?.status)) {
            const actionLabel = response.status === 'queued'
                ? 'Queued for R2'
                : (response.status === 'already_present' ? 'Already in R2' : 'Uploaded to R2');
            this.log(
                `${actionLabel}: ${formatBackupMediaLog(response.status, src)}`,
                response.status === 'conflict_uploaded' ? 'warning' : 'success'
            );
            const cleanId = this.getCleanId(src);
            if (cleanId && shouldPersistBackupProcessedId(response.status)) {
                const ids = [
                    currentItemId,
                    cleanId,
                    response.backupProcessedId,
                    response.assetId
                ].filter(Boolean);
                const mutationResult = await safeChromeRuntimeSendMessage({
                    action: 'SCRAPE_DESTINATION_RECEIPTS_ADD',
                    r2Ids: ids,
                    runToken,
                    runEpoch: this.runEpoch,
                    kind: 'r2_backup'
                }, 'save backup processed IDs');
                if (mutationResult.invalidated) {
                    this.handleExtensionContextInvalidated();
                    return { status: 'error', error: EXTENSION_CONTEXT_REFRESHED_MESSAGE };
                }
                if (!this.isRunActive(runToken)) return { status: 'error', error: 'Backup stopped.' };
                if (mutationResult.value?.status !== 'ok') {
                    return { status: 'error', error: 'processed_ids_mutation_failed' };
                }
                if (!await this.refreshProcessedIds(runToken)) {
                    return { status: 'error', error: 'processed_receipts_refresh_failed' };
                }
            }
        } else {
            this.backupStats.errors++;
            this.log(`Backup failed: ${formatBackupMediaLog(response?.status || 'error', src)}`, 'error');
        }
        await this.persistBackupProgress(runToken);
        if (!this.isRunActive(runToken)) return { status: 'error', error: 'Backup stopped.' };
        await this.sleep(this.Config.actionWait);
        return response || { status: 'error', error: 'R2 backup returned no response.' };
    }

    async performDownload(
        mediaEl = null,
        currentItemId = null,
        runToken = this.runToken,
        captureMetadataOverride = null
    ) {
        if (!this.isRunActive(runToken)) return { status: 'error', error: 'Sync stopped.' };
        if (this.backupMode) {
            return this.performBackupUpload(
                mediaEl,
                currentItemId,
                runToken,
                captureMetadataOverride
            );
        }

        if (mediaEl) {
            const src = getBackupMediaElementSrc(mediaEl);
            if (!src) return { status: 'error', error: 'Agent media URL is missing.' };
            const isVideo = mediaEl.tagName?.toLowerCase() === 'video';
            const configResult = await safeChromeRuntimeSendMessage({ action: 'GET_CLOUD_CONFIG' }, 'load media transfer mode');
            if (configResult.invalidated) {
                this.handleExtensionContextInvalidated();
                return { status: 'error', error: EXTENSION_CONTEXT_REFRESHED_MESSAGE };
            }
            if (!this.isRunActive(runToken)) return { status: 'error', error: 'Sync stopped.' };

            const cloudMode = configResult.value?.config?.mode;
            const currentDestinations = getSyncDestinationsForCloudMode(cloudMode);
            if (!scrapeDestinationsMatch(this.requiredDestinations, currentDestinations)) {
                return {
                    status: 'error',
                    error: 'Backup Mode changed while Sync was running.'
                };
            }
            const cloudOnly = cloudMode === 'cloud_only';
            const cloudEnabled = cloudOnly || cloudMode === 'dual_write';
            let captureMetadata = null;
            let promptText = '';
            if (cloudEnabled) {
                try {
                    captureMetadata = captureMetadataOverride
                        || await this.loadAuthoritativeCaptureMetadata(src, runToken);
                    promptText = captureMetadata.promptText || '';
                } catch (error) {
                    if (!this.isRunActive(runToken)) return { status: 'error', error: 'Sync stopped.' };
                    return { status: 'error', error: error?.message || 'asset_metadata_failed' };
                }
            }
            if (!this.isRunActive(runToken)) return { status: 'error', error: 'Sync stopped.' };
            let blobDataUrl = null;
            if (cloudOnly) {
                try {
                    if (!isVideo) {
                        const bridgeResult = await fetchMediaDataUrlViaBridge(src);
                        blobDataUrl = bridgeResult.tooLarge ? null : bridgeResult.dataUrl;
                    }
                } catch {
                    blobDataUrl = null;
                }
            }
            if (!this.isRunActive(runToken)) return { status: 'error', error: 'Sync stopped.' };

            const responseResult = await safeChromeRuntimeSendMessage({
                action: 'DOWNLOAD_MEDIA',
                runToken,
                runEpoch: this.runEpoch,
                kind: 'sync',
                url: src,
                isVideo,
                promptText,
                destinations: this.requiredDestinations,
                ...(captureMetadata ? { captureMetadata } : {}),
                blobDataUrl
            }, 'transfer Agent media');
            if (responseResult.invalidated) {
                this.handleExtensionContextInvalidated();
                return { status: 'error', error: EXTENSION_CONTEXT_REFRESHED_MESSAGE };
            }
            const response = responseResult.value || { status: 'error', error: 'Media transfer returned no response.' };
            if (isSuccessfulMediaTransferStatus(response.status)) {
                this.log(cloudOnly ? 'Uploaded to R2.' : 'Download queued.', 'success');
            }
            await this.sleep(this.Config.actionWait);
            return response;
        }

        // Click Download
        let downloadBtn = null;
        const start = Date.now();
        while (!downloadBtn && Date.now() - start < 5000) {
            if (!this.isRunActive(runToken)) return { status: 'error', error: 'Sync stopped.' };
            downloadBtn = document.querySelector('button[aria-label="Download"]')
                || document.querySelector('.lucide-download')
                || document.querySelector('[role="button"][aria-label="Download"]');
            if (!downloadBtn) await this.sleep(500);
        }

        if (downloadBtn) {
            this.log(`Downloading...`, 'success');
            let targetToClick = downloadBtn;
            if (['svg', 'path', 'line'].includes(downloadBtn.tagName.toLowerCase())) {
                const parentBtn = downloadBtn.closest('button');
                if (parentBtn) targetToClick = parentBtn;
            }
            ['mousedown', 'click', 'mouseup'].forEach(evt => {
                targetToClick.dispatchEvent(new MouseEvent(evt, { bubbles: true, cancelable: true, view: window }));
            });
            await this.sleep(this.Config.actionWait);
            return { status: 'queued' };
        } else {
            this.log('Download button missing.', 'error');
            return { status: 'error', error: 'Download button missing.' };
        }
    }

    async waitForSelector(selector, timeout = 5000) {
        const start = Date.now();
        while (Date.now() - start < timeout) {
            const el = document.querySelector(selector);
            if (el) return el;
            await this.sleep(500);
        }
        return null;
    }

    sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

    log(msg, type = 'neutral') {
        if (this.overlay) this.overlay.setStatus(msg, type);
        // Also log to background for legacy compatibility/debugging
        safeChromeRuntimeSendMessageSoon({ action: 'ADD_LOG', text: msg, type: type }, 'add log');
    }
}

if (typeof module === 'undefined') {
    const runtimeKey = '__gptPowerToolsRuntime';
    const createChatGptRuntime = (provider) => {
        const settings = new SettingsManager();
        const history = new PromptHistoryManager(settings);
        const noopScraper = {
            start: () => { },
            stop: () => { },
            setOverlay: () => { }
        };
        const noopRetry = {
            overlay: null,
            goalRunning: false,
            batchRunning: false,
            startGoal: () => { },
            startBatch: async () => { },
            startQualityRepeat: () => { },
            stopBatch: () => { },
            stopQualityRepeat: () => { }
        };
        const overlay = new GrokOverlay(noopScraper, noopRetry, settings, history, { provider });
        noopRetry.overlay = overlay;
        const runtime = {
            provider,
            settings,
            history,
            scraper: noopScraper,
            retry: noopRetry,
            overlay,
            chatGptRuntime: true
        };
        globalThis[runtimeKey] = runtime;
        registerExtensionContextInvalidationHandler(() => {
            history.setCaptureEnabled(false);
            overlay.handleExtensionContextInvalidated();
        });
        return runtime;
    };

    const createGrokRuntime = (provider) => {
        setupCurrentGrokSourceHintCapture();
        const settings = new SettingsManager();
        const history = new PromptHistoryManager(settings);
        const scraper = new GrokScraper();
        const retry = new VideoRetryManager(null, settings, history);
        const overlay = new GrokOverlay(scraper, retry, settings, history, { provider });
        const recreateBridge = new RecreateWorkflowContentBridge(overlay, history);
        recreateBridge.setupListeners();
        retry.overlay = overlay;
        retry.setupGenerationCancellationListener();
        scraper.setOverlay(overlay);
        globalThis[runtimeKey] = { provider, settings, history, scraper, retry, overlay, recreateBridge };
        registerExtensionContextInvalidationHandler(() => {
            recreateBridge.cancelAllOperations();
            retry.handleExtensionContextInvalidated();
            scraper.handleExtensionContextInvalidated();
            overlay.handleExtensionContextInvalidated();
        });
        setTimeout(async () => {
            await overlay.refreshActiveWorkflowStatus();
            retry.resumeGenerationRunIfNeeded().catch(() => {
                retry.safeStatus('Generation run status unavailable. Reload the page.', 'warning');
            });
        }, 0);
        return globalThis[runtimeKey];
    };

    if (location.hostname === 'chatgpt.com') {
        let lastUrl = '';
        const reconcileChatGptRoute = () => {
            if (!isExtensionContextActive()) return;
            if (location.href === lastUrl) return;
            lastUrl = location.href;
            const provider = detectCurrentProvider();
            let runtime = globalThis[runtimeKey];
            if (isChatGptImagesProvider(provider)) {
                runtime = runtime?.chatGptRuntime ? runtime : createChatGptRuntime(provider);
                runtime.provider = provider;
                runtime.overlay.provider = provider;
                runtime.overlay.applyProviderUi();
                runtime.history.setCaptureEnabled(true);
                runtime.overlay.el.style.display = '';
                return;
            }
            if (runtime?.chatGptRuntime) {
                runtime.provider = provider;
                runtime.overlay.provider = provider;
                runtime.history.setCaptureEnabled(false);
                runtime.overlay.el.style.display = 'none';
            }
        };
        reconcileChatGptRoute();
        window.addEventListener('popstate', reconcileChatGptRoute);
        window.addEventListener('hashchange', reconcileChatGptRoute);
        const routeInterval = setInterval(() => {
            if (!isExtensionContextActive()) {
                clearInterval(routeInterval);
                return;
            }
            reconcileChatGptRoute();
        }, 500);
    } else if (!globalThis[runtimeKey]) {
        const provider = detectCurrentProvider();
        if (isGrokProvider(provider)) createGrokRuntime(provider);
    }
} else {
    module.exports = {
        SettingsManager,
        GrokOverlay,
        VideoRetryManager,
        GrokScraper,
        initializeGrokScraperState,
        PromptHistoryManager,
        RecreateWorkflowContentBridge,
        SAVED_PROMPT_TYPES,
        SAVED_PROMPT_DELIMITER,
        sanitizeSavedPromptText,
        sanitizeSavedPromptName,
        normalizeSavedPrompts,
        filterSavedPrompts,
        promptContainsToken,
        mergePromptTextForAppend,
        appendSnippetAtCursor,
        getBackupMediaElementSrc,
        SCRAPE_SURFACES,
        SAVED_GALLERY_SCOPES,
        GALLERY_RECEIPT_VERSION,
        captureGalleryReceipt,
        captureSavedViewportReceipt,
        createSavedScanLedger,
        detectSavedGalleryScope,
        detectGrokScrapeSurface,
        evaluateGalleryReceipt,
        findMatchingAgentMedia,
        fetchGrokAssetMetadataViaBridge,
        fetchGrokConversationAssetInventoryViaBridge,
        normalizeGrokConversationAssetInventory,
        hashGrokConversationAssetInventory,
        buildCaptureMetadataFromConversationAsset,
        dispatchFullPointerClick,
        getSavedGalleryContext,
        getGrokConversationId,
        getGrokMediaIdentity,
        getSavedCardConversationId,
        hasOrderedSavedNeighborhood,
        isSavedGalleryLoading,
        isSuccessfulMediaTransferStatus,
        normalizeSavedViewportReceipt,
        recordSavedScan,
        shouldStopScraperForStorageChanges,
        fetchMediaDataUrlViaBridge,
        recordBackupUploadStatus,
        resolveBackupScrollAttempt,
        selectBackupMediaElement,
        selectMatchingLegacyDetailMedia,
        getR2BackupCanaryStopReason,
        getR2BackupPageCommandOptions,
        shouldPersistBackupProcessedId,
        EXTENSION_CONTEXT_REFRESHED_MESSAGE,
        isExtensionContextInvalidatedError,
        safeChromeStorageGet,
        safeChromeStorageSet,
        safeChromeRuntimeSendMessage
    };
}
})();
