# Grok Extension Recovery And Live Validation Design

Date: 2026-08-16

Status: Approved design, implementation not started

Branch: `codex/grok-extension-recovery`

Delivery target: existing draft PR 11 only

## Context

Grok Imagine 2.0 changed the Saved, Agent, generated-results, and video-generation interfaces. Recent extension recovery work restored parts of Prompted Batch and Saved sync, but repeated live regressions showed that automated tests and short canaries were being treated as broader proof than they provided.

The current branch contains twelve committed recovery changes plus an uncommitted patch in:

- `background.js`
- `content.js`
- `tests/e2e/extension.spec.js`
- `tests/unit/backgroundRecreateWorkflow.test.js`
- `tests/unit/grokScraperNavigation.test.js`
- `tests/unit/retryManager.test.js`

The current uncommitted Prompted Batch patch has passed lint, 655 unit tests, 33 Playwright tests, syntax checks, and a two-item live generated-results run. That proves the observed two-item Prompted Batch path only. It does not prove Start Sync, Dual-write, long-run gallery traversal, production R2 backup exhaustion, or all recovery behavior.

The repo already contains an acceptance-only Cloudflare Worker, R2 bucket, D1 database, guarded prefix contract, run/correlation IDs, preflight, and evidence helpers. A read-only preflight verified current Cloudflare authentication and R2 CLI access. This infrastructure should be reused instead of creating another test system or using production as the first diagnostic environment.

## Goal

Restore and prove the extension workflows used on Grok Imagine in the existing logged-in Chrome session:

- Prompted Batch from a generated-results gallery
- Cloud-only Start Sync
- Dual-write Start Sync, covering both local download and R2 upload
- Full Media Backup to production R2
- Stop, extension reload, and page refresh recovery
- Popup settings validation and accurate user-visible status

The final release claim must be based on real outputs and durable cloud evidence, not only mocked DOM tests or successful button clicks.

## Non-Goals

- Web app or Vault UI work
- Worker product features unrelated to extension validation
- R2 or D1 repair, deletion, migration, or manual object cleanup
- Processed-ID resets or bulk edits
- Detached Chrome profiles or isolated browser sessions
- A broad rewrite of `content.js` or the scraper
- New pull requests or merging PR 11

## Safety Invariants

1. Use the existing logged-in Chrome session only.
2. Never enumerate all Chrome tabs, call DevTools `list_pages`, loop through Chrome windows or tabs, or capture a full Chrome accessibility tree.
3. Operate only on the visible target window and direct known URLs.
4. Check for active backup, sync, generation, upload, download, and cloud queue work before starting a lane.
5. Do not reset, remove, or rewrite canonical processed IDs.
6. Do not print, copy, replace, or commit API keys, cookies, OAuth data, bearer tokens, signed URLs, or environment values.
7. Do not change production R2/D1 bindings, bucket configuration, Worker secrets, OAuth configuration, or existing cloud objects manually.
8. Do not mark a media identity processed until its configured durable outcome is acknowledged.
9. Stop on ambiguous identity, surface, control, submission, transfer, return, or exhaustion evidence.
10. Preserve and restore user settings changed for validation.
11. Leave the untracked `None` file and `docs/superpowers/plans/2026-08-11-grok-imagine-2-compatibility-recovery.md` untouched.

## Recovery Baseline

Before editing runtime code:

1. Record the branch, HEAD, origin relationship, extension version, loaded extension ID, and loaded source path.
2. Save the tracked working-tree diff to an ignored recovery artifact and record its checksum.
3. Record names and counts for relevant Chrome storage state without retaining secret values:
   - cloud mode and normalized Worker host
   - key-prefix fingerprint
   - processed-ID count
   - cloud queue count
   - scrape and R2 run state
   - popup backup state
4. Record the visible Grok URL, Saved scope, and whether any workflow is active.
5. Capture existing extension errors before clearing them for the new run.

The baseline allows a failed experiment to be compared with the exact prior state without stashing, resetting, or losing the current patch.

## Shared Workflow Contract

Prompted Batch and Sync remain separate workflow controllers. They share a safety contract rather than a new general-purpose state machine.

Each item transition must have:

- a run token and run epoch
- the source media identity
- the origin surface and URL
- a gallery receipt containing ordered stable anchors and scroll position
- the expected destination surface
- the exact visible control selected for the action
- an acceptance or durable-transfer receipt
- a return receipt proving the original gallery
- the next expected source identity when one exists

