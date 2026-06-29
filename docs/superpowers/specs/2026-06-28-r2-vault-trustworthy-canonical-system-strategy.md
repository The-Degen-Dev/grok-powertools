# R2 Vault Trustworthy Canonical System Strategy

Date: 2026-06-28

Repo: `/Users/philipbankier/Development/skunkworks/Grok-Tinker/chrome-extension-powertools`

Status: living strategy record for post-audit repair planning. This is not approval to mutate production.

## Source Evidence

Primary evidence folder:

- `docs/audits/2026-06-26-production-r2-vault-system-audit/`

Final audit checkpoint:

- Branch: `codex/production-r2-vault-audit`
- Evidence baseline commit: `edaaf8134bb545969d6e8036952695a3d8102ca7 docs: add grok saved api audit evidence`

Canonical snapshot dry-run checkpoint:

- Schema version: `r2-vault-canonical-snapshot/v1`
- Private exact payload: `docs/audits/2026-06-26-production-r2-vault-system-audit/private/canonical-snapshot-dry-run.json`
- Committed summary: `docs/audits/2026-06-26-production-r2-vault-system-audit/report-canonical-snapshot-dry-run.md`
- Private payload SHA-256: `21c49f43c6692eff5b31ea0cb9ebaa882840e19895bf90c3cd35ada0e75e9fb6`
- Stable content hash: `4100f2c3c2d3837a212125c39b6d926cefa31c7453af4a5df9d1d49d6b4f2ef1`
- Dry-run counts: `8080` logical assets, `15981` storage objects, `13914` prompt records, `7696` gap records
- Production writes during dry run: none

Approved append-only R2 snapshot checkpoint:

- Status: write/readback verified
- R2 bucket: `grok-gallery-001`
- R2 object key: `grok-powertools/v1/users/_system/canonical-snapshots/r2-vault-canonical-snapshot-v1/2026-06-29T004723Z-4100f2c3c2d3837a212125c39b6d926cefa31c7453af4a5df9d1d49d6b4f2ef1.json`
- Bytes: `112614234`
- ETag: `"025f78814c8ff5a0dfda355a44d589b5"`
- Readback SHA-256: `21c49f43c6692eff5b31ea0cb9ebaa882840e19895bf90c3cd35ada0e75e9fb6`
- Readback stable content hash: `4100f2c3c2d3837a212125c39b6d926cefa31c7453af4a5df9d1d49d6b4f2ef1`
- Production writes in this checkpoint: one append-only R2 snapshot object only. No D1 writes, Worker writes, Grok actions, object moves/deletes, repair/sync routes, or physical cleanup.

Audit verdicts:

- Production R2 internal correctness: `dirty`
- Current Grok Saved completeness: `api_captured_post_identity_with_post_gaps`
- Local system health: `clean`

Key counts from the audit:

- Raw R2 objects: `18083`
- Raw R2 media objects: `15981`
- R2 media hash attempts: `15981`
- R2 media hash failures: `0`
- D1/Worker indexed assets: `4647`
- Web route assets: `4647`
- Date-folder R2 media objects: `9893`
- Canonical `media/by-asset` R2 objects: `6088`
- Canonical R2 objects missing from D1/Worker exact-key coverage: `1441`
- Grok Saved asset API rows: `12446`
- Grok source conversations attempted: `7985`
- Grok conversation response gaps: `1463`
- Grok media-post rows attempted: `12446`
- Grok media-post successes: `12232`
- Grok media-post response gaps: `214` (`213` stable `404`, `1` persistent `500`)
- Grok prompt candidates from conversation responses: `6606`
- Grok media-post prompt fields present: `7308`
- Local canonical index rows: `15981`
- Local canonical classifications: `4419` canonical, `5541` date-folder mapped, `2` alternate duplicates, `5553` needs human review, `466` orphan candidates
- Same-hash duplicate groups: `5116`
- Accepted linked duplicate objects: `4330`
- Hash-only duplicate objects needing review: `2627`
- Metadata-linked media: `2090`
- Metadata-unlinked media: `13891`

