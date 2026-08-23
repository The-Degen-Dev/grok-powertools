# Grok Extension Recovery And Live Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore Prompted Batch, Start Sync, Dual-write durability, cancellation, and full production R2 backup, then prove each workflow with deterministic tests and redacted live evidence from the existing logged-in Chrome session.

**Architecture:** Keep Prompted Batch and Saved sync as separate controllers, but strengthen their shared receipt, authority, and durability contracts with small pure helpers. The content script owns surface transitions and conservative gallery traversal; the service worker owns processed-ID persistence, download and R2 durability, and run-authorized queue state. Standalone acceptance helpers independently enumerate Saved identities, reconcile them against paginated Vault inventory, and fail the release gate unless every required lane has direct evidence.

**Tech Stack:** Chrome Extension Manifest V3, raw JavaScript content script and service worker, Jest, Playwright, Cloudflare Worker, R2, D1, Node.js 24, existing acceptance scripts, existing logged-in Chrome.

**Spec:** `docs/superpowers/specs/2026-08-16-grok-extension-recovery-live-validation-design.md`

## Global Constraints

- Work only on `codex/grok-extension-recovery`; never switch to, edit, push, or merge `main`.
- Update existing draft PR 11 only after every required release lane passes; do not create another PR, mark it ready, or merge it.
- Preserve the current dirty runtime patch in `background.js`, `content.js`, `tests/e2e/extension.spec.js`, `tests/unit/backgroundRecreateWorkflow.test.js`, `tests/unit/grokScraperNavigation.test.js`, and `tests/unit/retryManager.test.js`; capture it before further runtime edits and never reset or stash it.
- Leave the untracked `None` file and `docs/superpowers/plans/2026-08-11-grok-imagine-2-compatibility-recovery.md` untouched.
- Scope is the Chrome extension and its existing acceptance support only; do not change the web app or Vault UI.
- Use the existing logged-in Chrome session only. Never enumerate Chrome tabs, call DevTools `list_pages`, loop across windows or tabs, capture a full Chrome accessibility tree, or start a detached Chrome profile.
- Operate on the visible target Chrome window and direct known URLs only. Use built-in Browser and Computer Use first; use Peekaboo only for a narrow native action they cannot perform.
- Before every live lane, check for active generation, backup, sync, upload, download, cloud queue, and resource-intensive work.
- Never reset, remove, rewrite, export, or replace canonical processed IDs.
- Never print, copy, replace, or commit API keys, cookies, OAuth data, bearer tokens, signed URLs, Worker secrets, or environment values.
- Do not change production R2 or D1 bindings, bucket configuration, Worker secrets, OAuth configuration, or existing cloud objects manually.
- Do not mark a media identity processed until every outcome required by the active mode is durable.
- Stop on ambiguous source identity, surface, control, submission, transfer, gallery return, or exhaustion evidence.
- Preserve and restore every popup, cloud, download-folder, and Grok video setting changed during validation.
- A skipped, blocked, inferred, or unlaunched lane is not a pass.
- On any live failure: stop the active workflow, preserve the visible page, record narrow redacted evidence, reproduce the smallest case, add a failing regression test, make the smallest code correction, rerun deterministic gates, rerun the failed lane, and rerun dependent lanes.
- Pure Local-only behavior remains deterministic-test-only because Local-only and Cloud-only share `processedIds`; the live local-plus-cloud proof uses Dual-write.
- Full production R2 Backup is explicitly approved, but it may begin only after the isolated acceptance and bounded live lanes pass.

---

## File Responsibility Map

### Runtime files

- Modify `content.js`: versioned Saved/results receipts, conservative scan ledger, run-durability polling, Prompted Batch return proof, R2-presence preflight, Saved traversal, and completion status.
- Modify `background.js`: mode-aware processed-ID persistence, paginated Vault inventory and HEAD verification, run-owned durability snapshots, queue/download failure classification, and runtime message routing.
- Leave `popup.js` behavior unchanged unless a failing test proves its current start/status contract is wrong. Existing start routes are `START_SCRAPE` and `START_R2_BACKUP`.

### Deterministic tests

- Modify `tests/unit/retryManager.test.js`: Prompted Batch receipt capture, same-gallery return, replacement, insertion, ambiguity, cancellation, and five-item progression.
- Modify `tests/unit/grokScraperNavigation.test.js`: Saved receipts, scan ledger, durability messages, processed-ID timing, queue drain, Stop/reload, and virtualized traversal.
- Modify `tests/unit/backgroundRecreateWorkflow.test.js`: native Prompted Batch click dispatch and accepted-submission behavior already present in the dirty patch.
- Modify `tests/e2e/extension.spec.js`: five-result Prompted Batch and thirty-item Saved traversal across virtualization with images and videos.
- Create `tests/unit/extensionRecoveryEvidence.test.js`: required-lane release gate and redaction.
- Create `tests/unit/savedGalleryEvidenceObserver.test.js`: independent observer behavior.
- Create `tests/unit/savedVaultReconciliation.test.js`: paginated inventory reconciliation and canonical identity normalization.

### Acceptance support

- Create `acceptance/lib/extension-recovery-evidence.js`: typed-by-contract lane schema, redaction, atomic lane merge, and final release verdict.
- Create `acceptance/browser/saved-gallery-observer.js`: standalone read-only Saved identity observer with its own bounded bottom proof.
- Create `acceptance/lib/saved-vault-reconciliation.js`: normalize UUID identities and compare Saved evidence with Worker inventory.
- Create `acceptance/scripts/start-extension-recovery-run.mjs`: capture Git/source baseline and the dirty patch into ignored run artifacts without reading secrets.
- Create `acceptance/scripts/record-extension-recovery-lane.mjs`: validate and atomically merge one redacted lane record.
- Create `acceptance/scripts/reconcile-production-vault.mjs`: paginate the authenticated inventory endpoint, reconcile observer evidence, and write only redacted results.
- Reuse `acceptance/lib/run-contract.js`, `acceptance/lib/preflight.js`, `acceptance/scripts/preflight.mjs`, `acceptance/scripts/run-live-canary.mjs`, and `acceptance/scripts/write-cloudflare-acceptance-config.mjs`; do not add another acceptance environment.

### Interfaces shared across tasks

```js
// content.js
captureGalleryReceipt({ identities, sourceIdentity, origin, scrollTop })
// -> GalleryReceiptV3 | null

evaluateGalleryReceipt({ identities, receipt, currentOrigin, allowSourceReplacement })
// -> { status: 'matched' | 'ambiguous' | 'different', reason: string }

resolveBackupScrollAttempt({
    before,
    after,
    beforeSignature,
    afterSignature,
    newIdentityCount,
    loading,
    transferPending,
    stableBottomRounds,
    lastNewIdentityAt,
    now,
    requiredStableBottomRounds,
    minimumStableBottomMs
})
// -> { progressed, atBottom, stableBottomRounds, exhausted, reason }

// background.js runtime request
{
    action: 'GET_SCRAPE_DURABILITY',
    runToken: string,
    runEpoch: number,
    kind: 'sync' | 'r2_backup'
}
// -> ScrapeDurabilitySnapshot

// background.js runtime request
{
    action: 'R2_BACKUP_CHECK_PRESENT',
    runToken: string,
    runEpoch: number,
    kind: 'r2_backup',
    url: string,
    isVideo: boolean
}
// -> { status: 'already_present' | 'missing' | 'error' | 'ignored', assetId?, objectKey?, bytes?, contentType?, sha256? }

// acceptance/lib/extension-recovery-evidence.js
upsertExtensionRecoveryLane(workbook, lane)
evaluateExtensionRecoveryReleaseGate(workbook)

// acceptance/lib/saved-vault-reconciliation.js
reconcileSavedVaultInventory({ savedIdentities, inventoryItems })
```

---

### Task 1: Recovery Evidence Contract And Baseline Capture

**Files:**
- Create: `acceptance/lib/extension-recovery-evidence.js`
- Create: `acceptance/scripts/start-extension-recovery-run.mjs`
- Create: `acceptance/scripts/record-extension-recovery-lane.mjs`
- Create: `tests/unit/extensionRecoveryEvidence.test.js`
- Reuse: `acceptance/lib/run-contract.js`

**Interfaces:**
- Consumes: `redactEvidence(value)` from `acceptance/lib/run-contract.js`.
- Produces: `REQUIRED_EXTENSION_RECOVERY_LANES`, `normalizeExtensionRecoveryLane(lane)`, `upsertExtensionRecoveryLane(workbook, lane)`, and `evaluateExtensionRecoveryReleaseGate(workbook)`.
- Produces ignored artifacts at `acceptance/runs/$ACCEPTANCE_RUN_ID/extension-recovery.json` and `acceptance/runs/$ACCEPTANCE_RUN_ID/baseline.patch`.

- [ ] **Step 1: Write the failing evidence-contract tests**

```js
const {
    REQUIRED_EXTENSION_RECOVERY_LANES,
    upsertExtensionRecoveryLane,
    evaluateExtensionRecoveryReleaseGate
} = require('../../acceptance/lib/extension-recovery-evidence.js');

test('requires direct pass evidence for every release lane', () => {
    let workbook = { schemaVersion: 1, runId: 'ext-20260816-001', lanes: {} };
    for (const laneId of REQUIRED_EXTENSION_RECOVERY_LANES) {
        workbook = upsertExtensionRecoveryLane(workbook, {
            laneId,
            status: laneId === 'dual-write-sync' ? 'not_run' : 'passed',
            evidence: { count: 1 }
        });
    }
    expect(evaluateExtensionRecoveryReleaseGate(workbook)).toEqual({
        verdict: 'inconclusive',
        missingLanes: ['dual-write-sync'],
        failedLanes: [],
        blockedLanes: []
    });
});

test('redacts secrets and private URLs before storing a lane', () => {
    const workbook = upsertExtensionRecoveryLane(
        { schemaVersion: 1, runId: 'ext-20260816-001', lanes: {} },
        {
            laneId: 'acceptance-cloud',
            status: 'passed',
            evidence: {
                apiKey: 'must-not-survive',
                signedUrl: 'https://bucket.example/x?Signature=must-not-survive',
                identitySuffixes: ['...a1b2c3d4']
            }
        }
    );
    expect(JSON.stringify(workbook)).not.toContain('must-not-survive');
    expect(workbook.lanes['acceptance-cloud'].evidence.identitySuffixes).toEqual(['...a1b2c3d4']);
});
```

- [ ] **Step 2: Run the focused test and verify the missing module failure**

Run: `npm run test:unit -- --runInBand tests/unit/extensionRecoveryEvidence.test.js`

Expected: FAIL because `acceptance/lib/extension-recovery-evidence.js` does not exist.

- [ ] **Step 3: Add the lane schema, atomic merge helper, and gate evaluator**

```js
const { redactEvidence } = require('./run-contract.js');

const REQUIRED_EXTENSION_RECOVERY_LANES = Object.freeze([
    'environment-and-state',
    'deterministic',
    'acceptance-cloud',
    'prompted-batch',
    'cloud-only-sync',
    'dual-write-sync',
    'stop-reload',
    'full-production-backup',
    'state-restoration'
]);
const LANE_STATUSES = new Set(['passed', 'failed', 'blocked', 'not_run', 'in_progress']);

function normalizeExtensionRecoveryLane(lane) {
    if (!REQUIRED_EXTENSION_RECOVERY_LANES.includes(lane?.laneId)) {
        throw new Error('Unknown extension recovery lane');
    }
    if (!LANE_STATUSES.has(lane.status)) throw new Error('Invalid extension recovery lane status');
    return redactEvidence({
        laneId: lane.laneId,
        status: lane.status,
        recordedAt: lane.recordedAt || new Date().toISOString(),
        evidence: lane.evidence || {}
    });
}

function upsertExtensionRecoveryLane(workbook, lane) {
    const normalized = normalizeExtensionRecoveryLane(lane);
    return redactEvidence({
        ...workbook,
        schemaVersion: 1,
        lanes: { ...(workbook.lanes || {}), [normalized.laneId]: normalized }
    });
}

function evaluateExtensionRecoveryReleaseGate(workbook) {
    const failedLanes = [];
    const blockedLanes = [];
    const missingLanes = [];
    for (const laneId of REQUIRED_EXTENSION_RECOVERY_LANES) {
        const status = workbook?.lanes?.[laneId]?.status || 'not_run';
        if (status === 'failed') failedLanes.push(laneId);
        else if (status === 'blocked') blockedLanes.push(laneId);
        else if (status !== 'passed') missingLanes.push(laneId);
    }
    const verdict = failedLanes.length
        ? 'failed'
        : blockedLanes.length
            ? 'blocked'
            : missingLanes.length ? 'inconclusive' : 'verified';
    return { verdict, missingLanes, failedLanes, blockedLanes };
}
```

