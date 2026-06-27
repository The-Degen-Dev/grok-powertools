# Production R2 Vault Audit Design

Date: 2026-06-26

Repo: `/Users/philipbankier/Development/skunkworks/Grok-Tinker/chrome-extension-powertools`

Status: hardened design spec for user review.

Do not move to execution planning until this file is reviewed and approved.

## Goal

Run a full read-only production audit of the Grok Power Tools backup system, with production R2 correctness as the center of gravity.

The audit must answer whether production R2 has all expected media and metadata, whether those records are correct, and whether duplicate media or stale metadata exist. It must not rely on old reports, product preview counts, or a single API surface as proof. Prior work is useful context, but every material claim in this audit needs fresh evidence from current production, current local files, current repo code, or the current live Grok tab.

The audit output is a durable evidence folder plus a final report that can drive a later repair plan without ambiguity.

## Current Context

The repo has three active surfaces:

- Chrome extension at the repo root.
- Next.js web app under `web/`.
- Cloudflare Worker under `cloud/`.

The current production cloud target in `cloud/wrangler.toml` is:

- R2 bucket: `grok-gallery-001`.
- D1 database: `grok-powertools-db`.
- Key prefix: `grok-powertools/v1`.
- Worker name: `grok-r2-backup-worker`.

Prior artifacts exist and must be read before execution, but they are not final proof:

- `docs/audits/2026-05-20-grok-powertools-full-system-audit/`
- `docs/audits/2026-05-21-r2-dedupe-reliability-implementation/`
- `docs/superpowers/specs/2026-05-21-full-system-reliability-rebuild-spec.md`
- `docs/superpowers/specs/2026-06-18-r2-backed-vault-webapp-design.md`
- `docs/superpowers/specs/2026-06-20-vault-repair-workbench-design.md`
- `docs/superpowers/specs/2026-06-09-live-acceptance-e2e-design.md`

The current app already has Worker Vault routes, Next Vault broker routes, local IndexedDB Vault storage, Ops proof UI, and a Repair Workbench slice. These surfaces should be used as validation aids, but not as the only data source.

## Prior Decisions Carried Forward

These decisions are already approved and remain active constraints:

- Production R2 reads are allowed.
- Read-only streaming or downloading production R2 media solely to compute SHA-256 is allowed, with bytes discarded after hashing and no local media corpus created.
- Production R2 writes require a separate approved plan.
- Production D1 writes require a separate approved plan.
- Existing production media is preserve-only during this audit.
- No deletes, rewrites, moves, canonicalization, backfill, retry-unsynced, processed-ID reset, full media backup, or repair run may happen in this audit.
- R2 is the primary backup source for the Vault library.
- Live Grok Saved is not the primary backup truth. It is used after R2/local inventory to confirm samples and investigate gaps.
- Worker health is not object proof.
- Product Vault preview is not duplicate proof because preview can normalize and dedupe.
- Acceptance resources are for write-capable tests only. Production audit evidence must be read-only.
- Secrets, cookies, bearer tokens, signed URLs, raw API keys, and raw private prompt dumps must not be written into tracked artifacts.
- The final report must split two verdicts: production R2 internal correctness, and current Grok Saved completeness. The first can be proven from R2/D1/metadata/local evidence; the second is only proven if a stable current Grok Saved export/API is found.
- The only local media root in scope is `/Users/philipbankier/Content/Grok IMagine/greymaker`, including `GrokVault` and parent-folder media candidates under that root.

## Archaeology Result

This audit should not restart earlier work from scratch, but it also must not assume earlier work is correct.

Use prior work this way:

- Reuse the known resource names, source-of-truth order, safety gates, and data model concepts.
- Reuse existing read-only routes when they provide evidence: `/v1/vault/identity`, `/v1/vault/inventory`, `/v1/vault/metadata/:kind`, `/v1/vault/media`, `HEAD /v1/objects/verify`, and the matching Next routes.
- Reuse the prior local Vault inventory script pattern and improve it as needed for the new audit folder.
- Reuse the Repair Workbench issue and plan vocabulary for classifying findings.

Do not use prior work this way:

- Do not treat the May local Vault count as current.
- Do not treat the May R2 blocker as current.
- Do not treat a successful upload-test object as proof of complete media backup.
- Do not treat `/api/vault/preview` as a full raw R2 inventory.
- Do not merge or switch to the stale `codex/r2-dedupe-reliability` branch. Its unique patches are not needed, and switching to it would drop later Vault, repair, recreate, and acceptance work.

