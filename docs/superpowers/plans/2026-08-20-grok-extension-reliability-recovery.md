# Grok Extension Reliability Recovery Implementation Plan

> For agentic workers: use subagent-driven development or executing-plans task by task. Keep one worker responsible for one task, then run a separate review before integrating it.

Goal: Restore Quick Batch, Prompted Batch, Video Goal, Recreate, and complete multi-asset Sync with durable state and live proof.

Architecture: Add one current-Grok DOM adapter, one background-owned generation run controller, and one bounded conversation asset inventory operation. Keep the existing Sync lease and transfer durability machinery. Replace click-based progress with provider receipts and stable serializable identities.

Tech stack: Chrome Extension Manifest V3, raw JavaScript, Chrome storage, current page bridge, Jest/jsdom, Playwright Chromium, existing Cloudflare/R2 integration.

Spec: `docs/superpowers/specs/2026-08-20-grok-extension-reliability-recovery-design.md`

## Execution Constraints

- Work on `codex/grok-extension-recovery`. Never edit, push, or merge `main`.
- Before editing, fetch and verify the current branch still contains `35f6bc7`; stop on unexpected divergence or dirty runtime files.
- Leave the existing untracked `None` file and `docs/superpowers/plans/2026-08-11-grok-imagine-2-compatibility-recovery.md` untouched.
- Do not push, update a PR, or create a PR until every required release lane passes.
- Scope is the extension. Do not edit `web/`, Cloud Worker routes/config, env files, OAuth, R2/D1 bindings, processed-ID values, or cloud objects.
- Never enumerate Chrome tabs. Use one controlled tab in the existing logged-in Chrome session.
- Do not start generation, Sync, R2 backup, download, upload, or processed-ID mutation without the live-lane preflight and explicit approval required by the spec.
- Preserve current settings and restore anything temporarily changed for validation.
- After each implementation task, update the running implementation notes with decisions, deviations, tradeoffs, and open questions.

## Current Baseline

The planning sweep ran against `codex/grok-extension-recovery` at `35f6bc7`:

- `npm run lint`: passed.
- `npm run test:unit -- --runInBand`: 30 suites and 902 tests passed, but the run emitted a background initialization `console.error` and therefore is not a clean reliability signal.
- `npm run test:e2e`: 48 mocked Playwright tests passed.
- Quick Batch has no multi-item unit or Playwright coverage.
- Existing Prompted coverage contains a click-without-acceptance success path.
- Live read-only Saved inspection confirmed current stable post/asset identity candidates and multiple cards sharing one conversation ID.

These results are baseline evidence only. They do not prove any broken live workflow works.

## File Map

Create:

- `grokImagineAdapter.js`: current Grok surface, gallery descriptor, target resolution, submission receipt, and result recognition helpers.
- `generationRunState.js`: generation run/item schemas and pure reducer.
- `generationRunController.js`: background storage, lease, claims, retries, and cancellation.
- `tests/unit/grokImagineAdapter.test.js`
- `tests/unit/generationRunState.test.js`
- `tests/unit/generationRunController.test.js`
- `tests/unit/grokConversationAssetInventory.test.js`
- `tests/e2e/fixtures/grok-imagine-2.js`: provider fixture with remount, navigation, capacity, rejection, and multi-asset behavior.
- `docs/superpowers/plans/2026-08-20-grok-extension-reliability-recovery-implementation-notes.html`

Modify:

- `manifest.json`: load new content helpers before `content.js` and package them.
- `tools/package-extension.js`: include new runtime files if the package allowlist is explicit.
- `background.js`: import the generation modules, include new content helpers in direct reinjection, route generation messages, enforce workflow exclusion, and expose durable status.
- `content.js`: use adapter descriptors and the background run protocol; replace old Quick, Prompted, and Goal progress logic; integrate shared result recognition; use per-asset Sync inventory.
- `bridge.js`: add bounded sanitized conversation asset inventory without changing exact-asset metadata behavior.
- `popup.js`: show active conflicting workflow and authoritative generation/Sync status only if tests prove the current UI needs it.
- `popup.html`: add no new control unless the Retry Failed action cannot fit the overlay; prefer the overlay.
- `recreateWorkflowContent.js`: shared source/result adapter and abort checks.
- `recreateWorkflowBackground.js`: abortable pending message operations and terminal cancellation acknowledgement.
- `tests/unit/retryManager.test.js`
- `tests/unit/grokScraperNavigation.test.js`
- `tests/unit/grokScraperBackup.test.js`
- `tests/unit/bridge.test.js`
- `tests/unit/recreateWorkflowContent.test.js`
- `tests/unit/recreateWorkflowBackground.test.js`
- `tests/unit/backgroundRecreateWorkflow.test.js`
- `tests/unit/providerOverlay.test.js`
- `tests/unit/manifestProviderCoverage.test.js`
- `tests/unit/releasePackage.test.js`
- `tests/e2e/extension.spec.js`

