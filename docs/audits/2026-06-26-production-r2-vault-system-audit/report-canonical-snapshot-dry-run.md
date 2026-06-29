# Canonical Snapshot Dry Run

Generated: 2026-06-29T00:47:23.175Z

This report is redacted. It contains counts and hashes only. The exact dry-run payload is ignored at `private/canonical-snapshot-dry-run.json`.

## Status

- Production writes: no
- Schema: r2-vault-canonical-snapshot/v1
- Dry-run valid: yes
- Private payload SHA-256: `21c49f43c6692eff5b31ea0cb9ebaa882840e19895bf90c3cd35ada0e75e9fb6`
- Stable content hash: `4100f2c3c2d3837a212125c39b6d926cefa31c7453af4a5df9d1d49d6b4f2ef1`

## Counts

- Logical assets: 8080
- Storage objects: 15981
- Prompt records: 13914
- Gap records: 7696

## Classification Counts

- orphan_candidate: 466
- needs_human_review: 5553
- date_folder_mapped: 5541
- canonical: 4419
- alternate_duplicate: 2

## Gap Counts

- d1MissingCanonicalMedia: 1441
- grokApiCoveredMedia: 6541
- grokApiPromptLinkedMedia: 4707
- grokApiUnlinkedMedia: 9440
- grokMediaPostLinkedMedia: 6541
- grokMediaPostPromptLinkedMedia: 3614
- grokMediaPostUnlinkedMedia: 9440
- grokSavedIdentityLimited: 0
- grokSavedInventoryBlocked: 0
- grokSavedInventoryPartial: 0
- metadataLinkedMedia: 2090
- metadataUnlinkedMedia: 13891
- needsHumanReview: 5553
- orphanCandidates: 466
- workerMissingCanonicalMedia: 1441

## Duplicate Evidence

- Same-hash groups: 5116
- Accepted linked duplicate objects: 4330
- Hash-only duplicate objects needing review: 2627

## Approval Gate

The next phase is an append-only R2 JSON snapshot write. It requires explicit user approval naming the target bucket/key, payload SHA-256, stable content hash, source baseline commit, and rollback/readback verification plan. D1 writes, Worker writes, Grok actions, object moves, deletes, repair routes, sync routes, and physical cleanup remain forbidden without separate approval.

## Next Staged Plan

This dry run is not the final clean state. It is the approval object for the first durable canonical snapshot.

1. Write the exact append-only R2 JSON snapshot only after explicit approval, then read it back and verify byte SHA-256 plus stable content hash.
2. Build the D1 canonical index projection from the approved R2 snapshot, not directly from ad hoc local files.
3. Point normal product views at the D1 projection while keeping duplicate, variant, orphan, and review evidence visible in diagnostics.
4. Keep recurring reconciliation from D1 back to the R2 snapshot, raw R2 inventory, and Grok evidence.
5. Burn down or explicitly defer the review queue: media-post gaps, conversation-response gaps, `needs_human_review`, `orphan_candidate`, and hash-only duplicate groups.
6. Generate a physical duplicate cleanup dry-run manifest only after logical state, D1 projection, and app reads validate cleanly.
7. Execute physical duplicate cleanup only after separate approval of the exact manifest, then rerun the audit to verify storage, index, and product state.

## Validation

- No validation errors.
