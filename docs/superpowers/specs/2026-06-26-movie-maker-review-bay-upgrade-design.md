# Movie Maker Review Bay Upgrade Design

Date: 2026-06-26

Status: Design approved in chat. Pending `/writing-plan`.

Route surfaces: `/movie`, `/vault`

## Purpose

Upgrade Movie Maker from a simple canvas preview into a desktop-first Review Bay for turning a large R2-backed Grok saved gallery into exportable movies.

The product is not a tiny Premiere clone. Its closest workflow metaphor is Photo Mechanic culling for AI-generated video: move through many candidates quickly, keep/reject/apply decisions mostly from the keyboard, assemble the survivors into an ordered cut, preview with sound, and export a shareable MP4.

Phase 1 must feel like a real local tool, not a skeleton. It should ship the review/export loop end to end while keeping the architecture ready for later timeline depth.

## Non-Goals

- Do not change the Chrome extension backup flow.
- Do not write to R2, D1, Worker repair routes, processed IDs, or live Grok state.
- Do not change secrets, `.env` files, OAuth config, or Worker bucket config.
- Do not add cloud project sync in Phase 1.
- Do not add collaboration, shared review links, or cloud comments in Phase 1.
- Do not build a full multi-track nonlinear editor in Phase 1.
- Do not add transcript editing unless source speech support is explicitly added in a later phase.
- Do not let AI model output directly mutate the current cut without an explicit user apply action.

## Product Shape

Movie Maker becomes a desktop-first Contact Sheet Review Bay.

Phase 1 ships one coherent workflow:

1. Load Vault-generated drafts and alternate drafts in `/movie`.
2. Review clips fast in a candidates contact-sheet grid with keyboard triage.
3. Keep/reject/apply clips and proposals.
4. Reorder, delete, trim start/end, and set per-clip volume.
5. Preview with real audio.
6. Use Director to propose sequences, titles, trims, rationale, notes, and alternate local drafts.
7. Export MP4 with audio through FFmpeg-grade export, with WebM fallback.

Director is the canonical name. "AI Director" is the long form when needed. It can propose changes and create alternate local drafts. It cannot directly mutate the current movie unless the user applies a proposal.

## Current Repo Fit

Movie Maker currently stores local `Movie` records in IndexedDB through `web/src/lib/local-storage.ts`.

Vault already stores committed `VaultAsset` records in `vault_assets`, exposes local media through `/api/vault/media/[assetId]`, and creates local movie drafts from committed Vault videos.

Current Movie Maker pieces:

- `MovieMaker.tsx`: top-level editor state and layout.
- `CanvasPlayer.tsx`: preview canvas, media element setup, playback loop, transport controls, and timeline math.
- `StoryboardPanel.tsx`: reorder/delete/add clips and transition selection.
- `MovieTimeline.tsx`: simple lower strip and scrub target.
- `ExportMovieButton.tsx`: browser canvas WebM export.

The upgrade should keep useful local storage and draft-builder work, but split responsibilities that are currently concentrated in `CanvasPlayer`.

## Surfaces And Modes

Movie Maker has three mutually exclusive modes over the same project.

| Mode | Default | Center surface | Purpose |
| --- | --- | --- | --- |
| Review / Triage | Yes | Candidates contact-sheet grid | Cull proposed and undecided clips at speed |
| Focus / Loupe | No | Single clip fills viewport | Frame-accurate review of one clip; keep/reject/next stay live |
| Assemble | No | Time-proportional ribbon plus continuous-cut preview | Order, transition, audio-bed, and preview the committed cut |

The app has two typed clip surfaces. They must not be conflated:

- Candidates Grid: proposed and undecided clips only. This is the triage surface. Frames leave the grid once decided.
- Clip Strip: the committed full-width rail at the bottom. It is the single source of truth for committed order and status.

Draft Queue is whole-compilation version management only. Selecting a version reloads the entire Clip Strip. Draft Queue never carries per-clip status.

Director panel is docked as a tab beside Draft Queue in the left column.

