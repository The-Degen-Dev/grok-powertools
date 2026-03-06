# Movie Maker Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a Movie Maker page (`/movie`) that sequences Grok video clips with transitions (cut/fade/crossfade) and title cards, rendered in real-time via HTML5 Canvas.

**Architecture:** Canvas-based player composites hidden `<video>` elements onto a Canvas via `requestAnimationFrame`. Storyboard panel with @dnd-kit drag-to-reorder. Movies persist in IndexedDB. Phase A focuses on the player + storyboard; FFmpeg export is Phase B.

**Tech Stack:** Next.js 16, TypeScript, Tailwind CSS v4, @dnd-kit, HTML5 Canvas, IndexedDB (idb), lucide-react

---

### Task 1: Data Model — Types + IndexedDB

**Files:**
- Modify: `web/src/lib/types.ts` — add Movie, MovieClip, Transition types
- Modify: `web/src/lib/local-storage.ts` — bump DB version to 2, add `movies` store, add CRUD functions

**Step 1: Add types to `types.ts`**

Add after the existing `AppSettings` block:

```typescript
export interface Transition {
  type: "cut" | "fade" | "crossfade";
  duration: number; // seconds — 0 for cut, 0.3-2.0 for fade/crossfade
}

export interface MovieClip {
  id: string;
  type: "video" | "title";
  // Video clips
  videoUrl?: string;
  sourceCollectionId?: string;
  trimStart?: number;
  trimEnd?: number;
  // Title cards
  titleText?: string;
  titleSubtext?: string;
  titleDuration?: number;   // seconds, default 3
  titleBgColor?: string;    // default "#000000"
  titleTextColor?: string;  // default "#ffffff"
  // Shared
  transition: Transition;
  position: number;
}

export interface Movie {
  id: string;
  name: string;
  resolution: { w: number; h: number };
  clips: MovieClip[];
  createdAt: string;
  updatedAt: string;
}
```

**Step 2: Bump IndexedDB version and add movies store**

In `local-storage.ts`, change `DB_VERSION` from `1` to `2`. Update the `upgrade` function:

```typescript
const DB_VERSION = 2;

// In upgrade:
upgrade(db, oldVersion) {
  if (oldVersion < 1) {
    const collectionStore = db.createObjectStore("collections", { keyPath: "id" });
    collectionStore.createIndex("by-status", "status");
    collectionStore.createIndex("by-updated", "updatedAt");
    db.createObjectStore("settings");
  }
  if (oldVersion < 2) {
    const movieStore = db.createObjectStore("movies", { keyPath: "id" });
    movieStore.createIndex("by-updated", "updatedAt");
  }
},
```

**IMPORTANT**: The existing `dbPromise` singleton caches the connection. Since the version bump requires a fresh `openDB` call, existing sessions will get the upgrade automatically when the page reloads. No migration of existing data is needed — `movies` is a new store.

**Step 3: Add Movie CRUD functions**

Add to `local-storage.ts` after the Settings section:

```typescript
// --- Movies ---

export async function getAllMovies(): Promise<Movie[]> {
  const db = await getDB();
  const movies: Movie[] = await db.getAll("movies");
  return movies.sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
}

export async function getMovie(id: string): Promise<Movie | undefined> {
  const db = await getDB();
  return db.get("movies", id) as Promise<Movie | undefined>;
}

export async function createMovie(name: string): Promise<Movie> {
  const db = await getDB();
  const now = new Date().toISOString();
  const movie: Movie = {
    id: uuidv4(),
    name,
    resolution: { w: 1080, h: 1920 },
    clips: [],
    createdAt: now,
    updatedAt: now,
  };
  await db.put("movies", movie);
  return movie;
}

export async function updateMovie(movie: Movie): Promise<Movie> {
  const db = await getDB();
  movie.updatedAt = new Date().toISOString();
  await db.put("movies", movie);
  return movie;
}

export async function deleteMovie(id: string): Promise<void> {
  const db = await getDB();
  await db.delete("movies", id);
}
```

**Step 4: Verify build**

Run: `cd web && npx next build 2>&1 | tail -10`
Expected: Build succeeds, no TypeScript errors.

**Step 5: Commit**

```bash
git add web/src/lib/types.ts web/src/lib/local-storage.ts
git commit -m "feat(movie): add Movie/MovieClip types and IndexedDB persistence"
```

---

### Task 2: Movie List Page

**Files:**
- Rewrite: `web/src/app/movie/page.tsx` — movie list with create/rename/delete
- Create: `web/src/components/movie/MovieList.tsx` — the actual list component