Export all four symbols. Keep the module CommonJS to match the existing Jest and acceptance libraries.

- [ ] **Step 4: Add the two Node 24 CLI scripts**

`start-extension-recovery-run.mjs` must:

1. Require `ACCEPTANCE_RUN_ID` matching `^[a-z0-9][a-z0-9-]{5,80}$`.
2. Refuse to overwrite an existing run directory.
3. Read branch, HEAD, upstream, `git status --short`, `manifest.json` version, and the absolute repo path.
4. Hash the repo path and tracked diff with SHA-256.
5. Write the exact current tracked diff to `baseline.patch` using `git diff --binary` output.
6. Record only filenames for dirty and untracked files, never their contents beyond the patch.
7. Initialize every required lane as `not_run`, then set `environment-and-state` to `in_progress`.
8. Write JSON with `fs.writeFileSync(tempPath)` followed by `fs.renameSync(tempPath, finalPath)`.

`record-extension-recovery-lane.mjs` must accept:

```text
node acceptance/scripts/record-extension-recovery-lane.mjs \
  --run-id "$ACCEPTANCE_RUN_ID" \
  --lane "$LANE_ID" \
  --status passed|failed|blocked|not_run|in_progress \
  --evidence "$EVIDENCE_JSON"
```

It must parse the evidence JSON, call `upsertExtensionRecoveryLane`, recompute the release gate, redact before persistence, write atomically, and print only the lane ID, status, and gate verdict.

- [ ] **Step 5: Run focused tests and exercise the CLIs in a temporary run directory**

Run:

```bash
npm run test:unit -- --runInBand tests/unit/extensionRecoveryEvidence.test.js
ACCEPTANCE_RUN_ID=plan-smoke-20260816 mise exec node@24 -- node acceptance/scripts/start-extension-recovery-run.mjs
```

Expected: tests PASS; the script creates ignored `acceptance/runs/plan-smoke-20260816/` with a redacted workbook and exact baseline patch. Remove only this synthetic smoke directory after checking it. Do not remove any pre-existing run directory.

- [ ] **Step 6: Start the real recovery record before any runtime edit**

Run:

```bash
export ACCEPTANCE_RUN_ID="extension-recovery-$(date +%Y%m%d-%H%M%S)"
mise exec node@24 -- node acceptance/scripts/start-extension-recovery-run.mjs
shasum -a 256 "acceptance/runs/$ACCEPTANCE_RUN_ID/baseline.patch"
git status --short --branch
```

Expected: the tracked dirty file list is exactly the six approved runtime/test files, the two protected untracked files remain present, and the baseline patch checksum matches the workbook.

- [ ] **Step 7: Commit only the evidence support**

```bash
git add acceptance/lib/extension-recovery-evidence.js acceptance/scripts/start-extension-recovery-run.mjs acceptance/scripts/record-extension-recovery-lane.mjs tests/unit/extensionRecoveryEvidence.test.js
git diff --cached --check
git commit -m "test(acceptance): add extension recovery evidence gate"
```

Expected: the existing six dirty runtime/test files remain unstaged.

---

### Task 2: Versioned Gallery Receipts For Prompted Batch And Saved Return

**Files:**
- Modify: `content.js:530-711`
- Modify: `content.js:3970-4280`
- Modify: `content.js:4550-4915`
- Modify: `tests/unit/retryManager.test.js:469-790`
- Modify: `tests/unit/grokScraperNavigation.test.js:680-890`
- Modify: `tests/unit/backgroundRecreateWorkflow.test.js`
- Modify: `tests/e2e/extension.spec.js:2132-2290`

**Interfaces:**
- Consumes: `getGrokMediaIdentity(value)`, `getSavedGalleryContext(root)`, and existing run-authority checks.
- Produces: `GALLERY_RECEIPT_VERSION = 3`, `captureGalleryReceipt(...)`, `evaluateGalleryReceipt(...)`, and V3 Saved/results receipts.
- Preserves: current native Prompted Batch click dispatch and same-conversation changed-post acceptance from the dirty patch.

- [ ] **Step 1: Add failing pure receipt tests**

Add tests with fixed UUIDs proving all of these cases:

```js
expect(evaluateGalleryReceipt({
    identities: [before1, before2, source, next, after2],
    receipt,
    currentOrigin: { pathname: '/imagine', conversationId: 'conv-a', scope: 'results' },
    allowSourceReplacement: true
})).toMatchObject({ status: 'matched' });

expect(evaluateGalleryReceipt({
    identities: [before1, before2, generatedVideo, next, after2],
    receipt,
    currentOrigin: { pathname: '/imagine', conversationId: 'conv-a', scope: 'results' },
    allowSourceReplacement: true
})).toMatchObject({ status: 'matched', reason: 'source_replaced_with_stable_anchors' });

expect(evaluateGalleryReceipt({
    identities: [unrelated1, next, unrelated2],
    receipt,
    currentOrigin: { pathname: '/imagine', conversationId: 'conv-a', scope: 'results' },
    allowSourceReplacement: true
})).toMatchObject({ status: 'ambiguous' });

expect(evaluateGalleryReceipt({
    identities: [before1, before2, source, next, after2],
    receipt,
    currentOrigin: { pathname: '/imagine', conversationId: 'conv-b', scope: 'results' },
    allowSourceReplacement: true
})).toMatchObject({ status: 'different', reason: 'origin_mismatch' });
```

Add Saved-specific assertions that source replacement is rejected, duplicate source identity is ambiguous, expected-next order is enforced, and a V2 receipt is rejected rather than silently upgraded.

- [ ] **Step 2: Run the two focused suites and verify contract failures**

Run:

```bash
npm run test:unit -- --runInBand tests/unit/retryManager.test.js tests/unit/grokScraperNavigation.test.js
```

Expected: FAIL because the V3 helper and anchor requirements do not exist and current matching accepts weak neighborhoods.

- [ ] **Step 3: Add the shared V3 receipt helpers near the existing Saved helpers**

```js
const GALLERY_RECEIPT_VERSION = 3;

function captureGalleryReceipt({ identities, sourceIdentity, origin, scrollTop = 0 }) {
    const normalized = identities.map(getGrokMediaIdentity).filter(Boolean);
    const source = getGrokMediaIdentity(sourceIdentity);
    const sourceIndexes = normalized.flatMap((value, index) => value === source ? [index] : []);
    if (!source || sourceIndexes.length !== 1) return null;
    const index = sourceIndexes[0];
    return {
        version: GALLERY_RECEIPT_VERSION,
        sourceIdentity: source,
        expectedNextIdentity: normalized[index + 1] || null,
        beforeIdentities: normalized.slice(Math.max(0, index - 2), index),
        afterIdentities: normalized.slice(index + 1, index + 3),
        visibleIdentities: normalized.slice(0, 16),
        origin: {
            pathname: String(origin?.pathname || ''),
            conversationId: String(origin?.conversationId || ''),
            scope: String(origin?.scope || '')
        },
        scrollTop: Math.max(0, Number(scrollTop) || 0)
    };
}
```

`evaluateGalleryReceipt` must:

1. Reject a non-V3 receipt as `different/receipt_version`.
2. Require exact pathname, scope, and conversation ID when the receipt captured one.
3. Reject duplicate current identities used as source or anchors.
4. When the source exists, require it once, require the expected next identity immediately after it when present, and require up to two captured neighbors that remain visible to preserve original order.
5. When the source is absent and replacement is allowed, require at least two unique captured neighbor anchors in original order; one familiar identity or a matching page title is `ambiguous`.
6. Return only `matched`, `ambiguous`, or `different` with a stable reason string.

- [ ] **Step 4: Route both receipt controllers through the shared helper**

For Saved:

```js
const receipt = captureGalleryReceipt({
    identities: context.entries.map((entry) => entry.sourceIdentity),
    sourceIdentity: normalizedSource,
    origin: {
        pathname: window.location.pathname,
        conversationId: new URLSearchParams(window.location.search).get('conversation') || '',
        scope: SAVED_GALLERY_SCOPES.all
    },
    scrollTop: getSavedScrollerSnapshot(context.scroller || fallbackScroller).scrollTop
});
```

Call `evaluateGalleryReceipt(..., allowSourceReplacement: false)` from capture validation, restore polling, and Stop return restoration.

For generated results, replace `_hasOrderedResultsNeighborhood` internals with `evaluateGalleryReceipt(..., allowSourceReplacement: true)`. Keep the method as a thin adapter so current call sites and tests remain stable. Do not use page title as gallery proof.

- [ ] **Step 5: Preserve and tighten current Prompted Batch native-action behavior**

Retain the dirty patch that selects visible `Make Video`, chooses `Add Prompt`, scopes the composer, dispatches the native click, accepts only a same-conversation changed post or a bound UI acceptance signal, and returns before advancing. Add an assertion that `Precise Edit` receives zero clicks in every generated-results test.

- [ ] **Step 6: Run unit, E2E, syntax, and diff checks**

Run:

```bash
npm run test:unit -- --runInBand tests/unit/retryManager.test.js tests/unit/grokScraperNavigation.test.js tests/unit/backgroundRecreateWorkflow.test.js
npm run test:e2e -- --grep "Prompted Batch"
node --check content.js
node --check background.js
git diff --check
```

Expected: all focused checks PASS, unrelated route changes are rejected, inserted generated videos do not break a valid return, and weak single-anchor returns stop.

- [ ] **Step 7: Commit the recovered Prompted Batch baseline and receipt contract**

Review the baseline patch first. Stage only the six approved dirty files and only after confirming every hunk belongs to Prompted Batch, Saved sync, or their tests.

```bash
git diff -- background.js content.js tests/e2e/extension.spec.js tests/unit/backgroundRecreateWorkflow.test.js tests/unit/grokScraperNavigation.test.js tests/unit/retryManager.test.js
git add background.js content.js tests/e2e/extension.spec.js tests/unit/backgroundRecreateWorkflow.test.js tests/unit/grokScraperNavigation.test.js tests/unit/retryManager.test.js
git diff --cached --check
git commit -m "fix(extension): restore trusted gallery workflow receipts"
```

Expected: `None` and the protected August 11 plan remain untracked and untouched.

---

### Task 3: Dual-write Processed-ID Durability

**Files:**
- Modify: `background.js:3902-4170`
- Modify: `tests/unit/grokScraperNavigation.test.js:3900-4350`

**Interfaces:**
- Consumes: pending download operations with `allowLocal`, `cloudRequired`, `downloadState`, `r2State`, `localIdentityPersisted`, and `scrapeLease`.
- Produces: the invariant that Dual-write persists an ID only in `finalizeDownloadOperation` after `downloadState === 'complete'` and `r2State === 'present'`.
- Preserves: Local-only persists after Chrome download completion; Cloud-only persists after R2 presence.
- Adds CommonJS-only test exports for `processCompletedDownloadOperation`, `markDownloadOperationR2Present`, `reconcileMissingDownloadOperation`, and `updateDownloadOperation`; production runtime behavior does not depend on these exports.

- [ ] **Step 1: Add failing mode-specific operation tests**

Add four tests using the existing background harness:

```js
test('dual-write local completion does not persist before R2 is present', async () => {
    const { background, harness, downloadItem } = await seedRunOwnedDownloadOperation({
        mode: 'dual_write',
        downloadId: 41,
        mediaId,
        downloadState: 'complete',
        r2State: 'pending'
    });
    const uploadGate = deferred();
    harness.chromeApi.runtime.sendMessage.mockImplementation((message) => (
        message.action === 'READ_FILE_FOR_UPLOAD' ? uploadGate.promise : Promise.resolve({ ok: true })
    ));
    const completion = background.processCompletedDownloadOperation(41, downloadItem);
    await waitForCondition(() => harness.chromeApi.runtime.sendMessage.mock.calls
        .some(([message]) => message.action === 'READ_FILE_FOR_UPLOAD'));
    expect(harness.storedLocal.processedIds).toEqual([]);
    expect(background.getPendingDownloadOperationsForTest()['41']).toMatchObject({ r2State: 'pending' });
    uploadGate.resolve({ ok: false });
    await completion;
});

test('dual-write persists once after local completion and R2 presence', async () => {
    const { background, harness } = await seedRunOwnedDownloadOperation({
        mode: 'dual_write',
        downloadId: 41,
        mediaId,
        downloadState: 'complete',
        r2State: 'pending'
    });
    await background.markDownloadOperationR2Present(41, { status: 'uploaded' });
    expect(harness.storedLocal.processedIds).toEqual(expect.arrayContaining([mediaId]));
    expect(background.getPendingDownloadOperationsForTest()).not.toHaveProperty('41');
});
```