## Review Mode Layout

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ Header: title · draft status · Director activity · Export gate              │
├──────────────┬─────────────────────────────────────────┬─────────────────────┤
│ Left column  │ Center: Candidates Grid                 │ Right: Inspector    │
│ Draft Q | Dir│ proposed / undecided frames             │ trim, volume, meta  │
│ versions     │ filter: proposed / kept / rejected      │ alternates stack    │
│ Director tab │ shift/rubber-band multi-select          │ collapses <1440px   │
├──────────────┴─────────────────────────────────────────┴─────────────────────┤
│ Clip Strip: committed cut, order, lifecycle state, stackable flags           │
└──────────────────────────────────────────────────────────────────────────────┘
```

Region responsibilities:

- Header: project identity, draft status, Director activity indicator, export pre-flight gate.
- Left Draft Queue tab: whole-compilation versions only.
- Left Director tab: Director conversation, proposal list, and re-prompt channel.
- Center Candidates Grid: cull candidates and switch to Focus / Loupe.
- Right Inspector: selected clip/proposal detail, numeric trim, gain, metadata, alternates.
- Bottom Clip Strip: committed order and status rail.

## Assemble Mode Layout

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ Header: title · draft status · Director activity · play whole cut · Export  │
├──────────────┬───────────────────────────────────────────────────────────────┤
│ Left column  │ Continuous-cut preview, playhead, scrub                       │
│ Draft Q | Dir│                                                               │
├──────────────┴───────────────────────────────────────────────────────────────┤
│ Time-proportional ribbon: clip width = duration, transition slots between    │
│ Audio bed lane: gain, mute, solo, duck                                       │
│ Per-clip source audio waveform lane: scrub, seek, trim surface               │
└──────────────────────────────────────────────────────────────────────────────┘
```

Width encodes duration. The playhead scrubs the continuous assembled cut, distinct from per-clip preview. Transition slots sit between clips.

The Review/Focus waveform and Assemble per-clip waveform are one logical trim surface. They read and write the same trim model. The Inspector mirrors numeric in/out fields against that same model and is not a second trim owner.

## Director

Director is an optional local assistant lane. Rule-based assembly always works without model configuration. Model-backed Director uses an OpenAI-compatible provider adapter and must be compatible with local CLIProxyAPI setups.

Director responsibilities:

- Score and bucket clips: best motion, duplicates, weak endings, visual continuity, prompt/theme match, suggested order.
- Propose sequences, titles, pacing notes, trims, and rationale.
- Create alternate local drafts.
- Create review notes and time-anchored comments.
- Explain confidence next to each keep/reject/apply action.

Director proposal rules:

- A proposal is a reviewable changeset diffed against the current cut.
- It can show ghosted insertions, struck-through removals, before/after retrims, and reorder arrows.
- It supports partial accept.
- "Preview proposed cut" plays the cut as it would be if applied.
- Invalid model output becomes a validation error, not a partial edit.
- Director cannot mutate the current cut directly.

Provider requirements:

- Define typed request and response schemas as the source of truth.
- Support OpenAI-compatible chat/completions style providers.
- Include config that can target CLIProxyAPI.
- Keep provider off by default.
- Route model-backed provider calls through a server/API boundary. Browser components must never receive API keys, bearer tokens, or raw provider auth headers.
- Include fake-provider contract tests.
- Include optional live smoke guidance when CLIProxyAPI credentials and local proxy are available.

## Clip Status System

Status has two axes:

- Lifecycle: one dominant state per clip.
- Flags: independent stackable indicators.

There are 3 lifecycle states and 4 stackable flags.

| Indicator | Axis | Non-color encoding | Color role |
| --- | --- | --- | --- |
| Proposed | Lifecycle | Dashed border plus diamond glyph | Proposal orange |
| Kept | Lifecycle | Solid border plus check glyph | Signal green |
| Rejected | Lifecycle | Reduced opacity, strikethrough, x glyph | Muted neutral |
| Trimmed | Flag | Scissors glyph plus trim inset tick | Waveform cyan |
| Has-source-audio | Flag | Music-note glyph | Amber |
| Muted-in-mix | Flag | Muted music-note glyph | Muted neutral |
| Export-safe | Flag | Double-border plus square glyph | Bright export green |

