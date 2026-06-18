# R2 Backed Vault Web App Design

Status: design spec for user review.

Date: 2026-06-18

Repo: `/Users/philipbankier/Development/skunkworks/Grok-Tinker/chrome-extension-powertools`

Do not move to the build plan until this file is reviewed and approved.

## Goal

Make the local web app usable as the real Grok saved gallery workspace, backed by the existing Cloudflare R2 backup data and metadata.

The first useful screen should not be an empty local collection with demo media. It should help the operator load the backed-up saved gallery, prove what source it came from, browse images and videos, use prompts, create collections, watch media, make movies, and see clear Ops proof for what is verified, blocked, failed, or unproven.

This is not a one-time import script. The web app should become the durable local owner and agent workspace for the backed-up Grok saved gallery.

## Current Context

The repo has three product surfaces:

- Chrome extension at the repo root.
- Next.js web app under `web/`.
- Cloudflare Worker under `cloud/`.

The current web app already has collections, clip editing, Movie Maker, prompts, sharing, settings, Auth.js, D1 sync routes, and an Ops page. Those surfaces should be extended, not replaced.

The current cloud Worker already has:

- `/health`
- `/v1/presign`
- `/v1/objects/verify`
- `HEAD /v1/objects/verify?objectKey=...`
- `/v1/metadata/snapshot`
- `/v1/diagnostics`
- `/v1/sync/push`
- `/v1/sync/pull`

The current D1 schema already has collections, movies, settings, `r2_dedupe_index`, and `metadata_snapshot_index`.

The current web IndexedDB database is `grok-power-tools` version 3 with collections, movies, prompts, settings, and sync metadata. Vault data needs a versioned migration, not a replacement database.

The old `feat/web-redesign` branch is older and divergent. It can be used for product lessons only. It must not be merged into `main` as part of this work.

## Prior Decisions Carried Forward

These decisions are already approved and should be treated as spec constraints:

- R2 is the primary source for the loaded web library.
- Live Grok Saved is a gated repair lane only, used to fill gaps after R2 import proof exists.
- The app starts read-only until the import preview is proven.
- Production R2 reads are allowed through server-side routes.
- Production R2 writes, D1 pushes, backfill, retry, processed-ID resets, and live Grok repair runs require explicit operator action.
- R2 source facts are immutable in the web app.
- Collections, notes, tags, movies, watch queues, and agent annotations are overlays.
- Local owner mode must work without Google sign-in.
- Production D1 sync still requires Google auth.
- Playback uses short-lived Worker-signed URLs or a proxy. The bucket is not made public.
- Prompts and prompt history are first-class data.
- Gap-fill is included in the product, but it is plan-first and gated.

## Non Goals

- Do not delete, rename, move, or rewrite existing R2 objects.
- Do not create or delete R2 buckets.
- Do not reset extension processed IDs.
- Do not run extension backfill or retry flows.
- Do not start a production full backup.
- Do not copy secrets from the extension popup into source files.
- Do not print Worker API keys, cookies, bearer tokens, signed URLs, or raw prompt dumps in logs or committed files.
- Do not pretend the browser can read arbitrary local `GrokVault` files. Local file access needs user selection or a native companion.
- Do not merge the old `feat/web-redesign` branch.
- Do not make examples or demo media the main empty-state path when real R2 config exists.

## Source Of Truth

The source order is:

1. R2 object inventory and D1 metadata indexes.
2. R2 metadata snapshots, including saved prompts, prompt history, processed IDs, and backfill manifests.
3. Local IndexedDB overlays created by the web app.
4. Live Grok Saved only for approved repair actions.

Worker health alone is not proof. A healthy Worker means the Worker route is reachable. It does not prove that any saved gallery object exists in R2.

## Cloud Shape

The production target stays the existing Greymaker Worker and R2 setup. The web app should not hardcode that target. It should read server-side environment variables and show a redacted target identity:

- Worker URL host.
- Worker service name when returned by `/health`.
- R2 bucket name when returned by a redacted identity or diagnostics endpoint.
- D1 database name or ID when returned by a redacted identity endpoint.
- Key prefix.
- API key fingerprint only, never the key.

The web app needs these server-side env names:

```txt
WORKER_URL
WORKER_API_KEY or CLIENT_API_KEY
WORKER_SYNC_SECRET
```

If the Worker API key is not configured for the web app, Vault preview is blocked with a specific message. The app must not silently fall back to demo data, extension storage scraping, or unauthenticated cloud reads.

## Worker Read APIs

Add read-only Worker APIs for Vault loading. These routes require the Worker API key and must redact secrets:

```txt
GET /v1/vault/identity
GET /v1/vault/inventory?cursor=...&limit=...
GET /v1/vault/metadata/:kind
GET /v1/vault/media-token?assetId=...
GET /v1/vault/gaps?cursor=...&limit=...
```

