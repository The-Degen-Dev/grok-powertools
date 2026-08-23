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
    const GENERATION_RUN_RECOVERY_KEY = 'generationRunRecovery';
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

    function getImaginePostId(url) {
        const match = String(url?.pathname || '').match(
            /^\/imagine\/post\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/|$)/i
        );
        return String(match?.[1] || '').toLowerCase();
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
            || senderUrl.pathname !== proofUrl.pathname) {
            throw controllerError('GENERATION_RESUME_PROOF_INVALID');
        }
        const senderConversationId = senderUrl.searchParams.get('conversation') || '';
        const proofConversationId = proofUrl.searchParams.get('conversation') || '';
        if (proofConversationId && senderConversationId !== proofConversationId) {
            throw controllerError('GENERATION_RESUME_PROOF_INVALID');
        }

        const submittedGoalItem = run.kind === 'video_goal'
            ? getActiveClaimItem(run)
            : null;
        const submittedConversationId = String(submittedGoalItem?.descriptor?.conversationId || '');
        if (proof.videoGoalSubmitted === true
            && submittedGoalItem?.status === 'submitted'
            && submittedConversationId
            && proof.conversationId === submittedConversationId
            && proofUrl.searchParams.get('conversation') === submittedConversationId
            && ((proof.surface === 'agent_media' && proofUrl.pathname.startsWith('/imagine/agent/'))
                || (proof.surface === 'legacy_detail' && proofUrl.pathname.startsWith('/imagine/post/')))) {
            return;
        }

        const submittedItem = getActiveClaimItem(run);
        const childPostId = getImaginePostId(proofUrl);
        if (proof.submissionChild === true
            && submittedItem?.status === 'submitted'
            && proof.surface === 'legacy_detail'
            && childPostId
            && childPostId !== String(submittedItem.descriptor.sourcePostId || '').toLowerCase()
            && childPostId !== String(submittedItem.descriptor.sourceAssetId || '').toLowerCase()
            && proof.sourceAssetId === submittedItem.descriptor.sourceAssetId
            && proof.sourcePostId === submittedItem.descriptor.sourcePostId) {
            return;
        }

        if (GALLERY_SURFACES.has(proof.surface)) {
            const originUrl = parseGrokUrl(run.origin?.url);
            const originConversationId = originUrl?.searchParams.get('conversation') || '';
            const descriptor = getActiveClaimItem(run)?.descriptor
                || run.items.find((item) => item.status === 'queued')?.descriptor
                || run.items[0]?.descriptor;
            if (proof.surface !== run.origin?.surface
                || !originUrl
                || proofUrl.pathname !== originUrl.pathname
                || (originConversationId && proofConversationId !== originConversationId)
                || !descriptor
                || proof.sourceAssetId !== descriptor.sourceAssetId
                || proof.sourcePostId !== descriptor.sourcePostId) {
                throw controllerError('GENERATION_RESUME_PROOF_INVALID');
            }
            return;
        }

        const activeItem = getActiveClaimItem(run);
        const capacityItem = run.status === 'waiting_capacity'
            ? run.items.find((item) => (
                item.status === 'queued' && item.failureCode === 'provider_capacity'
            ))
            : null;
        const directDetailItem = DETAIL_SURFACES.has(run.origin?.surface)
            ? run.items.find((item) => item.status === 'queued') || run.items[0]
            : null;
        const descriptor = activeItem?.descriptor
            || capacityItem?.descriptor
            || directDetailItem?.descriptor;
        if (!descriptor
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
        if (!sessionStorage?.get || !sessionStorage?.set || !localStorage?.get || !localStorage?.set) {
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
                    const [stored, local] = await Promise.all([
                        sessionStorage.get([GENERATION_RUN_SESSION_KEY]),
                        localStorage.get([GENERATION_RUN_RECOVERY_KEY])
                    ]);
                    const sessionCandidate = stored?.[GENERATION_RUN_SESSION_KEY];
                    const recoveryCandidate = local?.[GENERATION_RUN_RECOVERY_KEY];
                    const candidate = sessionCandidate?.schemaVersion === 1 && sessionCandidate.runId
                        ? sessionCandidate
                        : recoveryCandidate;
                    if (candidate && candidate.schemaVersion === 1 && candidate.runId) {
                        try {
                            if (typeof State.validateGenerationRun === 'function') {
                                State.validateGenerationRun(candidate);
                            } else {
                                State.sanitizeGenerationRun(candidate);
                            }
                            currentRun = clone(candidate);
                            if (candidate === recoveryCandidate) {
                                await sessionStorage.set({ [GENERATION_RUN_SESSION_KEY]: currentRun });
                            }
                        } catch {
                            await sessionStorage.remove?.([GENERATION_RUN_SESSION_KEY]);
                            await localStorage.set({ [GENERATION_RUN_RECOVERY_KEY]: null });
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
                await localStorage.set({
                    [GENERATION_RUN_JOURNAL_KEY]: journal,
                    [GENERATION_RUN_RECOVERY_KEY]: isActiveRun(storedRun) ? storedRun : null
                });
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
                            return {
                                status: 'capacity_timeout',
                                claim: null,
                                run: publicRun(currentRun)
                            };
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

        async function dispatchGenerationAction(request, sender, dispatch) {
            return enqueue(async () => {
                try {
                    assertOwner(sender, {
                        requireDocument: true,
                        documentError: 'STALE_GENERATION_CLAIM'
                    });
                    if (typeof dispatch !== 'function') {
                        throw controllerError('GENERATION_DISPATCH_UNAVAILABLE');
                    }
                    const assertAuthorized = async () => {
                        const activeClaim = currentRun?.activeClaim;
                        const item = currentRun?.items?.find((candidate) => (
                            candidate.itemId === request?.itemId
                        ));
                        if (!activeClaim
                            || currentRun.runId !== request?.runId
                            || currentRun.epoch !== request?.epoch
                            || activeClaim.claimId !== request?.claimId
                            || activeClaim.itemId !== request?.itemId
                            || (item?.status !== 'targeting' && item?.status !== 'composer_ready')) {
                            throw controllerError('STALE_GENERATION_CLAIM');
                        }
                    };
                    await assertAuthorized();
                    let dispatchResult;
                    let dispatchUncertain = false;
                    try {
                        dispatchResult = await dispatch(assertAuthorized);
                        await assertAuthorized();
                    } catch (error) {
                        if (error?.clickState === 'not_dispatched') throw error;
                        dispatchUncertain = true;
                        dispatchResult = {
                            ok: false,
                            clickState: error?.clickState || 'unknown'
                        };
                    }
                    const run = State.reduceGenerationRun(currentRun, {
                        type: 'report',
                        runId: request?.runId,
                        epoch: request?.epoch,
                        itemId: request?.itemId,
                        claimId: request?.claimId,
                        outcome: 'submitted',
                        failureCode: '',
                        receipt: request?.receipt ?? null,
                        now: now()
                    });
                    await persist(run);
                    return {
                        status: 'submitted',
                        dispatchResult,
                        dispatchUncertain,
                        run: publicRun(run)
                    };
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
                    const cancelling = State.reduceGenerationRun(currentRun, {
                        type: 'begin_cancel',
                        runId: request?.runId,
                        epoch: request?.epoch,
                        now: now()
                    });
                    await persist(cancelling);
                    let acknowledged = false;
                    try {
                        const response = await withTimeout(notifyCancellation({
                            runId: cancelling.runId,
                            epoch: cancelling.epoch,
                            ownerTabId: cancelling.ownerTabId,
                            ownerDocumentId: cancelling.ownerDocumentId
                        }), cancellationAckTimeoutMs);
                        acknowledged = Boolean(response?.acknowledged);
                    } catch {
                        acknowledged = false;
                    }
                    if (!acknowledged) {
                        return {
                            status: 'cancelling',
                            acknowledged: false,
                            run: publicRun(cancelling)
                        };
                    }
                    const run = State.reduceGenerationRun(currentRun, {
                        type: 'finish_cancel',
                        runId: currentRun.runId,
                        epoch: currentRun.epoch,
                        now: now()
                    });
                    await persist(run);
                    return {
                        status: 'cancelled',
                        acknowledged: true,
                        run: publicRun(run)
                    };
                } catch (error) {
                    return rejected(error);
                }
            });
        }

        async function getGenerationRunStatus(_request = {}, sender = {}) {
            return enqueue(async () => {
                if (!currentRun) return { status: 'idle', run: null };
                if (currentRun.status === 'cancelling') {
                    const senderTabId = getSenderTabId(sender);
                    const senderDocumentId = String(sender?.documentId || '').trim();
                    const ownerDocumentReplaced = senderTabId === currentRun.ownerTabId
                        && senderDocumentId
                        && senderDocumentId !== currentRun.ownerDocumentId;
                    let acknowledged = ownerDocumentReplaced;
                    if (!acknowledged) {
                        try {
                            const response = await withTimeout(notifyCancellation({
                                runId: currentRun.runId,
                                epoch: currentRun.epoch,
                                ownerTabId: currentRun.ownerTabId,
                                ownerDocumentId: currentRun.ownerDocumentId
                            }), cancellationAckTimeoutMs);
                            acknowledged = Boolean(response?.acknowledged);
                        } catch {
                            acknowledged = false;
                        }
                    }
                    if (acknowledged) {
                        currentRun = State.reduceGenerationRun(currentRun, {
                            type: 'finish_cancel',
                            runId: currentRun.runId,
                            epoch: currentRun.epoch,
                            now: now()
                        });
                        await persist(currentRun);
                    }
                }
                return {
                    status: isActiveRun(currentRun) ? 'active' : currentRun.status,
                    run: publicRun()
                };
            });
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
            dispatchGenerationAction,
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
