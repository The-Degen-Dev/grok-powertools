# Grok Gallery 001 Read-Only Audit

Date: 2026-08-13, refreshed through the stable 2026-08-16 bucket state

Target: `grok-gallery-001`, including the production prefix `grok-powertools/v1`

Audit mode: read-only. No R2 or D1 objects were written, changed, or deleted. No sync was started. No processed IDs, extension settings, Worker secrets, OAuth settings, or environment values were changed.

Refresh scope: the user ran sync after the original snapshot. R2, D1, Worker, and metadata evidence were refreshed after two byte-identical full listings. The authenticated Grok Saved feed was not recollected, so its 2026-08-13 comparison remains a dated source snapshot rather than a claim about the 2026-08-16 live gallery.

## Verdict

The bucket is byte-readable and internally consistent, but it is not duplicate-clean, metadata-complete, fully indexed, or proven complete against the current Grok Imagine Saved source.

The strongest findings are:

- All 16,347 R2 media objects were inventoried and covered by SHA-256 evidence. There were no failed hashes, failed HEAD reads, zero-byte media objects, stored canonical hash mismatches, or declared media-type mismatches.
- The bucket contains 6,957 excess byte-identical copies across 5,116 content-hash groups. Those copies account for 21,227,556,071 bytes, about 19.77 GiB.
- Duplicate groups are not one deletion class. They include legacy repeats, legacy-to-canonical aliases, distinct canonical asset IDs with the same bytes, and two logical identities with multiple different payloads. No deletion is safe from the current evidence alone.
- The 2026-08-13 Grok Saved pagination returned 13,323 unique Imagine conversations and 9,565 latest-asset rows, representing 9,555 unique latest asset IDs. A further 3,758 conversations had no latest-asset payload in the list response.
- Only 379 latest asset identities in that time-aligned snapshot matched an R2 logical identity. Another 5,640 unique latest assets had no R2 media object with even the same media category and declared byte size. Those 5,640 assets declare 10,607,072,367 bytes. This is strong gap evidence, but not final content proof because the extension may have stored transformed CDN representations.
- The remaining 3,915 assets in that snapshot had at least one same-category, same-size R2 candidate. Size is not a content identity. Resolving that set requires hashing live Grok media bytes or obtaining an authoritative provider content digest.
- In the time-aligned 2026-08-13 comparison, R2 contained 11,582 logical identities not represented by that day's latest-asset ID set. These can include historical variants, old URL identities, or archive-only objects and must be retained until lineage is reconstructed.
- Per-media metadata is incomplete. Only 2,200 of 16,347 media objects have prompt sidecars, and 14,147 have none. All 9,893 legacy media objects lack stored SHA-256 metadata, asset identity, source URL hash, media type metadata, extension version, and capture time.
- Historical prompt evidence found 37 sidecars whose stored prompt does not match either canonical prompt hash linked to that media. The current backup path reads the active composer text, not the selected Saved asset's authoritative prompt.
- D1 and the Worker are incomplete views. D1 has 5,013 media rows while R2 has 16,347 media objects. The Worker inventory therefore returns 5,013 assets, and 1,441 canonical media objects are absent from D1.
- Every Worker metadata route returned an empty dataset because the reader is hardcoded to one username namespace rather than resolving the actual user namespace.

## R2 Inventory

| Measure | Result |
| --- | ---: |
| Total objects | 18,561 |
| Total bytes | 45,285,432,057 |
| Media objects | 16,347 |
| Media bytes | 45,170,455,642 |
| Images | 9,823 |
| Videos | 6,524 |
| Legacy media | 9,893 |
| Canonical media | 6,454 |
| Prompt sidecars | 2,200 |
| Metadata snapshots | 10 |
| Unique media SHA-256 values | 9,390 |
| Unique-content bytes after exact-byte dedupe | 23,942,899,571 |

The original run reused 15,917 unchanged June hashes, independently revalidated 64 unchanged objects across path classes with no mismatch, and freshly hashed 312 new or changed media objects. The refresh then streamed and hashed all 54 newly listed media objects, 87,692,930 bytes, with no failures. The revalidation found no reason to reread all 45 GB.

Two final full ListObjectsV2 passes returned byte-identical inventories: 18,561 objects, 45,285,432,057 bytes, newest object timestamp 2026-08-16T18:44:55.989Z, and listing fingerprint `170feaa56fc7445ed950d450cf8d4ce2050122b30ed995380e41973203db8509`.

