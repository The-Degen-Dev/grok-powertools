# Movie Maker Review Bay Full Program Spec

Date: 2026-06-28

Status: Spec-first reset. Pending implementation planning.

Route surfaces: `/movie`, `/vault`, local media routes, local IndexedDB.

Related artifacts:

- `docs/superpowers/specs/2026-06-18-r2-backed-vault-webapp-design.md`
- `docs/superpowers/specs/2026-06-23-vault-movie-drafts-playback-design.md`
- `docs/superpowers/specs/2026-06-26-movie-maker-review-bay-upgrade-design.md`
- `docs/superpowers/plans/2026-06-27-movie-maker-review-bay-phase1.md`

This is the full-program product and architecture spec. It is not an implementation plan. The future implementation plan should derive tasks from this spec after the spec is reviewed and accepted.

## Purpose

Movie Maker should become the local operator tool for turning a large R2-backed Grok saved gallery into watchable, editable, exportable movies.

The product shape is a desktop-first Review Bay, not a tiny Premiere clone. The workflow is closer to a contact-sheet culling tool plus an assisted assembly bench:

1. Pull from committed local Vault assets.
2. Build or open local movie drafts.
3. Review many candidate clips quickly.
4. Keep, reject, group, order, trim, and mix.
5. Ask Director for proposals without giving it direct write authority.
6. Preview with sound.
7. Export a real MP4 with audio proof, keeping WebM fallback.

The core wedge is speed and confidence over a personal AI media library. The app should help the operator make good cuts from lots of generated media without hiding provenance, source prompts, audio state, or export risk.

## Current Repo Reality

Audited against the feature branch with `origin/main` merged on 2026-06-28.

Current web app stack:

- Next.js 16.1.6.
- React 19.2.3.
- TypeScript.
- IndexedDB through `idb` 8.0.3.
- Vitest 4.1.9.
- Playwright 1.57.0.
- `@ffmpeg/ffmpeg` 0.12.15.
- `@ffmpeg/util` 0.12.2.
- `web/src/lib/useFFmpeg.ts` still hard-codes `@ffmpeg/core@0.12.6`.
- `web/package.json` does not currently list `zod` as a direct dependency.
- `web/package-lock.json` currently contains transitive `zod` 4.3.6.
- `web/src/lib/local-storage.ts` currently uses `DB_VERSION = 5`.
- Local `ffmpeg` and `ffprobe` are available at `/opt/homebrew/bin/ffmpeg` and `/opt/homebrew/bin/ffprobe`.

Current Movie Maker state:

- `web/src/app/movie/page.tsx` is the route entry.
- `web/src/components/movie/MovieMaker.tsx` is the top-level simple editor.
- `web/src/components/movie/CanvasPlayer.tsx` owns preview, canvas drawing, media element setup, timeline math, playback loop, and sync logic.
- `web/src/components/movie/StoryboardPanel.tsx` owns simple reorder, delete, add clip, and transition selection.
- `web/src/components/movie/MovieTimeline.tsx` owns the simple scrub strip.
- `web/src/components/movie/ExportMovieButton.tsx` exports WebM by recording `canvas.captureStream()`.
- `web/src/lib/types.ts` defines `Movie` and `MovieClip`.
- `web/src/lib/local-storage.ts` persists local movies.
- `web/src/lib/vault-movie-drafts.ts` can already build local draft movies from Vault media.
- `web/src/lib/vault-movie-draft-storage.ts` persists generated Vault drafts.

Current Vault constraints that matter:

- Vault assets are local IndexedDB records derived from R2-backed inventory.
- Media should flow through the existing media route. Movie records must not persist signed URLs.
- Collections and movies are local overlays on top of Vault assets.
- Video-only workflows must explain skipped images. End-state Movie Maker should support videos and still images.
- Read-only Vault load must not mutate R2, D1, Worker repair state, processed IDs, extension backup state, live Grok, env files, or secrets.

## Program Scope

The program covers the complete Movie Maker evolution from the current simple editor to a robust local Review Bay.

In scope:

- Local Movie Maker redesign.
- Vault-backed draft creation and re-opening.
- Review/Triage, Focus/Loupe, and Assemble modes.
- Candidate culling.
- Clip Strip as the committed cut source of truth.
- Draft Queue for whole-project versions.
- Director proposals and alternate local drafts.
- Prompt/source spine and review intelligence.
- Timeline depth for practical editing.
- Export pre-flight and export history.
- MP4 primary export with audio proof and WebM fallback.
- Local-only project persistence.
- Optional model-backed Director through a server-side OpenAI-compatible boundary.
- CLIProxyAPI compatibility when configured.
- Browser and E2E validation against local fake Vault worker plus real local Vault data where available.

Out of scope unless a later accepted spec explicitly adds it:

- Chrome extension backup changes.
- R2 object mutation.
- D1 mutation.
- Worker repair execution.
- Processed-ID reset.
- Live Grok automation.
- OAuth or Cloudflare dashboard changes.
- Env file or secret rotation.
- Production bucket or API key changes.
- Cloud collaboration.
- Public publishing pipeline.
- Hidden provider credentials in browser code.
- Silent AI mutation of a current cut.

## Product Model

The product has six persistent concepts.

| Concept | Meaning | Owner | Notes |
| --- | --- | --- | --- |
| Vault asset | Local proof-backed media source | Vault | References R2 object proof and source metadata. |
| Movie | Existing local movie record | Current app | Legacy-compatible project anchor. |
| Review project | Review Bay state for a movie | Review Bay | Stores candidates, committed cut, mode, filters, mix state. |
| Draft version | Whole-cut version | Draft Queue | Selecting a version replaces the committed cut. |
| Clip alternate | Alternate take for one clip | Inspector | Attached to one clip, not a whole version. |
| Director proposal | Reviewable changeset | Director | Must be diffed and accepted explicitly. |

The most important model boundary:

- Candidates Grid is for proposed or undecided clips.
- Clip Strip is the committed cut.
- Draft Queue is whole-version management.
- Alternates are clip-level.
- Director proposals are proposed changesets, not state mutations.

No component may treat these as interchangeable.

## Product Surfaces

## Vault Entry Points

Vault remains the source browsing surface. It should offer movie creation actions that create local drafts without forcing one-by-one clip selection.

Required Vault-to-Movie behaviors:

- Build from selected verified videos.
- Build from current filtered visible verified videos.
- Build from favorites.
- Build from deterministic prompt groups when the metadata supports it.
- Explain skipped assets with reasons.
- Preserve `sourceAssetId`.
- Preserve media type.
- Use media routes, not signed URLs.
- Avoid accidental duplicate drafts on repeated clicks.

## Movie List

The `/movie` list should provide:

- New Movie.
- Build from Vault.
- Recent local drafts.
- Draft provenance, including whether the draft came from Vault, manual creation, or Director.
- Clear empty state that points to Vault when no useful media is local.

## Review Bay

Movie Maker becomes a dense operator console.

Required modes:

| Mode | Primary job | Required center surface |
| --- | --- | --- |
| Review/Triage | Cull proposed and undecided clips quickly | Candidates contact sheet |
| Focus/Loupe | Inspect one clip accurately | Large single-clip preview |
| Assemble | Order and preview the committed cut | Continuous preview plus time ribbon |

Required panels:

- Header: project title, draft status, mode controls, Director status, export gate.
- Left column: Draft Queue and Director tab.
- Center: mode-specific work area.
- Right Inspector: selected clip/proposal details, trim, volume, metadata, alternates.
- Bottom Clip Strip: committed order and status rail.

The first useful viewport must show the work area, not a landing page or explanatory shell.

## Interaction Model

Keyboard-first review is part of the product, not an enhancement.

Required review actions:

- Keep current candidate.
- Reject current candidate.
- Apply proposal when focused on a proposal.
- Auto-advance after keep/reject where practical.
- Move selected committed clip left/right.
- Delete selected committed clip.
- Toggle Focus/Loupe.
- Play/pause preview.
- Seek backward/forward.
- Preserve normal typing behavior inside text inputs.

Selection must have one source of truth. Clip-specific controls may only target clip or candidate selections. Proposal selections must use proposal IDs and cannot masquerade as clip IDs.

## Status Model

Clip status has two axes:

- Lifecycle: proposed, kept, rejected.
- Flags: trimmed, has-source-audio, muted-in-mix, export-safe, needs-attention.

