# D1 Canonical Projection Dry Run

Generated: 2026-06-29T08:34:27.391Z

This report is committed-safe. It records the local-only D1 projection dry run derived from the approved R2 canonical snapshot. Exact projection rows are ignored under `private/`.

## Status

- Projection schema: `d1-canonical-projection/v1`
- Source payload SHA-256: `21c49f43c6692eff5b31ea0cb9ebaa882840e19895bf90c3cd35ada0e75e9fb6`
- Source stable content hash: `4100f2c3c2d3837a212125c39b6d926cefa31c7453af4a5df9d1d49d6b4f2ef1`
- Dry-run valid: yes
- D1 writes: 0
- Worker state writes: 0
- Grok actions: 0
- R2 writes: 0
- Object moves: 0
- Object deletes: 0
- Physical cleanup actions: 0

## Row Counts

- Snapshot rows: 1
- Asset rows: 8080
- Storage rows: 15981
- Prompt rows: 13914
- Gap rows: 7696
- Lookup rows: 92363

## Current D1 Comparison

- Database: `grok-powertools-db`
- Database id: `ad89e4bb-0b68-4c72-93d9-b90e6eb45aa6`
- Schema artifact: `inventory/d1-schema.json`
- Current tables: 8
- Current indexes: 10
- Existing projection tables present: none
- Interpretation: current production D1 is upload/object-key centered; this dry run adds a separate logical canonical projection contract and does not mutate D1

## Review Queue

- Review-required assets: 5482
- Blocking gap rows: 6019
- Warning gap rows: 1677
- Needs-human-review storage rows: 5553
- Orphan-candidate storage rows: 466

## Storage Status Counts

- alternate_duplicate: 2
- canonical: 4419
- date_folder_mapped: 5541
- needs_human_review: 5553
- orphan_candidate: 466

## Gap Type Counts

- grok_conversation_response_gap: 1463
- grok_media_post_response_gap: 214
- needs_human_review: 5553
- orphan_candidate: 466

## Prompt Policy

Prompt bodies remain in the approved R2 snapshot data plane. The D1 projection dry-run stores prompt reference IDs, prompt hashes, selected metadata summaries, and media evidence counts, not raw prompt or originalPrompt text.

## Approval Gate

The next phase is `d1_canonical_projection_write_after_separate_approval`. It requires explicit approval naming the target D1 database, source R2 snapshot, payload SHA-256, stable content hash, projection schema id, expected row counts, and rollback plan. Product read changes, Worker writes, Grok actions, R2 moves/deletes, repair/sync routes, and physical duplicate cleanup remain outside this dry run.

## Validation

- No validation errors.
