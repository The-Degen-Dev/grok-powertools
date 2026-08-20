(function (root, factory) {
    const api = factory();

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }

    if (root) {
        root.GrokPowerToolsGenerationRunState = api;
    }
})(typeof self !== 'undefined' ? self : typeof globalThis !== 'undefined' ? globalThis : this, function () {
    const SCHEMA_VERSION = 1;
    const MAX_ITEMS = 1000;
    const MAX_STRING_LENGTH = 20000;
    const MAX_OBJECT_DEPTH = 8;
    const DEFAULT_GENERATION_CLAIM_TIMEOUT_MS = 120000;
    const DEFAULT_GENERATION_CAPACITY_TIMEOUT_MS = 120000;
    const RUN_KINDS = new Set(['quick_batch', 'prompted_batch', 'video_goal']);
    const RUN_STATUSES = new Set([
        'running',
        'waiting_capacity',
        'retryable_failed',
        'completed',
        'cancelled',
        'failed'
    ]);
    const ITEM_STATUSES = new Set([
        'queued',
        'targeting',
        'composer_ready',
        'submitted',
        'accepted',
        'retryable_failed',
        'permanent_failed',
        'cancelled'
    ]);
    const REPORT_OUTCOMES = new Set([
        'composer_ready',
        'submitted',
        'accepted',
        'completed',
        'capacity',
        'retryable_failed',
        'permanent_failed',
        'cancelled'
    ]);
    const EVENT_KEYS = {
        report: new Set([
            'type',
            'runId',
            'epoch',
            'itemId',
            'claimId',
            'outcome',
            'failureCode',
            'receipt',
            'now'
        ]),
        capacity_available: new Set(['type', 'runId', 'epoch', 'now']),
        capacity_timeout: new Set(['type', 'runId', 'epoch', 'now']),
        retry_failed: new Set(['type', 'runId', 'epoch', 'now']),
        cancel: new Set(['type', 'runId', 'epoch', 'now']),
        expire_claim: new Set(['type', 'runId', 'epoch', 'now']),
        transfer_owner: new Set(['type', 'runId', 'epoch', 'ownerDocumentId', 'now']),
        reclaim: new Set([
            'type',
            'runId',
            'epoch',
            'itemId',
            'claimId',
            'ownerDocumentId',
            'now'
        ]),
        resume_claim: new Set([
            'type',
            'runId',
            'epoch',
            'itemId',
            'claimId',
            'ownerDocumentId',
            'now'
        ])
    };
    const ORIGIN_KEYS = new Set([
        'surface',
        'url',
        'scrollY',
        'pathname',
        'hrefPath',
        'sourceAssetId',
        'sourcePostId',
        'conversationId'
    ]);
    const DESCRIPTOR_KEYS = new Set([
        'version',
        'surface',
        'sourceAssetId',
        'sourcePostId',
        'conversationId',
        'mediaKind',
        'hrefPath',
        'route',
        'initialOrder',
        'beforeAssetId',
        'afterAssetId'
    ]);
    const OPTION_KEYS = new Set([
        'maxRetries',
        'resolution',
        'durationSeconds',
        'goalCount',
        'galleryLimit',
        'videoGoal',
        'generationMode',
        'action',
        'mediaKind',
        'concurrency',
        'capacityTimeoutMs',
        'acceptanceTimeoutMs',
        'claimTimeoutMs'
    ]);
    const RECEIPT_KEYS = new Set([
        'sourceAssetId',
        'sourcePostId',
        'resultAssetId',
        'resultPostId',
        'observedState',
        'observedAt'
    ]);
    const RECEIPT_STATES_BY_OUTCOME = {
        composer_ready: new Set(['composer_ready']),
        submitted: new Set(['submitted', 'submit_dispatched']),
        accepted: new Set(['provider_accepted']),
        completed: new Set(['playable_result'])
    };
    const JOURNAL_KEYS = new Set([
        'schemaVersion',
        'runId',
        'epoch',
        'kind',
        'ownerTabId',
        'ownerDocumentId',
        'status',
        'origin',
        'items',
        'options',
        'claimSequence',
        'retryRound',
        'counts',
        'createdAt',
        'updatedAt',
        'completedAt',
        'cancelledAt',
        'capacityWaitStartedAt',
        'capacityDeadlineAt',
        'goalProgress',
        'completedResultIds',
        'diagnostics'
    ]);
    const ITEM_KEYS = new Set([
        'itemId',
        'descriptor',
        'status',
        'attemptCount',
        'attemptsThisRound',
        'failureCode',
        'receipt',
        'lastClaimId',
        'lastOutcome'
    ]);
    const COUNT_KEYS = new Set(['accepted', 'failed', 'skipped', 'pending']);
    const DIAGNOSTIC_KEYS = new Set(['safeCode', 'lastErrorCode', 'lastTransition']);
    const ACTIVE_CLAIM_KEYS = new Set([
        'claimId',
        'itemId',
        'epoch',
        'ownerDocumentId',
        'claimedAt',
        'expiresAt'
    ]);
    const RUNTIME_KEYS = new Set([...JOURNAL_KEYS, 'prompt', 'activeClaim']);
    const SECRET_KEY_PATTERN = /(?:authorization|cookies?|headers?|api[_-]?key|tokens?|secrets?|password|credentials?|bearer|signature|signed(?:url|uri|media)?|dataurl)/i;
    const UNSAFE_STRING_PATTERN = /(?:^\s*data:|(?:^|\s)bearer\s+\S+|[?&](?:x-amz-[^=&#]*|x-goog-[^=&#]*|signature|sig|token|access_token|expires|policy|key-pair-id|credential)=[^&#\s]*)/i;
    const REMOVED = Symbol('removed');

    function stateError(code) {
        return new Error(code);
    }

    function isPlainObject(value) {
        if (!value || Object.prototype.toString.call(value) !== '[object Object]') return false;
        const prototype = Object.getPrototypeOf(value);
        return prototype === Object.prototype || prototype === null;
    }

    function assertFiniteNumber(value, code = 'INVALID_GENERATION_STATE') {
        if (!Number.isFinite(value)) throw stateError(code);
        return value;
    }

    function assertInteger(value, minimum, maximum, code = 'INVALID_GENERATION_STATE') {
        if (!Number.isInteger(value) || value < minimum || value > maximum) {
            throw stateError(code);
        }
        return value;
    }

    function assertSafeValue(value, seen = new Set(), depth = 0) {
        if (depth > MAX_OBJECT_DEPTH) throw stateError('UNSAFE_GENERATION_STATE');
        if (value === null || typeof value === 'undefined') return;

        if (typeof value === 'string') {
            if (value.length > MAX_STRING_LENGTH || UNSAFE_STRING_PATTERN.test(value)) {
                throw stateError('UNSAFE_GENERATION_STATE');
            }
            return;
        }

        if (typeof value === 'number') {
            if (!Number.isFinite(value)) throw stateError('UNSAFE_GENERATION_STATE');
            return;
        }

        if (typeof value === 'boolean') return;
        if (typeof value !== 'object') throw stateError('UNSAFE_GENERATION_STATE');
        if (seen.has(value)) throw stateError('UNSAFE_GENERATION_STATE');
        seen.add(value);

        if (Array.isArray(value)) {
            value.forEach((entry) => assertSafeValue(entry, seen, depth + 1));
        } else {
            if (!isPlainObject(value)) throw stateError('UNSAFE_GENERATION_STATE');
            Object.entries(value).forEach(([key, entry]) => {
                if (SECRET_KEY_PATTERN.test(key)) throw stateError('UNSAFE_GENERATION_STATE');
                assertSafeValue(entry, seen, depth + 1);
            });
        }

        seen.delete(value);
    }

    function copyAllowlistedObject(value, allowedKeys, code = 'INVALID_GENERATION_STATE') {
        if (!isPlainObject(value)) throw stateError(code);
        assertSafeValue(value);

        const result = {};
        Object.entries(value).forEach(([key, entry]) => {
            if (!allowedKeys.has(key)) throw stateError(code);
            if (Array.isArray(entry)) {
                result[key] = entry.map((item) => item);
            } else if (isPlainObject(entry)) {
                result[key] = { ...entry };
            } else {
                result[key] = entry;
            }
        });
        return result;
    }

    function normalizeOrigin(origin) {
        const normalized = copyAllowlistedObject(origin, ORIGIN_KEYS);
        if (typeof normalized.surface !== 'string' || !normalized.surface) {
            throw stateError('INVALID_GENERATION_STATE');
        }
        if (typeof normalized.url !== 'string' || !normalized.url) {
            throw stateError('INVALID_GENERATION_STATE');
        }
        if ('scrollY' in normalized) {
            assertFiniteNumber(normalized.scrollY);
        }
        return normalized;
    }

    function normalizeDescriptor(descriptor) {
        const normalized = copyAllowlistedObject(descriptor, DESCRIPTOR_KEYS);
        if (typeof normalized.sourceAssetId !== 'string' || !normalized.sourceAssetId) {
            throw stateError('INVALID_GENERATION_STATE');
        }
        if (typeof normalized.sourcePostId !== 'string' || !normalized.sourcePostId) {
            throw stateError('INVALID_GENERATION_STATE');
        }
        if (typeof normalized.conversationId !== 'string') {
            throw stateError('INVALID_GENERATION_STATE');
        }
        return normalized;
    }

    function normalizeOptions(options) {
        const normalized = copyAllowlistedObject(options || {}, OPTION_KEYS);
        const integerRanges = {
            maxRetries: [0, 25],
            durationSeconds: [1, 3600],
            goalCount: [1, MAX_ITEMS],
            galleryLimit: [1, MAX_ITEMS],
            videoGoal: [1, MAX_ITEMS],
            concurrency: [1, 100],
            capacityTimeoutMs: [1, 3600000],
            acceptanceTimeoutMs: [1, 3600000],
            claimTimeoutMs: [1000, 3600000]
        };

        Object.entries(integerRanges).forEach(([key, [minimum, maximum]]) => {
            if (key in normalized) assertInteger(normalized[key], minimum, maximum);
        });
        if (!('maxRetries' in normalized)) normalized.maxRetries = 0;
        if (!('claimTimeoutMs' in normalized)) {
            normalized.claimTimeoutMs = DEFAULT_GENERATION_CLAIM_TIMEOUT_MS;
        }
        if (!('capacityTimeoutMs' in normalized)) {
            normalized.capacityTimeoutMs = DEFAULT_GENERATION_CAPACITY_TIMEOUT_MS;
        }
        return normalized;
    }

    function normalizeReceipt(receipt, required) {
        if (receipt === null || typeof receipt === 'undefined') {
            if (required) throw stateError('INVALID_GENERATION_EVENT');
            return null;
        }
        const normalized = copyAllowlistedObject(receipt, RECEIPT_KEYS, 'INVALID_GENERATION_EVENT');
        if (typeof normalized.sourceAssetId !== 'string' || !normalized.sourceAssetId) {
            throw stateError('INVALID_GENERATION_EVENT');
        }
        if (required && (typeof normalized.sourcePostId !== 'string' || !normalized.sourcePostId)) {
            throw stateError('INVALID_GENERATION_EVENT');
        }
        if (typeof normalized.observedState !== 'string' || !normalized.observedState) {
            throw stateError('INVALID_GENERATION_EVENT');
        }
        assertFiniteNumber(normalized.observedAt, 'INVALID_GENERATION_EVENT');
        return normalized;
    }

    function makeOpaqueId(prefix, now) {
        let entropy = '';
        const cryptoObject = typeof globalThis !== 'undefined' ? globalThis.crypto : null;
        if (cryptoObject && typeof cryptoObject.randomUUID === 'function') {
            entropy = cryptoObject.randomUUID().replace(/-/g, '');
        } else {
            entropy = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
        }
        return `${prefix}_${now}_${entropy}`;
    }

    function calculateCounts(items) {
        return items.reduce((counts, item) => {
            if (item.status === 'accepted') counts.accepted += 1;
            else if (item.status === 'retryable_failed' || item.status === 'permanent_failed') {
                counts.failed += 1;
            } else if (item.status === 'cancelled') counts.skipped += 1;
            else counts.pending += 1;
            return counts;
        }, { accepted: 0, failed: 0, skipped: 0, pending: 0 });
    }

    function createGenerationRun(input) {
        if (!isPlainObject(input)) throw stateError('INVALID_GENERATION_STATE');
        assertSafeValue(input);

        const allowedInputKeys = new Set([
            'kind',
            'ownerTabId',
            'ownerDocumentId',
            'origin',
            'items',
            'prompt',
            'options',
            'now'
        ]);
        Object.keys(input).forEach((key) => {
            if (!allowedInputKeys.has(key)) throw stateError('INVALID_GENERATION_STATE');
        });

        if (!RUN_KINDS.has(input.kind)) throw stateError('INVALID_GENERATION_STATE');
        assertInteger(input.ownerTabId, 0, Number.MAX_SAFE_INTEGER);
        if ('ownerDocumentId' in input
            && (typeof input.ownerDocumentId !== 'string' || !input.ownerDocumentId)) {
            throw stateError('INVALID_GENERATION_STATE');
        }
        const now = assertFiniteNumber(input.now);
        const prompt = typeof input.prompt === 'string' ? input.prompt : '';
        if (prompt.length > MAX_STRING_LENGTH) throw stateError('UNSAFE_GENERATION_STATE');
        if (!Array.isArray(input.items) || input.items.length < 1 || input.items.length > MAX_ITEMS) {
            throw stateError('INVALID_GENERATION_STATE');
        }

        const origin = normalizeOrigin(input.origin);
        const options = normalizeOptions(input.options);
        const descriptors = input.items.map(normalizeDescriptor);
        const descriptorIds = descriptors.map((descriptor) => (
            `${descriptor.sourceAssetId}\u0000${descriptor.sourcePostId}`
        ));
        if (new Set(descriptorIds).size !== descriptorIds.length) {
            throw stateError('INVALID_GENERATION_STATE');
        }
        const runId = makeOpaqueId('generation_run', now);
        const items = descriptors.map((descriptor, index) => ({
            itemId: `${runId}_item_${index + 1}`,
            descriptor,
            status: 'queued',
            attemptCount: 0,
            attemptsThisRound: 0,
            failureCode: '',
            receipt: null,
            lastClaimId: '',
            lastOutcome: ''
        }));

        return {
            schemaVersion: SCHEMA_VERSION,
            runId,
            epoch: 1,
            kind: input.kind,
            ownerTabId: input.ownerTabId,
            ownerDocumentId: input.ownerDocumentId || '',
            status: 'running',
            origin,
            items,
            prompt,
            options,
            activeClaim: null,
            claimSequence: 0,
            retryRound: 0,
            counts: calculateCounts(items),
            createdAt: now,
            updatedAt: now,
            completedAt: 0,
            cancelledAt: 0,
            capacityWaitStartedAt: 0,
            capacityDeadlineAt: 0,
            goalProgress: 0,
            completedResultIds: []
        };
    }

    function assertRuntimeState(state) {
        if (!isPlainObject(state) || state.schemaVersion !== SCHEMA_VERSION) {
            throw stateError('INVALID_GENERATION_STATE');
        }
        if (typeof state.runId !== 'string' || !state.runId) {
            throw stateError('INVALID_GENERATION_STATE');
        }
        if (!RUN_KINDS.has(state.kind) || !RUN_STATUSES.has(state.status)) {
            throw stateError('INVALID_GENERATION_STATE');
        }
        if (!Array.isArray(state.items) || state.items.some((item) => {
            return !isPlainObject(item) || !ITEM_STATUSES.has(item.status);
        })) {
            throw stateError('INVALID_GENERATION_STATE');
        }
    }

    function getNextGenerationClaim(state, claimNow = state?.updatedAt) {
        assertRuntimeState(state);
        assertFiniteNumber(claimNow);
        if (state.status !== 'running' || state.activeClaim) {
            return { state, claim: null };
        }

        const itemIndex = state.items.findIndex((item) => item.status === 'queued');
        if (itemIndex < 0) return { state, claim: null };

        const sequence = state.claimSequence + 1;
        const item = state.items[itemIndex];
        const claimId = `generation_claim_${state.runId}_${state.epoch}_${sequence}`;
        const claimTimeoutMs = state.options.claimTimeoutMs || DEFAULT_GENERATION_CLAIM_TIMEOUT_MS;
        const claim = {
            runId: state.runId,
            epoch: state.epoch,
            claimId,
            itemId: item.itemId,
            kind: state.kind,
            descriptor: { ...item.descriptor },
            prompt: state.prompt,
            options: { ...state.options },
            ownerDocumentId: state.ownerDocumentId,
            claimedAt: claimNow,
            expiresAt: claimNow + claimTimeoutMs
        };
        const items = state.items.map((candidate, index) => index === itemIndex
            ? { ...candidate, status: 'targeting' }
            : candidate);
        const nextState = {
            ...state,
            items,
            activeClaim: {
                claimId,
                itemId: item.itemId,
                epoch: state.epoch,
                ownerDocumentId: state.ownerDocumentId,
                claimedAt: claimNow,
                expiresAt: claimNow + claimTimeoutMs
            },
            claimSequence: sequence,
            updatedAt: claimNow
        };

        return { state: nextState, claim };
    }

    function assertEventShape(event) {
        if (!isPlainObject(event) || !EVENT_KEYS[event.type]) {
            throw stateError('INVALID_GENERATION_EVENT');
        }
        assertSafeValue(event);
        Object.keys(event).forEach((key) => {
            if (!EVENT_KEYS[event.type].has(key)) throw stateError('INVALID_GENERATION_EVENT');
        });
        if (typeof event.runId !== 'string' || !event.runId) {
            throw stateError('INVALID_GENERATION_EVENT');
        }
        assertInteger(event.epoch, 0, Number.MAX_SAFE_INTEGER, 'INVALID_GENERATION_EVENT');
        assertFiniteNumber(event.now, 'INVALID_GENERATION_EVENT');
    }

    function assertRunEventIdentity(state, event) {
        if (event.runId !== state.runId || event.epoch !== state.epoch) {
            throw stateError('STALE_GENERATION_EVENT');
        }
        if (event.now < state.updatedAt) throw stateError('STALE_GENERATION_EVENT');
    }

    function receiptsEqual(left, right) {
        if (left === right) return true;
        if (!left || !right) return false;
        return RECEIPT_KEYS.size > 0 && [...RECEIPT_KEYS].every((key) => left[key] === right[key]);
    }

    function isDuplicateReport(state, event, item, receipt) {
        if (!item || item.lastClaimId !== event.claimId || item.lastOutcome !== event.outcome) {
            return false;
        }
        if (event.epoch !== state.epoch || event.runId !== state.runId) return false;
        if (item.failureCode !== String(event.failureCode || '')) return false;
        return receiptsEqual(item.receipt, receipt);
    }

    function assertReceiptMatchesItem(item, receipt) {
        if (!receipt) return;
        if (receipt.sourceAssetId !== item.descriptor.sourceAssetId) {
            throw stateError('UNRELATED_GENERATION_RESULT');
        }
        if (receipt.sourcePostId !== item.descriptor.sourcePostId) {
            throw stateError('UNRELATED_GENERATION_RESULT');
        }
    }

    function assertReceiptMatchesOutcome(outcome, receipt) {
        const allowedStates = RECEIPT_STATES_BY_OUTCOME[outcome];
        if (allowedStates && !allowedStates.has(receipt?.observedState)) {
            throw stateError('INVALID_GENERATION_EVENT');
        }
    }

    function finalizeAfterReport(state, items, event, requestedStatus = '') {
        const counts = calculateCounts(items);
        let status = requestedStatus || 'running';
        let completedAt = state.completedAt;

        if (!requestedStatus && counts.pending === 0) {
            status = items.some((item) => item.status === 'retryable_failed')
                ? 'retryable_failed'
                : 'completed';
            completedAt = event.now;
        }

        return {
            ...state,
            status,
            items,
            activeClaim: null,
            counts,
            updatedAt: event.now,
            completedAt,
            capacityWaitStartedAt: requestedStatus === 'waiting_capacity' ? event.now : 0,
            capacityDeadlineAt: requestedStatus === 'waiting_capacity'
                ? event.now + (state.options.capacityTimeoutMs || DEFAULT_GENERATION_CAPACITY_TIMEOUT_MS)
                : 0
        };
    }

    function cancelState(state, now) {
        const items = state.items.map((item) => {
            if (item.status === 'accepted' || item.status === 'permanent_failed') return item;
            return {
                ...item,
                status: 'cancelled',
                failureCode: item.failureCode || 'cancelled'
            };
        });
        return {
            ...state,
            epoch: state.epoch + 1,
            status: 'cancelled',
            items,
            activeClaim: null,
            counts: calculateCounts(items),
            updatedAt: now,
            cancelledAt: now,
            capacityWaitStartedAt: 0,
            capacityDeadlineAt: 0
        };
    }

    function reduceReport(state, event) {
        if (!REPORT_OUTCOMES.has(event.outcome)) throw stateError('INVALID_GENERATION_EVENT');
        if (typeof event.itemId !== 'string' || typeof event.claimId !== 'string') {
            throw stateError('INVALID_GENERATION_EVENT');
        }
        if (event.runId !== state.runId || event.epoch !== state.epoch) {
            throw stateError('STALE_GENERATION_CLAIM');
        }

        const itemIndex = state.items.findIndex((item) => item.itemId === event.itemId);
        const item = itemIndex >= 0 ? state.items[itemIndex] : null;
        const activeClaimMatches = Boolean(state.activeClaim
            && state.activeClaim.claimId === event.claimId
            && state.activeClaim.itemId === event.itemId
            && state.activeClaim.epoch === event.epoch
            && item);
        const requiresReceipt = event.outcome === 'composer_ready'
            || event.outcome === 'submitted'
            || event.outcome === 'accepted'
            || event.outcome === 'completed';

        if (!activeClaimMatches) {
            if (item && item.lastClaimId === event.claimId && item.lastOutcome === event.outcome) {
                const duplicateReceipt = normalizeReceipt(event.receipt, requiresReceipt);
                if (isDuplicateReport(state, event, item, duplicateReceipt)) return state;
            }
            throw stateError('STALE_GENERATION_CLAIM');
        }
        const receipt = normalizeReceipt(event.receipt, requiresReceipt);
        if (isDuplicateReport(state, event, item, receipt)) return state;
        if (event.now < state.updatedAt) throw stateError('STALE_GENERATION_CLAIM');
        assertReceiptMatchesItem(item, receipt);
        assertReceiptMatchesOutcome(event.outcome, receipt);
        if (item.status !== 'targeting' && item.status !== 'composer_ready' && item.status !== 'submitted') {
            throw stateError('INVALID_GENERATION_TRANSITION');
        }

        const failureCode = String(event.failureCode || '');
        const acceptedVideoGoalAttempt = state.kind === 'video_goal'
            && item.status === 'submitted'
            && item.lastOutcome === 'accepted';
        const consumesAttempt = !acceptedVideoGoalAttempt && (event.outcome === 'accepted'
            || event.outcome === 'retryable_failed'
            || event.outcome === 'permanent_failed');
        const attemptCount = item.attemptCount + (consumesAttempt ? 1 : 0);
        const attemptsThisRound = item.attemptsThisRound + (consumesAttempt ? 1 : 0);
        let nextItem;
        let requestedStatus = '';

        if (event.outcome === 'composer_ready' || event.outcome === 'submitted') {
            if (event.outcome === 'composer_ready' && item.status !== 'targeting') {
                throw stateError('INVALID_GENERATION_TRANSITION');
            }
            if (event.outcome === 'submitted'
                && item.status !== 'targeting'
                && item.status !== 'composer_ready') {
                throw stateError('INVALID_GENERATION_TRANSITION');
            }
            nextItem = {
                ...item,
                status: event.outcome,
                failureCode: '',
                receipt,
                lastClaimId: event.claimId,
                lastOutcome: event.outcome
            };
            const checkpointItems = state.items.map((candidate, index) => {
                return index === itemIndex ? nextItem : candidate;
            });
            return {
                ...state,
                status: 'running',
                items: checkpointItems,
                counts: calculateCounts(checkpointItems),
                updatedAt: event.now
            };
        }

        if (event.outcome === 'accepted' && state.kind === 'video_goal') {
            nextItem = {
                ...item,
                status: 'submitted',
                attemptCount,
                attemptsThisRound,
                failureCode: '',
                receipt,
                lastClaimId: event.claimId,
                lastOutcome: event.outcome
            };
            const acceptedItems = state.items.map((candidate, index) => {
                return index === itemIndex ? nextItem : candidate;
            });
            return {
                ...state,
                status: 'running',
                items: acceptedItems,
                counts: calculateCounts(acceptedItems),
                updatedAt: event.now
            };
        }

        if (event.outcome === 'completed') {
            if (state.kind !== 'video_goal'
                || item.status !== 'submitted'
                || item.lastOutcome !== 'accepted'
                || item.lastClaimId !== event.claimId) {
                throw stateError('INVALID_GENERATION_TRANSITION');
            }
            if (typeof receipt.resultAssetId !== 'string' || !receipt.resultAssetId) {
                throw stateError('INVALID_GENERATION_EVENT');
            }
            if (state.completedResultIds.includes(receipt.resultAssetId)) {
                throw stateError('STALE_GENERATION_RESULT');
            }

            const goalProgress = state.goalProgress + 1;
            const goalCount = Number.isInteger(state.options.goalCount)
                ? state.options.goalCount
                : 1;
            const reachedGoal = goalProgress >= goalCount;
            nextItem = {
                ...item,
                status: reachedGoal ? 'accepted' : 'queued',
                attemptsThisRound: reachedGoal ? item.attemptsThisRound : 0,
                failureCode: '',
                receipt,
                lastClaimId: event.claimId,
                lastOutcome: event.outcome
            };
            const completedItems = state.items.map((candidate, index) => {
                return index === itemIndex ? nextItem : candidate;
            });
            return {
                ...state,
                status: reachedGoal ? 'completed' : 'running',
                items: completedItems,
                activeClaim: null,
                counts: calculateCounts(completedItems),
                goalProgress,
                completedResultIds: [...state.completedResultIds, receipt.resultAssetId],
                updatedAt: event.now,
                completedAt: reachedGoal ? event.now : 0
            };
        }

        if (event.outcome === 'accepted') {
            nextItem = {
                ...item,
                status: 'accepted',
                attemptCount,
                attemptsThisRound,
                failureCode: '',
                receipt,
                lastClaimId: event.claimId,
                lastOutcome: event.outcome
            };
        } else if (event.outcome === 'capacity') {
            nextItem = {
                ...item,
                status: 'queued',
                failureCode: failureCode || 'provider_capacity',
                lastClaimId: event.claimId,
                lastOutcome: event.outcome
            };
            requestedStatus = 'waiting_capacity';
        } else if (event.outcome === 'retryable_failed') {
            const exhausted = attemptsThisRound > state.options.maxRetries;
            nextItem = {
                ...item,
                status: exhausted ? 'retryable_failed' : 'queued',
                attemptCount,
                attemptsThisRound,
                failureCode,
                receipt: null,
                lastClaimId: event.claimId,
                lastOutcome: event.outcome
            };
        } else if (event.outcome === 'permanent_failed') {
            nextItem = {
                ...item,
                status: 'permanent_failed',
                attemptCount,
                attemptsThisRound,
                failureCode,
                receipt: null,
                lastClaimId: event.claimId,
                lastOutcome: event.outcome
            };
        } else {
            return cancelState(state, event.now);
        }

        const items = state.items.map((candidate, index) => index === itemIndex ? nextItem : candidate);
        return finalizeAfterReport(state, items, event, requestedStatus);
    }

    function reduceGenerationRun(state, event) {
        assertRuntimeState(state);
        assertEventShape(event);

        if (event.type === 'report') return reduceReport(state, event);
        assertRunEventIdentity(state, event);

        if (event.type === 'reclaim' || event.type === 'resume_claim') {
            if (typeof event.itemId !== 'string'
                || typeof event.claimId !== 'string'
                || typeof event.ownerDocumentId !== 'string'
                || !event.ownerDocumentId) {
                throw stateError('INVALID_GENERATION_EVENT');
            }
            if (state.status !== 'running'
                || !state.activeClaim
                || state.activeClaim.itemId !== event.itemId
                || state.activeClaim.claimId !== event.claimId
                || state.activeClaim.epoch !== event.epoch) {
                throw stateError('STALE_GENERATION_CLAIM');
            }
            if (event.ownerDocumentId === state.ownerDocumentId) {
                throw stateError('INVALID_GENERATION_TRANSITION');
            }
            const item = state.items.find((candidate) => candidate.itemId === event.itemId);
            if (!item
                || (item.status !== 'targeting'
                    && item.status !== 'composer_ready'
                    && item.status !== 'submitted')) {
                throw stateError('INVALID_GENERATION_TRANSITION');
            }

            const epoch = state.epoch + 1;
            const claimSequence = state.claimSequence + 1;
            const claimId = `generation_claim_${state.runId}_${epoch}_${claimSequence}`;
            const items = state.items.map((candidate) => {
                if (candidate.itemId !== event.itemId
                    || candidate.lastClaimId !== event.claimId) {
                    return candidate;
                }
                return { ...candidate, lastClaimId: claimId };
            });
            return {
                ...state,
                epoch,
                ownerDocumentId: event.ownerDocumentId,
                items,
                activeClaim: {
                    claimId,
                    itemId: event.itemId,
                    epoch,
                    ownerDocumentId: event.ownerDocumentId,
                    claimedAt: event.now,
                    expiresAt: event.now + (state.options.claimTimeoutMs || DEFAULT_GENERATION_CLAIM_TIMEOUT_MS)
                },
                claimSequence,
                updatedAt: event.now
            };
        }

        if (event.type === 'expire_claim') {
            if (!state.activeClaim || event.now < state.activeClaim.expiresAt) {
                throw stateError('INVALID_GENERATION_TRANSITION');
            }
            const expiredItem = state.items.find((item) => item.itemId === state.activeClaim.itemId);
            if (!expiredItem
                || (expiredItem.status !== 'targeting'
                    && expiredItem.status !== 'composer_ready'
                    && expiredItem.status !== 'submitted')) {
                throw stateError('INVALID_GENERATION_TRANSITION');
            }
            const items = state.items.map((item) => item.itemId === expiredItem.itemId
                ? {
                    ...item,
                    status: 'retryable_failed',
                    attemptCount: item.attemptCount + 1,
                    attemptsThisRound: item.attemptsThisRound + 1,
                    failureCode: 'claim_expired',
                    lastClaimId: state.activeClaim.claimId,
                    lastOutcome: 'retryable_failed'
                }
                : item);
            return finalizeAfterReport(state, items, event);
        }

        if (event.type === 'transfer_owner') {
            if (state.activeClaim
                || !['running', 'waiting_capacity', 'retryable_failed'].includes(state.status)
                || typeof event.ownerDocumentId !== 'string'
                || !event.ownerDocumentId
                || event.ownerDocumentId === state.ownerDocumentId) {
                throw stateError('INVALID_GENERATION_TRANSITION');
            }
            return {
                ...state,
                epoch: state.epoch + 1,
                ownerDocumentId: event.ownerDocumentId,
                updatedAt: event.now
            };
        }

        if (event.type === 'capacity_timeout') {
            if (state.status !== 'waiting_capacity'
                || state.activeClaim
                || !state.capacityDeadlineAt
                || event.now < state.capacityDeadlineAt) {
                throw stateError('INVALID_GENERATION_TRANSITION');
            }
            let timedOut = false;
            const items = state.items.map((item) => {
                if (timedOut || item.status !== 'queued' || item.failureCode !== 'provider_capacity') {
                    return item;
                }
                timedOut = true;
                return {
                    ...item,
                    status: 'retryable_failed',
                    failureCode: 'capacity_timeout',
                    lastOutcome: 'retryable_failed'
                };
            });
            if (!timedOut) throw stateError('INVALID_GENERATION_TRANSITION');
            return finalizeAfterReport(state, items, event);
        }

        if (event.type === 'capacity_available') {
            if (state.status !== 'waiting_capacity' || state.activeClaim) {
                throw stateError('INVALID_GENERATION_TRANSITION');
            }
            const items = state.items.map((item) => item.status === 'queued'
                && item.failureCode === 'provider_capacity'
                ? { ...item, failureCode: '' }
                : item);
            return {
                ...state,
                status: 'running',
                items,
                updatedAt: event.now,
                capacityWaitStartedAt: 0,
                capacityDeadlineAt: 0
            };
        }

        if (event.type === 'retry_failed') {
            if (state.status !== 'retryable_failed' || state.activeClaim) {
                throw stateError('INVALID_GENERATION_TRANSITION');
            }
            let retriedCount = 0;
            const items = state.items.map((item) => {
                if (item.status !== 'retryable_failed') return item;
                retriedCount += 1;
                return {
                    ...item,
                    status: 'queued',
                    attemptsThisRound: 0,
                    failureCode: '',
                    receipt: null,
                    lastClaimId: '',
                    lastOutcome: ''
                };
            });
            if (retriedCount === 0) throw stateError('INVALID_GENERATION_TRANSITION');
            return {
                ...state,
                epoch: state.epoch + 1,
                status: 'running',
                items,
                activeClaim: null,
                retryRound: state.retryRound + 1,
                counts: calculateCounts(items),
                updatedAt: event.now,
                completedAt: 0
            };
        }

        if (event.type === 'cancel') {
            if (state.status === 'cancelled' || state.status === 'completed') {
                throw stateError('INVALID_GENERATION_TRANSITION');
            }
            return cancelState(state, event.now);
        }

        throw stateError('INVALID_GENERATION_EVENT');
    }

    function sanitizeScalar(value) {
        if (typeof value === 'string') {
            if (value.length > MAX_STRING_LENGTH || UNSAFE_STRING_PATTERN.test(value)) return REMOVED;
            return value;
        }
        if (typeof value === 'number') return Number.isFinite(value) ? value : REMOVED;
        if (typeof value === 'boolean' || value === null) return value;
        return REMOVED;
    }

    function sanitizeObject(value, allowedKeys, depth = 0) {
        if (!isPlainObject(value) || depth > MAX_OBJECT_DEPTH) return {};
        const result = {};
        Object.entries(value).forEach(([key, entry]) => {
            if (!allowedKeys.has(key) || SECRET_KEY_PATTERN.test(key)) return;
            let sanitized = REMOVED;
            if (Array.isArray(entry)) {
                sanitized = entry.map((item) => sanitizeScalar(item)).filter((item) => item !== REMOVED);
            } else if (isPlainObject(entry)) {
                sanitized = sanitizeGenericObject(entry, depth + 1);
            } else {
                sanitized = sanitizeScalar(entry);
            }
            if (sanitized !== REMOVED) result[key] = sanitized;
        });
        return result;
    }

    function sanitizeGenericObject(value, depth = 0) {
        if (!isPlainObject(value) || depth > MAX_OBJECT_DEPTH) return {};
        const result = {};
        Object.entries(value).forEach(([key, entry]) => {
            if (SECRET_KEY_PATTERN.test(key)) return;
            let sanitized = REMOVED;
            if (Array.isArray(entry)) {
                sanitized = entry.map((item) => {
                    if (isPlainObject(item)) return sanitizeGenericObject(item, depth + 1);
                    return sanitizeScalar(item);
                }).filter((item) => item !== REMOVED);
            } else if (isPlainObject(entry)) {
                sanitized = sanitizeGenericObject(entry, depth + 1);
            } else {
                sanitized = sanitizeScalar(entry);
            }
            if (sanitized !== REMOVED) result[key] = sanitized;
        });
        return result;
    }

    function sanitizeItem(item) {
        const sanitized = sanitizeObject(item, ITEM_KEYS);
        sanitized.descriptor = sanitizeObject(item && item.descriptor, DESCRIPTOR_KEYS);
        sanitized.receipt = item && item.receipt
            ? sanitizeObject(item.receipt, RECEIPT_KEYS)
            : null;
        return sanitized;
    }

    function sanitizeGenerationRun(state) {
        if (!isPlainObject(state)) throw stateError('INVALID_GENERATION_STATE');
        const sanitized = sanitizeObject(state, JOURNAL_KEYS);
        sanitized.origin = sanitizeObject(state.origin, ORIGIN_KEYS);
        sanitized.options = sanitizeObject(state.options, OPTION_KEYS);
        sanitized.items = Array.isArray(state.items) ? state.items.map(sanitizeItem) : [];
        sanitized.counts = sanitizeObject(state.counts, COUNT_KEYS);
        if (state.diagnostics) {
            sanitized.diagnostics = sanitizeObject(state.diagnostics, DIAGNOSTIC_KEYS);
        }
        return sanitized;
    }

    function validateGenerationRun(state) {
        assertRuntimeState(state);
        assertSafeValue(state);
        Object.keys(state).forEach((key) => {
            if (!RUNTIME_KEYS.has(key)) throw stateError('INVALID_GENERATION_STATE');
        });
        if (!Number.isInteger(state.epoch) || state.epoch < 1) {
            throw stateError('INVALID_GENERATION_STATE');
        }
        if (!Number.isInteger(state.ownerTabId) || state.ownerTabId < 0) {
            throw stateError('INVALID_GENERATION_STATE');
        }
        if (typeof state.ownerDocumentId !== 'string' || typeof state.prompt !== 'string') {
            throw stateError('INVALID_GENERATION_STATE');
        }
        if (state.prompt.length > MAX_STRING_LENGTH) throw stateError('UNSAFE_GENERATION_STATE');
        if (!isPlainObject(state.origin)
            || !isPlainObject(state.options)
            || !isPlainObject(state.counts)) {
            throw stateError('INVALID_GENERATION_STATE');
        }
        normalizeOrigin(state.origin);
        normalizeOptions(state.options);
        const counts = copyAllowlistedObject(state.counts, COUNT_KEYS);
        Object.values(counts).forEach((value) => {
            assertInteger(value, 0, MAX_ITEMS);
        });
        [
            state.claimSequence,
            state.retryRound,
            state.goalProgress
        ].forEach((value) => assertInteger(value, 0, Number.MAX_SAFE_INTEGER));
        [
            state.createdAt,
            state.updatedAt,
            state.completedAt,
            state.cancelledAt,
            state.capacityWaitStartedAt,
            state.capacityDeadlineAt
        ].forEach((value) => assertFiniteNumber(value));
        if (state.updatedAt < state.createdAt) throw stateError('INVALID_GENERATION_STATE');
        if (!Array.isArray(state.completedResultIds)
            || state.completedResultIds.length > MAX_ITEMS
            || state.completedResultIds.some((value) => typeof value !== 'string' || !value)
            || new Set(state.completedResultIds).size !== state.completedResultIds.length
            || state.goalProgress !== state.completedResultIds.length) {
            throw stateError('INVALID_GENERATION_STATE');
        }

        if (state.items.length < 1 || state.items.length > MAX_ITEMS) {
            throw stateError('INVALID_GENERATION_STATE');
        }
        const itemIds = new Set();
        const descriptorIds = new Set();
        state.items.forEach((item) => {
            copyAllowlistedObject(item, ITEM_KEYS);
            if (typeof item.itemId !== 'string' || !item.itemId || itemIds.has(item.itemId)) {
                throw stateError('INVALID_GENERATION_STATE');
            }
            itemIds.add(item.itemId);
            if (!isPlainObject(item.descriptor)) throw stateError('INVALID_GENERATION_STATE');
            const descriptor = normalizeDescriptor(item.descriptor);
            const descriptorId = `${descriptor.sourceAssetId}\u0000${descriptor.sourcePostId}`;
            if (descriptorIds.has(descriptorId)) throw stateError('INVALID_GENERATION_STATE');
            descriptorIds.add(descriptorId);
            assertInteger(item.attemptCount, 0, Number.MAX_SAFE_INTEGER);
            assertInteger(item.attemptsThisRound, 0, Number.MAX_SAFE_INTEGER);
            if (typeof item.failureCode !== 'string'
                || typeof item.lastClaimId !== 'string'
                || typeof item.lastOutcome !== 'string') {
                throw stateError('INVALID_GENERATION_STATE');
            }
            if (item.receipt) {
                const receipt = normalizeReceipt(item.receipt, false);
                assertReceiptMatchesItem(item, receipt);
                assertReceiptMatchesOutcome(item.lastOutcome, receipt);
            }
        });
        const calculatedCounts = calculateCounts(state.items);
        if ([...COUNT_KEYS].some((key) => counts[key] !== calculatedCounts[key])) {
            throw stateError('INVALID_GENERATION_STATE');
        }

        if (state.activeClaim !== null) {
            const activeClaim = copyAllowlistedObject(state.activeClaim, ACTIVE_CLAIM_KEYS);
            if (typeof activeClaim.claimId !== 'string'
                || !activeClaim.claimId
                || typeof activeClaim.itemId !== 'string'
                || !itemIds.has(activeClaim.itemId)
                || typeof activeClaim.ownerDocumentId !== 'string'
                || activeClaim.epoch !== state.epoch) {
                throw stateError('INVALID_GENERATION_STATE');
            }
            assertFiniteNumber(activeClaim.claimedAt);
            assertFiniteNumber(activeClaim.expiresAt);
            if (activeClaim.expiresAt <= activeClaim.claimedAt) {
                throw stateError('INVALID_GENERATION_STATE');
            }
            const claimedItem = state.items.find((item) => item.itemId === activeClaim.itemId);
            if (state.status !== 'running'
                || !['targeting', 'composer_ready', 'submitted'].includes(claimedItem.status)) {
                throw stateError('INVALID_GENERATION_STATE');
            }
        } else if (state.items.some((item) => ['targeting', 'composer_ready', 'submitted'].includes(item.status))) {
            throw stateError('INVALID_GENERATION_STATE');
        }
        if (state.diagnostics) copyAllowlistedObject(state.diagnostics, DIAGNOSTIC_KEYS);
        if (state.status === 'waiting_capacity') {
            if (state.capacityWaitStartedAt <= 0
                || state.capacityDeadlineAt <= state.capacityWaitStartedAt) {
                throw stateError('INVALID_GENERATION_STATE');
            }
        } else if (state.capacityWaitStartedAt !== 0 || state.capacityDeadlineAt !== 0) {
            throw stateError('INVALID_GENERATION_STATE');
        }
        if ((state.status === 'completed' || state.status === 'cancelled') && counts.pending !== 0) {
            throw stateError('INVALID_GENERATION_STATE');
        }
        return true;
    }

    return {
        DEFAULT_GENERATION_CAPACITY_TIMEOUT_MS,
        DEFAULT_GENERATION_CLAIM_TIMEOUT_MS,
        createGenerationRun,
        getNextGenerationClaim,
        reduceGenerationRun,
        sanitizeGenerationRun,
        validateGenerationRun
    };
});