The item lifecycle is:

1. Classify the current surface.
2. Resolve one unambiguous source identity.
3. Capture the origin receipt.
4. Perform one trusted action on the verified visible control.
5. Confirm the expected destination and source binding.
6. Perform the submit or transfer.
7. Require a durable result before recording progress.
8. Return to the originating gallery.
9. Restore viewport and identify the next item from stable identities.
10. Continue only while the run token remains authoritative.

DOM nodes are transient and must not be retained as identity across React remounts or route changes.

## Durable Outcome Rules

### Prompted Batch

A submitted item may advance only after Grok shows an acceptance signal tied to the selected media and current conversation. A changed post ID is acceptable only when it remains in the same conversation. Unrelated route changes, persistent submit controls, Precise Edit controls, and generic DOM mutations are not acceptance.

The live lane adds a stronger output gate: the generated video must finish, load, and play.

### Cloud-only Start Sync

An item may be recorded as processed only after the R2 path reports a durable status such as `uploaded` or `already_present`. A queued status is not final proof unless the queue is subsequently drained and the object is verified.

### Dual-write Start Sync

Dual-write replaces the proposed Local-only live lane. Local-only and Cloud-only currently share `processedIds`; testing Local-only first could make an asset invisible to the later R2 backup. Dual-write must prove both outcomes for the same identity:

- Chrome download completes and the file bytes are playable or decodable.
- R2 acknowledges and readback verifies the corresponding object.

The processed ID may persist only after the mode's required durability contract is satisfied. Pure Local-only behavior remains covered by deterministic tests.

### Full Media Backup

The production run may classify an item as complete only when R2 reports it present. Errors remain unresolved until the same identity is successfully retried or the run fails. No manual object insertion may be used to make reconciliation pass.

## Gallery Identity And Return Proof

Grok can replace, reorder, and virtualize cards while a video is generated. Return proof therefore cannot require a frozen DOM, but it also cannot rely only on a page title or the presence of any familiar card.

An origin receipt must combine:

- source identity
- two stable neighboring identities when available
- expected next identity
- origin URL and conversation identity
- Saved or results scope
- scroll position
- a bounded set of original gallery identities

Return succeeds only when the current surface, route identity, and enough stable anchors establish the same logical gallery. If proof is insufficient, stop and preserve the page instead of navigating or continuing speculatively.

## Cancellation And Recovery

Stop and extension-context invalidation revoke run authority before any later action. Every card click, native click, prompt write, transfer, navigation, storage mutation, queue mutation, and loop continuation must recheck authority.

Stop is tested during:

- source targeting
- destination transition
- prompt/editor setup
- media transfer
- return navigation

After Stop, the extension must not issue late clicks, submissions, downloads, uploads, processed-ID writes, or next-item navigation. If an item surface is open, the extension should return to Saved or the original results gallery when it can do so without ambiguity.

After an extension reload, stale content-script listeners must fail quietly and present one actionable refresh state. They must not create `Extension context invalidated` error-page spam. The refreshed page must initialize exactly one active listener/controller set.

## Validation Strategy

Validation is layered. A later layer cannot replace an earlier one, and an earlier layer cannot be presented as proof of a later one.

### Lane 0: Environment And State Preflight

- Verify repository, branch, diff, extension source path, Chrome login, Grok Saved access, Cloudflare authentication, R2 CLI access, disk space, and download directory.
- Verify no competing job is active.
- Validate the current production cloud configuration without exposing the API key.
- Verify the acceptance Worker identity and guarded acceptance prefix before any acceptance write.
- Record settings that will be restored.

### Lane 1: Deterministic Gates

Run from the repo root:

```bash
npm run lint
npm run test:unit
npm run test:e2e
npm run package:extension
node --check background.js
node --check content.js
git diff --check
```

Also run Cloud Worker type and acceptance tests because the extension's R2 proof depends on the existing Worker contract:

```bash
npm --prefix cloud run typecheck
npm --prefix cloud run test:acceptance
```

Scan changed and staged content for secrets, debug statements, accidental binary files, environment files, and unrelated edits.

### Lane 2: Isolated Acceptance Cloud

Use a new run ID, correlation ID, and `acceptance/<run-id>` prefix against the existing acceptance-only Worker, R2 bucket, and D1 database.