Do not modify unless a failing scoped test proves it necessary:

- `cloudSyncUtils.js`
- `providerRegistry.js`
- `providerRunLedger.js`
- `chatgptImagesContent.js`
- `popup.css`
- `overlay.css`

## Shared Runtime Contracts

```js
// generationRunState.js
createGenerationRun({ kind, ownerTabId, origin, items, prompt, options, now })
reduceGenerationRun(state, event)
getNextGenerationClaim(state)
sanitizeGenerationRun(state)

// generationRunController.js
startGenerationRun(request, sender)
claimGenerationAction(request, sender)
reportGenerationAction(request, sender)
retryFailedGenerationItems(request, sender)
cancelGenerationRun(request, sender)
getGenerationRunStatus(request, sender)

// content/background messages
GENERATION_RUN_START
GENERATION_RUN_CLAIM
GENERATION_RUN_REPORT
GENERATION_RUN_RETRY_FAILED
GENERATION_RUN_CANCEL
GENERATION_RUN_STATUS

// bridge.js/content.js
fetchGrokConversationAssetInventory(conversationId)
```

Generation report events are allowlisted:

```js
{
    runId,
    epoch,
    itemId,
    claimId,
    outcome: 'accepted' | 'completed' | 'capacity' | 'retryable_failed' |
        'permanent_failed' | 'cancelled',
    failureCode: '',
    receipt: {
        sourceAssetId,
        sourcePostId,
        observedState,
        observedAt
    }
}
```

The controller rejects stale run IDs, epochs, claims, owner tabs, and impossible state transitions.

## Task 1: Capture The Baseline And Freeze Failure Fixtures

Files:

- Create `docs/superpowers/plans/2026-08-20-grok-extension-reliability-recovery-implementation-notes.html`.
- Create `tests/e2e/fixtures/grok-imagine-2.js`.
- Modify `tests/unit/retryManager.test.js`.
- Modify `tests/e2e/extension.spec.js`.

- [ ] Record branch, HEAD, upstream, `git status --short`, manifest version, current extension ID/source path fingerprint, and current popup settings without secret values.
- [ ] Verify no generation, Sync, backup, upload, or download is active before any live observation.
- [ ] Use one controlled Chrome tab to capture sanitized current DOM shapes for results, Saved, Agent/detail, Make Video, Add Prompt, composer, capacity, progress, rejection, and generated result states. Do not enumerate tabs.
- [ ] Add fixture helpers that use stable asset/post/conversation IDs and can remount all cards after each accepted action.
- [ ] Add a failing unit test proving a three-item Quick queue stops after the first card remounts under the current live-node implementation.
- [ ] Add a failing Playwright test for ten Quick items where every accepted action remounts the gallery.
- [ ] Add a failing Prompted test proving `acceptance_unproven` is not success even when gallery return succeeds.
- [ ] Add failing tests for hard-navigation resume, Retry Failed, Goal completion identity, Recreate Stop, and one conversation containing multiple assets.
- [ ] Run only the new tests and confirm each fails for the intended behavioral reason, not fixture setup.

Commands:

```bash
npm run test:unit -- --runInBand tests/unit/retryManager.test.js
npx playwright test tests/e2e/extension.spec.js --grep "durable generation recovery"
```

Commit after the red tests and fixture review:

```bash
git add tests/e2e/fixtures/grok-imagine-2.js tests/unit/retryManager.test.js tests/e2e/extension.spec.js docs/superpowers/plans/2026-08-20-grok-extension-reliability-recovery-implementation-notes.html
git commit -m "test(extension): capture current Grok workflow failures"
```

## Task 2: Add The Current Grok Adapter

Files:

- Create `grokImagineAdapter.js`.
- Create `tests/unit/grokImagineAdapter.test.js`.
- Modify `manifest.json`.
- Modify `tools/package-extension.js` if required by its allowlist.
- Modify `tests/unit/manifestProviderCoverage.test.js`.
- Modify `tests/unit/releasePackage.test.js`.