Implement `seedRunOwnedDownloadOperation` inside the test file with the existing `createLeaseBackgroundHarness`, `dispatchBackgroundMessageThroughPort`, `handleDownloadFilename`, Chrome download mocks, and the CommonJS-only `updateDownloadOperation` export. It must reserve the operation through the public download lifecycle, then set only the requested completion fields through the same serialized mutation function production uses.

Also assert that an R2 failure leaves the operation retryable with the ID absent, and Local-only still persists and removes its operation after local completion.

- [ ] **Step 2: Run the focused test and prove the current early-persistence bug**

Run: `npm run test:unit -- --runInBand tests/unit/grokScraperNavigation.test.js -t "dual-write|Local-only"`

Expected: the first test FAILS because `processCompletedDownloadOperation` currently calls `mutateProcessedIds` before R2 upload.

- [ ] **Step 3: Make persistence mode-aware in the completion path**

Replace the unconditional local persistence branch with:

```js
const localOnly = operation.allowLocal && !operation.cloudRequired;
if (localOnly && operation.mediaId && !operation.localIdentityPersisted) {
    await mutateProcessedIds({ ids: [operation.mediaId] }, authorityGuard);
    operation = await updateDownloadOperation(downloadId, { localIdentityPersisted: true });
    if (!operation) return;
    if (authorityGuard) await authorityGuard();
}
```

Keep `finalizeDownloadOperation` as the only Dual-write persistence point. Its existing preconditions already require both local completion and R2 presence.

- [ ] **Step 4: Correct missing-history reconciliation without inventing success**

In `reconcileMissingDownloadOperation`:

- Persist after missing Chrome history only for Local-only records already known `downloadState: 'complete'`.
- Finalize Cloud-only or Dual-write only when `r2State: 'present'` and all mode-required state is present.
- Retain a retryable Dual-write operation with `r2State !== 'present'`; do not remove it or add the ID.
- Remove an operation only when it is finalized, explicitly revoked, or cannot be recovered and has a redacted terminal error.

Use this branch shape:

```js
if (operation.downloadState === 'complete' && operation.r2State === 'present') {
    await finalizeDownloadOperation(operation.downloadId, {
        historyMissing: true,
        assertAuthorized
    });
    return;
}
if (operation.downloadState === 'complete' && operation.allowLocal && !operation.cloudRequired) {
    if (operation.mediaId && !operation.localIdentityPersisted) {
        await mutateProcessedIds({ ids: [operation.mediaId] }, assertAuthorized);
    }
    await removeDownloadOperation(operation.downloadId);
    return;
}
```

- [ ] **Step 5: Test Stop and reload boundaries**

Add assertions that revoking the lease between local completion and R2 acknowledgment prevents the late R2 callback from writing the ID, and that service-worker hydration preserves a still-retryable Dual-write operation without creating a processed ID.

- [ ] **Step 6: Run focused and full background tests**

Run:

```bash
npm run test:unit -- --runInBand tests/unit/grokScraperNavigation.test.js tests/unit/r2UploadPipeline.test.js tests/unit/cloudSyncUtils.test.js
node --check background.js
git diff --check
```

Expected: all checks PASS and exactly one processed-ID mutation occurs after both Dual-write outcomes.

- [ ] **Step 7: Commit**

```bash
git add background.js tests/unit/grokScraperNavigation.test.js
git diff --cached --check
git commit -m "fix(extension): defer dual-write processing until R2"
```

---

### Task 4: Run-owned Durability Barrier

**Files:**
- Modify: `background.js:2125-2605`
- Modify: `background.js:2885-3165`
- Modify: `background.js:4430-4505`
- Modify: `content.js:6380-6585`
- Modify: `popup.js:1-10`
- Modify: `tests/unit/grokScraperNavigation.test.js`
- Modify: `tests/unit/popupContent.test.js`
- Modify: `tests/e2e/extension.spec.js`

**Interfaces:**
- Consumes: `getRunScopedScrapeLease`, `scrapeLeaseMatches`, `recordOwnedByScrapeLease`, `activeScrapeTransferTasks`, pending download receipts, pending download operations, and `cloudSyncQueue`.
- Produces: `getScrapeDurabilitySnapshot(lease)` and runtime action `GET_SCRAPE_DURABILITY`.
- Produces response:

```js
{
    status: 'durable' | 'pending' | 'failed' | 'ignored',
    inFlightTasks: number,
    pendingDownloads: number,
    pendingOperations: number,
    pendingQueueItems: number,
    failedItems: number
}
```

- [ ] **Step 1: Add failing snapshot and authorization tests**

Cover:

1. An unrelated tab or stale run receives `{ status: 'ignored' }`.
2. One active transfer produces `pending`.
3. One run-owned download operation with R2 pending produces `pending`.
4. One run-owned cloud queue item below retry limit produces `pending`.
5. One run-owned queue or operation at `CloudSync.MAX_RETRY_ATTEMPTS` with `lastError` produces `failed`.
6. No run-owned tasks, receipts, operations, or queue items produces `durable`.
7. Records owned by another lease do not affect the result.

Use a message-level assertion:

```js
const response = await dispatchBackgroundMessage(harness.chromeApi, {
    action: 'GET_SCRAPE_DURABILITY',
    runToken: lease.token,
    runEpoch: lease.epoch,
    kind: lease.kind
}, { tab: { id: lease.tabId } });
expect(response).toMatchObject({ status: 'pending', pendingQueueItems: 1 });
```

- [ ] **Step 2: Run the focused tests and verify the unknown-action failure**

Run: `npm run test:unit -- --runInBand tests/unit/grokScraperNavigation.test.js -t "durability"`

Expected: FAIL because no durability action exists.

- [ ] **Step 3: Implement a side-effect-free snapshot**

```js
function getScrapeDurabilitySnapshot(lease) {
    const key = scrapeTransferKey(lease);
    const inFlightTasks = activeScrapeTransferTasks.get(key)?.size || 0;
    const pendingDownloads = countPendingScrapeDownloadReceipts(lease);
    const ownedOperations = Array.from(pendingDownloadOperations.values())
        .filter((record) => recordOwnedByScrapeLease(record, lease));
    const ownedQueue = cloudSyncQueue
        .filter((record) => recordOwnedByScrapeLease(record, lease));
    const failedItems = [...ownedOperations, ...ownedQueue].filter((record) => (
        Boolean(record.lastError)
        && (record.attempts || 0) >= CloudSync.MAX_RETRY_ATTEMPTS
    )).length;
    const counts = {
        inFlightTasks,
        pendingDownloads,
        pendingOperations: ownedOperations.length,
        pendingQueueItems: ownedQueue.length,
        failedItems
    };
    const pendingCount = inFlightTasks
        + pendingDownloads
        + ownedOperations.length
        + ownedQueue.length;
    return {
        status: failedItems > 0
            ? 'failed'
            : pendingCount > 0 ? 'pending' : 'durable',
        ...counts
    };
}
```

Implement `countPendingScrapeDownloadReceipts` by deduplicating receipt objects across URL and ID maps. Do not mutate, drain, detach, retry, or revoke anything from this snapshot.

- [ ] **Step 4: Route the authorized runtime request without tracking itself**

The `GET_SCRAPE_DURABILITY` handler must validate the sender and lease, then read the snapshot directly. Do not wrap it in `trackScrapeTransferTask`; counting the query itself would make `durable` impossible.

```js
if (request.action === 'GET_SCRAPE_DURABILITY') {
    (async () => {
        const lease = await getAuthorizedScrapeTransferLease(request, sender);
        return lease ? getScrapeDurabilitySnapshot(lease) : { status: 'ignored' };
    })().then(sendResponse).catch(() => sendResponse({ status: 'ignored' }));
    return true;
}
```

- [ ] **Step 5: Add bounded polling in the content script**

```js
async waitForRunDurability(runToken = this.runToken, {
    timeoutMs = 60000,
    pollMs = 250
} = {}) {
    const startedAt = Date.now();
    while (this.isRunActive(runToken) && Date.now() - startedAt < timeoutMs) {
        const result = await safeChromeRuntimeSendMessage({
            action: 'GET_SCRAPE_DURABILITY',
            runToken,
            runEpoch: this.runEpoch,
            kind: this.backupMode ? 'r2_backup' : 'sync'
        }, 'check scrape durability');
        if (result.invalidated) return { status: 'ignored', reason: 'context_invalidated' };
        if (result.value?.status !== 'pending') return result.value;
        await this.sleep(pollMs);
    }
    return { status: this.isRunActive(runToken) ? 'timeout' : 'ignored' };
}
```

Before natural Sync or backup completion, require `status === 'durable'`. Map `failed` to `durability_failed`, `timeout` to `durability_timeout`, and `ignored` to `stale_authority`. None may be reported as `complete`.

- [ ] **Step 6: Add an E2E completion barrier assertion**

Mock `GET_SCRAPE_DURABILITY` to return `pending` twice and then `durable`. Assert that no `SCRAPE_COMPLETE` or `R2_BACKUP_COMPLETE` message is sent before the durable response. Add a failure variant returning `failed` and assert the status is not Complete.

- [ ] **Step 7: Separate queued-total telemetry from current pending work**

Keep `backupStats.queued` as the cumulative count of transfers that entered a queue. Add `backupStats.pendingTransfers`, initialized to zero, and update it from every durability response:

```js
this.backupStats.pendingTransfers = Number(snapshot.pendingDownloads || 0)
    + Number(snapshot.pendingOperations || 0)
    + Number(snapshot.pendingQueueItems || 0)
    + Number(snapshot.inFlightTasks || 0);
```

Persist this count with backup progress. A final durable snapshot must set `pendingTransfers` to zero. Update `formatR2BackupDetails` to distinguish `queued total` from `pending`; do not erase the historical queued count merely to make completion pass.

Add tests for one queued transfer that drains: `queued` remains 1, `pendingTransfers` becomes 0, and completion may pass. Add the inverse case where `pendingTransfers` remains nonzero and completion must fail.

- [ ] **Step 8: Make completion labels fail closed**

Add unit assertions that missing `stopReason`, missing or nonzero `pendingTransfers`, nonzero `errors`, `durability_timeout`, `durability_failed`, and `scan_limit` never produce a successful background completion or popup label `Complete`.

Use the same predicate in background logging and popup display:

```js
function isR2BackupCompletionSuccessful(stats = {}) {
    const completedReason = stats.stopReason === 'complete'
        || stats.stopReason === 'canary_complete';
    return completedReason
        && Number.isInteger(stats.pendingTransfers)
        && stats.pendingTransfers === 0
        && Number(stats.errors || 0) === 0;
}
```

`getR2BackupDoneStatusLabel` must return `Complete` or `Canary complete` only when this predicate passes, `Incomplete` when a nominal completion reason has queued/errors, `Paused` for scan limits, and `Stopped` for absent or other reasons.

- [ ] **Step 9: Run focused tests**

Run:

```bash
npm run test:unit -- --runInBand tests/unit/grokScraperNavigation.test.js tests/unit/popupContent.test.js
npm run test:e2e -- --grep "durability|Saved"
node --check background.js
node --check content.js
git diff --check
```

- [ ] **Step 10: Commit**

```bash
git add background.js content.js popup.js tests/unit/grokScraperNavigation.test.js tests/unit/popupContent.test.js tests/e2e/extension.spec.js
git commit -m "fix(extension): await run-owned transfer durability"
```

---

### Task 5: Conservative Saved Scan Ledger And Exhaustion Proof

**Files:**
- Modify: `content.js:850-885`
- Modify: `content.js:6466-6590`
- Modify: `content.js:7210-7240`
- Modify: `tests/unit/grokScraperNavigation.test.js`
- Modify: `tests/e2e/extension.spec.js`

**Interfaces:**
- Consumes: `getSavedGalleryContext`, `getSavedScrollerSnapshot`, `getGalleryCardSignature`, and `waitForRunDurability` from Task 4.
- Produces: `createSavedScanLedger(now)`, `recordSavedScan(ledger, observation)`, and the expanded `resolveBackupScrollAttempt(input)` contract in the shared interface map.
- Uses exact constants: `REQUIRED_STABLE_BOTTOM_ROUNDS = 8`, `MINIMUM_STABLE_BOTTOM_MS = 6000`, backup `MAX_SCROLL_ATTEMPTS = 1000`, normal Sync `MAX_SCROLL_ATTEMPTS = 200`.