## Vocabulary Decision

Do not call the date-folder objects "legacy imports" in future plans.

Use this wording instead:

- `date-folder R2 objects not indexed by D1/Worker`

Meaning:

- These are R2 media objects stored under older date-shaped paths such as `media/2026-04-06_Auto/...`.
- They are not automatically unimportant.
- They are not safe to ignore.
- They are not safe to delete.
- Each must be mapped to a Grok Saved identity, classified as duplicate evidence, or held for review.

## Product Contract

The user's expected product contract is:

- Every real media item should correspond to `grok.com/imagine/saved`.
- Every real metadata item should be available through the backup/Vault system, including full image prompts, full video prompts, and any other metadata Grok exposes.
- The system should not expose duplicate logical assets as separate clean records.
- The system should not hide missing or unresolved records behind normalized preview counts.

## Identity Decision

Canonical identity is a logical Grok Saved asset record.

Live Grok Saved probe on 2026-06-28 resolved the first identity question:

- Opening a visible Saved media tile in the user's existing Chrome/Grok session navigated from `https://grok.com/imagine/saved` to `https://grok.com/imagine/post/{uuid}`.
- The `{uuid}` from that route should be captured as `grokPostId` and treated as the primary Grok item identifier when present.
- A sanitized active-tab DOM probe found the same route UUID in the active media URL for the opened item, while nearby thumbnails and page chrome also contained other media UUIDs.
- Therefore media URL UUIDs are useful variant/storage evidence, but they are not always equivalent to the logical Grok Saved item identity.
- The exact observed post UUID, prompt text, media URLs, cookies, and signed query strings were not stored in this durable note.

Follow-up variant probe on 2026-06-28:

- A sampled `/imagine/post/{uuid}` page exposed two in-post thumbnail controls.
- Switching to the second thumbnail changed the displayed media while the browser stayed on the same `/imagine/post/{uuid}` route.
- Sanitized DOM evidence showed one post UUID and multiple media UUIDs on the same page.
- This supports modeling those in-post media choices as variants under the `grokPostId` record.
- This is sample evidence, not a universal rule. The enumerator must detect per post whether Grok exposes one media item, multiple in-post thumbnails, video frames, upscales, extensions, or separate post routes.

Rejected as primary identity:

- R2 object key. R2 keys are storage locations, not product identity.
- SHA-256 hash. Hashes prove byte equality, not Saved-item identity.
- Existing D1/Worker asset ID. Current app index evidence is incomplete and must not become root truth until reconciled.
- Raw media URL UUIDs by themselves. A page can expose multiple media UUIDs for thumbnails, variants, user paths, or active media.

Accepted roles:

- Grok Saved durable evidence decides whether a logical asset should exist.
- `grokPostId` from `/imagine/post/{uuid}` is the preferred Grok-side item identity when available.
- Full prompts and available Grok metadata are first-class Vault data for the user's own archive.
- R2 keys are storage locations for media or metadata bytes.
- SHA-256 is duplicate and byte-proof evidence.
- D1/Worker rows are current app-index evidence.
- Local files are corroborating evidence, not the system of record.

## Prompt And Metadata Storage Decision

Keep this simple for now: use the existing Vault data plane, not a separate prompt vault.

Decision:

- Store full image prompts, full video prompts, and all available Grok metadata in Vault records.
- Store them as fields attached to the logical `grokPostId` record and/or existing prompt sidecar objects.
- Keep R2 as the durable raw metadata store.
- Keep D1 as the required app-facing index and lookup layer after the canonical schema is proven. D1 should not replace R2 as the durable raw metadata store.
- Do not introduce a separate encrypted prompt vault, separate service, separate account, or complex access model for this owner-only phase.

Risk handling without extra architecture:

| Risk | Simple remediation |
| --- | --- |
| Raw prompts leaking into committed audit artifacts | Audit reports, plan files, and committed evidence must use prompt hashes, counts, object keys, or redacted excerpts by default. Raw prompt snapshots belong in Vault/R2 or ignored local scratch, not tracked docs. |
| Signed or cookie-bearing media URLs leaking | Store stable Grok post URLs and media UUID evidence. Strip query strings before durable metadata unless a short-lived URL is needed only in runtime memory. Keep `sourceUrlHash` for matching. |
| Prompt text duplicated across sidecars, saved prompt metadata, and prompt history | Preserve every source with provenance, then have the canonical view choose one display prompt per `grokPostId`. Do not dedupe by prompt text alone. |
| Grok exposes partial or conflicting metadata | Store field-level provenance such as source, capturedAt, and confidence. Mark missing or conflicting fields as gaps instead of inventing values. |
| D1 bloat or accidental broad API exposure | Store bulky raw metadata in R2 JSON objects first. D1 should hold pointers, hashes, counts, and selected lookup fields until the UI needs more. |
| Console logs or debug output leaking private prompts/source URLs | Remove or gate prompt/source URL logging before implementing the enumerator. Current code has prompt/source snippets in backup logs, so treat log hygiene as a first implementation prerequisite. |
| Local/browser automation dumps containing raw prompts | The enumerator may read raw prompt text, but durable planning docs and chat summaries should only describe schema and counts. Raw local snapshots should be ignored by git unless explicitly approved for commit. |

This policy is not a security promise. It is the minimum practical hygiene for a one-user system while still preserving the full archive.

## Existence Authority Decision

Current Grok Saved enumeration is the authority for "should this logical asset exist?"

Current qualifier:

- Visual spot-checks are not enough.
- The active-tab API capture is now the strongest current Grok Saved evidence. It attempted all `12446` asset IDs from `/rest/assets` and all `7985` source conversations, then captured media-post identity through `/rest/media/post/get` for `12232` successful rows.
- The capture remains a gap-bearing snapshot, not a clean-state proof. The `214` media-post response gaps, `1463` conversation response gaps, `5553` `needs_human_review` classifications, and `466` `orphan_candidate` classifications must stay visible until resolved or explicitly deferred.
- Future inventory work should reuse the active-tab API and async-worker path unless Grok changes the API surface or a better user-approved export appears. Do not go back to gallery scrolling as the primary enumeration method.
- The raw local Grok snapshots belong in ignored `private/` artifacts unless the user explicitly approves a different storage path. Committed summaries stay redacted/hash-only.

If R2 has more objects than Grok Saved appears to expose, do not delete or discard them. Classify the discrepancy and preserve the bytes until stronger evidence exists.

## Cleanup Strategy Decision

Make the system logically clean before making R2 physically clean.

Physical duplicate cleanup is still part of the target system. It comes after logical correctness, D1 projection, app-view validation, and repeated clean audits because deleting or moving R2 objects before the canonical model is proven would make recovery harder.

First repair phase:

- Preserve every existing R2 object.
- Build a canonical index that hides duplicate storage noise from product views.
- Classify objects rather than deleting them.
- Add ignore/archive/tombstone-style classifications only as metadata, not destructive operations.
- Do not physically delete, move, rewrite, or canonicalize R2 objects.

Physical cleanup can be considered only after:

- At least two clean audit runs.
- A rollback/export path exists.
- Every target object has durable classification evidence.
- The user explicitly approves a separate destructive cleanup plan.

Physical cleanup candidates must be generated from the approved canonical index, not from raw same-hash groups alone. Eligible candidates should be limited to objects that have a retained canonical copy, exact byte equality, an accepted identity-link signal, no unique metadata or prompt evidence, and no active canonical or variant reference.

## Required Classifications

Every R2 media object should eventually have one of these statuses:

- `canonical`: preferred storage object for a logical Grok Saved asset.
- `alternate_duplicate`: byte-identical or provably equivalent storage object attached to a canonical asset.
- `date_folder_mapped`: date-folder object mapped to a logical Saved asset, often as an alternate or historical storage location.
- `metadata_only_or_sidecar`: metadata or prompt-sidecar evidence, not a standalone media asset.
- `orphan_candidate`: object not yet linked to Grok Saved or another accepted source.
- `invalid_or_system`: upload-test, tool/system artifact, malformed object, or non-user media.
- `needs_human_review`: insufficient evidence for automated classification.