`/v1/vault/identity` returns target proof only. It must not return secrets or signed URLs.

`/v1/vault/inventory` returns paginated normalized media records. It should use D1 indexes first and R2 list fallback when needed so legacy date-folder objects are discoverable.

`/v1/vault/metadata/:kind` returns normalized latest metadata snapshots for safe kinds:

- `savedPrompts`
- `promptHistory`
- `processedIds`
- `backfillManifest`
- `savedList`

`/v1/vault/media-token` returns a short-lived playback token or signed Worker URL for one asset. It must validate the asset belongs under the configured key prefix.

`/v1/vault/gaps` returns server-known gaps without changing cloud state.

All GET routes must be read-only. No GET route may write to R2, D1, metadata snapshots, or processed-ID state.

Object verification that updates `r2_dedupe_index` is a separate gated repair or reconciliation action. It must not run as part of read-only Vault preview. If the build adds an index-refresh route, it should be a `POST` route with an explicit count and target, not a side effect of inventory reads.

## Next.js Server Routes

Add web server routes that broker browser requests to the Worker. The browser never receives R2 credentials or Worker API keys:

```txt
GET /api/vault/identity
GET /api/vault/inventory
GET /api/vault/metadata/:kind
GET /api/vault/media/:assetId
GET /api/vault/preview
GET /api/vault/gaps
POST /api/vault/gap-fill/plan
POST /api/vault/gap-fill/run
POST /api/vault/reconcile/index
```

`/api/vault/preview` returns a normalized preview package with counts, sample rows, source identity, gap summary, and import warnings.

The "Commit Vault" action is a client-side IndexedDB write of the preview package. It is not a cloud write. A server commit route is not required for the first build unless it only records local, non-secret telemetry.

`/api/vault/media/:assetId` proxies or redirects to a short-lived Worker URL. It must avoid writing signed URLs into local storage.

`/api/vault/reconcile/index` is gated. It can call Worker object verification that updates D1 index rows only after the operator approves the count and target. It is not part of initial read-only Vault load.

## Data Model

Add schema-first TypeScript types and validation for Vault data. Zod or an equivalent schema should be the single source of truth for parsing Worker responses before data reaches IndexedDB.

```ts
type VaultMediaType = "image" | "video" | "unknown";
type VaultSourceStatus = "verified" | "blocked" | "failed" | "unproven";

interface VaultAsset {
  assetId: string;
  mediaType: VaultMediaType;
  canonicalObjectKey?: string;
  legacyObjectKeys: string[];
  contentType?: string;
  sizeBytes?: number;
  etag?: string;
  sha256?: string;
  sourceUrlHash?: string;
  sourceUrl?: string;
  grokPostId?: string;
  mediaUuid?: string;
  promptId?: string;
  promptText?: string;
  width?: number;
  height?: number;
  durationSeconds?: number;
  firstSeenAt?: string;
  lastSeenAt?: string;
  verificationStatus: VaultSourceStatus;
  gapCodes: string[];
  createdAt: string;
  updatedAt: string;
}

interface VaultOverlay {
  assetId: string;
  title?: string;
  notes?: string;
  tags: string[];
  rating?: number;
  hidden: boolean;
  favorite: boolean;
  updatedAt: string;
  syncVersion?: number;
}

interface VaultImportRun {
  id: string;
  source: "production-r2" | "acceptance-r2" | "fixture";
  workerHost: string;
  keyPrefix: string;
  importedAt: string;
  status: "previewed" | "committed" | "blocked" | "failed";
  counts: {
    assets: number;
    images: number;
    videos: number;
    prompts: number;
    verified: number;
    blocked: number;
    failed: number;
    unproven: number;
  };
  warnings: string[];
}

interface VaultGap {
  id: string;
  assetId?: string;
  code: string;
  severity: "info" | "warning" | "blocking";
  evidence: string;
  recommendedAction: string;
  requiresLiveGrok: boolean;
  requiresCloudWrite: boolean;
}
```

The existing `VideoItem` model should become a view model, not the source model. A `VaultAsset` can be projected into collection and movie views when needed.

Images and videos must both be visible in the Vault. Video-only actions must filter videos and explain skipped images. Movie Maker should accept both:

- Videos as video clips.
- Images as still clips with a default duration.

If current `MovieClip` cannot represent images, add an image clip type instead of hiding image assets from the product.

## IndexedDB Migration

Upgrade `grok-power-tools` from version 3 to the next version and add stores:

```txt
vault_assets
vault_overlays
vault_import_runs
vault_gaps
vault_prompts
vault_media_tokens
```

`vault_media_tokens` must be treated as ephemeral. It should store only expiry metadata if needed, not long-lived signed URLs.

Existing stores must remain:

- collections
- movies
- prompts
- settings
- sync_meta

The migration must preserve existing local collections and movies. It must not wipe a user's existing local work.

## Product Flow

Local startup should follow this flow:

1. Load local settings and IndexedDB.
2. Check Auth.js session, but do not block local owner mode if unsigned.
3. Check `/api/vault/identity`.
4. If Worker config is valid, show `Load Vault`.
5. If Vault data is already committed locally, show the Vault as the primary screen.
6. If no Vault data is committed, show a preview-first empty state.
7. `Preview Vault` fetches counts, identity, sample assets, prompt counts, and gap summary.
8. `Commit Vault` writes assets, prompts, import run state, and gaps into IndexedDB.
9. Repeat preview or commit is idempotent.
10. Collections, Watch, Clip Editor, Movie Maker, Share, Prompts, and Ops use committed Vault data.

Demo examples can remain for development, but they should be secondary and clearly labeled. They must not appear to be the user's real saved gallery.

## UI Surfaces

The top navigation should keep the existing product areas and add Vault as a primary surface:

- Vault
- Collections
- Clip Editor
- Movie Maker
- Prompts
- Ops
- Settings

The dashboard can remain, but the primary empty state should be a Vault load panel when Worker config exists.

The Vault view should provide:

- Counts for all assets, images, videos, prompts, verified, blocked, failed, and unproven.
- Dense grid and table modes.
- Filters for media type, status, date, prompt presence, favorite, tags, and gap code.
- Search across prompt text, title, notes, asset ID, Grok post ID, and object key.
- Media preview with image and video playback.
- Copy prompt.
- Open source Grok post when known.
- Add to collection.
- Add to movie.
- Favorite, tag, note, hide, and annotate as overlays.
- Bulk selection with safe actions only.

The media viewer should be media-aware:

- Videos play normally.
- Images display as still media.
- Mixed watch queues advance videos on ended events and images on an interval.
- `Watch All` and `Watch Selected` should work from Vault and Collections.
- `Save as Movie` should create video clips and still-image clips.

## Collections And Movies

Collections are curated overlays. They should store references to Vault assets instead of copying R2 media data.

When a collection item comes from Vault, it should keep:

- `assetId`
- media type
- source prompt reference
- overlay notes
- position

Existing collection items that only have direct URLs should still render. They can be marked as legacy local items until the operator links them to Vault assets.

Movie Maker should use Vault-backed media URLs through the media route. It should not store signed URLs in movie records.

## Prompts

Prompts are part of the import, not an afterthought.

The Prompt Library should merge:

- Existing local saved prompts.
- R2 `savedPrompts`.
- R2 `promptHistory`.
- Prompt sidecars attached to media objects when available.

Duplicates should be detected by normalized text hash. The UI should show source counts and avoid creating duplicate prompt rows on repeated imports.

Prompt text can be sensitive. Logs and Ops evidence should use prompt hashes or redacted samples unless the user explicitly opens the prompt UI.

## Ops And Reconciliation

Ops should become the proof surface for the local web app and Vault. It should show:

- Worker identity.
- Worker health.
- Vault import status.
- R2 inventory counts.
- D1 index coverage.
- Metadata snapshot status.
- Latest import run.
- Gap counts by code.
- Reconciliation rows for sample or filtered assets.
- Whether local owner mode is active.
- Whether D1 sync is authenticated.

Use these status labels:

- `verified`: enough evidence exists.
- `blocked`: an external prerequisite is missing.
- `failed`: an attempted action failed.
- `unproven`: no proof has been collected yet.

Do not mark a row `verified` based on Worker health alone.

## Gap Fill

Gap-fill is a repair workflow with two phases.

Phase 1 is planning. The app creates a gap-fill plan from stored Vault gaps and current Worker proof. It can propose:

- Fetch missing prompt from Grok post.
- Fetch missing thumbnail.
- Recheck R2 object head.
- Link a legacy object to a canonical asset ID.
- Refresh metadata snapshot.
- Mark a missing source as permanently unavailable.

Phase 2 is execution. It can run only after explicit operator approval and must show:

- target Chrome session requirement
- target Grok URL or post count
- exact number of assets affected
- whether any cloud write will happen
- whether any local IndexedDB write will happen

Live Grok repair must use the existing logged-in Chrome window only. It must check for an existing relevant tab before opening a new tab. It must not navigate over unrelated tabs.

If Chrome is not logged into Grok, pause for user action.

If the repair needs a production R2 or D1 write, pause for explicit approval.

## Sync Boundary

Local owner mode writes to IndexedDB only.

D1 sync is for overlays and authored user state:

- collections
- movies
- settings
- prompt tags or local prompt edits
- Vault overlays
- agent annotations when added

D1 sync should not push immutable R2 source facts back as if they were authored local data.