**Step 1: Create MovieList component**

```typescript
// web/src/components/movie/MovieList.tsx
"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Plus, Film, Trash2, Pencil } from "lucide-react";
import type { Movie } from "@/lib/types";
import { getAllMovies, createMovie, deleteMovie, updateMovie } from "@/lib/local-storage";

export default function MovieList() {
  const router = useRouter();
  const [movies, setMovies] = useState<Movie[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  useEffect(() => {
    getAllMovies().then(setMovies);
  }, []);

  async function handleCreate() {
    const movie = await createMovie("Untitled Movie");
    router.push(`/movie?id=${movie.id}`);
  }

  async function handleDelete(id: string) {
    await deleteMovie(id);
    setMovies((prev) => prev.filter((m) => m.id !== id));
  }

  async function handleRename(movie: Movie) {
    if (!editName.trim()) return;
    const updated = await updateMovie({ ...movie, name: editName.trim() });
    setMovies((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
    setEditingId(null);
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-12">
      <div className="mb-8 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-neutral-900 dark:text-neutral-100">
          Movie Maker
        </h1>
        <button
          type="button"
          onClick={handleCreate}
          className="flex items-center gap-1.5 rounded-lg bg-orange-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-orange-500"
        >
          <Plus className="h-4 w-4" />
          New Movie
        </button>
      </div>

      {movies.length === 0 ? (
        <div className="rounded-lg border border-dashed border-neutral-300 p-12 text-center dark:border-neutral-700">
          <Film className="mx-auto h-10 w-10 text-neutral-400" />
          <p className="mt-3 text-neutral-500">No movies yet. Create one to get started.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {movies.map((movie) => (
            <div
              key={movie.id}
              className="flex items-center justify-between rounded-lg border border-neutral-200 bg-white px-4 py-3 transition hover:border-neutral-300 dark:border-neutral-700 dark:bg-neutral-900 dark:hover:border-neutral-600"
            >
              <div
                className="flex-1 cursor-pointer"
                onClick={() => router.push(`/movie?id=${movie.id}`)}
              >
                {editingId === movie.id ? (
                  <input
                    autoFocus
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onBlur={() => handleRename(movie)}
                    onKeyDown={(e) => e.key === "Enter" && handleRename(movie)}
                    onClick={(e) => e.stopPropagation()}
                    className="rounded bg-neutral-100 px-2 py-0.5 text-sm text-neutral-900 outline-none dark:bg-neutral-800 dark:text-neutral-100"
                  />
                ) : (
                  <>
                    <p className="font-medium text-neutral-900 dark:text-neutral-100">
                      {movie.name}
                    </p>
                    <p className="text-xs text-neutral-500">
                      {movie.clips.length} clip{movie.clips.length !== 1 ? "s" : ""} · Updated{" "}
                      {new Date(movie.updatedAt).toLocaleDateString()}
                    </p>
                  </>
                )}
              </div>
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditingId(movie.id);
                    setEditName(movie.name);
                  }}
                  className="rounded p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800"
                  title="Rename"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(movie.id);
                  }}
                  className="rounded p-1.5 text-neutral-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950"
                  title="Delete"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

**Step 2: Update movie page**

```typescript
// web/src/app/movie/page.tsx
"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import MovieList from "@/components/movie/MovieList";
import MovieMaker from "@/components/movie/MovieMaker";

function MoviePageContent() {
  const searchParams = useSearchParams();
  const movieId = searchParams.get("id");

  if (movieId) {
    return <MovieMaker movieId={movieId} />;
  }
  return <MovieList />;
}

export default function MovieMakerPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-[calc(100vh-3.5rem)] items-center justify-center">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-neutral-600 border-t-orange-500" />
        </div>
      }
    >
      <MoviePageContent />
    </Suspense>
  );
}
```

Note: `MovieMaker` component doesn't exist yet — it will be created in Task 3. For now this will cause a build error, which is expected.

**Step 3: Commit (after Task 3 makes it build)**

Defer commit to end of Task 3.

---

### Task 3: MovieMaker Orchestrator (Skeleton)

**Files:**
- Create: `web/src/components/movie/MovieMaker.tsx` — page orchestrator with state
- Create: `web/src/components/movie/StoryboardPanel.tsx` — clip list placeholder
- Create: `web/src/components/movie/CanvasPlayer.tsx` — player placeholder

This task wires the three-panel layout with stubs so the page builds and renders.

**Step 1: Create MovieMaker.tsx**

The orchestrator owns all movie state and passes it down. Creates the two-panel + timeline layout.

```typescript
// web/src/components/movie/MovieMaker.tsx
"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { ArrowLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import type { Movie, MovieClip } from "@/lib/types";
import { getMovie, updateMovie } from "@/lib/local-storage";
import StoryboardPanel from "./StoryboardPanel";
import CanvasPlayer from "./CanvasPlayer";

