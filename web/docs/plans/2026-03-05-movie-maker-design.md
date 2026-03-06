# Movie Maker — Design Document

**Date**: 2026-03-05
**Status**: Approved
**Route**: `/movie`

## Purpose

Sequence multiple Grok Imagine video clips into a cohesive movie with transitions and title cards. The player-first approach provides instant real-time preview via HTML5 Canvas compositing, with FFmpeg export planned as Phase B.

## Architecture: Canvas Player + FFmpeg Export

**Approach A** was chosen over FFmpeg-only rendering (too slow for iterative editing) and CSS transitions (unreliable crossfade timing).

- **Player**: Canvas `drawImage(video)` compositing with `requestAnimationFrame` render loop. Hidden `<video>` elements per clip. Transitions via `globalAlpha` blending. Title cards via `fillRect` + `fillText`.
- **Export (Phase B)**: FFmpeg.wasm `filter_complex` with `xfade` filters for transitions, `drawtext` for titles. The storyboard data model is the single source of truth for both paths.

## Data Model

```typescript
interface Movie {
  id: string;
  name: string;
  resolution: { w: number; h: number };  // e.g. 1080x1920
  clips: MovieClip[];
  createdAt: string;
  updatedAt: string;
}

interface MovieClip {
  id: string;
  type: "video" | "title";
  // Video clips
  videoUrl?: string;
  sourceCollectionId?: string;
  trimStart?: number;       // seconds
  trimEnd?: number;         // seconds
  // Title cards
  titleText?: string;
  titleSubtext?: string;
  titleDuration?: number;   // seconds (default 3)
  titleBgColor?: string;    // default black
  titleTextColor?: string;  // default white
  // Shared
  transition: Transition;   // transition INTO this clip
  position: number;
}

interface Transition {
  type: "cut" | "fade" | "crossfade";
  duration: number;  // seconds — 0 for cut, 0.3-2.0 for fade/crossfade
}
```

Movies persist in IndexedDB alongside collections via a new `movies` object store.

## Page Layout

Two-panel hybrid: storyboard + preview, with timeline strip at bottom.

```
+--[Header: Movie name + controls]------------------+
|                                                     |
|  +--[Storyboard Panel]--+  +--[Preview Panel]----+ |
|  | Clip 1 (video card)  |  |                     | |
|  |   v transition: fade |  |   [Canvas Player]   | |
|  | Clip 2 (title card)  |  |   9:16 or 16:9      | |
|  |   v transition: xfade|  |                     | |
|  | Clip 3 (video card)  |  |  > ||  0:12 / 0:45  | |
|  |   + Add clip button  |  +---------------------+ |
|  +---[drag to reorder]--+                           |
|                                                     |
+--[Timeline Strip]----------------------------------+
|  [====|>>>>>|===|>>>>>>>>|===]  0:45 total         |
+-----------------------------------------------------+
```

**Fullscreen preview mode**: Toggle expands Canvas to fill viewport with auto-hiding overlay controls (reuses FullscreenViewer's auto-hide pattern).

## Components

| Component | File | Purpose |
|-----------|------|---------|
| MovieMaker | `components/movie/MovieMaker.tsx` | Page orchestrator — owns movie state |
| StoryboardPanel | `components/movie/StoryboardPanel.tsx` | Vertical clip list, @dnd-kit drag-to-reorder |
| StoryboardClipCard | `components/movie/StoryboardClipCard.tsx` | Clip card — thumbnail, duration, remove |
| TitleCardEditor | `components/movie/TitleCardEditor.tsx` | Inline text/color/duration editor |
| TransitionPicker | `components/movie/TransitionPicker.tsx` | Type + duration selector between clips |
| CanvasPlayer | `components/movie/CanvasPlayer.tsx` | Real-time movie preview — Canvas render loop |
| MovieTimeline | `components/movie/MovieTimeline.tsx` | Horizontal timeline strip |
| ClipSourcePicker | `components/movie/ClipSourcePicker.tsx` | Modal: import from collections / paste URL / add title |

## Canvas Player Design

### Render Loop

```
requestAnimationFrame:
  1. Compute globalTime from playback start + elapsed
  2. Map globalTime to active clip(s) via cumulative durations
  3. If in transition zone:
     - Compute blend factor (0 -> 1) over transition duration
     - Draw outgoing clip at alpha = 1 - factor
     - Draw incoming clip at alpha = factor
  4. If single clip active:
     - Draw clip at alpha = 1
  5. Title cards: fillRect(bgColor) + fillText(text, center)
  6. Update timeline playhead position
```

### Timeline Position Mapping

Each clip contributes `effectiveDuration = clipDuration - transitionOverlap` to total movie length. Crossfade means last N seconds of clip A overlap with first N seconds of clip B.

```
Clip A (5s) --[xfade 1s]-- Clip B (4s) --[cut]-- Title (3s)
Total: 5 + 4 + 3 - 1 = 11s
```

### Preloading Strategy

Grok videos are small (2-5MB). Preload all clips on mount for movies under 10 clips. For larger movies, use sliding window (current +/- 2 clips).

### Fullscreen Mode

Toggle button expands Canvas to `fixed inset-0 z-50`. Overlay controls (play/pause, timeline scrubber, exit) auto-hide after 3 seconds of no mouse movement. Reuses the same pattern as FullscreenViewer.

## Clip Source Flow

"Add Clip" button opens ClipSourcePicker modal with three tabs:
1. **Collections** — browse saved collections, click videos to add
2. **Paste URL** — paste a Grok video URL directly
3. **Title Card** — create a new title card inline

Each video clip card shows thumbnail + duration. Clicking opens `/edit` in new tab for trim/crop.

## Persistence

- New IndexedDB object store: `movies`
- Same `idb` library pattern as collections in `local-storage.ts`
- Auto-save on every edit (debounced)
- Movie list on `/movie` page with create/rename/delete

## Implementation Phases

### Phase A (this sprint) — Player + Storyboard
- MovieMaker page orchestrator with state management
- StoryboardPanel with clip cards and @dnd-kit reorder
- StoryboardClipCard for video and title clips
- TitleCardEditor for inline title creation
- TransitionPicker between clips
- CanvasPlayer with render loop, transitions, title rendering
- MovieTimeline strip
- ClipSourcePicker modal (collections + paste URL + title)
- Fullscreen preview mode
- IndexedDB persistence (movies store)
- Movie list page with CRUD

### Phase B (later) — Export + Integration
- FFmpeg filter_complex export to MP4
- Clip inline trim (round-trip to /edit)
- Movie sharing via URL (base64url like collections)
- "Add to Movie" button on VideoCard
- Audio/music track support

## Key Technical Decisions

- **Canvas over CSS transitions**: Full control over compositing, frame-accurate blending, extensible to future effects
- **Hidden video elements**: Each clip has its own `<video>` element managed by CanvasPlayer. Videos are preloaded and seeked to trim start before playback.
- **Single source of truth**: The `Movie` data model drives both the Canvas player and future FFmpeg export. No divergent state.
- **@dnd-kit for reordering**: Consistent with collections workspace pattern
- **No external state lib**: All state in MovieMaker.tsx via useState, same pattern as ClipEditor