- [ ] Write failing adapter tests for current results, Saved, Agent, legacy detail, unsupported pages, multiple cards sharing one conversation, duplicate asset IDs, ambiguous action controls, inserted generated videos, and remounted cards.
- [ ] Implement UMD/CommonJS exports matching the repo's existing raw-script helpers.
- [ ] Return serializable descriptors only. Reject raw DOM nodes and signed URL query strings in descriptor normalization.
- [ ] Resolve one current card by asset ID plus post ID. Treat conversation ID as metadata scope only.
- [ ] Resolve direct Quick/Goal Make Video separately from Prompted Make Video and Add Prompt.
- [ ] Add submission receipt capture and evaluation. Require matching source progress/job evidence for `accepted`.
- [ ] Add generated-result diffing that rejects stale pre-run videos and ambiguous new results.
- [ ] Load `grokImagineAdapter.js` before recreate/content scripts in `manifest.json`.
- [ ] Add `grokImagineAdapter.js` to `background.js` direct content-script reinjection in the same order.
- [ ] Include it in release packaging.
- [ ] Run adapter, manifest, package, and lint gates.

Commands:

```bash
npm run test:unit -- --runInBand tests/unit/grokImagineAdapter.test.js tests/unit/manifestProviderCoverage.test.js tests/unit/releasePackage.test.js
npm run lint
npm run package:extension
```

Commit:

```bash
git add grokImagineAdapter.js background.js manifest.json tools/package-extension.js tests/unit/grokImagineAdapter.test.js tests/unit/manifestProviderCoverage.test.js tests/unit/releasePackage.test.js
git commit -m "feat(extension): add current Grok workflow adapter"
```

## Task 3: Add Durable Generation State And Authority

Files:

- Create `generationRunState.js`.
- Create `generationRunController.js`.
- Create `tests/unit/generationRunState.test.js`.
- Create `tests/unit/generationRunController.test.js`.
- Modify `background.js`.
- Modify `manifest.json`.
- Modify `tests/unit/manifestProviderCoverage.test.js`.
- Modify `tests/unit/releasePackage.test.js`.

- [ ] Write reducer tests for every run and item state transition, invalid transitions, retry limits, accepted-item idempotency, capacity, failure continuation, Retry Failed, completion, cancellation, and reload hydration.
- [ ] Write controller tests for one owner tab, one active generation run, stale claim rejection, serialized storage writes, owner reload, service-worker restart, and mutual exclusion with Sync/Recreate.
- [ ] Store one active generation lease in `chrome.storage.session` and one redacted journal in `chrome.storage.local`.
- [ ] Generate unique run, epoch, item, and claim IDs without using provider data.
- [ ] Allow one outstanding claim at a time. Expired claims return to retryable state without duplicating accepted items.
- [ ] Make cancel revoke the lease before notifying content. Wait for bounded in-flight acknowledgement and persist terminal state.
- [ ] Route the six `GENERATION_RUN_*` messages through background readiness.
- [ ] Reject prompt/receipt fields that contain data URLs, signed query strings, headers, tokens, or oversized content.
- [ ] Add startup hydration tests that fail on unexpected background initialization errors.
- [ ] Remove the current green-with-console-error test condition by making background initialization explicit under Jest or by supplying the correct harness mock. Do not hide `console.error`.

Commands:

```bash
npm run test:unit -- --runInBand tests/unit/generationRunState.test.js tests/unit/generationRunController.test.js tests/unit/backgroundRecreateWorkflow.test.js
npm run lint
node --check background.js
node --check generationRunState.js
node --check generationRunController.js
```

Commit:

```bash
git add generationRunState.js generationRunController.js background.js manifest.json tests/unit/generationRunState.test.js tests/unit/generationRunController.test.js tests/unit/backgroundRecreateWorkflow.test.js tests/unit/manifestProviderCoverage.test.js tests/unit/releasePackage.test.js
git commit -m "feat(extension): persist generation run authority"
```

## Task 4: Rebuild Quick Batch On Stable Descriptors

Files:

- Modify `content.js`.
- Modify `tests/unit/retryManager.test.js`.
- Modify `tests/e2e/extension.spec.js`.

- [ ] Replace `buildBatchQueue()` output for Quick with adapter descriptors capped by Gallery Limit.
- [ ] Remove recursive processing of stored `{ button, container }` nodes.
- [ ] Start a `quick_batch` generation run and claim one descriptor at a time.
- [ ] Reacquire the card and direct Make Video action immediately before each click.
- [ ] Use the existing full native pointer/debugger click path. Do not use bare `.click()` as the production action.
- [ ] Capture pre-action state, report accepted only on matching provider progress/job evidence, and report capacity separately.
- [ ] Continue after acceptance without waiting for completed output.
- [ ] Retry bounded transient failures, keep permanent failures visible, and implement Retry Failed without replaying accepted items.
- [ ] Keep scrolling/discovery bounded by Gallery Limit and stable identity dedupe.
- [ ] Make completion text show accepted, failed, and pending counts.
- [ ] Pass the ten-item remount Playwright test, plus Stop before click, during acceptance wait, and after acceptance.

