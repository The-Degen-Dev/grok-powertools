const {
    GENERATION_RUN_JOURNAL_KEY,
    GENERATION_RUN_SESSION_KEY,
    createGenerationRunController
} = require('../../generationRunController.js');
const { DEFAULT_GENERATION_CLAIM_TIMEOUT_MS } = require('../../generationRunState.js');

const BASE_TIME = 1787241600000;

function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function createStorageArea(initial = {}, onSet = null) {
    const values = clone(initial);
    return {
        async get(keys) {
            const requested = Array.isArray(keys) ? keys : [keys];
            return Object.fromEntries(requested
                .filter((key) => Object.prototype.hasOwnProperty.call(values, key))
                .map((key) => [key, clone(values[key])]));
        },
        async set(next) {
            onSet?.(clone(next));
            Object.assign(values, clone(next));
        },
        async remove(keys) {
            for (const key of Array.isArray(keys) ? keys : [keys]) delete values[key];
        },
        snapshot() {
            return clone(values);
        }
    };
}

function descriptor(suffix) {
    return {
        version: 1,
        surface: 'results_gallery',
        sourceAssetId: `asset-${suffix}`,
        sourcePostId: `post-${suffix}`,
        conversationId: `conversation-${suffix}`,
        mediaKind: 'image',
        hrefPath: `/imagine/post/post-${suffix}`,
        initialOrder: suffix === 'a' ? 0 : 1,
        beforeAssetId: suffix === 'b' ? 'asset-a' : '',
        afterAssetId: suffix === 'a' ? 'asset-b' : ''
    };
}

function origin() {
    return {
        surface: 'results_gallery',
        url: 'https://grok.com/imagine?conversation=conversation-origin',
        scrollY: 640
    };
}

function sender(tabId = 42, documentId = 'document-a', url = origin().url) {
    return { tab: { id: tabId, url }, documentId };
}

function startRequest(overrides = {}) {
    return {
        kind: 'quick_batch',
        origin: origin(),
        items: [descriptor('a'), descriptor('b')],
        prompt: '',
        options: { maxRetries: 1 },
        ...overrides
    };
}

function createHarness(overrides = {}) {
    let nowValue = BASE_TIME;
    const sessionStorage = overrides.sessionStorage || createStorageArea();
    const localStorage = overrides.localStorage || createStorageArea();
    const controller = createGenerationRunController({
        sessionStorage,
        localStorage,
        now: () => nowValue++,
        getBlockingWorkflow: overrides.getBlockingWorkflow || (async () => null),
        notifyCancellation: overrides.notifyCancellation || (async () => ({ acknowledged: true })),
        cancellationAckTimeoutMs: overrides.cancellationAckTimeoutMs
    });
    return {
        controller,
        sessionStorage,
        localStorage,
        setNow(value) {
            nowValue = value;
        }
    };
}

async function startRun(harness, request = startRequest(), owner = sender()) {
    const result = await harness.controller.startGenerationRun(request, owner);
    expect(result).toEqual(expect.objectContaining({
        status: 'started',
        run: expect.objectContaining({
            runId: expect.any(String),
            epoch: 1,
            ownerTabId: owner.tab.id,
            status: 'running'
        })
    }));
    return result.run;
}

