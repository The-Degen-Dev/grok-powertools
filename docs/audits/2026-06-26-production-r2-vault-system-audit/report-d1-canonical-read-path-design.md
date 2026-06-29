# D1 Canonical Read Path Design

Generated: 2026-06-29T21:43:21Z

This report is committed-safe. It records the local Worker and web proxy read-path design for the verified D1 canonical projection without raw prompt bodies, cookies, bearer tokens, signed URLs, raw SQL payloads, or private row dumps.

## Status

- Result: local read path implemented and tested
- Default Worker inventory behavior: unchanged
- Default web Vault preview behavior: unchanged
- Production deploys: 0
- Product route/read switches: 0
- Worker state writes: 0
- R2 writes, moves, or deletes: 0
- Grok actions: 0
- Repair, sync, or physical cleanup actions: 0

## Contract

- `GET /v1/vault/inventory?source=canonical` reads `canonical_snapshot_index`, `canonical_asset_projection`, and `canonical_storage_object_projection`.
- `GET /v1/vault/gaps?source=canonical` reads `canonical_snapshot_index` and `canonical_gap_projection`.
- `GET /v1/vault/media?assetId=...&source=canonical` resolves the asset through the canonical projection before fetching R2 bytes.
- Existing requests without `source=canonical` stay on the legacy `r2_dedupe_index` and R2 fallback path.
- The web proxy forwards explicit `source=canonical` for inventory, gaps, media, and preview. `VAULT_WORKER_READ_SOURCE=canonical` is also supported for local preview validation.

## Safety Behavior

- Canonical mode is explicit opt-in. It does not silently replace existing product reads.
- Canonical mode fails closed with `CANONICAL_PROJECTION_UNAVAILABLE` when the projection marker row is missing or unreadable.
- Review-required canonical assets map to `blocked` even when their raw verification status is `unproven`, so review rows stay visible.
- Gap pagination uses primary-key order for low read cost. Review-priority sorting is deferred to a later filter/query mode.

## Production SELECT Validation

SELECT-only validation against `grok-powertools-db` verified the query shapes used by the local code:

- Snapshot marker query returned `snapshot_4100f2c3c2d3837a`, stable content hash `4100f2c3c2d3837a212125c39b6d926cefa31c7453af4a5df9d1d49d6b4f2ef1`, and source counts `8080` assets, `15981` storage objects, `13914` prompt refs, `7696` gaps.
- Asset page query read 3 rows for a 3-row sample page and reported `changed_db=false`.
- Storage-object subquery read 19 rows for the sampled page and reported `changed_db=false`.
- Gap page query read 3 rows for a 3-row sample page and reported `changed_db=false`.

The committed-safe validation log is `logs/d1-canonical-read-path-select-validation.json`.

## Next Gate

The next phase is a separately approved Worker deploy and live route smoke. That phase should still stop before making canonical reads the default product path, before repair/sync routes, before R2 moves/deletes, before Grok actions, and before physical duplicate cleanup.