The rail must be fully legible in grayscale. Status cannot be conveyed by color alone. Every cell has an accessible name and an on-focus label naming its lifecycle state and active flags.

Segment controls for the rail and grid:

- Proposed
- Kept
- Rejected
- Needs attention

Batch operations:

- Multi-select candidates through keyboard, shift selection, and pointer selection where practical.
- Batch keep, reject, apply.
- Bulk accept high-confidence Director proposals.
- Bulk reject below-threshold Director proposals.

## Audio Model

Audio has two layers:

1. Master / bed audio under the whole cut, with gain, mute, solo, and duck-under-bed.
2. Per-clip source audio, with per-clip gain, mute, and solo.

Waveforms are interactive surfaces for scrub, seek, trim in/out, and live playhead. They are not static decoration.

Audio status is split:

- Has-source-audio: the clip has an audio stream.
- Muted-in-mix: the clip has audio but is intentionally muted in the final mix.

Export-safe logic must distinguish these states. A silent clip may be intentional or a problem.

## Selection And Binding Model

Selection has one source of truth:

- Selecting a frame in the grid or strip loads it into both center preview and Inspector.
- Selecting a version in Draft Queue reloads the entire Clip Strip.
- Trim has exactly one owner: the trim waveform surface.
- Inspector trim inputs read and write the same trim model.
- Alternates and draft versions are different objects.

Definitions:

- Alternates / takes: attached to one clip, shown in Inspector stack, support A/B compare-and-swap.
- Draft versions: whole-project assemblies in Draft Queue.
- Director proposals: reviewable changesets that can create alternates or draft versions.

## Manual Editing Scope

Phase 1 manual editing includes:

- trim in/out,
- reorder,
- delete,
- per-clip volume,
- per-clip mute/solo,
- master/bed volume where a bed exists.

Phase 1 excludes:

- split,
- duplicate,
- speed,
- crop/reframe,
- captions,
- transcript editing,
- full multi-track editing.

## Visual Direction

The interface is dense, calm, and operator-first.

Concrete negatives:

- no hero,
- no nested cards,
- no decorative blobs,
- no decorative gradients,
- no persistent heavy shadows.

Hierarchy is built through background steps and one-pixel borders:

- canvas,
- panel,
- panel-raised,
- inset,
- overlay.

Region separation uses either one background step or one border, not both, except inset wells where the border intentionally creates the recessed read.

Exactly one ultra-soft shadow exists, reserved for transient surfaces only:

- drag ghost,
- popover,
- command palette,
- overlay.

Persistent regions do not cast shadows.

Selection is not orange. Active selection uses brightened border plus one background step. Orange is reserved for proposals.

Focus ring is its own visual language: 2px ring plus offset, with at least 3:1 contrast against canvas and panel. It may share the cyan hue with waveform tokens, but geometry differentiates focus from trim/audio state.

## Design Tokens

Components must reference semantic tokens, not primitives or hardcoded raw rgba values.

Color roles:

- Slate black canvas: app field.
- Panel slate: persistent regions.
- Panel-raised slate: one level up.
- Warm white: primary text.
- Muted/faint warm white: secondary and tertiary text.
- Render orange: proposed lifecycle only.
- Signal green: kept lifecycle.
- Bright green: export-safe flag.
- Cyan: trim, waveform played, focus ring geometry.
- Amber: has-source-audio, waveform peak warning, non-blocking export warning.
- True red: destructive and error states.

Typography:

- Font family: Inter or SF Pro/system sans fallback.
- Mono family: JetBrains Mono or ui-monospace fallback for timecodes and in/out fields.
- Compact operator scale: 11px captions, 12px interactive floor, 13-14px metadata and controls, 16px labels, 20px title, 24px max local heading.
- Letter spacing: 0 normally, 0.04em only for compact caps/status labels.

Spacing:

- 8px grid with 4px sub-unit.
- Rail cell gap/padding: 4px.
- Grid cell gap/padding: 8px.
- Panel padding: 16px.
- Region gap: 12px.
- Inspector row gap: 12px.
- Assemble audio lane height: about 40px.