Commands:

```bash
npm run test:unit -- --runInBand tests/unit/retryManager.test.js tests/unit/generationRunController.test.js
npx playwright test tests/e2e/extension.spec.js --grep "Quick Batch"
npm run lint
```

Commit:

```bash
git add content.js tests/unit/retryManager.test.js tests/e2e/extension.spec.js
git commit -m "fix(extension): make Quick Batch remount safe"
```

## Task 5: Move Prompted Batch To The Durable Run

Files:

- Modify `content.js`.
- Modify `tests/unit/retryManager.test.js`.
- Modify `tests/e2e/extension.spec.js`.

- [ ] Route results, Saved, and detail Prompted Batch starts through `prompted_batch` run creation.
- [ ] Persist prompt, Video Goal/Gallery Limit semantics, source descriptor, and origin receipt before navigation.
- [ ] Resume after SPA navigation, hard navigation, content reinjection, or service-worker restart by claiming the same pending item.
- [ ] Resolve Make Video then Add Prompt within the selected source. Fail if Precise Edit is the only or ambiguous action.
- [ ] Scope prompt injection and submit to the resolved composer.
- [ ] Delete the false-success path that accepts a trusted click without provider acceptance evidence.
- [ ] Count only matching accepted state, return to the proven origin, then continue without waiting for output completion.
- [ ] On bounded failure, retry up to Max Retries, then continue and expose Retry Failed.
- [ ] Preserve accepted items when return recovery uses direct origin navigation.
- [ ] Add explicit `Resume Run`, `Retry Failed`, and `Cancel Run` states to the existing overlay controls without redesigning the panel.
- [ ] Pass twelve-item results, eight-item Saved, inserted-video, source-replacement, capacity, hard-navigation, reload, retry, and Stop tests.

Commands:

```bash
npm run test:unit -- --runInBand tests/unit/retryManager.test.js tests/unit/generationRunState.test.js tests/unit/generationRunController.test.js
npx playwright test tests/e2e/extension.spec.js --grep "Prompted Batch"
npm run lint
```

Commit:

```bash
git add content.js tests/unit/retryManager.test.js tests/e2e/extension.spec.js
git commit -m "fix(extension): make Prompted Batch resumable"
```

## Task 6: Repair Video Goal Without Changing Its Semantics

Files:

- Modify `content.js`.
- Modify `tests/unit/retryManager.test.js`.
- Modify `tests/e2e/extension.spec.js`.

- [ ] Add failing tests showing legacy `Video Options` counting accepts stale output and detached target context stops the goal.
- [ ] Require one selected Agent/detail source before starting. Reject gallery-wide implicit targeting.
- [ ] Start a `video_goal` durable run with one descriptor and the requested completed-output count.
- [ ] Resolve the current direct Make Video action through the adapter for every attempt.
- [ ] Prove provider acceptance, then wait for one new matching playable result before incrementing the goal.
- [ ] Apply Auto-Retry and Max Retries to censored/transient failures. Do not count stale or unrelated video elements.
- [ ] Cancel pending waits and prevent late retries after Stop or reload ownership loss.
- [ ] Pass three-output, one-failure-retry, stale-output, ambiguous-result, reload, and Stop tests.

Commands:

```bash
npm run test:unit -- --runInBand tests/unit/retryManager.test.js tests/unit/grokImagineAdapter.test.js
npx playwright test tests/e2e/extension.spec.js --grep "Video Goal"
npm run lint
```

Commit:

```bash
git add content.js tests/unit/retryManager.test.js tests/e2e/extension.spec.js
git commit -m "fix(extension): verify Video Goal outputs"
```

## Task 7: Repair Recreate Current, Results, Retry, And Stop

Files:

- Modify `recreateWorkflowContent.js`.
- Modify `recreateWorkflowBackground.js`.
- Modify `content.js`.
- Modify `tests/unit/recreateWorkflowContent.test.js`.
- Modify `tests/unit/recreateWorkflowBackground.test.js`.
- Modify `tests/unit/backgroundRecreateWorkflow.test.js`.
- Modify `tests/e2e/extension.spec.js`.

