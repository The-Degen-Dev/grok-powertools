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
                (url.pathname === '/imagine' || url.pathname.startsWith('/imagine/'))
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

            for (let attempt = 1; attempt <= maxAttempts; attempt++) {
                try {
                    return await tabsSendMessageOnce(tabId, message, errorCode, phase, timeoutMs);
                } catch (error) {
                    lastError = error;
                    if (!retryReceiverNotReady || !isReceiverNotReadyError(error) || attempt >= maxAttempts) {
                        throw error;
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
                return run.sourceTabId;
            }

            const imagineTab = await tabsCreate({ url: IMAGINE_URL, active: true }, 'imagine_tab_unavailable', 'imagine');
            return imagineTab.id;
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

            try {
                const reference = workflowUtils.normalizeRecreateReference(request.reference);

                await sendStatus(run, 'chat', 'Opening Grok chat tab...', 'info');
                ensureActive(run);

                const chatTab = await tabsCreate({ url: CHAT_URL, active: false }, 'chat_tab_unavailable', 'chat');
                run.chatTabId = chatTab.id;
                ensureActive(run);

                const chatResponse = await tabsSendMessage(run.chatTabId, {
                    action: 'GPT_RECREATE_CHAT_STEP',
                    runId: run.runId,
                    reference,
                    bestPracticesEnabled: !!request.bestPracticesEnabled
                }, 'chat_tab_unavailable', 'chat');
                ensureActive(run);

                if (!chatResponse || !chatResponse.ok) {
                    const failed = buildResponseFailure(run, 'chat', 'chat_answer_timeout', chatResponse);
                    await sendStatus(run, failed.phase, failed.error, 'error');
                    clearActiveRun(run);
                    return failed;
                }

                const generatedPrompt =
                    typeof chatResponse.generatedPrompt === 'string' ? chatResponse.generatedPrompt.trim() : '';
                if (!generatedPrompt) {
                    const failed = buildFailure(run, 'chat', 'chat_prompt_marker_missing');
                    await sendStatus(run, failed.phase, failed.error, 'error');
                    clearActiveRun(run);
                    return failed;
                }

                await sendStatus(run, 'imagine', 'Submitting prompt in Grok Imagine...', 'info');
                ensureActive(run);

                run.imagineTabId = await getImagineTabId(run);
                ensureActive(run);

                const imagineResponse = await tabsSendMessage(run.imagineTabId, {
                    action: 'GPT_RECREATE_IMAGINE_STEP',
                    runId: run.runId,
                    generatedPrompt,
                    autoSubmit: true
                }, 'imagine_tab_unavailable', 'imagine');
                ensureActive(run);

                if (!imagineResponse || !imagineResponse.ok) {
                    const failed = buildResponseFailure(run, 'imagine', 'imagine_submit_failed', imagineResponse);
                    await sendStatus(run, failed.phase, failed.error, 'error');
                    clearActiveRun(run);
                    return failed;
                }

                if (imagineResponse.submitted !== true) {
                    const failed = buildFailure(run, 'imagine', 'imagine_submit_failed', imagineResponse.diagnostics || {});
                    await sendStatus(run, failed.phase, failed.error, 'error');
                    clearActiveRun(run);
                    return failed;
                }

                await sendStatus(run, 'done', 'Submitted to Grok Imagine.', 'success');
                clearActiveRun(run);

                return {
                    ok: true,
                    runId: run.runId,
                    generatedPrompt,
                    submitted: true
                };
            } catch (error) {
                const result = buildFailure(run, 'workflow', error, {
                    sourceTabUrl: run.sourceTabUrl,
                    chatTabId: run.chatTabId,
                    imagineTabId: run.imagineTabId
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

        return {
            abort,
            getActiveRunForTest,
            start
        };
    }

    return { createRecreateWorkflowController };
});