Radius:

- 0, 3px, 5px, 8px, pill.
- Cards are not a primary layout metaphor.

Motion:

- 120ms fast, 180ms base, 260ms slow.
- Reduced motion makes transitions instant.
- Reduced motion disables hover-preview autoplay and playback easing.

Target sizes:

- Desktop min interactive target: 28px.
- Desktop comfortable: 32px.
- Mobile min: 44px.

Theming:

- Dark-only at launch.
- Token contract must not assume dark permanently.
- Border, scrim, and trim alphas route through semantic neutral alpha ramps.

## Keyboard Contract

Keyboard is the spec of record. Pointer and drag are convenience layers over it.

| Key | Action | Context |
| --- | --- | --- |
| J / K / L | Transport rewind / pause / play shuttle | Preview-focused transport contexts |
| Space | Play in place | Any clip cell |
| [ / ] | Set trim in / out at playhead | Preview / waveform |
| K | Keep current clip/proposal | Grid / strip non-transport contexts |
| Enter | Keep current clip/proposal | Focus / Loupe transport contexts |
| X | Reject current clip/proposal | Grid / strip / loupe |
| A | Apply proposal | Proposal focused |
| Arrow keys | Move selection | Grid / strip |
| Cmd/Ctrl + Enter | Load selection into center preview | Grid / strip |
| Alt/Cmd + Left/Right | Reorder selected clip | Strip |
| Cmd/Ctrl + K | Command palette | Global |
| F | Enter Focus / Loupe | Grid / strip |
| Esc | Exit Loupe / overlay / palette | Contextual |
| F6 | Cycle focus regions | Global |
| Tab | Next focus region | Global |

Collision resolution:

- In transport-active contexts, `K` means pause.
- In non-transport contexts, `K` means Keep.
- In Focus / Loupe, Keep is `Enter`.

Focus order:

1. Draft Queue / Director
2. Preview
3. Inspector
4. Clip Strip

Roving tabindex makes the rail and strip each one Tab stop. Arrow keys move within them.

After keep/reject/apply, selection auto-advances to the next undecided item in the current filtered set. This applies to candidate clips and Director proposals.

Keyboard reorder announces through a polite live region, for example: "Clip 3 moved to position 5 of 9."

## Accessibility

Target: WCAG 2.2 AA.

Acceptance requirements:

- Every status has a non-color channel.
- The rail is legible in grayscale.
- Every interactive element has a visible 2px focus ring with offset.
- Focus ring contrast is at least 3:1 on canvas and panel.
- Focus is never obscured.
- Reduced motion disables hover-preview autoplay, playback easing, and transition motion.
- Desktop targets are at least 24px and should generally be 28-32px.
- Mobile targets are 44px.
- Preview is a labelled region named "Clip preview."
- Transport buttons have accessible names.
- Waveform scrubber is exposed as a slider with `aria-valuetext` as timecode.
- Trim handles are paired sliders named "Trim in" and "Trim out."
- Clip cells expose accessible name, lifecycle state, and active flags.
- Status badges include text alternatives.
- Reorder, decisions, and auto-advance announce through a polite live region.

## Responsive And Mobile

Movie Maker is desktop-first.

Desktop constraints:

- Minimum desktop app width: 1024px.
- Minimum center preview width: 720px for 16:9 review.
- Below 1440px, right Inspector collapses to an icon rail and becomes overlay on demand.
- If center width is still below 720px, right Inspector drops fully.
- If center width is still below 720px, left column collapses to icon rail / overlay.
- At 1024px, both side columns may be collapsed/overlay and center owns the remaining width.

Mobile scope:

- In scope: view, review, status, keep/reject/apply triage, Director inbox.
- Swipe-to-cull is the preferred mobile interaction.
- Focus / Loupe is available at every width.
- Out of scope: trim, reorder, metadata editing, export configuration, and fine editing.

## Export Pre-Flight

Header Export is a gate, not a plain action.

Pre-flight reports:

- clips not export-safe,
- gaps in the cut,
- unresolved proposals,
- audio coverage,
- output format target,
- fallback state.