- [ ] Add failing tests for current selected Agent image/video capture, current visible detail capture, result recognition on current Grok, retry with retained reference, and Stop during capture/chat/Imagine/result wait.
- [ ] Use the adapter to identify exactly one current source and the existing page bridge to fetch authenticated bytes.
- [ ] Snapshot results before submit and require one new matching playable result after submit.
- [ ] Thread an abort signal through content waits and background message waits.
- [ ] Make abort revoke authority immediately and settle the UI as `Cancelled` within a bounded timeout.
- [ ] Ignore late chat/Imagine responses after cancellation.
- [ ] Retain a valid reference after retryable failure and expose Retry without duplicate submission.
- [ ] Preserve redacted diagnostics and existing file/drop/paste/URL validation.
- [ ] Pass real-controller Playwright tests. Do not replace actions with test-only mocks for the acceptance path.

Commands:

```bash
npm run test:unit -- --runInBand tests/unit/recreateWorkflowContent.test.js tests/unit/recreateWorkflowBackground.test.js tests/unit/backgroundRecreateWorkflow.test.js
npx playwright test tests/e2e/extension.spec.js --grep "Recreate"
npm run lint
```

Commit:

```bash
git add recreateWorkflowContent.js recreateWorkflowBackground.js content.js tests/unit/recreateWorkflowContent.test.js tests/unit/recreateWorkflowBackground.test.js tests/unit/backgroundRecreateWorkflow.test.js tests/e2e/extension.spec.js
git commit -m "fix(extension): make Recreate cancellable and verifiable"
```

## Task 8: Add Authoritative Multi-Asset Conversation Inventory

Files:

- Modify `bridge.js`.
- Create `tests/unit/grokConversationAssetInventory.test.js`.
- Modify `tests/unit/bridge.test.js`.
- Modify `content.js`.
- Modify `tests/unit/grokScraperNavigation.test.js`.
- Modify `tests/unit/grokScraperBackup.test.js`.
- Modify `tests/e2e/extension.spec.js`.

- [ ] Write parser tests for response arrays in both supported payload shapes, every `fileAttachmentAssetMetadata` entry, image/video classification, duplicate agreement, duplicate conflict, unsupported media hosts, missing URLs, prompt ambiguity, item cap, and serialized-size cap.
- [ ] Extract a shared sanitized response/asset parser in `bridge.js` while preserving exact `buildAssetCaptureMetadata` output.
- [ ] Add a new UUID-gated request/result event for conversation inventory.
- [ ] Return all unique assets in stable response/asset order with only allowlisted fields.
- [ ] Add a content helper with timeout, context-invalidation handling, and strict schema validation.
- [ ] Before opening a Saved card, fetch inventory and prove the visible asset belongs to it.
- [ ] Process each inventory asset through the existing exact transfer and durability paths.
- [ ] Persist each authoritative asset UUID through the background's existing serialized `processedIds` ownership only after durability succeeds. Never reset or delete existing IDs.
- [ ] Extend the active scrape run mirror with bounded conversation ID, inventory hash, asset IDs, and next-asset cursor so a reload resumes without a second permanent ledger.
- [ ] Treat legacy Saved post/preview IDs as compatibility hints only; never let one visible preview suppress undiscovered siblings.
- [ ] Derive conversation completion by comparing the authoritative inventory to background-owned processed IDs. Mark it complete only after every asset is durable or explicitly terminal failed for the current run.
- [ ] Require Saved exhaustion and zero pending inventory/transfers before run completion.
- [ ] Replace the E2E assertion that requires zero thumbnail activity with exact inventory transfer assertions. Do not restore thumbnail clicking.
- [ ] Pass one-image, four-image, mixed image/video, duplicate, partial failure/retry, reload, Stop, and two-conversation reconciliation tests.

Commands:

```bash
npm run test:unit -- --runInBand tests/unit/grokConversationAssetInventory.test.js tests/unit/bridge.test.js tests/unit/grokScraperNavigation.test.js tests/unit/grokScraperBackup.test.js
npx playwright test tests/e2e/extension.spec.js --grep "multi-asset|Start Sync|Full Media Backup"
npm run lint
node --check bridge.js
```

Commit:

```bash
git add bridge.js content.js tests/unit/grokConversationAssetInventory.test.js tests/unit/bridge.test.js tests/unit/grokScraperNavigation.test.js tests/unit/grokScraperBackup.test.js tests/e2e/extension.spec.js
git commit -m "fix(extension): sync every Saved conversation asset"
```

## Task 9: Enforce Workflow Exclusion And Recovery UX