These classifications are not delete permissions.

## Duplicate Classification Decision

Automatic `alternate_duplicate` classification requires both:

1. Exact byte equality: same SHA-256 for the media bytes.
2. At least one identity-link signal:
   - same `grokPostId`
   - same media UUID
   - same canonical source URL hash
   - same prompt sidecar link

Implications:

- Same SHA-256 alone proves duplicate bytes, but does not prove the objects belong to the same logical Saved asset.
- Same identity signal without byte equality is not an alternate duplicate. Classify it as a variant, conflict, or `needs_human_review` depending on the evidence.
- Hash-only duplicate groups stay visible to diagnostics and reconciliation until another identity signal links them.
- Product views may hide `alternate_duplicate` objects once both checks pass, but phase one still does not delete, move, rewrite, or canonicalize physical R2 objects.

## Trust Invariants

Future build plans must preserve these invariants:

- No production R2 or D1 writes without a separate approved repair plan.
- No deletes in the first repair phase.
- No broad "repair everything" action.
- No treating `/api/vault/preview` or Worker normalized inventory as full raw R2 proof.
- No treating D1 absence as proof that an R2 object is invalid.
- No treating duplicate SHA-256 as automatic deletion approval.
- No claiming full Grok Saved completeness without authoritative Saved enumeration.
- No storing cookies, bearer tokens, signed URLs, API keys, or auth headers in durable artifacts.
- No storing raw private prompt bodies in committed audit/report/planning artifacts. Full prompt bodies are allowed in the Vault data plane.

## Recommended Phase Plan

Phase 0: Freeze the current evidence baseline

- Treat `edaaf8134bb545969d6e8036952695a3d8102ca7` as the current read-only evidence baseline.
- Update `manifest.json`, this strategy file, and implementation notes when planning interpretation changes.
- Do not mutate production R2, D1, Worker state, product data, or Grok in this phase.

Phase 1: Gap-bearing Grok Saved inventory baseline

- Current status: mostly complete for the captured active-tab API sources, with explicit response gaps.
- Keep the `12446` asset API rows, `7985` conversation attempts, and `12446` media-post attempts as the current baseline.
- Do not spend the next phase trying to scroll the full gallery or open every detail route unless a specific gap requires that proof and the user approves the browser action.
- Carry the `214` media-post gaps and `1463` conversation-response gaps into the canonical schema as first-class gap records.

Phase 2: Canonical snapshot schema

- Current status: complete for the local dry-run payload as schema version `r2-vault-canonical-snapshot/v1`.
- Define the schema for an append-only R2 JSON canonical snapshot before any production write.
- Include identity evidence, media variants, full prompts, metadata references, R2 storage locations, hashes, D1/Worker links, local corroboration, status, provenance, and confidence.
- Include source snapshot IDs, generated time, source counts, source hashes, classification counts, gap counts, rollback notes, and validation rules.
- Treat the schema as the contract before writing product code or D1 projection code.

Phase 3: Local-only canonical snapshot dry run

- Current status: complete and validated locally. The exact payload remains ignored/private; committed artifacts contain only counts, hashes, schema, validation, and approval gates.
- Generate the exact append-only R2 JSON payload locally from the ignored canonical index and raw private Grok evidence.
- Validate parseability, schema version, counts, hashes, status totals, gap totals, and source references.
- Produce committed-safe summary artifacts and an ignored raw local snapshot payload.
- Stop before any production write. The dry-run artifact is the approval object for the first write phase.

Phase 4: First approved canonical snapshot

- Current status: complete and readback verified for the object key recorded above.
- After the local dry-run snapshot is reviewed, write an append-only R2 JSON canonical snapshot only with explicit write approval.
- Approval must name the target bucket, exact object key, private payload SHA-256, stable content hash, source baseline commit, and rollback/readback verification plan.
- The write phase must immediately read the object back from R2, verify byte-for-byte payload SHA-256 and stable content hash, record object metadata, and update only committed-safe reports.
- Include schema version, source snapshot IDs, source counts, classification counts, content hashes, generated time, and rollback notes.
- Treat this R2 JSON snapshot as the durable source-of-truth and recovery record for the canonical model.
- Do not treat the R2 JSON snapshot as the final app query layer.
- Stop before D1 writes, Worker state changes, Grok actions, repair/sync routes, object moves, deletes, or physical cleanup unless a later goal explicitly approves those operations.

