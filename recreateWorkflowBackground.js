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

    function wait(ms) {
        return new Promise((resolve) => {
            setTimeout(resolve, ms);
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
        let activeRun = null;

        function createRunId() {
            if (random === Math.random) return workflowUtils.createRecreateRunId(now());

            const suffix = String(random().toString(16).replace(/^0\./, '') || '0').slice(0, 8);
            return `recreate_${now()}_${suffix}`;
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

        async function waitForTabReady(tabId, errorCode, phase) {
            const startedAt = now();

            while (now() - startedAt <= tabReadyTimeoutMs) {
                const tab = await tabsGet(tabId, errorCode, phase);
                if (tab && tab.status === 'complete') return tab;
                await wait(tabReadyPollMs);
            }

            throw createPhaseError(errorCode, phase, {
                reason: 'tab_load_timeout',
                timeoutMs: tabReadyTimeoutMs
            });
        }

        async function waitForImaginePostReady(tabId, errorCode, phase, options = {}) {
            const startedAt = now();
            const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : tabReadyTimeoutMs;

            while (now() - startedAt <= timeoutMs) {
                const tab = await tabsGet(tabId, errorCode, phase);
                if (tab && tab.status === 'complete' && isGrokImaginePostUrl(tab.url)) return tab;
                await wait(tabReadyPollMs);
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

        async function injectRecreateContentScripts(tabId, errorCode, phase) {
            await waitForTabReady(tabId, errorCode, phase);
            await insertCss(tabId, RECREATE_CONTENT_CSS_FILES, errorCode, phase);
            await executeScript(tabId, RECREATE_CONTENT_SCRIPT_FILES, errorCode, phase);
        }

        function tabsSendMessageOnce(tabId, message, errorCode, phase, timeoutMs) {
            return new Promise((resolve, reject) => {
                let settled = false;
                const timer = setTimeout(() => {
                    if (settled) return;
                    settled = true;
                    reject(
                        createPhaseError(errorCode, phase, {
                            reason: 'message_timeout',
                            action: message.action,
                            timeoutMs
                        })
                    );
                }, timeoutMs);

                try {
                    chromeApi.tabs.sendMessage(tabId, message, (response) => {
                        if (settled) return;
                        settled = true;
                        clearTimeout(timer);

                        if (chromeApi.runtime && chromeApi.runtime.lastError) {
                            reject(
                                createPhaseError(errorCode, phase, {
                                    chromeLastError: chromeApi.runtime.lastError.message,
                                    action: message.action
                                })
                            );
                            return;
                        }
                        resolve(response);
                    });
                } catch (error) {
                    if (settled) return;
                    settled = true;
                    clearTimeout(timer);
                    reject(
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
            let lastError = null;
            let injected = false;

            for (let attempt = 1; attempt <= maxAttempts; attempt++) {
                try {
                    return await tabsSendMessageOnce(tabId, message, errorCode, phase, timeoutMs);
                } catch (error) {
                    lastError = error;
                    if (!retryReceiverNotReady || !isReceiverNotReadyError(error) || attempt >= maxAttempts) {
                        throw error;
                    }
                    if (!injected) {
                        await injectRecreateContentScripts(tabId, errorCode, phase);
                        injected = true;
                    }
                    await wait(receiverRetryDelayMs);
                }
            }

            throw lastError;
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
                    retryReceiverNotReady: false,
                    timeoutMs: statusMessageTimeoutMs
                });
            } catch (error) {
                console.warn('Recreate status delivery failed:', error.message);
            }
        }

        function buildFailure(run, phase, error, diagnostics = {}) {
            return workflowUtils.buildRecreateFailure({
                runId: run && run.runId,
                phase: error && error.phase ? error.phase : phase,
                error: normalizeErrorCode(error),
                diagnostics: {
                    ...(error && error.diagnostics ? error.diagnostics : {}),
                    ...diagnostics
                }
            });
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

        function ensureActive(run) {
            if (!activeRun || activeRun.runId !== run.runId || activeRun.aborted) {
                throw createError('workflow_aborted');
            }
        }

        function clearActiveRun(run) {
            if (activeRun && run && activeRun.runId === run.runId) {
                activeRun = null;
            }
        }

        async function getImagineTabId(run) {
            if (isGrokImagineUrl(run.sourceTabUrl)) {
                await tabsUpdate(run.sourceTabId, { active: true }, 'imagine_tab_unavailable', 'imagine');
                await waitForTabReady(run.sourceTabId, 'imagine_tab_unavailable', 'imagine');
                return run.sourceTabId;
            }

            const imagineTab = await tabsCreate({ url: IMAGINE_URL, active: true }, 'imagine_tab_unavailable', 'imagine');
            await waitForTabReady(imagineTab.id, 'imagine_tab_unavailable', 'imagine');
            return imagineTab.id;
        }

        async function validateOpenedImaginePost(run, referenceKind, generatedPrompt) {
            await waitForImaginePostReady(run.imagineTabId, 'imagine_tab_unavailable', 'imagine');
            await injectRecreateContentScripts(run.imagineTabId, 'imagine_tab_unavailable', 'imagine');
            return await tabsSendMessage(run.imagineTabId, {
                action: 'GPT_RECREATE_IMAGINE_POST_VALIDATION_STEP',
                runId: run.runId,
                generatedPrompt,
                targetMode: referenceKind,
                referenceKind,
                mediaKind: referenceKind
            }, 'imagine_tab_unavailable', 'imagine', {
                timeoutMs: messageTimeoutMs
            });
        }

        async function recoverFromOpenedImaginePost(run, referenceKind, generatedPrompt, generatedMediaLabel) {
            await waitForImaginePostReady(run.imagineTabId, 'imagine_tab_unavailable', 'imagine', {
                timeoutMs: messageTimeoutMs
            });
            await sendStatus(run, 'imagine', `Validating opened Grok post ${generatedMediaLabel}...`, 'info');
            ensureActive(run);
            return await validateOpenedImaginePost(run, referenceKind, generatedPrompt);
        }

        function ignoreFailedPostRecovery(promise) {
            return promise.catch(() => new Promise(() => {}));
        }

        async function start(request = {}, context = {}) {
            if (activeRun) {
                return buildFailure(activeRun, 'workflow', 'workflow_active');
            }

            const run = {
                runId: createRunId(),
                sourceTabId: context.sourceTabId,
                sourceTabUrl: context.sourceTabUrl,
                aborted: false,
                chatTabId: null,
                imagineTabId: null
            };
            activeRun = run;

            let ledgerBase = null;

            try {
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

                const chatTab = await tabsCreate({ url: CHAT_URL, active: true }, 'chat_tab_unavailable', 'chat');
                run.chatTabId = chatTab.id;
                ensureActive(run);

                await waitForTabReady(run.chatTabId, 'chat_tab_unavailable', 'chat');
                ensureActive(run);

                const chatResponse = await tabsSendMessage(run.chatTabId, {
                    action: 'GPT_RECREATE_CHAT_STEP',
                    runId: run.runId,
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
                    clearActiveRun(run);
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
                    clearActiveRun(run);
                    return failed;
                }

                await sendStatus(run, 'imagine', `Submitting prompt and waiting for generated ${generatedMediaLabel}...`, 'info');
                ensureActive(run);

                run.imagineTabId = await getImagineTabId(run);
                ensureActive(run);

                let imagineResponse;
                const imagineMessage = {
                    action: 'GPT_RECREATE_IMAGINE_STEP',
                    runId: run.runId,
                    generatedPrompt,
                    targetMode: referenceKind,
                    referenceKind,
                    autoSubmit: true
                };
                const imagineSubmitPromise = tabsSendMessage(
                    run.imagineTabId,
                    imagineMessage,
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
                    clearActiveRun(run);
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
                    clearActiveRun(run);
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
                    clearActiveRun(run);
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
                clearActiveRun(run);

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
                const result = buildFailure(run, 'workflow', error, {
                    sourceTabUrl: run.sourceTabUrl,
                    chatTabId: run.chatTabId,
                    imagineTabId: run.imagineTabId
                });
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
                clearActiveRun(run);
                return result;
            }
        }

        function abort(reason = 'user') {
            if (!activeRun) {
                return { ok: true, aborted: false, reason: 'no_active_run' };
            }

            activeRun.aborted = true;
            activeRun.abortReason = reason;

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
            getActiveRunStatus,
            getActiveRunForTest,
            start
        };
    }

    return { createRecreateWorkflowController };
});