Files:

- Modify `background.js`.
- Modify `content.js`.
- Modify `popup.js` only if required by the failing tests.
- Modify `tests/unit/providerOverlay.test.js`.
- Modify `tests/unit/popupContent.test.js`.
- Modify `tests/unit/generationRunController.test.js`.
- Modify `tests/e2e/extension.spec.js`.

- [ ] Add failing tests for attempts to start Quick/Prompted/Goal/Recreate while Sync is active and attempts to start Sync while generation/Recreate is active.
- [ ] Add one authoritative active-workflow query returning kind, status, counts, and safe recovery actions.
- [ ] Disable conflicting start controls and name the active workflow.
- [ ] Ensure Stop targets only the active workflow lease and waits for acknowledged terminal state.
- [ ] Restore controls after complete/cancel/failure without page reload.
- [ ] Ensure context invalidation shows one actionable refresh message and no warning/error-page spam.
- [ ] Keep ChatGPT Images controls isolated and unchanged.

Commands:

```bash
npm run test:unit -- --runInBand tests/unit/generationRunController.test.js tests/unit/providerOverlay.test.js tests/unit/popupContent.test.js tests/unit/contentContextInvalidation.test.js
npx playwright test tests/e2e/extension.spec.js --grep "workflow exclusion|context invalidation"
npm run lint
```

Commit:

```bash
git add background.js content.js popup.js tests/unit/generationRunController.test.js tests/unit/providerOverlay.test.js tests/unit/popupContent.test.js tests/e2e/extension.spec.js
git commit -m "fix(extension): coordinate active workflow recovery"
```

## Task 10: Protect Every Remaining Extension Surface

Files:

- Modify `tests/unit/promptHistoryManager.test.js`.
- Modify `tests/unit/savedPrompts.test.js`.
- Modify `tests/unit/providerOverlay.test.js`.
- Modify `tests/unit/popupContent.test.js`.
- Modify `tests/e2e/extension.spec.js`.
- Modify runtime files only when a new failing regression test proves a repair is necessary.

- [ ] Add one behavior test and one visible-control smoke for prompt history, saved prompts, Auto-Retry, Template Batch, Quality Repeat, inline repeat, popup setting persistence, cloud validation, Retry Unsynced, Backfill safety copy, canary/full-backup gating, reset confirmation, and ChatGPT provider isolation.
- [ ] Verify prompt input/history still feed Prompted Batch without duplicating or clearing the user's prompt.
- [ ] Verify Template Batch remains API-driven and Stop prevents later submissions.
- [ ] Verify Quality Repeat counts actual new result sets instead of a button disappearance alone. If current behavior fails the new fixture, repair it through adapter result receipts.
- [ ] Verify popup API key remains masked and no test logs secret-bearing config.
- [ ] Verify reset processed IDs remains explicit and is never called by recovery code.
- [ ] Fail the E2E run on unexpected page errors, service-worker errors, uncaught rejections, `Extension context invalidated`, or extension error-page entries.

Commands:

```bash
npm run test:unit -- --runInBand tests/unit/promptHistoryManager.test.js tests/unit/savedPrompts.test.js tests/unit/providerOverlay.test.js tests/unit/popupContent.test.js
npx playwright test tests/e2e/extension.spec.js --grep "extension regression matrix"
npm run lint
```

Commit only the files proven necessary:

```bash
git add tests/unit/promptHistoryManager.test.js tests/unit/savedPrompts.test.js tests/unit/providerOverlay.test.js tests/unit/popupContent.test.js tests/e2e/extension.spec.js
git commit -m "test(extension): guard remaining operator workflows"
```

## Task 11: Run Deterministic Release Gates And Skeptical Review

- [ ] Run all root extension gates without filtering.
- [ ] Require zero failed tests and zero unexpected console/page/service-worker errors.
- [ ] Check package contents and syntax.
- [ ] Review `git diff origin/main...HEAD` for debug code, new unfinished-work markers, commented-out paths, obsolete selectors, duplicate run controllers, dead exports, weakened assertions, large binaries, env files, secrets, and unrelated web/cloud changes.
- [ ] Search separately for old direct references, string references, test/mocks, manifest order, reinjection lists, package allowlists, and CommonJS exports for every renamed/replaced function.
- [ ] Confirm no test still treats click dispatch, navigation return, or button disappearance as provider success.
- [ ] Confirm no queue persists DOM nodes or signed URLs.
- [ ] Confirm no accepted item can be retried or duplicated.
- [ ] Confirm no failed asset can update processed IDs or active conversation completion.