interface MovieMakerProps {
  movieId: string;
}

export default function MovieMaker({ movieId }: MovieMakerProps) {
  const router = useRouter();
  const [movie, setMovie] = useState<Movie | null>(null);
  const [activeClipIndex, setActiveClipIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    getMovie(movieId).then((m) => {
      if (m) setMovie(m);
      else router.push("/movie");
    });
  }, [movieId, router]);

  // Auto-save on changes (debounced 500ms)
  const save = useCallback(
    (updated: Movie) => {
      setMovie(updated);
      clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = setTimeout(() => {
        updateMovie(updated);
      }, 500);
    },
    []
  );

  const handleClipsChange = useCallback(
    (clips: MovieClip[]) => {
      if (!movie) return;
      save({ ...movie, clips: clips.map((c, i) => ({ ...c, position: i })) });
    },
    [movie, save]
  );

  if (!movie) {
    return (
      <div className="flex h-[calc(100vh-3.5rem)] items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-neutral-600 border-t-orange-500" />
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col bg-neutral-950">
      {/* Header bar */}
      <div className="flex items-center gap-3 border-b border-neutral-800 px-4 py-2">
        <button
          type="button"
          onClick={() => router.push("/movie")}
          className="rounded p-1 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <h2 className="text-sm font-medium text-neutral-200">{movie.name}</h2>
        <span className="text-xs text-neutral-500">
          {movie.clips.length} clip{movie.clips.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Main panels */}
      <div className="flex flex-1 min-h-0">
        {/* Storyboard — left */}
        <div className="w-80 flex-shrink-0 overflow-y-auto border-r border-neutral-800">
          <StoryboardPanel
            clips={movie.clips}
            onClipsChange={handleClipsChange}
            activeIndex={activeClipIndex}
            onActiveIndexChange={setActiveClipIndex}
          />
        </div>

        {/* Preview — right */}
        <div className="flex flex-1 flex-col min-h-0">
          <CanvasPlayer
            clips={movie.clips}
            resolution={movie.resolution}
            isPlaying={isPlaying}
            onPlayingChange={setIsPlaying}
          />
        </div>
      </div>
    </div>
  );
}
```

**Step 2: Create StoryboardPanel.tsx placeholder**

```typescript
// web/src/components/movie/StoryboardPanel.tsx
"use client";

import { Plus } from "lucide-react";
import type { MovieClip } from "@/lib/types";

interface StoryboardPanelProps {
  clips: MovieClip[];
  onClipsChange: (clips: MovieClip[]) => void;
  activeIndex: number;
  onActiveIndexChange: (index: number) => void;
}

export default function StoryboardPanel({
  clips,
  onClipsChange,
  activeIndex,
  onActiveIndexChange,
}: StoryboardPanelProps) {
  return (
    <div className="flex flex-col gap-1 p-3">
      {clips.length === 0 ? (
        <p className="py-8 text-center text-xs text-neutral-500">
          No clips yet. Add some to start building your movie.
        </p>
      ) : (
        clips.map((clip, index) => (
          <div
            key={clip.id}
            onClick={() => onActiveIndexChange(index)}
            className={`rounded-lg border px-3 py-2 text-xs transition cursor-pointer ${
              index === activeIndex
                ? "border-orange-500/50 bg-orange-500/10 text-orange-400"
                : "border-neutral-800 text-neutral-400 hover:border-neutral-700"
            }`}
          >
            {clip.type === "video" ? `Video: ${clip.videoUrl?.slice(-20) ?? "?"}` : `Title: ${clip.titleText ?? "Untitled"}`}
          </div>
        ))
      )}

      <button
        type="button"
        onClick={() => {/* TODO: open clip source picker */}}
        className="mt-2 flex items-center justify-center gap-1 rounded-lg border border-dashed border-neutral-700 py-2 text-xs text-neutral-500 transition hover:border-neutral-500 hover:text-neutral-300"
      >
        <Plus className="h-3 w-3" />
        Add Clip
      </button>
    </div>
  );
}
```

**Step 3: Create CanvasPlayer.tsx placeholder**

```typescript
// web/src/components/movie/CanvasPlayer.tsx
"use client";

