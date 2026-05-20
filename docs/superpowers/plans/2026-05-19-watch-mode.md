# Collection Watch Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add collection-first Watch Mode so saved Grok Imagine videos can be watched continuously, skimmed, and saved as a crossfade Movie Maker compilation.

**Architecture:** Keep queue construction in `CollectionView`, playback behavior in the existing `FullscreenViewer`, and movie persistence in a small helper under `web/src/lib`. `implementation-notes.html` is maintained as a running implementation log and committed alongside implementation changes.

**Tech Stack:** Next.js 16, React 19, TypeScript, IndexedDB via `idb`, Playwright browser regression tests, existing root Jest for non-web extension tests.

---

## Scope Check

The approved spec covers one connected subsystem: collection watch playback plus conversion of the active watch queue into a Movie Maker timeline. It does not need to be split into separate specs.

## File Structure

- Create: `implementation-notes.html`
  Running implementation log for spec interpretations, deviations, tradeoffs, and open questions.
- Create: `web/src/lib/watch-mode.ts`
  Pure queue filtering helpers plus movie creation helpers. This keeps persistence and generated transition defaults out of React JSX.
- Modify: `web/src/components/video/FullscreenViewer.tsx`
  Extend the existing viewer into a queue-aware Watch Mode while preserving normal per-card fullscreen behavior.
- Modify: `web/src/components/collections/CollectionView.tsx`
  Build Watch All and Watch Selected queues, handle empty queue toasts, pass queue context into the viewer, and route after movie creation.
- Modify: `web/src/components/collections/BulkActionBar.tsx`
  Add `Watch Selected` as an explicit bulk action.
- Create: `playwright.web.config.js`
  Separate Playwright config for the Next.js web app so existing extension E2E config stays untouched.
- Create: `tests/e2e-web/watch-mode.spec.js`
  Browser regression coverage for Watch All, Watch Selected, playable-only queue filtering, and Save as Movie persistence.

## Task 1: Add Implementation Notes And Watch Queue Helper

**Files:**
- Create: `implementation-notes.html`
- Create: `web/src/lib/watch-mode.ts`

- [ ] **Step 1: Create the running implementation notes file**

