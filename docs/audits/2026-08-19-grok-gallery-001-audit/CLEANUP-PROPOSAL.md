# Cleanup proposal

Status: proposal only. No delete, repair, backfill, processed-ID reset, or D1 write is authorized.

## Phase 1: close capture correctness

Completed:

- Deployed Worker version `b0886d79-a8a0-40a2-b1c8-1f7115de6eb0` and proved R2-authoritative pagination for all 16,496 media objects.
- Reloaded the exact unpacked extension and ran one approved production canary.
- Verified the canary media bytes, ranges, signature, decoder output, Worker visibility, and stable post-canary R2 fingerprint.
- Reproduced the nested Grok 2.0 prompt defect with failing tests, corrected prompt extraction, and made empty prompt metadata fail before any R2 request.
- Ran one separately approved targeted follow-up against the exact existing media asset.
- Verified a non-empty authoritative prompt, exact asset and conversation binding, immutable sidecar hash, unchanged media object, unchanged processed-ID membership, and a one-object-only R2 delta.
- Proved two stable post-correction listings at 18,738 objects and fingerprint `ac9aab1368ba4dced4f91102b7e1c6a208019f01fe4f1e0a1d3c01e92417d311`.

Still retained and approval-gated:

- Retain the first immutable invalid sidecar as failed evidence unless a separate deletion review authorizes removal.
- Do not generalize one corrected asset into full-gallery metadata completeness. The remaining recovery work starts from exact source proof and a dry-run ledger.

## Phase 2: build an index-repair ledger

- Reconcile the 11,335 R2 media objects with no D1 row, separating 1,442 canonical gaps from legacy objects intentionally outside the current D1 model.
- Remove or reclassify the one D1 system-test row only after a dry-run identifies every reference.
- Refresh the stale canonical projection without changing media.
- Prove every proposed row is idempotent and already represented by a verified R2 media object.

Each D1 write requires a dry-run diff, idempotency key, append-only repair receipt, rollback path, and separate approval.

## Phase 3: recover metadata

- Prioritize the 14,269 media objects with no supported metadata reference.
- Backfill metadata v2 only from an exact Grok conversation response or another source with equivalent proof.
- Keep the 37 historical prompt mismatches unresolved until authoritative evidence identifies the correct prompt.
- Never infer asset IDs, prompts, timestamps, or relationships from filenames, current composer text, cached public URLs, or neighboring objects.
- Preserve legacy prompt sidecars until all readers consume metadata v2 and a compatibility migration is separately approved.

## Phase 4: build the deletion ledger

For every proposed deletion, record:

- candidate key hash and content SHA-256;
- survivor key hash and verified media access;
- duplicate class and expected reclaimed bytes;
- D1, projection, metadata, processed-ID, Worker, and web references;
- conditional operation preconditions;
- rollback receipt and approval ID.

Only the 2,926 legacy repeated-byte groups and 676 legacy-to-canonical alias groups enter initial review. The 1,514 canonical same-byte distinct-ID groups are excluded by default.

## Phase 5: approval-gated cleanup

- Apply small conditional batches.
- Verify candidate absence, survivor access, Worker visibility, D1 consistency, and byte accounting after each batch.
- Stop on listing drift, reference mismatch, decoder failure, non-idempotent behavior, or an unexpected object mutation.
- Rerun full listing fingerprints, media hashes, metadata checks, D1 reconciliation, Worker coverage, and decoder samples before calling the bucket clean.
