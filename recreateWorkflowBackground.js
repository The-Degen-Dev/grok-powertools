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
    const DEFAULT_CHAT_MESSAGE_TIMEOUT_MS = 135000;
    const DEFAULT_STATUS_MESSAGE_TIMEOUT_MS = 1000;
    const DEFAULT_RECEIVER_RETRY_ATTEMPTS = 6;
    const DEFAULT_RECEIVER_RETRY_DELAY_MS = 250;
    const DEFAULT_TAB_READY_TIMEOUT_MS = 30000;
    const DEFAULT_TAB_READY_POLL_MS = 250;
    const RECREATE_RUN_SESSION_KEY = 'gptRecreateRunLease';
    const RECREATE_RUN_LEASE_VERSION = 2;
    const MAX_RESULT_BASELINE_ITEMS = 200;
    const MAX_RESULT_BASELINE_SIGNATURE_LENGTH = 8192;
    const SUBMISSION_STATES = Object.freeze({
        notDispatched: 'not_dispatched',
        dispatching: 'dispatching',
        clickSent: 'click_sent',
        providerAccepted: 'provider_accepted',
        resultClaimed: 'result_claimed',
        dispatched: 'dispatched',
        unknown: 'unknown'
    });
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

    function isGrokImagineResultUrl(value) {
        try {
            const url = new URL(String(value || ''));
            return (
                url.protocol === 'https:' &&
                url.hostname === 'grok.com' &&
                (url.pathname === '/imagine' || url.pathname.startsWith('/imagine/'))
            );
        } catch {
            return false;
        }
    }

    function normalizeSubmissionState(value, phase = '') {
        if (Object.values(SUBMISSION_STATES).includes(value)) return value;
        if (/^imagine(?:$|_)/.test(String(phase || ''))) return SUBMISSION_STATES.unknown;
        return SUBMISSION_STATES.notDispatched;
    }

    function isRetrySafeSubmissionState(value) {
        return normalizeSubmissionState(value) === SUBMISSION_STATES.notDispatched;
    }

    function canTransitionSubmissionState(currentValue, nextValue) {
        const current = normalizeSubmissionState(currentValue);
        const next = normalizeSubmissionState(nextValue);
        if (current === next) return true;
        if (next === SUBMISSION_STATES.dispatching) return current === SUBMISSION_STATES.notDispatched;
        if (next === SUBMISSION_STATES.notDispatched) return current === SUBMISSION_STATES.dispatching;
        if (next === SUBMISSION_STATES.clickSent) return current === SUBMISSION_STATES.dispatching;
        if (next === SUBMISSION_STATES.unknown) {
            return current === SUBMISSION_STATES.dispatching || current === SUBMISSION_STATES.clickSent;
        }
        if (next === SUBMISSION_STATES.providerAccepted) {
            return current === SUBMISSION_STATES.dispatching
                || current === SUBMISSION_STATES.clickSent
                || current === SUBMISSION_STATES.dispatched
                || current === SUBMISSION_STATES.unknown;
        }
        if (next === SUBMISSION_STATES.resultClaimed) {
            return current === SUBMISSION_STATES.providerAccepted
                || current === SUBMISSION_STATES.clickSent
                || current === SUBMISSION_STATES.dispatched
                || current === SUBMISSION_STATES.unknown;
        }
        if (next === SUBMISSION_STATES.dispatched) {
            return current === SUBMISSION_STATES.dispatching || current === SUBMISSION_STATES.clickSent;
        }
        return false;
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
        return /message (?:channel|port) closed|asynchronous response|extension context invalidated/i.test(message);
    }

    function isContentDocumentUnavailableError(error) {
        const message = String((error && error.diagnostics && error.diagnostics.chromeLastError) || error.message || '');
        return isReceiverNotReadyError(error)
            || /no (?:frame|document|tab) with id|frame with id .* was removed|extension context invalidated/i.test(message);
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
        const chatMessageTimeoutMs = Number.isFinite(options.chatMessageTimeoutMs)
            ? options.chatMessageTimeoutMs
            : DEFAULT_CHAT_MESSAGE_TIMEOUT_MS;
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
                chatDocumentId: String(run?.chatDocumentId || ''),
                imagineTabId: Number.isInteger(run?.imagineTabId) ? run.imagineTabId : null,
                imagineDocumentId: String(run?.imagineDocumentId || ''),
                submissionState: normalizeSubmissionState(run?.submissionState, run?.phase),
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

        async function waitForImagineResultSurfaceReady(tabId, initialUrl, errorCode, phase, options = {}) {
            const startedAt = now();
            const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : tabReadyTimeoutMs;
            const signal = options.signal || null;
            const normalizedInitialUrl = String(initialUrl || '');
            let navigationObserved = false;
            const onUpdated = (updatedTabId, changeInfo) => {
                if (updatedTabId !== tabId) return;
                if (changeInfo?.status === 'loading' || typeof changeInfo?.url === 'string') {
                    navigationObserved = true;
                }
            };
            if (chromeApi.tabs?.onUpdated?.addListener) chromeApi.tabs.onUpdated.addListener(onUpdated);

            try {
                while (now() - startedAt <= timeoutMs) {
                    if (signal?.aborted) throw createError('workflow_aborted');
                    const tab = await tabsGet(tabId, errorCode, phase);
                    const currentUrl = String(tab?.url || '');
                    const routeChanged = currentUrl !== normalizedInitialUrl;
                    if (tab?.status === 'complete'
                        && isGrokImagineResultUrl(currentUrl)
                        && (routeChanged || navigationObserved)) {
                        return tab;
                    }
                    await wait(tabReadyPollMs, signal);
                }
            } finally {
                if (chromeApi.tabs?.onUpdated?.removeListener) chromeApi.tabs.onUpdated.removeListener(onUpdated);
            }

            throw createPhaseError(errorCode, phase, {
                reason: 'result_surface_navigation_timeout',
                timeoutMs
            });
        }

        async function waitForSubmissionDispatch(run, options = {}) {
            const startedAt = now();
            const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : messageTimeoutMs;
            const signal = options.signal || null;

            while (now() - startedAt <= timeoutMs) {
                if (signal?.aborted) throw createError('workflow_aborted');
                ensureActive(run);
                if (!isRetrySafeSubmissionState(run.submissionState)) return;
                await wait(tabReadyPollMs, signal);
            }

            throw createPhaseError('imagine_submit_failed', 'imagine', {
                reason: 'submission_not_dispatched',
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
            const message = {
                action: 'GPT_RECREATE_CANCEL',
                runId: lease.runId,
                epoch: lease.epoch,
                reason
            };
            const send = async (targetDocumentId = '', requireActiveCancellation = false) => {
                const response = await tabsSendMessageOnce(
                    tabId,
                    message,
                    'cancel_delivery_failed',
                    'cancelled',
                    statusMessageTimeoutMs,
                    null,
                    targetDocumentId
                );
                return response?.ok === true
                    && response?.acknowledged === true
                    && String(response?.runId || '') === String(lease.runId || '')
                    && (!requireActiveCancellation || Number(response?.cancelled || 0) > 0);
            };

            if (documentId) {
                try {
                    if (await send(documentId)) return true;
                } catch (error) {
                    if (!isContentDocumentUnavailableError(error)) return false;
                    try {
                        await send('', true);
                    } catch {
                        // The replacement document may not have mounted the content script yet.
                    }
                    return true;
                }
            }

            try {
                return await send('', true);
            } catch (error) {
                // A missing current document means navigation already ended the old operation.
                return isContentDocumentUnavailableError(error);
            }
        }

        function getCancellationTargets(lease) {
            const targets = new Map();
            const addTab = (tabId, documentId = '') => {
                if (!Number.isInteger(tabId)) return;
                const existing = targets.get(tabId);
                if (!existing || (!existing.documentId && documentId)) {
                    targets.set(tabId, { tabId, documentId: String(documentId || '') });
                }
            };
            addTab(lease?.operationTabId, lease?.operationDocumentId);
            addTab(lease?.sourceTabId, lease?.sourceDocumentId);
            addTab(lease?.chatTabId, lease?.chatDocumentId);
            addTab(lease?.imagineTabId, lease?.imagineDocumentId);
            return Array.from(targets.values());
        }

        async function deliverCancellation(lease, reason, confirmedAbsentTargets = new Set()) {
            const targets = getCancellationTargets(lease);
            if (targets.length === 0) return true;
            const results = await Promise.all(targets.map(({ tabId, documentId }) => (
                confirmedAbsentTargets.has(`${tabId}:${documentId}`)
                    ? true
                    : sendCancellationToTab(tabId, lease, reason, documentId)
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
                submissionState: normalizeSubmissionState(lease?.submissionState, lease?.phase),
                operationSequence: 0
            };
        }

        async function finalizePersistedCancellation(run, reason, confirmedAbsentTargets = new Set()) {
            if (!run) return true;
            const cancellationLease = sanitizeRunLease(run, { status: 'cancelling', reason });
            const persisted = await storageAreaSet(sessionStorage, {
                [RECREATE_RUN_SESSION_KEY]: cancellationLease
            });
            if (!persisted) return false;
            const acknowledged = await deliverCancellation(
                cancellationLease,
                reason,
                confirmedAbsentTargets
            );
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
                    if ((lease?.schemaVersion === 1 || lease?.schemaVersion === RECREATE_RUN_LEASE_VERSION)
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
            const marksSubmissionDispatch = request?.action === 'GPT_RECREATE_NATIVE_CLICK'
                && request?.submissionState === SUBMISSION_STATES.dispatching;
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
                let leaseChanged = false;
                if (!activeRun.operationDocumentId) {
                    activeRun.operationDocumentId = senderDocumentId;
                    leaseChanged = true;
                }
                if (senderTabId === activeRun.chatTabId && activeRun.chatDocumentId !== senderDocumentId) {
                    activeRun.chatDocumentId = senderDocumentId;
                    leaseChanged = true;
                }
                if (senderTabId === activeRun.imagineTabId && activeRun.imagineDocumentId !== senderDocumentId) {
                    activeRun.imagineDocumentId = senderDocumentId;
                    leaseChanged = true;
                }
                if (marksSubmissionDispatch) {
                    if (!isRetrySafeSubmissionState(activeRun.submissionState)) {
                        throw createError('recreate_submission_state_invalid');
                    }
                    activeRun.submissionState = SUBMISSION_STATES.dispatching;
                    leaseChanged = true;
                }
                if (leaseChanged) {
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
                const assertCurrentAuthority = () => {
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
                };
                return {
                    signal: activeRun.abortController.signal,
                    assertAuthorized: assertCurrentAuthority
                };
            });
        }

        async function recordResultBaseline(request, sender = {}) {
            const operation = await authorizeContentOperation(request, sender);
            const hasBaseline = Array.isArray(request?.assetIds) || Array.isArray(request?.signatures);
            const assetIds = Array.isArray(request?.assetIds)
                ? Array.from(new Set(request.assetIds.map((value) => String(value || '').toLowerCase())))
                : [];
            if (assetIds.length > MAX_RESULT_BASELINE_ITEMS || assetIds.some((assetId) => !UUID_RE.test(assetId))) {
                throw createError('recreate_baseline_invalid');
            }
            const signatures = sanitizeResultBaselineSignatures(request?.signatures);
            const mediaKind = request?.mediaKind === 'video' ? 'video' : 'image';
            const requestedSubmissionState = request?.submissionState;
            if (requestedSubmissionState
                && !Object.values(SUBMISSION_STATES).includes(requestedSubmissionState)) {
                throw createError('recreate_submission_state_invalid');
            }

            return await enqueueAuthorityMutation(async () => {
                operation.assertAuthorized();
                if (hasBaseline) {
                    activeRun.resultBaselineAssetIds = assetIds;
                    activeRun.resultBaselineSignatures = signatures;
                    activeRun.resultBaselineMediaKind = mediaKind;
                }
                if (requestedSubmissionState) {
                    if (!canTransitionSubmissionState(activeRun.submissionState, requestedSubmissionState)) {
                        throw createError('recreate_submission_state_invalid');
                    }
                    activeRun.submissionState = requestedSubmissionState;
                }
                const persisted = await persistRunLease(activeRun);
                if (!persisted) throw createError('recreate_authority_persist_failed');
                operation.assertAuthorized();
                return {
                    ok: true,
                    recorded: hasBaseline ? assetIds.length : 0,
                    recordedSignatures: hasBaseline ? signatures.length : 0,
                    mediaKind,
                    submissionState: activeRun.submissionState
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

        async function markProviderAccepted(run) {
            return await enqueueAuthorityMutation(async () => {
                ensureActive(run);
                if (!canTransitionSubmissionState(run.submissionState, SUBMISSION_STATES.providerAccepted)) {
                    if (run.submissionState === SUBMISSION_STATES.providerAccepted
                        || run.submissionState === SUBMISSION_STATES.resultClaimed) return;
                    throw createError('recreate_submission_state_invalid');
                }
                run.submissionState = SUBMISSION_STATES.providerAccepted;
                const persisted = await persistRunLease(run);
                if (!persisted) throw createError('recreate_authority_persist_failed');
                ensureActive(run);
            });
        }

        async function markResultClaimed(run) {
            return await enqueueAuthorityMutation(async () => {
                ensureActive(run);
                if (!canTransitionSubmissionState(run.submissionState, SUBMISSION_STATES.resultClaimed)) {
                    if (run.submissionState === SUBMISSION_STATES.resultClaimed) return;
                    throw createError('recreate_submission_state_invalid');
                }
                run.submissionState = SUBMISSION_STATES.resultClaimed;
                const persisted = await persistRunLease(run);
                if (!persisted) throw createError('recreate_authority_persist_failed');
                ensureActive(run);
            });
        }

        async function sendStatus(run, phase, message, type = 'info', details = {}) {
            if (!run || !run.sourceTabId) return;

            try {
                await tabsSendMessage(run.sourceTabId, {
                    action: 'GPT_RECREATE_STATUS',
                    runId: run.runId,
                    phase,
                    message,
                    type,
                    terminal: details.terminal === true,
                    outcome: String(details.outcome || ''),
                    retrySafe: details.retrySafe === true,
                    referenceKind: details.referenceKind === 'video' ? 'video' : 'image'
                }, 'status_delivery_failed', phase, {
                    documentId: run.sourceDocumentId || '',
                    retryReceiverNotReady: false,
                    timeoutMs: statusMessageTimeoutMs
                });
            } catch {
                // Status delivery is best-effort. Workflow authority owns the outcome.
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
                retrySafe: !!run && isRetrySafeSubmissionState(run.submissionState)
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
            const imagineTab = await tabsCreate({ url: IMAGINE_URL, active: true }, 'imagine_tab_unavailable', 'imagine');
            await waitForTabReady(imagineTab.id, 'imagine_tab_unavailable', 'imagine', run.abortController.signal);
            return imagineTab.id;
        }

        async function recoverChatPromptAfterNavigation(run, referenceKind) {
            ensureActive(run);
            await waitForTabReady(
                run.chatTabId,
                'chat_tab_unavailable',
                'chat',
                run.abortController.signal
            );
            await injectRecreateContentScripts(
                run.chatTabId,
                'chat_tab_unavailable',
                'chat',
                run.abortController.signal
            );
            ensureActive(run);
            return await sendRunOperation(run, run.chatTabId, 'GPT_RECREATE_CHAT_STEP', {
                recoverOnly: true,
                referenceKind
            }, 'chat_tab_unavailable', 'chat_recovery', {
                timeoutMs: chatMessageTimeoutMs
            });
        }

        async function validateOpenedImagineResult(run, referenceKind, generatedPrompt) {
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

        async function recoverFromOpenedImagineResult(run, referenceKind, generatedPrompt, generatedMediaLabel) {
            await waitForImagineResultSurfaceReady(
                run.imagineTabId,
                run.imagineStartUrl,
                'imagine_tab_unavailable',
                'imagine',
                {
                timeoutMs: messageTimeoutMs,
                signal: run.abortController.signal
                }
            );
            await waitForSubmissionDispatch(run, {
                timeoutMs: messageTimeoutMs,
                signal: run.abortController.signal
            });
            await markProviderAccepted(run);
            await sendStatus(run, 'imagine', `Validating Grok result ${generatedMediaLabel}...`, 'info');
            ensureActive(run);
            return await validateOpenedImagineResult(run, referenceKind, generatedPrompt);
        }

        function ignoreFailedResultRecovery(promise) {
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
                chatDocumentId: '',
                imagineTabId: null,
                imagineDocumentId: '',
                phase: 'workflow',
                operationId: '',
                operationTabId: null,
                operationDocumentId: '',
                operationSequence: 0,
                submissionState: SUBMISSION_STATES.notDispatched,
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

                if (typeof context.onStarted === 'function') {
                    context.onStarted({
                        ok: true,
                        started: true,
                        status: 'running',
                        runId: run.runId,
                        epoch: run.epoch,
                        referenceKind
                    });
                }

                await sendStatus(run, 'chat', 'Opening Grok chat tab...', 'info');
                ensureActive(run);
                await setRunPhase(run, 'chat_opening');

                const chatTab = await tabsCreate({ url: CHAT_URL, active: true }, 'chat_tab_unavailable', 'chat');
                run.chatTabId = chatTab.id;
                ensureActive(run);

                await setRunPhase(run, 'chat_loading');
                await waitForTabReady(run.chatTabId, 'chat_tab_unavailable', 'chat', run.abortController.signal);
                ensureActive(run);

                let chatResponse;
                try {
                    chatResponse = await sendRunOperation(run, run.chatTabId, 'GPT_RECREATE_CHAT_STEP', {
                        reference,
                        referenceKind,
                        bestPracticesEnabled: !!request.bestPracticesEnabled
                    }, 'chat_tab_unavailable', 'chat', {
                        timeoutMs: chatMessageTimeoutMs
                    });
                } catch (error) {
                    if (!isMessageChannelClosedError(error)) throw error;
                    chatResponse = await recoverChatPromptAfterNavigation(run, referenceKind);
                }
                ensureActive(run);

                if (!chatResponse || !chatResponse.ok) {
                    const failed = buildResponseFailure(run, 'chat', 'chat_answer_timeout', chatResponse);
                    await appendRecreateLedgerEntry({
                        ...ledgerBase,
                        status: 'failed',
                        phase: failed.phase,
                        error: failed.error
                    });
                    await clearActiveRun(run, 'failed', failed.error);
                    await sendStatus(run, failed.phase, failed.error, 'error', {
                        terminal: true,
                        outcome: 'failed',
                        retrySafe: isRetrySafeSubmissionState(run.submissionState),
                        referenceKind
                    });
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
                    await clearActiveRun(run, 'failed', failed.error);
                    await sendStatus(run, failed.phase, failed.error, 'error', {
                        terminal: true,
                        outcome: 'failed',
                        retrySafe: isRetrySafeSubmissionState(run.submissionState),
                        referenceKind
                    });
                    return failed;
                }

                await sendStatus(run, 'imagine', `Submitting prompt and waiting for generated ${generatedMediaLabel}...`, 'info');
                ensureActive(run);

                await setRunPhase(run, 'imagine_opening');
                run.imagineTabId = await getImagineTabId(run);
                const initialImagineTab = await tabsGet(
                    run.imagineTabId,
                    'imagine_tab_unavailable',
                    'imagine'
                );
                run.imagineStartUrl = String(initialImagineTab?.url || IMAGINE_URL);
                ensureActive(run);

                let imagineResponse;
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
                const openedResultRecovery = recoverFromOpenedImagineResult(
                    run,
                    referenceKind,
                    generatedPrompt,
                    generatedMediaLabel
                );
                const openedResultRecoveryPromise = ignoreFailedResultRecovery(openedResultRecovery);

                try {
                    imagineResponse = await Promise.race([imagineSubmitPromise, openedResultRecoveryPromise]);
                } catch (error) {
                    if (!isMessageChannelClosedError(error)) throw error;
                    imagineResponse = await openedResultRecovery;
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
                    await clearActiveRun(run, 'failed', failed.error);
                    await sendStatus(run, failed.phase, failed.error, 'error', {
                        terminal: true,
                        outcome: 'failed',
                        retrySafe: isRetrySafeSubmissionState(run.submissionState),
                        referenceKind
                    });
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
                    await clearActiveRun(run, 'failed', failed.error);
                    await sendStatus(run, failed.phase, failed.error, 'error', {
                        terminal: true,
                        outcome: 'failed',
                        retrySafe: isRetrySafeSubmissionState(run.submissionState),
                        referenceKind
                    });
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
                    await clearActiveRun(run, 'failed', failed.error);
                    await sendStatus(run, failed.phase, failed.error, 'error', {
                        terminal: true,
                        outcome: 'failed',
                        retrySafe: isRetrySafeSubmissionState(run.submissionState),
                        referenceKind
                    });
                    return failed;
                }

                await markResultClaimed(run);

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
                await clearActiveRun(run, 'completed');
                await sendStatus(run, 'done', `Generated ${generatedMediaLabel} ready.`, 'success', {
                    terminal: true,
                    outcome: 'completed',
                    referenceKind
                });

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
                    await clearActiveRun(run, 'failed', result.error);
                    await sendStatus(run, result.phase, result.error, 'error', {
                        terminal: true,
                        outcome: 'failed',
                        retrySafe: isRetrySafeSubmissionState(run.submissionState),
                        referenceKind: ledgerBase?.referenceKind
                    });
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
                    retrySafe: cleared && isRetrySafeSubmissionState(run.submissionState),
                    retrySafeWhenStopped: isRetrySafeSubmissionState(run.submissionState)
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
                        message: stillStopping
                            ? 'Stopping...'
                            : (reason === 'user' ? 'Cancelled.' : `Recreate stopped: ${reason}`),
                        type: stillStopping || reason === 'user' ? 'neutral' : 'error',
                        terminal: !stillStopping,
                        outcome: stillStopping ? '' : 'cancelled',
                        retrySafe: !stillStopping && isRetrySafeSubmissionState(run.submissionState)
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
                retrySafe: !stillStopping && isRetrySafeSubmissionState(run.submissionState),
                retrySafeWhenStopped: isRetrySafeSubmissionState(run.submissionState)
            };
        }

        async function getRunStatus(options = {}) {
            if (!initialized) await initialize();
            if (activeRun?.recoveryPending) {
                const confirmedAbsentTargets = new Set();
                if (Number.isInteger(options.viewerTabId)
                    && options.viewerTabId === activeRun.sourceTabId
                    && options.viewerDocumentId
                    && options.viewerDocumentId !== activeRun.sourceDocumentId) {
                    confirmedAbsentTargets.add(`${activeRun.sourceTabId}:${activeRun.sourceDocumentId}`);
                }
                await finalizePersistedCancellation(
                    activeRun,
                    activeRun.abortReason || 'worker_restarted',
                    confirmedAbsentTargets
                );
            }
            return getActiveRunStatus(options);
        }

        async function handleOwnedTabRemoved(tabId) {
            if (!initialized) await initialize();
            if (!activeRun || activeRun.aborted || activeRun.recoveryPending) return false;
            const reason = tabId === activeRun.chatTabId
                ? 'chat_work_tab_closed'
                : (tabId === activeRun.imagineTabId ? 'imagine_work_tab_closed' : '');
            if (!reason) return false;
            await abort(reason);
            return true;
        }

        async function handleOwnedTabUpdated(tabId, url) {
            if (!url) return false;
            if (!initialized) await initialize();
            if (!activeRun || activeRun.aborted || activeRun.recoveryPending) return false;
            let allowed = true;
            let reason = '';
            try {
                const parsed = new URL(String(url));
                if (tabId === activeRun.chatTabId) {
                    allowed = parsed.protocol === 'https:' && parsed.hostname === 'grok.com';
                    reason = 'chat_work_tab_left_grok';
                } else if (tabId === activeRun.imagineTabId) {
                    allowed = isGrokImagineResultUrl(parsed.toString());
                    reason = 'imagine_work_tab_left_grok';
                } else {
                    return false;
                }
            } catch {
                allowed = false;
                reason = tabId === activeRun.chatTabId
                    ? 'chat_work_tab_left_grok'
                    : 'imagine_work_tab_left_grok';
            }
            if (allowed) return false;
            await abort(reason);
            return true;
        }

        function getActiveRunForTest() {
            return activeRun ? { ...activeRun } : null;
        }

        function getActiveRunStatus(options = {}) {
            if (!activeRun) return null;
            const status = {
                kind: 'recreate',
                status: activeRun.aborted ? 'stopping' : 'running',
                runId: activeRun.runId,
                epoch: activeRun.epoch,
                phase: activeRun.phase || 'workflow'
            };
            if (options.includeOwner === true && Number.isInteger(activeRun.sourceTabId)) {
                status.ownerTabId = activeRun.sourceTabId;
                status.ownerDocumentId = String(activeRun.sourceDocumentId || '');
            }
            return status;
        }

        return {
            abort,
            authorizeContentOperation,
            getActiveRunStatus,
            getRunStatus,
            getActiveRunForTest,
            handleOwnedTabRemoved,
            handleOwnedTabUpdated,
            initialize,
            recordResultBaseline,
            start
        };
    }

    return { createRecreateWorkflowController };
});