Status must be legible without color:

- Proposed: dashed border plus diamond glyph.
- Kept: solid border plus check glyph.
- Rejected: reduced opacity, strikethrough, x glyph.
- Trimmed: scissors glyph plus trim inset tick.
- Has-source-audio: music-note glyph.
- Muted-in-mix: muted music-note glyph.
- Export-safe: double border plus export glyph.
- Needs-attention: warning glyph and focusable label.

Every visible status indicator needs an accessible name.

## Audio Model

Audio is not optional if Movie Maker is meant to make usable movies.

Audio layers:

- Per-clip source audio.
- Optional master/bed audio.
- Per-clip gain, mute, and solo.
- Master gain and mute.
- Ducking only when an actual bed exists.

Audio state:

- Has-source-audio means detection found or metadata proves an audio stream.
- Muted-in-mix means the clip has audio but the user intentionally silenced it.
- Unknown audio means export-safe is unresolved until detection recovers or the operator confirms intent.

Preview must be audible when source audio exists and the mix allows it.

Export must preserve audio when the source mix has audio.

## Export Model

MP4 with audio is the primary export target. WebM remains a fallback.

Export requirements:

- Export pre-flight runs before long export begins.
- Export blockers disable export and link back to the affected clips.
- Export warnings do not block, but must be visible.
- MP4 export must not be implemented by relabeling canvas-only WebM output.
- The export engine choice must be proven before export work starts.
- FFmpeg.wasm is the conservative Phase 1 default, but WebCodecs plus Mediabunny may replace it only after a short spike proves MP4 plus audio, browser support, memory behavior, and testability with this repo's fixture media.
- Remotion may inform future deterministic rendering architecture, but it must not become a hidden server or licensing dependency for local-only Phase 1 work without a separate decision record.
- FFmpeg core/runtime versions must be verified during implementation.
- If FFmpeg.wasm multithreaded core is used, cross-origin isolation and SharedArrayBuffer requirements must be explicitly handled before it is selected.
- If WebCodecs is used, the plan must cover browser support, MP4 muxing, frame and audio sample cleanup, and fallback behavior.
- Completed MP4 exports with expected audio must be verified by stream inspection in tests.
- Export runs are stored locally with timestamp, format, status, warnings, duration where available, output size where available, and audio proof result.

Blockers:

- No committed clips.
- Unresolved unsafe candidate state.
- Pending proposal that would change export state.
- Missing media.
- Invalid duration.
- Unknown audio intent.
- Unsupported source media.

Warnings:

- Partial source audio coverage.
- Muted source audio.
- Resolution mismatch.
- Non-cut transitions requiring fallback behavior.
- Browser/runtime export limitation.

## Preview, Media, And Timebase Model

Preview and export must share a deterministic project model even if they use different render engines.

Required media rules:

- Timeline math must use integer frame ticks, rational time values, or an equivalent stable timebase instead of accumulating floating-point seconds as the source of truth.
- Preview should prefer frame callbacks such as `requestVideoFrameCallback` where available, while keeping a tested fallback for browsers that lack it.
- Preview must avoid seeking the active video every animation frame.
- Last-good-frame behavior should hide transient decode stalls without hiding missing-media errors.
- Media element, object URL, AudioContext, FFmpeg virtual file, VideoFrame, and AudioData lifecycles must have explicit cleanup paths.
- Audio preview and export must derive from the same clip trim, gain, mute, and solo state.
- Browser media feature detection belongs in media hooks or export adapters, not scattered through UI components.

## Director Model

Director is an assistant lane, not a second editor.

Director responsibilities:

- Score and bucket candidates.
- Suggest ordering.
- Suggest trims.
- Suggest titles.
- Explain rationale.
- Create alternate local drafts.
- Produce review notes.
- Identify duplicates or weak endings when evidence supports it.

Hard rules:

- Rule-based Director must work with no provider configured.
- Model-backed Director must be off by default.
- Model-backed provider calls must go through a server/API boundary.
- Browser components must never receive API keys, bearer tokens, provider base URLs intended to be secret, cookies, or raw provider auth headers.
- Provider requests and responses must be schema-validated.
- Invalid model output becomes a visible validation error, not a partial edit.
- Director proposals cannot directly mutate the current cut.
- Applying a Director proposal requires explicit user action.
- Partial accept must apply only selected changes.