## Post-Sync Refresh

| Change from the 2026-08-13 baseline | Delta |
| --- | ---: |
| Objects | +57 |
| Total bytes | +87,711,764 |
| Canonical media | +54 |
| Media bytes | +87,692,930 |
| Images | +21 |
| Videos | +33 |
| Prompt sidecars | +3 |
| Media without prompt sidecars | +51 |
| D1 media rows | +54 |
| Worker media rows | +54 |

All 54 added media have distinct SHA-256 values not present elsewhere in the bucket, so the exact-duplicate groups and excess duplicate bytes did not increase. Every added canonical media row reached D1 and the Worker. The remaining 1,441 canonical D1 gap is unchanged. The latest processed-ID snapshot rose from 12,771 to 12,825 records, while prompt sidecars rose by only three.

## Duplicate Classes

| Class | Groups | Excess bytes | Interpretation |
| --- | ---: | ---: | --- |
| Legacy repeated bytes | 2,926 | 15,088,525,479 | Repeated legacy storage paths; candidate cleanup only after lineage proof |
| Legacy and canonical alias | 676 | 2,368,513,146 | Same bytes in both layouts; canonical target still needs reference proof |
| Canonical IDs sharing bytes | 1,514 | 3,770,517,446 | May be valid generation variants; do not collapse by hash alone |

There are also 2,929 repeated logical-identity groups. Of these, 2,927 are exact aliases and two contain multiple payloads for one logical identity. Those two are conflict evidence and must be preserved for review.

Prompt reuse is not a duplicate signal by itself. The audit found 113 repeated-prompt groups: 95 contain generation variants with different bytes, and 18 contain the same prompt and bytes.

## 2026-08-13 Grok Saved Reconciliation

The Saved snapshot was collected on 2026-08-13 through the authenticated Imagine conversation feed. The endpoint accepted `pageSize=100` but returned at most 30 rows per page, so the audit followed 445 continuation pages to the terminal response. No browser tabs were enumerated. These rows were not recollected during the R2 refresh.

| Measure | Result |
| --- | ---: |
| Conversations | 13,323 |
| Conversations with latest-asset metadata | 9,565 |
| Conversations without latest-asset metadata | 3,758 |
| Unique latest asset IDs | 9,555 |
| Declared latest-asset bytes | 28,268,421,611 |
| Images | 3,250 |
| Videos | 6,305 |
| Current identities matching R2 | 379 |
| No same-category, same-size R2 candidate | 5,640 |
| One same-category, same-size candidate | 1,262 |
| Multiple same-category, same-size candidates | 2,653 |

The 379 identity matches prove a small overlap in the time-aligned 2026-08-13 snapshot. The 5,640 no-candidate rows were strong evidence of missing representations at that time. The 3,915 size-candidate rows remain ambiguous because equal size does not prove equal content. Counts alone are also misleading: the refreshed R2 has 9,390 unique byte hashes while the dated Saved snapshot has 9,555 unique latest IDs, but those sets cannot be equated or treated as contemporaneous.

The captured feed exposes richer generation metadata than R2 preserves, including provider asset, conversation and response identity, media key, dimensions, model, mode, resolution, aspect ratio, duration, audio selection, input assets, references, and generation type. Prompt text was present for 5,476 latest-asset rows. Image-to-video records frequently depend on an input asset and do not repeat the inherited source prompt.

Only 175 latest rows in that snapshot linked to an R2 prompt sidecar; all 175 matched its API prompt. This does not invalidate the 37 historical mismatches, which belong to older or non-latest assets.

## Metadata And Prompt Accuracy

The current R2 per-media contract is not sufficient to recreate provenance:

- 14,147 media objects have no prompt sidecar.
- 1,876 of 2,200 sidecars omit `assetId`.
- Sidecars preserve only 126 distinct normalized prompts across 2,200 objects.
- The bucket does not persist original-versus-effective prompt, post ID, conversation ID, response ID, model and generation settings, dimensions, duration, audio presence/codecs, created/saved timestamps, parent/reference/variant relationships, metadata schema version, or evidence source per media object.
- The latest processed-ID snapshot contains 12,825 records. That count is not completeness proof because it represents client processing state, not a verified one-to-one mapping to current Saved media.