If the user signs in with Google, sync can pull and push overlay data through the existing JWT routes. If the user is unsigned, local owner mode remains usable.

Local `/api/auth/session` must not return a 500 in an unsigned local session. Unsigned should be a normal state, not a broken state.

## Safety Rules

Every write-capable control must show its target and count before it runs.

These actions are not available from the first Vault load path:

- full media backup
- backfill
- retry unsynced
- processed-ID reset
- R2 object delete
- R2 object rewrite
- bucket creation
- bucket deletion
- production D1 mutation of source facts

These actions are allowed only after explicit approval:

- local IndexedDB commit of Vault preview
- D1 sync push of overlays
- live Grok gap-fill run
- metadata snapshot refresh
- R2 object verification that writes D1 index rows

Secrets must remain server-side. Staged changes must be scanned before commit if any env or config file is touched.

## Error Handling

Errors should be specific and actionable:

- `WORKER_URL_MISSING`
- `WORKER_API_KEY_MISSING`
- `WORKER_IDENTITY_MISMATCH`
- `R2_LIST_BLOCKED`
- `D1_INDEX_UNAVAILABLE`
- `METADATA_SNAPSHOT_MISSING`
- `MEDIA_TOKEN_FAILED`
- `MEDIA_OBJECT_MISSING`
- `SIGNED_URL_EXPIRED`
- `GROK_AUTH_REQUIRED`
- `LIVE_GROK_REPAIR_NOT_ARMED`
- `LOCAL_DB_MIGRATION_FAILED`

The app should never hide a blocked real-data path behind demo data. Demo data is optional and labeled.

## Validation

Local gates:

```bash
npm run test:unit
npm run test:e2e
npm run lint
cd web && npm run build
cd web && npm run lint
cd cloud && npm run typecheck
```

If the repo's script layout changes, follow AGENTS.md and package scripts.

Worker tests should cover:

- inventory pagination
- API-key auth
- secret redaction
- legacy date-folder key parsing
- canonical `media/by-asset` parsing
- read-only GET routes
- media-token validation
- metadata snapshot parsing
- blocked R2 list behavior

Web tests should cover:

- unsigned local owner mode does not 500
- empty local app shows Vault load when Worker config exists
- preview shows identity, counts, sample rows, prompts, and gap summary
- commit writes IndexedDB without cloud writes
- repeated commit is idempotent
- images and videos render in Vault
- video playback works through the media route
- image preview works through the media route
- prompts load and dedupe
- create collection from Vault assets
- create movie from mixed image/video assets
- Watch All and Watch Selected work from Vault and Collections
- Ops never treats Worker health as object proof
- missing Worker API key blocks clearly

Manual browser validation should use the local app against real configured R2 data and verify:

- Vault loads the real saved gallery inventory.
- API key remains server-side.
- No signed URLs persist in IndexedDB.
- Counts remain stable across repeated preview and commit.
- Collections, prompts, watch, media viewer, Movie Maker, and Ops feel usable.
- No production write happens during read-only load.

Live Grok gap-fill validation is separate. It should not run until read-only Vault loading is proven.

## Pause Criteria

Pause for user input if:

- `WORKER_API_KEY` or `CLIENT_API_KEY` is not available to the web server.
- Worker identity does not match the intended target.
- The app would need to copy a secret out of Chrome extension storage.
- R2 inventory count is unexpectedly zero against a known populated target.
- R2 inventory count is unexpectedly huge or points outside `grok-powertools/v1`.
- Chrome is not logged into Grok for a requested live repair.
- A requested action would mutate production R2 or D1.
- The browser would need local file-system access beyond normal user file selection.

## Open Questions

The current `web/.env.local` key names show `WORKER_URL` and `WORKER_SYNC_SECRET`, but not a visible `WORKER_API_KEY` or `CLIENT_API_KEY` key name. The recommended path is to add a server-only Worker API key to local env before live Vault preview. Do not copy it from the extension popup without approval.

Still images should be fully visible and usable. The build plan must confirm whether existing Movie Maker internals can add an image clip type cleanly. If not, the plan should add that type rather than hiding images.

## Acceptance Criteria

The work is done only when:

- The local web app starts cleanly.
- Local owner mode works unsigned.
- Vault preview reads real R2-backed inventory through server routes.
- Vault commit writes local IndexedDB and is repeatable.
- Images and videos from the saved gallery are visible.
- Media playback and image preview work without public bucket access.
- Prompts and prompt history load and dedupe.
- Collections can be created from Vault assets.
- Movie Maker can use Vault assets.
- Watch flows work from Vault and Collections.
- Ops shows Worker, R2, metadata, import, and gap proof with honest statuses.
- No read-only load mutates R2, D1, extension processed IDs, or live Grok.
- Lint, tests, build, and typecheck pass or exact blockers are recorded.