describe('generation run controller', () => {
    test('persists one background-owned run and a redacted local journal', async () => {
        const harness = createHarness();
        const run = await startRun(harness, startRequest({
            kind: 'prompted_batch',
            prompt: 'Candid friends walking along the beach'
        }));

        expect(harness.sessionStorage.snapshot()[GENERATION_RUN_SESSION_KEY]).toEqual(
            expect.objectContaining({
                runId: run.runId,
                ownerTabId: 42,
                prompt: 'Candid friends walking along the beach'
            })
        );
        expect(harness.localStorage.snapshot()[GENERATION_RUN_JOURNAL_KEY]).toEqual(
            expect.objectContaining({ runId: run.runId, ownerTabId: 42 })
        );
        expect(harness.localStorage.snapshot()[GENERATION_RUN_JOURNAL_KEY]).not.toHaveProperty(
            'activeClaim'
        );
        expect(harness.localStorage.snapshot()[GENERATION_RUN_JOURNAL_KEY]).not.toHaveProperty(
            'prompt'
        );
    });

    test('serializes concurrent starts so only one generation run wins', async () => {
        const harness = createHarness();
        const [first, second] = await Promise.all([
            harness.controller.startGenerationRun(startRequest(), sender()),
            harness.controller.startGenerationRun(startRequest({ kind: 'prompted_batch' }), sender())
        ]);

        expect([first.status, second.status].sort()).toEqual(['conflict', 'started']);
        expect(harness.sessionStorage.snapshot()[GENERATION_RUN_SESSION_KEY].runId).toBe(
            (first.status === 'started' ? first : second).run.runId
        );
    });

    test('keeps session authority active when the redacted start journal write fails', async () => {
        const localStorage = createStorageArea({}, () => {
            throw new Error('local_journal_unavailable');
        });
        const harness = createHarness({ localStorage });

        const started = await harness.controller.startGenerationRun(startRequest(), sender());

        expect(started.status).toBe('started');
        expect(harness.sessionStorage.snapshot()[GENERATION_RUN_SESSION_KEY]).toEqual(
            expect.objectContaining({ runId: started.run.runId, status: 'running' })
        );
        await expect(harness.controller.getGenerationRunStatus()).resolves.toEqual(
            expect.objectContaining({ status: 'active' })
        );
    });

    test('does not mutate memory when the authoritative session write fails', async () => {
        const sessionStorage = createStorageArea({}, () => {
            throw new Error('session_write_failed');
        });
        const harness = createHarness({ sessionStorage });

        await expect(harness.controller.startGenerationRun(startRequest(), sender())).resolves.toEqual({
            status: 'rejected',
            error: 'session_write_failed'
        });
        await expect(harness.controller.getGenerationRunStatus()).resolves.toEqual({
            status: 'idle',
            run: null
        });
    });

    test.each(['sync', 'recreate'])('rejects generation while %s owns workflow authority', async (kind) => {
        const harness = createHarness({
            getBlockingWorkflow: async () => ({ kind, status: 'running' })
        });

        await expect(harness.controller.startGenerationRun(startRequest(), sender())).resolves.toEqual({
            status: 'conflict',
            activeWorkflow: { kind, status: 'running' }
        });
        expect(harness.sessionStorage.snapshot()).toEqual({});
    });

    test('allows only the owner tab to claim or report work', async () => {
        const harness = createHarness();
        const run = await startRun(harness);

        await expect(harness.controller.claimGenerationAction({
            runId: run.runId,
            epoch: run.epoch
        }, sender(99))).resolves.toEqual({
            status: 'rejected',
            error: 'GENERATION_OWNER_MISMATCH'
        });

        const claimed = await harness.controller.claimGenerationAction({
            runId: run.runId,
            epoch: run.epoch
        }, sender());
        await expect(harness.controller.reportGenerationAction({
            ...claimed.claim,
            outcome: 'accepted',
            receipt: {
                sourceAssetId: 'asset-a',
                sourcePostId: 'post-a',
                observedState: 'provider_accepted',
                observedAt: BASE_TIME + 1
            }
        }, sender(99))).resolves.toEqual({
            status: 'rejected',
            error: 'GENERATION_OWNER_MISMATCH'
        });
    });

    test('rejects stale claims and keeps one outstanding action', async () => {
        const harness = createHarness();
        const run = await startRun(harness);
        const first = await harness.controller.claimGenerationAction({
            runId: run.runId,
            epoch: run.epoch
        }, sender());
        const blocked = await harness.controller.claimGenerationAction({
            runId: run.runId,
            epoch: run.epoch
        }, sender());

        expect(first).toEqual(expect.objectContaining({ status: 'claimed' }));
        expect(blocked).toEqual(expect.objectContaining({ status: 'waiting', claim: null }));
        await expect(harness.controller.reportGenerationAction({
            ...first.claim,
            claimId: 'stale-claim',
            outcome: 'accepted',
            receipt: null
        }, sender())).resolves.toEqual({
            status: 'rejected',
            error: 'STALE_GENERATION_CLAIM'
        });
    });

    test('expires an abandoned claim and advances without replaying that source', async () => {
        const harness = createHarness();
        const run = await startRun(harness);
        const first = await harness.controller.claimGenerationAction({
            runId: run.runId,
            epoch: run.epoch
        }, sender());
        harness.setNow(first.claim.expiresAt + DEFAULT_GENERATION_CLAIM_TIMEOUT_MS);

        const next = await harness.controller.claimGenerationAction({
            runId: run.runId,
            epoch: run.epoch
        }, sender());

        expect(next).toEqual(expect.objectContaining({ status: 'claimed' }));
        expect(next.claim.itemId).not.toBe(first.claim.itemId);
        expect(next.run.items.find((item) => item.itemId === first.claim.itemId)).toEqual(
            expect.objectContaining({ status: 'retryable_failed', failureCode: 'claim_expired' })
        );
    });

    test('hard navigation transfers an in-flight submitted claim without replaying its source', async () => {
        const harness = createHarness();
        const run = await startRun(
            harness,
            startRequest(),
            sender(42, 'document-before-navigation')
        );
        const first = await harness.controller.claimGenerationAction({
            runId: run.runId,
            epoch: run.epoch
        }, sender(42, 'document-before-navigation'));
        const checkpoint = await harness.controller.reportGenerationAction({
            ...first.claim,
            outcome: 'submitted',
            receipt: {
                sourceAssetId: 'asset-a',
                sourcePostId: 'post-a',
                observedState: 'submit_dispatched',
                observedAt: BASE_TIME + 1
            }
        }, sender(42, 'document-before-navigation'));

        expect(checkpoint.run.items[0]).toEqual(expect.objectContaining({ status: 'submitted' }));
        const resumed = await harness.controller.claimGenerationAction({
            runId: checkpoint.run.runId,
            epoch: checkpoint.run.epoch,
            resume: true,
            resumeProof: {
                surface: 'agent_media',
                url: 'https://grok.com/imagine/agent/agent-a',
                sourceAssetId: 'asset-a',
                sourcePostId: 'post-a'
            }
        }, sender(42, 'document-after-navigation', 'https://grok.com/imagine/agent/agent-a'));

        expect(resumed).toEqual(expect.objectContaining({
            status: 'resumed',
            claim: expect.objectContaining({
                itemId: first.claim.itemId,
                descriptor: first.claim.descriptor
            })
        }));
        expect(resumed.claim.claimId).not.toBe(first.claim.claimId);
        expect(resumed.claim.epoch).toBeGreaterThan(first.claim.epoch);
        expect(resumed.run.items[0]).toEqual(expect.objectContaining({
            status: 'submitted',
            receipt: checkpoint.run.items[0].receipt
        }));

        await expect(harness.controller.reportGenerationAction({
            ...first.claim,
            outcome: 'accepted',
            receipt: null
        }, sender(42, 'document-before-navigation'))).resolves.toEqual({
            status: 'rejected',
            error: 'STALE_GENERATION_CLAIM'
        });
    });

    test('transfers a claimless run after a proven same-gallery reload', async () => {
        const harness = createHarness();
        let run = await startRun(harness, startRequest(), sender(42, 'document-before-reload'));
        const first = await harness.controller.claimGenerationAction({
            runId: run.runId,
            epoch: run.epoch
        }, sender(42, 'document-before-reload'));
        ({ run } = await harness.controller.reportGenerationAction({
            ...first.claim,
            outcome: 'accepted',
            receipt: {
                sourceAssetId: 'asset-a',
                sourcePostId: 'post-a',
                observedState: 'provider_accepted',
                observedAt: BASE_TIME + 1
            }
        }, sender(42, 'document-before-reload')));

        const next = await harness.controller.claimGenerationAction({
            runId: run.runId,
            epoch: run.epoch,
            resume: true,
            resumeProof: {
                surface: 'results_gallery',
                url: origin().url
            }
        }, sender(42, 'document-after-reload'));

        expect(next).toEqual(expect.objectContaining({
            status: 'claimed',
            claim: expect.objectContaining({
                descriptor: expect.objectContaining({ sourceAssetId: 'asset-b' }),
                ownerDocumentId: 'document-after-reload'
            }),
            run: expect.objectContaining({
                ownerDocumentId: 'document-after-reload',
                epoch: run.epoch + 1
            })
        }));
    });

    test('rejects document transfer without proof from the current Grok surface', async () => {
        const harness = createHarness();
        const run = await startRun(harness, startRequest(), sender(42, 'document-before-reload'));

        await expect(harness.controller.claimGenerationAction({
            runId: run.runId,
            epoch: run.epoch,
            resume: true,
            resumeProof: {
                surface: 'results_gallery',
                url: 'https://grok.com/imagine?conversation=wrong'
            }
        }, sender(42, 'document-after-reload'))).resolves.toEqual({
            status: 'rejected',
            error: 'GENERATION_RESUME_PROOF_INVALID'
        });
    });

    test('hydrates after service-worker restart and resumes the same owner run', async () => {
        const sharedSession = createStorageArea();
        const sharedLocal = createStorageArea();
        const firstHarness = createHarness({
            sessionStorage: sharedSession,
            localStorage: sharedLocal
        });
        const run = await startRun(firstHarness);
        const claimed = await firstHarness.controller.claimGenerationAction({
            runId: run.runId,
            epoch: run.epoch
        }, sender());
        await firstHarness.controller.reportGenerationAction({
            ...claimed.claim,
            outcome: 'composer_ready',
            receipt: {
                sourceAssetId: 'asset-a',
                sourcePostId: 'post-a',
                observedState: 'composer_ready',
                observedAt: BASE_TIME + 1
            }
        }, sender());

        const restarted = createHarness({
            sessionStorage: sharedSession,
            localStorage: sharedLocal
        });
        await restarted.controller.initialize();
        const status = await restarted.controller.getGenerationRunStatus({}, sender());

        expect(status).toEqual(expect.objectContaining({
            status: 'active',
            run: expect.objectContaining({
                runId: run.runId,
                ownerTabId: 42,
                status: 'running'
            })
        }));
        expect(status.run.items[0]).toEqual(expect.objectContaining({
            status: 'composer_ready'
        }));
    });

    test('discards unsafe session state during hydration without journaling it', async () => {
        const sessionStorage = createStorageArea({
            [GENERATION_RUN_SESSION_KEY]: {
                schemaVersion: 1,
                runId: 'unsafe-run',
                epoch: 1,
                kind: 'quick_batch',
                ownerTabId: 42,
                status: 'running',
                items: [],
                authorization: 'Bearer must-not-survive-hydration'
            }
        });
        const localStorage = createStorageArea();
        const harness = createHarness({ sessionStorage, localStorage });

        await expect(harness.controller.initialize()).resolves.toBeNull();
        await expect(harness.controller.getGenerationRunStatus()).resolves.toEqual({
            status: 'idle',
            run: null
        });
        expect(sessionStorage.snapshot()).toEqual({});
        expect(localStorage.snapshot()).toEqual({});
    });

    test('resumes a provider-capacity wait before issuing the same source again', async () => {
        const harness = createHarness();
        let run = await startRun(harness, startRequest({ items: [descriptor('a')] }));
        const claimed = await harness.controller.claimGenerationAction({
            runId: run.runId,
            epoch: run.epoch
        }, sender());
        ({ run } = await harness.controller.reportGenerationAction({
            ...claimed.claim,
            outcome: 'capacity',
            failureCode: 'provider_capacity',
            receipt: null
        }, sender()));

        expect(run.status).toBe('waiting_capacity');
        await expect(harness.controller.claimGenerationAction({
            runId: run.runId,
            epoch: run.epoch
        }, sender())).resolves.toEqual(expect.objectContaining({
            status: 'waiting',
            claim: null
        }));

        const resumed = await harness.controller.claimGenerationAction({
            runId: run.runId,
            epoch: run.epoch,
            capacityAvailable: true
        }, sender());
        expect(resumed).toEqual(expect.objectContaining({
            status: 'claimed',
            claim: expect.objectContaining({
                itemId: claimed.claim.itemId,
                descriptor: claimed.claim.descriptor
            })
        }));
        expect(resumed.claim.claimId).not.toBe(claimed.claim.claimId);
    });

    test('expires a provider-capacity wait and advances to the next source', async () => {
        const harness = createHarness();
        let run = await startRun(harness, startRequest({
            options: { maxRetries: 1, capacityTimeoutMs: 5000 }
        }));
        const first = await harness.controller.claimGenerationAction({
            runId: run.runId,
            epoch: run.epoch
        }, sender());
        ({ run } = await harness.controller.reportGenerationAction({
            ...first.claim,
            outcome: 'capacity',
            failureCode: 'provider_capacity',
            receipt: null
        }, sender()));
        harness.setNow(run.capacityDeadlineAt);

        const next = await harness.controller.claimGenerationAction({
            runId: run.runId,
            epoch: run.epoch
        }, sender());

        expect(next.status).toBe('claimed');
        expect(next.claim.descriptor.sourceAssetId).toBe('asset-b');
        expect(next.run.items[0]).toEqual(expect.objectContaining({
            status: 'retryable_failed',
            failureCode: 'capacity_timeout'
        }));
    });

    test('Retry Failed requeues only retryable items through a new epoch', async () => {
        const harness = createHarness();
        let run = await startRun(harness, startRequest({ options: { maxRetries: 0 } }));
        const acceptedClaim = await harness.controller.claimGenerationAction({
            runId: run.runId,
            epoch: run.epoch
        }, sender());
        ({ run } = await harness.controller.reportGenerationAction({
            ...acceptedClaim.claim,
            outcome: 'accepted',
            receipt: {
                sourceAssetId: 'asset-a',
                sourcePostId: 'post-a',
                observedState: 'provider_accepted',
                observedAt: BASE_TIME + 1
            }
        }, sender()));
        const failedClaim = await harness.controller.claimGenerationAction({
            runId: run.runId,
            epoch: run.epoch
        }, sender());
        ({ run } = await harness.controller.reportGenerationAction({
            ...failedClaim.claim,
            outcome: 'retryable_failed',
            failureCode: 'provider_rejected',
            receipt: null
        }, sender()));

        const retried = await harness.controller.retryFailedGenerationItems({
            runId: run.runId,
            epoch: run.epoch
        }, sender());
        expect(retried.status).toBe('updated');
        expect(retried.run.epoch).toBe(run.epoch + 1);
        expect(retried.run.items[0].status).toBe('accepted');
        expect(retried.run.items[1]).toEqual(expect.objectContaining({
            status: 'queued',
            attemptsThisRound: 0
        }));
    });

    test('cancel persists revocation before notifying content and ignores late reports', async () => {
        const events = [];
        const sessionStorage = createStorageArea({}, (next) => {
            const state = next[GENERATION_RUN_SESSION_KEY];
            if (state) events.push(`persist:${state.status}`);
        });
        const harness = createHarness({
            sessionStorage,
            notifyCancellation: async () => {
                events.push('notify');
                return { acknowledged: true };
            }
        });
        const run = await startRun(harness);
        const claimed = await harness.controller.claimGenerationAction({
            runId: run.runId,
            epoch: run.epoch
        }, sender());
        events.length = 0;

        const cancelled = await harness.controller.cancelGenerationRun({
            runId: claimed.run.runId,
            epoch: claimed.run.epoch
        }, sender());

        expect(cancelled).toEqual(expect.objectContaining({
            status: 'cancelled',
            acknowledged: true,
            run: expect.objectContaining({ status: 'cancelled' })
        }));
        expect(events).toEqual(['persist:cancelled', 'notify']);
        await expect(harness.controller.reportGenerationAction({
            ...claimed.claim,
            outcome: 'accepted',
            receipt: null
        }, sender())).resolves.toEqual({
            status: 'rejected',
            error: 'STALE_GENERATION_CLAIM'
        });
    });

    test('local journal failure cannot reopen a cancelled claim', async () => {
        let localWrite = 0;
        const localStorage = createStorageArea({}, () => {
            localWrite += 1;
            if (localWrite === 3) throw new Error('cancel_journal_failed');
        });
        const harness = createHarness({ localStorage });
        const run = await startRun(harness);
        const claimed = await harness.controller.claimGenerationAction({
            runId: run.runId,
            epoch: run.epoch
        }, sender());

        const cancelled = await harness.controller.cancelGenerationRun({
            runId: run.runId,
            epoch: run.epoch
        }, sender());

        expect(cancelled).toEqual(expect.objectContaining({ status: 'cancelled' }));
        expect(harness.sessionStorage.snapshot()[GENERATION_RUN_SESSION_KEY]).toEqual(
            expect.objectContaining({ status: 'cancelled', epoch: run.epoch + 1 })
        );
        await expect(harness.controller.reportGenerationAction({
            ...claimed.claim,
            outcome: 'accepted',
            receipt: {
                sourceAssetId: 'asset-a',
                sourcePostId: 'post-a',
                observedState: 'provider_accepted',
                observedAt: BASE_TIME + 100
            }
        }, sender())).resolves.toEqual({
            status: 'rejected',
            error: 'STALE_GENERATION_CLAIM'
        });
    });

    test('local journal failure cannot roll back an accepted report', async () => {
        let localWrite = 0;
        const localStorage = createStorageArea({}, () => {
            localWrite += 1;
            if (localWrite === 3) throw new Error('report_journal_failed');
        });
        const harness = createHarness({ localStorage });
        const run = await startRun(harness);
        const claimed = await harness.controller.claimGenerationAction({
            runId: run.runId,
            epoch: run.epoch
        }, sender());

        const reported = await harness.controller.reportGenerationAction({
            ...claimed.claim,
            outcome: 'accepted',
            receipt: {
                sourceAssetId: 'asset-a',
                sourcePostId: 'post-a',
                observedState: 'provider_accepted',
                observedAt: BASE_TIME + 100
            }
        }, sender());

        expect(reported.status).toBe('updated');
        expect(harness.sessionStorage.snapshot()[GENERATION_RUN_SESSION_KEY].items[0].status)
            .toBe('accepted');
        const next = await harness.controller.claimGenerationAction({
            runId: run.runId,
            epoch: run.epoch
        }, sender());
        expect(next.claim.descriptor.sourceAssetId).toBe('asset-b');
    });

    test('cancel acknowledgement is bounded when the content listener never settles', async () => {
        const harness = createHarness({
            cancellationAckTimeoutMs: 5,
            notifyCancellation: () => new Promise(() => {})
        });
        const run = await startRun(harness);

        const cancelled = await harness.controller.cancelGenerationRun({
            runId: run.runId,
            epoch: run.epoch
        }, sender());

        expect(cancelled).toEqual(expect.objectContaining({
            status: 'cancelled',
            acknowledged: false,
            run: expect.objectContaining({ status: 'cancelled' })
        }));
    });

    test('closing the owner tab revokes the active run', async () => {
        const harness = createHarness();
        const run = await startRun(harness);

        await expect(harness.controller.cancelGenerationRunForOwnerTab(99)).resolves.toEqual(
            expect.objectContaining({ status: 'ignored' })
        );
        await expect(harness.controller.cancelGenerationRunForOwnerTab(42)).resolves.toEqual(
            expect.objectContaining({
                status: 'cancelled',
                run: expect.objectContaining({ runId: run.runId, status: 'cancelled' })
            })
        );
    });
});