- [ ] **Step 1: Replace stale-retry expectations with failing scan-ledger tests**

Add pure tests for:

```js
expect(resolveBackupScrollAttempt({
    before: bottom,
    after: bottom,
    beforeSignature: 'a',
    afterSignature: 'a',
    newIdentityCount: 0,
    loading: true,
    transferPending: false,
    stableBottomRounds: 7,
    lastNewIdentityAt: 0,
    now: 10000,
    requiredStableBottomRounds: 8,
    minimumStableBottomMs: 6000
})).toMatchObject({ exhausted: false, stableBottomRounds: 0, reason: 'loading' });

expect(resolveBackupScrollAttempt({
    before: bottom,
    after: bottom,
    beforeSignature: 'a',
    afterSignature: 'b',
    newIdentityCount: 1,
    loading: false,
    transferPending: false,
    stableBottomRounds: 7,
    lastNewIdentityAt: 9000,
    now: 10000,
    requiredStableBottomRounds: 8,
    minimumStableBottomMs: 6000
})).toMatchObject({ exhausted: false, stableBottomRounds: 0, reason: 'new_identity' });
```

Add the positive case where eight unchanged bottom probes span at least six seconds, no loader is visible, no transfer is pending, and no new identity appears. Add the safety-limit case and assert it yields `scan_limit`, never `complete`.

- [ ] **Step 2: Run focused tests and verify current false-exhaustion behavior fails them**

Run: `npm run test:unit -- --runInBand tests/unit/grokScraperNavigation.test.js -t "scan ledger|bottom|exhaust"`

Expected: FAIL because current code increments `staleRetries` solely from unchanged bottom metrics.

- [ ] **Step 3: Implement the in-memory scan ledger**

```js
function createSavedScanLedger(now = Date.now()) {
    return {
        seenIdentities: new Set(),
        durableIdentities: new Set(),
        stableBottomRounds: 0,
        lastNewIdentityAt: now,
        scanAttempts: 0
    };
}

function recordSavedScan(ledger, { identities, now = Date.now() }) {
    let newIdentityCount = 0;
    for (const value of identities.map(getGrokMediaIdentity).filter(Boolean)) {
        if (ledger.seenIdentities.has(value)) continue;
        ledger.seenIdentities.add(value);
        newIdentityCount++;
    }
    if (newIdentityCount > 0) {
        ledger.lastNewIdentityAt = now;
        ledger.stableBottomRounds = 0;
    }
    ledger.scanAttempts++;
    return { newIdentityCount, totalUniqueSeen: ledger.seenIdentities.size };
}
```

Keep the ledger in memory per scraper run. Persist only redacted counts and timestamps in `r2BackupState.scan`, never the full identity set.

- [ ] **Step 4: Make bottom completion conservative**

`resolveBackupScrollAttempt` must reset stable rounds when:

- a new identity appears,
- scroll position or height changes,
- the visible signature changes,
- a semantic loader is active,
- a transfer is pending,
- the scroller is not at bottom.

It may return `exhausted: true` only when all eight stable probes occur at bottom and `now - lastNewIdentityAt >= 6000`.

Detect loading only through semantic state inside the Saved surface:

```js
function isSavedGalleryLoading(root = document) {
    return Array.from(root.querySelectorAll('[aria-busy="true"], [role="progressbar"]'))
        .some((element) => element.getClientRects().length > 0);
}
```

If Grok exposes another visible semantic loading marker during live validation, capture it in a failing fixture before adding that selector.

- [ ] **Step 5: Integrate the ledger into `executeListView`**

At every scan:

1. Record all current semantic identities before choosing a target.
2. In normal Sync, skip canonical `processedIds` and `_runVisited`; in backup mode, ignore historical `processedIds` as cloud proof and skip only `_backupVisited` for same-run dedupe.
3. Query `GET_SCRAPE_DURABILITY` before a bottom probe and set `transferPending` unless it is durable.
4. Scroll one viewport and wait 750 ms between stable-bottom probes.
5. Reset bottom stability whenever the current gallery changes.
6. On proven exhaustion, call `waitForRunDurability` and complete only on `durable`.
7. On `MAX_SCROLL_ATTEMPTS`, stop with `scan_limit` and a warning.

Use this explicit eligibility split:

```js
const alreadyDone = this.backupMode
    ? this._backupVisited.has(cleanId)
    : this.isMediaProcessed(entry.sourceUrl) || this._runVisited.has(cleanId);
```

This prevents a historical local download ID from masquerading as current R2 proof while retaining same-run backup dedupe.

- [ ] **Step 6: Add a virtualized E2E fixture that loads beyond the first viewport**

The fixture must start with six cards, replace the DOM cards after each scroll, and eventually expose thirty unique identities. Assert:

- every identity is transferred once,
- at least one image and one video path are used,
- Agent Mode receives zero gallery-scroll calls,
- every return restores a valid Saved receipt,
- no completion occurs at the first unchanged bottom,
- completion occurs only after all thirty identities and a durable barrier,
- a forced 1,000-attempt backup limit reports `scan_limit` rather than Complete.

- [ ] **Step 7: Run focused tests**

Run:

```bash
npm run test:unit -- --runInBand tests/unit/grokScraperNavigation.test.js
npm run test:e2e -- --grep "virtualized|Saved"
node --check content.js
git diff --check
```

- [ ] **Step 8: Commit**

```bash
git add content.js tests/unit/grokScraperNavigation.test.js tests/e2e/extension.spec.js
git commit -m "fix(extension): prove Saved gallery exhaustion"
```

---

### Task 6: Read-only R2 Presence Preflight For Full Backup

**Files:**
- Modify: `background.js:1240-1465`
- Modify: `background.js:2125-2605`
- Modify: `background.js:2885-3065`
- Modify: `content.js:6466-6545`
- Modify: `content.js:6940-7045`
- Modify: `popup.html`
- Modify: `tests/unit/grokScraperBackup.test.js`
- Modify: `tests/unit/grokScraperNavigation.test.js`
- Modify: `tests/unit/popupContent.test.js`
- Modify: `tests/e2e/extension.spec.js`

**Interfaces:**
- Consumes: existing authenticated `GET /v1/vault/inventory`, read-only `HEAD /v1/objects/verify?objectKey=...`, `CloudSync.resolveMediaAssetIdentity`, scrape leases, and run authority guards.
- Produces: `loadVerifiedVaultInventory(config, assertAuthorized)`, `headVerifiedVaultObject(config, item, assertAuthorized)`, an in-memory inventory cache keyed by scrape lease, and runtime action `R2_BACKUP_CHECK_PRESENT`.
- Preserves: no Worker route, Worker deploy, D1 mutation, R2 write, or cloud schema change for the preflight path.

- [ ] **Step 1: Add failing tests that separate processed IDs from R2 proof**

Add a list-view test with one media identity already present in `processedIds` but absent from `_backupVisited`. In backup mode it must still call `processItem`; in normal Sync it must skip the same identity.

```js
expect(backupScraper.processItem).toHaveBeenCalledWith(
    expect.any(HTMLImageElement),
    mediaId,
    backupScraper.runToken,
    backupScraper.runEpoch,
    expect.anything()
);
expect(syncScraper.processItem).not.toHaveBeenCalled();
```

- [ ] **Step 2: Add failing inventory and HEAD tests**

Cover:

1. Inventory pagination follows `nextCursor` until null and rejects a repeated cursor.
2. A `verificationStatus: 'verified'` row is not accepted until `HEAD /v1/objects/verify` returns 200.
3. HEAD 200 returns `already_present` with redacted metadata and performs no bridge fetch, presign, PUT, or processed-ID write inside the check itself.
4. HEAD 404 returns `missing`, after which the existing upload path runs.
5. HEAD 401, 429, or 500 returns `error`, stops the item, and leaves processed IDs unchanged.
6. A stale or wrong-kind lease returns `ignored` without a network request.
7. Inventory rows from another key prefix are rejected.

Use a message-level assertion:

```js
const result = await dispatchBackgroundMessage(harness.chromeApi, {
    action: 'R2_BACKUP_CHECK_PRESENT',
    runToken: lease.token,
    runEpoch: lease.epoch,
    kind: 'r2_backup',
    url: sourceUrl,
    isVideo: false
}, { tab: { id: lease.tabId } });
expect(result).toMatchObject({ status: 'already_present', assetId: `media_${mediaId}` });
expect(global.fetch.mock.calls.filter(([url]) => String(url).includes('/v1/presign'))).toHaveLength(0);
```

- [ ] **Step 3: Run focused tests and verify current backup skipping and missing-action failures**

Run:

```bash
npm run test:unit -- --runInBand tests/unit/grokScraperBackup.test.js tests/unit/grokScraperNavigation.test.js -t "processed IDs|R2 presence|inventory"
```

Expected: FAIL because backup mode currently skips `processedIds` and no presence-check action exists.

- [ ] **Step 4: Load and validate paginated inventory once per active backup lease**

```js
async function loadVerifiedVaultInventory(config, assertAuthorized) {
    const items = new Map();
    const seenCursors = new Set();
    let cursor = null;
    do {
        if (cursor && seenCursors.has(cursor)) throw new Error('vault_inventory_cursor_repeated');
        if (cursor) seenCursors.add(cursor);
        if (assertAuthorized) await assertAuthorized();
        const url = new URL('/v1/vault/inventory', config.workerUrl);
        url.searchParams.set('limit', '1000');
        if (cursor) url.searchParams.set('cursor', cursor);
        const response = await fetchWithScrapeAuthority(url.toString(), {
            headers: { [API_KEY_HEADER]: config.apiKey }
        }, assertAuthorized);
        if (!response.ok) throw new Error(`vault_inventory_${response.status}`);
        const page = await response.json();
        for (const item of page.items || []) {
            if (item.verificationStatus !== 'verified'
                || !['image', 'video'].includes(item.mediaType)
                || !item.assetId
                || !item.canonicalObjectKey) continue;
            items.set(item.assetId, item);
        }
        cursor = page.nextCursor || null;
    } while (cursor);
    return items;
}
```

Cache the resulting Promise by `scrapeTransferKey(lease)` so concurrent item checks share one pagination pass. Clear that cache when the run stops, completes, is revoked, or fails. Validate every returned `canonicalObjectKey` begins with the configured normalized key prefix before caching it.

- [ ] **Step 5: Verify each candidate object with the existing read-only HEAD route**

```js
async function headVerifiedVaultObject(config, item, assertAuthorized) {
    const url = new URL('/v1/objects/verify', config.workerUrl);
    url.searchParams.set('objectKey', item.canonicalObjectKey);
    const response = await fetchWithScrapeAuthority(url.toString(), {
        method: 'HEAD',
        headers: { [API_KEY_HEADER]: config.apiKey }
    }, assertAuthorized);
    if (response.status === 404) return { status: 'missing', assetId: item.assetId };
    if (!response.ok) return { status: 'error', error: `r2_head_${response.status}` };
    const bytes = Number(response.headers.get('x-r2-size-bytes') || 0);
    const contentType = response.headers.get('content-type') || '';
    const expectedType = item.mediaType === 'video' ? 'video/' : 'image/';
    if (bytes <= 0 || !contentType.startsWith(expectedType)) {
        return { status: 'error', error: 'r2_head_metadata_mismatch' };
    }
    return {
        status: 'already_present',
        assetId: item.assetId,
        objectKey: item.canonicalObjectKey,
        bytes,
        contentType,
        sha256: response.headers.get('x-r2-sha256') || ''
    };
}
```

The HEAD route is read-only. Do not use POST `/v1/objects/verify` here because that route can update D1.

- [ ] **Step 6: Add the authorized `R2_BACKUP_CHECK_PRESENT` message**

The handler must:

1. Require an active `r2_backup` lease owned by the sender tab.
2. Derive `assetId` with `CloudSync.resolveMediaAssetIdentity({ sourceUrl, finalPath, mediaType })`.
3. Load the run's inventory cache.
4. Return `missing` when the identity has no verified canonical row.
5. HEAD the canonical key before returning `already_present`.
6. Recheck authority before and after every fetch and before returning.
7. Return redacted errors only.

- [ ] **Step 7: Check presence before fetching Grok media bytes**

At the start of `performBackupUpload`, after source identity is known but before `fetchMediaDataUrlViaBridge`:

```js
const presence = await safeChromeRuntimeSendMessage({
    action: 'R2_BACKUP_CHECK_PRESENT',
    runToken,
    runEpoch: this.runEpoch,
    kind: 'r2_backup',
    url: src,
    isVideo
}, 'check R2 backup presence');

if (presence.value?.status === 'already_present') {
    return this.recordDurableBackupResult(presence.value, src, currentItemId, runToken);
}
if (presence.value?.status !== 'missing') {
    return { status: 'error', error: presence.value?.error || 'r2_presence_check_failed' };
}
```

Extract the current status-counting, logging, processed-ID mutation, and progress persistence into `recordDurableBackupResult(response, src, currentItemId, runToken)`. Both the HEAD hit and the existing upload path must use it. Only `already_present`, `uploaded`, and `conflict_uploaded` may persist IDs.

- [ ] **Step 8: Correct the Full Media Backup popup guidance**

Update the Full Media Backup tooltip and its test to say that the run scans every Saved identity, verifies current R2 presence, and uploads only missing media. Remove the inaccurate claim that it scans only unprocessed media.

- [ ] **Step 9: Run focused tests and the thirty-item E2E**

Run:

```bash
npm run test:unit -- --runInBand tests/unit/grokScraperBackup.test.js tests/unit/grokScraperNavigation.test.js tests/unit/r2UploadPipeline.test.js tests/unit/popupContent.test.js
npm run test:e2e -- --grep "virtualized|R2 presence|Saved"
node --check background.js
node --check content.js
git diff --check
```

Expected: all checks PASS; backup verifies historical processed IDs against R2, and already-present items do not fetch Grok media bytes.

- [ ] **Step 10: Commit**

```bash
git add background.js content.js popup.html tests/unit/grokScraperBackup.test.js tests/unit/grokScraperNavigation.test.js tests/unit/popupContent.test.js tests/e2e/extension.spec.js
git diff --cached --check
git commit -m "fix(extension): verify R2 presence before full backup"
```

---

### Task 7: Independent Saved Observer And Vault Reconciliation

**Files:**
- Create: `acceptance/browser/saved-gallery-observer.js`
- Create: `acceptance/lib/saved-vault-reconciliation.js`
- Create: `acceptance/scripts/reconcile-production-vault.mjs`
- Create: `tests/unit/savedGalleryEvidenceObserver.test.js`
- Create: `tests/unit/savedVaultReconciliation.test.js`
- Reference only: `cloud/src/vault.ts:161-228`
- Reference only: `cloud/src/index.ts:709-714`

**Interfaces:**
- Consumes: authenticated paginated `GET /v1/vault/inventory?limit=1000&cursor=${cursor}` using `WORKER_URL` and `WORKER_API_KEY` or `CLIENT_API_KEY` from the process environment.
- Produces: browser global and CommonJS export `GrokSavedEvidenceObserver` with `observeSavedGallery(options)`.
- Produces: `normalizeSavedAssetIdentity(value)` and `reconcileSavedVaultInventory({ savedIdentities, inventoryItems })`.
- Stores identity UUIDs and redacted metadata only; never stores source URLs, media bytes, request headers, or secret values.

- [ ] **Step 1: Write failing observer tests with a fake virtualized gallery**

```js
const {
    createSavedGalleryObserver
} = require('../../acceptance/browser/saved-gallery-observer.js');

test('deduplicates identities across remounts and requires stable bottom proof', () => {
    let now = 0;
    const observer = createSavedGalleryObserver({ now: () => now });
    observer.capture({
        pathname: '/imagine/saved',
        scope: 'all',
        identities: [id1, id2],
        atBottom: false,
        loading: false,
        signature: 'page-1'
    });
    observer.capture({
        pathname: '/imagine/saved',
        scope: 'all',
        identities: [id2, id3],
        atBottom: true,
        loading: false,
        signature: 'page-2'
    });
    for (let round = 0; round < 8; round++) {
        now += 750;
        observer.capture({
            pathname: '/imagine/saved',
            scope: 'all',
            identities: [id2, id3],
            atBottom: true,
            loading: false,
            signature: 'page-2'
        });
    }
    expect(observer.snapshot()).toMatchObject({
        identities: [id1, id2, id3],
        exhausted: true,
        stableBottomRounds: 8
    });
});
```

Also test unsupported routes, non-All scope, visible loader, a new identity during bottom probing, duplicate DOM nodes, invalid media URLs, and redaction of full URLs.

- [ ] **Step 2: Run the observer test and verify the missing module failure**

Run: `npm run test:unit -- --runInBand tests/unit/savedGalleryEvidenceObserver.test.js`

Expected: FAIL because the observer module does not exist.

- [ ] **Step 3: Implement a dependency-injected observer core and a browser driver**

Use a UMD-style wrapper so Jest can require the file and the visible Grok page can expose it without an extension build:

```js
(function expose(root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.GrokSavedEvidenceObserver = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
    const REQUIRED_STABLE_BOTTOM_ROUNDS = 8;
    const MINIMUM_STABLE_BOTTOM_MS = 6000;
    const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;

    function normalizeIdentity(value) {
        return String(value || '').match(UUID_RE)?.[0]?.toLowerCase() || null;
    }

    function createSavedGalleryObserver({ now = Date.now } = {}) {
        const state = {
            identities: new Set(),
            events: [],
            stableBottomRounds: 0,
            lastNewIdentityAt: now(),
            exhausted: false
        };
        return {
            capture(observation) {
                if (observation.pathname !== '/imagine/saved') throw new Error('observer_route_mismatch');
                if (observation.scope !== 'all') throw new Error('observer_scope_mismatch');
                const before = state.identities.size;
                for (const identity of observation.identities.map(normalizeIdentity).filter(Boolean)) {
                    state.identities.add(identity);
                }
                const added = state.identities.size - before;
                if (added || observation.loading || !observation.atBottom) {
                    state.stableBottomRounds = 0;
                    if (added) state.lastNewIdentityAt = now();
                } else {
                    state.stableBottomRounds++;
                }
                state.exhausted = state.stableBottomRounds >= REQUIRED_STABLE_BOTTOM_ROUNDS
                    && now() - state.lastNewIdentityAt >= MINIMUM_STABLE_BOTTOM_MS;
                state.events.push({ at: now(), added, total: state.identities.size, atBottom: observation.atBottom });
                return this.snapshot();
            },
            snapshot() {
                return {
                    schemaVersion: 1,
                    identities: Array.from(state.identities),
                    events: [...state.events],
                    stableBottomRounds: state.stableBottomRounds,
                    exhausted: state.exhausted
                };
            }
        };
    }
```

The browser driver `observeSavedGallery` must independently:

1. Require the visible URL pathname `/imagine/saved` and selected All scope.
2. Locate the one semantic gallery list and its scroller without calling extension code.
3. Extract only UUID identities from `img[alt="Generated image"]` URLs.
4. Record the initial scroll position, set the semantic gallery scroller to zero, and verify the top position before collecting identities.
5. Scroll one viewport, wait 750 ms, and capture until the core proves exhaustion or 1,000 probes are reached.
6. Return `blocked: scan_limit` on the limit, never `exhausted: true`.
7. Restore the initial scroll position in `finally`.
8. Never click a card, invoke extension APIs, fetch media, or navigate.

- [ ] **Step 4: Write failing reconciliation tests**

```js
const {
    normalizeSavedAssetIdentity,
    reconcileSavedVaultInventory
} = require('../../acceptance/lib/saved-vault-reconciliation.js');

test('normalizes raw and media-prefixed UUIDs to one identity', () => {
    expect(normalizeSavedAssetIdentity(uuid)).toBe(uuid);
    expect(normalizeSavedAssetIdentity(`media_${uuid}`)).toBe(uuid);
});

test('reports missing, duplicate canonical, and unverified identities', () => {
    const result = reconcileSavedVaultInventory({
        savedIdentities: [id1, id2, id3],
        inventoryItems: [
            { assetId: `media_${id1}`, canonicalObjectKey: `prefix/${id1}.jpg`, verificationStatus: 'verified' },
            { assetId: id1, canonicalObjectKey: `prefix/duplicate-${id1}.jpg`, verificationStatus: 'verified' },
            { assetId: id2, canonicalObjectKey: `prefix/${id2}.mp4`, verificationStatus: 'unproven' }
        ]
    });
    expect(result.missing).toEqual([id3]);
    expect(result.duplicateCanonical).toEqual([id1]);
    expect(result.unverified).toEqual([id2]);
    expect(result.verified).toEqual([]);
    expect(result.legacyDuplicates).toEqual([]);
});
```

- [ ] **Step 5: Implement canonical identity reconciliation**

```js
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;

function normalizeSavedAssetIdentity(value) {
    return String(value || '').match(UUID_RE)?.[0]?.toLowerCase() || null;
}

function reconcileSavedVaultInventory({ savedIdentities, inventoryItems }) {
    const saved = new Set(savedIdentities.map(normalizeSavedAssetIdentity).filter(Boolean));
    const byIdentity = new Map();
    for (const item of inventoryItems || []) {
        const identity = normalizeSavedAssetIdentity(item.assetId)
            || normalizeSavedAssetIdentity(item.canonicalObjectKey);
        if (!identity) continue;
        const rows = byIdentity.get(identity) || [];
        rows.push(item);
        byIdentity.set(identity, rows);
    }
    const missing = [];
    const duplicateCanonical = [];
    const unverified = [];
    const verified = [];
    const legacyDuplicates = [];
    for (const identity of saved) {
        const rows = byIdentity.get(identity) || [];
        const canonicalRows = rows.filter((row) => row.canonicalObjectKey);
        if (!rows.length) missing.push(identity);
        else if (canonicalRows.length !== 1) duplicateCanonical.push(identity);
        else if (canonicalRows[0].verificationStatus !== 'verified') unverified.push(identity);
        else {
            verified.push(identity);
            if ((canonicalRows[0].legacyObjectKeys || []).length > 0) legacyDuplicates.push(identity);
        }
    }
    return {
        savedCount: saved.size,
        inventoryCount: inventoryItems.length,
        verified,
        missing,
        duplicateCanonical,
        unverified,
        legacyDuplicates,
        extra: Array.from(byIdentity.keys()).filter((identity) => !saved.has(identity))
    };
}
```

- [ ] **Step 6: Add the authenticated paginated reconciliation CLI**

`reconcile-production-vault.mjs` must:

- Require `--observer "$OBSERVER_JSON"` and `--output "$OUTPUT_JSON"`.
- Read `WORKER_URL` and `WORKER_API_KEY`, falling back to `CLIENT_API_KEY`, from process environment only.
- Validate the Worker URL as HTTPS and refuse to print either variable.
- Fetch every inventory page with `limit=1000` until `nextCursor` is null.
- Detect repeated cursors and stop as failed.
- Call `reconcileSavedVaultInventory`.
- Write only counts, identity suffixes, verification status, and redacted object-key metadata.
- Exit nonzero when `missing`, `duplicateCanonical`, or `unverified` is nonempty.
- Never POST, PUT, PATCH, or DELETE.

Invoke it with Node's env-file support so secrets stay in the ignored env file:

```bash
mise exec node@24 -- node --env-file=web/.env.local \
  acceptance/scripts/reconcile-production-vault.mjs \
  --observer "acceptance/runs/$ACCEPTANCE_RUN_ID/saved-observer-final.json" \
  --output "acceptance/runs/$ACCEPTANCE_RUN_ID/production-reconciliation.json"
```

- [ ] **Step 7: Run focused tests and a network-free CLI argument check**

Run:

```bash
npm run test:unit -- --runInBand tests/unit/savedGalleryEvidenceObserver.test.js tests/unit/savedVaultReconciliation.test.js
mise exec node@24 -- node acceptance/scripts/reconcile-production-vault.mjs
```

Expected: unit tests PASS; the CLI exits blocked because required arguments and environment are absent, without making a request or printing a secret.

- [ ] **Step 8: Commit**

```bash
git add acceptance/browser/saved-gallery-observer.js acceptance/lib/saved-vault-reconciliation.js acceptance/scripts/reconcile-production-vault.mjs tests/unit/savedGalleryEvidenceObserver.test.js tests/unit/savedVaultReconciliation.test.js
git diff --cached --check
git commit -m "test(acceptance): add independent Saved reconciliation"
```

---

### Task 8: Integrated Five-item Prompted Batch And Long Sync Tests