## Non Goals

- Do not fix production data.
- Do not add new product features.
- Do not run full media backup.
- Do not run one-media R2 canary against production.
- Do not run backfill or retry-unsynced.
- Do not run repair workbench `Run` actions.
- Do not delete, move, rewrite, copy, or canonicalize R2 objects.
- Do not update D1 source-fact rows.
- Do not reset or modify extension processed IDs.
- Do not generate new Grok media unless a later approved plan adds a canary phase.
- Do not scrape the entire live Grok Saved UI before R2 and local inventory are understood.
- Do not call write-capable Worker endpoints against production, including `POST /v1/objects/verify`, `POST /v1/metadata/snapshot`, `POST /v1/presign`, sync push routes, or any repair run route.
- Do not call Next Vault routes that represent approval, run, reconciliation, or gap-fill execution actions unless a later approved plan explicitly scopes a dry-run validation. This audit may use read-only GET routes plus dry-run scan/plan/proof routes after code inspection confirms no production writes.

## Source Hierarchy

For backup correctness, use this evidence order:

1. Raw production R2 object inventory under the exact production prefix.
2. Raw production D1/index rows for backup source facts.
3. Production R2 metadata objects and media sidecars.
4. Worker Vault normalized inventory and media proof routes.
5. Local filesystem inventory and hashes.
6. Extension storage, cloud queue, and popup/overlay status where accessible.
7. Local web app committed Vault state and Ops proof.
8. Live Grok Saved/Vault samples from the existing Chrome tab.

Conflicts must be reported. Do not silently prefer a cleaner source if raw R2, D1, Worker, local, or Grok evidence disagree.

## Audit Strategy

The audit runs in layers. Each layer records raw evidence before moving to the next layer.

## Phase 1: Preflight And Authority Proof

Verify:

- Current git branch, commit, and dirty state.
- Current docs and code state for R2, Vault, Worker, web, and extension.
- Tool availability: ambient `node`, `npm`, `npx`, `mise exec node@24 -- ...`, `wrangler`, `gh`, `peekaboo`, `agent-browser`, `plwr`, and browser automation fallback.
- Cloudflare command runtime. Current Wrangler requires Node 22 or newer, so Cloudflare/Wrangler commands should run under `mise exec node@24 -- ...` unless the shell runtime is already proven compatible.
- Cloudflare account identity and whether it matches `cloud/wrangler.toml`.
- R2 bucket identity for `grok-gallery-001`.
- D1 database identity for `grok-powertools-db`.
- Worker URL identity and redacted API-key fingerprint where available.
- Exact key prefix, with no fallback to `grok-powertools/v1` unless it is proven from config or identity.
- Local media root: `/Users/philipbankier/Content/Grok IMagine/greymaker/GrokVault`.
- Parent media root: `/Users/philipbankier/Content/Grok IMagine/greymaker`.
- Existing Chrome Grok tab and extension state can be inspected without broad tab discovery.

If production R2/D1 authority cannot be proven, stop before live Grok actions and record the exact blocker.

## Phase 2: Raw Production R2 Inventory

Build a raw, paginated R2 object inventory to exhaustion.

Acceptable raw object-listing methods are:

- Cloudflare R2 objects API using read-only credentials.
- S3-compatible `ListObjectsV2` against the production bucket using read-only credentials.
- A Worker/R2 binding endpoint only if the code path is proven read-only, non-normalizing, non-deduping, and paginated to exhaustion before use.

Wrangler `r2 bucket list` and `r2 bucket info` can prove bucket identity, but Wrangler `r2 object` must not be assumed to provide raw object listing unless current help output proves it. Current `wrangler@latest` exposes `r2 object get`, `put`, and `delete`; it does not expose an object list command.

Record for every object when available:

- object key
- size
- ETag
- uploaded timestamp
- HTTP metadata content type
- custom metadata
- key prefix classification
- user ID path segment
- media path class: canonical `media/by-asset`, conflict, legacy date folder, metadata, sidecar, system, repair, unknown
- asset ID inferred from key
- media type inferred from content type and extension
- whether the key is outside expected shape

Pagination proof must include:

- page size
- cursor chain, continuation token chain, or exact listing method
- total pages
- final cursor or truncation state
- timestamp
- command or API path used

The raw R2 inventory must not dedupe records during capture. Deduping is a later analysis step.

For every production R2 media object, compute actual content SHA-256 by read-only streaming or downloading the object, then discard the bytes. Record:

- object key
- bytes read
- computed SHA-256
- hash command or API path
- hash timestamp
- read status
- error text if hashing failed

Stop and ask if the object count, byte count, API rate, auth scope, or local disk behavior is unexpectedly large or unsafe. If any media object cannot be hashed, the report cannot claim byte-level duplicate proof for all R2 media.

## Phase 3: Raw Production D1 And Index Inventory

Export read-only rows needed to validate source facts:

- `r2_dedupe_index`
- `metadata_snapshot_index`
- `vault_overlays`, only to confirm overlay boundaries where relevant
- any sync/source tables that reference Vault media or metadata

Record:

- row counts
- schema shape
- primary and unique indexes
- asset IDs
- canonical object keys
- duplicate object keys
- source URL hashes
- content SHA-256 values
- media types
- upload statuses
- first and last seen timestamps
- metadata snapshot object keys and hashes

If D1 access is unavailable, record the command, account, database ID/name, exit code, and exact error. Do not infer D1 state from Worker inventory alone.

## Phase 4: Metadata And Sidecar Inventory

Inventory production metadata objects separately from media objects.

Raw metadata inventory must list all matching R2 keys under `${KEY_PREFIX}/users/*/metadata/*` and all prompt sidecar locations discovered under media paths. Worker `/v1/vault/metadata/:kind` is a cross-check only, because the current Worker code reads the `users/greymaker/metadata/` path directly.

Required metadata kinds:

- `saved-prompts.latest.json`
- `prompt-history.latest.json`
- `processed-ids.latest.json`
- `saved-list.latest.json`
- `backfill-manifest.latest.json`
- versioned backfill manifests
- prompt sidecars attached to media where present
- upload-test or system objects, classified separately from real media

For each metadata object, record:

- object key
- size
- hash if available or computed through safe read
- schema version
- record count
- referenced asset IDs
- referenced object keys
- referenced prompt IDs
- parse status
- redaction status

Raw prompt text should be redacted or hashed in durable audit files unless a narrow UI inspection requires showing it locally.

## Phase 5: Worker And Product Route Cross-Check

Use current read-only Worker and Next routes as a second source:

- `/v1/vault/identity`
- `/v1/vault/inventory?cursor=...&limit=...`
- `/v1/vault/metadata/:kind`
- `/v1/vault/gaps`
- `/v1/vault/media?assetId=...`
- `HEAD /v1/objects/verify?objectKey=...`
- `/api/vault/identity`
- `/api/vault/inventory`
- `/api/vault/preview`
- `/api/vault/media/:assetId`
- `/api/vault/repair/proof`
- `POST /api/vault/repair/scan`, dry-run classification only
- `POST /api/vault/repair/plan`, dry-run plan construction only
- `POST /api/vault/gap-fill/plan`, dry-run live-Grok plan construction only

Do not use `POST /v1/objects/verify` for production audit evidence. It can update D1 index rows. Use only `HEAD /v1/objects/verify` for object HEAD proof.

Do not use `/api/vault/repair/approve`, `/api/vault/repair/run`, `/api/vault/gap-fill/run`, or `/api/vault/reconcile/index` in this audit. Current code makes some of these inert or fail-closed, but the audit does not need approval/run semantics.

The cross-check must answer:

- Does Worker identity match production?
- Does Worker inventory page to exhaustion?
- Does Worker inventory come from D1 rows or R2 fallback?
- Are Worker counts consistent with raw R2 and raw D1?
- Which objects disappear from normalized inventory because of dedupe, parse failures, or source priority?
- Can media access be proven for at least one object beyond the first page?
- Does `/api/vault/preview` truncate at its configured page cap?
- Does the Repair Workbench scan classify gaps without writes?

Product route evidence is useful, but if it conflicts with raw R2/D1, raw evidence wins.

## Phase 6: Local Filesystem Inventory

Build a fresh local inventory for both:

- `GrokVault`
- parent `greymaker` media files outside `GrokVault`