Create `implementation-notes.html` with this exact content:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Collection Watch Mode Implementation Notes</title>
    <style>
      body {
        margin: 0;
        background: #f8fafc;
        color: #111827;
        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        line-height: 1.5;
      }

      main {
        max-width: 960px;
        margin: 0 auto;
        padding: 32px 20px 48px;
      }

      h1 {
        margin: 0 0 8px;
        font-size: 28px;
      }

      h2 {
        margin-top: 28px;
        font-size: 18px;
      }

      table {
        width: 100%;
        border-collapse: collapse;
        background: #ffffff;
        border: 1px solid #e5e7eb;
      }

      th,
      td {
        padding: 10px 12px;
        border-bottom: 1px solid #e5e7eb;
        text-align: left;
        vertical-align: top;
        font-size: 14px;
      }

      th {
        background: #f3f4f6;
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }

      code {
        background: #eef2ff;
        padding: 2px 4px;
        border-radius: 4px;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>Collection Watch Mode Implementation Notes</h1>
      <p>
        This file records implementation decisions, deviations, tradeoffs, and open questions for
        <code>docs/superpowers/specs/2026-05-19-watch-mode-design.md</code>.
      </p>

      <h2>Running Notes</h2>
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Type</th>
            <th>Note</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>2026-05-19</td>
            <td>Design decision</td>
            <td>
              The implementation will keep Watch Mode inside the existing <code>FullscreenViewer</code>
              and put queue/movie helpers in <code>web/src/lib/watch-mode.ts</code>, matching the approved spec.
            </td>
          </tr>
        </tbody>
      </table>

      <h2>Open Questions</h2>
      <p>No open questions at plan start.</p>
    </main>
  </body>
</html>
```

- [ ] **Step 2: Create the watch queue and movie helper**

Create `web/src/lib/watch-mode.ts` with this exact content:

```ts
import type { Movie, MovieClip, VideoItem } from "./types";
import { createMovie, updateMovie } from "./local-storage";

export type WatchQueueKind = "compilation" | "selection";

export interface CreateMovieFromWatchQueueInput {
  queue: VideoItem[];
  collectionName: string;
  kind: WatchQueueKind;
  sourceCollectionId?: string;
}

export function getPlayableQueue(items: VideoItem[]): VideoItem[] {
  return items.filter((item) => Boolean(item.videoUrl));
}

export function getSelectedPlayableQueue(
  items: VideoItem[],
  selectedIds: Set<string>
): VideoItem[] {
  return items.filter((item) => selectedIds.has(item.id) && Boolean(item.videoUrl));
}

export function getWatchMovieName(
  collectionName: string,
  kind: WatchQueueKind
): string {
  const baseName = collectionName.trim() || "Untitled Collection";
  return `${baseName} ${kind === "selection" ? "Selection" : "Compilation"}`;
}

export function buildMovieClipsFromQueue(
  queue: VideoItem[],
  sourceCollectionId?: string,
  createId: () => string = () => crypto.randomUUID()
): MovieClip[] {
  return queue.map((item, index) => ({
    id: createId(),
    type: "video",
    videoUrl: item.videoUrl,
    ...(sourceCollectionId ? { sourceCollectionId } : {}),
    transition: index === 0
      ? { type: "cut", duration: 0 }
      : { type: "crossfade", duration: 0.5 },
    position: index,
  }));
}

export async function createMovieFromWatchQueue({
  queue,
  collectionName,
  kind,
  sourceCollectionId,
}: CreateMovieFromWatchQueueInput): Promise<Movie> {
  if (queue.length === 0) {
    throw new Error("Cannot create a movie from an empty watch queue.");
  }

  const movie = await createMovie(getWatchMovieName(collectionName, kind));
  const updated: Movie = {
    ...movie,
    clips: buildMovieClipsFromQueue(queue, sourceCollectionId),
  };

  return updateMovie(updated);
}
```

- [ ] **Step 3: Run type and build verification**

Run:

```bash
npm --prefix web run build
```

Expected: `next build` completes successfully.

- [ ] **Step 4: Commit the helper and notes foundation**

```bash
git add implementation-notes.html web/src/lib/watch-mode.ts
git commit -m "feat(web): add watch mode queue helpers"
```

## Task 2: Add Web Playwright Regression Coverage

**Files:**
- Create: `playwright.web.config.js`
- Create: `tests/e2e-web/watch-mode.spec.js`
- Modify: `implementation-notes.html`

- [ ] **Step 1: Add a dedicated web Playwright config**

Create `playwright.web.config.js` with this exact content:

```js
// playwright.web.config.js
// @ts-check
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
    testDir: './tests/e2e-web',
    fullyParallel: false,
    timeout: 90000,
    reporter: 'list',
    use: {
        baseURL: 'http://127.0.0.1:3001',
        trace: 'on-first-retry',
    },
    webServer: {
        command: 'npm --prefix web run dev',
        url: 'http://127.0.0.1:3001',
        reuseExistingServer: true,
        timeout: 120000,
    },
    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] },
        },
    ],
});
```

- [ ] **Step 2: Add Watch Mode browser tests**

Create `tests/e2e-web/watch-mode.spec.js` with this exact content:

```js
const { test, expect } = require('@playwright/test');