The prompt bug is repo-grounded: `performBackupUpload()` currently obtains `promptText` from the active composer through `readCurrentPromptInput()`. That value can belong to an unrelated generation and should not be used as selected-media provenance.

## D1 And Worker Findings

- D1 has 5,014 dedupe rows, including one non-media/system row, so the Worker exposes 5,013 media assets.
- No D1 row points to a missing R2 object and no indexed content hash disagrees with the R2 hash.
- 1,441 canonical media objects are absent from D1.
- The Worker returns the D1 inventory whenever D1 yields any rows. It does not merge the indexed subset with the remaining R2 inventory.
- All five Worker metadata reads returned an empty list. The reader requests `users/greymaker/metadata/...`, while real snapshots exist in other user namespaces.
- The June canonical projection is stale. It covers 15,981 old storage objects, all still present, but excludes 366 current canonical media objects and still contains 7,696 unresolved gap records.

## Media Readability

The audit selected 23 deterministic samples across canonical and legacy images and videos, plus representatives from each exact-duplicate class. All 23 passed:

- HeadObject size and content-type checks
- first-byte and tail-byte ranged GetObject requests with HTTP 206
- file-signature validation against declared type
- `ffprobe` format and stream decoding

This proves sampled readability and range support. It does not prove every one of the 16,347 objects decodes, although every object did pass full SHA-256 streaming during the inventory.

## Proven Defects

1. Prompt provenance can be wrong because backup reads active composer text.
2. Worker inventory is an incomplete D1-only view whenever D1 is nonempty.
3. Worker metadata lookup is hardcoded to the wrong user namespace.
4. D1 is missing 1,441 canonical R2 media objects.
5. Legacy media metadata is insufficient for deterministic identity and provenance.
6. Exact duplicate storage consumes about 19.77 GiB, but no deletion set is yet proven safe.
7. Current Saved completeness is not established; identity and size evidence indicate a substantial gap.

## Remaining Ambiguity

The audit did not hash all live Grok media bytes. Doing so against the captured feed could transfer up to its declared 28.27 GB, may encounter signed-URL transformations, and should be separately approved. That phase is needed to distinguish:

- current media already present under an old or different identity,
- transformed versions of the same logical media,
- current media genuinely absent from R2,
- R2-only historical variants that should remain archive-only.

The 3,758 conversations with null latest-asset metadata also require a product decision: whether they are expected empty/deleted conversations or gaps that require conversation-level recovery.

## Recommended Next Phase

1. Keep all current R2 objects. Do not delete or rewrite anything yet.
2. Fix capture provenance first: use the selected asset's API or DOM-backed metadata, never the active composer, and persist a versioned schema with generation and relationship fields.
3. Fix Worker metadata namespace resolution and make inventory merge D1 with unindexed R2 objects or fail visibly as partial.
4. Rebuild D1 into shadow tables from R2, verify counts and hashes, then swap only after approval.
5. Run an approved, checkpointed live content-hash reconciliation for current Saved assets. Record only hashes and sanitized metadata, not prompts or cookies.
6. Produce a deletion proposal by duplicate class with canonical survivor, all inbound references, retained conflict evidence, byte savings, and a reversible ledger. Deletion remains a separate approval gate.

## Open Questions

1. Should completeness mean one current latest asset for every Imagine conversation, or every generated variant and referenced input asset in each conversation? Recommendation: guarantee every current Saved-visible asset first, preserve all R2-only history, then add complete variant lineage where Grok exposes it.
2. Do you approve the next read-only live media hash phase, with a possible transfer of roughly 28.27 GB and provider rate limiting? This is the only reliable way to resolve the identity mismatch without guessing.
3. How should the 3,758 conversations without latest-asset metadata be classified: expected empty/deleted history, or recovery targets? Recommendation: sample and classify them through provider-supported detail evidence before setting policy.

## Evidence

- `inventory/r2-objects-summary.json`
- `inventory/grok-saved-current-summary.json`
- `inventory/media-sample-validation.json`
- `inventory/metadata-contract-summary.json`
- `inventory/prompt-sidecar-summary.json`
- `reconciliations/duplicate-classification-summary.json`
- `reconciliations/r2-integrity-summary.json`
- `reconciliations/canonical-index-summary.json`

Raw object keys, raw provider IDs, raw prompts, request headers, cookies, and detailed duplicate membership remain in ignored local evidence only.