The parent inventory is scoped to media candidates under `/Users/philipbankier/Content/Grok IMagine/greymaker`. It must exclude dependency, repo, build, cache, and archive internals unless a file is directly named or referenced like a Grok/R2 media artifact. At minimum, exclude `.git`, `node_modules`, `.next`, `dist`, `build`, `.wrangler`, cache folders, package-manager stores, and extracted app source trees unless an object-key, UUID, sidecar, or metadata reference pulls a file back into scope.

Record:

- absolute path
- relative path
- size
- extension
- media type
- SHA-256
- created and modified timestamps
- duplicate filename groups
- duplicate hash groups
- zero-byte files
- corrupt-looking media files when detectable through file signature or media probe
- filename UUIDs and likely Grok post/media IDs

The parent folder matters because prior evidence showed native Grok downloads can land outside `GrokVault`.

## Phase 7: Reconciliation

Build explicit reconciliation joins. No visual or filename-only guessing.

Allowed match keys:

- exact R2 object key
- asset ID
- content SHA-256
- source URL hash
- Grok post ID
- media UUID
- prompt sidecar reference
- metadata object reference
- local filename UUID, only as a weak candidate until confirmed by another key
- size plus media type, only as an unresolved candidate, never as proof by itself

Produce deltas:

- R2 object present, D1 row missing.
- D1 row present, R2 object missing.
- canonical object present with conflicting D1 status.
- legacy date-folder object not represented as a legacy key.
- conflict object without canonical context.
- duplicate content hash across multiple R2 objects.
- duplicate asset ID across multiple canonical candidates.
- metadata references missing media.
- media missing metadata or prompt sidecar.
- local file missing in R2.
- R2 media missing locally.
- parent-folder file likely backed up but outside `GrokVault`.
- unknown media type.
- zero-byte or suspiciously small media object.
- malformed key path.
- out-of-prefix object.
- unresolved candidate requiring user decision.

Classify duplicate groups:

- allowed canonical plus legacy pointer record, no duplicate blob.
- allowed conflict object with different evidence.
- likely accidental duplicate blob.
- same hash under multiple keys.
- same asset ID with different hashes.
- same source URL hash with different object keys.
- metadata duplicate or unchanged snapshot churn.

Do not mark R2 as clean unless every duplicate group is either absent or explicitly classified as allowed.

## Phase 8: Local System Run

After raw production and local inventories are captured, run local system checks:

- root unit tests
- root extension E2E
- root lint
- web build
- web lint
- cloud typecheck
- cloud tests that are local or explicitly read-only against production
- local web app route smoke
- local Worker health or deployed Worker health as separate statuses
- Vault page preview and commit into local IndexedDB, if Worker env is available
- Ops proof screen
- media playback or image display through the media proxy
- Repair Workbench scan and plan creation, no approve or run

If environment variables are missing, record exact missing names. Do not copy secrets out of Chrome extension storage without explicit approval.

## Phase 9: Live Grok And Extension Inspection

Use the existing Chrome tab at `grok.com/imagine/saved` or the visible Grok Vault/Saved surface.

Before live inspection:

- Confirm raw R2 and local inventories are complete, or record the blocker and ask before continuing.
- Confirm automation can target the visible Chrome tab without broad tab sweeps.
- Confirm no backup, sync, repair, or generation action will be clicked.

Inspect:

- Grok route and visible Saved/Vault state.
- Extension overlay injection.
- Extension popup/cloud status if reachable.
- Backup mode, worker host, key prefix, unsynced count, last test status, and last error, with API key redacted.
- Sample set from reconciliation findings: newest R2 media, oldest R2 media, first-page media, beyond-first-page media, image sample, video sample, duplicate candidate, missing metadata candidate, local-only candidate, and R2-only candidate.

Live Grok is a spot-check and drift source, not the whole Saved authority unless a stable export/API is found during the audit.

## Evidence Folder

Create:

```text
docs/audits/2026-06-26-production-r2-vault-system-audit/
  manifest.json
  report.md
  inventory/
    r2-objects.jsonl
    r2-media-hashes.jsonl
    r2-objects-summary.json
    r2-pages.json
    d1-r2-dedupe-index.jsonl
    d1-metadata-snapshot-index.jsonl
    d1-schema.json
    worker-vault-assets.jsonl
    worker-vault-pages.json
    metadata-objects.json
    metadata-references.json
    local-vault-files.csv
    local-parent-media-files.csv
    local-media-summary.json
  reconciliations/
    r2-d1-delta.json
    r2-metadata-delta.json
    r2-local-delta.json
    worker-raw-delta.json
    duplicate-groups.json
    malformed-keys.json
    unresolved-items.json
    sample-set.json
  logs/
  screenshots/
  browser-samples/
```

