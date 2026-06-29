# Canonical Snapshot R2 Write

Generated: 2026-06-29T03:09:58.385Z

This report is committed-safe. It records the approved append-only R2 snapshot write and readback verification without raw prompt bodies, private Grok IDs, cookies, bearer tokens, signed URLs, or raw payload content.

## Status

- Result: write_readback_verified
- Production R2 append-only snapshot objects written: 1
- D1 writes: 0
- Worker state writes: 0
- Grok actions: 0
- Object moves: 0
- Object deletes: 0
- Repair route calls: 0
- Sync route calls: 0
- Physical cleanup actions: 0

## R2 Object

- Bucket: `grok-gallery-001`
- Object key: `grok-powertools/v1/users/_system/canonical-snapshots/r2-vault-canonical-snapshot-v1/2026-06-29T004723Z-4100f2c3c2d3837a212125c39b6d926cefa31c7453af4a5df9d1d49d6b4f2ef1.json`
- Bytes: 112614234
- ETag: `"025f78814c8ff5a0dfda355a44d589b5"`
- Content type: `application/json; charset=utf-8`
- Last modified: 2026-06-29T03:09:53.000Z

## Verification

- Target absent before write: yes
- Target exists after write: yes
- Readback byte length matches local: yes
- Payload SHA-256: `21c49f43c6692eff5b31ea0cb9ebaa882840e19895bf90c3cd35ada0e75e9fb6`
- Stable content hash: `4100f2c3c2d3837a212125c39b6d926cefa31c7453af4a5df9d1d49d6b4f2ef1`
- Byte SHA-256 matches approval: yes
- Stable content hash matches approval: yes
- Verification status: ok

## Source Payload

- Local payload path: `private/canonical-snapshot-dry-run.json`
- Local payload ignored by git: yes
- Schema: `r2-vault-canonical-snapshot/v1`
- Snapshot kind: `local_dry_run`
- Source baseline commit: `edaaf8134bb545969d6e8036952695a3d8102ca7`
- Logical assets: 8080
- Storage objects: 15981
- Prompt records: 13914
- Gap records: 7696

## Next Phase

D1 canonical projection from the approved R2 snapshot after separate approval.

D1 writes, Worker writes, Grok actions, repair/sync routes, object moves, object deletes, and physical duplicate cleanup remain outside this completed write/readback phase.