**Files:**
- Modify: `tests/e2e/extension.spec.js:90-360`
- Modify: `tests/e2e/extension.spec.js:1450-2310`
- Modify: `tests/unit/retryManager.test.js`
- Modify: `tests/unit/grokScraperNavigation.test.js`
- Modify only if a new red test requires it: `content.js`
- Modify only if a new red test requires it: `background.js`

**Interfaces:**
- Consumes: receipt V3 from Task 2, mode-aware durability from Task 3, durability snapshots from Task 4, and scan ledger from Task 5.
- Produces: deterministic workflow proof for five generated results, thirty virtualized Saved assets, three Dual-write operations, and Stop at every transition stage.

- [ ] **Step 1: Extend `setupMockPromptedResultsBatch` to five images**

Use five stable UUIDs and record, per item:

```js
{
    sourceIdentity,
    makeVideoClicks,
    addPromptClicks,
    preciseEditClicks,
    promptWrites,
    submitClicks,
    acceptedConversationId,
    returnStatus,
    nextIdentity
}
```

The fixture must insert a generated video before each source after acceptance, remount the result cards on return, and keep the same conversation route.

- [ ] **Step 2: Add the failing five-item Prompted Batch E2E**

```js
test('Prompted Batch completes five generated results with trusted controls and returns', async ({ page }) => {
    await setupMockPromptedResultsBatch(page, {
        accountUuid,
        mediaUuids,
        insertVideoBeforeSource: true
    });
    await expect(page.evaluate(() => window.__gptE2e.retry.startBatch(
        'prompted',
        'Subtle natural movement with a slow steady camera push.',
        { galleryLimit: 5, videoGoal: 5 }
    ))).resolves.toBe(true);
    const evidence = await page.evaluate(() => ({
        events: window.__promptedResultsEvents,
        status: window.__gptE2e.overlay.el.querySelector('#gptStatusBadge')?.textContent
    }));
    expect(evidence.events.opened).toHaveLength(5);
    expect(evidence.events.submitted).toHaveLength(5);
    expect(evidence.events.returned).toHaveLength(5);
    expect(evidence.events.preciseEditClicks).toBe(0);
    expect(evidence.status).toBe('Prompted Batch [results]: Complete (5/5)');
});
```

Run: `npm run test:e2e -- --grep "completes five generated results"`

Expected: FAIL until the fixture and all V3 return behavior are wired.

- [ ] **Step 3: Finish the thirty-item Saved fixture from Task 5**

Use five pages of six virtualized cards. Alternate image and video Agent media. Return to Saved after every transfer and replace card elements so no stale DOM node can carry identity. Mock Cloud-only responses as durable `uploaded`, then repeat a three-item subset in Dual-write with queued download operations that become R2-present only after download completion.

- [ ] **Step 4: Add integrated assertions for transfer and persistence**

```js
expect(new Set(evidence.transferredIdentities).size).toBe(30);
expect(evidence.transferredIdentities).toHaveLength(30);
expect(evidence.mediaTypes).toEqual(expect.arrayContaining(['image', 'video']));
expect(evidence.agentGalleryScrollCalls).toBe(0);
expect(evidence.processedBeforeDurability).toEqual([]);
expect(evidence.processedAfterDurability).toEqual(expect.arrayContaining(dualWriteIds));
expect(evidence.completionReason).toBe('complete');
```

Add negative variants for ambiguous Agent media, gallery return timeout, durability failure, Stop after source click, Stop during prompt write, Stop during transfer, Stop during return, and extension-context invalidation. Each must produce no late next-item action or processed-ID mutation.

- [ ] **Step 5: Make only contract-driven runtime corrections**

If one of these new tests fails, preserve the failing fixture, identify the exact contract violation, and change only the responsible helper or call site. Do not add another workflow controller, generic state machine, or unrelated selector.

- [ ] **Step 6: Run the integrated and full extension suites**

Run:

```bash
npm run test:unit -- --runInBand tests/unit/retryManager.test.js tests/unit/grokScraperNavigation.test.js tests/unit/backgroundRecreateWorkflow.test.js
npm run test:e2e
node --check background.js
node --check content.js
git diff --check
```

Expected: all unit and Playwright tests PASS, including five Prompted Batch results and thirty Saved identities.

- [ ] **Step 7: Commit**

```bash
git add tests/e2e/extension.spec.js tests/unit/retryManager.test.js tests/unit/grokScraperNavigation.test.js tests/unit/backgroundRecreateWorkflow.test.js content.js background.js
git diff --cached --check
git commit -m "test(extension): cover long Grok recovery workflows"
```

If `content.js` or `background.js` did not change in this task, leave them out of the `git add` command.

---

### Task 9: Deterministic Release Gates And Package Inspection

**Files:**
- Modify only when a gate exposes a real regression: files owned by Tasks 1-7.
- Write ignored evidence: `acceptance/runs/$ACCEPTANCE_RUN_ID/deterministic.json`
- Inspect generated package only: extension package output created by `npm run package:extension`.

**Interfaces:**
- Consumes: all deterministic code and tests from Tasks 1-8.
- Produces: a `deterministic` lane record with command, exit status, test counts, package checksum, and redacted failure summaries.

- [ ] **Step 1: Verify branch, protected files, and clean task commits**

Run:

```bash
git status --short --branch
git log --oneline --decorate -8
test -e None
test -e docs/superpowers/plans/2026-08-11-grok-imagine-2-compatibility-recovery.md
```

Expected: branch is `codex/grok-extension-recovery`; only the two protected untracked files remain outside committed task work.

- [ ] **Step 2: Run every deterministic gate in the approved order**

Run each command separately and record its actual exit status:

```bash
npm run lint
npm run test:unit
npm run test:e2e
npm run package:extension
node --check background.js
node --check content.js
npm --prefix cloud run typecheck
npm --prefix cloud run test:acceptance
git diff --check
```

Expected: every command exits 0. Report the actual Jest and Playwright counts; do not copy the spec's baseline counts when they have changed.

- [ ] **Step 3: Inspect the packaged extension**

Confirm the package contains the manifest-declared extension files, includes the modified `background.js` and `content.js` checksums, excludes `.env*`, `acceptance/runs`, tests, screenshots, Git metadata, and the protected untracked files, and has no unexpectedly large binaries.

- [ ] **Step 4: Run source and staged secret/debug scans**

Run:

```bash
git diff --name-only origin/codex/grok-extension-recovery...HEAD
git diff origin/codex/grok-extension-recovery...HEAD -- . ':!docs/superpowers/specs/*' ':!docs/superpowers/plans/*'
rg -n "console\.log|console\.warn|debugger|FIXME|Bearer |Authorization:|api[_-]?key|secret|token|cookie" background.js content.js acceptance tests
git status --short
```

Classify every hit. Existing deliberate redacted logs and test fixtures may remain; raw secrets, ad hoc debug output, weakened assertions, `.env` files, or unrelated binaries block progress.

- [ ] **Step 5: Record the deterministic lane**

Create a small evidence JSON containing command names, exit codes, actual test counts, package checksum, and scan verdict. Record it with:

```bash
mise exec node@24 -- node acceptance/scripts/record-extension-recovery-lane.mjs \
  --run-id "$ACCEPTANCE_RUN_ID" \
  --lane deterministic \
  --status passed \
  --evidence "acceptance/runs/$ACCEPTANCE_RUN_ID/deterministic-input.json"
```

Expected: gate remains `inconclusive` because live lanes are still not run.

- [ ] **Step 6: Fix any discovered regression through a new red test**

For each failure, keep the failing command output redacted, add the smallest test that reproduces the behavior, verify the test fails, make the minimal correction, rerun the focused test, then rerun every command from Step 2. Commit each independent correction with a semantic message.

---

### Task 10: Isolated Acceptance Cloud Lane

**Files:**
- Modify only if a live failure first gains a deterministic regression: runtime or test files owned by Tasks 1-8.
- Write ignored evidence: `acceptance/runs/$ACCEPTANCE_RUN_ID/acceptance-cloud/`
- Write ignored config: `cloud/wrangler.acceptance.generated.toml`
- Reuse: `acceptance/scripts/preflight.mjs`
- Reuse: `acceptance/scripts/run-live-canary.mjs`
- Reuse: `acceptance/scripts/write-cloudflare-acceptance-config.mjs`

**Interfaces:**
- Consumes: existing acceptance-only Worker, R2 bucket, D1 database, distinct credential, active run ID, and prefix `acceptance/$ACCEPTANCE_RUN_ID`.
- Produces: direct extension evidence for public image, authenticated video, duplicate, rejected transfer, cancellation, and production-isolation checks.
- Restores: the exact production popup config fingerprints captured before the lane.

- [ ] **Step 1: Verify no competing work and finalize environment preflight**

Using narrow process and visible-window checks, confirm there is no active extension sync/backup, Grok generation lane, browser download, cloud upload, or resource-intensive job. Verify the visible Grok page is logged in and can open `/imagine/saved` in All scope. Do not inspect other Chrome tabs.

Record, without secret values, and assign the directly observed extension ID to `LOADED_EXTENSION_ID` for direct-URL use:

- loaded extension ID, version, and source path,
- visible Grok route and login state,
- popup mode, Worker host, key-prefix fingerprint, API-key-present boolean, and download-folder fingerprint,
- processed-ID count, cloud queue count, scrape state, R2 backup state, and extension error count,
- available disk space and configured download directory.

Mark `environment-and-state` passed only after all checks succeed.

- [ ] **Step 2: Reload the exact unpacked extension build**

Open the direct URL `chrome://extensions/?id=${LOADED_EXTENSION_ID}` using the extension ID recorded in Step 1, reload that single extension, return to the visible Grok page, and refresh only that page. Confirm the overlay initializes once and the loaded source path still resolves to this checkout. Clear extension errors only after capturing the pre-lane count.

- [ ] **Step 3: Run acceptance preflight with the current authenticated Cloudflare account**

Run:

```bash
test -n "$CLOUDFLARE_ACCOUNT_ID"
CLOUDFLARE_ACCOUNT_ID="$CLOUDFLARE_ACCOUNT_ID" \
  mise exec node@24 -- node acceptance/scripts/preflight.mjs
```

Expected: repository, port, Cloudflare account, and R2 checks are verified. If Cloudflare returns auth code 10000 or the acceptance resources are unavailable, record `acceptance-cloud: blocked` and pause for the specific credential/resource action.

- [ ] **Step 4: Generate a new guarded acceptance config**

```bash
export ACCEPTANCE_KEY_PREFIX="acceptance/$ACCEPTANCE_RUN_ID"
test -n "$ACCEPTANCE_D1_DATABASE_ID"
test -n "$ACCEPTANCE_KEY_PREFIX"
ACCEPTANCE_WORKER_NAME=grok-powertools-acceptance \
ACCEPTANCE_R2_BUCKET=grok-powertools-acceptance \
ACCEPTANCE_D1_DATABASE=grok-powertools-acceptance-db \
  mise exec node@24 -- node acceptance/scripts/write-cloudflare-acceptance-config.mjs
```

Inspect `cloud/wrangler.acceptance.generated.toml` and prove it references only the acceptance Worker, bucket, D1 database, account, active run, and guarded prefix. Confirm Git ignores the file.

- [ ] **Step 5: Read the acceptance Worker identity before deciding whether to deploy**

Use the existing acceptance credential from its secure source without printing or copying it into evidence. Call authenticated `GET /v1/acceptance/identity` and record only Worker name/version, acceptance mode, run ID, key prefix, bucket name, D1 name, and credential fingerprint.

```bash
test -n "$ACCEPTANCE_WORKER_URL"
test -n "$ACCEPTANCE_CLIENT_API_KEY"
mise exec node@24 -- node -e '
const response = await fetch(`${process.env.ACCEPTANCE_WORKER_URL}/v1/acceptance/identity`, {
  headers: { "x-gpt-api-key": process.env.ACCEPTANCE_CLIENT_API_KEY }
});
if (!response.ok) process.exit(2);
const value = await response.json();
console.log(JSON.stringify({
  acceptanceMode: value.acceptanceMode,
  workerVersion: value.workerVersion,
  runId: value.runId,
  keyPrefix: value.keyPrefix,
  killSwitchActive: value.killSwitchActive,
  r2: value.r2,
  d1: value.d1,
  refusalRules: value.refusalRules
}, null, 2));
'
```

The D1 resource name comes from the generated ignored config; the identity response proves only that its binding is present. Do not report the configured name as runtime identity proof.

If identity already matches the current run and prefix, do not deploy. If it advertises an older run, deploy only the acceptance Worker:

```bash
CLOUDFLARE_ACCOUNT_ID="$CLOUDFLARE_ACCOUNT_ID" \
  npx wrangler@latest deploy --config cloud/wrangler.acceptance.generated.toml
```

Read the identity again and require an exact current run/prefix match. Never run the production deploy command or edit `cloud/wrangler.toml`.

- [ ] **Step 6: Arm the existing-Chrome acceptance lane**

```bash
ACCEPTANCE_LIVE_ARMED=true \
ACCEPTANCE_RUN_ID="$ACCEPTANCE_RUN_ID" \
ACCEPTANCE_KEY_PREFIX="$ACCEPTANCE_KEY_PREFIX" \
CLOUDFLARE_ACCOUNT_ID="$CLOUDFLARE_ACCOUNT_ID" \
  mise exec node@24 -- node acceptance/scripts/run-live-canary.mjs
```

Expected: the script exits 0 and writes the ignored manual-arm receipt. It must remain blocked when `ACCEPTANCE_LIVE_ARMED` is absent.

- [ ] **Step 7: Switch the popup to the acceptance cloud without exposing keys**

Capture the production config fingerprint first. Set only the acceptance Worker URL, acceptance key, and `acceptance/$ACCEPTANCE_RUN_ID` prefix through the visible popup. Keep Cloud-only mode and the existing download folder. Run cloud config validation and require valid.

If the distinct acceptance key is not available from its secure source without exposing or reconstructing it, pause for the user to enter that one field. Do not retrieve the production key from masked extension storage or logs.

- [ ] **Step 8: Prove one public image and one authenticated video**

From visible Grok Saved All scope:

1. Run a one-item R2 canary on a public image.
2. Require `uploaded` or `already_present` under the active acceptance prefix.
3. Verify object metadata and bytes through the acceptance Worker.
4. Run a one-item R2 canary on an authenticated `assets.grok.com` video.
5. Require the bridge fetch, R2 acknowledgment, object metadata, and playable readback.
6. Confirm processed-ID mutation occurs only after durable acceptance R2 proof.

Record redacted identity suffix, media type, byte count, object-key suffix, R2 status, transition receipt, and screenshot for each item.

- [ ] **Step 9: Prove duplicate, rejection, and cancellation paths**

- Run the same public image canary again and require `already_present` with no second object.
- Dispatch one acceptance canary with an intentionally mismatched acceptance run/correlation header through the existing canary request contract. Require the Worker to reject it before write and require no processed-ID delta.
- Start one authenticated-video canary, press Stop while transfer authority is active, and require `ignored/stale_authority`, no late processed-ID mutation, no queued retry owned by the revoked run, and no acceptance object for that identity.

Do not weaken the acceptance Worker guard or use the production prefix to create the rejection.

- [ ] **Step 10: Restore production settings and verify isolation**

Restore the exact production mode, Worker host, API-key presence, key-prefix fingerprint, and download folder captured in Step 1. Run production cloud config validation without a test upload. Confirm the acceptance objects exist only under `acceptance/$ACCEPTANCE_RUN_ID` and no production prefix, bucket, D1 configuration, or object was referenced by the lane.

- [ ] **Step 11: Record the acceptance-cloud lane**

Record `acceptance-cloud: passed` only when all five paths and restoration checks pass. If any live behavior fails, follow the Global Constraints failure protocol and rerun Task 9 before repeating this lane.

- [ ] **Step 12: Re-establish deterministic proof after a live correction**

When this lane caused any code or test commit, rerun every Task 9 command, update the deterministic evidence checksum/counts, reload the extension once, and repeat all Task 10 acceptance cases. If no code changed, record that Task 9 remains applicable to the same commit.

---

### Task 11: Five-item Live Prompted Batch Soak

**Files:**
- Modify only after a live failure is reproduced by a red test: `content.js`, `background.js`, `tests/unit/retryManager.test.js`, `tests/unit/backgroundRecreateWorkflow.test.js`, or `tests/e2e/extension.spec.js`.
- Write ignored evidence: `acceptance/runs/$ACCEPTANCE_RUN_ID/prompted-batch/`

**Interfaces:**
- Consumes: visible generated-results gallery, existing Prompted Batch UI, current Grok Make Video flow, receipt V3, and trusted native click dispatch.
- Produces: five accepted submissions, five verified returns, `Complete (5/5)`, and five playable low-cost videos.

- [ ] **Step 1: Capture the original Grok video settings and gallery receipt**

On the visible generated-results page, record the current resolution, duration, aspect behavior, route pathname, conversation identity, visible source identities, and scroll position. Do not retain unrelated prompt text or media URLs.

- [ ] **Step 2: Select the lowest-cost settings actually offered**

Open the current Make Video settings and visually inspect the available choices. Select the lowest visible resolution and shortest visible duration. Do not hardcode historical option labels. Record the chosen labels and screenshots, then close settings without submitting.

- [ ] **Step 3: Configure one neutral prompt and a five-item goal**

Use this bounded prompt:

```text
Subtle natural movement with a slow steady camera push.
```

Set Prompted Batch goal to five. Confirm no Sync or backup is active and that at least five eligible generated images are visible or reachable in the same logical results gallery.

- [ ] **Step 4: Run Prompted Batch and inspect every transition live**

For each of five source identities, require in order:

1. The expected result card opens.
2. The visible Make Video control is selected.
3. Add Prompt is selected and Precise Edit is not selected.
4. The prompt appears in the scoped video composer.
5. The trusted submit control receives one full native click sequence.
6. Grok accepts the submission for the same conversation.
7. The original results gallery is re-established by route and stable anchors.
8. The next expected source identity advances exactly once.

Stop immediately on ambiguity. Do not manually navigate the controller forward to make the run appear successful.

- [ ] **Step 5: Require controller completion and real output completion**

Require visible status `Prompted Batch [results]: Complete (5/5)`. Then wait for all five Grok jobs to finish. Open each resulting video, require nonzero duration and dimensions, press play, and observe advancing playback time without decode error. A submitted job that never becomes playable fails the lane.

- [ ] **Step 6: Restore Grok settings and inspect extension errors**

Restore the exact original video resolution and duration. Confirm the visible gallery position remains usable, the extension overlay is responsive, and no new uncaught error, invalidated-context warning spam, or stuck running state exists.

- [ ] **Step 7: Record the Prompted Batch lane**

Record five redacted per-item receipts with source suffix, control path, acceptance signal, return verdict, next suffix, output duration/dimensions, and playable verdict. Mark `prompted-batch: passed` only when all five rows pass and settings restoration matches.

If a live failure required code changes, rerun Task 9, Task 10, and this full five-item lane before continuing.

---

### Task 12: Cloud-only 25-item And Dual-write 3-item Live Sync

**Files:**
- Modify only after a live failure is reproduced by a red test: `content.js`, `background.js`, `tests/unit/grokScraperNavigation.test.js`, `tests/unit/grokScraperBackup.test.js`, or `tests/e2e/extension.spec.js`.
- Write ignored evidence: `acceptance/runs/$ACCEPTANCE_RUN_ID/cloud-only-sync/`
- Write ignored evidence: `acceptance/runs/$ACCEPTANCE_RUN_ID/dual-write-sync/`
- Write local Dual-write outputs under a temporary run-specific subfolder of the configured download root; do not delete them automatically.

**Interfaces:**
- Consumes: production Cloud-only config, Saved All scope, exact transfer receipts, durability snapshots, and R2 inventory/readback APIs.
- Produces: at least 25 consecutive Cloud-only durable identities and exactly three Dual-write identities with both local and R2 proof.

- [ ] **Step 1: Capture production and local baselines**

Verify production config is valid and fingerprint-equivalent to the pre-acceptance baseline. Record processed-ID set/count, R2 inventory count, cloud queue count, pending download-operation count, download folder, Saved route/scope, and current scroll position. Check for active work again.

- [ ] **Step 2: Run Cloud-only Start Sync to the first safe boundary at or after 25 successes**

Set mode to Cloud-only and start Sync from visible Grok Saved All scope. Observe every transition without opening unrelated tabs. Keep the run active until it has at least 25 consecutive durable `uploaded` or `already_present` receipts and has crossed at least one actual Saved scroll or virtualization boundary.

If both media types are available in the eligible sequence, require at least one image and one video. If one type is not available, record the independently observed available types rather than claiming mixed-media proof.

At or after success 25, wait until the controller has returned to Saved and `GET_SCRAPE_DURABILITY` reports `durable`, then press Stop once. If one extra item started before the boundary, include it in evidence and verify it fully; never revoke it mid-transfer merely to force an exact count.

- [ ] **Step 3: Validate Cloud-only identity and R2 evidence**

Require:

- no duplicate source identity,
- no Agent-mode gallery scrolling or `Scanning 0 items` loop,
- a valid Saved return receipt after every item,
- no processed-ID update for a failed or pending item,
- exact processed-ID additions equal the full durable-success set,
- empty run-owned transfer, queue, and download-operation counts after Stop.

Read back the first, middle, and final durable objects through the Worker. Record canonical object key, size, content type, checksum when present, and successful media bytes/playback for the video sample.

- [ ] **Step 4: Record the Cloud-only lane**

Mark `cloud-only-sync: passed` only with at least 25 consecutive durable receipts, or every remaining eligible item if an independent Saved scan proves fewer than 25 existed before the lane. A timeout, manual navigation, inferred R2 status, or pending queue is not a pass.

- [ ] **Step 5: Prepare a non-destructive Dual-write folder**

Capture the current download folder exactly. Set Download Folder to `GrokVault/acceptance-$ACCEPTANCE_RUN_ID-dual` using the active run ID. Set mode to Dual-write and validate cloud config. Confirm at least three eligible Saved identities remain and are not in the Cloud-only lane set.

- [ ] **Step 6: Run Dual-write for three identities**

Start Sync and collect exactly three completed item receipts. For each identity require:

1. Chrome download reaches complete.
2. The local file exists in the run-specific folder and has nonzero bytes.
3. Images decode with `sips`; videos report a valid stream and duration with `ffprobe` and play locally.
4. R2 returns `uploaded` or `already_present` for the same normalized identity.
5. Worker readback matches media type and nonzero size.
6. The processed ID appears exactly once and only after both local completion and R2 presence.

After the third item returns to Saved and durability is `durable`, press Stop once.

- [ ] **Step 7: Restore Cloud-only mode and the original folder**

Restore the exact original download folder and Cloud-only mode. Re-run cloud config validation without a test upload. Leave the three run-specific local files in place as review evidence and report their folder; do not delete them without a separate instruction.

- [ ] **Step 8: Record the Dual-write lane**

Store redacted per-item local filename, byte count, media probe result, R2 key suffix, R2 size/type, persistence timestamp ordering, and return receipt. Mark `dual-write-sync: passed` only when all three identities satisfy both durability outcomes and settings restoration passes.

If either live lane required a code fix, rerun Task 9, Task 10, Task 11 when the fix touches shared Prompted controls/receipts, and both Task 12 lanes from fresh eligible identities.

---

### Task 13: Live Stop, Reload, And Context-invalidation Recovery

**Files:**
- Modify only after a live failure is reproduced by a red test: `content.js`, `background.js`, `tests/unit/contentContextInvalidation.test.js`, `tests/unit/retryManager.test.js`, `tests/unit/grokScraperNavigation.test.js`, or `tests/e2e/extension.spec.js`.
- Write ignored evidence: `acceptance/runs/$ACCEPTANCE_RUN_ID/stop-reload/`

**Interfaces:**
- Consumes: run tokens/epochs, scrape lease revocation, Prompted Batch cancellation checks, transfer abort controllers, Saved/results receipts, and direct extension reload URL.
- Produces: direct evidence of no late actions at five transition stages plus one clean reload and fresh restart.

- [ ] **Step 1: Use acceptance cloud for mutation-capable Stop probes**

Temporarily restore the validated acceptance Worker/prefix through the same secret-safe procedure used in Task 10. Capture production fingerprints first. Use one fresh acceptance correlation ID per Stop probe so any unexpected object is attributable.

- [ ] **Step 2: Stop during source targeting**

Start a one-item Sync and press Stop after the source is highlighted but before the card click. Require no detail/Agent navigation, transfer, queue item, download, or processed-ID delta.

- [ ] **Step 3: Stop during destination transition**

Start a fresh run, let the selected card open Agent or legacy detail, then press Stop before transfer begins. Require run authority revocation, bounded return to the original Saved receipt, no transfer, and no next-item click.

- [ ] **Step 4: Stop during Prompted Batch editor setup**

