# Collection Watch Mode - Design

**Date**: 2026-05-19
**Status**: Approved in chat; pending written spec review
**Primary surface**: `web/src/components/collections/CollectionView.tsx`
**Viewer surface**: `web/src/components/video/FullscreenViewer.tsx`
**Movie surface**: `web/src/components/movie/*`

## Purpose

Add a collection-first Watch Mode so a user can watch many saved Grok Imagine videos continuously without opening each card one by one. The first version should feel like a lightweight playlist: start from a collection, watch every playable video in order, optionally skim large batches, and save the current queue as a Movie Maker compilation.

## Scope

V1 includes:

- `Watch All` from a collection header.
- `Watch Selected` from the existing bulk action bar.
- Continuous queue playback in the fullscreen viewer.
- Natural playback, where each video advances when it ends.
- Skim playback, where each video advances after a selected interval such as 5, 10, or 15 seconds.
- `Save as Movie`, which persists the active queue as a new Movie Maker timeline.

V1 does not include:

- A separate dashboard-wide "Watch Library" hub.
- A new standalone watch route.
- Queue loop behavior.
- Advanced generated-movie options such as title cards, music, trim controls, or export settings.

## User Flow

In `CollectionView`, the collection header gets a `Watch All` action. It filters the current collection to items with a valid `videoUrl`, preserves collection order, and opens the fullscreen viewer at the first playable item.

The existing multi-select flow remains explicit. `Watch All` always means the whole playable collection. When multi-select mode has selected items, the bulk action bar adds `Watch Selected`. That action builds a queue from the selected playable items, sorted by their current collection order rather than click order, and opens the same viewer.

Inside the viewer, playback defaults to natural mode. The user can switch to skim mode and choose an interval. Existing viewer actions remain available where useful: previous/next, play/pause, prompt info, copy prompt, download, open on Grok, and close. The viewer adds a visible `Save as Movie` action.

## Architecture

The feature should be split into three small responsibilities.

### Queue Construction

`CollectionView` owns collection-specific queue construction:

- `Watch All`: `displayItems.filter((item) => item.videoUrl)`.
- `Watch Selected`: `displayItems.filter((item) => selectedIds.has(item.id) && item.videoUrl)`.
- Empty playable queues show a toast and do not open the viewer.

The viewer should receive the already-built queue and optional context such as the source collection name and source collection id. This keeps selection and collection ordering rules out of the viewer.

### Queue-Aware Viewer

`FullscreenViewer` should become queue-aware rather than creating a separate duplicate component. It already owns full-screen playback state, keyboard handling, overlay controls, current index, and prompt actions, so it is the right place for continuous playback behavior.

The viewer should support:

- Natural mode: advance from the active video to the next queue item on the video `ended` event.
- Skim mode: start or reset a timer when the active video changes, then advance after the selected interval.
- Manual previous/next controls that reset skim timing.
- Existing keyboard shortcuts: `Esc` closes, arrow keys navigate, space toggles play/pause, `i` toggles info.

The component should be refactored only as much as needed to keep watch-specific state readable. The goal is to avoid a parallel viewer while also avoiding a single overloaded block of special cases.

### Movie Creation Helper

Movie persistence should live in a small helper, not inside viewer JSX. The helper converts a `VideoItem[]` queue into a new `Movie` and saves it through the existing IndexedDB movie APIs.

Generated movie defaults:

- Name: `<Collection Name> Compilation` for `Watch All`.
- Name: `<Collection Name> Selection` for `Watch Selected`.
- Resolution: existing default movie resolution, `1080x1920`.
- One video `MovieClip` per queue item.
- First clip transition: `{ type: "cut", duration: 0 }`.
- Subsequent clip transitions: `{ type: "crossfade", duration: 0.5 }`.
- `videoUrl` copied from each queue item.
- `sourceCollectionId` set when the queue came from a saved collection.

After saving, the app navigates to `/movie?id=<newMovieId>`.

## Edge Cases

- Items without `videoUrl` are skipped.
- If every item is skipped, the app shows a toast.
- If the active video errors during playback, the viewer should surface the failure and allow manual next. Automatic skip-on-error can be added later if needed.
- At the final queue item, natural and skim playback stop on the final video. Queue looping is out of scope for V1.
- Current-video loop remains a per-video behavior only if retained. It must not prevent natural queue advancement when Watch Mode is active.
- `Save as Movie` should be disabled or show a toast if the active queue is empty.

## Testing And Validation

Unit or component-level checks should cover:

- `Watch All` opens only playable videos and preserves collection order.
- `Watch Selected` opens only selected playable videos and preserves collection order.
- Empty queues show a toast and do not open the viewer.
- Natural mode advances on the active video `ended` event.
- Skim mode advances after the selected interval and resets when the user manually changes videos.
- `Save as Movie` persists one clip per queue item, uses crossfade transitions after the first clip, and routes to Movie Maker.

Browser validation should cover:

- Load a collection with example videos.
- Click `Watch All`.
- Confirm playback starts, previous/next work, natural mode advances, and skim mode advances.
- Click `Save as Movie` and confirm the new movie opens in Movie Maker with the expected clip count and crossfade defaults.
- Select a subset, click `Watch Selected`, and confirm the queue count and order match the selected cards in collection order.

## Implementation Notes

- Prefer existing UI components and lucide icons.
- Keep `Watch All` in the collection header and `Watch Selected` in `BulkActionBar` so their meanings stay explicit.
- Reuse the existing toast system in `CollectionView`.
- Do not change export behavior in Movie Maker as part of this feature.
