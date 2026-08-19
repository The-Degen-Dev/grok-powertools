# grok-gallery-001 audit refresh

Snapshot date: 2026-08-19

Status: production Worker, one-item R2 transport, and corrected authoritative metadata capture are production-verified. R2 media bytes and Worker coverage are healthy. The first invalid immutable sidecar remains as failed evidence alongside one valid replacement.

## Proof boundary

- Two complete pre-canary R2 listings, 137 seconds apart, matched at 18,735 objects and fingerprint `de6f0bc56e79cd5a4a8648f12b77985df291524a27dbadb69c1dfa0291048901`.
- Two complete post-canary R2 listings, 19 minutes apart, matched at 18,737 objects and fingerprint `55cfdfa0cb896ed33a9023168c165544f9f82b5e22e4978ba2994683f941cdd3`.
- Two complete post-correction listings, 417 seconds apart, matched at 18,738 objects and fingerprint `ac9aab1368ba4dced4f91102b7e1c6a208019f01fe4f1e0a1d3c01e92417d311`.
- The correction delta is exactly one 2,914-byte immutable metadata-v2 sidecar. Media count and media bytes did not change.
- Every one of the 16,496 media objects has a successful full-byte SHA-256 row.
- A deterministic 23-object sample passed HEAD, first and tail byte ranges, file signature, and real decoder checks.
- Worker pagination completed without truncation and exactly matched R2 media: 16,496 assets across 43 pages, with zero missing rows in either direction.
- The approved one-item canary proves Saved-to-R2 transport for one selected asset. It does not prove that every current Grok Saved item exists in R2.

## Current inventory

| Measure | Result |
| ------- | ------ |
| R2 objects | 18,738 |
| R2 bytes | 45,501,777,314 bytes, 42.377 GiB |
| Media objects | 16,496 |
| Images | 9,886 |
| Videos | 6,610 |
| Canonical media | 6,603 |
| Legacy date-folder media | 9,893 |
| Unique media byte hashes | 9,539 |
| Prompt sidecars | 2,226 |
| Metadata v2 sidecars | 2, one valid and one retained invalid |
| D1 media rows | 5,161, plus one non-media system-test row |
| Worker media rows | 16,496 |

## Worker deployment

- Production Worker version: `b0886d79-a8a0-40a2-b1c8-1f7115de6eb0`, active at 100 percent.
- Bindings were verified for bucket `grok-gallery-001`, D1 `grok-powertools-db`, and prefix `grok-powertools/v1`.
- The Worker now reads media directly from R2, excludes JSON sidecars, and merges metadata across all user namespaces.
- Metadata routes returned 40 saved prompts, 100 prompt-history items, 13,081 processed-ID aliases, one backfill manifest, and zero saved-list items.

## Canary results

The initial approved `One Media R2 Canary` completed once and returned to Saved. It reported one upload, zero pending items, and zero errors. Its new immutable objects were:

1. `media_308621ef-5cfe-4f45-aadd-337917ad2b53.mp4`, 2,754,902 bytes.
2. Its `metadata.v2.442f165a3905c7f603bc9043.json` sidecar, 2,777 bytes.

The processed-ID snapshot was updated for the initial canary item.

After the nested-prompt correction was loaded, one separately approved targeted canary ran for the same asset. It reported zero media uploads, one already-present media object, zero queued or pending transfers, and zero errors. It HEAD-verified the existing video and added only:

1. `media_308621ef-5cfe-4f45-aadd-337917ad2b53.mp4.metadata.v2.4f21df5996661bd4a84ffea5.json`, 2,914 bytes.

The existing media key, 2,754,902-byte size, ETag, upload timestamp, and SHA-256 did not change. Processed-ID membership remained 13,081 aliases, and the latest processed-ID snapshot object was not rewritten by the follow-up. No full sync, generic popup canary, backfill, retry, reset, test upload, deletion, D1 repair, or manual R2 write/delete ran.

The media SHA-256 is `852bb532062093074d41b0de078aa87d103f89b9b34415f5e3948e00c86908d4`. It passed 206 byte-range checks, ISO-BMFF signature validation, and `ffprobe`: H.264 400 by 736 video, 6.041667 seconds, stereo 48 kHz AAC audio, plus an MJPEG attached picture.

## Metadata defect and correction

The first sidecar has the correct schema, asset ID, conversation ID, target link, evidence source, sanitized raw asset metadata, and content-hash suffix. Its captured prompt is empty, so the audit correctly classifies it as invalid.

Grok 2.0 placed the authoritative prompt at `mediaGenInput.imageToVideo.prompt`. The bridge previously checked only top-level `prompt`, `promptText`, and `text` fields.

The local correction now:

- searches bounded nested Grok response objects for exact prompt fields;
- accepts only one unique non-empty prompt and fails closed on ambiguity;
- rejects empty prompt metadata before any R2 request.

Focused tests first failed at both boundaries. After correction, 902 extension unit tests, 48 extension Playwright tests, root lint, extension packaging, and `git diff --check` pass.

The corrected production sidecar has schema version 2, the exact media parent and asset ID, an authoritative conversation response, sanitized raw asset metadata, and a non-empty 137-character prompt. Its full SHA-256 is `4f21df5996661bd4a84ffea5c60d5d33a73b08b0dce427fc9742d11639b5e5b1`, which matches the immutable key suffix. The metadata analyzer reports zero issues for the replacement. The first invalid sidecar remains unchanged as failed evidence.

## Integrity and index gaps

- 16,496 of 16,496 media hashes pass.
- Zero zero-byte media, HEAD failures, stored SHA-256 mismatches, or stored media-type mismatches.
- All 23 range, signature, and decoder samples pass, including the canary video.
- 11,335 R2 media objects have no D1 row. This includes 1,442 canonical media objects.
- The Worker no longer inherits that D1 coverage gap because its media inventory is R2-authoritative.
- 14,269 media objects have no metadata reference of any supported kind.
- All 2,226 legacy prompt sidecars parse and link to an existing media object. Only 350 include an asset ID.
- Of 2,074 prompts comparable to canonical evidence, 2,037 match and 37 remain historical review items.
- Current local-mirror coverage and full current Grok Saved completeness remain `not_run`.

## Duplicate findings

There are 5,116 exact-byte duplicate groups, 6,957 excess copies, and 21,227,556,071 excess bytes, 19.770 GiB. Neither canary changed those totals.

| Class | Groups | Excess bytes | Default decision |
| ----- | ------ | ------------ | ---------------- |
| Legacy repeated bytes | 2,926 | 15,088,525,479 | Cleanup candidate after reference and survivor proof |
| Legacy plus canonical alias | 676 | 2,368,513,146 | Retain canonical; retire legacy only after references resolve |
| Canonical IDs with same bytes | 1,514 | 3,770,517,446 | Preserve by default because distinct asset IDs can be legitimate outputs |

Two logical identities have multiple payload hashes. Preserve all variants until their source and conflict history is resolved.

## Current verdict

- Worker read path: production-verified.
- R2 media integrity: verified for the current stable snapshot.
- One-item Saved-to-R2 transport: production-verified.
- Corrected authoritative prompt capture: production-verified for the exact canary asset.
- Entire current Grok Saved gallery in R2: inconclusive.
- Bucket clean enough for deletion: no.

No deletion is safe as a bulk operation yet. Cleanup still requires a survivor/reference ledger, dry-run repair evidence, and separate per-batch approval. Full current Grok Saved completeness also remains unproven.
