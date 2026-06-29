# Local Canonical Index And Gap Report

Generated: 2026-06-29T00:10:02.882Z

This report is redacted. It contains counts and hashes only, not raw prompts, cookies, bearer tokens, signed URLs, API keys, exact Grok post IDs, or exact private object keys.

## Status

- Production writes: no
- Raw local canonical index: `private/local-canonical-index.jsonl` (gitignored)
- Grok Saved inventory: api_captured_post_identity_with_post_gaps
- Canonical index status: complete for captured sources, with reported response gaps where present

## Source Counts

- R2 objects: 18083
- R2 media objects: 15981
- R2 hash rows: 15981
- D1 rows: 4648
- Worker rows: 4647
- Metadata references: 2100
- Grok Saved rows: 12446
- Grok Saved grid rows: 821
- Grok asset API rows: 12446
- Grok conversation response rows: 7985
- Grok media post rows: 12446

## Classification Counts

- alternate_duplicate: 2
- canonical: 4419
- date_folder_mapped: 5541
- needs_human_review: 5553
- orphan_candidate: 466

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

## Duplicate Classification

- Same-hash groups: 5116
- Objects in same-hash groups: 12073
- Accepted linked duplicate objects: 4330
- Hash-only duplicate objects needing review: 2627

## Residual Risks

- Grok media post IDs were captured through the read-style /rest/media/post/get API; individual /imagine/post/{uuid} routes were not opened per item.
- 214 Grok media-post rows remain response gaps after retry and are reported as metadata/post-identity gaps rather than inferred missing media.
- D1 asset_id is preserved as evidence but is not treated as primary Grok identity.
- Same SHA-256 without an accepted identity-link signal remains needs_human_review.
- This is a local-only canonical index proposal and does not authorize production writes, object moves, deletes, or repair actions.
