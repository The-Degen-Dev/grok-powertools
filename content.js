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

const EXTENSION_CONTEXT_REFRESHED_MESSAGE = 'Grok Power Tools reloaded. Refresh this Grok tab before continuing.';

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
                    fallbackTimer = setTimeout(() => settle(undefined), 1000);
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
    if (target && typeof target.setStatus === 'function') {
        target.setStatus(EXTENSION_CONTEXT_REFRESHED_MESSAGE, 'error');
    }
}

// --- PAGE-WORLD BRIDGE ---
// Loads bridge.js in the page's MAIN world (bypasses CSP since it's a file, not inline).
// bridge.js provides access to TipTap editor and Grok's fetch via custom DOM events.
(function injectPageWorldBridge() {
    if (typeof module !== 'undefined') return;
    if (!isGrokProvider(detectCurrentProvider())) return;

    const script = document.createElement('script');
    const bridgeUrl = safeChromeRuntimeGetURL('bridge.js');
    if (!bridgeUrl) return;
    script.src = bridgeUrl;
    (document.head || document.documentElement).appendChild(script);

    // Listen for upload completion events from the page world
    document.addEventListener('__gpt_upload_complete', function(e) {
        window._lastUploadedImageUrl = e.detail && e.detail.imageUrl;
        console.log('GrokPowerTools: Captured uploaded image URL');
    });
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

function findMatchingAgentMedia(root = document, expectedIdentity = '') {
    const normalizedExpected = getGrokMediaIdentity(expectedIdentity);
    if (!normalizedExpected) return { status: 'missing', media: null, sourceUrl: '' };

    const matchingNodes = Array.from(root.querySelectorAll('.react-flow__node-asset'))
        .map((node) => {
            const candidates = Array.from(node.querySelectorAll('video, img'))
                .map((media) => ({ media, sourceUrl: getBackupMediaElementSrc(media) }))
                .filter((candidate) => candidate.sourceUrl && getGrokMediaIdentity(candidate.sourceUrl) === normalizedExpected);
            const preferred = candidates.find((candidate) => candidate.media.tagName?.toLowerCase() === 'video') || candidates[0];
            return preferred || null;
        })
        .filter(Boolean);

    if (matchingNodes.length === 1) return { status: 'matched', ...matchingNodes[0] };
    if (matchingNodes.length > 1) return { status: 'ambiguous', media: null, sourceUrl: '' };
    return { status: 'missing', media: null, sourceUrl: '' };
}

function findMediaCardRoot(element) {
    const listItem = element?.closest?.('[role="listitem"]');
    if (listItem?.querySelector('img[alt="Generated image"]')) return listItem;
    return element?.closest?.('[class*="media-post-masonry-card"]') || null;
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

async function fetchMediaDataUrlViaBridge(sourceUrl, root = document, timeoutMs = 30000) {
    const requestId = `fetch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const result = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            root.removeEventListener('__gpt_fetch_media_result', handleResult);
            reject(new Error('Bridge fetch timeout'));
        }, timeoutMs);
        function handleResult(event) {
            if (event.detail?.requestId !== requestId) return;
            root.removeEventListener('__gpt_fetch_media_result', handleResult);
            clearTimeout(timeout);
            if (event.detail.error) reject(new Error(event.detail.error));
            else resolve(event.detail);
        }
        root.addEventListener('__gpt_fetch_media_result', handleResult);
        root.dispatchEvent(new CustomEvent('__gpt_fetch_media', { detail: { url: sourceUrl, requestId } }));
    });

    if (result.blobUrl) {
        const blobResponse = await fetch(result.blobUrl);
        const blob = await blobResponse.blob();
        const reader = new FileReader();
        const dataUrl = await new Promise((resolve, reject) => {
            reader.onerror = () => reject(reader.error || new Error('Media encoding failed'));
            reader.onloadend = () => resolve(reader.result);
            reader.readAsDataURL(blob);
        });
        URL.revokeObjectURL(result.blobUrl);
        return { dataUrl, size: result.size || blob.size, type: result.type || blob.type };
    }
    if (result.dataUrl) return { dataUrl: result.dataUrl, size: result.size || 0, type: result.type || '' };
    throw new Error('Bridge fetch returned no media data');
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

function isBackupScrollerAtBottom(state) {
    return (state.scrollTop || 0) + (state.clientHeight || 0) >= (state.scrollHeight || 0) - 8;
}

function resolveBackupScrollAttempt({ before, after, beforeSignature, afterSignature, staleRetries = 0, maxStaleRetries = 30 }) {
    const scrollMoved = Math.abs((after.scrollTop || 0) - (before.scrollTop || 0)) > 1;
    const heightChanged = Math.abs((after.scrollHeight || 0) - (before.scrollHeight || 0)) > 1;
    const signatureChanged = beforeSignature !== afterSignature;
    const progressed = scrollMoved || heightChanged || signatureChanged;
    const atBottom = isBackupScrollerAtBottom(after);
    const nextStaleRetries = atBottom && !progressed ? staleRetries + 1 : 0;

    return {
        progressed,
        atBottom,
        nextStaleRetries,
        exhausted: nextStaleRetries >= maxStaleRetries
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
    return status === 'queued' || status === 'uploaded' || status === 'already_present' || status === 'conflict_uploaded';
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
            options: { stopAfterMediaAttempt: true },
            ...(acceptance ? { acceptance } : {})
        };
    }

    if (command.action !== 'INIT_R2_BACKUP' || command.mode !== 'canary') return null;

    const options = command.options && typeof command.options === 'object' ? command.options : {};
    return {
        mode: 'canary',
        limit: 1,
        options: { ...options, stopAfterMediaAttempt: true },
        ...(acceptance ? { acceptance } : {})
    };
}

function mergeBackupProcessedIdsForStorage(existingIds, inMemoryIds, nextId, responseBackupProcessedId = null) {
    const merged = new Set(Array.isArray(existingIds) ? existingIds : []);
    for (const id of (inMemoryIds || [])) {
        if (id) merged.add(id);
    }
    if (nextId) merged.add(nextId);
    if (responseBackupProcessedId) merged.add(responseBackupProcessedId);
    return Array.from(merged);
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
    set(key, value) { this.settings[key] = value; this.save(); this.notify(); }
    setAll(updates) { this.settings = { ...this.settings, ...updates }; this.save(); this.notify(); }
    save() { safeChromeStorageSet('sync', { gptGlobalSettings: this.settings }, 'save settings').catch(() => {}); }
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
                safeChromeStorageGet('local', ['processedIds'], {}, 'load imported processed IDs').then((result) => {
                    if (result.invalidated) return;
                    const existing = new Set(result.value.processedIds || []);
                    parsed.processedIds.forEach(id => existing.add(id));
                    safeChromeStorageSet('local', { processedIds: Array.from(existing) }, 'save imported processed IDs').catch(() => {});
                    console.log(`Imported ${parsed.processedIds.length} IDs. Total: ${existing.size}`);
                }).catch(console.error);
            }
            return true;
        }
        catch (e) { console.error(e); return false; }
    }
    reset() { this.settings = { ...SettingsDefaults }; this.save(); this.notify(); }
}

class PromptHistoryManager {
    constructor(settingsManager) {
        this.settingsManager = settingsManager;
        this.history = [];
        this.listeners = new Set();
        this.init();
        this.setupCapture();
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
            // Video Button
            const btn = e.target.closest('button[aria-label="Make video"]');
            if (btn) {
                console.log('GPT: Make Video clicked');
                this.captureCurrentPrompt('video', btn);
            }

            // Image Submit Button
            const submitBtn = e.target.closest('button[aria-label="Submit"]');
            if (submitBtn) {
                console.log('GPT: Submit clicked');
                this.captureCurrentPrompt(this.consumePromptCaptureHint() || 'image', submitBtn);
            }
        }, true); // <--- Capture Phase

        // Enter Key in Textarea
        window.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                const ta = e.target.closest('textarea');
                if (ta) {
                    console.log('GPT: Enter pressed with len', ta.value.length);
                    this.captureCurrentPrompt(this.consumePromptCaptureHint() || 'image', ta);
                }
            }
        }, true); // <--- Capture Phase
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
        const ta = document.querySelector('textarea[aria-required="true"]');
        const ce = document.querySelector('[contenteditable="true"]');

        // 1. Try Main Textarea first, then contenteditable
        if (ta && ta.value && ta.value.trim().length > 0) {
            text = ta.value.trim();
        } else if (ce && ce.textContent && ce.textContent.trim().length > 0) {
            text = ce.textContent.trim();
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

    add(text, type = 'image') {
        // De-duplicate if same text AND type
        if (this.history.length > 0 && this.history[0].text === text && this.history[0].type === type) {
            this.history[0].timestamp = Date.now();
        } else {
            this.history.unshift({
                id: Date.now().toString(),
                text: text,
                type: type,
                timestamp: Date.now()
            });
        }
        const limit = this.settingsManager.get('historyLimit') || 50;
        if (this.history.length > limit) this.history = this.history.slice(0, limit);
        this.save();
    }
    save() {
        safeChromeStorageSet('local', { promptHistory: this.history }, 'save history').catch(() => {});
        this.notify();
    }
    clear() { this.history = []; this.save(); }
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
        this.recreatePasteHandler = null;
        this.chatGptImageRunning = false;

        if (typeof document !== 'undefined') {
            this.render();
            this.setupListeners();
            this.restoreState();
            this.settingsManager.subscribe(s => this.onSettingsChange(s));
            this.historyManager.subscribe(h => this.renderHistoryList(h));
        }
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
            this.recreateAbortRequested = true;
            this.setRecreateStopping(true);
            this.setRecreateStatus('Stopping...', 'info');
            try {
                const result = await safeChromeRuntimeSendMessage({ action: 'ABORT_GPT_RECREATE' }, 'abort recreate workflow');
                if (result.invalidated) {
                    this.recreateAbortRequested = false;
                    this.setRecreateStopping(false);
                    this.setRecreateStatus(EXTENSION_CONTEXT_REFRESHED_MESSAGE, 'error');
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
        this.el.querySelector('#gptStartGoalBtn').addEventListener('click', () => {
            const count = parseInt(this.el.querySelector('#gptVideoGoal').value, 10);
            this.retryManager.startGoal(count);
        });
        this.el.querySelector('#gptQuickBatchBtn').addEventListener('click', async () => {
            await this.retryManager.startBatch('quick');
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
        this.el.querySelector('#gptBatchStopBtn').addEventListener('click', () => {
            this.retryManager.stopBatch();
        });
        this.el.querySelector('#gptAddPromptBtn').addEventListener('click', () => this.saveCurrentPrompt(this.savedPromptType));

        // --- Template Batch ---
        this.templateBatchManager = new TemplateBatchManager(this.toast);
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
        this.el.querySelector('#gptTemplateBatchStopBtn').addEventListener('click', () => {
            this.templateBatchManager.stop();
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
        this.el.querySelector('#gptQualityRepeatStopBtn').addEventListener('click', () => {
            this.retryManager.stopQualityRepeat();
        });

        this.el.querySelector('#gptScrapeDownloadBtn').addEventListener('click', () => {
            const btn = this.el.querySelector('#gptScrapeDownloadBtn');
            const stopBtn = this.el.querySelector('#gptScrapeStopBtn');
            const status = this.el.querySelector('#gptScrapeStatus');
            btn.style.display = 'none';
            stopBtn.style.display = '';
            status.textContent = 'Starting gallery scan...';
            // Use the existing scraper which scrolls, clicks into items, and downloads
            this.scraper.start();
        });
        this.el.querySelector('#gptScrapeStopBtn').addEventListener('click', () => {
            const btn = this.el.querySelector('#gptScrapeDownloadBtn');
            const stopBtn = this.el.querySelector('#gptScrapeStopBtn');
            const status = this.el.querySelector('#gptScrapeStatus');
            btn.style.display = '';
            stopBtn.style.display = 'none';
            status.textContent = 'Stopped.';
            this.scraper.stop();
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
            return await this.providerRunLedger.appendProviderRunLedgerEntry(entry);
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
            const result = await safeChromeStorageSet('local', { savedPrompts: normalized }, 'migrate saved prompts');
            if (result.invalidated) {
                showExtensionContextRefreshed(this);
                return;
            }
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
            main.onclick = () => this.injectPrompt(item.text, 'append');

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

            item.innerHTML = `
                <div class="gpt-history-text">${h.text}</div>
                <div class="gpt-history-meta">
                    <span class="gpt-history-type ${typeClass}">${typeIcon}</span>
                    <span>${timeStr}</span>
                </div>
            `;
            list.appendChild(item);
        });
    }

    async persistSavedPrompts(nextPrompts) {
        const normalized = normalizeSavedPrompts(nextPrompts);
        this.savedPrompts = normalized;
        const result = await safeChromeStorageSet('local', { savedPrompts: normalized }, 'save prompts');
        if (result.invalidated) {
            showExtensionContextRefreshed(this);
            return false;
        }
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

        await this.persistSavedPrompts([...this.savedPrompts, item]);
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

        const next = [...this.savedPrompts];
        next[index] = updated;
        await this.persistSavedPrompts(next);
        this.toast.show('Saved prompt updated', 'success');
    }

    async deleteSavedPrompt(itemId) {
        const target = this.savedPrompts.find((item) => item.id === itemId);
        if (!target) return;
        if (!confirm(`Delete "${target.name}"?`)) return;

        const next = this.savedPrompts.filter((item) => item.id !== itemId);
        await this.persistSavedPrompts(next);
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
        await this.persistSavedPrompts([...this.savedPrompts, ...examples]);
        this.toast.show('Examples Loaded', 'success');
    }

    readCurrentPromptInput() {
        if (isChatGptImagesProvider(this.provider) && this.chatGptActions && typeof this.chatGptActions.readChatGptPromptInput === 'function') {
            const chatGptPrompt = this.chatGptActions.readChatGptPromptInput();
            if (chatGptPrompt) return chatGptPrompt;
        }

        const ta = document.querySelector('textarea[aria-required="true"]');
        if (ta && ta.value && ta.value.trim()) return ta.value.trim();
        const ce = document.querySelector('[contenteditable="true"]');
        if (ce && ce.textContent && ce.textContent.trim()) return ce.textContent.trim();
        return '';
    }

    captureTemplateImageUrl() {
        // Method 1: Find a user-uploaded image in the template dialog
        const dialog = document.querySelector('[role="dialog"]');
        if (dialog) {
            const imgs = Array.from(dialog.querySelectorAll('img')).filter(img => {
                const src = img.src || '';
                return src.includes('assets.grok.com/users/') && !src.includes('share-images') && !src.includes('share-videos');
            });
            if (imgs.length > 0) return imgs[0].src;
        }
        // Method 2: Captured from intercepted upload-file response
        if (window._lastUploadedImageUrl) return window._lastUploadedImageUrl;
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

    setRecreateRunning(running) {
        this.recreateRunning = !!running;
        const startBtn = this.el.querySelector('#gptRecreateStartBtn');
        const stopBtn = this.el.querySelector('#gptRecreateStopBtn');
        if (startBtn) startBtn.style.display = running ? 'none' : '';
        if (stopBtn) {
            stopBtn.style.display = running ? '' : 'none';
            stopBtn.disabled = false;
            stopBtn.textContent = 'Stop';
        }
    }

    setRecreateStopping(stopping) {
        const stopBtn = this.el.querySelector('#gptRecreateStopBtn');
        if (!stopBtn) return;
        stopBtn.disabled = !!stopping;
        stopBtn.textContent = stopping ? 'Stopping...' : 'Stop';
    }

    async setRecreateReferenceFromFile(file, source) {
        this.recreateReference = null;
        this.validateRecreateFile(file);

        const actions = this.getRecreateActions();
        if (typeof actions.readFileAsRecreateReference !== 'function') throw new Error('workflow_unavailable');

        this.recreateReference = await actions.readFileAsRecreateReference(file, source);
        const byteLength = Number(this.recreateReference && this.recreateReference.byteLength) || 0;
        const sizeText = byteLength > 0 ? ` (${Math.round(byteLength / 1024)} KB)` : '';
        this.setRecreateStatus(`Selected ${this.getRecreateReferenceKind()}: ${this.recreateReference.name}${sizeText}`, 'success');
    }

    async setRecreateReferenceFromCurrentImage() {
        this.recreateReference = null;
        const actions = this.getRecreateActions();
        if (typeof actions.selectCurrentGeneratedImage !== 'function') throw new Error('workflow_unavailable');

        this.recreateReference = await actions.selectCurrentGeneratedImage();
        this.setRecreateStatus('Selected current Grok image.', 'success');
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
        this.setRecreateRunning(true);
        this.setRecreateStatus('Starting recreate workflow...', 'info');

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

            if (this.recreateAbortRequested) {
                return;
            }

            if (response && response.ok) {
                const label = response.referenceKind === 'video' || this.getRecreateReferenceKind() === 'video' ? 'video' : 'image';
                this.setRecreateStatus(`Generated ${label} ready.`, 'success');
            } else {
                this.setRecreateStatus(this.formatRecreateStatus(response), 'error');
            }
        } catch (error) {
            if (!this.recreateAbortRequested) {
                this.setRecreateStatus(error.message || 'Recreate workflow failed.', 'error');
            }
        } finally {
            const wasAbortRequested = this.recreateAbortRequested;
            this.recreateAbortRequested = false;
            this.setRecreateRunning(false);
            if (wasAbortRequested) {
                this.setRecreateStatus('Stopped.', 'neutral');
            }
        }
    }

    injectPrompt(text, mode = 'replace') {
        if (mode === 'append') {
            return this.appendPromptText(text);
        }

        const ta = document.querySelector('textarea[aria-required="true"]');
        if (ta) {
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
        } else {
            // Fallback: contenteditable div (TipTap/ProseMirror on Grok)
            const ce = document.querySelector('[contenteditable="true"]');
            if (ce) {
                ce.focus();
                document.dispatchEvent(new CustomEvent('__gpt_set_editor_content', {
                    detail: { text }
                }));
            }
        }
    }

    appendPromptText(text) {
        const snippet = sanitizeSavedPromptText(text);
        if (!snippet) return false;

        const ta = document.querySelector('textarea[aria-required="true"]');
        if (ta) {
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

        const ce = document.querySelector('[contenteditable="true"]');
        if (ce) {
            ce.focus();
            document.dispatchEvent(new CustomEvent('__gpt_append_editor_content', {
                detail: { text: SAVED_PROMPT_DELIMITER + snippet }
            }));
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

class VideoRetryManager {
    constructor(overlay, settingsManager, historyManager) {
        this.overlay = overlay;
        this.settingsManager = settingsManager;
        this.historyManager = historyManager;
        this.BUTTON_SELECTOR = 'button[aria-label="Make video"]';
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
        this.batchContext = null;    // 'gallery' or 'detail'
        this.batchRunToken = null;
        this.batchStartPending = false;
        this.promptedVideoComposerRoot = null;

        // Quality Repeat state
        this.qualityRepeatRunning = false;
        this.qualityRepeatTotal = 0;
        this.qualityRepeatCompleted = 0;

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
        return 'unsupported';
    }

    createBatchRunToken() {
        return `batch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    }

    isBatchRunActive(runToken = this.batchRunToken) {
        return !!runToken
            && this.batchRunning
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

        const composer = this._getVerifiedPromptedVideoComposer(this.promptedVideoComposerRoot);
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
        const rect = el.getBoundingClientRect();
        const x = rect.x + rect.width / 2;
        const y = rect.y + rect.height / 2;
        const opts = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y };
        el.dispatchEvent(new PointerEvent('pointerdown', opts));
        el.dispatchEvent(new MouseEvent('mousedown', opts));
        el.dispatchEvent(new PointerEvent('pointerup', opts));
        el.dispatchEvent(new MouseEvent('mouseup', opts));
        el.dispatchEvent(new MouseEvent('click', opts));
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
        const image = container?.querySelector?.('img[alt="Generated image"]') || null;
        return image && findMediaCardRoot(image) === container ? image : null;
    }

    _getCardImageSrc(container) {
        const img = this._getCardGeneratedImage(container);
        return img?.src || '';
    }

    _getCardSourceId(container) {
        const sourceUrl = this._getCardImageSrc(container);
        return getGrokMediaIdentity(sourceUrl) || sourceUrl;
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

    _findCurrentMakeVideoTrigger() {
        return Array.from(document.querySelectorAll(
            'button[aria-label="Make Video"][aria-haspopup="menu"]'
        )).find((button) => this._isActionableAutomationTarget(button)) || null;
    }

    _findPromptedVideoInput() {
        return document.querySelector('textarea[aria-required="true"]')
            || document.querySelector('[contenteditable="true"]');
    }

    _clearPromptedVideoComposerRoot() {
        this.promptedVideoComposerRoot = null;
    }

    _getVerifiedPromptedVideoComposer(root) {
        if (!root?.isConnected || !root.matches('.query-bar')) return null;

        const inputs = Array.from(root.querySelectorAll(
            'div[contenteditable="true"][role="textbox"][aria-label="Ask Grok anything"]'
        )).filter((candidate) => candidate.closest('.query-bar') === root);
        if (inputs.length !== 1) return null;

        const input = inputs[0];
        const submitButtons = Array.from(root.querySelectorAll('button[aria-label="Make video"]'))
            .filter((candidate) => candidate.closest('.query-bar') === root
                && this._isActionableAutomationTarget(candidate, 72));
        if (submitButtons.length !== 1) return null;

        return { root, input, submitButton: submitButtons[0] };
    }

    _findPromptedVideoSubmitButton() {
        return this._getVerifiedPromptedVideoComposer(this.promptedVideoComposerRoot)?.submitButton || null;
    }

    _getVerifiedPromptedVideoComposers() {
        return Array.from(document.querySelectorAll('.query-bar'))
            .map((root) => this._getVerifiedPromptedVideoComposer(root))
            .filter(Boolean);
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

    _recordPromptedVideoFocus(focusTransition, input) {
        const root = input?.closest?.('.query-bar') || null;
        if (!focusTransition.focusTransitioned) {
            const leftActiveElement = input !== focusTransition.activeElement;
            const leftActiveRoot = !focusTransition.root || root !== focusTransition.root;
            focusTransition.focusTransitioned = leftActiveElement && leftActiveRoot;
        }
        if (!focusTransition.focusTransitioned
            || (focusTransition.root && root === focusTransition.root)
            || !input?.matches(
                'div[contenteditable="true"][role="textbox"][aria-label="Ask Grok anything"]'
            )) {
            return null;
        }

        const composer = this._getVerifiedPromptedVideoComposer(root);
        if (composer?.input !== input) return null;
        focusTransition.observedRoots.add(composer.root);
        return composer;
    }

    _startPromptedVideoFocusTransition() {
        const activeElement = document.activeElement;
        const focusTransition = {
            activeElement,
            root: activeElement?.closest?.('.query-bar') || null,
            focusTransitioned: false,
            observedRoots: new Set(),
            listener: null
        };
        focusTransition.listener = (event) => {
            this._recordPromptedVideoFocus(focusTransition, event.target);
        };
        document.addEventListener('focusin', focusTransition.listener, true);
        return focusTransition;
    }

    _stopPromptedVideoFocusTransition(focusTransition) {
        document.removeEventListener('focusin', focusTransition.listener, true);
    }

    async _waitForFocusedPromptedVideoComposer(runToken, focusTransition) {
        let confirmationRoot = null;
        for (let attempt = 0; attempt < 20; attempt++) {
            if (!this.isPromptedBatchTokenActive(runToken)) return null;
            const composer = this._recordPromptedVideoFocus(
                focusTransition,
                document.activeElement
            );
            if (focusTransition.observedRoots.size > 1) return null;

            if (composer) {
                if (confirmationRoot === composer.root) {
                    const confirmed = this._getVerifiedPromptedVideoComposer(composer.root);
                    if (focusTransition.observedRoots.size === 1
                        && confirmed?.input === document.activeElement) {
                        this.promptedVideoComposerRoot = confirmed.root;
                        return confirmed;
                    }
                }
                confirmationRoot = composer.root;
            } else {
                confirmationRoot = null;
            }
            await this.sleep(100);
        }
        return null;
    }

    // Opens Grok's custom video prompt mode. The current UI uses
    // Make Video > Add Prompt; older post pages use a direct mode button.
    async selectMakeVideoMode(runToken, readyMakeVideoTrigger = null) {
        if (!this.isPromptedBatchTokenActive(runToken)) return false;
        this.promptedVideoModeContract = null;
        this._clearPromptedVideoComposerRoot();
        const currentTrigger = this._isActionableAutomationTarget(readyMakeVideoTrigger)
            ? readyMakeVideoTrigger
            : this._findCurrentMakeVideoTrigger();

        if (currentTrigger) {
            if (!this.isPromptedBatchTokenActive(runToken)) return false;
            this.simulateClick(currentTrigger);
            const addPromptItem = await this._waitForLinkedAddPromptMenuItem(currentTrigger, runToken);
            if (!addPromptItem) {
                console.log('VideoRetryManager: Add Prompt option not found');
                return false;
            }

            if (!this.isPromptedBatchTokenActive(runToken)) return false;
            const focusTransition = this._startPromptedVideoFocusTransition();
            let composer;
            try {
                this.simulateClick(addPromptItem);
                composer = await this._waitForFocusedPromptedVideoComposer(runToken, focusTransition);
            } finally {
                this._stopPromptedVideoFocusTransition(focusTransition);
            }
            if (!composer) {
                console.log('VideoRetryManager: Video prompt composer did not open');
                return false;
            }
            this.promptedVideoModeContract = 'current_menu';
            return true;
        }

        const videoBtn = [
            document.querySelector('button[aria-label="Video"]'),
            document.querySelector('button[aria-label="Settings"]')
        ].find((button) => this._isActionableAutomationTarget(button));
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

    // Clicks only a proven video query-bar submit. Never fall back to Edit.
    clickPromptedVideoSubmitButton(runToken) {
        if (!this.isPromptedBatchTokenActive(runToken)) return false;
        const button = this._findPromptedVideoSubmitButton();
        if (!button || button.disabled) return false;
        if (!this.isPromptedBatchTokenActive(runToken)) return false;
        this.simulateClick(button);
        return true;
    }

    _getImaginePostId(url) {
        try {
            const pathname = new URL(url, window.location.origin).pathname;
            return pathname.match(/^\/imagine\/post\/([^/]+)/)?.[1] || null;
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
        return Array.from(searchRoot.querySelectorAll('.react-flow__node-asset'))
            .flatMap((asset) => Array.from(asset.querySelectorAll('img[src], video[src], source[src]')))
            .map((media) => media.currentSrc || media.src || '')
            .filter(Boolean);
    }

    _getReadyAgentAssetVideoSources(searchRoot) {
        return Array.from(searchRoot.querySelectorAll('.react-flow__node-asset video'))
            .filter((video) => video.readyState >= 2)
            .map((video) => this._getPromptedVideoSource(video))
            .filter(Boolean);
    }

    _getAgentAssetVideoSourceIdentities(searchRoot, readyOnly = false) {
        return this._getPromptedVideoSourceIdentities(
            searchRoot,
            '.react-flow__node-asset video',
            readyOnly
        );
    }

    capturePromptedVideoResultBaseline(searchRoot) {
        return {
            pageUrl: window.location.href,
            postId: this._getImaginePostId(window.location.href),
            surface: detectGrokScrapeSurface(document, window.location),
            completeCount: searchRoot.querySelectorAll('button[aria-label="Video Generation Complete"]').length,
            videoSources: this._getReadyPromptedVideoSources(searchRoot),
            videoSourceIdentities: this._getPromptedVideoSourceIdentities(searchRoot),
            agentAssetSources: this._getAgentAssetSources(searchRoot),
            agentAssetVideoSources: this._getReadyAgentAssetVideoSources(searchRoot),
            agentAssetVideoSourceIdentities: this._getAgentAssetVideoSourceIdentities(searchRoot)
        };
    }

    _hasNewPromptedVideoResult(searchRoot, baseline) {
        const currentSurface = detectGrokScrapeSurface(document, window.location);
        const baselineVideoIdentities = new Set(
            baseline.videoSourceIdentities
            || (baseline.videoSources || []).map((source) => getGrokMediaIdentity(source) || source)
        );
        const hasNewReadyVideo = this._getPromptedVideoSourceIdentities(searchRoot, 'video', true)
            .some((identity) => !baselineVideoIdentities.has(identity));
        const baselineAgentVideoIdentities = new Set(baseline.agentAssetVideoSourceIdentities || []);
        const hasNewReadyAgentVideo = this._getAgentAssetVideoSourceIdentities(searchRoot, true)
            .some((identity) => !baselineAgentVideoIdentities.has(identity));
        if (baseline.surface === SCRAPE_SURFACES.agentMedia
            && currentSurface === SCRAPE_SURFACES.agentMedia
            && hasNewReadyAgentVideo) return true;
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

    // --- Goal Mode ---
    startGoal(count) {
        this.goalRunning = true;
        this.batchRunning = false;
        this.batchContext = 'detail';
        this.goalTotal = count;
        this.goalCount = 0;
        this.currentRetry = 0;

        // Scope to the card the user is looking at
        this.targetContext = this.findTargetContext();
        if (!this.targetContext) {
            this.goalRunning = false;
            this.isVerifying = false;
            this.safeStatus('No generated-image card found', 'warning');
            this.updateCounters();
            return;
        }

        const root = this._queryRoot();
        this.baseCompletedCount = root.querySelectorAll(this.PROGRESS_SELECTOR).length;
        console.log(`VideoRetryManager: Goal Started. Target: ${count}. Scoped: ${!!this.targetContext}`);

        this.safeStatus('Goal Started', 'info');
        this.updateCounters();
        this.clickMakeVideo();
    }

    // --- Batch Mode (Quick + Prompted) ---
    async startBatch(mode = 'quick', prompt = null, options = {}) {
        if (this.batchRunning || this.batchStartPending) {
            this.safeStatus('Batch is already running', 'warning');
            return false;
        }

        this.batchStartPending = true;
        try {
            await this._startBatch(mode, prompt, options);
            return true;
        } finally {
            this.batchStartPending = false;
        }
    }

    async _startBatch(mode = 'quick', prompt = null, options = {}) {
        const normalizedMode = mode === 'prompted' ? 'prompted' : 'quick';

        if (normalizedMode === 'prompted') {
            const runToken = this.createBatchRunToken();
            this.batchRunToken = runToken;
            const detectedContext = this.detectBatchContext();
            if (detectedContext === 'detail') {
                const videoGoal = Math.max(1, parseInt(options.videoGoal, 10) || this.settingsManager.get('videoGoal') || 1);
                await this.startPromptedBatchFromDetail(prompt, videoGoal, runToken);
            } else if (detectedContext === 'gallery') {
                const galleryLimit = Math.max(1, parseInt(options.galleryLimit, 10) || this.settingsManager.get('galleryBatchLimit') || 1);
                await this.startPromptedBatchFromGallery(prompt, galleryLimit, runToken);
            } else {
                this.batchRunToken = null;
                this.safeStatus('Prompted Batch: Open Saved or a supported image detail first', 'warning');
            }
            return;
        }

        this.batchRunning = true;
        this.goalRunning = false;
        this.batchAborted = false;
        this.batchIndex = 0;
        this.batchMode = 'quick';
        this.batchContext = 'gallery';
        this.batchPrompt = null;
        this.batchRunToken = this.createBatchRunToken();
        this.scrollAttempts = 0;
        this.goalCount = 0;
        this.currentRetry = 0;

        this.safeStatus('Batch (quick): Scanning gallery...', 'info');

        this.batchQueue = this.buildBatchQueue();
        this.goalTotal = this.batchQueue.length;

        if (this.batchQueue.length === 0) {
            this.safeStatus('No items to process', 'warning');
            this.batchRunning = false;
            this.updateCounters();
            this.updateBatchButtons(false);
            return;
        }

        console.log(`Batch (quick): Found ${this.batchQueue.length} items to process.`);
        this.updateCounters();
        this.updateBatchButtons(true);
        await this.processBatchNext();
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
            let videoResultBaseline = null;
            if (this.batchPrompt) {
                const modeReady = await this.selectMakeVideoMode(runToken);
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
                if (this.promptedVideoModeContract === 'current_menu') {
                    videoResultBaseline = this.capturePromptedVideoResultBaseline(document);
                }
            }

            if (!this.isBatchRunActive(runToken)) break;
            this.preClickButtonCount = document.querySelectorAll(this.PROGRESS_SELECTOR).length;
            const submitted = this.clickPromptedVideoSubmitButton(runToken);
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

    stopBatch() {
        this._clearPromptedVideoComposerRoot();
        this.batchRunning = false;
        this.batchAborted = true;
        this.batchRunToken = null;
        this.goalRunning = false;
        this.isVerifying = false;
        this.targetContext = null;
        this.batchContext = null;
        this.batchProcessedSrcs = null;
        this.safeStatus('Batch Stopped', 'neutral');
        this.updateCounters();
        this.updateBatchButtons(false);
    }

    buildBatchQueue() {
        const buttons = Array.from(document.querySelectorAll(this.BUTTON_SELECTOR));
        const items = buttons.map(btn => {
            const container = findMediaCardRoot(btn);
            if (!container) return null;
            const rect = container.getBoundingClientRect();
            return { button: btn, container, top: rect.top + window.scrollY, left: rect.left + window.scrollX };
        }).filter(Boolean);
        // Sort visually: top-to-bottom, left-to-right (20px row tolerance)
        items.sort((a, b) => {
            if (Math.abs(a.top - b.top) > 20) return a.top - b.top;
            return a.left - b.left;
        });
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
        return {
            galleryUrl: this.batchGalleryUrl || window.location.href,
            sourceId: getGrokMediaIdentity(sourceUrl) || sourceUrl,
            scrollY: Math.round(window.scrollY || document.documentElement.scrollTop || 0)
        };
    }

    async waitForPromptedBatchEditorReady(expectedIdentity, runToken, timeoutMs = 10000) {
        const pollInterval = 200;
        const maxAttempts = Math.max(1, Math.ceil(timeoutMs / pollInterval));
        let lastSurface = SCRAPE_SURFACES.savedGallery;
        let lastMatchStatus = 'missing';

        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            if (!this.isBatchRunActive(runToken)) return { status: 'cancelled', surface: lastSurface };
            lastSurface = detectGrokScrapeSurface(document, window.location);
            if (lastSurface === SCRAPE_SURFACES.unsupported) {
                return { status: 'unsupported', surface: lastSurface };
            }
            if (lastSurface === SCRAPE_SURFACES.legacyDetail) {
                return { status: 'ready', surface: lastSurface, makeVideoTrigger: null };
            }
            if (lastSurface === SCRAPE_SURFACES.agentMedia) {
                const match = findMatchingAgentMedia(document, expectedIdentity);
                lastMatchStatus = match.status;
                if (match.status === 'ambiguous') {
                    return { status: 'ambiguous', surface: lastSurface };
                }
                const makeVideoTrigger = this._findCurrentMakeVideoTrigger();
                if (match.status === 'matched' && makeVideoTrigger) {
                    return {
                        status: 'ready',
                        surface: lastSurface,
                        makeVideoTrigger,
                        media: match.media
                    };
                }
            }
            await this.sleep(pollInterval);
        }

        return { status: 'timeout', surface: lastSurface, matchStatus: lastMatchStatus };
    }

    async waitForPromptedBatchSavedSurface(runToken, timeoutMs = 10000) {
        const pollInterval = 200;
        const maxAttempts = Math.max(1, Math.ceil(timeoutMs / pollInterval));
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            if (!this.isBatchRunActive(runToken)) return false;
            const onSaved = detectGrokScrapeSurface(document, window.location) === SCRAPE_SURFACES.savedGallery;
            const savedDomReady = Array.from(document.querySelectorAll('img[alt="Generated image"]'))
                .some((image) => !!findMediaCardRoot(image));
            if (onSaved && savedDomReady) return true;
            await this.sleep(pollInterval);
        }
        return false;
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
        window.scrollTo(0, snapshot.scrollY);
        if (!this.isBatchRunActive(runToken)) return false;
        this.batchQueue = this.buildBatchQueue();
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
        const modeReady = await this.selectMakeVideoMode(runToken, editorReady.makeVideoTrigger);
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
        const submitted = this.clickPromptedVideoSubmitButton(runToken);
        if (!submitted) {
            return this.stopPromptedBatchItem(
                'Prompted Batch [gallery]: Video submit button not ready',
                snapshot,
                runToken
            );
        }

        if (!this.isBatchRunActive(runToken)) return false;
        this.lastClickTime = Date.now();
        this.batchProcessedSrcs?.add(snapshot.sourceId);
        console.log(`Prompted Batch [gallery]: Submitted video for item ${this.batchIndex + 1}.`);

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
            if (!this.isBatchRunActive(runToken)) return 'cancelled';
            backBtn.click();
            const returned = await this.waitForPromptedBatchSavedSurface(runToken);
            if (!this.isBatchRunActive(runToken)) return 'cancelled';
            if (returned) return this.restorePromptedBatchSavedState(snapshot, runToken) ? 'returned' : 'cancelled';
            if (detectGrokScrapeSurface(document, window.location) === SCRAPE_SURFACES.savedGallery) return 'failed';
        }

        if (!this.isBatchRunActive(runToken)) return 'cancelled';
        if (window.history.length > 1) {
            window.history.back();
            const returned = await this.waitForPromptedBatchSavedSurface(runToken);
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
            && this.batchContext === 'gallery'
            && detectGrokScrapeSurface(document, window.location) !== SCRAPE_SURFACES.savedGallery) {
            return false;
        }
        if (this.scrollAttempts >= 3) return false;
        this.scrollAttempts++;

        // Scroll to bottom of last queued item (absolute position, never backward)
        const lastItem = this.batchQueue[this.batchQueue.length - 1];
        if (lastItem && lastItem.container.isConnected) {
            const rect = lastItem.container.getBoundingClientRect();
            window.scrollTo(0, rect.bottom + window.scrollY);
        } else {
            window.scrollTo(0, document.body.scrollHeight);
        }
        await this.sleep(2500); // Wait for lazy load
        if (runToken && !this.isBatchRunActive(runToken)) return false;

        const newQueue = this.buildBatchQueue();
        // Only add genuinely new items (not already in queue)
        const existingContainers = new Set(this.batchQueue.map(i => i.container));
        const newItems = newQueue.filter(i => !existingContainers.has(i.container));

        if (newItems.length > 0) {
            this.batchQueue.push(...newItems);
            if (!(this.batchMode === 'prompted' && this.batchContext === 'gallery')) {
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
        const stopBtn = this.overlay.el.querySelector('#gptBatchStopBtn');
        const batchStatus = this.overlay.el.querySelector('#gptBatchStatus');
        const galleryLimitRow = this.overlay.el.querySelector('#gptGalleryLimitRow');

        if (quickBtn) quickBtn.style.display = running ? 'none' : '';
        if (promptedBtn) promptedBtn.style.display = running ? 'none' : '';
        if (stopBtn) stopBtn.style.display = running ? '' : 'none';
        if (batchStatus) batchStatus.style.display = running ? 'block' : 'none';
        if (galleryLimitRow) galleryLimitRow.style.display = running ? 'none' : '';
        if (batchStatus) {
            const ctx = this.batchContext ? ` [${this.batchContext}]` : '';
            batchStatus.textContent = running ? `Batch Mode${ctx}: Active` : 'Batch Mode: Active';
        }
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
        const isGalleryPrompted = this.batchRunning && this.batchMode === 'prompted' && this.batchContext === 'gallery';
        if (progressLabel) {
            progressLabel.textContent = isGalleryPrompted ? 'Images Processed' : 'Videos Generated';
        }
        if (retryB) retryB.textContent = `${this.currentRetry}/${s.maxRetries}`;
        if (vidB) vidB.textContent = `${this.goalCount}/${this.goalTotal}`;
    }

    checkAndAct() {
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

    findGenerateMoreButton() {
        return Array.from(document.querySelectorAll('button')).find(
            b => b.textContent.trim() === 'Generate More'
        );
    }

    async waitForGenerationComplete(timeout = 45000) {
        const start = Date.now();
        // Phase 1: wait for button to disappear (confirms click worked)
        while (Date.now() - start < 5000) {
            if (!this.qualityRepeatRunning) return false;
            if (!this.findGenerateMoreButton()) break;
            await this.sleep(200);
        }
        // Phase 2: wait for button to reappear (generation complete)
        while (Date.now() - start < timeout) {
            if (!this.qualityRepeatRunning) return false;
            if (this.findGenerateMoreButton()) return true;
            await this.sleep(500);
        }
        return false;
    }

    updateQualityRepeatUI(running) {
        if (!this.overlay || !this.overlay.el) return;
        const startBtn = this.overlay.el.querySelector('#gptQualityRepeatBtn');
        const stopBtn = this.overlay.el.querySelector('#gptQualityRepeatStopBtn');
        const statusEl = this.overlay.el.querySelector('#gptQualityRepeatStatus');
        if (startBtn) startBtn.style.display = running ? 'none' : '';
        if (stopBtn) stopBtn.style.display = running ? '' : 'none';
        if (statusEl) {
            if (running) {
                const images = this.qualityRepeatCompleted * 4;
                const totalImages = this.qualityRepeatTotal * 4;
                statusEl.textContent = 'Generating: ' + images + '/' + totalImages + ' images (' + this.qualityRepeatCompleted + '/' + this.qualityRepeatTotal + ' repeats)';
            } else if (this.qualityRepeatCompleted > 0) {
                statusEl.textContent = 'Done: ' + (this.qualityRepeatCompleted * 4) + ' images (' + this.qualityRepeatCompleted + '/' + this.qualityRepeatTotal + ' repeats)';
            } else {
                statusEl.textContent = '';
            }
        }
    }

    async startQualityRepeat(targetRepeats) {
        if (this.qualityRepeatRunning) return;
        this.qualityRepeatRunning = true;
        this.qualityRepeatTotal = targetRepeats;
        this.qualityRepeatCompleted = 0;
        this.updateQualityRepeatUI(true);
        this.safeStatus('Quality Repeat: Starting 0/' + targetRepeats, 'info');

        while (this.qualityRepeatCompleted < this.qualityRepeatTotal && this.qualityRepeatRunning) {
            let btn = this.findGenerateMoreButton();
            if (!btn) {
                const waitStart = Date.now();
                while (!btn && Date.now() - waitStart < 5000) {
                    await this.sleep(500);
                    btn = this.findGenerateMoreButton();
                }
            }
            if (!btn) {
                this.safeStatus('Quality Repeat: Generate More button not found', 'warning');
                break;
            }

            if (!location.href.includes('/imagine')) {
                this.safeStatus('Quality Repeat: Navigated away from Imagine', 'warning');
                break;
            }

            btn.click();

            const appeared = await this.waitForGenerationComplete();
            if (!this.qualityRepeatRunning) break;

            this.qualityRepeatCompleted++;
            this.updateQualityRepeatUI(true);
            this.safeStatus('Quality Repeat: ' + this.qualityRepeatCompleted + '/' + this.qualityRepeatTotal, 'info');

            if (!appeared) {
                console.warn('Quality Repeat: Timeout waiting for images on repeat ' + this.qualityRepeatCompleted);
            }

            await this.sleep(1000);
        }

        this.qualityRepeatRunning = false;
        this.updateQualityRepeatUI(false);
        const done = this.qualityRepeatCompleted >= this.qualityRepeatTotal;
        const msg = done
            ? 'Quality Repeat: Complete (' + (this.qualityRepeatCompleted * 4) + ' images)'
            : 'Quality Repeat: Stopped (' + (this.qualityRepeatCompleted * 4) + ' images)';
        this.safeStatus(msg, done ? 'success' : 'neutral');
        this.updateOnPageButtons(false);
    }

    stopQualityRepeat() {
        this.qualityRepeatRunning = false;
    }

    // --- On-page quick buttons next to "Generate More" ---

    injectQuickRepeatButtons(generateMoreBtn) {
        if (generateMoreBtn.parentElement.querySelector('.gpt-quality-repeat-inline')) return;

        const container = document.createElement('span');
        container.className = 'gpt-quality-repeat-inline';
        container.style.cssText = 'display:inline-flex; gap:4px; margin-left:8px; align-items:center;';
        this._buildQuickButtons(container);
        generateMoreBtn.parentElement.appendChild(container);
    }

    _buildQuickButtons(container) {
        while (container.firstChild) container.removeChild(container.firstChild);
        [2, 5, 10].forEach(count => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.textContent = 'x' + count;
            btn.style.cssText = 'padding:4px 10px; font-size:11px; font-weight:600; border-radius:9999px; border:none; cursor:pointer; background:rgba(139,92,246,0.15); color:#a78bfa; transition:background 0.2s;';
            btn.addEventListener('mouseenter', () => { btn.style.background = 'rgba(139,92,246,0.3)'; });
            btn.addEventListener('mouseleave', () => { btn.style.background = 'rgba(139,92,246,0.15)'; });
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.startQualityRepeat(count);
                this._showOnPageProgress(container);
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
        stopBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.stopQualityRepeat();
        });
        container.appendChild(stopBtn);

        const interval = setInterval(() => {
            if (!this.qualityRepeatRunning) {
                clearInterval(interval);
                this._buildQuickButtons(container);
                return;
            }
            status.textContent = this.qualityRepeatCompleted + '/' + this.qualityRepeatTotal + '...';
        }, 500);
    }

    updateOnPageButtons(running) {
        const container = document.querySelector('.gpt-quality-repeat-inline');
        if (!container) return;
        if (!running) this._buildQuickButtons(container);
    }

    sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
}

class TemplateBatchManager {
    constructor(toast) {
        this.toast = toast;
        this.running = false;
        this.aborted = false;
        this.count = 0;
        this.total = 0;
    }

    async start(templateId, imageUrl, count) {
        this.running = true;
        this.aborted = false;
        this.count = 0;
        this.total = count;
        this.updateStatus(`Starting 0/${count}...`);

        for (let i = 0; i < count && this.running && !this.aborted; i++) {
            try {
                const resp = await fetch('https://grok.com/rest/media/pipeline/run', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({
                        templateId,
                        inputs: [{ name: 'photo', imageUrl }]
                    })
                });
                if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                this.count++;
                this.updateStatus(`Submitted ${this.count}/${this.total}`);
                console.log(`TemplateBatch: Submitted ${this.count}/${this.total}`);
            } catch (e) {
                console.error('TemplateBatch error:', e);
                this.updateStatus(`Error at ${this.count + 1}/${this.total}: ${e.message}`);
            }
            // Brief delay between submissions to avoid rate limiting
            await new Promise(r => setTimeout(r, 2000));
        }

        this.running = false;
        this.updateStatus(`Done: ${this.count}/${this.total} submitted`);
        this.toast.show(`Template batch complete: ${this.count}/${this.total}`, 'success');
    }

    stop() {
        this.aborted = true;
        this.running = false;
        this.updateStatus(`Stopped at ${this.count}/${this.total}`);
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
    }

    setupListeners() {
        if (!this.chromeRuntime || !this.chromeRuntime.onMessage) return;

        const listener = (request, _sender, sendResponse) => {
            if (request.action === 'GPT_RECREATE_STATUS') {
                this.handleStatus(request);
                sendResponse({ ok: true, runId: request.runId });
                return false;
            }

            if (request.action === 'GPT_RECREATE_CHAT_STEP') {
                this.runAsyncStep(() => this.getAction('runChatPromptStep')(request), sendResponse, request.runId);
                return true;
            }

            if (request.action === 'GPT_RECREATE_IMAGINE_STEP') {
                this.runAsyncStep(async () => {
                    const response = await this.getAction('runImagineSubmitStep')(request);
                    if (response && response.ok && request.generatedPrompt) {
                        this.recordGeneratedPrompt(request.generatedPrompt, request.targetMode || request.referenceKind || response.mediaKind);
                    }
                    return response;
                }, sendResponse, request.runId);
                return true;
            }

            if (request.action === 'GPT_RECREATE_IMAGINE_POST_VALIDATION_STEP') {
                this.runAsyncStep(
                    () => this.getAction('runImaginePostValidationStep')(request),
                    sendResponse,
                    request.runId
                );
                return true;
            }

            return false;
        };

        if (this.chromeRuntime === getChromeRuntime()) {
            safeChromeAddListener(() => chrome.runtime.onMessage, listener, 'listen for recreate workflow messages');
            return;
        }

        this.chromeRuntime.onMessage.addListener(listener);
    }

    handleStatus(request) {
        const message = request.phase && request.phase !== 'done'
            ? `${request.phase}: ${request.message || request.error || ''}`
            : (request.message || request.error || '');
        const type = request.type || 'info';

        if (this.overlay && typeof this.overlay.setRecreateStatus === 'function') {
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

    runAsyncStep(fn, sendResponse, runId) {
        (async () => {
            try {
                const response = await fn();
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
            }
        })();
    }
}


class GrokScraper {
    constructor() {
        this.overlay = null;
        this.processedIds = new Set();
        this.state = { isRunning: false, currentIndex: 0, mode: 'IDLE' };
        this.backupMode = false;
        this.backupOptions = { mode: 'full', limit: null, options: {} };
        this.backupStats = { totalSeen: 0, uploaded: 0, alreadyPresent: 0, queued: 0, errors: 0 };
        this._backupVisited = new Set();
        this.runToken = null;
        this.pendingNavigation = null;
        this.Config = { actionWait: 600, navWait: 800, surfaceWait: 10000, historyWait: 1500 };
        this.init();
    }
    setOverlay(overlay) { this.overlay = overlay; }

    handleExtensionContextInvalidated() {
        this._backupStartPending = false;
        this.backupMode = false;
        this.state.isRunning = false;
        this.runToken = null;
        this.pendingNavigation = null;
        showExtensionContextRefreshed(this.overlay);
        return true;
    }

    async clearStaleRunState(stopReason = 'stale_session') {
        const backupState = this.backupMode
            ? { r2BackupState: { isRunning: false, ...this.backupStats, stopReason } }
            : {};
        this._backupStartPending = false;
        this.backupMode = false;
        this.state.isRunning = false;
        this.runToken = null;
        this.pendingNavigation = null;
        const result = await safeChromeStorageSet('local', {
            scraperState: 'idle',
            currentIndex: 0,
            scrapeRunToken: null,
            scrapeNavigation: null,
            currentItemId: null,
            scrapeBackupOptions: null,
            isScraping: false,
            isR2Backup: false,
            scrapeStopReason: stopReason,
            ...backupState
        }, 'clear stale scrape session');
        if (result.invalidated) this.handleExtensionContextInvalidated();
    }

    async init() {
        const storedResult = await safeChromeStorageGet('local', [
            'scraperState',
            'currentIndex',
            'processedIds',
            'scrapeRunToken',
            'scrapeNavigation',
            'scrapeBackupOptions',
            'isR2Backup',
            'r2BackupState'
        ], {}, 'load scraper state');
        if (storedResult.invalidated) {
            this.handleExtensionContextInvalidated();
            return;
        }
        const stored = storedResult.value;
        if (stored.processedIds) {
            this.processedIds = new Set(stored.processedIds);
            console.log(`Loaded ${this.processedIds.size} processed items.`);
        }
        this.state.isRunning = stored.scraperState === 'running';
        this.state.currentIndex = stored.currentIndex || 0;
        this.runToken = stored.scrapeRunToken || null;
        this.pendingNavigation = stored.scrapeNavigation || null;
        this.backupMode = stored.isR2Backup === true;
        if (this.backupMode) {
            this.backupOptions = stored.scrapeBackupOptions || this.backupOptions;
            this.backupStats = {
                ...this.backupStats,
                ...(stored.r2BackupState || {})
            };
        }

        if (this.state.isRunning) {
            const validationResult = this.runToken
                ? await safeChromeRuntimeSendMessage({
                    action: 'VALIDATE_SCRAPE_RESUME',
                    runToken: this.runToken
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
            Promise.resolve(this.determineModeAndExecute(this.runToken)).catch((error) => {
                if (this.state.isRunning) this.failRun(error.message || 'Scrape resume failed.', 'resume_failed');
            });
        }

        this.setupListeners();
    }

    setupListeners() {
        safeChromeAddListener(() => chrome.runtime.onMessage, (request, sender, sendResponse) => {
            if (request.action === 'INIT_SCRAPE') {
                this.start().then(sendResponse, (error) => {
                    sendResponse({ status: 'error', surface: this.getCurrentSurface(), error: error.message });
                });
                return true;
            } else if (request.action === 'ABORT_SCRAPE') {
                this.stop();
                sendResponse({ status: 'stopped' });
            } else if (request.action === 'INIT_R2_BACKUP') {
                this.startBackupMode(request).then(sendResponse, (error) => {
                    sendResponse({ status: 'error', surface: this.getCurrentSurface(), error: error.message });
                });
                return true;
            } else if (request.action === 'ABORT_R2_BACKUP') {
                this.stopBackupMode();
                sendResponse({ status: 'stopped' });
            } else if (request.action === 'RESET_PROCESSED_IDS') {
                this.processedIds = new Set();
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
            const stopSignal = shouldStopScraperForStorageChanges(changes, this.backupMode);
            if (stopSignal && this.state.isRunning) {
                console.log('GrokScraper: stop signal received via storage.onChanged');
                if (this.backupMode) this.stopBackupMode();
                else this.stop();
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
            Promise.resolve(this.startBackupMode(backupOptions)).catch(() => {});
        } else if (action === 'INIT_R2_BACKUP') {
            console.warn('[GrokScraper] ignored page-origin R2 backup command without canary mode');
        } else if (action === 'ABORT_R2_BACKUP') {
            this.stopBackupMode();
        } else if (action === 'INIT_SCRAPE') {
            Promise.resolve(this.start()).catch(() => {});
        } else if (action === 'ABORT_SCRAPE') {
            this.stop();
        } else if (action === 'RESET_PROCESSED_IDS') {
            this.processedIds = new Set();
            safeChromeStorageSet('local', { processedIds: [] }, 'reset processed IDs').then((result) => {
                if (result.invalidated) this.handleExtensionContextInvalidated();
            }).catch(() => {});
            console.log('[GrokScraper] processedIds cleared via custom event');
        }
    }

    getCleanId(url) { if (!url) return null; try { return url.split('?')[0]; } catch { return url; } }

    getCurrentSurface() {
        return detectGrokScrapeSurface(document, window.location);
    }

    createRunToken() {
        return `scrape_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    }

    isRunActive(runToken = this.runToken) {
        if (!runToken) return this.state.isRunning && !this.runToken;
        return this.state.isRunning && this.runToken === runToken;
    }

    getGalleryScroller() {
        return document.querySelector('.overflow-scroll') || document.querySelector('[role="list"]')?.parentElement || window;
    }

    getScrollerSnapshot(scroller) {
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

    getGalleryCardSignature(cardSelector) {
        return Array.from(document.querySelectorAll(cardSelector))
            .filter(img => img.naturalWidth > 50)
            .map(img => this.getCleanId(img.currentSrc || img.src))
            .filter(Boolean)
            .join('|');
    }

    async start() {
        const surface = this.getCurrentSurface();
        if (surface !== SCRAPE_SURFACES.savedGallery) {
            const error = 'Open Grok Imagine Saved before starting sync.';
            this.log(error, 'error');
            return { status: 'invalid_context', surface, error };
        }
        if (this.state.isRunning) {
            return { status: 'error', surface, error: 'Sync is already running.' };
        }

        const runToken = this.createRunToken();
        this.log('Scraping initialized.', 'success');
        const result = await safeChromeStorageSet('local', {
            scraperState: 'running',
            currentIndex: 0,
            scrapeRunToken: runToken,
            scrapeBackupOptions: null
        }, 'start scrape');
        if (result.invalidated) {
            this.handleExtensionContextInvalidated();
            return { status: 'error', surface, error: EXTENSION_CONTEXT_REFRESHED_MESSAGE };
        }
        this.state.isRunning = true;
        this.state.currentIndex = 0;
        this.runToken = runToken;
        this.pendingNavigation = null;
        Promise.resolve(this.determineModeAndExecute(runToken)).catch((error) => {
            if (this.isRunActive(runToken)) this.failRun(error.message || 'Sync failed to start.', 'start_failed');
        });
        return { status: 'started', surface, runToken };
    }

    async stop(stopReason = 'stopped') {
        console.log('Stopping scrape run.');
        this.state.isRunning = false;
        this.runToken = null;
        this.pendingNavigation = null;
        const result = await safeChromeStorageSet('local', {
            scraperState: 'idle',
            scrapeRunToken: null,
            scrapeNavigation: null,
            currentItemId: null,
            scrapeBackupOptions: null,
            isScraping: false,
            isR2Backup: false,
            scrapeStopReason: stopReason
        }, 'stop scrape');
        if (result.invalidated) {
            this.handleExtensionContextInvalidated();
            return;
        }
        this.log('Scraping stopped.', 'neutral');
    }

    async startBackupMode(options = {}) {
        const surface = this.getCurrentSurface();
        if (surface !== SCRAPE_SURFACES.savedGallery) {
            const error = 'Open Grok Imagine Saved before starting backup.';
            this.log(error, 'error');
            return { status: 'invalid_context', surface, error };
        }
        if (this._backupStartPending || this.state.isRunning) {
            this.log('R2 Backup already running or starting.', 'warning');
            return { status: 'error', surface, error: 'R2 Backup is already running or starting.' };
        }

        this._backupStartPending = true;
        // Validate cloud config before starting R2 backup
        try {
            const validationResult = await safeChromeRuntimeSendMessage({ action: 'VALIDATE_CLOUD_CONFIG' }, 'validate cloud config');
            if (validationResult.invalidated) {
                this.handleExtensionContextInvalidated();
                return { status: 'error', surface, error: EXTENSION_CONTEXT_REFRESHED_MESSAGE };
            }
            const validation = validationResult.value;
            if (!validation?.valid) {
                this.log(`R2 Backup aborted: ${validation?.error || 'Cloud config invalid.'}`, 'error');
                console.error('R2 Backup config validation failed:', validation?.error);
                return { status: 'error', surface, error: validation?.error || 'Cloud config invalid.' };
            }
        } catch {
            this.log('R2 Backup aborted: Could not validate cloud config.', 'error');
            return { status: 'error', surface, error: 'Could not validate cloud config.' };
        } finally {
            this._backupStartPending = false;
        }

        this.backupMode = true;
        this.backupOptions = {
            mode: options.mode === 'canary' ? 'canary' : 'full',
            limit: Number.isFinite(options.limit) && options.limit > 0 ? options.limit : null,
            options: options.options && typeof options.options === 'object' ? options.options : {},
            acceptance: options.acceptance || null
        };
        this.backupStats = { totalSeen: 0, uploaded: 0, alreadyPresent: 0, queued: 0, errors: 0, startedAt: Date.now() };
        this._backupVisited = new Set();
        const runToken = this.createRunToken();
        this.state.isRunning = true;
        this.state.currentIndex = 0;
        this.runToken = runToken;
        this.pendingNavigation = null;
        const startResult = await safeChromeStorageSet('local', {
            scraperState: 'running',
            currentIndex: 0,
            scrapeRunToken: runToken,
            scrapeBackupOptions: this.backupOptions,
            r2BackupState: { isRunning: true, ...this.backupStats }
        }, 'start R2 backup');
        if (startResult.invalidated) {
            this.handleExtensionContextInvalidated();
            return { status: 'error', surface, error: EXTENSION_CONTEXT_REFRESHED_MESSAGE };
        }
        this.log(this.backupOptions.mode === 'canary' ? 'R2 Canary Backup started.' : 'R2 Full Media Backup started.', 'success');
        Promise.resolve(this.determineModeAndExecute(runToken)).catch((error) => {
            if (this.isRunActive(runToken)) this.failRun(error.message || 'R2 Backup failed to start.', 'start_failed');
        });
        return { status: 'started', surface, runToken };
    }

    async stopBackupMode(stopReason = 'stopped') {
        this.backupMode = false;
        this.state.isRunning = false;
        this.runToken = null;
        this.pendingNavigation = null;
        const finalStats = { ...this.backupStats, stopReason };
        const stopResult = await safeChromeStorageSet('local', {
            scraperState: 'idle',
            scrapeRunToken: null,
            scrapeNavigation: null,
            currentItemId: null,
            scrapeBackupOptions: null,
            isScraping: false,
            isR2Backup: false,
            r2BackupState: { isRunning: false, ...finalStats }
        }, 'stop R2 backup');
        if (stopResult.invalidated) {
            this.handleExtensionContextInvalidated();
            return;
        }
        this.log(`R2 Backup stopped. Uploaded: ${this.backupStats.uploaded}, Already present: ${this.backupStats.alreadyPresent || 0}, Queued: ${this.backupStats.queued || 0}, Errors: ${this.backupStats.errors}`, 'neutral');
        safeChromeRuntimeSendMessageSoon({ action: 'R2_BACKUP_COMPLETE', stats: finalStats }, 'complete R2 backup');
    }

    async determineModeAndExecute(runToken = this.runToken) {
        if (!this.isRunActive(runToken)) return;

        const surface = this.getCurrentSurface();
        if (surface === SCRAPE_SURFACES.savedGallery) {
            this.state.mode = 'LIST';
            await this.restorePendingGalleryContext(runToken);
            if (this.isRunActive(runToken)) await this.executeListView(runToken);
            return;
        }
        if (surface === SCRAPE_SURFACES.agentMedia) {
            this.state.mode = 'AGENT';
            await this.executeAgentView(runToken);
            return;
        }
        if (surface === SCRAPE_SURFACES.legacyDetail) {
            this.state.mode = 'DETAIL';
            await this.executeDetailView(runToken);
            return;
        }

        await this.failRun('Sync left Grok Imagine Saved and did not reach supported media.', 'unsupported_surface');
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

    async persistBackupProgress(runToken = this.runToken) {
        if (!this.backupMode || !this.isRunActive(runToken)) return false;
        const result = await safeChromeStorageSet('local', {
            r2BackupState: { isRunning: true, ...this.backupStats }
        }, 'save R2 backup progress');
        if (result.invalidated) {
            this.handleExtensionContextInvalidated();
            return false;
        }
        safeChromeRuntimeSendMessageSoon({
            action: 'R2_BACKUP_PROGRESS',
            stats: this.backupStats
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
        if (!pending || pending.runToken !== runToken) return;
        await this.sleep(300);
        if (!this.isRunActive(runToken) || this.getCurrentSurface() !== SCRAPE_SURFACES.savedGallery) return;

        const scroller = this.getGalleryScroller();
        const scrollTop = Number(pending.galleryScrollTop) || 0;
        if (scroller === window) {
            window.scrollTo(0, scrollTop);
        } else {
            scroller.scrollTop = scrollTop;
        }

        this.pendingNavigation = null;
        const result = await safeChromeStorageSet('local', {
            scrapeNavigation: null,
            currentItemId: null
        }, 'clear completed scrape navigation');
        if (result.invalidated) this.handleExtensionContextInvalidated();
    }

    async executeListView(runToken = this.runToken) {
        if (!this.isRunActive(runToken)) return;
        if (this.getCurrentSurface() !== SCRAPE_SURFACES.savedGallery) {
            await this.determineModeAndExecute(runToken);
            return;
        }

        const cardSelector = 'img[alt="Generated image"], [role="listitem"] img';
        let staleRetries = 0;
        let scrollAttempts = 0;
        const MAX_STALE_RETRIES = this.backupMode ? 30 : 15;
        const MAX_SCROLL_ATTEMPTS = this.backupMode ? 1000 : 50;
        let exhausted = false;

        await this.sleep(300);

        while (this.isRunActive(runToken) && scrollAttempts < MAX_SCROLL_ATTEMPTS) {
            if (this.getCurrentSurface() !== SCRAPE_SURFACES.savedGallery) {
                await this.determineModeAndExecute(runToken);
                return;
            }
            const items = Array.from(document.querySelectorAll(cardSelector));
            const uniqueItems = items.filter((img, index, self) =>
                index === self.findIndex((t) => t === img) && img.naturalWidth > 50
            );

            console.log(`Scanning ${uniqueItems.length} items...`);
            if (scrollAttempts % 5 === 0) this.log(`Scanning... (${uniqueItems.length} items visible)`);

            // Visual Sort
            let visualItems = uniqueItems.map(img => {
                const container = img.closest('[role="listitem"]');
                let top = 999999, left = 999999;
                if (container) {
                    const rect = container.getBoundingClientRect();
                    top = rect.top + window.scrollY;
                    left = rect.left + window.scrollX;
                } else {
                    const rect = img.getBoundingClientRect();
                    top = rect.top + window.scrollY;
                    left = rect.left + window.scrollX;
                }
                return { element: img, top, left, src: img.src };
            });

            visualItems.sort((a, b) => {
                if (Math.abs(a.top - b.top) > 20) return a.top - b.top;
                return a.left - b.left;
            });

            // Find Unprocessed
            let targetItem = null;
            for (let i = 0; i < visualItems.length; i++) {
                const itemObj = visualItems[i];
                const cleanId = this.getCleanId(itemObj.src);
                const alreadyDone = this.processedIds.has(cleanId) || (this.backupMode && this._backupVisited.has(cleanId));
                if (cleanId && !alreadyDone) {
                    targetItem = itemObj.element;
                    this.log(`new item: ...${cleanId.slice(-6)}`, 'success');
                    await this.processItem(targetItem, cleanId, runToken);
                    return; // Action Taken
                }
            }

            // Scroll if no action
            console.log('No new items visible. Scrolling...');
            const scroller = this.getGalleryScroller();
            const before = this.getScrollerSnapshot(scroller);
            const beforeSignature = this.getGalleryCardSignature(cardSelector);
            scroller.scrollBy(0, window.innerHeight);
            await this.sleep(600);
            if (!this.isRunActive(runToken)) return;
            const after = this.getScrollerSnapshot(scroller);
            const afterSignature = this.getGalleryCardSignature(cardSelector);
            const outcome = resolveBackupScrollAttempt({
                before,
                after,
                beforeSignature,
                afterSignature,
                staleRetries,
                maxStaleRetries: MAX_STALE_RETRIES
            });
            staleRetries = outcome.nextStaleRetries;
            scrollAttempts++;
            if (outcome.exhausted) {
                exhausted = true;
                break;
            }
        }

        if (exhausted || scrollAttempts >= MAX_SCROLL_ATTEMPTS) {
            if (!this.isRunActive(runToken)) return;
            if (this.backupMode) {
                if (exhausted) {
                    this.log(`Backup complete. ${this.backupStats.uploaded} uploaded, ${this.backupStats.alreadyPresent || 0} already present, ${this.backupStats.queued || 0} queued, ${this.backupStats.errors} errors.`, 'success');
                    this.stopBackupMode('complete');
                } else {
                    this.log('Backup paused: scan safety limit reached before confirming the gallery end.', 'warning');
                    this.stopBackupMode('scan_limit');
                }
            } else {
                this.log('Stopped: No new items found.', 'warning');
                this.stop();
            }
        }
    }

    async processItem(targetItem, cleanId, runToken = this.runToken) {
        if (!this.isRunActive(runToken)) return;
        const sourceUrl = targetItem.currentSrc || targetItem.src || '';
        const expectedIdentity = getGrokMediaIdentity(sourceUrl);
        if (!expectedIdentity) {
            await this.failRun('Could not identify the selected Saved media.', 'gallery_identity_missing');
            return;
        }

        const scroller = this.getGalleryScroller();
        const pendingNavigation = {
            runToken,
            currentItemId: cleanId,
            expectedIdentity,
            sourceUrl,
            galleryUrl: window.location.href,
            galleryScrollTop: this.getScrollerSnapshot(scroller).scrollTop,
            createdAt: Date.now()
        };
        targetItem.style.outline = "2px solid rgba(29,155,240,0.5)";
        this.log(`Opening item...`);
        const result = await safeChromeStorageSet('local', {
            currentItemId: cleanId,
            scrapeNavigation: pendingNavigation
        }, 'save scrape navigation');
        if (result.invalidated) {
            this.handleExtensionContextInvalidated();
            return;
        }
        if (!this.isRunActive(runToken)) return;
        this.pendingNavigation = pendingNavigation;
        targetItem.click();
        const nextSurface = await this.waitForSurface(
            (surface) => surface !== SCRAPE_SURFACES.savedGallery,
            runToken
        );
        if (!this.isRunActive(runToken)) return;
        if (!nextSurface) {
            await this.failRun('The selected Saved card did not open a supported media surface.', 'surface_transition_timeout');
            return;
        }
        await this.determineModeAndExecute(runToken);
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

    async persistProcessedId(currentItemId, runToken = this.runToken) {
        if (!currentItemId || !this.isRunActive(runToken)) return false;
        const latestResult = await safeChromeStorageGet('local', ['processedIds'], {}, 'load scrape processed IDs');
        if (latestResult.invalidated) {
            this.handleExtensionContextInvalidated();
            return false;
        }
        if (!this.isRunActive(runToken)) return false;
        const merged = new Set(Array.isArray(latestResult.value.processedIds) ? latestResult.value.processedIds : []);
        this.processedIds.forEach((id) => merged.add(id));
        merged.add(currentItemId);
        this.processedIds = merged;
        const saveResult = await safeChromeStorageSet('local', { processedIds: Array.from(merged) }, 'save scrape processed IDs');
        if (saveResult.invalidated) {
            this.handleExtensionContextInvalidated();
            return false;
        }
        return true;
    }

    async executeAgentView(runToken = this.runToken) {
        if (!this.isRunActive(runToken)) return;
        const pending = this.pendingNavigation;
        if (!pending || pending.runToken !== runToken || !pending.expectedIdentity) {
            await this.failRun('Agent Mode opened without a pending Saved media identity.', 'agent_identity_missing');
            return;
        }

        const match = await this.waitForMatchingAgentMedia(pending.expectedIdentity, runToken);
        if (!this.isRunActive(runToken)) return;
        if (match.status !== 'matched' || !match.media) {
            const reason = match.status === 'ambiguous' ? 'agent_media_ambiguous' : 'agent_media_missing';
            const message = match.status === 'ambiguous'
                ? 'Agent Mode exposed more than one match for the selected Saved media.'
                : 'Agent Mode did not expose the selected Saved media.';
            await this.failRun(message, reason);
            return;
        }

        if (this.backupMode && !this._backupVisited.has(pending.currentItemId)) {
            this._backupVisited.add(pending.currentItemId);
            this.backupStats.totalSeen++;
            await this.persistBackupProgress(runToken);
            if (!this.isRunActive(runToken)) return;
        }

        const response = await this.performDownload(match.media, pending.currentItemId, runToken);
        if (!this.isRunActive(runToken)) return;
        if (!isSuccessfulMediaTransferStatus(response?.status)) {
            await this.failRun(
                response?.error || 'The selected Agent media could not be transferred.',
                'media_transfer_failed',
                false
            );
            return;
        }

        if (!this.backupMode) await this.persistProcessedId(pending.currentItemId, runToken);
        if (!this.isRunActive(runToken)) return;

        const canaryStopReason = getR2BackupCanaryStopReason(this.backupOptions, this.backupStats);
        if (this.backupMode && canaryStopReason) {
            await this.stopBackupMode(canaryStopReason);
            return;
        }
        await this.returnToSavedGallery(runToken);
    }

    async returnToSavedGallery(runToken = this.runToken) {
        if (!this.isRunActive(runToken)) return;
        const galleryUrl = this.pendingNavigation?.galleryUrl;
        this.log('Returning to Saved...', 'neutral');
        window.history.back();
        const returnedSurface = await this.waitForSurface(
            (surface) => surface === SCRAPE_SURFACES.savedGallery,
            runToken,
            this.Config.historyWait || 1500
        );
        if (!this.isRunActive(runToken)) return;
        if (returnedSurface) {
            await this.determineModeAndExecute(runToken);
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
        }
    }

    navigateToGalleryUrl(galleryUrl) {
        window.location.assign(galleryUrl);
    }

    async executeDetailView(runToken = this.runToken) {
        if (!this.isRunActive(runToken)) return;

        // Deduplication
        const storedStateResult = await safeChromeStorageGet('local', ['currentItemId'], {}, 'load current item ID');
        if (storedStateResult.invalidated) {
            this.handleExtensionContextInvalidated();
            return;
        }
        const storedState = storedStateResult.value;
        let currentId = storedState.currentItemId;
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

        // MULTI-VIDEO SUPPORT
        // Strategies:
        // 1. Find container with thumbnails.
        // 2. Iterate each button inside.
        // 3. Click, Wait, Download.

        // Container seems to be the one with 'overflow-y-auto' inside the article relative area
        // Or we can just find all buttons with img alt="Thumbnail X"

        const thumbnailButtons = Array.from(document.querySelectorAll('button img[alt^="Thumbnail"]'))
            .map(img => img.closest('button'))
            .filter(btn => btn);
        let normalTransferSucceeded = !this.backupMode;

        if (thumbnailButtons.length > 0) {
            console.log(`Multi-Video Detected: ${thumbnailButtons.length} versions.`);

            // Try to find the scrollable container to ensure all match?
            // User provided: class="... overflow-y-auto ..."
            // Let's try to find it from the first button
            const scrollContainer = thumbnailButtons[0].closest('.overflow-y-auto');

            for (let i = 0; i < thumbnailButtons.length; i++) {
                if (!this.isRunActive(runToken)) return;
                const btn = thumbnailButtons[i];

                // Scroll into view if needed
                if (scrollContainer) {
                    btn.scrollIntoView({ behavior: 'instant', block: 'center' });
                    await this.sleep(200);
                    if (!this.isRunActive(runToken)) return;
                }

                this.log(`Processing Version ${i + 1}/${thumbnailButtons.length}...`);
                btn.click();

                // Wait for video/image to swap after thumbnail click
                await this.sleep(500);
                if (!this.isRunActive(runToken)) return;

                const response = await this.performDownload(null, currentId, runToken);
                if (!this.backupMode && !isSuccessfulMediaTransferStatus(response?.status)) {
                    normalTransferSucceeded = false;
                    await this.failRun(response?.error || 'Legacy media download failed.', 'media_transfer_failed');
                    return;
                }
                const canaryStopReason = getR2BackupCanaryStopReason(this.backupOptions, this.backupStats);
                if (this.backupMode && canaryStopReason) {
                    await this.stopBackupMode(canaryStopReason);
                    return;
                }
            }
        } else {
            // Fallback: No thumbnails found? Maybe it's a single video without thumbnails?
            // Or maybe our selector missed. Check if there's just a generated video/image.
            console.log('No thumbnails found. Assuming single item.');
            const response = await this.performDownload(null, currentId, runToken);
            if (!this.backupMode && !isSuccessfulMediaTransferStatus(response?.status)) {
                normalTransferSucceeded = false;
                await this.failRun(response?.error || 'Legacy media download failed.', 'media_transfer_failed');
                return;
            }
            const canaryStopReason = getR2BackupCanaryStopReason(this.backupOptions, this.backupStats);
            if (this.backupMode && canaryStopReason) {
                await this.stopBackupMode(canaryStopReason);
                return;
            }
        }

        if (!this.isRunActive(runToken)) return;
        if (normalTransferSucceeded && currentId) await this.persistProcessedId(currentId, runToken);
        if (!this.isRunActive(runToken)) return;

        // Back Button
        const backBtn = await this.waitForSelector('[aria-label="Back"], .lucide-arrow-left', 5000);
        if (backBtn) {
            if (!this.isRunActive(runToken)) return;
            backBtn.click();
            await this.sleep(this.Config.navWait);
            if (this.isRunActive(runToken)) await this.determineModeAndExecute(runToken);
        } else {
            await this.failRun('Legacy detail view did not expose a Back control.', 'gallery_return_failed');
        }
    }

    _getVideoSrc(videoEl) {
        if (!videoEl) return null;
        return videoEl.src || videoEl.currentSrc || videoEl.querySelector?.('source')?.src || null;
    }

    async performBackupUpload(mediaEl = null, currentItemId = null, runToken = this.runToken) {
        if (!this.isRunActive(runToken)) return { status: 'error', error: 'Backup stopped.' };

        const mediaStart = Date.now();
        while (!mediaEl && this.isRunActive(runToken) && Date.now() - mediaStart < 3000) {
            mediaEl = selectBackupMediaElement(document);
            if (mediaEl && getBackupMediaElementSrc(mediaEl)) break;
            await this.sleep(200);
        }

        const src = getBackupMediaElementSrc(mediaEl);
        const isVideo = mediaEl?.tagName?.toLowerCase() === 'video';

        console.log('[BackupUpload]', isVideo ? 'VIDEO' : 'IMAGE', 'src:', (src || 'NONE').slice(0, 80));

        if (!src) {
            this.backupStats.errors++;
            this.log('No media element found for backup.', 'error');
            return { status: 'error', error: 'No media element found for backup.' };
        }

        const alreadyLocal = this.processedIds.has(this.getCleanId(src)) || this.processedIds.has(currentItemId);
        const promptText = this.overlay?.readCurrentPromptInput?.() || '';
        if (promptText) console.log('[BackupUpload] Prompt:', promptText.slice(0, 60));

        try {
            let blobData = null;
            try {
                const result = await fetchMediaDataUrlViaBridge(src);
                blobData = result.dataUrl;
                console.log('[BackupUpload] Bridge fetched blob:', result.size, 'bytes, type:', result.type);
            } catch (fetchErr) {
                console.warn('[BackupUpload] Bridge fetch failed, background will retry:', fetchErr.message);
            }

            if (!this.isRunActive(runToken)) return { status: 'error', error: 'Backup stopped.' };

            const responseResult = await safeChromeRuntimeSendMessage({
                action: 'R2_BACKUP_UPLOAD',
                url: src,
                isVideo,
                promptText,
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
            if (recordBackupUploadStatus(this.backupStats, response?.status)) {
                const actionLabel = response.status === 'queued'
                    ? 'Queued for R2'
                    : (response.status === 'already_present' ? 'Already in R2' : 'Uploaded to R2');
                this.log(`${actionLabel}: ...${src.slice(-20)}`, response.status === 'conflict_uploaded' ? 'warning' : 'success');
                // Mark as processed only after R2 says the asset is present.
                const cleanId = this.getCleanId(src);
                if (cleanId && shouldPersistBackupProcessedId(response.status)) {
                    const latestResult = await safeChromeStorageGet('local', ['processedIds'], {}, 'load backup processed IDs');
                    if (latestResult.invalidated) {
                        this.handleExtensionContextInvalidated();
                        return { status: 'error', error: EXTENSION_CONTEXT_REFRESHED_MESSAGE };
                    }
                    if (!this.isRunActive(runToken)) return { status: 'error', error: 'Backup stopped.' };
                    const inMemoryIds = new Set(this.processedIds);
                    if (currentItemId) inMemoryIds.add(currentItemId);
                    const processedIds = mergeBackupProcessedIdsForStorage(
                        latestResult.value.processedIds,
                        inMemoryIds,
                        cleanId,
                        response.backupProcessedId
                    );
                    this.processedIds = new Set(processedIds);
                    const saveResult = await safeChromeStorageSet('local', { processedIds }, 'save backup processed IDs');
                    if (saveResult.invalidated) {
                        this.handleExtensionContextInvalidated();
                        return { status: 'error', error: EXTENSION_CONTEXT_REFRESHED_MESSAGE };
                    }
                }
            } else {
                this.backupStats.errors++;
                this.log(`Backup error: ${response?.error || 'unknown'}`, 'error');
            }
            await this.persistBackupProgress(runToken);
            if (!this.isRunActive(runToken)) return { status: 'error', error: 'Backup stopped.' };
            await this.sleep(this.Config.actionWait);
            return response || { status: 'error', error: 'R2 backup returned no response.' };
        } catch (error) {
            this.backupStats.errors++;
            return { status: 'error', error: error.message || 'R2 backup failed.' };
        }
    }

    async performDownload(mediaEl = null, currentItemId = null, runToken = this.runToken) {
        if (!this.isRunActive(runToken)) return { status: 'error', error: 'Sync stopped.' };
        if (this.backupMode) return this.performBackupUpload(mediaEl, currentItemId, runToken);

        if (mediaEl) {
            const src = getBackupMediaElementSrc(mediaEl);
            if (!src) return { status: 'error', error: 'Agent media URL is missing.' };
            const configResult = await safeChromeRuntimeSendMessage({ action: 'GET_CLOUD_CONFIG' }, 'load media transfer mode');
            if (configResult.invalidated) {
                this.handleExtensionContextInvalidated();
                return { status: 'error', error: EXTENSION_CONTEXT_REFRESHED_MESSAGE };
            }
            if (!this.isRunActive(runToken)) return { status: 'error', error: 'Sync stopped.' };

            const cloudOnly = configResult.value?.config?.mode === 'cloud_only';
            let blobDataUrl = null;
            if (cloudOnly) {
                try {
                    const bridgeResult = await fetchMediaDataUrlViaBridge(src);
                    blobDataUrl = bridgeResult.dataUrl;
                } catch (error) {
                    return { status: 'error', error: `Authenticated media fetch failed: ${error.message}` };
                }
            }
            if (!this.isRunActive(runToken)) return { status: 'error', error: 'Sync stopped.' };

            const promptText = this.overlay?.readCurrentPromptInput?.() || '';
            const responseResult = await safeChromeRuntimeSendMessage({
                action: 'DOWNLOAD_MEDIA',
                url: src,
                isVideo: mediaEl.tagName?.toLowerCase() === 'video',
                promptText,
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
    // Always initialize the Overlay and Managers on supported sites (defined in manifest)
    const provider = detectCurrentProvider();
    const settings = new SettingsManager();
    const history = new PromptHistoryManager(settings);
    if (isChatGptImagesProvider(provider)) {
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
    } else {
        const scraper = new GrokScraper();
        const retry = new VideoRetryManager(null, settings, history);
        const overlay = new GrokOverlay(scraper, retry, settings, history, { provider });
        const recreateBridge = new RecreateWorkflowContentBridge(overlay, history);
        recreateBridge.setupListeners();
        retry.overlay = overlay;
        scraper.setOverlay(overlay);
    }
} else {
    module.exports = {
        SettingsManager,
        GrokOverlay,
        VideoRetryManager,
        GrokScraper,
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
        detectGrokScrapeSurface,
        findMatchingAgentMedia,
        getGrokMediaIdentity,
        isSuccessfulMediaTransferStatus,
        shouldStopScraperForStorageChanges,
        fetchMediaDataUrlViaBridge,
        recordBackupUploadStatus,
        resolveBackupScrollAttempt,
        selectBackupMediaElement,
        mergeBackupProcessedIdsForStorage,
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
