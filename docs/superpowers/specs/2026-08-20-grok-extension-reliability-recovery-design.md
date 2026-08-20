# Grok Extension Reliability Recovery Design

Date: 2026-08-20

Status: Proposed and validated for review, not implemented

Scope: Chrome extension only

## Purpose

Restore the extension as a dependable operator tool across Grok Imagine 2.0 without another selector patch cycle. The repair must make progress durable, define success from provider evidence rather than click dispatch, preserve per-item retryability, and prove that Sync captures every media asset associated with each Saved item.

This design covers five broken workflows:

- Quick Batch
- Prompted Batch
- Start Video Goal
- Recreate Media
- Start Sync and Full Media Backup traversal

It also places regression gates around the remaining extension surfaces:

- prompt history and saved prompts
- Auto-Retry settings
- Template Batch
- Quality Repeat and inline repeat controls
- popup settings and cloud validation
- Retry Unsynced, Backfill, one-media canary, and processed-ID reset safety
- ChatGPT Images provider isolation

The web app, Vault UI, Cloud Worker public routes, R2/D1 configuration, OAuth, environment files, and cloud object state are outside runtime change scope.

## Evidence From The Current Sweep

The current branch is `codex/grok-extension-recovery` at `35f6bc7`. The sweep used the checked-out source and one controlled, existing Chrome tab. It did not enumerate tabs or trigger a generation, download, upload, or processed-ID mutation.

Observed live Saved structure:

- the controlled page was `https://grok.com/imagine/saved`;
- 20 generated-image previews were mounted;
- 18 current `button[aria-label="Make video"]` actions were mounted;
- cards exposed a unique post ID and asset ID;
- multiple cards shared one conversation ID, so conversation ID is not a card identity.

Observed code and test gaps:

- Quick Batch queues live `{ button, container }` DOM nodes.
- After Grok remounts the gallery, the remaining queued nodes become detached and are silently skipped.
- Quick Batch increments success immediately after `.click()` and has no accepted-state receipt.
- Quick Batch has no multi-item unit or Playwright test.
- Prompted Batch state is held in one content-script instance and is lost on hard navigation or extension reload.
- A current Prompted Batch unit test treats an unproven submission as success when return navigation succeeds.
- Start Video Goal still depends on legacy `Make video` and `Video Options` selectors and detached DOM context.
- Recreate tests mock the workflow actions and do not prove current Grok result recognition or immediate cancellation.
- Sync transfers one selected preview asset per Saved card. It does not inventory every `fileAttachmentAssetMetadata` entry in the conversation response.
- The authenticated bridge already fetches the conversation response and safely extracts exact asset metadata. It can be extended to return a bounded, sanitized asset inventory.
- All 902 unit tests and all 48 mocked Playwright tests pass despite the live failures.
- The unit run logs a background initialization error while still passing, which is an invalid green signal.

## Reliability Principles

- Persist identities and state, never DOM nodes.
- Reacquire every target immediately before acting.
- A dispatched click is not success.
- A return navigation is not submission proof.
- Batch progression is submission-driven, not video-completion-driven.
- Video Goal remains outcome-driven because its goal is completed videos, not submitted attempts.
- Every state-changing action must be idempotent or guarded by a receipt.
- Every workflow must have one run authority, one cancellation token, and one durable journal.
- Ambiguity fails the item safely. It does not guess or mark success.
- A failed item remains retryable without replaying accepted items.
- Processed IDs are written only after the active mode's durability contract succeeds.
- Existing `processedIds` are preserved. No reset, destructive migration, or reinterpretation is allowed.
- Live provider proof is required for selectors, native controls, authenticated media, and actual provider acceptance.

## Shared Provider Adapter

Create one focused `grokImagineAdapter.js` module loaded before `content.js`. It owns current Grok Imagine DOM interpretation and exposes serializable identities and explicit ambiguity states.

Required operations:

```js
detectGrokSurface({ location, root })
// -> 'results_gallery' | 'saved_gallery' | 'agent_media' | 'legacy_detail' | 'unsupported'

listGalleryItems({ root, surface })
// -> { status: 'ok', items: GrokGalleryItem[] }
//  | { status: 'ambiguous' | 'unsupported', reason: string }

resolveGalleryItem({ root, descriptor })
// -> { status: 'matched', card: Element, descriptor: GrokGalleryItem }
//  | { status: 'missing' | 'ambiguous', reason: string }

resolveMediaAction({ root, descriptor, action })
// action: 'quick_video' | 'prompted_video' | 'goal_video'
// -> one actionable native control or an explicit missing/ambiguous result

captureSubmissionReceipt({ root, descriptor, action })
evaluateSubmissionReceipt({ root, receipt })
// -> 'pending' | 'accepted' | 'rejected' | 'ambiguous'

findGeneratedResult({ root, before, expected })
// -> 'pending' | 'ready' | 'failed' | 'ambiguous'
```

