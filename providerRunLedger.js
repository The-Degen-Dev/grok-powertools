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
        const status = normalizeStatus(entry.status);
        const result = entry.result || {};

        return {
            runId: String(entry.runId || createProviderRunId(options)),
            providerId: String(entry.providerId || 'unknown'),
            workflow: String(entry.workflow || 'text-to-image'),
            createdAt,
            submittedAt: Number.isFinite(entry.submittedAt) ? entry.submittedAt : createdAt,
            completedAt: Number.isFinite(entry.completedAt)
                ? entry.completedAt
                : (status === 'generated' || status === 'failed' || status === 'blocked' ? now() : 0),
            prompt: String(entry.prompt || '').trim(),
            promptSource: String(entry.promptSource || 'typed'),
            status,
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
        const stored = await storage.get([PROVIDER_RUN_HISTORY_KEY]);
        const existing = Array.isArray(stored[PROVIDER_RUN_HISTORY_KEY]) ? stored[PROVIDER_RUN_HISTORY_KEY] : [];
        const previous = existing.find((item) => item && item.runId === entry.runId);
        const merged = previous
            ? {
                ...previous,
                ...entry,
                createdAt: previous.createdAt,
                submittedAt: previous.submittedAt || previous.createdAt,
                completedAt: Number.isFinite(entry.completedAt) ? entry.completedAt : undefined,
                diagnostics: {
                    ...(previous.diagnostics || {}),
                    ...(entry.diagnostics || {})
                }
            }
            : entry;
        const normalized = normalizeProviderRunLedgerEntry(merged, options);
        const next = [normalized, ...existing.filter((item) => item && item.runId !== normalized.runId)]
            .slice(0, maxEntries);
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