Gate logic:

- Unresolved proposals or any not-export-safe clip disables Export and shows a count.
- Non-blocking concerns, such as partial audio coverage, warn in amber but keep Export enabled.
- Clean state enables Export.
- Export readiness reflects the Clip Strip live.

Export-safe predicate:

- codec and container are valid,
- duration is greater than 0 and within bounds,
- audio intent is resolved through has-source-audio vs muted-in-mix,
- resolution matches target,
- local provenance is known.

Phase 1 does not add an external rights workflow. Export readiness only checks local provenance and user-visible source state.

Export requirements:

- MP4 is primary and must include audio when source mix has audio.
- WebM fallback remains available.
- FFmpeg core/runtime version must be verified during implementation. Do not preserve a stale hard-coded CDN version just because it exists in the current wrapper.
- Export shows progress.
- Export supports cancellation where technically possible.
- Export failures show a specific reason and recovery path.
- Export history is stored locally.
- A completed export should be validated enough to show whether audio was present in the output.

## Architecture

Split responsibilities into smaller units with typed interfaces.

Project model:

- local movie project,
- draft versions,
- clip alternates,
- Director proposals,
- export runs,
- local review notes.

Review state:

- current mode,
- selected clip/proposal,
- filters,
- triage queue,
- keep/reject/apply decisions.

Timeline model:

- committed Clip Strip order,
- trim in/out,
- transition slots,
- per-clip source audio,
- master/bed audio.

Media engine:

- playable media preparation,
- media element lifecycle,
- preview synchronization,
- source-audio detection,
- load/error/export-safe state.

Audio engine:

- preview mix,
- per-clip gain/mute/solo,
- master/bed gain/mute/ducking.

Export engine:

- MP4 primary with audio through FFmpeg-grade export,
- WebM fallback,
- progress,
- cancellation,
- validation,
- local export history.

Director engine:

- OpenAI-compatible provider adapter,
- CLIProxyAPI-compatible configuration,
- typed request/response schemas,
- rule-based fallback,
- proposal changesets,
- alternate local draft creation.

## Data Flow

```text
Vault assets + local overlays
  -> draft builder / Director proposal
  -> local alternate draft versions
  -> Review Bay triage decisions
  -> committed Clip Strip
  -> media/audio preview
  -> export pre-flight
  -> MP4/WebM export artifact
```

Hard boundary: Phase 1 is local. It does not write R2, D1, Worker repair state, processed IDs, live Grok, env files, or cloud project state.

## Error Handling

No committed Vault assets:

- show a recovery action to preview and commit Vault.

No eligible video clips:

- show active filter/scope and a recovery action.

Media load failure:

- mark the clip as needs attention,
- keep the last valid frame visible where possible,
- show failed-media reason in Inspector.

Audio detection failure:

- mark audio state unresolved,
- keep preview playable,
- block export-safe until user confirms muted intent or detection recovers.

Director provider missing:

- keep rule-based assembly available,
- show Director as local rules mode.

Director provider error:

- preserve current project state,
- show provider error,
- allow retry or rule-based fallback.

Invalid Director output:

- reject the proposal,
- show schema validation failure,
- do not apply partial changes.

Export pre-flight blocked:

- keep Export disabled,
- show exact blockers and linked clips.

Export failure:

- keep project state,
- keep export run record,
- offer retry, fallback WebM, or inspect blockers.

Partial local write failure:

- keep already-created local drafts,
- show which operation failed,
- do not hide partial results.

## Phases

### Phase 1: Review Bay Foundation

- Review / Triage, Focus / Loupe, and Assemble modes.
- Candidates Grid, committed Clip Strip, Draft Queue, Director tab, Inspector.
- Keyboard-first keep/reject/apply, auto-advance, and batch decisions.
- Trim, reorder, delete, per-clip volume/mute/solo.
- Source-audio detection and audible preview.
- Export pre-flight gate.
- MP4 export with audio and WebM fallback.
- Director proposals and alternate local drafts through OpenAI-compatible adapter.
- CLIProxyAPI compatibility.
- Rule-based fallback.
- Local versions and export history.
- Minimal time-anchored comments as Director re-prompt channel.

