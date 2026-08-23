const fs = require('fs');
const vm = require('vm');
const {
    DEFAULT_GENERATION_CLAIM_TIMEOUT_MS,
    createGenerationRun,
    getNextGenerationClaim,
    reduceGenerationRun,
    sanitizeGenerationRun,
    validateGenerationRun
} = require('../../generationRunState.js');

const modulePath = require.resolve('../../generationRunState.js');

const BASE_TIME = 1787241600000;

function createDescriptor(suffix) {
    return {
        sourceAssetId: `asset-${suffix}`,
        sourcePostId: `post-${suffix}`,
        conversationId: `conversation-${suffix}`,
        surface: 'results_gallery',
        route: `https://grok.com/imagine/post/post-${suffix}`
    };
}

function createOrigin() {
    return {
        surface: 'results_gallery',
        url: 'https://grok.com/imagine?conversation=conversation-origin',
        scrollY: 640
    };
}

function createRun(overrides = {}) {
    return createGenerationRun({
        kind: 'quick_batch',
        ownerTabId: 42,
        origin: createOrigin(),
        items: [createDescriptor('a'), createDescriptor('b')],
        prompt: '',
        options: { maxRetries: 1 },
        now: BASE_TIME,
        ...overrides
    });
}

function claimNext(state) {
    const result = getNextGenerationClaim(state);

    expect(result).toEqual(expect.objectContaining({
        state: expect.any(Object)
    }));
    expect(result.claim).toEqual(expect.objectContaining({
        runId: state.runId,
        epoch: state.epoch,
        claimId: expect.any(String),
        itemId: expect.any(String),
        kind: state.kind,
        descriptor: expect.any(Object)
    }));

    return result;
}

function reportClaim(state, claim, outcome, overrides = {}) {
    return reduceGenerationRun(state, {
        type: 'report',
        runId: state.runId,
        epoch: claim.epoch,
        itemId: claim.itemId,
        claimId: claim.claimId,
        outcome,
        failureCode: '',
        receipt: null,
        now: state.updatedAt + 1,
        ...overrides
    });
}

function getItem(state, itemId) {
    return state.items.find((item) => item.itemId === itemId);
}