OpenAI-compatible and CLIProxyAPI compatibility are product requirements, but they do not justify putting provider config or credentials in browser state.

## Prompt Spine And Review Intelligence

The saved gallery is prompt-rich. The app should use prompt/source metadata before attempting heavyweight AI analysis.

Prompt Spine means every candidate and committed clip can surface:

- Source prompt text or redacted sample where available.
- Prompt hash.
- Prompt source count.
- Grok post/source URL where known.
- Created/imported date.
- Asset ID.
- Related assets from same or similar prompt.
- Local notes/tags/favorite state.

Review Intelligence means the app can help explain why a draft exists:

- Grouped by prompt.
- Grouped by source date/session where reliable.
- Grouped by favorite/local overlay.
- Duplicate or near-duplicate candidates where deterministic or sufficiently proven.
- Score cards that explain strongest/weakest motion, prompt match, continuity, and audio availability.

The system must not pretend weak metadata is strong. If grouping is uncertain, it should say so and fall back to narrower deterministic grouping.

## Timeline Depth

Timeline depth should be added only after Review Bay foundation is stable.

Required eventual editing depth:

- Rich waveform trim controls.
- Split.
- Duplicate.
- Speed controls.
- Crop/reframe.
- Caption/transcript tools only when source speech support actually exists.
- Multi-track audio refinement.
- Better transition controls.

Timeline depth must keep Clip Strip and Review Bay concepts intact. It should extend the committed cut model, not replace the product with a generic NLE.

## Generative And Sharing

Generative hooks and sharing are later-stage capabilities.

Generative work may include:

- Provider-specific edit/recreate hooks.
- Prompt remix proposals.
- Alternate take generation.
- Missing-clip replacement suggestions.

Generative work must obey provider-native capability boundaries. It must not fake provider functionality by recreating provider web apps inside this app.

Sharing may include:

- Local export packages.
- Read-only review links.
- Cloud project sync.
- Comments.
- Published cuts.

Sharing must wait until local versioning, export, auth, and data boundaries are stable. Do not add cloud sync as a way to compensate for incomplete local state.

## Architecture Principles

Use schema-first contracts:

- Define Zod schemas for persisted Review Bay state, Director payloads, export runs, and notes.
- Derive TypeScript types from schemas.
- Use schemas at API and persistence boundaries.
- Do not generate contracts from incidental runtime behavior.

Keep pure logic outside React:

- Review reducer.
- Timeline calculations.
- Timebase and frame mapping.
- Export-safe predicate.
- Director proposal validation and application.
- Draft grouping.
- Prompt grouping.

Keep effects at edges:

- IndexedDB storage helpers.
- Next API routes.
- Media loading hooks.
- Export engine orchestration.
- Browser media capability detection.
- Provider route calls.

Keep browser secrets out of browser code:

- Server routes may read env.
- Client components may ask whether a provider is configured.
- Client components may not handle raw provider auth.

Keep migrations additive:

- Preserve existing `movies`.
- Preserve existing collections, prompts, settings, sync metadata, and Vault stores.
- Add Review Bay stores without wiping local work.
- Existing `Movie` records must keep opening or be migrated lazily.

## Data Boundaries

Local app data may include:

- Movie records.
- Review projects.
- Draft versions.
- Clip alternates.
- Director proposals.
- Export runs.
- Review notes.
- Local overlays.
- Prompt metadata.

Local app data must not include:

- Long-lived signed URLs.
- API keys.
- Bearer tokens.
- Cookies.
- Provider secrets.
- Chrome extension processed IDs.
- Raw production credentials.

Movie records should store stable references and local review metadata. They should not store temporary media access tokens.

## Phase Model

The phase model is dependency-ordered. Later phases should not be planned as vague future work; each phase has a purpose, prerequisites, and exit criteria.

## Phase 0: Stabilized Current Base

Purpose: Preserve the working Vault-to-Movie foundation while preparing the Review Bay build.

Includes:

- Confirm current `origin/main` is merged.
- Confirm local web app starts.
- Confirm Vault media routes work with fake worker and real local config where available.
- Confirm existing Movie Maker opens existing drafts.
- Confirm WebM export baseline still works if touched.
- Confirm no local user data is wiped.