Artifacts must be parseable where practical. Prefer JSONL for large inventories and JSON summaries for counts.

## Report Requirements

The final `report.md` must include:

- executive verdicts: production R2 internal correctness, current Grok Saved completeness, and local system health. Each verdict is clean, dirty, blocked, or inconclusive.
- production R2 identity proof
- production D1 identity proof
- total raw R2 object count
- total normalized Worker asset count
- total D1 index row count
- total metadata object count
- total local media count
- image/video/unknown counts for each source
- duplicate findings
- byte-level R2 hash coverage and any unhashable objects
- missing media findings
- missing metadata findings
- malformed key findings
- local-only and R2-only findings
- Worker/product route mismatches
- live Grok sample findings
- extension status findings
- blockers and exact next decision needed
- recommended next actions grouped as P0 data correctness, P1 backup pipeline reliability, and P2 product visibility and operator UX

The report must not say production R2 is internally clean unless:

- raw R2 listing is complete
- raw D1/index export is complete or D1 absence is proven irrelevant
- metadata inventory is complete
- local inventory is complete
- R2 media byte hashing is complete, or every unhashable object is explained and removed from byte-level duplicate claims
- duplicates are zero or explicitly allowed
- no unresolved media or metadata correctness gaps remain
- media access is proven for samples beyond the first page
- no source conflicts remain unexplained

The report must not say every current Grok Saved item is backed up unless the audit finds a stable current Grok Saved export/API or another authoritative Saved enumeration. Live visual samples alone can support a sample verdict, not a full Saved completeness verdict.

## Validation Gates

Before production inventory:

- prove account, bucket, prefix, and database identity
- prove the raw R2 listing method and object hashing method are read-only
- confirm all planned production operations are read-only
- confirm evidence redaction rules

Before local app run:

- raw production R2 inventory complete or exact blocker recorded
- local filesystem inventory complete or exact blocker recorded

Before live Grok inspection:

- raw R2, D1, metadata, and local inventory complete, or user approves continuing with blockers
- browser automation target is known
- no write-capable control is required

Before final verdict:

- all JSON/JSONL/CSV artifacts parse
- all counts cite source artifacts
- all unmatched records appear in a delta or unresolved file
- all blocked items include exact command/API path, error text, and requested user decision

## Stop Criteria

Stop and ask before continuing if:

- production account identity is ambiguous
- bucket or prefix does not match expected production
- D1 identity is ambiguous
- R2 listing returns zero objects for a known populated target
- R2 listing is unexpectedly huge or points outside the prefix
- a needed route requires printing or copying a secret
- an action would mutate production R2 or D1
- a route might trigger backfill, retry, repair run, full backup, or upload
- browser automation cannot prove which Grok tab it controls
- live Grok shows account, payment, moderation, or permission state that changes the audit risk

## Success Criteria

The audit is complete when:

- every major subsystem has a current status: verified, dirty, blocked, failed, or unproven
- production R2 raw inventory is captured or the exact blocker is recorded
- production D1/index inventory is captured or the exact blocker is recorded
- production metadata inventory is captured or the exact blocker is recorded
- local Vault and parent media inventories are captured
- production R2 media byte hashes are captured or exact unhashable blockers are recorded
- Worker and web Vault routes are cross-checked against raw evidence
- duplicate groups are classified
- R2/local/metadata/D1 deltas are written
- live Grok and extension samples are inspected without writes
- local tests and app smoke results are recorded
- final report gives prioritized next work without requiring the next agent to guess

## Open Questions

No open question blocks writing the execution plan.

Approved clarifications:

- Read-only production R2 media byte hashing is allowed with a stop gate for unexpectedly large, unsafe, or rate-limited reads.
- The report must split production R2 internal correctness from current Grok Saved completeness.
- No local media roots outside `/Users/philipbankier/Content/Grok IMagine/greymaker` are in scope.

The execution plan should still verify how to authenticate read-only production R2/D1 access in the current shell before any live browser action. If that cannot be proven, it must stop and ask.