describe('generation run state contract', () => {
    test('exposes the CommonJS contract through the browser UMD global', () => {
        const context = { globalThis: {} };
        vm.runInNewContext(fs.readFileSync(modulePath, 'utf8'), context);

        expect(context.globalThis.GrokPowerToolsGenerationRunState).toEqual(expect.objectContaining({
            createGenerationRun: expect.any(Function),
            reduceGenerationRun: expect.any(Function),
            getNextGenerationClaim: expect.any(Function),
            sanitizeGenerationRun: expect.any(Function),
            validateGenerationRun: expect.any(Function)
        }));
    });

    test('rejects a secret-bearing hydrated run instead of accepting a sanitized shadow', () => {
        const run = createRun();

        expect(() => validateGenerationRun({
            ...run,
            diagnostics: {
                safeCode: 'resume',
                authorization: 'Bearer must-not-survive-hydration'
            }
        })).toThrow('UNSAFE_GENERATION_STATE');
        expect(validateGenerationRun(run)).toBe(true);
    });

    test('rejects structurally corrupt hydrated authority instead of trusting safe-looking data', () => {
        const run = createRun();
        const claimed = claimNext(run).state;

        expect(() => validateGenerationRun({ ...run, unexpectedField: 'benign-but-unknown' }))
            .toThrow('INVALID_GENERATION_STATE');
        expect(() => validateGenerationRun({
            ...run,
            counts: { ...run.counts, pending: 99 }
        })).toThrow('INVALID_GENERATION_STATE');
        expect(() => validateGenerationRun({
            ...run,
            items: [run.items[0], { ...run.items[1], itemId: run.items[0].itemId }]
        })).toThrow('INVALID_GENERATION_STATE');
        expect(() => validateGenerationRun({
            ...claimed,
            activeClaim: { ...claimed.activeClaim, expiresAt: claimed.activeClaim.claimedAt - 1 }
        })).toThrow('INVALID_GENERATION_STATE');
    });

    describe('creation', () => {
        test.each([
            {
                kind: 'quick_batch',
                prompt: '',
                options: { maxRetries: 2 },
                itemCount: 2
            },
            {
                kind: 'prompted_batch',
                prompt: 'Slow handheld push-in at sunset',
                options: { maxRetries: 3, resolution: '480p', durationSeconds: 6 },
                itemCount: 2
            },
            {
                kind: 'video_goal',
                prompt: 'Natural movement with a locked camera',
                options: { maxRetries: 1, goalCount: 3 },
                itemCount: 1
            }
        ])('creates a valid $kind run', ({ kind, prompt, options, itemCount }) => {
            const descriptors = Array.from(
                { length: itemCount },
                (_, index) => createDescriptor(`${kind}-${index}`)
            );
            const run = createRun({ kind, prompt, options, items: descriptors });

            expect(run).toEqual(expect.objectContaining({
                schemaVersion: 1,
                runId: expect.any(String),
                epoch: 1,
                kind,
                ownerTabId: 42,
                status: 'running',
                origin: createOrigin(),
                prompt,
                options: expect.objectContaining(options),
                activeClaim: null,
                createdAt: BASE_TIME,
                updatedAt: BASE_TIME,
                counts: {
                    accepted: 0,
                    failed: 0,
                    skipped: 0,
                    pending: itemCount
                }
            }));
            expect(run.runId).not.toContain(descriptors[0].sourceAssetId);
            expect(run.items).toHaveLength(itemCount);
            expect(new Set(run.items.map((item) => item.itemId)).size).toBe(itemCount);
            run.items.forEach((item, index) => {
                expect(item).toEqual(expect.objectContaining({
                    itemId: expect.any(String),
                    descriptor: descriptors[index],
                    status: 'queued',
                    attemptCount: 0,
                    attemptsThisRound: 0,
                    failureCode: '',
                    receipt: null
                }));
                expect(item.itemId).not.toContain(descriptors[index].sourceAssetId);
            });
        });

        test('rejects duplicate source identities before assigning work', () => {
            const duplicate = createDescriptor('duplicate');

            expect(() => createRun({ items: [duplicate, { ...duplicate }] }))
                .toThrow('INVALID_GENERATION_STATE');
        });

        test('allows repeated Prompted detail work only when the video goal matches the item count', () => {
            const duplicate = {
                ...createDescriptor('detail-repeat'),
                surface: 'agent_media'
            };
            const detailOrigin = {
                ...createOrigin(),
                surface: 'agent_media',
                sourceAssetId: duplicate.sourceAssetId,
                sourcePostId: duplicate.sourcePostId
            };

            expect(() => createRun({
                kind: 'prompted_batch',
                origin: detailOrigin,
                items: [duplicate, { ...duplicate }, { ...duplicate }],
                prompt: 'Slow handheld push-in',
                options: { maxRetries: 1, videoGoal: 3 }
            })).not.toThrow();
            expect(() => createRun({
                kind: 'prompted_batch',
                origin: detailOrigin,
                items: [duplicate, { ...duplicate }, { ...duplicate }],
                prompt: 'Slow handheld push-in',
                options: { maxRetries: 1, videoGoal: 2 }
            })).toThrow('INVALID_GENERATION_STATE');
            expect(() => createRun({
                kind: 'quick_batch',
                origin: detailOrigin,
                items: [duplicate, { ...duplicate }],
                options: { maxRetries: 1, videoGoal: 2 }
            })).toThrow('INVALID_GENERATION_STATE');
        });
    });

    test('allows only one outstanding claim and advances after acceptance', () => {
        const run = createRun();
        const first = claimNext(run);
        const firstItemId = run.items[0].itemId;

        expect(first.claim.itemId).toBe(firstItemId);
        expect(first.state).not.toBe(run);
        expect(first.state.activeClaim).toEqual(expect.objectContaining({
            claimId: first.claim.claimId,
            itemId: firstItemId,
            epoch: run.epoch
        }));
        expect(getItem(first.state, firstItemId).status).toBe('targeting');

        const blocked = getNextGenerationClaim(first.state);
        expect(blocked.claim).toBeNull();
        expect(blocked.state).toBe(first.state);

        const accepted = reportClaim(first.state, first.claim, 'accepted', {
            receipt: {
                sourceAssetId: 'asset-a',
                sourcePostId: 'post-a',
                observedState: 'provider_accepted',
                observedAt: BASE_TIME + 1
            }
        });
        const second = claimNext(accepted);

        expect(second.claim.itemId).toBe(run.items[1].itemId);
        expect(second.claim.claimId).not.toBe(first.claim.claimId);
    });

    test('expires an abandoned claim into retryable state without replaying it', () => {
        const run = createRun();
        const claimed = getNextGenerationClaim(run, BASE_TIME + 10);
        const expired = reduceGenerationRun(claimed.state, {
            type: 'expire_claim',
            runId: claimed.state.runId,
            epoch: claimed.state.epoch,
            now: BASE_TIME + 10 + DEFAULT_GENERATION_CLAIM_TIMEOUT_MS
        });

        expect(expired.activeClaim).toBeNull();
        expect(getItem(expired, claimed.claim.itemId)).toEqual(expect.objectContaining({
            status: 'retryable_failed',
            attemptCount: 1,
            failureCode: 'claim_expired'
        }));
        const next = getNextGenerationClaim(expired, expired.updatedAt + 1);
        expect(next.claim.itemId).toBe(run.items[1].itemId);
        expect(next.claim.itemId).not.toBe(claimed.claim.itemId);
    });

    test('does not expire an active claim before its deadline', () => {
        const run = createRun();
        const claimed = getNextGenerationClaim(run, BASE_TIME + 10);

        expect(() => reduceGenerationRun(claimed.state, {
            type: 'expire_claim',
            runId: claimed.state.runId,
            epoch: claimed.state.epoch,
            now: claimed.state.activeClaim.expiresAt - 1
        })).toThrow('INVALID_GENERATION_TRANSITION');
    });

    test('requires outcome-specific receipts with exact source identity', () => {
        const claimed = claimNext(createRun());

        const accepted = reportClaim(claimed.state, claimed.claim, 'accepted', {
            receipt: {
                sourceAssetId: 'asset-a',
                sourcePostId: 'post-a',
                observedState: 'submit_dispatched',
                observedAt: BASE_TIME + 1
            }
        });
        expect(getItem(accepted, claimed.claim.itemId)).toEqual(expect.objectContaining({
            status: 'accepted',
            lastOutcome: 'accepted'
        }));
        expect(() => reportClaim(claimed.state, claimed.claim, 'accepted', {
            receipt: {
                sourceAssetId: 'asset-a',
                observedState: 'provider_accepted',
                observedAt: BASE_TIME + 1
            }
        })).toThrow('INVALID_GENERATION_EVENT');
    });

    test('turns a bounded capacity wait into retryable state without replaying its source', () => {
        const run = createRun({ options: { maxRetries: 1, capacityTimeoutMs: 5000 } });
        const claimed = claimNext(run);
        const waiting = reportClaim(claimed.state, claimed.claim, 'capacity', {
            failureCode: 'provider_capacity',
            now: BASE_TIME + 1
        });

        expect(waiting).toEqual(expect.objectContaining({
            status: 'waiting_capacity',
            capacityWaitStartedAt: BASE_TIME + 1,
            capacityDeadlineAt: BASE_TIME + 5001
        }));
        expect(() => reduceGenerationRun(waiting, {
            type: 'capacity_timeout',
            runId: waiting.runId,
            epoch: waiting.epoch,
            now: waiting.capacityDeadlineAt - 1
        })).toThrow('INVALID_GENERATION_TRANSITION');

        const timedOut = reduceGenerationRun(waiting, {
            type: 'capacity_timeout',
            runId: waiting.runId,
            epoch: waiting.epoch,
            now: waiting.capacityDeadlineAt
        });
        expect(getItem(timedOut, claimed.claim.itemId)).toEqual(expect.objectContaining({
            status: 'retryable_failed',
            failureCode: 'capacity_timeout'
        }));
        expect(getNextGenerationClaim(timedOut, timedOut.updatedAt + 1).claim.itemId)
            .toBe(run.items[1].itemId);
    });

    test('retains the active claim and sanitized receipt through composer and submit checkpoints', () => {
        const claimed = claimNext(createRun());
        const composerReceipt = {
            sourceAssetId: 'asset-a',
            sourcePostId: 'post-a',
            observedState: 'composer_ready',
            observedAt: BASE_TIME + 1,
            checkpointVersion: 1,
            checkpointAction: 'prompted_video',
            checkpointSourceKind: 'agent_media',
            checkpointSourceNodeId: 'asset-node-a',
            baselineAcceptedCount: 0,
            baselineRejectedCount: 0
        };
        const composerReady = reportClaim(claimed.state, claimed.claim, 'composer_ready', {
            receipt: composerReceipt
        });

        expect(getItem(claimed.state, claimed.claim.itemId)).toEqual(expect.objectContaining({
            status: 'targeting',
            receipt: null
        }));
        expect(getItem(composerReady, claimed.claim.itemId)).toEqual(expect.objectContaining({
            status: 'composer_ready',
            attemptCount: 0,
            attemptsThisRound: 0,
            receipt: composerReceipt
        }));
        expect(composerReady.activeClaim).toEqual(claimed.state.activeClaim);
        expect(composerReady.counts.pending).toBe(2);

        const submittedReceipt = {
            sourceAssetId: 'asset-a',
            sourcePostId: 'post-a',
            observedState: 'submitted',
            observedAt: BASE_TIME + 2,
            checkpointVersion: 1,
            checkpointAction: 'prompted_video',
            checkpointSourceKind: 'agent_media',
            checkpointSourceNodeId: 'asset-node-a',
            baselineAcceptedCount: 0,
            baselineRejectedCount: 0
        };
        const submitted = reportClaim(composerReady, claimed.claim, 'submitted', {
            receipt: submittedReceipt
        });

        expect(getItem(submitted, claimed.claim.itemId)).toEqual(expect.objectContaining({
            status: 'submitted',
            attemptCount: 0,
            attemptsThisRound: 0,
            receipt: submittedReceipt
        }));
        expect(submitted.activeClaim).toEqual(claimed.state.activeClaim);
        expect(getNextGenerationClaim(submitted)).toEqual({ state: submitted, claim: null });
    });

    test('persists a complete Video Goal result baseline and rejects partial or duplicate baselines', () => {
        const run = createRun({
            kind: 'video_goal',
            items: [createDescriptor('goal-baseline')],
            options: { maxRetries: 1, goalCount: 1 }
        });
        const claimed = claimNext(run);
        const receipt = {
            sourceAssetId: 'asset-goal-baseline',
            sourcePostId: 'post-goal-baseline',
            observedState: 'composer_ready',
            observedAt: BASE_TIME + 1,
            checkpointVersion: 1,
            checkpointAction: 'goal_video',
            checkpointSourceKind: 'agent_media',
            checkpointSourceNodeId: 'asset-node-goal',
            baselineAcceptedCount: 0,
            baselineRejectedCount: 0,
            resultBaselineVersion: 1,
            baselineResultAssetIds: ['result-before-1'],
            baselineFailureCount: 0,
            sourceResponseId: '10000000-0000-4000-8000-000000000001',
            baselineFailureResponseIds: [],
            baselineInflightResponseIds: []
        };

        const checkpointed = reportClaim(claimed.state, claimed.claim, 'composer_ready', { receipt });
        expect(getItem(checkpointed, claimed.claim.itemId).receipt).toEqual(receipt);

        const { baselineFailureCount: _baselineFailureCount, ...partialBaseline } = receipt;
        expect(() => reportClaim(claimed.state, claimed.claim, 'composer_ready', {
            receipt: partialBaseline
        })).toThrow('INVALID_GENERATION_EVENT');
        expect(() => reportClaim(claimed.state, claimed.claim, 'composer_ready', {
            receipt: {
                ...receipt,
                baselineResultAssetIds: ['result-before-1', 'result-before-1']
            }
        })).toThrow('INVALID_GENERATION_EVENT');
    });

    test.each(['reclaim', 'resume_claim'])(
        '%s transfers an active checkpoint claim to a new document owner',
        (eventType) => {
            const run = createRun({ ownerDocumentId: 'document-a' });
            const claimed = claimNext(run);
            const composerReady = reportClaim(claimed.state, claimed.claim, 'composer_ready', {
                receipt: {
                    sourceAssetId: 'asset-a',
                    sourcePostId: 'post-a',
                    observedState: 'composer_ready',
                    observedAt: BASE_TIME + 1
                }
            });
            const resumed = reduceGenerationRun(composerReady, {
                type: eventType,
                runId: composerReady.runId,
                epoch: composerReady.epoch,
                itemId: claimed.claim.itemId,
                claimId: claimed.claim.claimId,
                ownerDocumentId: 'document-b',
                now: BASE_TIME + 2
            });

            expect(resumed).toEqual(expect.objectContaining({
                epoch: composerReady.epoch + 1,
                ownerDocumentId: 'document-b',
                status: 'running',
                updatedAt: BASE_TIME + 2
            }));
            expect(resumed.activeClaim).toEqual(expect.objectContaining({
                itemId: claimed.claim.itemId,
                epoch: composerReady.epoch + 1,
                ownerDocumentId: 'document-b'
            }));
            expect(resumed.activeClaim.claimId).not.toBe(claimed.claim.claimId);
            expect(getItem(resumed, claimed.claim.itemId)).toEqual(expect.objectContaining({
                status: 'composer_ready',
                receipt: getItem(composerReady, claimed.claim.itemId).receipt,
                lastClaimId: resumed.activeClaim.claimId
            }));
            expect(() => reportClaim(resumed, claimed.claim, 'submitted', {
                receipt: {
                    sourceAssetId: 'asset-a',
                    sourcePostId: 'post-a',
                    observedState: 'submitted',
                    observedAt: BASE_TIME + 3
                }
            })).toThrow('STALE_GENERATION_CLAIM');

            const resumedClaim = {
                ...claimed.claim,
                epoch: resumed.epoch,
                claimId: resumed.activeClaim.claimId
            };
            const submitted = reportClaim(resumed, resumedClaim, 'submitted', {
                receipt: {
                    sourceAssetId: 'asset-a',
                    sourcePostId: 'post-a',
                    observedState: 'submitted',
                    observedAt: BASE_TIME + 3
                }
            });
            expect(getItem(submitted, claimed.claim.itemId).status).toBe('submitted');
            expect(submitted.activeClaim.ownerDocumentId).toBe('document-b');
        }
    );

    test('a resumed Video Goal claim can complete while its pre-reload claim stays stale', () => {
        const run = createRun({
            kind: 'video_goal',
            ownerDocumentId: 'document-a',
            items: [createDescriptor('goal-resume')],
            options: { maxRetries: 1, goalCount: 1 }
        });
        const claimed = claimNext(run);
        const accepted = reportClaim(claimed.state, claimed.claim, 'accepted', {
            receipt: {
                sourceAssetId: 'asset-goal-resume',
                sourcePostId: 'post-goal-resume',
                observedState: 'provider_accepted',
                observedAt: BASE_TIME + 1
            }
        });
        const resumed = reduceGenerationRun(accepted, {
            type: 'resume_claim',
            runId: accepted.runId,
            epoch: accepted.epoch,
            itemId: claimed.claim.itemId,
            claimId: claimed.claim.claimId,
            ownerDocumentId: 'document-b',
            now: BASE_TIME + 2
        });
        const completionReceipt = {
            sourceAssetId: 'asset-goal-resume',
            sourcePostId: 'post-goal-resume',
            resultAssetId: 'generated-after-reload',
            observedState: 'playable_result',
            observedAt: BASE_TIME + 3
        };

        expect(() => reportClaim(resumed, claimed.claim, 'completed', {
            receipt: completionReceipt
        })).toThrow('STALE_GENERATION_CLAIM');

        const resumedClaim = {
            ...claimed.claim,
            epoch: resumed.epoch,
            claimId: resumed.activeClaim.claimId
        };
        const completed = reportClaim(resumed, resumedClaim, 'completed', {
            receipt: completionReceipt
        });

        expect(completed.status).toBe('completed');
        expect(completed.goalProgress).toBe(1);
        expect(completed.completedResultIds).toEqual(['generated-after-reload']);
    });

    test('treats a duplicate accepted report as an idempotent no-op', () => {
        const claimed = claimNext(createRun());
        const event = {
            type: 'report',
            runId: claimed.state.runId,
            epoch: claimed.claim.epoch,
            itemId: claimed.claim.itemId,
            claimId: claimed.claim.claimId,
            outcome: 'accepted',
            failureCode: '',
            receipt: {
                sourceAssetId: 'asset-a',
                sourcePostId: 'post-a',
                observedState: 'provider_accepted',
                observedAt: BASE_TIME + 1
            },
            now: BASE_TIME + 1
        };
        const accepted = reduceGenerationRun(claimed.state, event);
        const duplicate = reduceGenerationRun(accepted, event);

        expect(getItem(accepted, claimed.claim.itemId)).toEqual(expect.objectContaining({
            status: 'accepted',
            attemptCount: 1,
            receipt: event.receipt
        }));
        expect(accepted.counts).toEqual({
            accepted: 1,
            failed: 0,
            skipped: 0,
            pending: 1
        });
        expect(duplicate).toBe(accepted);
    });

    test('waits for provider capacity and resumes the same item without consuming a retry', () => {
        const run = createRun({ items: [createDescriptor('capacity')] });
        const first = claimNext(run);
        const waiting = reportClaim(first.state, first.claim, 'capacity', {
            failureCode: 'provider_capacity'
        });

        expect(waiting.status).toBe('waiting_capacity');
        expect(waiting.activeClaim).toBeNull();
        expect(getItem(waiting, first.claim.itemId)).toEqual(expect.objectContaining({
            status: 'queued',
            attemptCount: 0,
            attemptsThisRound: 0,
            failureCode: 'provider_capacity'
        }));
        expect(getNextGenerationClaim(waiting)).toEqual({ state: waiting, claim: null });

        const resumed = reduceGenerationRun(waiting, {
            type: 'capacity_available',
            runId: waiting.runId,
            epoch: waiting.epoch,
            now: BASE_TIME + 2
        });
        const retried = claimNext(resumed);

        expect(resumed.status).toBe('running');
        expect(retried.claim.itemId).toBe(first.claim.itemId);
        expect(retried.claim.claimId).not.toBe(first.claim.claimId);
    });

    test('bounds automatic retries and continues after the item becomes retryable failed', () => {
        const run = createRun({ options: { maxRetries: 1 } });
        const firstClaim = claimNext(run);
        const firstFailure = reportClaim(firstClaim.state, firstClaim.claim, 'retryable_failed', {
            failureCode: 'acceptance_timeout'
        });

        expect(getItem(firstFailure, firstClaim.claim.itemId)).toEqual(expect.objectContaining({
            status: 'queued',
            attemptCount: 1,
            attemptsThisRound: 1,
            failureCode: 'acceptance_timeout'
        }));
        expect(firstFailure.status).toBe('running');

        const retryClaim = claimNext(firstFailure);
        expect(retryClaim.claim.itemId).toBe(firstClaim.claim.itemId);
        const exhausted = reportClaim(retryClaim.state, retryClaim.claim, 'retryable_failed', {
            failureCode: 'acceptance_timeout'
        });

        expect(getItem(exhausted, firstClaim.claim.itemId)).toEqual(expect.objectContaining({
            status: 'retryable_failed',
            attemptCount: 2,
            attemptsThisRound: 2,
            failureCode: 'acceptance_timeout'
        }));
        expect(exhausted.counts).toEqual({
            accepted: 0,
            failed: 1,
            skipped: 0,
            pending: 1
        });
        expect(claimNext(exhausted).claim.itemId).toBe(run.items[1].itemId);
    });

    test('continues after a permanent item failure and completes once all items are terminal', () => {
        const run = createRun();
        const failedClaim = claimNext(run);
        const failed = reportClaim(failedClaim.state, failedClaim.claim, 'permanent_failed', {
            failureCode: 'ambiguous_action'
        });

        expect(getItem(failed, failedClaim.claim.itemId)).toEqual(expect.objectContaining({
            status: 'permanent_failed',
            attemptCount: 1,
            failureCode: 'ambiguous_action'
        }));
        expect(failed.status).toBe('running');

        const nextClaim = claimNext(failed);
        expect(nextClaim.claim.itemId).toBe(run.items[1].itemId);
        const completed = reportClaim(nextClaim.state, nextClaim.claim, 'accepted', {
            receipt: {
                sourceAssetId: 'asset-b',
                sourcePostId: 'post-b',
                observedState: 'provider_accepted',
                observedAt: BASE_TIME + 2
            }
        });

        expect(completed.status).toBe('completed');
        expect(completed.counts).toEqual({
            accepted: 1,
            failed: 1,
            skipped: 0,
            pending: 0
        });
        expect(getNextGenerationClaim(completed)).toEqual({ state: completed, claim: null });
    });

    test('Retry Failed requeues only retryable items and never replays accepted items', () => {
        const run = createRun({ options: { maxRetries: 0 } });
        const acceptedClaim = claimNext(run);
        const accepted = reportClaim(acceptedClaim.state, acceptedClaim.claim, 'accepted', {
            receipt: {
                sourceAssetId: 'asset-a',
                sourcePostId: 'post-a',
                observedState: 'provider_accepted',
                observedAt: BASE_TIME + 1
            }
        });
        const failedClaim = claimNext(accepted);
        const failed = reportClaim(failedClaim.state, failedClaim.claim, 'retryable_failed', {
            failureCode: 'provider_rejected'
        });

        expect(failed.status).toBe('retryable_failed');
        const retried = reduceGenerationRun(failed, {
            type: 'retry_failed',
            runId: failed.runId,
            epoch: failed.epoch,
            now: BASE_TIME + 3
        });

        expect(retried.runId).toBe(failed.runId);
        expect(retried.epoch).toBe(failed.epoch + 1);
        expect(retried.status).toBe('running');
        expect(getItem(retried, acceptedClaim.claim.itemId)).toEqual(
            getItem(failed, acceptedClaim.claim.itemId)
        );
        expect(getItem(retried, failedClaim.claim.itemId)).toEqual(expect.objectContaining({
            status: 'queued',
            attemptCount: 1,
            attemptsThisRound: 0,
            failureCode: '',
            receipt: null
        }));
        expect(retried.counts).toEqual({
            accepted: 1,
            failed: 0,
            skipped: 0,
            pending: 1
        });

        const retryClaim = claimNext(retried);
        expect(retryClaim.claim.itemId).toBe(failedClaim.claim.itemId);
        expect(retryClaim.claim.itemId).not.toBe(acceptedClaim.claim.itemId);
    });

    test('rejects reports from stale claims and stale epochs without mutating state', () => {
        const claimed = claimNext(createRun());

        expect(() => reportClaim(claimed.state, {
            ...claimed.claim,
            claimId: 'stale-claim-id'
        }, 'accepted')).toThrow('STALE_GENERATION_CLAIM');
        expect(() => reportClaim(claimed.state, {
            ...claimed.claim,
            epoch: claimed.claim.epoch - 1
        }, 'accepted')).toThrow('STALE_GENERATION_CLAIM');
        expect(getItem(claimed.state, claimed.claim.itemId).status).toBe('targeting');
        expect(claimed.state.activeClaim.claimId).toBe(claimed.claim.claimId);
    });

    test('cancellation revokes the outstanding claim and prevents further work', () => {
        const claimed = claimNext(createRun());
        const cancelled = reduceGenerationRun(claimed.state, {
            type: 'cancel',
            runId: claimed.state.runId,
            epoch: claimed.state.epoch,
            now: BASE_TIME + 1
        });

        expect(cancelled).toEqual(expect.objectContaining({
            status: 'cancelled',
            epoch: claimed.state.epoch + 1,
            activeClaim: null,
            cancelledAt: BASE_TIME + 1,
            updatedAt: BASE_TIME + 1
        }));
        expect(cancelled.items.every((item) => item.status === 'cancelled')).toBe(true);
        expect(cancelled.counts).toEqual({
            accepted: 0,
            failed: 0,
            skipped: 2,
            pending: 0
        });
        expect(getNextGenerationClaim(cancelled)).toEqual({ state: cancelled, claim: null });
        expect(() => reportClaim(cancelled, claimed.claim, 'accepted')).toThrow(
            'STALE_GENERATION_CLAIM'
        );
    });

    test('completes after every planned item has an accepted provider receipt', () => {
        let state = createRun();

        while (state.status === 'running') {
            const claimed = claimNext(state);
            state = reportClaim(claimed.state, claimed.claim, 'accepted', {
                receipt: {
                    sourceAssetId: claimed.claim.descriptor.sourceAssetId,
                    sourcePostId: claimed.claim.descriptor.sourcePostId,
                    observedState: 'provider_accepted',
                    observedAt: state.updatedAt + 1
                }
            });
        }

        expect(state.status).toBe('completed');
        expect(state.items.every((item) => item.status === 'accepted')).toBe(true);
        expect(state.counts).toEqual({
            accepted: 2,
            failed: 0,
            skipped: 0,
            pending: 0
        });
        expect(state.completedAt).toEqual(expect.any(Number));
    });

    test('Video Goal acceptance remains pending until a matching playable result completes', () => {
        const run = createRun({
            kind: 'video_goal',
            ownerDocumentId: 'document-a',
            items: [createDescriptor('goal')],
            prompt: 'Natural movement',
            options: { maxRetries: 1, goalCount: 2 }
        });
        const claimed = claimNext(run);
        const accepted = reportClaim(claimed.state, claimed.claim, 'accepted', {
            receipt: {
                sourceAssetId: 'asset-goal',
                sourcePostId: 'post-goal',
                observedState: 'provider_accepted',
                observedAt: BASE_TIME + 1
            }
        });

        expect(accepted.status).toBe('running');
        expect(accepted.goalProgress).toBe(0);
        expect(accepted.completedResultIds).toEqual([]);
        expect(accepted.counts).toEqual({
            accepted: 0,
            failed: 0,
            skipped: 0,
            pending: 1
        });
        expect(getItem(accepted, claimed.claim.itemId)).toEqual(expect.objectContaining({
            status: 'submitted',
            attemptCount: 1,
            receipt: expect.objectContaining({ observedState: 'provider_accepted' })
        }));
        expect(accepted.activeClaim.claimId).toBe(claimed.claim.claimId);
        expect(getNextGenerationClaim(accepted)).toEqual({ state: accepted, claim: null });
    });

    test('Video Goal result timeout does not count an accepted submission twice', () => {
        const run = createRun({
            kind: 'video_goal',
            ownerDocumentId: 'document-a',
            items: [createDescriptor('goal-timeout')],
            options: { maxRetries: 0, goalCount: 1 }
        });
        const claimed = claimNext(run);
        const accepted = reportClaim(claimed.state, claimed.claim, 'accepted', {
            receipt: {
                sourceAssetId: 'asset-goal-timeout',
                sourcePostId: 'post-goal-timeout',
                observedState: 'provider_accepted',
                observedAt: BASE_TIME + 1
            }
        });
        const timedOut = reportClaim(accepted, claimed.claim, 'retryable_failed', {
            failureCode: 'result_timeout',
            now: accepted.updatedAt + 1
        });

        expect(getItem(timedOut, claimed.claim.itemId)).toEqual(expect.objectContaining({
            status: 'retryable_failed',
            attemptCount: 1,
            attemptsThisRound: 1,
            failureCode: 'result_timeout'
        }));
    });

    test('Video Goal ends failed when result identity is permanently ambiguous', () => {
        const run = createRun({
            kind: 'video_goal',
            items: [createDescriptor('goal-ambiguous')],
            options: { maxRetries: 1, goalCount: 1 }
        });
        const claimed = claimNext(run);
        const failed = reportClaim(claimed.state, claimed.claim, 'permanent_failed', {
            failureCode: 'result_ambiguous'
        });

        expect(failed.status).toBe('failed');
        expect(failed.goalProgress).toBe(0);
        expect(getItem(failed, claimed.claim.itemId)).toEqual(expect.objectContaining({
            status: 'permanent_failed',
            failureCode: 'result_ambiguous'
        }));
    });

    test('Video Goal advances only on unique matching completed results', () => {
        let state = createRun({
            kind: 'video_goal',
            ownerDocumentId: 'document-a',
            items: [createDescriptor('goal')],
            prompt: 'Natural movement',
            options: { maxRetries: 1, goalCount: 2 }
        });

        const firstClaim = claimNext(state);
        state = reportClaim(firstClaim.state, firstClaim.claim, 'accepted', {
            receipt: {
                sourceAssetId: 'asset-goal',
                sourcePostId: 'post-goal',
                observedState: 'provider_accepted',
                observedAt: BASE_TIME + 1
            }
        });
        state = reportClaim(state, firstClaim.claim, 'completed', {
            receipt: {
                sourceAssetId: 'asset-goal',
                sourcePostId: 'post-goal',
                resultAssetId: 'generated-video-1',
                resultPostId: 'generated-post-1',
                observedState: 'playable_result',
                observedAt: BASE_TIME + 2
            }
        });

        expect(state).toEqual(expect.objectContaining({
            status: 'running',
            goalProgress: 1,
            completedResultIds: ['generated-video-1'],
            activeClaim: null
        }));
        expect(getItem(state, firstClaim.claim.itemId)).toEqual(expect.objectContaining({
            status: 'queued',
            attemptCount: 1,
            attemptsThisRound: 0
        }));

        const secondClaim = claimNext(state);
        state = reportClaim(secondClaim.state, secondClaim.claim, 'accepted', {
            receipt: {
                sourceAssetId: 'asset-goal',
                sourcePostId: 'post-goal',
                observedState: 'provider_accepted',
                observedAt: BASE_TIME + 3
            }
        });
        state = reportClaim(state, secondClaim.claim, 'completed', {
            receipt: {
                sourceAssetId: 'asset-goal',
                sourcePostId: 'post-goal',
                resultAssetId: 'generated-video-2',
                resultPostId: 'generated-post-2',
                observedState: 'playable_result',
                observedAt: BASE_TIME + 4
            }
        });

        expect(state.status).toBe('completed');
        expect(state.goalProgress).toBe(2);
        expect(state.completedResultIds).toEqual(['generated-video-1', 'generated-video-2']);
        expect(state.counts).toEqual({
            accepted: 1,
            failed: 0,
            skipped: 0,
            pending: 0
        });
        expect(getItem(state, secondClaim.claim.itemId).status).toBe('accepted');
    });

    test('Video Goal rejects unrelated and previously counted completed result identities', () => {
        let state = createRun({
            kind: 'video_goal',
            items: [createDescriptor('goal')],
            prompt: 'Natural movement',
            options: { maxRetries: 1, goalCount: 2 }
        });
        const firstClaim = claimNext(state);
        state = reportClaim(firstClaim.state, firstClaim.claim, 'accepted', {
            receipt: {
                sourceAssetId: 'asset-goal',
                sourcePostId: 'post-goal',
                observedState: 'provider_accepted',
                observedAt: BASE_TIME + 1
            }
        });

        expect(() => reportClaim(state, firstClaim.claim, 'completed', {
            receipt: {
                sourceAssetId: 'asset-unrelated',
                sourcePostId: 'post-unrelated',
                resultAssetId: 'generated-video-unrelated',
                observedState: 'playable_result',
                observedAt: BASE_TIME + 2
            }
        })).toThrow('UNRELATED_GENERATION_RESULT');
        expect(state.goalProgress).toBe(0);

        state = reportClaim(state, firstClaim.claim, 'completed', {
            receipt: {
                sourceAssetId: 'asset-goal',
                sourcePostId: 'post-goal',
                resultAssetId: 'generated-video-1',
                observedState: 'playable_result',
                observedAt: BASE_TIME + 2
            }
        });
        const secondClaim = claimNext(state);
        state = reportClaim(secondClaim.state, secondClaim.claim, 'accepted', {
            receipt: {
                sourceAssetId: 'asset-goal',
                sourcePostId: 'post-goal',
                observedState: 'provider_accepted',
                observedAt: BASE_TIME + 3
            }
        });

        expect(() => reportClaim(state, secondClaim.claim, 'completed', {
            receipt: {
                sourceAssetId: 'asset-goal',
                sourcePostId: 'post-goal',
                resultAssetId: 'generated-video-1',
                observedState: 'playable_result',
                observedAt: BASE_TIME + 4
            }
        })).toThrow('STALE_GENERATION_RESULT');
        expect(state.goalProgress).toBe(1);
    });

    describe('persistence safety', () => {
        test.each([
            {
                name: 'signed URL',
                overrides: {
                    items: [{
                        ...createDescriptor('signed'),
                        mediaUrl: 'https://assets.grok.com/video.mp4?X-Amz-Signature=abc&X-Amz-Credential=secret'
                    }]
                }
            },
            {
                name: 'data URL',
                overrides: {
                    prompt: 'data:image/png;base64,c2VjcmV0'
                }
            },
            {
                name: 'secret-like field',
                overrides: {
                    options: {
                        maxRetries: 1,
                        apiKey: 'not-for-storage'
                    }
                }
            }
        ])('rejects unsafe $name input at creation', ({ overrides }) => {
            expect(() => createRun(overrides)).toThrow('UNSAFE_GENERATION_STATE');
        });

        test('rejects unsafe receipt fields before they enter run state', () => {
            const claimed = claimNext(createRun());

            expect(() => reportClaim(claimed.state, claimed.claim, 'accepted', {
                receipt: {
                    sourceAssetId: 'asset-a',
                    observedState: 'provider_accepted',
                    observedAt: BASE_TIME + 1,
                    authorization: 'Bearer should-not-persist'
                }
            })).toThrow('UNSAFE_GENERATION_STATE');
        });

        test('sanitizes a hydrated journal without leaking ephemeral claims or unsafe values', () => {
            const run = createRun();
            const contaminated = {
                ...run,
                activeClaim: {
                    claimId: 'claim-secret',
                    headers: { Authorization: 'Bearer should-not-persist' }
                },
                origin: {
                    ...run.origin,
                    signedMediaUrl: 'https://assets.grok.com/video.mp4?X-Amz-Signature=abc'
                },
                items: run.items.map((item, index) => index === 0 ? {
                    ...item,
                    descriptor: {
                        ...item.descriptor,
                        previewDataUrl: 'data:image/png;base64,c2VjcmV0',
                        apiToken: 'should-not-persist'
                    },
                    receipt: {
                        sourceAssetId: item.descriptor.sourceAssetId,
                        observedState: 'provider_accepted',
                        observedAt: BASE_TIME + 1,
                        cookie: 'session=should-not-persist'
                    }
                } : item),
                diagnostics: {
                    safeCode: 'acceptance_timeout',
                    secret: 'should-not-persist'
                }
            };
            const sanitized = sanitizeGenerationRun(contaminated);
            const serialized = JSON.stringify(sanitized);

            expect(sanitized).not.toBe(contaminated);
            expect(sanitized).toEqual(expect.objectContaining({
                schemaVersion: 1,
                runId: run.runId,
                kind: run.kind,
                status: run.status
            }));
            expect(sanitized).not.toHaveProperty('activeClaim');
            expect(sanitized.origin).not.toHaveProperty('signedMediaUrl');
            expect(sanitized.items[0].descriptor).not.toHaveProperty('previewDataUrl');
            expect(sanitized.items[0].descriptor).not.toHaveProperty('apiToken');
            expect(sanitized.items[0].receipt).not.toHaveProperty('cookie');
            expect(sanitized.diagnostics).toEqual({ safeCode: 'acceptance_timeout' });
            expect(serialized).not.toMatch(/Bearer|X-Amz-Signature|data:image|should-not-persist/i);
            expect(contaminated.activeClaim.claimId).toBe('claim-secret');
        });
    });
});