If the acceptance Worker still advertises an older run, regenerate its ignored acceptance config for the new run and deploy only the acceptance Worker. Read back its identity and prefix before allowing a write. Never deploy or reconfigure the production Worker for this lane.

Prove:

- health and identity checks
- test upload and object verification
- one public image transfer
- one authenticated video transfer
- duplicate transfer returns an already-present result
- failed transfer does not update processed IDs
- Stop revokes queued or in-flight authority
- no production resource or prefix is referenced

Restore the production extension settings after the lane and verify their fingerprints match the baseline.

### Lane 3: Prompted Batch Live Soak

Use an existing generated-results gallery in the current Chrome session.

1. Capture the original Grok video settings.
2. Inspect the current UI and select the lowest resolution and shortest duration actually offered.
3. Enter one neutral, low-cost motion prompt.
4. Run Prompted Batch on five generated images.
5. For every item, verify:
   - the intended card opens
   - Make Video and Add Prompt are selected, never Precise Edit
   - the prompt is written to the scoped video composer
   - the trusted submit targets the scoped control
   - Grok accepts the submission
   - the original results gallery returns
   - the next expected image advances
6. Require `Complete (5/5)`.
7. Wait for all five videos to finish, then load and play each output.
8. Restore the original Grok video settings.

A five-item submission count without five playable outputs is a failure.

### Lane 4: Cloud-only Start Sync Live Soak

Run normal production Cloud-only Start Sync for 25 consecutive eligible Saved assets, or every remaining eligible asset if independently proven fewer than 25 exist. There is no minimum time requirement.

The lane must:

- cross at least one Saved scroll or virtualization boundary
- process images and videos when both are available
- return to Saved after every selected item
- maintain or restore the expected gallery neighborhood
- avoid Agent-mode gallery scanning and zero-item loops
- avoid duplicate source identities
- preserve processed IDs for failed items
- continue after the twenty-fifth success unless explicitly stopped for the lane boundary

Verify first, middle, and final successful objects with R2 readback, including object key, size, content type, and checksum when available. Compare processed-ID additions with the exact durable-success identity set.

### Lane 5: Dual-write Start Sync Live Lane

Run three eligible Saved assets in Dual-write mode. For each identity:

- verify Chrome reports the download complete
- verify the local file exists, has nonzero bytes, and decodes or plays
- verify the R2 object exists and matches expected media type and size
- verify one processed-ID transition after both required outcomes

Restore Cloud-only mode and the original download folder after the lane.

### Lane 6: Live Stop And Reload Recovery

Use bounded runs to exercise Stop at the defined transition stages. Use the acceptance cloud where a production write is not needed.

Reload only the unpacked extension from its direct extension page, then refresh only the visible Grok page. Verify:

- stale listeners stop quietly
- the overlay initializes once
- popup and overlay state agree
- no new uncaught invalidated-context errors appear
- a fresh short workflow can start after refresh

### Lane 7: Full Production R2 Backup

Before starting, check again for competing browser, cloud, network, CPU, and disk work. Start Full Media Backup from Grok Saved in All scope and let it run to natural completion.

Do not impose an arbitrary duration or stop after a sample count. Monitor:

- current surface and source identity
- gallery return and scroll continuation
- seen, uploaded, already-present, queued, skipped, and error counts
- cloud queue drain state
- processed-ID deltas
- extension, service-worker, and popup errors
- resource pressure on the Mac

Any ambiguity or repeated failure stops the run for diagnosis. It does not trigger a processed-ID reset.

## Independent Exhaustion And Reconciliation

The scraper's own `complete` status is not sufficient proof because the original failure falsely stopped while more gallery media existed.

Before or alongside the production run, a separate read-only observer must collect stable Saved media identities while traversing All scope. It must be independent of the scraper's stop decision and must not navigate into cards. It may operate only on the visible target tab and retain identity strings, not media bytes or secrets.

Natural exhaustion requires all of:

1. Saved reaches a stable end with no new identities after bounded bottom checks.
2. The independent observer's identity set stops growing at the same end.
3. The backup queue is empty and no transfer remains in flight.
4. Every independently enumerated identity is reconciled to a durable R2 object or an explicit unresolved failure.
5. The unresolved failure set is empty.
6. A second verification scan finds no eligible unprocessed media.

Hitting a scan-attempt limit is `blocked` or `failed`, never `complete`.

## Failure Procedure

On a live failure:

1. Stop the active workflow without reloading or navigating away unless safety requires it.
2. Capture the visible status, relevant narrow screenshot, route, surface, source identity suffix, run token, queue state, and redacted logs.
3. Classify the failure:
   - surface detection
   - source identity
   - control selection
   - submission acceptance
   - transfer durability
   - processed-ID persistence
   - gallery return
   - continuation
   - cancellation
   - exhaustion
4. Reproduce the smallest reliable case.
5. Add or tighten a regression test that fails for the observed reason.
6. Make the smallest code correction that restores the contract.
7. Rerun deterministic gates, the failed live lane, and any dependent lane.

Do not stack unrelated selector changes, weaken assertions to fit observed output, or continue a production run in ambiguous state.

## Evidence Record

Write redacted run artifacts under ignored `acceptance/runs/<run-id>/`. Each lane records:

- source commit and diff checksum
- extension version and source-path fingerprint
- settings fingerprints before and after
- workflow and run token
- source identity suffixes
- surface-transition receipts
- submission or transfer receipts
- processed-ID counts and exact redacted deltas
- R2 object metadata and verification result
- local file metadata for Dual-write
- screenshots of start, progress, completion, and failure states
- pass, fail, blocked, or not-run verdict

Evidence must never include API keys, cookies, prompt contents from unrelated user work, bearer tokens, signed URLs, or full private media URLs.

## Tool Routing

- Use CLI and APIs for Git, tests, package checks, Cloudflare preflight, R2 metadata, and object verification.
- Use built-in Browser and Computer Use for the visible existing Chrome workflow.
- Use Peekaboo only for narrow native macOS or Chrome actions that Browser/Computer Use cannot perform.
- Chrome DevTools may attach only to the existing visible target and only when authenticated profile state or extension APIs require it.
- Do not discover or enumerate the user's other Chrome tabs.

## Release Gate

The extension is ready for review only when all required rows pass:

| Lane | Required proof |
| --- | --- |
| Deterministic | Lint, 655-or-more unit tests, all E2E tests, packaging, syntax, cloud checks, diff and secret checks pass |
| Acceptance cloud | Guarded image, authenticated video, duplicate, failure, and cancellation paths verified outside production |
| Prompted Batch | Five accepted submissions, five correct returns, `Complete (5/5)`, and five playable low-cost videos |
| Cloud-only Start Sync | 25 consecutive durable transfers or proven remaining exhaustion, mixed media when available, no duplicate or false stop |
| Dual-write Start Sync | Three complete local files plus three verified R2 objects for the same identities |
| Stop and reload | No late actions, no invalidated-context error spam, and clean restart |
| Full production backup | Stable Saved exhaustion, empty queue, zero unresolved errors, R2 reconciliation, and zero eligible remainder |
| State restoration | Original cloud, download, video, and popup settings restored; secrets unchanged |

No lane may be called passed when it was skipped, blocked, or inferred from another lane.

## Git And Delivery

- Continue on `codex/grok-extension-recovery`.
- Do not touch `main`.
- Do not create another PR.
- Keep runtime and test fixes in small semantic commits after their relevant gates pass.
- Do not push the final recovery changes until all required local and live evidence has been reviewed for secrets and accuracy.
- Update existing draft PR 11 after the release gate passes.
- Do not mark the PR ready or merge it without user instruction.

## Alternatives Considered

### Production-first debugging

Rejected because it would mix diagnosis with production writes and make duplicate, processed-ID, and return failures harder to isolate.

### State-machine rewrite before recovery

Rejected because it would add a large new behavioral surface before restoring known workflows. Shared helpers are appropriate only where existing controllers need the same verified contract.

### Canary-only validation

Rejected because one or two successful items cannot prove gallery continuation, virtualization, long-run exhaustion, output generation, or production configuration.

## Pause Conditions

Pause for user action only when:

- Grok or Chrome requires account reauthentication.
- Chrome requires a permission confirmation that automation cannot safely grant.
- Cloudflare authentication or required acceptance resources are unavailable.
- The production cloud configuration is missing or invalid and the correct secret cannot be recovered without user input.
- A competing backup or upload cannot be safely identified or stopped.
- The lowest resolution or shortest duration requires a credit or account choice that is not visible or unambiguous.
- An unexpected dirty file overlaps the implementation scope and ownership cannot be established.

Normal test failures, selector drift, reproducible workflow bugs, and code corrections are not pause conditions.
