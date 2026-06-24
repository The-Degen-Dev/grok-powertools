# Vault Movie Drafts And Playback Stabilization Design

Date: 2026-06-23

Status: Design approved in chat. Pending `/writing-plan`.

Route surfaces: `/vault`, `/movie`

## Purpose

Make Movie Maker usable for real Vault media by solving the preview strobing problem and adding a batch workflow that creates several local movie drafts from committed Vault videos.

The goal is not to redesign the whole editor. The first useful outcome is: load Vault, build several local movie drafts from verified videos, preview them without flashing or jumpy playback, and export a WebM when one looks good.

## Non-Goals

- Do not change the Chrome extension backup flow.
- Do not write to R2, D1, Worker repair routes, processed IDs, or live Grok state.
- Do not change secrets, `.env` files, OAuth config, or Worker bucket config.
- Do not redesign the standalone Clip Editor in this pass.
- Do not add automatic cloud export or upload.
- Do not add a new IndexedDB store unless the writing plan finds a concrete need.

## Current Repo Fit

Movie Maker already stores local `Movie` records in IndexedDB through `web/src/lib/local-storage.ts`.

Vault already stores committed `VaultAsset` records in `vault_assets`, exposes local media through `/api/vault/media/[assetId]`, and has conversion helpers in `web/src/lib/vault-view-models.ts`.

Collections already have a watch queue flow in `web/src/lib/watch-mode.ts` that can create a movie from a queue. The Vault draft builder should reuse that pattern where practical, but it must support batch creation from Vault assets directly.

The likely strobing source is `CanvasPlayer`: during render it seeks the active video toward the computed timeline time. That is useful for scrubbed preview, but it can force repeated decoder seeks during normal playback.

## Architecture

Keep the existing Movie Maker architecture:

- `Movie` and `MovieClip` remain the source of truth.
- `CanvasPlayer` remains the preview and export canvas.
- `ExportMovieButton` keeps recording `canvas.captureStream()`.
- Vault media continues to flow through `vaultMediaUrl(asset)`.

Add one new product layer:

- A Vault movie draft builder that takes committed Vault assets plus optional overlays and selected IDs, then creates one or more local `Movie` records.

The builder is local-only. It reads IndexedDB and writes local movie records. It does not perform cloud repair, cloud sync, or live Grok actions.

## Playback Stabilization

Split the player behavior into two modes:

- Scrub and sync mode: explicit seek, paused preview, clip boundary setup, playback restart, export restart.
- Play mode: active video elements play normally while the canvas draws their current frame.

Expected player behavior:

- Seek when entering a new clip, when the user drags the scrubber, when playback starts from a requested time, or when drift is severe after a cooldown.
- Do not seek the same video on every render frame during normal playback.
- Keep the last successfully drawn frame visible while a video is seeking or buffering.
- Preload the current and next media. Preload all media for small movies, and use a sliding window for larger movies.
- Preserve title cards and image clips.
- Treat generated draft transitions as `cut` by default.

Manual fade and crossfade remain supported, but auto-generated draft movies should not default to crossfade until the preview path is proven stable.

## Vault Draft Builder

Inputs:

- Committed `VaultAsset[]`.
- Optional `VaultOverlay[]`.
- Optional selected asset IDs.
- Scope settings from the UI.
- Recipe settings from the UI.

Default asset filter:

- `mediaType === "video"`.
- `verificationStatus === "verified"`.
- Asset has a canonical or legacy object key that can produce a media URL.
- Asset is not locally hidden unless the user chooses an all-assets scope.

Default output:

- One or more local `Movie` records.
- Existing default resolution, `1080x1920`.
- Clips ordered newest-first unless the recipe states otherwise.
- `sourceAssetId` preserved on every clip.
- `transition: { type: "cut", duration: 0 }` for generated drafts.
- Duplicate `assetId`s removed inside each draft.

Skipped assets should be reported with reasons:

- image-only asset,
- unverified, blocked, failed, or unknown media,
- missing object key,
- hidden by local overlay,
- duplicate asset in the same draft.

## Recipes

Start with practical recipes that can be understood without reading code:

- Recent Video Drafts: create several drafts from the newest verified videos, chunked by a chosen max clips per movie.
- Selected Video Drafts: create drafts from selected Vault videos.
- Favorite Drafts: create drafts from assets with a local favorite overlay.
- Prompt Group Drafts: group videos only when prompt text has an obvious repeated normalized phrase or shared prompt identifier. If the data is weak, skip group creation and report that no clear groups were found.

The builder should avoid pretending that weak metadata is meaningful. If a recipe cannot make a good group, it should create no movie for that group and explain why.

## Vault UI

Add a `Build Movies` action on the Vault page.

Source behavior:

- If assets are selected, default to selected assets.
- If no assets are selected, default to the current filtered visible set.
- Also allow all visible verified videos and favorites as explicit scopes.

The action opens a compact modal with:

- source scope,
- recipe set,
- max clips per movie,
- max movies to create,
- transition default, with `cut` selected,
- option to open the first created movie after creation.

After creation, show a summary:

- source videos considered,
- videos skipped,
- movies created,
- links or buttons for created movies,
- skipped reasons.

The builder button should be disabled while it is running so repeated clicks do not create accidental duplicates.

## Movie Maker UI

On the movie list, add `Build from Vault` next to `New Movie` as a secondary action.

Inside a movie editor:

- Keep the existing storyboard plus preview layout.
- Add clear media-loading or failed-media states in the preview instead of flashing black.
- Keep manual reorder and delete controls.
- Do not add a large editing panel in this pass.

The standalone Clip Editor remains mostly unchanged. The batch draft workflow should reduce the need to manually use Clip Editor before a movie exists.

## Error Handling

If no committed Vault assets exist, guide the user to preview and commit Vault first.

If the chosen source scope has no verified videos, show the active scope and filters with a recovery action.

If an asset cannot become a clip, skip it and include the reason in the creation summary.

If media fails to load during preview, show a failed-media state for that clip and keep the last valid canvas frame rather than flashing black.

If draft creation partially fails, keep already-created movies and show which assets or recipes failed. Do not hide partial results.

## Tests And Validation

Unit coverage:

- draft-builder filters verified videos correctly,
- hidden and favorite overlays affect scope correctly,
- selected scope uses selected assets only,
- duplicate assets are removed inside a draft,
- chunking honors max clips and max movies,
- skipped reasons are returned,
- generated clips preserve `sourceAssetId` and default to `cut`.

E2E coverage:

- Commit fake Vault, build movies from selected videos, verify local movie records.
- Build from the current filtered Vault set.
- Build from favorites.
- Verify created movies open in Movie Maker.
- Verify generated clips use `/api/vault/media/...` URLs and preserve `sourceAssetId`.

Playback regression coverage:

- Use a real playable local video fixture, not only the current tiny fake MP4 header.
- Prove normal playback does not assign `video.currentTime` every frame.
- Prove canvas output does not repeatedly flash to black during playback.
- Prove scrubbing still seeks to the expected time.
- Prove image and title clips still render.

Manual validation:

- Run the local web app against real committed Vault data.
- Create several movies from real Vault videos.
- Play multiple generated movies for at least one full clip transition.
- Scrub within a movie.
- Export one WebM and inspect the result.

Validation commands after the future code change:

```bash
npm --prefix web run lint
npm --prefix web run build
npx playwright test -c playwright.web.config.js
```

Root extension tests are not required if only web app files and web tests change. If root extension files, shared root scripts, or cloud files change, run the matching root or cloud gates too.

## Writing Plan Defaults

- Build all four recipes in the first code pass: recent, selected, favorites, and prompt groups.
- Keep generated drafts video-only in this pass. Images can still be added manually through existing Movie Maker paths.
- Name generated movies with the recipe label, source scope, and local run timestamp.
- Allow `Build Movies` whenever committed local Vault assets exist. A fresh preview is not required before every draft run.
- If the writing plan finds that prompt grouping would require fuzzy matching or heavy new dependencies, keep grouping deterministic and narrow instead of adding those dependencies.

## Acceptance Criteria

- User can create several local movie drafts from committed Vault videos without one-by-one clip picking.
- Generated draft clips preserve `sourceAssetId`.
- Generated draft clips default to cut transitions.
- Movie Maker preview plays generated multi-video movies without visible strobing or repeated black flashes.
- Scrubbing still works.
- Export WebM still works through the canvas path.
- No R2, D1, processed IDs, Worker repair state, extension backup state, or secrets are touched.