Exit criteria:

- Current simple Movie Maker remains usable before replacement work starts.
- Existing Vault draft creation remains usable.
- Test and lint command surfaces are known.
- Any local env or auth blockers are explicit.

## Phase 1: Review Bay Foundation

Purpose: Replace the simple editor with a real local Review Bay that can review, assemble, preview with audio, and export.

Includes:

- Schema-first Review Bay domain model.
- Additive IndexedDB stores.
- Legacy `Movie` hydration.
- Review/Triage mode.
- Focus/Loupe mode.
- Assemble mode.
- Candidates Grid.
- Clip Strip.
- Inspector.
- Draft Queue.
- Director tab.
- Keyboard culling.
- Trim, reorder, delete, volume, mute, solo.
- Audio-aware preview.
- Export pre-flight.
- MP4 with audio through the selected proven export engine.
- Export-engine spike and decision record, covering FFmpeg.wasm versus WebCodecs plus Mediabunny for MP4 plus audio.
- WebM fallback.
- Export history.
- Rule-based Director.
- Server-routed OpenAI-compatible Director option.
- CLIProxyAPI-compatible route configuration.
- Accessibility and mobile review baseline.

Exit criteria:

- User can create or open Vault-backed drafts and review them locally.
- User can keep/reject/apply candidates quickly.
- User can assemble a committed cut.
- User can hear source audio when present.
- User can export MP4 with audio proof on fixture media.
- WebM fallback remains available.
- Director proposals are reviewable and proposal-only.
- No R2/D1/Worker/processed/live/env/secret/cloud writes occurred.

## Phase 2: Prompt Spine And Review Intelligence

Purpose: Make the Review Bay intelligent over the saved gallery without relying on generative mutation.

Prerequisites:

- Phase 1 local Review Bay works with real Vault-backed drafts.
- Review project schema and storage are stable.
- Prompt metadata import and dedupe are reliable enough to reference.
- Director proposals are already safe and reviewable.

Includes:

- Prompt Spine panel/overlay for each clip.
- Prompt grouping recipes.
- Source date/session grouping where reliable.
- Favorite/tag/note-aware grouping.
- Duplicate and near-duplicate detection with explainable thresholds.
- Similar-shot clusters.
- Why-this-draft score cards.
- A/B draft comparison.
- Better review notes.
- Better Director context using prompt/source metadata.
- Deterministic fallback when metadata is weak.

Exit criteria:

- User can understand why clips were grouped or suggested.
- Draft scores are explainable, not magic.
- Prompt grouping does not create false certainty.
- A/B compare works without corrupting current cut state.
- Director context improves suggestions while staying proposal-only.

## Phase 3: Timeline Depth

Purpose: Add enough editing depth that a promising cut can become polished without leaving the app.

Prerequisites:

- Phase 1 export and preview are stable.
- Phase 2 metadata intelligence does not corrupt draft state.
- The timeline model has proven trim/order/export correctness.

Includes:

- Rich waveform trim UI.
- Split.
- Duplicate.
- Speed controls.
- Crop/reframe.
- Transition refinement.
- Multi-track audio refinement.
- Captions/transcript tools only if source speech support exists.
- Improved preview performance for longer cuts.
- Better export pre-flight for advanced edits.

Exit criteria:

- User can do practical fine editing without Clip Strip model confusion.
- Advanced timeline edits persist correctly.
- Export handles advanced edits or blocks with clear reasons.
- Preview remains stable and non-strobing.
- Audio remains audible and exportable.

## Phase 4: Generative And Sharing

Purpose: Add provider-assisted generation and share/review workflows after the local editing core is reliable.

Prerequisites:

- Local Review Bay, export, versioning, and prompt spine are stable.
- Provider capability boundaries are understood and tested.
- Auth/cloud sync requirements are explicitly approved.

Includes:

- Provider-specific generative edit/recreate hooks.
- Alternate take generation where provider supports it.
- Missing-clip replacement suggestions.
- Prompt remix proposals.
- Local export packages.
- Optional cloud project sync.
- Read-only review links.
- Comment/review workflows.

Exit criteria:

- Generative work remains explicit, reviewable, and provider-aware.
- Sharing does not leak private media, prompts, credentials, or signed URLs.
- Cloud sync is opt-in and does not become a hidden dependency for local use.

