# R2 Vault Trustworthy Canonical System Strategy

Date: 2026-06-28

Repo: `/Users/philipbankier/Development/skunkworks/Grok-Tinker/chrome-extension-powertools`

Status: living strategy record for post-audit repair planning. This is not approval to mutate production.

## Source Evidence

Primary evidence folder:

- `docs/audits/2026-06-26-production-r2-vault-system-audit/`

Final audit checkpoint:

- Branch: `codex/production-r2-vault-audit`
- Commit: `15c307d docs: complete production r2 vault audit`

Audit verdicts:

- Production R2 internal correctness: `dirty`
- Current Grok Saved completeness: `sample_verified`
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
- Same-hash duplicate groups: `5116`
- Unresolved groups: `5`

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

Important qualifier:

- Visual spot-checks are not enough.
- The next phase needs a durable, repeatable Grok Saved inventory snapshot.
- The snapshot must capture every Saved item reachable in the current Grok Saved surface, stable item evidence when available, visible media references, project/history context when available, and any metadata Grok exposes.

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

Phase 0: Freeze the decision record

- Keep this file as the source of truth for the current strategy.
- Keep the completed audit folder immutable except for clearly marked follow-up notes.

Phase 1: Durable Grok Saved inventory

- Build a read-only Saved enumerator for the existing Chrome session or another user-approved export/API path.
- Capture a stable snapshot without generating, deleting, syncing, backing up, or repairing.
- Open each Saved media item or otherwise read its detail route to capture `grokPostId` from `/imagine/post/{uuid}` when available.
- Capture media URL UUIDs separately as variant/storage evidence, not as the primary logical item identity unless no `grokPostId` can be recovered.
- Capture full prompt text and all available metadata into the raw Vault inventory artifact.
- Keep any raw local snapshot out of git unless the user explicitly approves committing it.
- Produce a redacted/hash-only audit summary beside the raw Vault inventory so planning and review can happen safely.
- Produce a parseable Saved inventory artifact.

Phase 2: Canonical asset model

- Define the schema for a logical Saved asset record.
- Include identity evidence, media variants, full prompts, metadata references, R2 storage locations, hashes, D1/Worker links, local corroboration, status, provenance, and confidence.
- Treat schema as the contract before writing product code.

Phase 3: Read-only reconciliation

- Join Grok Saved snapshot, raw R2 inventory, R2 hashes, D1/Worker rows, metadata, and local hashes.
- Produce a classification proposal for every R2 media object and every Saved item.
- Produce separate lists for missing-from-R2, R2-only/unlinked, duplicate groups, metadata gaps, and human-review items.

Phase 4: First approved canonical snapshot

- After the read-only reconciliation is reviewed, write an append-only R2 JSON canonical snapshot only with explicit write approval.
- Include schema version, source snapshot IDs, source counts, classification counts, content hashes, generated time, and rollback notes.
- Treat this R2 JSON snapshot as the durable source-of-truth and recovery record for the canonical model.
- Do not treat the R2 JSON snapshot as the final app query layer.

Phase 5: D1 canonical index projection

- Add D1 tables or rows as a derived projection from the approved R2 JSON canonical snapshot.
- Keep D1 focused on query fields, lookup keys, source pointers, hashes, status, counts, and selected display fields.
- Keep bulky raw metadata and full prompt archives in R2 unless a specific UI read requires a small D1 copy.
- Validate D1 against the R2 snapshot before product views use it: row counts, canonical IDs, classification counts, and manifest hash or version must match.

Phase 6: Logical product cleanup

- Teach app views to read from the D1 canonical index projection, with R2 JSON snapshots available for audit, recovery, and diagnostics.
- Product views should show one logical asset per canonical Saved identity.
- Duplicate/alternate/date-folder objects should be visible in diagnostics, not normal gallery views.
- Keep a reconciliation check that can compare app-facing D1 rows back to the R2 canonical snapshot and raw R2 inventory.

Phase 7: Physical duplicate cleanup dry run

- After logical state, D1 projection, and app reads validate cleanly, generate a physical cleanup manifest.
- Include every proposed target key, retained canonical key, SHA-256, identity-link evidence, classification evidence, expected bytes saved, and reason.
- Include a non-candidate report for hash-only duplicates, conflicts, unique metadata, missing retained copy, or any object still referenced by canonical views.
- Run this phase as dry-run only until the user approves the exact manifest.

Phase 8: Approved physical duplicate cleanup

- Execute only after explicit approval of the dry-run manifest.
- Prefer the least destructive storage action that actually removes duplicate serving/storage paths, with a durable ledger before any delete or lifecycle move.
- Delete or move only objects already classified as safe physical duplicates by the dry-run manifest.
- Re-list R2, re-check hashes/counts, validate D1 against the R2 canonical snapshot, and run the audit again after cleanup.
- The plan is not complete until physical duplicate cleanup has either succeeded or the user explicitly defers specific candidate groups with reasons.

## Open Questions

These are the next grilling decisions:

1. What does "clean" mean for the next audit and final target: logical clean, index clean, storage clean, or all three in stages?

## Current Recommended Next Question

What does "clean" mean?

Recommended answer to evaluate next:

- Logical clean: every Grok Saved item has one canonical logical record, every R2 media object is classified, and product views show one logical asset per canonical Saved identity.
- Index clean: the D1 projection matches the approved R2 canonical snapshot by version, counts, canonical IDs, classifications, and query-critical fields.
- Storage clean: physical duplicate cleanup candidates have been dry-run, approved, executed or explicitly deferred, and verified by a post-cleanup R2/D1 audit.
- The implementation should reach logical clean first, then index clean, then storage clean. Full system clean means all three are satisfied or any remaining physical duplicate groups are explicitly deferred with documented reasons.