`GrokGalleryItem` contains no media URL query string and no DOM reference:

```js
{
    version: 1,
    surface: 'results_gallery' | 'saved_gallery',
    sourceAssetId: 'uuid',
    sourcePostId: 'uuid',
    conversationId: 'uuid-or-empty',
    mediaKind: 'image' | 'video',
    hrefPath: '/imagine/post/uuid',
    initialOrder: 0,
    beforeAssetId: 'uuid-or-empty',
    afterAssetId: 'uuid-or-empty'
}
```

Identity rules:

- `sourceAssetId` is primary when exactly one approved generated-media identity is present.
- `sourcePostId` disambiguates cards when a conversation contains multiple assets.
- `conversationId` is metadata scope only and must never identify a card by itself.
- Signed URLs, cookies, prompts, and raw response bodies are not persisted in the run journal.
- Multiple matching cards or actions return `ambiguous`; first-match behavior is forbidden.

## Durable Generation Run

Quick Batch, Prompted Batch, and Video Goal share a background-owned generation run controller. The controller is specific to generation workflows and does not replace or mutate the existing Sync lease implementation.

Run status:

```text
idle -> running -> waiting_capacity -> running
idle -> running -> retryable_failed -> running
idle -> running -> completed
idle -> running -> cancelled
idle -> running -> failed
```

Item status:

```text
queued -> targeting -> composer_ready -> submitted -> accepted
queued -> targeting -> retryable_failed -> targeting
queued -> targeting -> permanent_failed
```

The controller persists:

- run ID, epoch, workflow kind, owner tab ID, and start surface;
- sanitized origin receipt and item descriptors;
- prompt and existing generation settings needed to resume Prompted Batch;
- per-item attempt count, status, failure code, and redacted acceptance receipt;
- accepted, failed, skipped, and pending counts;
- cancellation status and last transition time.

The controller does not persist:

- DOM nodes;
- raw signed media URLs;
- cookies, API keys, headers, or bearer values;
- generated media bytes;
- arbitrary provider response bodies.

Only the active owner tab may claim the next action. The content script executes one bounded provider action and reports a receipt. The background reducer validates the transition before exposing the next item. A reload may resume the active run from the journal after the current page proves the expected surface and item.

Only one generation run may be active at a time. Sync and generation may not start concurrently because both drive the same Grok tab.

## Quick Batch Contract

Quick Batch applies to a generated results gallery or Saved gallery. It discovers eligible cards in stable visual order up to the existing Gallery Limit.

For each item:

1. Resolve the descriptor against the current DOM.
2. Resolve exactly one direct native Make Video action for that card.
3. Capture a pre-action receipt.
4. Dispatch the full native pointer sequence through the existing trusted-click path.
5. Wait for provider acceptance on the same source identity.
6. Record `accepted` only when the receipt proves a matching generation job or progress state.
7. Continue to the next descriptor without waiting for the video to finish.

If Grok remounts the gallery after any item, the next item is reacquired from its identity. Detached nodes are never skipped as success or completion.

Capacity is backpressure, not failure. The run waits while the provider exposes a disabled or capacity-limited state, then resumes. A bounded timeout becomes `retryable_failed`.

Quick Batch completes only when every planned item is accepted or has an explicit terminal failure. The UI reports accepted, failed, and pending counts. `Retry Failed` reruns only failed items.

## Prompted Batch Contract

Prompted Batch supports:

- generated results at `/imagine`;
- generated result/detail routes at `/imagine/post/...`;
- Saved at `/imagine/saved`;
- Agent media opened from those source surfaces.

For a gallery run, the existing Gallery Limit is the hard cap. For a detail run, the existing Video Goal is the number of prompted submissions for the selected source.

For each item:

1. Persist the source descriptor and origin receipt before navigation.
2. Open the exact source and prove the expected post or asset identity.
3. Resolve Make Video and select Add Prompt. Precise Edit is never a fallback.
4. Scope the composer to the selected source and inject the current prompt.
5. Capture a pre-submit receipt and dispatch the trusted submit.
6. Count only a provider-accepted state. A verified click with no accepted-state change is `acceptance_unproven`.
7. Return to and prove the original logical gallery using its route, source identity, and stable neighbors.
8. Continue after acceptance without waiting for completed video output.

Hard navigation, SPA navigation, and extension reload must resume from background state. Return failure must preserve the run and item state, show a recovery action, and never force the user to restart accepted work.

Default failure behavior:

- retry the item up to the existing Max Retries setting;
- continue with later items after the item reaches `retryable_failed` or `permanent_failed`;
- expose `Retry Failed` at the end;
- never replay an accepted item;
- preserve censored and provider-rejected outcomes as explicit failure codes.

## Video Goal Contract

Start Video Goal applies to one selected generated source in Agent or supported detail view. It does not choose a gallery card implicitly.

The goal is the requested number of completed videos for the same source. Each attempt:

- proves the selected source identity;
- uses the current direct Make Video action, not Precise Edit;
- records provider acceptance;
- waits for a matching terminal result because Goal counts completed outputs;
- verifies the completed result is playable before incrementing the goal;
- retries failed/censored attempts according to Auto-Retry and Max Retries;
- never counts a stale video already present before the attempt.

Stop revokes authority before another click or retry.

## Recreate Contract

Recreate keeps its existing chat-to-Imagine architecture but uses the shared adapter for current-source capture and generated-result recognition.

Required behavior:

- Current captures the selected or uniquely visible Grok image/video through the authenticated page bridge.
- File, drop, paste, and approved Grok URL inputs retain existing validation and size limits.
- Start Recreate reports phase-specific status: capture, chat prompt, Imagine submit, waiting result, ready, failed, or cancelled.
- A successful run requires one new playable result associated with the current run.
- Stop cancels pending waits and message operations through an abort signal. It may not remain indefinitely at `Stopping...`.
- A failed run can be retried without reselecting a still-valid reference.
- Diagnostic output remains redacted.

## Sync Asset Inventory Contract

Saved cards are entry points, not complete asset inventories. Before transferring a Saved item, Sync requests a bounded sanitized inventory from the existing authenticated conversation-response bridge.

New bridge operation:

```js
fetchGrokConversationAssetInventory(conversationId)
// -> {
//   schemaVersion: 1,
//   conversationId,
//   assets: Array<{
//     assetId,
//     responseId,
//     parentResponseId,
//     mediaKind,
//     sourceUrl,
//     promptText,
//     assetMetadata,
//     mediaGenInput
//   }>
// }
```

The bridge must:

- allow only a UUID conversation ID;
- read `/rest/app-chat/conversations/{id}/responses` with the current page session;
- include every unique `fileAttachmentAssetMetadata.assetId` from all responses;
- deduplicate identical asset IDs only when sanitized metadata agrees;
- fail closed on conflicting duplicates, missing media URL/type, unsupported host, or oversized output;
- preserve exact-asset metadata behavior for current callers;
- cap asset count and serialized size;
- return no cookies, headers, tokens, or unrelated response fields.

Sync processing:

1. Discover a Saved card descriptor and conversation ID.
2. Fetch the authoritative inventory.
3. Prove the selected Saved asset belongs to that inventory.
4. Process every unique image/video asset in stable response order.
5. Use existing `DOWNLOAD_MEDIA` or R2 presence/upload paths for each asset.
6. Persist a per-asset terminal receipt only after queue/download/upload/already-present durability succeeds.
7. Mark the Saved entry complete only when every discovered asset is terminal.
8. Return to Saved and continue traversal.

The existing serialized `processedIds` list remains the permanent per-asset durability record. Each authoritative asset UUID is added only after that asset satisfies the active mode's durability contract. Existing entries are never deleted, reset, or migrated. A legacy Saved post ID or preview ID is not proof that sibling assets are complete.

Only active-run progress is added to the existing scrape run mirror:

```js
{
    conversationId,
    inventoryHash,
    assetIds,
    nextAssetIndex
}
```

This bounded state lets a reload resume the current conversation without creating a second permanent ledger. Conversation completion is derived by comparing the current authoritative inventory with the background-owned processed-ID set.

Normal Sync and Full Media Backup share discovery and inventory logic. Their durability rules remain mode-specific:

- Local only: Chrome download has a durable tracked operation.
- Cloud only: R2 upload or read-only already-present proof succeeds.
- Dual-write: both local and cloud obligations succeed.
- Failed assets remain unprocessed and retryable.

Completion requires both Saved-gallery exhaustion and no pending inventory or transfer item.

## Cancellation And Concurrency

Every workflow checks run authority before:

- card resolution and click;
- composer or prompt mutation;
- submit;
- media fetch;
- navigation;
- storage mutation;
- processed-ID mutation;
- queue continuation.

Stop must produce an acknowledged terminal state. After acknowledgement, no late click, navigation, transfer, upload, download, processed-ID write, or retry may occur.

Generation and Sync are mutually exclusive on the owner tab. Recreate is also mutually exclusive with both because it controls navigation and generation. Popup and overlay must explain which run is active instead of silently replacing it.

## Test And Proof Model

Deterministic tests use sanitized fixtures captured from current Grok structures. Fixture behavior must include:

- card remount after every accepted Quick action;
- hard and SPA navigation;
- delayed provider acceptance;
- disabled capacity state and later recovery;
- censorship, transient failure, permanent failure, and retry;
- source replacement and inserted generated videos;
- extension reload between steps;
- duplicate and ambiguous identities;
- one conversation with multiple image/video assets;
- cancellation during each state-changing phase.

Mocked tests are not live-provider proof. Live release validation uses the existing logged-in Chrome session and never enumerates tabs.

Required live lanes:

- Quick Batch: at least 10 eligible items, with accepted-state proof and no duplicates.
- Prompted Batch results: at least 12 items at the lowest current resolution and shortest duration.
- Prompted Batch Saved: at least 8 items, including navigation and return.
- Retry Failed: at least one real provider rejection or a safely induced transient failure, without replaying accepted items.
- Video Goal: three completed playable videos for one source, including one retry path when available.
- Recreate: Current and local-file runs produce playable results; Stop is exercised during a pending phase.
- Start Sync: 25 consecutive Saved entries, crossing a virtualization boundary.
- Multi-asset Sync: at least two known conversations reconcile exact bridge inventory against durable transfer receipts.
- Reload recovery: one active Prompted run and one active Sync run survive a content-script/page reload.
- Regression smoke: prompt history, saved prompts, settings, Auto-Retry, Template Batch, Quality Repeat, popup cloud validation, provider isolation, and controls render/operate without console errors.

Live generation spends credits. Live Sync may download or write R2 depending on current mode. Each write/spend lane requires a narrow preflight and explicit approval immediately before it runs. No full backup begins until bounded lanes pass.

## Release Gate

The extension is not ready unless all of the following are true:

- lint, unit, mocked Playwright, syntax, and package gates pass without unexpected console errors;
- Quick Batch proves 10 accepted submissions without a detached-node stop;
- Prompted Batch proves both result and Saved workflows and Retry Failed;
- Video Goal proves completed playable outputs;
- Recreate proves Current, local file, result readiness, retry, and cancellation;
- Sync proves 25 entries and exact multi-asset reconciliation;
- no failed transfer updates processed IDs or active conversation completion;
- Stop and reload tests show no late side effects;
- extension error page remains clear after the live matrix;
- settings changed for validation are restored;
- no env, OAuth, Worker secret, R2/D1 binding, bucket, or cloud object is manually changed;
- changed/staged files pass secret and stray-file review;
- no push or PR update occurs before the gate passes.

## Interpretations

- Quick Batch scope is every eligible card discovered from the starting gallery, capped by the existing Gallery Limit.
- Prompted Batch retries an item up to Max Retries, then continues and exposes Retry Failed.
- Batch success means provider-accepted submission. It does not wait for completed videos.
- Video Goal success means a new completed playable video.
- Sync must capture every authoritative media asset tied to the Saved conversation, not only the visible preview.
- Existing processed IDs are preserved and store durable authoritative asset UUIDs; active conversation progress stays in the existing run mirror.

## Non-Goals

- redesigning the overlay or popup;
- changing Grok's native generation settings outside bounded validation;
- adding a second browser profile or detached Chrome session;
- enumerating the user's Chrome tabs;
- modifying the web app or Vault UI;
- changing Worker routes, R2/D1 configuration, OAuth, env files, or cloud object state;
- automatically resetting processed IDs;
- treating unit or mocked Playwright results as whole-extension proof.