Start a one-item Prompted Batch from generated results and press Stop after Make Video/Add Prompt opens but before submit. Require no native submit click, no generation acceptance, no goal increment, a safe return to the results gallery when provable, and no late item advance.

- [ ] **Step 5: Stop during media transfer**

Start a fresh authenticated-video acceptance transfer and press Stop while the run-owned transfer task is active. Require the abort signal, cancellation of run-owned download/queue work, no processed-ID mutation, no retry detached from the revoked lease, and no resulting acceptance object.

- [ ] **Step 6: Stop during return navigation**

Start a fresh item, let its durable acceptance transfer finish, then press Stop while returning. Require at most one history/back action, no fallback navigation after a proven return, restored gallery position, and no next-item action. The already-durable item may retain its one processed ID.

- [ ] **Step 7: Reload the unpacked extension and refresh only the visible Grok page**

After every active workflow is stopped and queues are empty:

1. Open `chrome://extensions/?id=${LOADED_EXTENSION_ID}` with the recorded ID.
2. Reload only this extension.
3. Return to the visible Grok page and refresh only that page.
4. Confirm stale listeners fail quietly with one actionable refresh state.
5. Confirm exactly one overlay/controller/listener set initializes after refresh.
6. Open the direct extension error page for this ID and require no new uncaught `Extension context invalidated` errors or expected-refresh warning spam.
7. Run one short read/interaction smoke that does not create a production output and confirm popup and overlay state agree.

- [ ] **Step 8: Restore production settings**

Restore production Cloud-only fingerprints and validate. Confirm acceptance mode, Worker host, and key prefix are no longer active.

- [ ] **Step 9: Record the stop-reload lane**

Record stage, run suffix, action count before/after Stop, storage deltas, queue/operation counts, return result, screenshot, and extension error count for all five probes plus reload. Mark `stop-reload: passed` only if every probe has no unauthorized late action.

Any context-invalidation error from the new build requires a red regression test and rerun of Task 9, Task 10, and all Task 13 probes.

---

### Task 14: Full Production R2 Backup And Independent Exhaustion Proof

**Files:**
- Modify only after a live failure is reproduced by a red test: files owned by Tasks 2-8.
- Write ignored evidence: `acceptance/runs/$ACCEPTANCE_RUN_ID/full-production-backup/`
- Read only: production Worker inventory and object HEAD/media endpoints.

**Interfaces:**
- Consumes: production Cloud-only config, full backup R2 presence preflight, scan ledger, durability barrier, independent Saved observer, and reconciliation CLI.
- Produces: natural Saved exhaustion, empty queue, zero unresolved failures, complete Saved-to-R2 reconciliation, and a second independent scan with zero missing durable identities.

- [ ] **Step 1: Perform the final production go/no-go preflight**

Confirm:

- Tasks 9-13 are passed in the evidence workbook,
- production config fingerprints exactly match baseline,
- Grok is logged in on visible Saved All scope,
- no backup, sync, generation, download, upload, or cloud queue is active,
- processed IDs and cloud state have not been reset or manually altered,
- the Mac has adequate free disk, memory, and network headroom,
- no production Worker deploy, config change, R2 delete, D1 write tool, or manual object operation is pending.

If any check fails, record blocked and resolve the specific condition before starting.

- [ ] **Step 2: Run the independent pre-backup Saved enumeration**

On the visible Saved All page, inject only `acceptance/browser/saved-gallery-observer.js` into that target. Do not enumerate tabs. Run `observeSavedGallery`, which must:

- save the current scroll position,
- move the semantic gallery to the top,
- collect only normalized UUID identities through virtualization,
- require eight stable bottom rounds spanning at least six seconds,
- stop as blocked on 1,000 probes,
- restore the user's original scroll position.

Write the result to `saved-observer-before.json`. Require `exhausted: true`, a nonzero unique count, no duplicate identities, and no full media URLs or bytes in the artifact.

- [ ] **Step 3: Start Full Media Backup once and let it run to its own proven completion**

From the popup on visible Saved All scope, start Full Media Backup once. Do not start a second instance. Monitor:

- current Saved/Agent/legacy surface,
- source identity suffix,
- seen, uploaded, already-present, queued-total, current pending-transfer, and error counts,
- R2 inventory preflight and HEAD outcomes,
- gallery return and next expected identity,
- scan ledger unique count and stable-bottom rounds,
- run-owned transfer, queue, and download-operation counts,
- processed-ID deltas,
- extension/service-worker/popup errors,
- Mac resource pressure.

Historical processed IDs must not skip R2 verification. Already-present items must use inventory plus HEAD and must not fetch Grok media bytes. Missing items must follow the normal authenticated/public upload path and become durable before progress persists.

- [ ] **Step 4: Enforce failure handling during the long run**

On any ambiguous identity, repeated return failure, transfer failure, terminal retry, context invalidation, scan limit, or resource pressure that threatens the Mac:

1. Press Stop once.
2. Preserve the visible page and run artifacts.
3. Record the exact redacted identity suffix, surface, reason, queue state, and last successful receipt.
4. Add a deterministic regression before changing code.
5. Rerun Task 9 and every affected bounded live lane.
6. Restart Full Media Backup from Saved All. The R2 presence preflight must make already-completed items cheap and idempotent.

Never reset processed IDs or manually insert/delete an R2 object to continue.

- [ ] **Step 5: Require natural completion and queue drain**

Accept the extension's `complete` only when:

- the scan ledger has eight stable bottom rounds over at least six seconds,
- no semantic loader is visible,
- no return or transfer is in flight,
- `GET_SCRAPE_DURABILITY` is `durable`,
- `pendingTransfers` and run-owned queue-item counts are zero after drain; cumulative `queued` remains telemetry,
- unresolved error count is zero,
- scan-attempt limit was not hit.

Record final backup stats and compare `totalSeen` with the independent observer count. Explain any count difference by exact identity sets; do not dismiss it as virtualization noise.

- [ ] **Step 6: Run the independent post-backup Saved enumeration**

Run the same standalone observer again from top to stable bottom and write `saved-observer-final.json`. Require:

- `exhausted: true`,
- final unique identity set equal to the pre-backup set unless the gallery visibly changed during the run,
- every newly appeared identity explicitly identified and included in reconciliation,
- zero duplicate normalized identities.

If the set changed, rerun the backup for the delta and repeat the post-backup observer.

- [ ] **Step 7: Reconcile every Saved identity against paginated production inventory**

Run:

```bash
mise exec node@24 -- node --env-file=web/.env.local \
  acceptance/scripts/reconcile-production-vault.mjs \
  --observer "acceptance/runs/$ACCEPTANCE_RUN_ID/full-production-backup/saved-observer-final.json" \
  --output "acceptance/runs/$ACCEPTANCE_RUN_ID/full-production-backup/production-reconciliation.json"
```

Require:

- all inventory pages consumed with no repeated cursor,
- `missing` empty,
- `duplicateCanonical` empty,
- `unverified` empty,
- first, middle, and final identities confirmed by read-only object HEAD,
- one image and one video byte/playback readback when both exist,
- no unresolved backup error identity,
- no production object mutation outside the extension's missing-object upload path.

Treat legacy duplicate-key flags as explicit review evidence. Do not delete or move them in this scope.

- [ ] **Step 8: Prove zero eligible remainder with a second independent verification**

Compare the final Saved identity set with the verified R2 identity set and the extension's durable processed-ID set. The eligible remainder is:

```js
const eligibleRemainder = savedIdentities.filter((identity) => (
    !verifiedR2Identities.has(identity)
    || unresolvedTransferIdentities.has(identity)
));
```

Require `eligibleRemainder.length === 0`, an empty run-owned queue, and no in-flight operation. This independent calculation is the second verification scan; do not infer it from the extension's Complete label.

- [ ] **Step 9: Record the full production lane**

Record start/end times, observer counts and hashes, backup stats, R2 pagination count, reconciliation counts, sample object metadata, queue/operation final state, processed-ID delta, resource observations, and narrow screenshots. Mark `full-production-backup: passed` only when every natural-exhaustion and reconciliation condition passes.

---

### Task 15: State Restoration, Final Audit, Push, And Draft PR Update

**Files:**
- Modify only for verified release issues: files already owned by this plan.
- Write ignored evidence: `acceptance/runs/$ACCEPTANCE_RUN_ID/state-restoration/`
- Update existing remote branch: `origin/codex/grok-extension-recovery`
- Update existing draft PR: 11

**Interfaces:**
- Consumes: the complete extension recovery workbook and all local/live lane artifacts.
- Produces: final release-gate verdict, clean feature-branch push, and updated draft PR 11 without merge or ready-for-review transition.

- [ ] **Step 1: Restore every user setting and prove the fingerprints**

Restore and verify:

- extension mode is the original production mode,
- Worker host and API-key-present fingerprint match baseline,
- key prefix matches baseline,
- download folder matches baseline,
- Grok resolution and duration match baseline,
- popup and overlay are idle and agree,
- no acceptance run or prefix remains configured,
- cloud queue and pending download operations are empty,
- extension errors contain no new uncaught recovery error.

Do not delete the three run-specific Dual-write files or acceptance cloud objects. Report them for later review.

- [ ] **Step 2: Record `state-restoration` and evaluate the release gate**

Record the before/after fingerprints and mark `state-restoration: passed` only on exact match. Run the gate evaluator and require:

```js
{
    verdict: 'verified',
    missingLanes: [],
    failedLanes: [],
    blockedLanes: []
}
```

If any list is nonempty, stop. Do not push or update the PR as release-ready evidence.

- [ ] **Step 3: Rerun the complete deterministic gate after the final live fix**

Run each command separately:

```bash
npm run lint
npm run test:unit
npm run test:e2e
npm run package:extension
node --check background.js
node --check content.js
npm --prefix cloud run typecheck
npm --prefix cloud run test:acceptance
git diff --check
```

All must exit 0 after the last code change. Update the deterministic lane with final command counts and checksums.

- [ ] **Step 4: Perform the final skeptic review**

Inspect `git diff origin/codex/grok-extension-recovery...HEAD` for:

- raw secrets, auth headers, cookies, signed URLs, `.env` files, or private prompt/media URLs,
- debug `console.log`, `console.warn`, `debugger`, commented-out code, or new FIXME markers,
- weakened assertions or tests that only prove clicks instead of outcomes,
- dead exports and unconsumed helpers,
- unexpected dependencies, lockfile changes, binaries, screenshots, editor files, or `.DS_Store`,
- production Worker config, R2/D1 binding, OAuth, processed-ID fixture, or cloud-state changes,
- accidental changes to `None` or the protected August 11 plan.

Fix clear release defects through a red test and small semantic commit. List debatable findings in the PR update rather than deciding silently.

- [ ] **Step 5: Scan staged and committed changes for secrets**

Use Git diff plus the repo's existing redaction patterns. Inspect every match manually. Require no `.env` path, API key value, bearer value, cookie, OAuth credential, Worker secret, signed URL, or private media URL in commits or evidence selected for PR discussion.

- [ ] **Step 6: Confirm final Git state and push only the feature branch**

```bash
git status --short --branch
git log --oneline origin/codex/grok-extension-recovery..HEAD
git push origin codex/grok-extension-recovery
```

Expected: push succeeds to the feature branch only. The protected untracked files remain local and untouched. Never push `main`.

- [ ] **Step 7: Verify existing draft PR 11 before mutation**

Verify PR 11 still targets `main`, is open, and is draft:

```bash
gh pr view 11 --json number,url,isDraft,state,baseRefName,headRefName
```

Expected: PR 11 targets `main`, uses `codex/grok-extension-recovery` as head, is open, and remains draft. Stop on any mismatch.

- [ ] **Step 8: Update the existing draft PR**

Update its semantic title and concise body. The body must start with `This PR...`, describe restored Prompted Batch, Saved sync, mode-aware durability, conservative exhaustion, and read-only R2 presence proof, and state the final verified lane results without exposing artifact secrets. Do not add a test-plan heading, mark ready, or merge.

- [ ] **Step 9: Open the draft PR and stop**

```bash
gh pr view 11 --web
```

Report:

- feature-branch commit range and pushed ref,
- actual final unit/E2E counts and every gate result,
- each live lane count and verdict,
- acceptance isolation result,
- production observer/inventory/reconciliation counts,
- state-restoration proof,
- retained Dual-write evidence folder and acceptance prefix,
- any residual review flags,
- draft PR URL.

Do not merge, mark ready, delete evidence, clean acceptance objects, reset processed IDs, or start new work.