import { Play, Pause } from "lucide-react";
import type { MovieClip } from "@/lib/types";

interface CanvasPlayerProps {
  clips: MovieClip[];
  resolution: { w: number; h: number };
  isPlaying: boolean;
  onPlayingChange: (playing: boolean) => void;
}

export default function CanvasPlayer({
  clips,
  resolution,
  isPlaying,
  onPlayingChange,
}: CanvasPlayerProps) {
  return (
    <div className="flex flex-1 flex-col">
      {/* Canvas area */}
      <div className="flex flex-1 items-center justify-center bg-black">
        {clips.length === 0 ? (
          <p className="text-sm text-neutral-500">Add clips to preview your movie</p>
        ) : (
          <div className="flex items-center justify-center text-neutral-500">
            <p className="text-sm">Canvas player — coming next</p>
          </div>
        )}
      </div>

      {/* Transport controls */}
      <div className="flex items-center justify-center gap-3 border-t border-neutral-800 py-2">
        <button
          type="button"
          onClick={() => onPlayingChange(!isPlaying)}
          className="rounded p-2 text-neutral-300 hover:bg-neutral-800"
        >
          {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </button>
        <span className="text-xs text-neutral-500">0:00 / 0:00</span>
      </div>
    </div>
  );
}
```

**Step 4: Verify build**

Run: `cd web && npx next build 2>&1 | tail -10`
Expected: Build succeeds.

**Step 5: Commit**

```bash
git add web/src/app/movie/page.tsx web/src/components/movie/
git commit -m "feat(movie): add MovieMaker skeleton with storyboard and player placeholders"
```

---

### Task 4: ClipSourcePicker — Import Clips from Collections + Paste URL + Title Cards

**Files:**
- Create: `web/src/components/movie/ClipSourcePicker.tsx` — modal with three tabs
- Modify: `web/src/components/movie/StoryboardPanel.tsx` — wire Add Clip button to open picker

**Step 1: Create ClipSourcePicker.tsx**

Modal with tabs: Collections, Paste URL, Title Card. Uses the existing `getAllCollections` function from local-storage.

```typescript
// web/src/components/movie/ClipSourcePicker.tsx
"use client";

import { useState, useEffect } from "react";
import { X, FolderOpen, Link2, Type } from "lucide-react";
import { v4 as uuidv4 } from "uuid";
import type { Collection, MovieClip, Transition } from "@/lib/types";
import { getAllCollections } from "@/lib/local-storage";

interface ClipSourcePickerProps {
  onAddClips: (clips: MovieClip[]) => void;
  onClose: () => void;
}

const DEFAULT_TRANSITION: Transition = { type: "cut", duration: 0 };

type Tab = "collections" | "url" | "title";

export default function ClipSourcePicker({ onAddClips, onClose }: ClipSourcePickerProps) {
  const [tab, setTab] = useState<Tab>("collections");
  const [collections, setCollections] = useState<Collection[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // URL tab
  const [pasteUrl, setPasteUrl] = useState("");

  // Title tab
  const [titleText, setTitleText] = useState("");
  const [titleSubtext, setTitleSubtext] = useState("");
  const [titleDuration, setTitleDuration] = useState(3);

  useEffect(() => {
    getAllCollections().then(setCollections);
  }, []);

  function addVideoClip(videoUrl: string, collectionId?: string) {
    const clip: MovieClip = {
      id: uuidv4(),
      type: "video",
      videoUrl,
      sourceCollectionId: collectionId,
      transition: DEFAULT_TRANSITION,
      position: 0,
    };
    onAddClips([clip]);
  }

  function addTitleCard() {
    if (!titleText.trim()) return;
    const clip: MovieClip = {
      id: uuidv4(),
      type: "title",
      titleText: titleText.trim(),
      titleSubtext: titleSubtext.trim() || undefined,
      titleDuration,
      titleBgColor: "#000000",
      titleTextColor: "#ffffff",
      transition: DEFAULT_TRANSITION,
      position: 0,
    };
    onAddClips([clip]);
    setTitleText("");
    setTitleSubtext("");
  }

  function handlePasteUrl() {
    if (!pasteUrl.trim()) return;
    addVideoClip(pasteUrl.trim());
    setPasteUrl("");
  }

  const TABS: { id: Tab; icon: React.ElementType; label: string }[] = [
    { id: "collections", icon: FolderOpen, label: "Collections" },
    { id: "url", icon: Link2, label: "Paste URL" },
    { id: "title", icon: Type, label: "Title Card" },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-full max-w-lg rounded-xl border border-neutral-700 bg-neutral-900 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-3">
          <h3 className="text-sm font-medium text-neutral-200">Add Clip</h3>
          <button type="button" onClick={onClose} className="text-neutral-500 hover:text-neutral-300">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-neutral-800">
          {TABS.map(({ id, icon: Icon, label }) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`flex flex-1 items-center justify-center gap-1.5 py-2.5 text-xs font-medium transition ${
                tab === id
                  ? "border-b-2 border-orange-500 text-orange-400"
                  : "text-neutral-500 hover:text-neutral-300"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="max-h-80 overflow-y-auto p-4">
          {tab === "collections" && (
            <div className="space-y-2">
              {collections.length === 0 ? (
                <p className="py-4 text-center text-xs text-neutral-500">No collections saved yet.</p>
              ) : (
                collections.map((col) => (
                  <div key={col.id}>
                    <button
                      type="button"
                      onClick={() => setExpandedId(expandedId === col.id ? null : col.id)}
                      className="w-full rounded-lg border border-neutral-800 px-3 py-2 text-left text-xs transition hover:border-neutral-600"
                    >
                      <span className="font-medium text-neutral-200">{col.name}</span>
                      <span className="ml-2 text-neutral-500">{col.items.length} items</span>
                    </button>
                    {expandedId === col.id && (
                      <div className="mt-1 ml-2 space-y-1">
                        {col.items.filter((item) => item.videoUrl).map((item) => (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => addVideoClip(item.videoUrl, col.id)}
                            className="w-full rounded bg-neutral-800 px-3 py-1.5 text-left text-xs text-neutral-300 transition hover:bg-neutral-700"
                          >
                            {item.promptText?.slice(0, 60) || item.videoUrl.slice(-30)}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          )}

          {tab === "url" && (
            <div className="space-y-3">
              <input
                type="url"
                value={pasteUrl}
                onChange={(e) => setPasteUrl(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handlePasteUrl()}
                placeholder="Paste Grok video URL..."
                className="w-full rounded-lg bg-neutral-800 px-3 py-2 text-sm text-neutral-200 outline-none placeholder:text-neutral-600"
              />
              <button
                type="button"
                onClick={handlePasteUrl}
                disabled={!pasteUrl.trim()}
                className="rounded-lg bg-orange-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-orange-500 disabled:opacity-40"
              >
                Add Video
              </button>
            </div>
          )}

          {tab === "title" && (
            <div className="space-y-3">
              <input
                value={titleText}
                onChange={(e) => setTitleText(e.target.value)}
                placeholder="Title text..."
                className="w-full rounded-lg bg-neutral-800 px-3 py-2 text-sm text-neutral-200 outline-none placeholder:text-neutral-600"
              />
              <input
                value={titleSubtext}
                onChange={(e) => setTitleSubtext(e.target.value)}
                placeholder="Subtitle (optional)..."
                className="w-full rounded-lg bg-neutral-800 px-3 py-2 text-sm text-neutral-200 outline-none placeholder:text-neutral-600"
              />
              <div className="flex items-center gap-2">
                <label className="text-xs text-neutral-400">Duration:</label>
                <input
                  type="number"
                  min={1}
                  max={30}
                  value={titleDuration}
                  onChange={(e) => setTitleDuration(Number(e.target.value))}
                  className="w-16 rounded bg-neutral-800 px-2 py-1 text-xs text-neutral-200"
                />
                <span className="text-xs text-neutral-500">seconds</span>
              </div>
              <button
                type="button"
                onClick={addTitleCard}
                disabled={!titleText.trim()}
                className="rounded-lg bg-orange-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-orange-500 disabled:opacity-40"
              >
                Add Title Card
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
```

**Step 2: Wire ClipSourcePicker into StoryboardPanel**

Update `StoryboardPanel.tsx`:
- Add `showPicker` state
- Open picker on "Add Clip" click
- On `onAddClips`, append to clips array via `onClipsChange`
- Add delete button per clip
- Add `TransitionPicker` between clips (Task 5)

Full replacement of StoryboardPanel.tsx:

```typescript
// web/src/components/movie/StoryboardPanel.tsx
"use client";

import { useState } from "react";
import { Plus, Trash2, Film, Type } from "lucide-react";
import { v4 as uuidv4 } from "uuid";
import type { MovieClip } from "@/lib/types";
import ClipSourcePicker from "./ClipSourcePicker";

interface StoryboardPanelProps {
  clips: MovieClip[];
  onClipsChange: (clips: MovieClip[]) => void;
  activeIndex: number;
  onActiveIndexChange: (index: number) => void;
}

export default function StoryboardPanel({
  clips,
  onClipsChange,
  activeIndex,
  onActiveIndexChange,
}: StoryboardPanelProps) {
  const [showPicker, setShowPicker] = useState(false);

  function handleAddClips(newClips: MovieClip[]) {
    const withPositions = newClips.map((c, i) => ({
      ...c,
      position: clips.length + i,
    }));
    onClipsChange([...clips, ...withPositions]);
  }

  function handleDelete(index: number) {
    const next = clips.filter((_, i) => i !== index);
    onClipsChange(next);
    if (activeIndex >= next.length) {
      onActiveIndexChange(Math.max(0, next.length - 1));
    }
  }

  function handleTransitionChange(index: number, type: MovieClip["transition"]["type"], duration: number) {
    const next = clips.map((c, i) =>
      i === index ? { ...c, transition: { type, duration } } : c
    );
    onClipsChange(next);
  }

  return (
    <div className="flex flex-col gap-0.5 p-3">
      {clips.length === 0 ? (
        <p className="py-8 text-center text-xs text-neutral-500">
          No clips yet. Add some to start building your movie.
        </p>
      ) : (
        clips.map((clip, index) => (
          <div key={clip.id}>
            {/* Transition picker between clips (not on first) */}
            {index > 0 && (
              <div className="flex items-center justify-center py-1">
                <select
                  value={clip.transition.type}
                  onChange={(e) => {
                    const t = e.target.value as "cut" | "fade" | "crossfade";
                    handleTransitionChange(index, t, t === "cut" ? 0 : clip.transition.duration || 0.5);
                  }}
                  className="rounded bg-neutral-800 px-2 py-0.5 text-[10px] text-neutral-400 outline-none"
                >
                  <option value="cut">Cut</option>
                  <option value="fade">Fade</option>
                  <option value="crossfade">Crossfade</option>
                </select>
                {clip.transition.type !== "cut" && (
                  <input
                    type="number"
                    min={0.1}
                    max={3}
                    step={0.1}
                    value={clip.transition.duration}
                    onChange={(e) =>
                      handleTransitionChange(index, clip.transition.type, Number(e.target.value))
                    }
                    className="ml-1 w-12 rounded bg-neutral-800 px-1 py-0.5 text-[10px] text-neutral-400 outline-none"
                  />
                )}
              </div>
            )}

            {/* Clip card */}
            <div
              onClick={() => onActiveIndexChange(index)}
              className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs transition cursor-pointer ${
                index === activeIndex
                  ? "border-orange-500/50 bg-orange-500/10 text-orange-400"
                  : "border-neutral-800 text-neutral-400 hover:border-neutral-700"
              }`}
            >
              {clip.type === "video" ? (
                <Film className="h-3 w-3 flex-shrink-0" />
              ) : (
                <Type className="h-3 w-3 flex-shrink-0" />
              )}
              <span className="flex-1 truncate">
                {clip.type === "video"
                  ? clip.videoUrl?.split("/").pop()?.slice(0, 25) ?? "Video"
                  : clip.titleText ?? "Title"}
              </span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleDelete(index);
                }}
                className="rounded p-0.5 hover:bg-neutral-700 hover:text-red-400"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          </div>
        ))
      )}

      <button
        type="button"
        onClick={() => setShowPicker(true)}
        className="mt-2 flex items-center justify-center gap-1 rounded-lg border border-dashed border-neutral-700 py-2 text-xs text-neutral-500 transition hover:border-neutral-500 hover:text-neutral-300"
      >
        <Plus className="h-3 w-3" />
        Add Clip
      </button>

      {showPicker && (
        <ClipSourcePicker
          onAddClips={(clips) => {
            handleAddClips(clips);
            setShowPicker(false);
          }}
          onClose={() => setShowPicker(false)}
        />
      )}
    </div>
  );
}
```

**Step 3: Verify build**

Run: `cd web && npx next build 2>&1 | tail -10`
Expected: Build succeeds.

**Step 4: Commit**

```bash
git add web/src/components/movie/ClipSourcePicker.tsx web/src/components/movie/StoryboardPanel.tsx
git commit -m "feat(movie): add ClipSourcePicker and storyboard with transitions"
```

---

### Task 5: Canvas Player — Real-Time Rendering

**Files:**
- Rewrite: `web/src/components/movie/CanvasPlayer.tsx` — full Canvas render loop with transitions

This is the most complex component. The Canvas player:
1. Manages hidden `<video>` elements — one per video clip
2. Runs a `requestAnimationFrame` render loop
3. Computes which clip(s) are active at the current time
4. Draws video frames and title cards with transition blending
5. Exposes play/pause/seek controls

**Step 1: Build the timeline model**

A utility function computes the start time and duration of each clip in the movie timeline, accounting for crossfade overlaps.

```typescript
interface TimelineEntry {
  clipIndex: number;
  startTime: number;   // global time where this clip begins
  endTime: number;     // global time where this clip ends
  clipStart: number;   // offset within the clip (trimStart)
  clipDuration: number; // actual playback duration of this clip
}