const collection = {
    id: 'watch-mode-test-collection',
    name: 'Watch Mode Test',
    description: '',
    status: 'active',
    aspectRatioOverride: null,
    createdAt: '2026-05-19T00:00:00.000Z',
    updatedAt: '2026-05-19T00:00:00.000Z',
    items: [
        {
            id: 'video-1',
            grokPostId: 'video-1',
            sourceUrl: 'https://grok.com/imagine/post/video-1',
            videoUrl: 'https://example.com/video-1.mp4',
            thumbnailUrl: '',
            promptText: 'First playable prompt',
            position: 0,
            notes: '',
            createdAt: '2026-05-19T00:00:00.000Z',
        },
        {
            id: 'video-empty',
            grokPostId: 'video-empty',
            sourceUrl: 'https://grok.com/imagine/post/video-empty',
            videoUrl: '',
            thumbnailUrl: '',
            promptText: 'Missing video URL prompt',
            position: 1,
            notes: '',
            createdAt: '2026-05-19T00:00:00.000Z',
        },
        {
            id: 'video-2',
            grokPostId: 'video-2',
            sourceUrl: 'https://grok.com/imagine/post/video-2',
            videoUrl: 'https://example.com/video-2.mp4',
            thumbnailUrl: '',
            promptText: 'Second playable prompt',
            position: 2,
            notes: '',
            createdAt: '2026-05-19T00:00:00.000Z',
        },
        {
            id: 'video-3',
            grokPostId: 'video-3',
            sourceUrl: 'https://grok.com/imagine/post/video-3',
            videoUrl: 'https://example.com/video-3.mp4',
            thumbnailUrl: '',
            promptText: 'Third playable prompt',
            position: 3,
            notes: '',
            createdAt: '2026-05-19T00:00:00.000Z',
        },
    ],
};

async function resetDatabase(page) {
    await page.goto('/');
    await page.evaluate(async () => {
        await new Promise((resolve, reject) => {
            const request = indexedDB.deleteDatabase('grok-power-tools');
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
            request.onblocked = () => resolve();
        });
    });
}

