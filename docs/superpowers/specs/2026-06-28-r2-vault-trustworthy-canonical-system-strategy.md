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
- Keep D1 primarily as an index and lookup layer unless product needs force a small number of prompt fields into D1.
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

Phase 4: Logical product cleanup

- Teach app views to read from the canonical asset model or an equivalent generated index.
- Product views should show one logical asset per canonical Saved identity.
- Duplicate/alternate/date-folder objects should be visible in diagnostics, not normal gallery views.

Phase 5: Approved repair plan

- Only after the read-only classification is reviewed, design exact write steps.
- Prefer append-only index/ledger updates first.
- Avoid object rewrites or deletes.
- Use exact counts, plan hashes, rollback notes, and explicit user approval.

Phase 6: Physical cleanup, optional and later

- Consider deletes or lifecycle moves only after repeated clean audits and explicit approval.

## Open Questions

These are the next grilling decisions:

1. How should image/video pairs and generated variants be represented: one asset with variants, or separate assets linked by generation context?
2. What is the minimum confidence threshold for automatic `alternate_duplicate` classification?
3. Where should the canonical index live first: D1, R2 JSON snapshot, both, or local-only draft?
4. What does "clean" mean for the next audit: zero unresolved canonical objects, zero duplicate product assets, or zero physical duplicate bytes?

## Current Recommended Next Question

How should image/video pairs and generated variants be represented?

Recommended answer to evaluate next:

- Treat `grokPostId` as the logical record.
- Represent image/video outputs, thumbnails, upscales, extensions, and re-downloads as variants under that record when Grok presents them as one post.
- Split into separate logical records only when Grok exposes separate `/imagine/post/{uuid}` identities.