Commands:

```bash
npm run lint
npm run test:unit -- --runInBand
npm run test:e2e
npm run package:extension
node --check background.js
node --check content.js
node --check bridge.js
node --check grokImagineAdapter.js
node --check generationRunState.js
node --check generationRunController.js
git diff --check
git status --short
```

Do not commit a blanket cleanup. Fix each clear problem in a small semantic commit and rerun the affected gates.

## Task 12: Live Quick And Prompted Acceptance

This task spends Grok video credits. Pause for explicit approval after reporting the exact source gallery, item counts, current lowest resolution, current shortest duration, and absence of competing work.

- [ ] Reload only the unpacked extension from its direct extension page, then refresh only the controlled Grok tab.
- [ ] Clear extension errors and capture a redacted baseline.
- [ ] Set current Grok video output to its lowest offered resolution and shortest offered duration. Record prior values for restoration.
- [ ] Run Quick Batch for 10 eligible gallery items.
- [ ] Prove 10 distinct source asset IDs reached provider-accepted state, no item duplicated, the grid remounted without stopping, and the run ended with zero pending items.
- [ ] Run Prompted Batch for 12 result items with one neutral low-cost motion prompt.
- [ ] Prove Add Prompt was used, Precise Edit was not used, each distinct source was accepted, and the loop did not wait for completed videos.
- [ ] Run Prompted Batch for 8 Saved items and prove source navigation, return, and continuation.
- [ ] Exercise Retry Failed using one real provider rejection or a safely induced transient interruption. Prove accepted items are not replayed.
- [ ] Restore video settings.
- [ ] Confirm no new extension/page/service-worker errors.

If any item is ambiguous, stop the run, preserve the page, record redacted evidence, add a failing deterministic regression, repair, rerun all dependent gates, and restart this lane from a fresh run ID.

## Task 13: Live Video Goal And Recreate Acceptance

This task spends generation credits. Pause for explicit approval after reporting exact bounded counts and absence of competing work.

- [ ] Select one known generated source and run Video Goal for three completed outputs at the lowest current cost settings.
- [ ] Prove each output is new, belongs to the source/run, loads, and plays.
- [ ] Exercise one retry path when a real failure occurs. Do not manufacture moderation-triggering content.
- [ ] Run Recreate Current from one selected image and verify a new playable result.
- [ ] Run Recreate from one small local image fixture and verify a new playable result.
- [ ] Start one bounded Recreate run and press Stop during a pending phase. Prove terminal `Cancelled` and no late result/submission.
- [ ] Retry one failed Recreate without reselecting the valid reference.
- [ ] Confirm no extension/page/service-worker errors and restore settings.

## Task 14: Live Sync And Multi-Asset Acceptance

This task may create local downloads or production R2 writes depending on current popup mode. Pause for explicit approval after reporting current mode, masked config validity, processed-ID count/hash, queue state, exact bounded scope, and absence of competing work.

- [ ] From Saved `All`, run Start Sync for 25 consecutive Saved entries, crossing at least one virtualization boundary.
- [ ] Record redacted card, conversation, asset, and durability receipts. Never record media URLs with query strings.
- [ ] Include at least two known multi-asset conversations. Compare bridge inventory count and asset IDs to durable transfer receipts exactly.
- [ ] Prove every image/video asset in those inventories is durable or explicitly failed and retryable.
- [ ] Prove no failed transfer updates `processedIds` or active conversation completion.
- [ ] Stop after the bounded lane and prove no twenty-sixth transfer wins after Stop acknowledgement.
- [ ] Reload during a separate bounded Sync run and prove authority resumes once without duplicate transfer.
- [ ] Confirm no Agent-mode gallery scroll, zero-item loop, duplicate asset, or extension error.
- [ ] Restore popup settings and compare non-secret fingerprints to the baseline.

Do not start Full Media Backup in this task.

## Task 15: Full Production Backup Completion

This task can perform a long production R2 operation. Pause for separate explicit approval after all bounded lanes pass and after reporting current cloud mode, validated masked config, processed-ID count/hash, queue state, expected remaining scope, disk/network state, and absence of competing work.