async function seedCollection(page) {
    await resetDatabase(page);
    await page.evaluate(async (seedCollection) => {
        const db = await new Promise((resolve, reject) => {
            const request = indexedDB.open('grok-power-tools', 3);

            request.onupgradeneeded = () => {
                const db = request.result;

                if (!db.objectStoreNames.contains('collections')) {
                    const collectionStore = db.createObjectStore('collections', { keyPath: 'id' });
                    collectionStore.createIndex('by-status', 'status');
                    collectionStore.createIndex('by-updated', 'updatedAt');
                }

                if (!db.objectStoreNames.contains('settings')) {
                    db.createObjectStore('settings');
                }

                if (!db.objectStoreNames.contains('movies')) {
                    const movieStore = db.createObjectStore('movies', { keyPath: 'id' });
                    movieStore.createIndex('by-updated', 'updatedAt');
                }

                if (!db.objectStoreNames.contains('prompts')) {
                    const promptStore = db.createObjectStore('prompts', { keyPath: 'id' });
                    promptStore.createIndex('by-created', 'createdAt');
                }

                if (!db.objectStoreNames.contains('sync_meta')) {
                    db.createObjectStore('sync_meta');
                }
            };

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });

        const tx = db.transaction('collections', 'readwrite');
        tx.objectStore('collections').put(seedCollection);
        await new Promise((resolve, reject) => {
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
        db.close();
    }, collection);

    await page.goto(`/collections/${collection.id}`);
}

async function getMovies(page) {
    return page.evaluate(async () => {
        const db = await new Promise((resolve, reject) => {
            const request = indexedDB.open('grok-power-tools', 3);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });

        const tx = db.transaction('movies', 'readonly');
        const movies = await new Promise((resolve, reject) => {
            const request = tx.objectStore('movies').getAll();
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
        db.close();
        return movies;
    });
}

test.describe('Collection Watch Mode', () => {
    test('Watch All opens playable videos only and saves a crossfade movie', async ({ page }) => {
        await seedCollection(page);

        await page.getByRole('button', { name: /Watch All/i }).click();

        await expect(page.getByText('Watch Mode')).toBeVisible();
        await expect(page.getByText('1 / 3')).toBeVisible();

        await page.getByRole('button', { name: /Next/i }).click();
        await expect(page.getByText('2 / 3')).toBeVisible();

        await page.getByRole('button', { name: /Save as Movie/i }).click();
        await expect(page).toHaveURL(/\/movie\?id=/);

        const movies = await getMovies(page);
        expect(movies).toHaveLength(1);
        expect(movies[0].name).toBe('Watch Mode Test Compilation');
        expect(movies[0].clips).toHaveLength(3);
        expect(movies[0].clips[0].transition).toEqual({ type: 'cut', duration: 0 });
        expect(movies[0].clips[1].transition).toEqual({ type: 'crossfade', duration: 0.5 });
        expect(movies[0].clips[2].transition).toEqual({ type: 'crossfade', duration: 0.5 });
    });

    test('Watch Selected uses selected playable videos in collection order', async ({ page }) => {
        await seedCollection(page);

        await page.getByRole('button', { name: /^Select$/i }).click();
        await page.getByText('Third playable prompt').click();
        await page.getByText('First playable prompt').click();
        await page.getByRole('button', { name: /Watch Selected/i }).click();

        await expect(page.getByText('Watch Mode')).toBeVisible();
        await expect(page.getByText('1 / 2')).toBeVisible();
        await page.getByRole('button', { name: /Prompt info/i }).click();
        await expect(page.getByText('First playable prompt')).toBeVisible();

        await page.getByRole('button', { name: /Next/i }).click();
        await expect(page.getByText('2 / 2')).toBeVisible();
        await expect(page.getByText('Third playable prompt')).toBeVisible();
    });
});
```

- [ ] **Step 3: Run the red browser checkpoint**

Run:

```bash
npx playwright test -c playwright.web.config.js
```

Expected: FAIL because `Watch All` and `Watch Selected` do not exist yet.

- [ ] **Step 4: Update implementation notes**

Append this table row inside the `<tbody>` in `implementation-notes.html`:

```html
          <tr>
            <td>2026-05-19</td>
            <td>Tradeoff</td>
            <td>
              Added a separate <code>playwright.web.config.js</code> instead of changing the existing
              extension E2E config, so extension tests keep their current browser setup.
            </td>
          </tr>
```

- [ ] **Step 5: Leave the red test uncommitted until the implementation is green**

Run:

```bash
git status --short
```

Expected: `playwright.web.config.js`, `tests/e2e-web/watch-mode.spec.js`, and `implementation-notes.html` are modified or untracked.

## Task 3: Make FullscreenViewer Queue-Aware

**Files:**
- Modify: `web/src/components/video/FullscreenViewer.tsx`
- Modify: `implementation-notes.html`

- [ ] **Step 1: Replace the props and playback state declarations**

In `web/src/components/video/FullscreenViewer.tsx`, add `Film` to the lucide import list and replace the props interface plus initial state block with this code:

```tsx
type PlaybackMode = "manual" | "natural" | "skim";

const SKIM_INTERVALS = [5, 10, 15];

interface FullscreenViewerProps {
  items: VideoItem[];
  startIndex: number;
  onClose: () => void;
  sourceName?: string;
  watchMode?: boolean;
  onSaveAsMovie?: (queue: VideoItem[]) => Promise<void>;
}

export default function FullscreenViewer({
  items,
  startIndex,
  onClose,
  sourceName,
  watchMode = false,
  onSaveAsMovie,
}: FullscreenViewerProps) {
  const [currentIndex, setCurrentIndex] = useState(startIndex);
  const [isPlaying, setIsPlaying] = useState(true);
  const [playbackMode, setPlaybackMode] = useState<PlaybackMode>(
    watchMode ? "natural" : "manual"
  );
  const [skimInterval, setSkimInterval] = useState(10);
  const [loopVideo, setLoopVideo] = useState(!watchMode);
  const [showInfo, setShowInfo] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [videoError, setVideoError] = useState(false);
  const [isSavingMovie, setIsSavingMovie] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const skimTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
```

- [ ] **Step 2: Replace navigation helpers with watch-mode clamping**

Replace the existing `goTo`, `goNext`, and `goPrev` declarations with:

```tsx
  const goTo = useCallback(
    (index: number) => {
      if (items.length === 0) return;

      const nextIndex = watchMode
        ? Math.max(0, Math.min(index, items.length - 1))
        : ((index % items.length) + items.length) % items.length;

      setCurrentIndex(nextIndex);
      setIsPlaying(true);
      setVideoError(false);
    },
    [items.length, watchMode]
  );

  const goNext = useCallback(() => {
    if (watchMode && currentIndex >= items.length - 1) {
      setIsPlaying(false);
      videoRef.current?.pause();
      return;
    }

    goTo(currentIndex + 1);
  }, [currentIndex, goTo, items.length, watchMode]);

  const goPrev = useCallback(() => goTo(currentIndex - 1), [currentIndex, goTo]);
```

- [ ] **Step 3: Replace slideshow timing with skim timing**

Delete the old `slideshowActive` timer effect and add this effect after the auto-play effect:

```tsx
  useEffect(() => {
    if (!watchMode || playbackMode !== "skim" || !isPlaying) return;

    clearTimeout(skimTimerRef.current);
    skimTimerRef.current = setTimeout(goNext, skimInterval * 1000);

    return () => clearTimeout(skimTimerRef.current);
  }, [watchMode, playbackMode, skimInterval, currentIndex, isPlaying, goNext]);
```

- [ ] **Step 4: Add ended/error/save handlers**

Add these functions after `handleDownload()`:

```tsx
  function handleVideoEnded() {
    if (watchMode && playbackMode === "natural") {
      goNext();
    }
  }

  async function handleSaveAsMovie() {
    if (!onSaveAsMovie || items.length === 0) return;
    setIsSavingMovie(true);
    try {
      await onSaveAsMovie(items);
    } finally {
      setIsSavingMovie(false);
    }
  }
```

- [ ] **Step 5: Update the video element**

Change the `<video>` attributes so Watch Mode can receive `ended` events:

```tsx
      <video
        ref={videoRef}
        src={currentItem.videoUrl}
        className="h-full w-full object-contain"
        loop={!watchMode && loopVideo}
        muted={false}
        playsInline
        autoPlay
        onClick={togglePlay}
        onEnded={handleVideoEnded}
        onError={() => setVideoError(true)}
      />
```

- [ ] **Step 6: Add accessible labels to previous and next buttons**

Update the left navigation button:

```tsx
            <button
              type="button"
              onClick={goPrev}
              aria-label="Previous"
              className="absolute left-4 top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-3 text-white/80 backdrop-blur-sm transition hover:bg-white/20 hover:text-white"
            >
              <ChevronLeft className="h-6 w-6" />
            </button>
```

Update the right navigation button:

```tsx
            <button
              type="button"
              onClick={goNext}
              aria-label="Next"
              className="absolute right-4 top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-3 text-white/80 backdrop-blur-sm transition hover:bg-white/20 hover:text-white"
            >
              <ChevronRight className="h-6 w-6" />
            </button>
```

- [ ] **Step 7: Update the top bar labels**

In the top bar left label area, replace the existing count-only block with:

```tsx
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-white/90">
              {currentIndex + 1} / {items.length}
            </span>
            {watchMode && (
              <span className="rounded-full bg-orange-500/20 px-2 py-0.5 text-xs font-medium text-orange-400">
                Watch Mode
              </span>
            )}
            {sourceName && (
              <span className="max-w-[40vw] truncate text-xs text-white/60">
                {sourceName}
              </span>
            )}
            {videoError && (
              <span className="rounded-full bg-red-500/20 px-2 py-0.5 text-xs font-medium text-red-300">
                Video failed to load
              </span>
            )}
          </div>
```

- [ ] **Step 8: Replace the playback controls**

In the bottom control row, keep the play/pause button. Replace the old slideshow button, interval select, and loop control with this conditional block after the play/pause button:

```tsx
              {watchMode ? (
                <>
                  <button
                    type="button"
                    onClick={() => setPlaybackMode("natural")}
                    className={`rounded-lg px-3 py-2 text-sm transition ${
                      playbackMode === "natural"
                        ? "bg-orange-500/20 text-orange-400"
                        : "bg-white/10 text-white/70 hover:bg-white/20 hover:text-white"
                    }`}
                  >
                    Natural
                  </button>
                  <button
                    type="button"
                    onClick={() => setPlaybackMode("skim")}
                    className={`rounded-lg px-3 py-2 text-sm transition ${
                      playbackMode === "skim"
                        ? "bg-orange-500/20 text-orange-400"
                        : "bg-white/10 text-white/70 hover:bg-white/20 hover:text-white"
                    }`}
                  >
                    Skim
                  </button>
                  {playbackMode === "skim" && (
                    <select
                      value={skimInterval}
                      onChange={(e) => setSkimInterval(Number(e.target.value))}
                      className="ml-2 rounded bg-white/10 px-2 py-1.5 text-sm text-white/80 backdrop-blur-sm"
                      aria-label="Skim interval"
                    >
                      {SKIM_INTERVALS.map((seconds) => (
                        <option key={seconds} value={seconds}>
                          {seconds}s
                        </option>
                      ))}
                    </select>
                  )}
                </>
              ) : (
                <ControlButton
                  icon={Repeat}
                  label={`Loop ${loopVideo ? "ON" : "OFF"} (L)`}
                  onClick={() => setLoopVideo((v) => !v)}
                  active={loopVideo}
                />
              )}
```

- [ ] **Step 9: Add Save as Movie control**

In the right-side controls, before the prompt info button, add:

```tsx
              {watchMode && onSaveAsMovie && (
                <button
                  type="button"
                  onClick={handleSaveAsMovie}
                  disabled={isSavingMovie || items.length === 0}
                  className="inline-flex items-center gap-2 rounded-lg bg-white/10 px-3 py-2 text-sm text-white/80 transition hover:bg-white/20 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Film className="h-4 w-4" />
                  {isSavingMovie ? "Saving..." : "Save as Movie"}
                </button>
              )}
```

- [ ] **Step 10: Update keyboard shortcuts**

In the keyboard shortcut switch, change the `s` case to:

```tsx
        case "s":
          if (watchMode) {
            setPlaybackMode((mode) => (mode === "skim" ? "natural" : "skim"));
          }
          break;
```

Keep the `l` case only for non-watch mode:

```tsx
        case "l":
          if (!watchMode) {
            setLoopVideo((v) => !v);
          }
          break;
```

- [ ] **Step 11: Update the keyboard hint**

Replace the hint text with:

```tsx
          <div className="mt-2 text-center text-xs text-white/30">
            Arrow keys: navigate &middot; Space: play/pause &middot; {watchMode ? "S: skim/natural" : "L: loop"} &middot; I: info &middot; Esc: close
          </div>
```

- [ ] **Step 12: Update implementation notes**

Append this row inside the notes `<tbody>`:

```html
          <tr>
            <td>2026-05-19</td>
            <td>Design decision</td>
            <td>
              Watch Mode clamps previous/next at queue boundaries and disables per-video looping so natural playback
              can advance on <code>ended</code>. The non-watch fullscreen viewer keeps its existing wraparound and loop behavior.
            </td>
          </tr>
```

- [ ] **Step 13: Run build verification**

Run:

```bash
npm --prefix web run build
```

Expected: `next build` completes successfully.

- [ ] **Step 14: Commit the viewer change**

```bash
git add web/src/components/video/FullscreenViewer.tsx implementation-notes.html
git commit -m "feat(web): add queue-aware fullscreen watch mode"
```

## Task 4: Wire Watch All, Watch Selected, And Save As Movie

**Files:**
- Modify: `web/src/components/collections/CollectionView.tsx`
- Modify: `web/src/components/collections/BulkActionBar.tsx`
- Modify: `implementation-notes.html`

- [ ] **Step 1: Update BulkActionBar props and imports**

In `web/src/components/collections/BulkActionBar.tsx`, add `Play` to the lucide import and add `onWatchSelected` to the props:

```tsx
import { Trash2, Download, ClipboardCopy, XCircle, Play } from "lucide-react";
```

```tsx
interface BulkActionBarProps {
  selectedCount: number;
  onWatchSelected: () => void;
  onDelete: () => void;
  onDownload: () => void;
  onCopyLinks: () => void;
  onDeselectAll: () => void;
}
```

Update the function signature:

```tsx
export default function BulkActionBar({
  selectedCount,
  onWatchSelected,
  onDelete,
  onDownload,
  onCopyLinks,
  onDeselectAll,
}: BulkActionBarProps) {
```

- [ ] **Step 2: Add the Watch Selected button**

In `BulkActionBar`, insert this button after the selected count divider and before `Copy Links`:

```tsx
        <Button variant="ghost" size="sm" onClick={onWatchSelected}>
          <Play className="h-3.5 w-3.5" />
          Watch Selected
        </Button>
```

- [ ] **Step 3: Update CollectionView imports**

In `web/src/components/collections/CollectionView.tsx`, add `Play` to the lucide import. Add this helper import:

```tsx
import {
  createMovieFromWatchQueue,
  getPlayableQueue,
  getSelectedPlayableQueue,
  type WatchQueueKind,
} from "@/lib/watch-mode";
```

- [ ] **Step 4: Replace viewer index state with viewer state**

Replace:

```tsx
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
```

With:

```tsx
  const [viewerState, setViewerState] = useState<{
    items: VideoItem[];
    startIndex: number;
    watchMode: boolean;
    sourceName?: string;
    sourceCollectionId?: string;
    movieKind: WatchQueueKind;
  } | null>(null);
```

- [ ] **Step 5: Add queue open and save handlers**

Add these handlers after `handleBulkDownload`:

```tsx
  const openWatchQueue = useCallback(
    (queue: VideoItem[], movieKind: WatchQueueKind) => {
      if (queue.length === 0) {
        toast("No playable videos in this queue", "warning");
        return;
      }

      setViewerState({
        items: queue,
        startIndex: 0,
        watchMode: true,
        sourceName: collectionName,
        sourceCollectionId: activeCollection?.id,
        movieKind,
      });
    },
    [activeCollection?.id, collectionName, toast]
  );

  const handleWatchAll = useCallback(() => {
    openWatchQueue(getPlayableQueue(displayItems), "compilation");
  }, [displayItems, openWatchQueue]);

  const handleWatchSelected = useCallback(() => {
    openWatchQueue(getSelectedPlayableQueue(displayItems, selectedIds), "selection");
  }, [displayItems, openWatchQueue, selectedIds]);

  const handleSaveViewerQueueAsMovie = useCallback(
    async (queue: VideoItem[]) => {
      if (!viewerState) return;

      const movie = await createMovieFromWatchQueue({
        queue,
        collectionName,
        kind: viewerState.movieKind,
        sourceCollectionId: viewerState.sourceCollectionId,
      });

      setViewerState(null);
      setIsMultiSelectMode(false);
      setSelectedIds(new Set());
      toast(`Created "${movie.name}"`, "success");
      router.push(`/movie?id=${movie.id}`);
    },
    [collectionName, router, toast, viewerState]
  );
```

- [ ] **Step 6: Add Watch All to the collection header**

In the header action row, insert this button before `Copy Links`:

```tsx
            <Button
              variant="primary"
              onClick={handleWatchAll}
              disabled={itemCount === 0}
            >
              <Play className="h-4 w-4" />
              Watch All
            </Button>
```

- [ ] **Step 7: Remove the old Slideshow button block**

Delete this block from the scrollable content:

```tsx
          {itemCount > 0 && (
            <div className="mt-3">
              <Button variant="ghost" onClick={() => setViewerIndex(0)}>
                <Presentation className="h-4 w-4" />
                Slideshow
              </Button>
            </div>
          )}
```

Also remove `Presentation` from the lucide import if it is no longer used.

- [ ] **Step 8: Update per-card fullscreen expansion**

Replace:

```tsx
                      onExpand={() => setViewerIndex(index)}
```

With:

```tsx
                      onExpand={() =>
                        setViewerState({
                          items: displayItems,
                          startIndex: index,
                          watchMode: false,
                          sourceName: collectionName,
                          sourceCollectionId: activeCollection?.id,
                          movieKind: "compilation",
                        })
                      }
```

- [ ] **Step 9: Update FullscreenViewer rendering**

Replace the `viewerIndex !== null` render block with:

```tsx
      {viewerState && (
        <FullscreenViewer
          items={viewerState.items}
          startIndex={viewerState.startIndex}
          sourceName={viewerState.sourceName}
          watchMode={viewerState.watchMode}
          onSaveAsMovie={viewerState.watchMode ? handleSaveViewerQueueAsMovie : undefined}
          onClose={() => setViewerState(null)}
        />
      )}
```

- [ ] **Step 10: Pass Watch Selected into the bulk action bar**

Add the new prop to `BulkActionBar`:

```tsx
          onWatchSelected={handleWatchSelected}
```

- [ ] **Step 11: Update implementation notes**

Append this row inside the notes `<tbody>`:

```html
          <tr>
            <td>2026-05-19</td>
            <td>Design decision</td>
            <td>
              Per-card fullscreen expansion remains non-watch mode. <code>Watch All</code> and
              <code>Watch Selected</code> are the only entry points that enable continuous queue playback
              and <code>Save as Movie</code>.
            </td>
          </tr>
```

- [ ] **Step 12: Run the web build**

Run:

```bash
npm --prefix web run build
```

Expected: `next build` completes successfully.

- [ ] **Step 13: Run the web Playwright regression**

Run:

```bash
npx playwright test -c playwright.web.config.js
```

Expected: PASS for both `Collection Watch Mode` tests.

- [ ] **Step 14: Commit the wired feature and green tests**

```bash
git add web/src/components/collections/CollectionView.tsx web/src/components/collections/BulkActionBar.tsx playwright.web.config.js tests/e2e-web/watch-mode.spec.js implementation-notes.html
git commit -m "feat(web): wire collection watch mode"
```

## Task 5: Final Verification And Browser Smoke

**Files:**
- Modify: `implementation-notes.html`

- [ ] **Step 1: Run root unit tests**

Run:

```bash
npm run test:unit
```

Expected: All Jest unit tests pass.

- [ ] **Step 2: Run extension E2E tests**

Run:

```bash
npm run test:e2e
```

Expected: Existing extension Playwright tests pass.

- [ ] **Step 3: Run web build**

Run:

```bash
npm --prefix web run build
```

Expected: `next build` completes successfully.

- [ ] **Step 4: Run web Watch Mode E2E tests**

Run:

```bash
npx playwright test -c playwright.web.config.js
```

Expected: Both Watch Mode tests pass.

- [ ] **Step 5: Browser smoke test with real app UI**

Run:

```bash
npm --prefix web run dev
```

Expected: Dev server prints a local URL on port `3001`.

Open `http://localhost:3001` in Browser/browser-use and verify:

1. Load example videos if the app is empty.
2. Open a collection.
3. Click `Watch All`.
4. Confirm Watch Mode opens with a queue count.
5. Click next and previous.
6. Switch between `Natural` and `Skim`.
7. Click `Save as Movie`.
8. Confirm the app navigates to `/movie?id=<id>`.
9. Return to the collection, select two videos, click `Watch Selected`, and confirm the count is `1 / 2`.

- [ ] **Step 6: Record final implementation notes**

Append this row inside the notes `<tbody>`:

```html
          <tr>
            <td>2026-05-19</td>
            <td>Verification</td>
            <td>
              Final verification ran root unit tests, extension E2E tests, web build, web Watch Mode E2E tests,
              and a browser smoke test through the collection Watch All and Watch Selected flows.
            </td>
          </tr>
```

If any verification command fails for environmental reasons, record the exact command and exact failure text in a new `Verification` row in `implementation-notes.html` before finishing.

- [ ] **Step 7: Commit final notes if changed**

```bash
git add implementation-notes.html
git commit -m "docs: record watch mode implementation notes"
```

Skip this commit only if `implementation-notes.html` did not change after Task 4.

## Self-Review Checklist

- Spec coverage: Tasks cover `Watch All`, `Watch Selected`, continuous queue playback, natural playback, skim playback, `Save as Movie`, playable-only filtering, crossfade movie defaults, empty queue handling, and browser validation.
- User notes requirement: `implementation-notes.html` is created in Task 1 and updated in Tasks 2, 3, 4, and 5.
- Type consistency: The plan uses `WatchQueueKind`, `getPlayableQueue`, `getSelectedPlayableQueue`, `createMovieFromWatchQueue`, and `buildMovieClipsFromQueue` consistently across helper, collection wiring, and tests.
- Scope control: Dashboard-wide Watch Library, standalone routes, queue looping, title cards, music, trim controls, and export changes stay out of scope.