## Cross-Phase Safety Rules

- No deletes of user media without an explicit delete spec.
- No reset of Chrome extension processed IDs.
- No R2 writes unless a separate repair/export-to-cloud spec approves them.
- No D1 writes unless a separate sync/repair spec approves them.
- No Worker route mutation unless explicitly scoped.
- No live Grok automation unless explicitly requested and using the existing logged-in Chrome session.
- No detached Chrome profile for live validation.
- No secrets in source code, docs, logs, screenshots, IndexedDB, or implementation notes.
- No provider auth in browser state.
- No public bucket assumption.
- No long-lived signed URLs in local storage.
- No AI direct mutation of a current cut.
- No cloud sync until local state is stable and user-approved.

## Validation Strategy

Every implementation plan derived from this spec must include:

- Unit tests for pure reducers/selectors.
- Storage migration tests.
- Schema rejection tests.
- Director fake-provider tests.
- Export argument tests.
- Playwright E2E over fake Vault worker.
- Real local browser pass where the workflow depends on UI feel.
- MP4 audio proof with `ffprobe`.
- Browser media support matrix for any selected export engine.
- Cleanup proof for object URLs, FFmpeg virtual files, media elements, AudioContext, and WebCodecs frames or samples when used.
- Boundary checks for no env/R2/D1/extension/processed/live Grok changes.
- Secret scan over diffs before commit.

Phase-specific validation:

| Phase | Required proof |
| --- | --- |
| Phase 0 | Existing app opens and current Movie/Vault flows still work. |
| Phase 1 | Review Bay workflow, audio preview, MP4 audio export, Director proposal-only behavior. |
| Phase 2 | Prompt/source grouping accuracy, duplicate detection explainability, A/B compare safety. |
| Phase 3 | Advanced timeline edits persist, preview, and export correctly. |
| Phase 4 | Provider and sharing flows do not leak private data or bypass approval. |

## Footgun Register

Known failure modes to design against:

- Treating the Phase 1 implementation plan as the full product plan.
- Mixing Candidates Grid, Clip Strip, Draft Queue, alternates, and proposals into one generic list.
- Letting model output directly edit current state.
- Moving provider credentials into browser code for convenience.
- Storing signed URLs in movie records.
- Using canvas capture and labeling the output MP4.
- Shipping export without proving audio stream presence.
- Assuming WebCodecs includes MP4 muxing by itself.
- Choosing FFmpeg.wasm without testing memory, cancellation, long-run behavior, and cross-origin isolation requirements.
- Leaking object URLs, media elements, AudioContext nodes, FFmpeg virtual files, VideoFrame objects, or AudioData objects.
- Letting floating-point timeline drift create preview/export mismatches.
- Treating weak prompt metadata as reliable grouping.
- Using cloud sync to patch incomplete local state.
- Breaking existing local movies during IndexedDB migration.
- Reintroducing strobing by seeking the active video every frame.
- Hiding images instead of supporting still-image clips or explaining exclusions.
- Making mobile fine editing cramped instead of intentionally limiting it.
- Letting later generative features obscure local provenance.

## Open Questions Before Implementation Planning

These need answers or explicit defaults before writing the next implementation plan:

- Should Phase 1 stay the immediate implementation target, or should the first implementation plan include Phase 0 verification as its own opening task?
- For Phase 2 duplicate/similar detection, is deterministic metadata plus simple perceptual hints enough, or do we want a heavier embedding/perceptual hash lane?
- For Phase 3 captions/transcripts, should speech support be excluded until there is real source audio speech detection?
- For Phase 4 sharing, is local export package enough at first, or should cloud project sync be planned once local export is stable?

## Acceptance Criteria For This Spec

This spec is complete enough for implementation planning when:

- It covers the whole Movie Maker program, not only Phase 1.
- It distinguishes spec, phase model, and implementation plan.
- It is grounded in the current repo state.
- It keeps Vault, R2, D1, extension, live Grok, env, and secret boundaries explicit.
- It defines what each phase is for.
- It defines what must be true before later phases start.
- It lists cross-phase footguns.
- It gives enough structure for a future full implementation plan without forcing that plan to guess product intent.