- [ ] Start Full Media Backup once from Saved `All` in the existing controlled Chrome tab.
- [ ] Let it run to a real terminal state. Do not stop at an arbitrary count or infer completion from a quiet viewport.
- [ ] Require Saved-gallery exhaustion, zero pending inventory items, zero pending transfer/download/upload operations, and zero unclassified errors.
- [ ] For every visited conversation, prove the authoritative inventory is fully represented by durable processed asset IDs or an explicit failed item report.
- [ ] Sample media access beyond the first inventory page and include both an image and video when available.
- [ ] Reconcile final unique asset counts against the paginated Vault inventory without printing object URLs or secrets.
- [ ] If any item fails, preserve it as retryable, run Retry Unsynced or a bounded targeted rerun only when the failure class calls for it, and reprove terminal state.
- [ ] Confirm no duplicate object write, manual cloud object change, processed-ID loss, Agent gallery scan, zero-item loop, or extension error.
- [ ] Restore all settings and prove no workflow remains active.

Do not call this lane passed if it is stopped, times out, loses Chrome login, has an unverified failed asset, or cannot prove gallery exhaustion.

## Task 16: Full Regression Soak And Delivery Gate

- [ ] Run the operator regression smoke for prompt history, saved prompts, Auto-Retry, Template Batch, Quality Repeat, popup settings/cloud validation, Retry Unsynced, Backfill controls, canary/full backup controls, processed-ID reset safety, and ChatGPT Images isolation.
- [ ] Confirm no run is active, all temporary settings are restored, and extension errors remain clear.
- [ ] Run the deterministic release gates again after live work.
- [ ] Update implementation notes with every design decision, deviation, tradeoff, live failure, repair, rerun, and unresolved question.
- [ ] Scan changed and staged content for API keys, cookies, authorization headers, bearer strings, OAuth values, signed URLs, env files, data URLs, and personal media.
- [ ] Confirm `web/`, Cloud Worker runtime/config, env, OAuth, R2/D1 config, canonical processed IDs, and cloud objects were not manually changed.
- [ ] Do not push until all required lanes are `passed`. `blocked`, `not_run`, skipped, or inferred is not pass.
- [ ] Push only `codex/grok-extension-recovery` after the gate passes, then update its existing draft PR if one is still open. Do not create another PR, mark ready, merge, or push main.

Final delivery report must distinguish:

- deterministic tests passed/failed/not run;
- each live lane passed/failed/blocked/not run;
- exact generation submissions and completed outputs;
- exact Saved entries and authoritative assets reconciled;
- retries, failures, and duplicates;
- settings restored;
- files and systems untouched;
- branch commit and remote ref.

## Failure Coverage Matrix

- Quick stops after the first success: Task 1 adds the remount red tests, Task 4 replaces DOM-node queues, and Task 12 proves 10 distinct accepted items.
- Prompted stops around 6-7 items and cannot retry: Task 1 rejects false acceptance, Task 5 adds durable continuation and Retry Failed, and Task 12 proves results plus Saved runs.
- Prompted waits for completed videos: Task 5 advances on accepted submission, and Task 12 verifies overlapping in-flight generation.
- Start Video Goal does nothing or counts stale state: Task 6 binds one source and counts new playable outputs, and Task 13 proves three outputs.
- Recreate Current, result wait, retry, and Stop are broken: Task 7 adds shared source/result proof and cancellation, and Task 13 exercises Current, local file, retry, and Stop.
- Sync captures only the visible preview: Task 8 adds authoritative conversation inventory, Task 14 reconciles two multi-asset conversations, and Task 15 runs full production completion.
- Navigation, reload, and stale listeners lose authority: Tasks 3, 5, 7, and 9 add durable leases and cancellation; Tasks 12-14 exercise reload and Stop.
- Other extension features regressed outside the focused fixes: Task 10 adds the operator regression matrix, and Task 16 reruns it after live work.
- Green tests hide real errors: Task 3 removes green-with-console-error behavior, Task 11 enforces clean deterministic gates, and every live lane checks page, content, popup, and service-worker errors.

## Plan Validation Checklist

- [ ] Every observed failure has a red test before its runtime fix.
- [ ] Quick Batch includes a ten-item DOM-remount test, not a one-item canary.
- [ ] Prompted Batch cannot pass on click dispatch plus return navigation.
- [ ] Prompted run state survives hard navigation and extension reload.
- [ ] Retry Failed preserves accepted items.
- [ ] Video Goal counts only new playable outputs.
- [ ] Recreate cancellation interrupts pending operations.
- [ ] Sync inventories every conversation asset and preserves legacy IDs.
- [ ] All state-changing operations are authority-gated and cancellation-aware.
- [ ] Mocked provider tests and live provider proof are reported separately.
- [ ] Every other extension surface has a regression check.
- [ ] Live spend/write lanes pause for exact approval.
- [ ] No plan step requires tab enumeration, detached Chrome, processed-ID reset, secret output, or main-branch push.