### Phase 2: Prompt Spine And Review Intelligence

- Prompt/source/date/favorite/visual grouping.
- Duplicate and similar-shot detection.
- Why-this-draft score cards.
- Draft A/B compare.
- More complete review notes.
- Better prompt metadata surfacing.

### Phase 3: Timeline Depth

- Richer waveform controls.
- Split and duplicate.
- Captions and transcript only where source speech exists.
- Crop and reframe.
- Speed controls.
- Multi-track audio refinement.

### Phase 4: Generative And Sharing

- Generative edit hooks only if provider/tooling exists.
- Cloud project sync only after local model stability.
- Share/review links only after export and versioning are reliable.

## Tests And Validation

Unit and contract tests:

- project, version, proposal, and export schemas validate and reject bad states.
- Director OpenAI-compatible request/response schemas.
- CLIProxyAPI-compatible config path with fake provider.
- proposal changeset diff.
- partial accept.
- alternate draft creation.
- export-safe predicate.
- trim/reorder/delete/volume reducers.
- audio-state flags.
- keyboard command mapping and collision resolution.

E2E and browser tests:

- load committed Vault data and open `/movie`.
- create or select a draft and triage with keyboard.
- move through Review, Focus, and Assemble modes.
- trim a clip.
- set volume.
- reorder.
- reject.
- keep.
- auto-advance.
- fake Director provider returns proposal.
- proposal previews.
- partial accept creates or updates local draft state.
- export pre-flight blocks unresolved unsafe state.
- export pre-flight warns on partial audio.
- export pre-flight enables clean export.
- MP4 export path succeeds with audio fixture.
- WebM fallback still works.
- mobile-width triage/review works.
- fine editing is hidden or disabled with clear UI on mobile.
- grayscale/status accessibility check.
- focus order, F6, roving tabindex, and live-region announcements.

Manual validation:

- Run against real local Vault data.
- Create multiple alternate drafts from real videos.
- Play with audio.
- Export MP4 and confirm it has an audio stream.
- Test WebM fallback.
- Inspect desktop width and mobile width.
- Confirm no R2, D1, processed-ID, live Grok, env, secret, or extension backup changes.

## Research Notes

Research patterns from current tools:

- Fast social editors push AI upstream into first-draft creation.
- Transcript editing is table stakes for spoken video, but Grok media should start with a prompt/source spine instead.
- Pro editors add AI without removing precision.
- Generative video editing is emerging as its own mode, but it is not the Phase 1 wedge.
- Review surfaces matter: frame-accurate scrub, versions, notes, and approval workflow are useful even without collaboration.
- Browser editors are credible, but export reliability is the common weak point.

The chosen approach is Contact Sheet Review Bay Plus. It keeps the strongest market lessons while staying specific to GrokPowerTools' differentiator: local review and export of R2-backed Grok saved-gallery media.

## Acceptance Criteria

- `/movie` presents a desktop-first Review Bay, not the current simple canvas editor.
- User can move through Review, Focus, and Assemble modes.
- User can triage candidate clips with keyboard keep/reject/apply.
- User can trim, reorder, delete, and set volume for committed clips.
- Clip Strip is the source of truth for committed order and status.
- Candidates Grid and Clip Strip remain separate typed surfaces.
- Director proposals are visible as reviewable changesets with rationale and confidence.
- Director can create alternate local drafts.
- Director cannot directly mutate the current cut.
- OpenAI-compatible provider adapter exists and is compatible with CLIProxyAPI configuration.
- Rule-based Director fallback works with no provider configured.
- Preview plays clips with audio when source audio exists and mix settings allow it.
- MP4 export with audio works on fixture media.
- WebM fallback remains available.
- Export pre-flight blocks unsafe state and warns on non-blocking concerns.
- Status rail is legible in grayscale.
- WCAG 2.2 AA acceptance points are covered.
- Mobile supports triage/review/status and hides fine editing clearly.
- Phase 1 does not write R2, D1, Worker repair state, processed IDs, live Grok state, env files, secrets, or cloud project state.
