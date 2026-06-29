# D1 Canonical Projection Write

Generated: 2026-06-29T09:07:47.703Z

This report is committed-safe. It records the approved production D1 projection write and readback verification without raw prompt bodies, cookies, bearer tokens, signed URLs, raw SQL values, or private row payloads.

## Status

- Result: write_readback_verified
- D1 database: `grok-powertools-db`
- D1 database id: `ad89e4bb-0b68-4c72-93d9-b90e6eb45aa6`
- Projection schema: `d1-canonical-projection/v1`
- Source payload SHA-256: `21c49f43c6692eff5b31ea0cb9ebaa882840e19895bf90c3cd35ada0e75e9fb6`
- Source stable content hash: `4100f2c3c2d3837a212125c39b6d926cefa31c7453af4a5df9d1d49d6b4f2ef1`
- Readback valid: yes

## Writes

- D1 projection writes: 138035
- Worker state writes: 0
- Product route/read changes: 0
- Grok actions: 0
- R2 writes: 0
- R2 object moves: 0
- R2 object deletes: 0
- Repair route calls: 0
- Sync route calls: 0
- Physical cleanup actions: 0

## Readback Counts

- Snapshot rows: 1
- Asset rows: 8080
- Storage rows: 15981
- Prompt rows: 13914
- Gap rows: 7696
- Lookup rows: 92363

## Review Queue

- Review-required assets: 5482
- Needs-human-review storage rows: 5553
- Orphan-candidate storage rows: 466
- Grok conversation response gaps: 1463
- Grok media-post response gaps: 214

## Rollback And Recovery

The approved R2 canonical snapshot remains the recovery source. No product route or Worker read path has been switched to this projection in this phase.

## D1 Write Adaptations

- `canonical_asset_projection`: one oversized composite `grokPostSet` `identity_value` was stored as `NULL` in D1 because it exceeded D1 raw SQL statement limits. The `identity_value_hash` and individual `grok_post_id` lookup rows preserve query identity.
- `canonical_storage_object_projection`: nine oversized `prompt_ref_ids_json` lists were compacted to small sentinel JSON values because each list exceeded D1 raw SQL statement limits. Individual `prompt_ref_id` lookup rows preserve query links.
- `canonical_asset_lookup`: one oversized composite identity lookup value was stored as `NULL` in D1. The lookup hash and individual `grok_post_id` lookup rows preserve query identity.

## Next Phase

The next phase is product/Worker read-path design and validation against this D1 projection, after separate approval. R2 moves/deletes, repair/sync routes, Grok actions, and physical cleanup remain outside this phase.

## Validation

- No validation errors.
