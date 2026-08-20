(function (root, factory) {
    const stateApi = typeof module !== 'undefined' && module.exports
        ? require('./generationRunState.js')
        : root?.GrokPowerToolsGenerationRunState;
    const api = factory(stateApi);

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }

    if (root) {
        root.GrokPowerToolsGenerationRunController = api;
    }
})(typeof self !== 'undefined' ? self : typeof globalThis !== 'undefined' ? globalThis : this, function (State) {
    const GENERATION_RUN_SESSION_KEY = 'generationRunLease';
    const GENERATION_RUN_JOURNAL_KEY = 'generationRunJournal';
    const TERMINAL_STATUSES = new Set(['completed', 'cancelled', 'failed']);
    const GALLERY_SURFACES = new Set(['results_gallery', 'saved_gallery']);
    const DETAIL_SURFACES = new Set(['agent_media', 'legacy_detail']);

    function controllerError(code) {
        const error = new Error(code);
        error.code = code;
        return error;
    }

    function clone(value) {
        return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
    }

    function getErrorCode(error) {
        return String(error?.code || error?.message || 'GENERATION_CONTROLLER_ERROR');
    }

    function getSenderTabId(sender) {
        return Number.isInteger(sender?.tab?.id) ? sender.tab.id : null;
    }

    function getSenderDocumentId(sender, tabId) {
        const documentId = String(sender?.documentId || '').trim();
        return documentId || (Number.isInteger(tabId) ? `tab-${tabId}` : '');
    }

    function parseGrokUrl(value) {
        try {
            const url = new URL(String(value || ''));
            const hostname = url.hostname.toLowerCase();
            if (url.protocol !== 'https:'
                || (hostname !== 'grok.com'
                    && !hostname.endsWith('.grok.com')
                    && hostname !== 'grok.x.ai'
                    && !hostname.endsWith('.grok.x.ai'))) {
                return null;
            }
            return url;
        } catch {
            return null;
        }
    }

    function getActiveClaimItem(run) {
        return run?.activeClaim
            ? run.items.find((item) => item.itemId === run.activeClaim.itemId) || null
            : null;
    }

    function assertResumeProof(run, request, sender) {
        if (request?.resume !== true || !request?.resumeProof) {
            throw controllerError('GENERATION_RESUME_PROOF_REQUIRED');
        }
        const proof = request.resumeProof;
        const senderUrl = parseGrokUrl(sender?.tab?.url);
        const proofUrl = parseGrokUrl(proof.url);
        if (!senderUrl
            || !proofUrl
            || senderUrl.origin !== proofUrl.origin
            || senderUrl.pathname !== proofUrl.pathname
            || senderUrl.search !== proofUrl.search) {
            throw controllerError('GENERATION_RESUME_PROOF_INVALID');
        }

        if (GALLERY_SURFACES.has(proof.surface)) {
            const originUrl = parseGrokUrl(run.origin?.url);
            if (proof.surface !== run.origin?.surface
                || !originUrl
                || proofUrl.pathname !== originUrl.pathname
                || proofUrl.searchParams.get('conversation') !== originUrl.searchParams.get('conversation')) {
                throw controllerError('GENERATION_RESUME_PROOF_INVALID');
            }
            return;
        }

        const activeItem = getActiveClaimItem(run);
        const descriptor = activeItem?.descriptor;
        if (!activeItem
            || !DETAIL_SURFACES.has(proof.surface)
            || proof.sourceAssetId !== descriptor.sourceAssetId
            || proof.sourcePostId !== descriptor.sourcePostId) {
            throw controllerError('GENERATION_RESUME_PROOF_INVALID');
        }
        if (proof.surface === 'agent_media' && !proofUrl.pathname.startsWith('/imagine/agent/')) {
            throw controllerError('GENERATION_RESUME_PROOF_INVALID');
        }
        if (proof.surface === 'legacy_detail'
            && proofUrl.pathname !== `/imagine/post/${descriptor.sourcePostId}`) {
            throw controllerError('GENERATION_RESUME_PROOF_INVALID');
        }
    }

    function isActiveRun(run) {
        return Boolean(run && !TERMINAL_STATUSES.has(run.status));
    }

    function withTimeout(promise, timeoutMs) {
        let timeoutId;
        const timeout = new Promise((resolve) => {
            timeoutId = setTimeout(() => resolve({ acknowledged: false }), timeoutMs);
        });
        return Promise.race([Promise.resolve(promise), timeout]).finally(() => {
            if (timeoutId) clearTimeout(timeoutId);
        });
    }

    function createClaimFromState(run) {
        const active = run?.activeClaim;
        const item = active && run.items.find((candidate) => candidate.itemId === active.itemId);
        if (!active || !item) return null;
        return {
            runId: run.runId,
            epoch: active.epoch,
            claimId: active.claimId,
            itemId: item.itemId,
            kind: run.kind,
            descriptor: clone(item.descriptor),
            prompt: run.prompt,
            options: clone(run.options),
            ownerDocumentId: active.ownerDocumentId || run.ownerDocumentId || '',
            claimedAt: active.claimedAt,
            expiresAt: active.expiresAt
        };
    }

    function createGenerationRunController(options = {}) {
        if (!State
            || typeof State.createGenerationRun !== 'function'
            || typeof State.getNextGenerationClaim !== 'function'
            || typeof State.reduceGenerationRun !== 'function'
            || typeof State.sanitizeGenerationRun !== 'function') {
            throw controllerError('GENERATION_STATE_UNAVAILABLE');
        }

        const sessionStorage = options.sessionStorage;
        const localStorage = options.localStorage;
        const now = typeof options.now === 'function' ? options.now : Date.now;
        const getBlockingWorkflow = typeof options.getBlockingWorkflow === 'function'
            ? options.getBlockingWorkflow
            : async () => null;
        const notifyCancellation = typeof options.notifyCancellation === 'function'
            ? options.notifyCancellation
            : async () => ({ acknowledged: false });
        const cancellationAckTimeoutMs = Number.isFinite(options.cancellationAckTimeoutMs)
            ? Math.max(1, options.cancellationAckTimeoutMs)
            : 3000;
        if (!sessionStorage?.get || !sessionStorage?.set || !localStorage?.set) {
            throw controllerError('GENERATION_STORAGE_UNAVAILABLE');
        }

        let currentRun = null;
        let initialized = false;
        let initializationPromise = null;
        let mutationQueue = Promise.resolve();

        async function initialize() {
            if (initialized) return currentRun;
            if (!initializationPromise) {
                initializationPromise = (async () => {
                    const stored = await sessionStorage.get([GENERATION_RUN_SESSION_KEY]);
                    const candidate = stored?.[GENERATION_RUN_SESSION_KEY];
                    if (candidate && candidate.schemaVersion === 1 && candidate.runId) {
                        try {
                            if (typeof State.validateGenerationRun === 'function') {
                                State.validateGenerationRun(candidate);
                            } else {
                                State.sanitizeGenerationRun(candidate);
                            }
                            currentRun = clone(candidate);
                        } catch {
                            await sessionStorage.remove?.([GENERATION_RUN_SESSION_KEY]);
                            currentRun = null;
                        }
                    } else {
                        currentRun = null;
                    }
                    initialized = true;
                    return currentRun;
                })().catch((error) => {
                    initializationPromise = null;
                    throw error;
                });
            }
            return initializationPromise;
        }

        function enqueue(operation) {
            const execute = async () => {
                await initialize();
                return operation();
            };
            const result = mutationQueue.then(execute, execute);
            mutationQueue = result.catch(() => {});
            return result;
        }

        async function persist(run) {
            const storedRun = clone(run);
            const journal = State.sanitizeGenerationRun(storedRun);
            await sessionStorage.set({ [GENERATION_RUN_SESSION_KEY]: storedRun });
            currentRun = storedRun;
            try {
                await localStorage.set({ [GENERATION_RUN_JOURNAL_KEY]: journal });
            } catch {
                // Session storage owns workflow authority. A diagnostic journal
                // failure must never roll back a persisted transition.
            }
            return currentRun;
        }

        function publicRun(run = currentRun) {
            return run ? State.sanitizeGenerationRun(run) : null;
        }

        function assertRunIdentity(request) {
            if (!currentRun
                || request?.runId !== currentRun.runId
                || request?.epoch !== currentRun.epoch) {
                throw controllerError('STALE_GENERATION_EVENT');
            }
        }

        function assertOwner(sender, options = {}) {
            const tabId = getSenderTabId(sender);
            if (!currentRun || tabId !== currentRun.ownerTabId) {
                throw controllerError('GENERATION_OWNER_MISMATCH');
            }
            if (options.requireDocument) {
                const documentId = getSenderDocumentId(sender, tabId);
                if (!documentId || documentId !== currentRun.ownerDocumentId) {
                    throw controllerError(options.documentError || 'GENERATION_OWNER_MISMATCH');
                }
            }
            return {
                tabId,
                documentId: getSenderDocumentId(sender, tabId)
            };
        }

        function rejected(error) {
            return { status: 'rejected', error: getErrorCode(error) };
        }

        async function startGenerationRun(request, sender) {
            return enqueue(async () => {
                const ownerTabId = getSenderTabId(sender);
                const ownerDocumentId = getSenderDocumentId(sender, ownerTabId);
                if (!Number.isInteger(ownerTabId) || !ownerDocumentId) {
                    return rejected(controllerError('GENERATION_OWNER_MISSING'));
                }

                if (isActiveRun(currentRun)) {
                    return {
                        status: 'conflict',
                        activeWorkflow: {
                            kind: currentRun.kind,
                            status: currentRun.status,
                            runId: currentRun.runId
                        }
                    };
                }

                const blocking = await getBlockingWorkflow();
                if (blocking && !TERMINAL_STATUSES.has(blocking.status)) {
                    return { status: 'conflict', activeWorkflow: clone(blocking) };
                }

                try {
                    const run = State.createGenerationRun({
                        kind: request?.kind,
                        ownerTabId,
                        ownerDocumentId,
                        origin: request?.origin,
                        items: request?.items,
                        prompt: request?.prompt,
                        options: request?.options,
                        now: now()
                    });
                    await persist(run);
                    return { status: 'started', run: publicRun(run) };
                } catch (error) {
                    return rejected(error);
                }
            });
        }

        async function claimGenerationAction(request, sender) {
            return enqueue(async () => {
                try {
                    const { documentId } = assertOwner(sender);
                    assertRunIdentity(request);
                    if (TERMINAL_STATUSES.has(currentRun.status)) {
                        return { status: 'waiting', claim: null, run: publicRun() };
                    }

                    const claimNow = now();
                    const ownerChanged = documentId !== currentRun.ownerDocumentId;
                    if (ownerChanged) assertResumeProof(currentRun, request, sender);

                    if (currentRun.activeClaim) {
                        if (claimNow >= currentRun.activeClaim.expiresAt) {
                            currentRun = State.reduceGenerationRun(currentRun, {
                                type: 'expire_claim',
                                runId: currentRun.runId,
                                epoch: currentRun.epoch,
                                now: claimNow
                            });
                            await persist(currentRun);
                        } else if (ownerChanged) {
                            const resumed = State.reduceGenerationRun(currentRun, {
                                type: 'reclaim',
                                runId: currentRun.runId,
                                epoch: currentRun.epoch,
                                itemId: currentRun.activeClaim.itemId,
                                claimId: currentRun.activeClaim.claimId,
                                ownerDocumentId: documentId,
                                now: claimNow
                            });
                            await persist(resumed);
                            return {
                                status: 'resumed',
                                claim: createClaimFromState(resumed),
                                run: publicRun(resumed)
                            };
                        } else {
                            return { status: 'waiting', claim: null, run: publicRun() };
                        }
                    }

                    if (ownerChanged) {
                        currentRun = State.reduceGenerationRun(currentRun, {
                            type: 'transfer_owner',
                            runId: currentRun.runId,
                            epoch: currentRun.epoch,
                            ownerDocumentId: documentId,
                            now: claimNow
                        });
                        await persist(currentRun);
                    }

                    if (currentRun.status === 'waiting_capacity') {
                        if (claimNow >= currentRun.capacityDeadlineAt) {
                            currentRun = State.reduceGenerationRun(currentRun, {
                                type: 'capacity_timeout',
                                runId: currentRun.runId,
                                epoch: currentRun.epoch,
                                now: claimNow
                            });
                            await persist(currentRun);
                        } else if (!request?.capacityAvailable) {
                            return { status: 'waiting', claim: null, run: publicRun() };
                        } else {
                            currentRun = State.reduceGenerationRun(currentRun, {
                                type: 'capacity_available',
                                runId: currentRun.runId,
                                epoch: currentRun.epoch,
                                now: claimNow
                            });
                            await persist(currentRun);
                        }
                    }

                    if (documentId !== currentRun.ownerDocumentId) {
                        return rejected(controllerError('GENERATION_OWNER_MISMATCH'));
                    }
                    const next = State.getNextGenerationClaim(currentRun, claimNow);
                    if (!next.claim) {
                        return { status: 'waiting', claim: null, run: publicRun() };
                    }
                    await persist(next.state);
                    return { status: 'claimed', claim: clone(next.claim), run: publicRun(next.state) };
                } catch (error) {
                    return rejected(error);
                }
            });
        }

        async function reportGenerationAction(request, sender) {
            return enqueue(async () => {
                try {
                    assertOwner(sender, {
                        requireDocument: true,
                        documentError: 'STALE_GENERATION_CLAIM'
                    });
                    const run = State.reduceGenerationRun(currentRun, {
                        type: 'report',
                        runId: request?.runId,
                        epoch: request?.epoch,
                        itemId: request?.itemId,
                        claimId: request?.claimId,
                        outcome: request?.outcome,
                        failureCode: String(request?.failureCode || ''),
                        receipt: request?.receipt ?? null,
                        now: now()
                    });
                    if (run === currentRun) {
                        return { status: 'updated', run: publicRun(run) };
                    }
                    await persist(run);
                    return { status: 'updated', run: publicRun(run) };
                } catch (error) {
                    return rejected(error);
                }
            });
        }

        async function retryFailedGenerationItems(request, sender) {
            return enqueue(async () => {
                try {
                    assertOwner(sender);
                    const run = State.reduceGenerationRun(currentRun, {
                        type: 'retry_failed',
                        runId: request?.runId,
                        epoch: request?.epoch,
                        now: now()
                    });
                    await persist(run);
                    return { status: 'updated', run: publicRun(run) };
                } catch (error) {
                    return rejected(error);
                }
            });
        }

        async function cancelGenerationRun(request, sender) {
            return enqueue(async () => {
                try {
                    assertOwner(sender);
                    const run = State.reduceGenerationRun(currentRun, {
                        type: 'cancel',
                        runId: request?.runId,
                        epoch: request?.epoch,
                        now: now()
                    });
                    await persist(run);
                    let acknowledged = false;
                    try {
                        const response = await withTimeout(notifyCancellation({
                            runId: run.runId,
                            epoch: run.epoch,
                            ownerTabId: run.ownerTabId,
                            ownerDocumentId: run.ownerDocumentId
                        }), cancellationAckTimeoutMs);
                        acknowledged = Boolean(response?.acknowledged);
                    } catch {
                        acknowledged = false;
                    }
                    return {
                        status: 'cancelled',
                        acknowledged,
                        run: publicRun(run)
                    };
                } catch (error) {
                    return rejected(error);
                }
            });
        }

        async function getGenerationRunStatus() {
            await initialize();
            if (!currentRun) return { status: 'idle', run: null };
            return {
                status: isActiveRun(currentRun) ? 'active' : currentRun.status,
                run: publicRun()
            };
        }

        async function cancelGenerationRunForOwnerTab(tabId) {
            return enqueue(async () => {
                if (!Number.isInteger(tabId)
                    || !isActiveRun(currentRun)
                    || currentRun.ownerTabId !== tabId) {
                    return { status: 'ignored', run: publicRun() };
                }
                const run = State.reduceGenerationRun(currentRun, {
                    type: 'cancel',
                    runId: currentRun.runId,
                    epoch: currentRun.epoch,
                    now: now()
                });
                await persist(run);
                return { status: 'cancelled', run: publicRun(run) };
            });
        }

        return {
            initialize,
            startGenerationRun,
            claimGenerationAction,
            reportGenerationAction,
            retryFailedGenerationItems,
            cancelGenerationRun,
            cancelGenerationRunForOwnerTab,
            getGenerationRunStatus
        };
    }

    return {
        GENERATION_RUN_JOURNAL_KEY,
        GENERATION_RUN_SESSION_KEY,
        createGenerationRunController
    };
});