function buildTimeline(clips: MovieClip[], videoDurations: Map<string, number>): TimelineEntry[] {
  const entries: TimelineEntry[] = [];
  let currentTime = 0;

  for (let i = 0; i < clips.length; i++) {
    const clip = clips[i];
    let clipDuration: number;

    if (clip.type === "title") {
      clipDuration = clip.titleDuration ?? 3;
    } else {
      const fullDuration = videoDurations.get(clip.id) ?? 5;
      const start = clip.trimStart ?? 0;
      const end = clip.trimEnd ?? fullDuration;
      clipDuration = end - start;
    }

    // Subtract crossfade overlap from current time
    const overlap = i > 0 && clip.transition.type === "crossfade" ? clip.transition.duration : 0;
    const startTime = currentTime - overlap;

    entries.push({
      clipIndex: i,
      startTime,
      endTime: startTime + clipDuration,
      clipStart: clip.type === "video" ? (clip.trimStart ?? 0) : 0,
      clipDuration,
    });

    currentTime = startTime + clipDuration;
  }

  return entries;
}
```

**Step 2: Implement CanvasPlayer.tsx**

The full implementation. Key design:
- Video elements created once, stored in a Map keyed by clip ID
- `requestAnimationFrame` loop checks `performance.now()` against timeline
- Fade: draw clip A at decreasing alpha, then clip B at increasing alpha (sequential)
- Crossfade: two clips overlap temporally, both drawn with complementary alphas
- Title cards: `ctx.fillRect()` + `ctx.font` + `ctx.fillText()`

```typescript
// web/src/components/movie/CanvasPlayer.tsx — Full implementation
// See the code in Step 2 below (it's long — ~250 lines)
```

Due to the complexity of the CanvasPlayer, write this as a single focused file. Key implementation notes:

- **Video preloading**: On mount, create `<video>` elements for each video clip, set `src`, call `load()`. Store `duration` in a Map once `loadedmetadata` fires.
- **Render loop**: `requestAnimationFrame` callback reads `currentTime` from state, finds active clip(s) via `buildTimeline`, draws to Canvas.
- **Transition rendering**:
  - **Cut**: Just draw current clip at full alpha.
  - **Fade**: During the transition zone, reduce outgoing alpha from 1→0, then increase incoming alpha 0→1 (with a black gap between).
  - **Crossfade**: Both clips overlap. Outgoing `alpha = 1 - progress`, incoming `alpha = progress`.
- **Title rendering**: `ctx.fillStyle = bgColor; ctx.fillRect(0,0,w,h)`. Then `ctx.fillStyle = textColor; ctx.textAlign = "center"; ctx.font = "bold 48px sans-serif"; ctx.fillText(text, w/2, h/2)`.
- **Seek**: Click on timeline strip → set `currentTime`, seek all video elements to their corresponding position.
- **Fullscreen**: Toggle `fixed inset-0 z-50` on the container div.

**Step 3: Verify build**

Run: `cd web && npx next build 2>&1 | tail -10`

**Step 4: Commit**

```bash
git add web/src/components/movie/CanvasPlayer.tsx
git commit -m "feat(movie): implement Canvas player with transitions and title rendering"
```

---

### Task 6: Storyboard Drag-to-Reorder with @dnd-kit

**Files:**
- Modify: `web/src/components/movie/StoryboardPanel.tsx` — add @dnd-kit sortable

**Step 1: Add DnD wrapping**

Follow the exact same pattern as `Workspace.tsx` (lines 98-134):
- Wrap clip list in `<DndContext>` + `<SortableContext>`
- Extract `SortableClipCard` wrapper using `useSortable`
- On `DragEnd`, reorder clips array

Use `verticalListSortingStrategy` (not `rectSortingStrategy` since storyboard is vertical).

Import from `@dnd-kit/sortable`: `verticalListSortingStrategy`.

**Step 2: Verify build + commit**

```bash
git add web/src/components/movie/StoryboardPanel.tsx
git commit -m "feat(movie): add drag-to-reorder in storyboard with @dnd-kit"
```

---

### Task 7: Fullscreen Preview Mode

**Files:**
- Modify: `web/src/components/movie/CanvasPlayer.tsx` — add fullscreen toggle
- Modify: `web/src/components/movie/MovieMaker.tsx` — add fullscreen state

**Step 1: Add fullscreen toggle**

In CanvasPlayer, add a `fullscreen` prop + `onFullscreenChange`. When true:
- Container gets `fixed inset-0 z-50 bg-black`
- Controls auto-hide after 3 seconds (same pattern as FullscreenViewer)
- Escape key exits fullscreen

Add `Maximize2` icon button next to play/pause. Add `Minimize2` when in fullscreen.

**Step 2: Wire into MovieMaker**

Add `isFullscreen` state to MovieMaker, pass to CanvasPlayer.

**Step 3: Verify build + commit**

```bash
git add web/src/components/movie/CanvasPlayer.tsx web/src/components/movie/MovieMaker.tsx
git commit -m "feat(movie): add fullscreen preview mode with auto-hiding controls"
```

---

### Task 8: MovieTimeline Strip

**Files:**
- Create: `web/src/components/movie/MovieTimeline.tsx` — horizontal timeline
- Modify: `web/src/components/movie/MovieMaker.tsx` — add timeline below panels

**Step 1: Create MovieTimeline.tsx**

Similar to the editor Timeline but for multi-clip movies:
- Each clip is a proportional block in the timeline
- Colors: video clips = neutral-700, title cards = neutral-600
- Orange overlay for current playhead position
- Click to seek
- Total duration label

**Step 2: Wire into MovieMaker layout**

Add `<MovieTimeline>` between the main panels and the bottom edge.

**Step 3: Verify build + commit**

```bash
git add web/src/components/movie/MovieTimeline.tsx web/src/components/movie/MovieMaker.tsx
git commit -m "feat(movie): add movie timeline strip with clip blocks and seek"
```

---

### Task 9: Keyboard Shortcuts + Polish

**Files:**
- Modify: `web/src/components/movie/MovieMaker.tsx` — add keyboard handler

**Step 1: Add keyboard shortcuts**

- **Space**: toggle play/pause
- **Escape**: exit fullscreen (if active)
- **Delete/Backspace**: remove active clip (with confirmation if needed)
- **Left/Right arrows**: nudge to previous/next clip

**Step 2: Final build verification**

Run: `cd web && npx next build 2>&1 | tail -10`
Expected: Build succeeds, no TypeScript errors.

**Step 3: Final commit**

```bash
git add web/src/components/movie/
git commit -m "feat(movie): add keyboard shortcuts and polish"
```

---

## File Summary

| File | Action | Task |
|------|--------|------|
| `web/src/lib/types.ts` | Modify | 1 |
| `web/src/lib/local-storage.ts` | Modify | 1 |
| `web/src/app/movie/page.tsx` | Rewrite | 2 |
| `web/src/components/movie/MovieList.tsx` | Create | 2 |
| `web/src/components/movie/MovieMaker.tsx` | Create | 3, 7, 8, 9 |
| `web/src/components/movie/StoryboardPanel.tsx` | Create | 3, 4, 6 |
| `web/src/components/movie/CanvasPlayer.tsx` | Create | 3, 5, 7 |
| `web/src/components/movie/ClipSourcePicker.tsx` | Create | 4 |
| `web/src/components/movie/MovieTimeline.tsx` | Create | 8 |

## Verification Checklist

1. `npm run build` — no TypeScript errors
2. Navigate to `/movie` — empty state shows, "New Movie" creates and navigates
3. In movie editor, "Add Clip" opens picker with three tabs
4. Add a video from collections → appears in storyboard
5. Add a title card → appears in storyboard
6. Canvas player renders video clips and title cards
7. Transitions: set crossfade between clips → preview shows blended transition
8. Drag clips in storyboard → reorders, canvas updates
9. Play/pause works, timeline scrubbing works
10. Fullscreen mode works with auto-hiding controls
11. Keyboard: Space toggles play, Escape exits fullscreen
12. Navigate away and back → movie persists in IndexedDB