Phase 5: D1 canonical index projection

- Current status: next recommended phase. This phase still needs a separate approval before D1 writes or product read changes.
- Add D1 tables or rows as a derived projection from the approved R2 JSON canonical snapshot.
- Keep D1 focused on query fields, lookup keys, source pointers, hashes, status, counts, and selected display fields.
- Keep bulky raw metadata and full prompt archives in R2 unless a specific UI read requires a small D1 copy.
- Validate D1 against the R2 snapshot before product views use it: row counts, canonical IDs, classification counts, and manifest hash or version must match.

Phase 6: Logical product cleanup

- Teach app views to read from the D1 canonical index projection, with R2 JSON snapshots available for audit, recovery, and diagnostics.
- Product views should show one logical asset per canonical Saved identity.
- Duplicate/alternate/date-folder objects should be visible in diagnostics, not normal gallery views.
- Keep a reconciliation check that can compare app-facing D1 rows back to the R2 canonical snapshot and raw R2 inventory.

Phase 7: Review queue burn-down

- Resolve or explicitly defer `needs_human_review`, `orphan_candidate`, hash-only duplicate objects, and Grok API response gaps.
- Add narrow classification rules only when evidence supports them.
- Keep unresolved objects visible in diagnostics. Do not hide or delete them to make counts look clean.

Phase 8: Physical duplicate cleanup dry run

- After logical state, D1 projection, and app reads validate cleanly, generate a physical cleanup manifest.
- Include every proposed target key, retained canonical key, SHA-256, identity-link evidence, classification evidence, expected bytes saved, and reason.
- Include a non-candidate report for hash-only duplicates, conflicts, unique metadata, missing retained copy, or any object still referenced by canonical views.
- Run this phase as dry-run only until the user approves the exact manifest.

Phase 9: Approved physical duplicate cleanup

- Execute only after explicit approval of the dry-run manifest.
- Prefer the least destructive storage action that actually removes duplicate serving/storage paths, with a durable ledger before any delete or lifecycle move.
- Delete or move only objects already classified as safe physical duplicates by the dry-run manifest.
- Re-list R2, re-check hashes/counts, validate D1 against the R2 canonical snapshot, and run the audit again after cleanup.
- The plan is not complete until physical duplicate cleanup has either succeeded or the user explicitly defers specific candidate groups with reasons.

## Open Questions

No planning question blocks the next execution slice. The current recommendation is:

- Logical clean: every Grok Saved item has one canonical logical record, every R2 media object is classified, and product views show one logical asset per canonical Saved identity.
- Index clean: the D1 projection matches the approved R2 canonical snapshot by version, counts, canonical IDs, classifications, and query-critical fields.
- Storage clean: physical duplicate cleanup candidates have been dry-run, approved, executed or explicitly deferred, and verified by a post-cleanup R2/D1 audit.
- The implementation should reach logical clean first, then index clean, then storage clean. Full system clean means all three are satisfied or any remaining physical duplicate groups are explicitly deferred with documented reasons.

Current next execution slice:

1. Derive the D1 canonical index projection from the approved R2 JSON snapshot object.
2. Validate D1 row counts, canonical IDs, classifications, hashes, selected display fields, and snapshot version against the approved R2 object.
3. Keep full raw prompts and bulky metadata in R2 while D1 stores query fields, lookup keys, pointers, statuses, counts, and selected display fields.
4. Stop before product route changes, Worker state changes, Grok actions, repair/sync routes, object moves, deletes, or physical duplicate cleanup unless a later goal explicitly approves those operations.
5. After D1 validates, move to product-view validation, recurring reconciliation, review queue burn-down, physical cleanup dry run, and separately approved physical cleanup.
