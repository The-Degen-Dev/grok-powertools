(function (root, factory) {
    const workflowUtils =
        root && root.GrokRecreateWorkflowUtils
            ? root.GrokRecreateWorkflowUtils
            : typeof require === 'function'
              ? require('./recreateWorkflowUtils.js')
              : null;
    const api = factory(workflowUtils);

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }

    if (root) {
        root.GrokRecreateWorkflowBackground = api;
    }
})(typeof self !== 'undefined' ? self : typeof globalThis !== 'undefined' ? globalThis : this, function (utils) {
    const CHAT_URL = 'https://grok.com/';
    const IMAGINE_URL = 'https://grok.com/imagine';
    const DEFAULT_MESSAGE_TIMEOUT_MS = 15000;
    const DEFAULT_STATUS_MESSAGE_TIMEOUT_MS = 1000;
    const DEFAULT_RECEIVER_RETRY_ATTEMPTS = 6;
    const DEFAULT_RECEIVER_RETRY_DELAY_MS = 250;
    const DEFAULT_TAB_READY_TIMEOUT_MS = 30000;
    const DEFAULT_TAB_READY_POLL_MS = 250;
    const RECREATE_RUN_SESSION_KEY = 'gptRecreateRunLease';
    const RECREATE_RUN_LEASE_VERSION = 1;
    const MAX_RESULT_BASELINE_ITEMS = 200;
    const MAX_RESULT_BASELINE_SIGNATURE_LENGTH = 8192;
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const RESULT_SOURCE_KINDS = new Set([
        'trusted-grok-media',
        'trusted-grok-video',
        'data-url',
        'blob-url',
        'empty',
        'other'
    ]);
    const RECREATE_CONTENT_SCRIPT_FILES = [
        'recreateWorkflowUtils.js',
        'recreateWorkflowContent.js',
        'content.js'
    ];
    const RECREATE_CONTENT_CSS_FILES = ['overlay.css'];

    function createError(code) {
        const error = new Error(code);
        error.code = code;
        return error;
    }

    function createPhaseError(code, phase, diagnostics = {}) {
        const error = createError(code);
        error.phase = phase;
        error.diagnostics = diagnostics;
        return error;
    }

    function getChromeApi(options) {
        if (options.chromeApi) return options.chromeApi;
        if (typeof chrome !== 'undefined') return chrome;
        throw createError('chrome_api_missing');
    }

    function isGrokImagineUrl(value) {
        try {
            const url = new URL(String(value || ''));
            return (
                url.protocol === 'https:' &&
                url.hostname === 'grok.com' &&
                url.pathname === '/imagine'
            );
        } catch {
            return false;
        }
    }

    function isGrokImaginePostUrl(value) {
        try {
            const url = new URL(String(value || ''));
            return (
                url.protocol === 'https:' &&
                url.hostname === 'grok.com' &&
                url.pathname.includes('/imagine/post/')
            );
        } catch {
            return false;
        }
    }

    function normalizeErrorCode(error) {
        if (error && error.code) return error.code;
        if (error && error.message) return error.message;
        return String(error || 'workflow_failed');
    }

    function isReceiverNotReadyError(error) {
        const message = String((error && error.diagnostics && error.diagnostics.chromeLastError) || error.message || '');
        return /receiving end does not exist/i.test(message);
    }

    function isMessageChannelClosedError(error) {
        const message = String((error && error.diagnostics && error.diagnostics.chromeLastError) || error.message || '');
        return /message channel closed|asynchronous response|extension context invalidated/i.test(message);
    }

    function wait(ms, signal = null) {
        return new Promise((resolve, reject) => {
            let settled = false;
            const onAbort = () => finish(createError('workflow_aborted'));
            const timer = setTimeout(() => finish(), ms);

            function finish(error = null) {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                if (signal) signal.removeEventListener('abort', onAbort);
                if (error) {
                    reject(error);
                    return;
                }
                resolve();
            }

            if (signal) {
                if (signal.aborted) {
                    finish(createError('workflow_aborted'));
                    return;
                }
                signal.addEventListener('abort', onAbort, { once: true });
            }
        });
    }

    function createRecreateWorkflowController(options = {}) {
        const workflowUtils = options.utils || utils;
        if (!workflowUtils) throw createError('recreate_utils_missing');

        const chromeApi = getChromeApi(options);
        const now = typeof options.now === 'function' ? options.now : Date.now;
        const random = typeof options.random === 'function' ? options.random : Math.random;
        const messageTimeoutMs = Number.isFinite(options.messageTimeoutMs)
            ? options.messageTimeoutMs
            : DEFAULT_MESSAGE_TIMEOUT_MS;
        const statusMessageTimeoutMs = Number.isFinite(options.statusMessageTimeoutMs)
            ? options.statusMessageTimeoutMs
            : DEFAULT_STATUS_MESSAGE_TIMEOUT_MS;
        const receiverRetryAttempts = Number.isFinite(options.receiverRetryAttempts)
            ? Math.max(1, Math.floor(options.receiverRetryAttempts))
            : DEFAULT_RECEIVER_RETRY_ATTEMPTS;
        const receiverRetryDelayMs = Number.isFinite(options.receiverRetryDelayMs)
            ? options.receiverRetryDelayMs
            : DEFAULT_RECEIVER_RETRY_DELAY_MS;
        const tabReadyTimeoutMs = Number.isFinite(options.tabReadyTimeoutMs)
            ? options.tabReadyTimeoutMs
            : DEFAULT_TAB_READY_TIMEOUT_MS;
        const tabReadyPollMs = Number.isFinite(options.tabReadyPollMs)
            ? options.tabReadyPollMs
            : DEFAULT_TAB_READY_POLL_MS;
        const sessionStorage = options.sessionStorage || chromeApi.storage?.session || null;
        let activeRun = null;
        let initialized = false;
        let initializationPromise = null;
        let authorityMutationQueue = Promise.resolve();

        function createRunId() {
            if (random === Math.random) return workflowUtils.createRecreateRunId(now());

            const suffix = String(random().toString(16).replace(/^0\./, '') || '0').slice(0, 8);
            return `recreate_${now()}_${suffix}`;
        }

        function storageAreaGet(area, keys) {
            return new Promise((resolve) => {
                if (!area?.get) {
                    resolve({});
                    return;
                }
                let settled = false;
                const finish = (value) => {
                    if (settled) return;
                    settled = true;
                    resolve(value || {});
                };
                try {
                    const pending = area.get(keys, finish);
                    if (pending && typeof pending.then === 'function') {
                        pending.then(finish, () => finish({}));
                    }
                } catch {
                    finish({});
                }
            });
        }

        function storageAreaSet(area, values) {
            return new Promise((resolve) => {
                if (!area?.set) {
                    resolve(false);
                    return;
                }
                let settled = false;
                const finish = (value) => {
                    if (settled) return;
                    settled = true;
                    resolve(value);
                };
                try {
                    const pending = area.set(values, () => finish(true));
                    if (pending && typeof pending.then === 'function') {
                        pending.then(() => finish(true), () => finish(false));
                    }
                } catch {
                    finish(false);
                }
            });
        }

        function storageAreaRemove(area, keys) {
            return new Promise((resolve) => {
                if (!area?.remove) {
                    resolve(false);
                    return;
                }
                let settled = false;
                const finish = (value) => {
                    if (settled) return;
                    settled = true;
                    resolve(value);
                };
                try {
                    const pending = area.remove(keys, () => finish(true));
                    if (pending && typeof pending.then === 'function') {
                        pending.then(() => finish(true), () => finish(false));
                    }
                } catch {
                    finish(false);
                }
            });
        }

        function enqueueAuthorityMutation(operation) {
            const execute = () => Promise.resolve().then(operation);
            const result = authorityMutationQueue.then(execute, execute);
            authorityMutationQueue = result.catch(() => {});
            return result;
        }

        function sanitizePersistedResultUrl(value) {
            const raw = String(value || '');
            if (!raw) return '';
            try {
                const parsed = new URL(raw);
                if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
                    throw createError('recreate_baseline_invalid');
                }
                if (parsed.search || parsed.hash || raw.length > 2048) {
                    throw createError('recreate_baseline_invalid');
                }
                return parsed.toString();
            } catch (error) {
                if (error?.code === 'recreate_baseline_invalid') throw error;
                throw createError('recreate_baseline_invalid');
            }
        }

        function sanitizeResultBaselineSignature(value) {
            const raw = String(value || '');
            if (!raw || raw.length > MAX_RESULT_BASELINE_SIGNATURE_LENGTH) {
                throw createError('recreate_baseline_invalid');
            }
            let parsed;
            try {
                parsed = JSON.parse(raw);
            } catch {
                throw createError('recreate_baseline_invalid');
            }
            const mediaKind = parsed?.mediaKind === 'video' ? 'video' : parsed?.mediaKind === 'image' ? 'image' : '';
            const sourceKind = String(parsed?.sourceKind || '');
            const width = Number(parsed?.width);
            const height = Number(parsed?.height);
            if (
                parsed?.version !== 1 ||
                !mediaKind ||
                !RESULT_SOURCE_KINDS.has(sourceKind) ||
                !Number.isInteger(width) || width < 0 || width > 32768 ||
                !Number.isInteger(height) || height < 0 || height > 32768
            ) {
                throw createError('recreate_baseline_invalid');
            }
            return JSON.stringify({
                version: 1,
                mediaKind,
                sourceKind,
                url: sanitizePersistedResultUrl(parsed.url),
                poster: sanitizePersistedResultUrl(parsed.poster),
                width,
                height
            });
        }

        function sanitizeResultBaselineSignatures(values) {
            if (!Array.isArray(values)) return [];
            if (values.length > MAX_RESULT_BASELINE_ITEMS) throw createError('recreate_baseline_invalid');
            return Array.from(new Set(values.map(sanitizeResultBaselineSignature)));
        }

        function sanitizeRunLease(run, overrides = {}) {
            return {
                schemaVersion: RECREATE_RUN_LEASE_VERSION,
                runId: String(run?.runId || ''),
                epoch: Number.isInteger(run?.epoch) ? run.epoch : 0,
                status: String(overrides.status || (run?.aborted ? 'cancelled' : 'running')),
                phase: String(overrides.phase || run?.phase || 'workflow'),
                operationId: String(run?.operationId || ''),
                operationTabId: Number.isInteger(run?.operationTabId) ? run.operationTabId : null,
                operationDocumentId: String(run?.operationDocumentId || ''),
                sourceTabId: Number.isInteger(run?.sourceTabId) ? run.sourceTabId : null,
                sourceDocumentId: String(run?.sourceDocumentId || ''),
                chatTabId: Number.isInteger(run?.chatTabId) ? run.chatTabId : null,
                imagineTabId: Number.isInteger(run?.imagineTabId) ? run.imagineTabId : null,
                resultBaselineAssetIds: Array.isArray(run?.resultBaselineAssetIds)
                    ? run.resultBaselineAssetIds.slice(0, MAX_RESULT_BASELINE_ITEMS)
                    : [],
                resultBaselineSignatures: Array.isArray(run?.resultBaselineSignatures)
                    ? sanitizeResultBaselineSignatures(run.resultBaselineSignatures)
                    : [],
                resultBaselineMediaKind: run?.resultBaselineMediaKind === 'video' ? 'video' : 'image',
                startedAt: Number(run?.startedAt || now()),
                updatedAt: now(),
                reason: String(overrides.reason || run?.abortReason || '')
            };
        }

        async function persistRunLease(run, overrides = {}) {
            if (!sessionStorage) return true;
            return await storageAreaSet(sessionStorage, {
                [RECREATE_RUN_SESSION_KEY]: sanitizeRunLease(run, overrides)
            });
        }

        async function removeRunLease() {
            if (!sessionStorage) return true;
            return await storageAreaRemove(sessionStorage, [RECREATE_RUN_SESSION_KEY]);
        }

        function tabsCreate(createOptions, errorCode, phase) {
            return new Promise((resolve, reject) => {
                chromeApi.tabs.create(createOptions, (tab) => {
                    if (chromeApi.runtime && chromeApi.runtime.lastError) {
                        reject(
                            createPhaseError(errorCode, phase, {
                                chromeLastError: chromeApi.runtime.lastError.message
                            })
                        );
                        return;
                    }
                    resolve(tab || {});
                });
            });
        }

        function tabsUpdate(tabId, updateOptions, errorCode, phase) {
            return new Promise((resolve, reject) => {
                if (!chromeApi.tabs.update) {
                    resolve({ id: tabId, ...updateOptions });
                    return;
                }

                chromeApi.tabs.update(tabId, updateOptions, (tab) => {
                    if (chromeApi.runtime && chromeApi.runtime.lastError) {
                        reject(
                            createPhaseError(errorCode, phase, {
                                chromeLastError: chromeApi.runtime.lastError.message
                            })
                        );
                        return;
                    }
                    resolve(tab || { id: tabId, ...updateOptions });
                });
            });
        }

        function tabsGet(tabId, errorCode, phase) {
            return new Promise((resolve, reject) => {
                if (!chromeApi.tabs.get) {
                    resolve({ id: tabId, status: 'complete' });
                    return;
                }

                chromeApi.tabs.get(tabId, (tab) => {
                    if (chromeApi.runtime && chromeApi.runtime.lastError) {
                        reject(
                            createPhaseError(errorCode, phase, {
                                chromeLastError: chromeApi.runtime.lastError.message
                            })
                        );
                        return;
                    }
                    resolve(tab || { id: tabId });
                });
            });
        }

        async function waitForTabReady(tabId, errorCode, phase, signal = null) {
            const startedAt = now();

            while (now() - startedAt <= tabReadyTimeoutMs) {
                if (signal?.aborted) throw createError('workflow_aborted');
                const tab = await tabsGet(tabId, errorCode, phase);
                if (tab && tab.status === 'complete') return tab;
                await wait(tabReadyPollMs, signal);
            }

            throw createPhaseError(errorCode, phase, {
                reason: 'tab_load_timeout',
                timeoutMs: tabReadyTimeoutMs
            });
        }

        async function waitForImaginePostReady(tabId, errorCode, phase, options = {}) {
            const startedAt = now();
            const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : tabReadyTimeoutMs;
            const signal = options.signal || null;

            while (now() - startedAt <= timeoutMs) {
                if (signal?.aborted) throw createError('workflow_aborted');
                const tab = await tabsGet(tabId, errorCode, phase);
                if (tab && tab.status === 'complete' && isGrokImaginePostUrl(tab.url)) return tab;
                await wait(tabReadyPollMs, signal);
            }

            throw createPhaseError(errorCode, phase, {
                reason: 'post_navigation_timeout',
                timeoutMs
            });
        }

        function executeScript(tabId, files, errorCode, phase) {
            return new Promise((resolve, reject) => {
                if (!chromeApi.scripting || !chromeApi.scripting.executeScript) {
                    reject(createPhaseError(errorCode, phase, { reason: 'scripting_unavailable' }));
                    return;
                }

                chromeApi.scripting.executeScript(
                    { target: { tabId }, files },
                    () => {
                        if (chromeApi.runtime && chromeApi.runtime.lastError) {
                            reject(
                                createPhaseError(errorCode, phase, {
                                    chromeLastError: chromeApi.runtime.lastError.message,
                                    action: 'executeScript'
                                })
                            );
                            return;
                        }
                        resolve();
                    }
                );
            });
        }

        function insertCss(tabId, files, errorCode, phase) {
            return new Promise((resolve, reject) => {
                if (!chromeApi.scripting || !chromeApi.scripting.insertCSS) {
                    resolve();
                    return;
                }

                chromeApi.scripting.insertCSS(
                    { target: { tabId }, files },
                    () => {
                        if (chromeApi.runtime && chromeApi.runtime.lastError) {
                            reject(
                                createPhaseError(errorCode, phase, {
                                    chromeLastError: chromeApi.runtime.lastError.message,
                                    action: 'insertCSS'
                                })
                            );
                            return;
                        }
                        resolve();
                    }
                );
            });
        }

        async function injectRecreateContentScripts(tabId, errorCode, phase, signal = null) {
            await waitForTabReady(tabId, errorCode, phase, signal);
            if (signal?.aborted) throw createError('workflow_aborted');
            await insertCss(tabId, RECREATE_CONTENT_CSS_FILES, errorCode, phase);
            if (signal?.aborted) throw createError('workflow_aborted');
            await executeScript(tabId, RECREATE_CONTENT_SCRIPT_FILES, errorCode, phase);
        }

        function tabsSendMessageOnce(
            tabId,
            message,
            errorCode,
            phase,
            timeoutMs,
            signal = null,
            documentId = ''
        ) {
            return new Promise((resolve, reject) => {
                let settled = false;
                const onAbort = () => finish(null, createError('workflow_aborted'));
                const timer = setTimeout(() => {
                    finish(null,
                        createPhaseError(errorCode, phase, {
                            reason: 'message_timeout',
                            action: message.action,
                            timeoutMs
                        })
                    );
                }, timeoutMs);

                function finish(value, error) {
                    if (settled) return;
                    settled = true;
                    clearTimeout(timer);
                    if (signal) signal.removeEventListener('abort', onAbort);
                    if (error) {
                        reject(error);
                        return;
                    }
                    resolve(value);
                }

                if (signal) {
                    if (signal.aborted) {
                        finish(null, createError('workflow_aborted'));
                        return;
                    }
                    signal.addEventListener('abort', onAbort, { once: true });
                }

                try {
                    const callback = (response) => {
                        if (settled) return;

                        if (chromeApi.runtime && chromeApi.runtime.lastError) {
                            finish(null,
                                createPhaseError(errorCode, phase, {
                                    chromeLastError: chromeApi.runtime.lastError.message,
                                    action: message.action
                                })
                            );
                            return;
                        }
                        finish(response);
                    };
                    if (documentId) {
                        chromeApi.tabs.sendMessage(tabId, message, { documentId }, callback);
                    } else {
                        chromeApi.tabs.sendMessage(tabId, message, callback);
                    }
                } catch (error) {
                    finish(null,
                        createPhaseError(errorCode, phase, {
                            chromeLastError: error.message,
                            action: message.action
                        })
                    );
                }
            });
        }

        async function tabsSendMessage(tabId, message, errorCode, phase, sendOptions = {}) {
            const timeoutMs = Number.isFinite(sendOptions.timeoutMs) ? sendOptions.timeoutMs : messageTimeoutMs;
            const retryReceiverNotReady = sendOptions.retryReceiverNotReady !== false;
            const maxAttempts = retryReceiverNotReady ? receiverRetryAttempts : 1;
            const signal = sendOptions.signal || null;
            let lastError = null;
            let injected = false;

            for (let attempt = 1; attempt <= maxAttempts; attempt++) {
                try {
                    if (signal?.aborted) throw createError('workflow_aborted');
                    return await tabsSendMessageOnce(
                        tabId,
                        message,
                        errorCode,
                        phase,
                        timeoutMs,
                        signal,
                        sendOptions.documentId || ''
                    );
                } catch (error) {
                    lastError = error;
                    if (error?.code === 'workflow_aborted') throw error;
                    if (!retryReceiverNotReady || !isReceiverNotReadyError(error) || attempt >= maxAttempts) {
                        throw error;
                    }
                    if (!injected) {
                        await injectRecreateContentScripts(tabId, errorCode, phase, signal);
                        injected = true;
                    }
                    if (signal?.aborted) throw createError('workflow_aborted');
                    await wait(receiverRetryDelayMs);
                }
            }

            throw lastError;
        }

        async function sendCancellationToTab(tabId, lease, reason, documentId = '') {
            if (!Number.isInteger(tabId)) return false;
            try {
                const response = await tabsSendMessageOnce(tabId, {
                    action: 'GPT_RECREATE_CANCEL',
                    runId: lease.runId,
                    epoch: lease.epoch,
                    reason
                }, 'cancel_delivery_failed', 'cancelled', statusMessageTimeoutMs, null, documentId);
                return response?.ok === true
                    && response?.acknowledged === true
                    && String(response?.runId || '') === String(lease.runId || '');
            } catch {
                return false;
            }
        }

        function getCancellationTargets(lease) {
            const documentsByTab = new Map();
            const addTab = (tabId) => {
                if (Number.isInteger(tabId) && !documentsByTab.has(tabId)) documentsByTab.set(tabId, new Set());
            };
            addTab(lease?.sourceTabId);
            addTab(lease?.chatTabId);
            addTab(lease?.imagineTabId);
            if (Number.isInteger(lease?.sourceTabId) && lease?.sourceDocumentId) {
                documentsByTab.get(lease.sourceTabId).add(String(lease.sourceDocumentId));
            }
            if (Number.isInteger(lease?.operationTabId) && lease?.operationDocumentId) {
                addTab(lease.operationTabId);
                documentsByTab.get(lease.operationTabId).add(String(lease.operationDocumentId));
            }

            return Array.from(documentsByTab.entries()).flatMap(([tabId, documentIds]) => (
                documentIds.size > 0
                    ? Array.from(documentIds, (documentId) => ({ tabId, documentId }))
                    : [{ tabId, documentId: '' }]
            ));
        }

        async function deliverCancellation(lease, reason) {
            const targets = getCancellationTargets(lease);
            if (targets.length === 0) return true;
            const results = await Promise.all(targets.map(({ tabId, documentId }) => (
                sendCancellationToTab(tabId, lease, reason, documentId)
            )));
            return results.every(Boolean);
        }

        function hydrateCancellingRun(lease, reason) {
            const abortController = new AbortController();
            abortController.abort();
            return {
                ...lease,
                aborted: true,
                abortReason: reason,
                abortController,
                cancellationAcknowledged: false,
                recoveryPending: true,
                submissionMayHaveOccurred: true,
                operationSequence: 0
            };
        }

        async function finalizePersistedCancellation(run, reason) {
            if (!run) return true;
            const cancellationLease = sanitizeRunLease(run, { status: 'cancelling', reason });
            const persisted = await storageAreaSet(sessionStorage, {
                [RECREATE_RUN_SESSION_KEY]: cancellationLease
            });
            if (!persisted) return false;
            const acknowledged = await deliverCancellation(cancellationLease, reason);
            if (!acknowledged) return false;

            run.cancellationAcknowledged = true;
            await appendRecreateLedgerEntry({
                runId: run.runId,
                createdAt: new Date(Number(run.startedAt || now())).toISOString(),
                status: 'cancelled',
                phase: run.phase || 'workflow',
                error: reason
            });
            await removeRunLease();
            if (activeRun?.runId === run.runId && activeRun?.epoch === run.epoch) activeRun = null;
            return true;
        }

        async function initialize() {
            if (initialized) return null;
            if (!initializationPromise) {
                initializationPromise = (async () => {
                    const stored = await storageAreaGet(sessionStorage, [RECREATE_RUN_SESSION_KEY]);
                    const lease = stored?.[RECREATE_RUN_SESSION_KEY];
                    if (lease?.schemaVersion === RECREATE_RUN_LEASE_VERSION
                        && lease.runId
                        && (lease.status === 'running' || lease.status === 'cancelling')) {
                        activeRun = hydrateCancellingRun(lease, 'worker_restarted');
                        await finalizePersistedCancellation(activeRun, 'worker_restarted');
                    } else if (lease) {
                        await removeRunLease();
                    }
                    initialized = true;
                    return null;
                })().catch((error) => {
                    initializationPromise = null;
                    throw error;
                });
            }
            return initializationPromise;
        }

        function ensureActive(run) {
            if (!activeRun
                || activeRun.runId !== run.runId
                || activeRun.epoch !== run.epoch
                || activeRun.aborted
                || run.abortController?.signal?.aborted) {
                throw createError('workflow_aborted');
            }
        }

        async function setRunPhase(run, phase, operationTabId = null) {
            return await enqueueAuthorityMutation(async () => {
                ensureActive(run);
                run.phase = phase;
                run.operationSequence = Number(run.operationSequence || 0) + 1;
                run.operationId = `${run.runId}:${run.epoch}:${phase}:${run.operationSequence}`;
                run.operationTabId = Number.isInteger(operationTabId) ? operationTabId : null;
                run.operationDocumentId = (
                    run.operationTabId === run.sourceTabId && run.sourceDocumentId
                ) ? run.sourceDocumentId : '';
                const persisted = await persistRunLease(run);
                if (!persisted) throw createError('recreate_authority_persist_failed');
                ensureActive(run);
                return {
                    runId: run.runId,
                    epoch: run.epoch,
                    operationId: run.operationId,
                    phase,
                    documentId: run.operationDocumentId
                };
            });
        }

        async function authorizeContentOperation(request, sender = {}) {
            const authority = request?.authority || request || {};
            const senderTabId = Number.isInteger(sender?.tab?.id) ? sender.tab.id : null;
            const senderDocumentId = String(sender?.documentId || '');
            return await enqueueAuthorityMutation(async () => {
                if (!activeRun
                    || activeRun.aborted
                    || activeRun.abortController?.signal?.aborted
                    || authority.runId !== activeRun.runId
                    || authority.epoch !== activeRun.epoch
                    || authority.operationId !== activeRun.operationId
                    || authority.phase !== activeRun.phase
                    || senderTabId !== activeRun.operationTabId
                    || !senderDocumentId) {
                    throw createError('workflow_aborted');
                }
                if (activeRun.operationDocumentId && senderDocumentId !== activeRun.operationDocumentId) {
                    throw createError('workflow_aborted');
                }
                if (!activeRun.operationDocumentId) {
                    activeRun.operationDocumentId = senderDocumentId;
                    const persisted = await persistRunLease(activeRun);
                    if (!persisted) throw createError('recreate_authority_persist_failed');
                }

                const captured = {
                    runId: activeRun.runId,
                    epoch: activeRun.epoch,
                    operationId: activeRun.operationId,
                    phase: activeRun.phase,
                    tabId: senderTabId,
                    documentId: senderDocumentId
                };
                return {
                    signal: activeRun.abortController.signal,
                    assertAuthorized() {
                        if (!activeRun
                            || activeRun.runId !== captured.runId
                            || activeRun.epoch !== captured.epoch
                            || activeRun.aborted
                            || activeRun.abortController?.signal?.aborted
                            || captured.operationId !== activeRun.operationId
                            || captured.phase !== activeRun.phase
                            || captured.tabId !== activeRun.operationTabId
                            || captured.documentId !== activeRun.operationDocumentId) {
                            throw createError('workflow_aborted');
                        }
                    }
                };
            });
        }

        async function recordResultBaseline(request, sender = {}) {
            const operation = await authorizeContentOperation(request, sender);
            const assetIds = Array.isArray(request?.assetIds)
                ? Array.from(new Set(request.assetIds.map((value) => String(value || '').toLowerCase())))
                : [];
            if (assetIds.length > MAX_RESULT_BASELINE_ITEMS || assetIds.some((assetId) => !UUID_RE.test(assetId))) {
                throw createError('recreate_baseline_invalid');
            }
            const signatures = sanitizeResultBaselineSignatures(request?.signatures);
            const mediaKind = request?.mediaKind === 'video' ? 'video' : 'image';

            return await enqueueAuthorityMutation(async () => {
                operation.assertAuthorized();
                activeRun.resultBaselineAssetIds = assetIds;
                activeRun.resultBaselineSignatures = signatures;
                activeRun.resultBaselineMediaKind = mediaKind;
                const persisted = await persistRunLease(activeRun);
                if (!persisted) throw createError('recreate_authority_persist_failed');
                operation.assertAuthorized();
                return {
                    ok: true,
                    recorded: assetIds.length,
                    recordedSignatures: signatures.length,
                    mediaKind
                };
            });
        }

        async function sendRunOperation(run, tabId, action, payload, errorCode, phase, sendOptions = {}) {
            const authority = await setRunPhase(run, phase, tabId);
            return await tabsSendMessage(tabId, {
                action,
                ...payload,
                ...authority
            }, errorCode, phase, {
                ...sendOptions,
                documentId: authority.documentId || sendOptions.documentId || '',
                signal: run.abortController.signal
            });
        }

        async function sendStatus(run, phase, message, type = 'info') {
            if (!run || !run.sourceTabId) return;

            try {
                await tabsSendMessage(run.sourceTabId, {
                    action: 'GPT_RECREATE_STATUS',
                    runId: run.runId,
                    phase,
                    message,
                    type
                }, 'status_delivery_failed', phase, {
                    documentId: run.sourceDocumentId || '',
                    retryReceiverNotReady: false,
                    timeoutMs: statusMessageTimeoutMs
                });
            } catch (error) {
                console.warn('Recreate status delivery failed:', error.message);
            }
        }

        function buildFailure(run, phase, error, diagnostics = {}) {
            const failure = workflowUtils.buildRecreateFailure({
                runId: run && run.runId,
                phase: error && error.phase ? error.phase : phase,
                error: normalizeErrorCode(error),
                diagnostics: {
                    ...(error && error.diagnostics ? error.diagnostics : {}),
                    ...diagnostics
                }
            });
            return {
                ...failure,
                retrySafe: !!run && run.submissionMayHaveOccurred !== true
            };
        }

        function buildResponseFailure(run, fallbackPhase, fallbackError, response) {
            return buildFailure(run, response && response.phase ? response.phase : fallbackPhase, {
                code: response && response.error ? response.error : fallbackError
            }, response && response.diagnostics ? response.diagnostics : {});
        }

        function storageLocalGet(keys) {
            return new Promise((resolve) => {
                if (!chromeApi.storage || !chromeApi.storage.local || !chromeApi.storage.local.get) {
                    resolve({});
                    return;
                }

                try {
                    const result = chromeApi.storage.local.get(keys, (stored) => {
                        resolve(stored || {});
                    });
                    if (result && typeof result.then === 'function') {
                        result.then((stored) => resolve(stored || {}), () => resolve({}));
                    }
                } catch {
                    resolve({});
                }
            });
        }

        function storageLocalSet(values) {
            return new Promise((resolve) => {
                if (!chromeApi.storage || !chromeApi.storage.local || !chromeApi.storage.local.set) {
                    resolve(false);
                    return;
                }

                try {
                    const result = chromeApi.storage.local.set(values, () => resolve(true));
                    if (result && typeof result.then === 'function') {
                        result.then(() => resolve(true), () => resolve(false));
                    }
                } catch {
                    resolve(false);
                }
            });
        }

        async function appendRecreateLedgerEntry(entry) {
            try {
                const stored = await storageLocalGet(['gptRecreateRunLedger']);
                const ledger = Array.isArray(stored.gptRecreateRunLedger) ? stored.gptRecreateRunLedger : [];
                await storageLocalSet({ gptRecreateRunLedger: [entry, ...ledger].slice(0, 100) });
            } catch {
                // Ledger writes are diagnostic only and must not fail generation.
            }
        }

        async function clearActiveRun(run, status = 'completed', reason = '') {
            if (status === 'cancelled' && run) {
                const acknowledged = run.cancellationAcknowledged === true
                    || await Promise.resolve(run.cancellationPromise).catch(() => false);
                run.cancellationAcknowledged = acknowledged === true;
                if (!acknowledged) {
                    return await enqueueAuthorityMutation(async () => {
                        if (!activeRun || activeRun.runId !== run.runId) return false;
                        run.recoveryPending = true;
                        await persistRunLease(run, { status: 'cancelling', reason });
                        return false;
                    });
                }
            }

            return await enqueueAuthorityMutation(async () => {
                if (!activeRun || !run || activeRun.runId !== run.runId) return false;
                await persistRunLease(run, { status, reason });
                await removeRunLease();
                activeRun = null;
                return true;
            });
        }

        async function getImagineTabId(run) {
            if (isGrokImagineUrl(run.sourceTabUrl)) {
                await tabsUpdate(run.sourceTabId, { active: true }, 'imagine_tab_unavailable', 'imagine');
                await waitForTabReady(run.sourceTabId, 'imagine_tab_unavailable', 'imagine', run.abortController.signal);
                return run.sourceTabId;
            }

            const imagineTab = await tabsCreate({ url: IMAGINE_URL, active: true }, 'imagine_tab_unavailable', 'imagine');
            await waitForTabReady(imagineTab.id, 'imagine_tab_unavailable', 'imagine', run.abortController.signal);
            return imagineTab.id;
        }

        async function validateOpenedImaginePost(run, referenceKind, generatedPrompt) {
            await waitForImaginePostReady(run.imagineTabId, 'imagine_tab_unavailable', 'imagine', {
                signal: run.abortController.signal
            });
            ensureActive(run);
            await injectRecreateContentScripts(
                run.imagineTabId,
                'imagine_tab_unavailable',
                'imagine',
                run.abortController.signal
            );
            ensureActive(run);
            return await sendRunOperation(run, run.imagineTabId, 'GPT_RECREATE_IMAGINE_POST_VALIDATION_STEP', {
                generatedPrompt,
                targetMode: referenceKind,
                referenceKind,
                mediaKind: referenceKind,
                baselineAssetIds: Array.isArray(run.resultBaselineAssetIds)
                    ? run.resultBaselineAssetIds
                    : [],
                baselineSignatures: Array.isArray(run.resultBaselineSignatures)
                    ? run.resultBaselineSignatures
                    : []
            }, 'imagine_tab_unavailable', 'imagine_validation', {
                timeoutMs: messageTimeoutMs
            });
        }

        async function recoverFromOpenedImaginePost(run, referenceKind, generatedPrompt, generatedMediaLabel) {
            await waitForImaginePostReady(run.imagineTabId, 'imagine_tab_unavailable', 'imagine', {
                timeoutMs: messageTimeoutMs,
                signal: run.abortController.signal
            });
            await sendStatus(run, 'imagine', `Validating opened Grok post ${generatedMediaLabel}...`, 'info');
            ensureActive(run);
            return await validateOpenedImaginePost(run, referenceKind, generatedPrompt);
        }

        function ignoreFailedPostRecovery(promise) {
            return promise.catch(() => new Promise(() => {}));
        }

        async function start(request = {}, context = {}) {
            if (!initialized) await initialize();
            if (activeRun?.recoveryPending) {
                await finalizePersistedCancellation(
                    activeRun,
                    activeRun.abortReason || 'worker_restarted'
                );
            }
            if (activeRun) {
                return buildFailure(
                    activeRun,
                    activeRun.recoveryPending ? 'cancelling' : 'workflow',
                    activeRun.recoveryPending ? 'recreate_recovery_pending' : 'workflow_active'
                );
            }

            const run = {
                runId: createRunId(),
                epoch: 1,
                sourceTabId: context.sourceTabId,
                sourceTabUrl: context.sourceTabUrl,
                sourceDocumentId: context.sourceDocumentId || '',
                aborted: false,
                abortController: new AbortController(),
                chatTabId: null,
                imagineTabId: null,
                phase: 'workflow',
                operationId: '',
                operationTabId: null,
                operationDocumentId: '',
                operationSequence: 0,
                submissionMayHaveOccurred: false,
                startedAt: now()
            };
            activeRun = run;

            let ledgerBase = null;

            try {
                const initialLeasePersisted = await persistRunLease(run);
                if (!initialLeasePersisted) throw createError('recreate_authority_persist_failed');
                const reference = workflowUtils.normalizeRecreateReference(request.reference);
                const referenceKind = reference.kind === 'video' ? 'video' : 'image';
                const generatedMediaLabel = referenceKind === 'video' ? 'video' : 'image';
                ledgerBase = {
                    runId: run.runId,
                    createdAt: new Date(now()).toISOString(),
                    referenceKind,
                    promptVersion: referenceKind === 'video' ? 'video-recreate-v1' : 'image-recreate-v1',
                    source: reference.source,
                    referenceSource: reference.source,
                    name: reference.name,
                    referenceName: reference.name,
                    mimeType: reference.mimeType,
                    referenceMimeType: reference.mimeType,
                    byteLength: reference.byteLength || 0,
                    sourceByteLength: reference.byteLength || 0,
                    sourceUrl: reference.url || ''
                };

                await sendStatus(run, 'chat', 'Opening Grok chat tab...', 'info');
                ensureActive(run);
                await setRunPhase(run, 'chat_opening');

                const chatTab = await tabsCreate({ url: CHAT_URL, active: true }, 'chat_tab_unavailable', 'chat');
                run.chatTabId = chatTab.id;
                ensureActive(run);

                await setRunPhase(run, 'chat_loading');
                await waitForTabReady(run.chatTabId, 'chat_tab_unavailable', 'chat', run.abortController.signal);
                ensureActive(run);

                const chatResponse = await sendRunOperation(run, run.chatTabId, 'GPT_RECREATE_CHAT_STEP', {
                    reference,
                    referenceKind,
                    bestPracticesEnabled: !!request.bestPracticesEnabled
                }, 'chat_tab_unavailable', 'chat');
                ensureActive(run);

                if (!chatResponse || !chatResponse.ok) {
                    const failed = buildResponseFailure(run, 'chat', 'chat_answer_timeout', chatResponse);
                    await appendRecreateLedgerEntry({
                        ...ledgerBase,
                        status: 'failed',
                        phase: failed.phase,
                        error: failed.error
                    });
                    await sendStatus(run, failed.phase, failed.error, 'error');
                    await clearActiveRun(run, 'failed', failed.error);
                    return failed;
                }

                if (chatResponse.referenceSummary) {
                    ledgerBase = {
                        ...ledgerBase,
                        ...chatResponse.referenceSummary,
                        referenceKind
                    };
                }

                const generatedPrompt =
                    typeof chatResponse.generatedPrompt === 'string' ? chatResponse.generatedPrompt.trim() : '';
                if (!generatedPrompt) {
                    const failed = buildFailure(run, 'chat', 'chat_prompt_marker_missing');
                    await appendRecreateLedgerEntry({
                        ...ledgerBase,
                        status: 'failed',
                        phase: failed.phase,
                        error: failed.error
                    });
                    await sendStatus(run, failed.phase, failed.error, 'error');
                    await clearActiveRun(run, 'failed', failed.error);
                    return failed;
                }

                await sendStatus(run, 'imagine', `Submitting prompt and waiting for generated ${generatedMediaLabel}...`, 'info');
                ensureActive(run);

                await setRunPhase(run, 'imagine_opening');
                run.imagineTabId = await getImagineTabId(run);
                ensureActive(run);

                let imagineResponse;
                run.submissionMayHaveOccurred = true;
                const imagineSubmitPromise = sendRunOperation(
                    run,
                    run.imagineTabId,
                    'GPT_RECREATE_IMAGINE_STEP',
                    {
                    generatedPrompt,
                    targetMode: referenceKind,
                    referenceKind,
                    autoSubmit: true
                    },
                    'imagine_tab_unavailable',
                    'imagine'
                );
                const openedPostRecoveryPromise = ignoreFailedPostRecovery(
                    recoverFromOpenedImaginePost(run, referenceKind, generatedPrompt, generatedMediaLabel)
                );

                try {
                    imagineResponse = await Promise.race([imagineSubmitPromise, openedPostRecoveryPromise]);
                } catch (error) {
                    if (!isMessageChannelClosedError(error)) throw error;
                    await sendStatus(run, 'imagine', `Validating opened Grok post ${generatedMediaLabel}...`, 'info');
                    ensureActive(run);
                    imagineResponse = await validateOpenedImaginePost(run, referenceKind, generatedPrompt);
                }
                ensureActive(run);

                if (!imagineResponse || !imagineResponse.ok) {
                    const failed = buildResponseFailure(run, 'imagine', 'imagine_submit_failed', imagineResponse);
                    await appendRecreateLedgerEntry({
                        ...ledgerBase,
                        status: 'failed',
                        phase: failed.phase,
                        error: failed.error,
                        generatedPrompt
                    });
                    await sendStatus(run, failed.phase, failed.error, 'error');
                    await clearActiveRun(run, 'failed', failed.error);
                    return failed;
                }

                if (imagineResponse.submitted !== true) {
                    const failed = buildFailure(run, 'imagine', 'imagine_submit_failed', imagineResponse.diagnostics || {});
                    await appendRecreateLedgerEntry({
                        ...ledgerBase,
                        status: 'failed',
                        phase: failed.phase,
                        error: failed.error,
                        generatedPrompt
                    });
                    await sendStatus(run, failed.phase, failed.error, 'error');
                    await clearActiveRun(run, 'failed', failed.error);
                    return failed;
                }

                if (imagineResponse.resultReady !== true) {
                    const failed = buildFailure(run, 'imagine', 'imagine_result_unverified', imagineResponse.diagnostics || {});
                    await appendRecreateLedgerEntry({
                        ...ledgerBase,
                        status: 'failed',
                        phase: failed.phase,
                        error: failed.error,
                        generatedPrompt
                    });
                    await sendStatus(run, failed.phase, failed.error, 'error');
                    await clearActiveRun(run, 'failed', failed.error);
                    return failed;
                }

                const outputUrl =
                    imagineResponse.result && (
                        imagineResponse.result.openedUrl ||
                        imagineResponse.result.url ||
                        imagineResponse.result.postUrl ||
                        ''
                    );
                await appendRecreateLedgerEntry({
                    ...ledgerBase,
                    status: 'success',
                    phase: 'done',
                    generatedPrompt,
                    outputUrl,
                    outputMediaHash: imagineResponse.result && imagineResponse.result.outputMediaHash || null,
                    resultByteLength: imagineResponse.result && Number.isFinite(imagineResponse.result.byteLength)
                        ? imagineResponse.result.byteLength
                        : null,
                    subjectiveNotes: ''
                });
                await sendStatus(run, 'done', `Generated ${generatedMediaLabel} ready.`, 'success');
                await clearActiveRun(run, 'completed');

                return {
                    ok: true,
                    runId: run.runId,
                    referenceKind,
                    generatedPrompt,
                    submitted: true,
                    resultReady: true,
                    result: imagineResponse.result
                };
            } catch (error) {
                const aborted = error?.code === 'workflow_aborted' || run.aborted;
                const result = buildFailure(run, 'workflow', error, {
                    sourceTabUrl: run.sourceTabUrl,
                    chatTabId: run.chatTabId,
                    imagineTabId: run.imagineTabId
                });
                if (!aborted) {
                    await appendRecreateLedgerEntry({
                        ...(ledgerBase || {
                            runId: run.runId,
                            createdAt: new Date(now()).toISOString()
                        }),
                        status: 'failed',
                        phase: result.phase,
                        error: result.error
                    });
                    await sendStatus(run, result.phase, result.error, 'error');
                    await clearActiveRun(run, 'failed', result.error);
                    return result;
                }
                const cleared = await clearActiveRun(run, 'cancelled', result.error);
                if (cleared) {
                    await appendRecreateLedgerEntry({
                        ...(ledgerBase || {
                            runId: run.runId,
                            createdAt: new Date(now()).toISOString()
                        }),
                        status: 'cancelled',
                        phase: result.phase,
                        error: result.error
                    });
                }
                return result;
            }
        }

        async function abort(reason = 'user') {
            if (!initialized) await initialize();
            if (!activeRun) {
                return {
                    ok: true,
                    aborted: true,
                    reason: 'no_active_run',
                    status: 'stopped',
                    retrySafe: false,
                    retrySafeWhenStopped: false
                };
            }

            const run = activeRun;
            if (run.recoveryPending) {
                const cleared = await finalizePersistedCancellation(
                    run,
                    run.abortReason || reason
                );
                return {
                    ok: true,
                    runId: run.runId,
                    aborted: true,
                    reason,
                    status: cleared ? 'stopped' : 'stopping',
                    retrySafe: false,
                    retrySafeWhenStopped: false
                };
            }
            run.aborted = true;
            run.abortReason = reason;
            const cancellationLease = sanitizeRunLease(run, { status: 'cancelling', reason });
            run.cancellationPromise = (async () => {
                const persisted = await storageAreaSet(sessionStorage, {
                    [RECREATE_RUN_SESSION_KEY]: cancellationLease
                });
                if (!persisted && sessionStorage) return false;
                return await deliverCancellation(cancellationLease, reason);
            })();
            run.abortController.abort();
            run.cancellationAcknowledged = await run.cancellationPromise;

            const releaseDeadline = now() + Math.max(1000, statusMessageTimeoutMs * 2);
            while (activeRun?.runId === run.runId && now() < releaseDeadline) {
                await wait(25);
            }
            const stillStopping = activeRun?.runId === run.runId;
            if (Number.isInteger(run.sourceTabId)) {
                try {
                    await tabsSendMessageOnce(run.sourceTabId, {
                        action: 'GPT_RECREATE_STATUS',
                        runId: run.runId,
                        phase: stillStopping ? 'cancelling' : 'cancelled',
                        message: stillStopping ? 'Stopping...' : 'Cancelled.',
                        type: 'neutral'
                    }, 'status_delivery_failed', 'cancelled', statusMessageTimeoutMs, null, run.sourceDocumentId || '');
                } catch {
                    // The start response still resolves with workflow_aborted.
                }
            }

            return {
                ok: true,
                runId: run.runId,
                aborted: true,
                reason,
                status: stillStopping ? 'stopping' : 'stopped',
                retrySafe: !stillStopping && run.submissionMayHaveOccurred !== true,
                retrySafeWhenStopped: run.submissionMayHaveOccurred !== true
            };
        }

        async function getRunStatus() {
            if (!initialized) await initialize();
            if (activeRun?.recoveryPending) {
                await finalizePersistedCancellation(
                    activeRun,
                    activeRun.abortReason || 'worker_restarted'
                );
            }
            return getActiveRunStatus();
        }

        function getActiveRunForTest() {
            return activeRun ? { ...activeRun } : null;
        }

        function getActiveRunStatus() {
            if (!activeRun) return null;
            return {
                kind: 'recreate',
                status: activeRun.aborted ? 'stopping' : 'running',
                runId: activeRun.runId,
                phase: activeRun.phase || 'workflow'
            };
        }

        return {
            abort,
            authorizeContentOperation,
            getActiveRunStatus,
            getRunStatus,
            getActiveRunForTest,
            initialize,
            recordResultBaseline,
            start
        };
    }

    return { createRecreateWorkflowController };
});
