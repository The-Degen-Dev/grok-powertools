# Local Canonical Index And Gap Report

Generated: 2026-06-28T21:45:25.541Z

This report is redacted. It contains counts and hashes only, not raw prompts, cookies, bearer tokens, signed URLs, API keys, exact Grok post IDs, or exact private object keys.

## Status

- Production writes: no
- Raw local canonical index: `private/local-canonical-index.jsonl` (gitignored)
- Grok Saved inventory: partial
- Canonical index status: partial because current Grok Saved logical identity is not fully proven

## Source Counts

- R2 objects: 18083
- R2 media objects: 15981
- R2 hash rows: 15981
- D1 rows: 4648
- Worker rows: 4647
- Metadata references: 2100
- Grok Saved rows: 821

## Classification Counts

- alternate_duplicate: 2
- canonical: 4419
- date_folder_mapped: 4194
- needs_human_review: 5687
- orphan_candidate: 1679

## Gap Counts

- d1MissingCanonicalMedia: 1441
- grokSavedIdentityLimited: 1
- grokSavedInventoryBlocked: 0
- grokSavedInventoryPartial: 1
- metadataLinkedMedia: 2090
- metadataUnlinkedMedia: 13891
- needsHumanReview: 5687
- orphanCandidates: 1679
- workerMissingCanonicalMedia: 1441

## Duplicate Classification

- Same-hash groups: 5116
- Objects in same-hash groups: 12073
- Accepted linked duplicate objects: 4196
- Hash-only duplicate objects needing review: 2761

## Residual Risks

- Current Grok Saved logical completeness is not proven until every Saved item has an authoritative logical identity, preferably grokPostId from /imagine/post/{uuid}.
- D1 asset_id is preserved as evidence but is not treated as primary Grok identity.
- Same SHA-256 without an accepted identity-link signal remains needs_human_review.
- This is a local-only canonical index proposal and does not authorize production writes, object moves, deletes, or repair actions.
