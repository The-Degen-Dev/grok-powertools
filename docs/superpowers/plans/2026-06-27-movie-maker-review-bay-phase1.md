# Movie Maker Review Bay Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade `/movie` into the Phase 1 desktop-first Movie Maker Review Bay defined in `docs/superpowers/specs/2026-06-26-movie-maker-review-bay-upgrade-design.md`.

**Architecture:** Keep the work local to the web app and keep existing Vault draft creation usable. Add a typed Review Bay domain model, additive IndexedDB stores, pure reducers/selectors, focused UI surfaces, an audio-capable preview engine, FFmpeg-backed MP4/WebM export, and a proposal-only Director adapter with a rule-based fallback.

**Tech Stack:** Next.js 16, React 19, TypeScript, IndexedDB through `idb`, Vitest, Playwright, `@ffmpeg/ffmpeg`, OpenAI-compatible chat completions through CLIProxyAPI when configured, existing local fake Vault worker.

---

## Scope Check

The spec covers one product surface: the local web app Movie Maker at `/movie`. Phase 1 is large, but the pieces are tightly coupled around one workflow: load local Vault-backed movie drafts, triage candidate clips, assemble a committed cut, preview with audio, export, and review Director proposals.

Keep this plan to Phase 1. Do not implement Phase 2 prompt spine scoring, duplicate detection, richer A/B comparisons, split/duplicate/speed/crop/captions, cloud sync, share links, extension backup changes, R2/D1/Worker repair writes, processed-ID changes, live Grok automation, env/secrets/OAuth/bucket config, or any cloud project state.

## Current Repo Facts

- Worktree: `/Users/philipbankier/.codex/worktrees/vault-movie-drafts-exec/chrome-extension-powertools`
- Branch: `codex/vault-movie-drafts-exec`
- Spec: `docs/superpowers/specs/2026-06-26-movie-maker-review-bay-upgrade-design.md`
- Existing Movie Maker entry: `web/src/app/movie/page.tsx`
- Existing Movie Maker shell: `web/src/components/movie/MovieMaker.tsx`
- Existing canvas preview and playback loop: `web/src/components/movie/CanvasPlayer.tsx`
- Existing simple storyboard rail: `web/src/components/movie/StoryboardPanel.tsx`
- Existing simple timeline strip: `web/src/components/movie/MovieTimeline.tsx`
- Existing WebM-only canvas export: `web/src/components/movie/ExportMovieButton.tsx`
- Existing movie types and storage: `web/src/lib/types.ts`, `web/src/lib/local-storage.ts`
- Existing Vault draft builder: `web/src/lib/vault-movie-drafts.ts`, `web/src/lib/vault-movie-draft-storage.ts`
- Existing FFmpeg wrapper and clip export args: `web/src/lib/useFFmpeg.ts`, `web/src/lib/ffmpeg-commands.ts`
- Existing web test runner: `npm --prefix web run test:unit`
- Existing web E2E config: `npx playwright test -c playwright.web.config.js`

## File Structure

### Domain And Storage

- Modify `web/package.json`: add `zod` for runtime schemas.
- Modify `web/package-lock.json`: lock `zod`.
- Modify `web/src/lib/types.ts`: add optional legacy-safe fields to `MovieClip` and `Movie`.
- Modify `web/src/lib/local-storage.ts`: bump DB version and create additive Movie Maker Review Bay stores.
- Create `web/src/lib/movie-review-types.ts`: source-of-truth TypeScript types and Zod schemas for Review Bay projects, clips, versions, proposals, export runs, notes, and provider config.
- Create `web/src/lib/movie-review-storage.ts`: storage helpers for projects, versions, proposals, export runs, notes, and legacy `Movie` hydration.
- Create `web/src/lib/movie-review-storage.test.ts`: IndexedDB migration and storage tests.

### Pure State, Timeline, And Export Logic

- Create `web/src/lib/movie-review-reducer.ts`: pure review commands and state transitions.
- Create `web/src/lib/movie-review-reducer.test.ts`: keep/reject/apply, auto-advance, keyboard collision, filter, and reorder tests.
- Create `web/src/lib/movie-timeline-model.ts`: timeline entries, trim normalization, duration math, audio intent, export-safe predicates.
- Create `web/src/lib/movie-timeline-model.test.ts`: timeline and export-safe tests.
- Create `web/src/lib/movie-export-args.ts`: FFmpeg argument builder for MP4 with audio and WebM fallback.
- Create `web/src/lib/movie-export-args.test.ts`: verifies MP4/WebM filter graphs and audio handling.
- Create `web/src/lib/movie-director.ts`: Director request/response schemas, rule-based fallback, OpenAI-compatible provider client, proposal validation.
- Create `web/src/lib/movie-director.test.ts`: fake provider, invalid output rejection, partial accept, no direct mutation.

### Hooks And Components

- Create `web/src/components/movie/review/useMovieReviewProject.ts`: project load/save hook and debounced persistence.
- Create `web/src/components/movie/review/useMovieKeyboard.ts`: keyboard map and live-region messages.
- Create `web/src/components/movie/review/useMovieMediaEngine.ts`: metadata, source-audio detection, media element lifecycle, and preview frame sync.
- Create `web/src/components/movie/review/useMovieAudioPreview.ts`: Web Audio gain/mute/solo preview mix.
- Create `web/src/components/movie/review/MovieReviewBay.tsx`: top-level Review Bay shell.
- Create `web/src/components/movie/review/MovieReviewHeader.tsx`: title, mode switch, Director activity, export gate.
- Create `web/src/components/movie/review/MovieLeftRail.tsx`: Draft Queue and Director tab host.
- Create `web/src/components/movie/review/MovieDraftQueue.tsx`: whole-version management.
- Create `web/src/components/movie/review/MovieDirectorPanel.tsx`: proposal list, fake/provider run action, apply controls.
- Create `web/src/components/movie/review/MovieCandidatesGrid.tsx`: triage grid for proposed and undecided clips.
- Create `web/src/components/movie/review/MovieFocusLoupe.tsx`: single-clip Focus/Loupe mode.
- Create `web/src/components/movie/review/MovieAssembleView.tsx`: continuous preview, time-proportional ribbon, audio lanes.
- Create `web/src/components/movie/review/MovieClipStrip.tsx`: committed Clip Strip source of truth.
- Create `web/src/components/movie/review/MovieInspector.tsx`: trim, volume, mute/solo, metadata, alternates.
- Create `web/src/components/movie/review/MoviePreview.tsx`: canvas/video preview region with accessible transport.
- Create `web/src/components/movie/review/MovieWaveform.tsx`: scrub and trim controls with slider semantics.
- Create `web/src/components/movie/review/MovieStatusBadges.tsx`: grayscale-legible lifecycle and flag indicators.
- Create `web/src/components/movie/review/MovieExportGate.tsx`: pre-flight blockers, warnings, export actions, history.
- Create `web/src/components/movie/review/MovieExportButton.tsx`: FFmpeg-backed MP4/WebM export orchestration.
- Modify `web/src/components/movie/MovieMaker.tsx`: replace the old shell with `MovieReviewBay`.
- Keep `CanvasPlayer.tsx`, `StoryboardPanel.tsx`, `MovieTimeline.tsx`, and `ExportMovieButton.tsx` until the new E2E suite proves replacements, then remove or leave unused only if TypeScript/lint accepts it.

### Tests And Fixtures

- Modify `tests/e2e-web/fixtures/fake-vault-worker.mjs`: expose enough video fixture metadata for audio/export tests and keep existing Vault tests stable.
- Add `tests/e2e-web/fixtures/tiny-video-with-audio.mp4`: use an actual short MP4 with an AAC audio track.
- Create `tests/e2e-web/movie-review-bay.spec.js`: Review/Triage, Focus/Loupe, Assemble, keyboard, Inspector, Clip Strip.
- Create `tests/e2e-web/movie-director.spec.js`: fake Director proposals, preview proposed cut, partial accept, no direct mutation.
- Create `tests/e2e-web/movie-export.spec.js`: pre-flight gate, MP4 export with audio proof, WebM fallback.
- Modify `tests/e2e-web/movie-player-stability.spec.js`: keep coverage against seek spam and canvas nonblank behavior through the new preview.

## Implementation Notes Requirement

Create and maintain `implementation-notes.html` at repo root during execution. Add an entry at the end of every task with:

```html
<section>
  <h2>Task N: short task name</h2>
  <ul>
    <li><strong>Design decisions:</strong> decisions made where the plan or spec allowed multiple valid choices.</li>
    <li><strong>Deviations:</strong> intentional departures from the plan or spec, with reason.</li>
    <li><strong>Tradeoffs:</strong> alternatives considered and why the implemented path won.</li>
    <li><strong>Open questions:</strong> questions that still need user confirmation.</li>
    <li><strong>Validation:</strong> commands and manual checks run, with pass/fail result.</li>
  </ul>
</section>
```

## Task 1: Add Schemas And Additive Review Bay Storage

**Files:**
- Modify: `web/package.json`
- Modify: `web/package-lock.json`
- Modify: `web/src/lib/types.ts`
- Modify: `web/src/lib/local-storage.ts`
- Create: `web/src/lib/movie-review-types.ts`
- Create: `web/src/lib/movie-review-storage.ts`
- Create: `web/src/lib/movie-review-storage.test.ts`

- [ ] **Step 1: Install schema dependency**

Run:

```bash
npm --prefix web install zod@4.3.4
```

Expected:

- `web/package.json` contains `"zod": "^4.3.4"` under dependencies.
- `web/package-lock.json` changes.
- No root `package.json` changes.

- [ ] **Step 2: Write failing storage tests**

Create `web/src/lib/movie-review-storage.test.ts` with these tests:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { openDB } from "idb";
import { createMovie, getDB } from "./local-storage";
import {
  createReviewProjectFromMovie,
  getReviewProject,
  listMovieVersions,
  saveDirectorProposal,
  saveExportRun,
  saveMovieVersion,
  updateReviewProject,
} from "./movie-review-storage";
import type { DirectorProposal, MovieExportRun, MovieVersion } from "./movie-review-types";

async function clearDb() {
  const db = await getDB();
  const stores = [
    "collections",
    "movies",
    "prompts",
    "settings",
    "sync_meta",
    "vault_assets",
    "vault_overlays",
    "vault_import_runs",
    "vault_gaps",
    "vault_prompts",
    "vault_media_tokens",
    "movie_review_projects",
    "movie_versions",
    "movie_director_proposals",
    "movie_export_runs",
    "movie_review_notes",
  ].filter((name) => db.objectStoreNames.contains(name));
  const tx = db.transaction(stores, "readwrite");
  stores.forEach((name) => tx.objectStore(name).clear());
  await tx.done;
}

describe("movie review storage", () => {
  beforeEach(async () => {
    await clearDb();
  });

  it("creates additive Review Bay stores without deleting legacy movies", async () => {
    const movie = await createMovie("Legacy movie");
    const db = await openDB("grok-power-tools");
    expect(db.objectStoreNames.contains("movies")).toBe(true);
    expect(db.objectStoreNames.contains("movie_review_projects")).toBe(true);
    expect(db.objectStoreNames.contains("movie_versions")).toBe(true);
    expect(db.objectStoreNames.contains("movie_director_proposals")).toBe(true);
    expect(db.objectStoreNames.contains("movie_export_runs")).toBe(true);
    expect(db.objectStoreNames.contains("movie_review_notes")).toBe(true);
    db.close();

    const project = await createReviewProjectFromMovie(movie.id);
    expect(project.movieId).toBe(movie.id);
    expect(project.mode).toBe("review");
    expect(project.candidates).toEqual([]);
  });

  it("persists project, versions, proposals, and export runs independently", async () => {
    const movie = await createMovie("Project movie");
    const project = await createReviewProjectFromMovie(movie.id);
    const updated = await updateReviewProject({
      ...project,
      selectedTarget: { type: "clip", clipId: "clip-a" },
    });

    const version: MovieVersion = {
      id: "version-a",
      movieId: movie.id,
      projectId: project.id,
      name: "Director alt A",
      description: "First alternate ordering",
      clips: [],
      createdAt: "2026-06-27T00:00:00.000Z",
      updatedAt: "2026-06-27T00:00:00.000Z",
    };
    await saveMovieVersion(version);

    const proposal: DirectorProposal = {
      id: "proposal-a",
      movieId: movie.id,
      projectId: project.id,
      status: "pending",
      title: "Tighter opening",
      rationale: "Lead with the strongest motion.",
      confidence: 0.87,
      changes: [{ type: "move-clip", clipId: "clip-a", toIndex: 0 }],
      createdAt: "2026-06-27T00:00:00.000Z",
    };
    await saveDirectorProposal(proposal);

    const exportRun: MovieExportRun = {
      id: "export-a",
      movieId: movie.id,
      projectId: project.id,
      status: "complete",
      format: "mp4",
      startedAt: "2026-06-27T00:00:00.000Z",
      completedAt: "2026-06-27T00:00:01.000Z",
      hasAudioTrack: true,
      bytes: 1024,
      outputName: "project-movie.mp4",
    };
    await saveExportRun(exportRun);

    await expect(getReviewProject(project.id)).resolves.toMatchObject({
      id: updated.id,
      selectedTarget: { type: "clip", clipId: "clip-a" },
    });
    await expect(listMovieVersions(movie.id)).resolves.toEqual([version]);
  });
});
```

- [ ] **Step 3: Run storage tests to verify they fail**

Run:

```bash
npm --prefix web run test:unit -- movie-review-storage
```

Expected: FAIL because `movie-review-storage` and Review Bay stores do not exist.

- [ ] **Step 4: Add Review Bay types and schemas**

Create `web/src/lib/movie-review-types.ts`:

```ts
import { z } from "zod";
import type { MovieClip } from "./types";

export const movieModeSchema = z.enum(["review", "focus", "assemble"]);
export type MovieMode = z.infer<typeof movieModeSchema>;

export const clipLifecycleSchema = z.enum(["proposed", "kept", "rejected"]);
export type ClipLifecycle = z.infer<typeof clipLifecycleSchema>;

export const clipFlagSchema = z.enum(["trimmed", "has-source-audio", "muted-in-mix", "export-safe", "needs-attention"]);
export type ClipFlag = z.infer<typeof clipFlagSchema>;

export interface ReviewClip extends MovieClip {
  lifecycle: ClipLifecycle;
  flags: ClipFlag[];
  volume: number;
  muted: boolean;
  solo: boolean;
  hasSourceAudio: boolean | "unknown";
  audioDetectionError?: string;
  mediaError?: string;
}

export interface SelectedTarget {
  type: "clip" | "candidate" | "proposal";
  clipId: string;
}

export interface MovieReviewProject {
  id: string;
  movieId: string;
  mode: MovieMode;
  selectedTarget: SelectedTarget | null;
  candidates: ReviewClip[];
  committedClips: ReviewClip[];
  activeFilter: "proposed" | "kept" | "rejected" | "needs-attention" | "all";
  masterAudio: {
    volume: number;
    muted: boolean;
    solo: boolean;
    duckUnderSource: boolean;
  };
  createdAt: string;
  updatedAt: string;
}

export interface MovieVersion {
  id: string;
  movieId: string;
  projectId: string;
  name: string;
  description: string;
  clips: ReviewClip[];
  createdAt: string;
  updatedAt: string;
}

export const directorChangeSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("keep-clip"), clipId: z.string() }),
  z.object({ type: z.literal("reject-clip"), clipId: z.string(), reason: z.string().optional() }),
  z.object({ type: z.literal("move-clip"), clipId: z.string(), toIndex: z.number().int().min(0) }),
  z.object({ type: z.literal("trim-clip"), clipId: z.string(), trimStart: z.number().min(0), trimEnd: z.number().positive() }),
  z.object({ type: z.literal("set-volume"), clipId: z.string(), volume: z.number().min(0).max(2) }),
  z.object({ type: z.literal("create-version"), name: z.string().min(1), clipIds: z.array(z.string()) }),
  z.object({ type: z.literal("add-note"), clipId: z.string(), body: z.string().min(1), timeSeconds: z.number().min(0).optional() }),
]);
export type DirectorChange = z.infer<typeof directorChangeSchema>;

export const directorProposalSchema = z.object({
  id: z.string(),
  movieId: z.string(),
  projectId: z.string(),
  status: z.enum(["pending", "partially-applied", "applied", "rejected", "invalid"]),
  title: z.string().min(1),
  rationale: z.string().min(1),
  confidence: z.number().min(0).max(1),
  changes: z.array(directorChangeSchema).min(1),
  validationError: z.string().optional(),
  createdAt: z.string(),
  appliedAt: z.string().optional(),
});
export type DirectorProposal = z.infer<typeof directorProposalSchema>;

export interface MovieExportRun {
  id: string;
  movieId: string;
  projectId: string;
  status: "queued" | "running" | "complete" | "failed" | "cancelled";
  format: "mp4" | "webm";
  startedAt: string;
  completedAt?: string;
  failureReason?: string;
  hasAudioTrack: boolean;
  bytes?: number;
  outputName?: string;
}

export interface MovieReviewNote {
  id: string;
  movieId: string;
  projectId: string;
  clipId?: string;
  proposalId?: string;
  body: string;
  timeSeconds?: number;
  createdAt: string;
}

export interface DirectorProviderConfig {
  enabled: boolean;
  baseUrl: string;
  model: string;
  apiKeyEnvName: string;
}
```

Modify `web/src/lib/types.ts` by adding these optional fields to `MovieClip` and `Movie` without removing existing fields:

```ts
  lifecycle?: "proposed" | "kept" | "rejected";
  flags?: Array<"trimmed" | "has-source-audio" | "muted-in-mix" | "export-safe" | "needs-attention">;
  volume?: number;
  muted?: boolean;
  solo?: boolean;
  hasSourceAudio?: boolean | "unknown";
  mediaError?: string;
  audioDetectionError?: string;
```

```ts
  reviewProjectId?: string;
```

- [ ] **Step 5: Add additive stores and storage helpers**

Modify `web/src/lib/local-storage.ts`:

```ts
const DB_VERSION = 6;
```

Inside the `upgrade` callback, after `upgradeVaultStores(db);`, add:

```ts
        if (!db.objectStoreNames.contains("movie_review_projects")) {
          const store = db.createObjectStore("movie_review_projects", { keyPath: "id" });
          store.createIndex("by-movie", "movieId");
          store.createIndex("by-updated", "updatedAt");
        } else {
          const store = transaction.objectStore("movie_review_projects");
          ensureIndex(store, "by-movie", "movieId");
          ensureIndex(store, "by-updated", "updatedAt");
        }
        if (!db.objectStoreNames.contains("movie_versions")) {
          const store = db.createObjectStore("movie_versions", { keyPath: "id" });
          store.createIndex("by-movie", "movieId");
          store.createIndex("by-project", "projectId");
        } else {
          const store = transaction.objectStore("movie_versions");
          ensureIndex(store, "by-movie", "movieId");
          ensureIndex(store, "by-project", "projectId");
        }
        if (!db.objectStoreNames.contains("movie_director_proposals")) {
          const store = db.createObjectStore("movie_director_proposals", { keyPath: "id" });
          store.createIndex("by-movie", "movieId");
          store.createIndex("by-project", "projectId");
          store.createIndex("by-status", "status");
        } else {
          const store = transaction.objectStore("movie_director_proposals");
          ensureIndex(store, "by-movie", "movieId");
          ensureIndex(store, "by-project", "projectId");
          ensureIndex(store, "by-status", "status");
        }
        if (!db.objectStoreNames.contains("movie_export_runs")) {
          const store = db.createObjectStore("movie_export_runs", { keyPath: "id" });
          store.createIndex("by-movie", "movieId");
          store.createIndex("by-project", "projectId");
        } else {
          const store = transaction.objectStore("movie_export_runs");
          ensureIndex(store, "by-movie", "movieId");
          ensureIndex(store, "by-project", "projectId");
        }
        if (!db.objectStoreNames.contains("movie_review_notes")) {
          const store = db.createObjectStore("movie_review_notes", { keyPath: "id" });
          store.createIndex("by-movie", "movieId");
          store.createIndex("by-project", "projectId");
        } else {
          const store = transaction.objectStore("movie_review_notes");
          ensureIndex(store, "by-movie", "movieId");
          ensureIndex(store, "by-project", "projectId");
        }
```

Create `web/src/lib/movie-review-storage.ts`:

```ts
import { v4 as uuidv4 } from "uuid";
import { getDB, getMovie, updateMovie } from "./local-storage";
import type { Movie, MovieClip } from "./types";
import type { DirectorProposal, MovieExportRun, MovieReviewNote, MovieReviewProject, MovieVersion, ReviewClip } from "./movie-review-types";

function nowIso(): string {
  return new Date().toISOString();
}

function toReviewClip(clip: MovieClip): ReviewClip {
  const hasTrim = typeof clip.trimStart === "number" || typeof clip.trimEnd === "number";
  const hasSourceAudio = clip.hasSourceAudio ?? "unknown";
  const muted = clip.muted ?? false;
  const flags: ReviewClip["flags"] = [
    ...(hasTrim ? ["trimmed" as const] : []),
    ...(hasSourceAudio === true ? ["has-source-audio" as const] : []),
    ...(muted ? ["muted-in-mix" as const] : []),
    ...(clip.flags?.includes("needs-attention") ? ["needs-attention" as const] : []),
  ];
  return {
    ...clip,
    lifecycle: clip.lifecycle ?? "proposed",
    flags,
    volume: clip.volume ?? 1,
    muted,
    solo: clip.solo ?? false,
    hasSourceAudio,
    mediaError: clip.mediaError,
    audioDetectionError: clip.audioDetectionError,
  };
}

export function projectFromMovie(movie: Movie): MovieReviewProject {
  const timestamp = nowIso();
  const committedClips = movie.clips.map((clip) => ({ ...toReviewClip(clip), lifecycle: clip.lifecycle ?? "kept" }));
  return {
    id: movie.reviewProjectId || uuidv4(),
    movieId: movie.id,
    mode: "review",
    selectedTarget: committedClips[0] ? { type: "clip", clipId: committedClips[0].id } : null,
    candidates: [],
    committedClips,
    activeFilter: "all",
    masterAudio: { volume: 1, muted: false, solo: false, duckUnderSource: false },
    createdAt: movie.createdAt || timestamp,
    updatedAt: timestamp,
  };
}

export async function createReviewProjectFromMovie(movieId: string): Promise<MovieReviewProject> {
  const movie = await getMovie(movieId);
  if (!movie) throw new Error("MOVIE_NOT_FOUND");
  const project = projectFromMovie(movie);
  const db = await getDB();
  await db.put("movie_review_projects", project);
  if (movie.reviewProjectId !== project.id) {
    await updateMovie({ ...movie, reviewProjectId: project.id });
  }
  return project;
}

export async function getReviewProject(projectId: string): Promise<MovieReviewProject | undefined> {
  const db = await getDB();
  return db.get("movie_review_projects", projectId) as Promise<MovieReviewProject | undefined>;
}

export async function getReviewProjectByMovie(movieId: string): Promise<MovieReviewProject | undefined> {
  const db = await getDB();
  const index = db.transaction("movie_review_projects").store.index("by-movie");
  return index.get(movieId) as Promise<MovieReviewProject | undefined>;
}

export async function updateReviewProject(project: MovieReviewProject): Promise<MovieReviewProject> {
  const updated = { ...project, updatedAt: nowIso() };
  const db = await getDB();
  await db.put("movie_review_projects", updated);
  return updated;
}

export async function loadOrCreateReviewProject(movieId: string): Promise<MovieReviewProject> {
  const existing = await getReviewProjectByMovie(movieId);
  if (existing) return existing;
  return createReviewProjectFromMovie(movieId);
}

export async function saveMovieVersion(version: MovieVersion): Promise<MovieVersion> {
  const db = await getDB();
  await db.put("movie_versions", version);
  return version;
}

export async function listMovieVersions(movieId: string): Promise<MovieVersion[]> {
  const db = await getDB();
  const versions = await db.getAllFromIndex("movie_versions", "by-movie", movieId) as MovieVersion[];
  return versions.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

export async function saveDirectorProposal(proposal: DirectorProposal): Promise<DirectorProposal> {
  const db = await getDB();
  await db.put("movie_director_proposals", proposal);
  return proposal;
}

export async function listDirectorProposals(projectId: string): Promise<DirectorProposal[]> {
  const db = await getDB();
  const proposals = await db.getAllFromIndex("movie_director_proposals", "by-project", projectId) as DirectorProposal[];
  return proposals.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export async function saveExportRun(run: MovieExportRun): Promise<MovieExportRun> {
  const db = await getDB();
  await db.put("movie_export_runs", run);
  return run;
}

export async function listExportRuns(projectId: string): Promise<MovieExportRun[]> {
  const db = await getDB();
  const runs = await db.getAllFromIndex("movie_export_runs", "by-project", projectId) as MovieExportRun[];
  return runs.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
}

export async function saveReviewNote(note: MovieReviewNote): Promise<MovieReviewNote> {
  const db = await getDB();
  await db.put("movie_review_notes", note);
  return note;
}
```

- [ ] **Step 6: Run storage tests to verify they pass**

Run:

```bash
npm --prefix web run test:unit -- movie-review-storage
```

Expected: PASS.

- [ ] **Step 7: Run existing Vault movie draft tests**

Run:

```bash
npm --prefix web run test:unit -- vault-movie-drafts
```

Expected: PASS. Existing draft creation must not regress.

- [ ] **Step 8: Commit Task 1**

Run:

```bash
git add web/package.json web/package-lock.json web/src/lib/types.ts web/src/lib/local-storage.ts web/src/lib/movie-review-types.ts web/src/lib/movie-review-storage.ts web/src/lib/movie-review-storage.test.ts
git commit -m "feat(web): add movie review storage model"
```

## Task 2: Add Pure Review Commands, Timeline, And Export-Safe Logic

**Files:**
- Create: `web/src/lib/movie-review-reducer.ts`
- Create: `web/src/lib/movie-review-reducer.test.ts`
- Create: `web/src/lib/movie-timeline-model.ts`
- Create: `web/src/lib/movie-timeline-model.test.ts`

- [ ] **Step 1: Write failing reducer tests**

Create `web/src/lib/movie-review-reducer.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { applyReviewCommand, keyboardCommandForEvent, nextSelectableId } from "./movie-review-reducer";
import type { MovieReviewProject, ReviewClip } from "./movie-review-types";

function clip(id: string, lifecycle: ReviewClip["lifecycle"] = "proposed"): ReviewClip {
  return {
    id,
    type: "video",
    videoUrl: `/api/vault/media/${id}`,
    sourceAssetId: id,
    transition: { type: "cut", duration: 0 },
    position: 0,
    lifecycle,
    flags: [],
    volume: 1,
    muted: false,
    solo: false,
    hasSourceAudio: "unknown",
  };
}

function project(): MovieReviewProject {
  return {
    id: "project-1",
    movieId: "movie-1",
    mode: "review",
    selectedTarget: { type: "candidate", clipId: "a" },
    candidates: [clip("a"), clip("b"), clip("c")],
    committedClips: [],
    activeFilter: "proposed",
    masterAudio: { volume: 1, muted: false, solo: false, duckUnderSource: false },
    createdAt: "2026-06-27T00:00:00.000Z",
    updatedAt: "2026-06-27T00:00:00.000Z",
  };
}

describe("movie review reducer", () => {
  it("keeps a candidate, moves it to the committed strip, and auto-advances", () => {
    const result = applyReviewCommand(project(), { type: "keep-current" });
    expect(result.candidates.map((item) => item.id)).toEqual(["b", "c"]);
    expect(result.committedClips.map((item) => [item.id, item.lifecycle])).toEqual([["a", "kept"]]);
    expect(result.selectedTarget).toEqual({ type: "candidate", clipId: "b" });
  });

  it("rejects a candidate and auto-advances without adding it to the strip", () => {
    const result = applyReviewCommand(project(), { type: "reject-current" });
    expect(result.candidates.map((item) => [item.id, item.lifecycle])).toEqual([["b", "proposed"], ["c", "proposed"]]);
    expect(result.committedClips).toEqual([]);
    expect(result.selectedTarget).toEqual({ type: "candidate", clipId: "b" });
  });

  it("reorders committed clips with bounded indexes and announces movement", () => {
    const base = { ...project(), candidates: [], committedClips: [clip("a", "kept"), clip("b", "kept"), clip("c", "kept")], selectedTarget: { type: "clip" as const, clipId: "b" } };
    const result = applyReviewCommand(base, { type: "move-selected", direction: 1 });
    expect(result.committedClips.map((item) => item.id)).toEqual(["a", "c", "b"]);
    expect(result.lastAnnouncement).toBe("Clip 2 moved to position 3 of 3.");
  });

  it("maps K to pause in transport context and keep in grid context", () => {
    expect(keyboardCommandForEvent({ key: "k", code: "KeyK", metaKey: false, ctrlKey: false, altKey: false, shiftKey: false }, "transport")).toEqual({ type: "pause" });
    expect(keyboardCommandForEvent({ key: "k", code: "KeyK", metaKey: false, ctrlKey: false, altKey: false, shiftKey: false }, "grid")).toEqual({ type: "keep-current" });
  });

  it("finds the next undecided candidate", () => {
    expect(nextSelectableId([clip("a", "kept"), clip("b"), clip("c")], "a")).toBe("b");
    expect(nextSelectableId([clip("a", "rejected")], "a")).toBeNull();
  });
});
```

- [ ] **Step 2: Write failing timeline/export-safe tests**

Create `web/src/lib/movie-timeline-model.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildMovieTimeline, exportSafetyForClip, normalizeTrimRange } from "./movie-timeline-model";
import type { ReviewClip } from "./movie-review-types";

function clip(id: string, patch: Partial<ReviewClip> = {}): ReviewClip {
  return {
    id,
    type: "video",
    videoUrl: `/media/${id}.mp4`,
    sourceAssetId: id,
    transition: { type: "cut", duration: 0 },
    position: 0,
    lifecycle: "kept",
    flags: [],
    volume: 1,
    muted: false,
    solo: false,
    hasSourceAudio: true,
    ...patch,
  };
}

describe("movie timeline model", () => {
  it("builds time-proportional entries from trim ranges and durations", () => {
    const entries = buildMovieTimeline([clip("a", { trimStart: 1, trimEnd: 4 }), clip("b")], new Map([["a", 5], ["b", 2]]));
    expect(entries.map((entry) => ({ clipId: entry.clipId, start: entry.startTime, end: entry.endTime, duration: entry.duration }))).toEqual([
      { clipId: "a", start: 0, end: 3, duration: 3 },
      { clipId: "b", start: 3, end: 5, duration: 2 },
    ]);
  });

  it("normalizes invalid trim ranges into bounded durations", () => {
    expect(normalizeTrimRange({ start: -2, end: 99 }, 8)).toEqual({ start: 0, end: 8 });
    expect(normalizeTrimRange({ start: 7, end: 3 }, 8)).toEqual({ start: 3, end: 7 });
  });

  it("blocks export when audio intent is unknown and allows intentional mute", () => {
    expect(exportSafetyForClip(clip("a", { hasSourceAudio: "unknown" }), 5)).toMatchObject({ exportSafe: false, blockers: ["AUDIO_INTENT_UNRESOLVED"] });
    expect(exportSafetyForClip(clip("b", { hasSourceAudio: true, muted: true }), 5)).toMatchObject({ exportSafe: true, warnings: ["SOURCE_AUDIO_MUTED_IN_MIX"] });
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run:

```bash
npm --prefix web run test:unit -- movie-review-reducer movie-timeline-model
```

Expected: FAIL because reducer and timeline modules do not exist.

- [ ] **Step 4: Add reducer**

Create `web/src/lib/movie-review-reducer.ts`:

```ts
import type { MovieReviewProject, ReviewClip, SelectedTarget } from "./movie-review-types";

export type KeyboardContext = "grid" | "strip" | "loupe" | "transport" | "input";

export type ReviewCommand =
  | { type: "keep-current" }
  | { type: "reject-current" }
  | { type: "apply-proposal" }
  | { type: "pause" }
  | { type: "play" }
  | { type: "seek-backward" }
  | { type: "seek-forward" }
  | { type: "set-mode"; mode: MovieReviewProject["mode"] }
  | { type: "select"; target: SelectedTarget }
  | { type: "move-selected"; direction: -1 | 1 }
  | { type: "delete-selected" }
  | { type: "set-volume"; clipId: string; volume: number }
  | { type: "set-muted"; clipId: string; muted: boolean }
  | { type: "set-solo"; clipId: string; solo: boolean }
  | { type: "set-trim"; clipId: string; trimStart: number; trimEnd: number };

export interface MovieReviewProjectWithAnnouncement extends MovieReviewProject {
  lastAnnouncement?: string;
}

function selectedClipId(project: MovieReviewProject): string | null {
  return project.selectedTarget?.clipId ?? null;
}

export function nextSelectableId(items: ReviewClip[], currentId: string): string | null {
  const start = Math.max(0, items.findIndex((item) => item.id === currentId));
  const after = items.slice(start).find((item) => item.lifecycle === "proposed");
  if (after) return after.id;
  const before = items.slice(0, start).find((item) => item.lifecycle === "proposed");
  return before?.id ?? null;
}

function resequence(clips: ReviewClip[]): ReviewClip[] {
  return clips.map((clip, position) => ({ ...clip, position }));
}

function updateClip(clips: ReviewClip[], clipId: string, update: (clip: ReviewClip) => ReviewClip): ReviewClip[] {
  return clips.map((clip) => (clip.id === clipId ? update(clip) : clip));
}

export function applyReviewCommand(project: MovieReviewProject, command: ReviewCommand): MovieReviewProjectWithAnnouncement {
  const clipId = selectedClipId(project);
  if (command.type === "select") return { ...project, selectedTarget: command.target };
  if (command.type === "set-mode") return { ...project, mode: command.mode };
  if (!clipId) return project;

  if (command.type === "keep-current") {
    const candidate = project.candidates.find((clip) => clip.id === clipId);
    if (!candidate) return project;
    const remaining = project.candidates.filter((clip) => clip.id !== clipId);
    const kept = { ...candidate, lifecycle: "kept" as const };
    const nextId = nextSelectableId(remaining, clipId);
    return {
      ...project,
      candidates: remaining,
      committedClips: resequence([...project.committedClips, kept]),
      selectedTarget: nextId ? { type: "candidate", clipId: nextId } : { type: "clip", clipId: kept.id },
      lastAnnouncement: `Kept clip ${kept.id}.`,
    };
  }

  if (command.type === "reject-current") {
    const remaining = project.candidates.filter((clip) => clip.id !== clipId);
    const nextId = nextSelectableId(remaining, clipId);
    return {
      ...project,
      candidates: remaining,
      selectedTarget: nextId ? { type: "candidate", clipId: nextId } : project.committedClips[0] ? { type: "clip", clipId: project.committedClips[0].id } : null,
      lastAnnouncement: `Rejected clip ${clipId}.`,
    };
  }

  if (command.type === "move-selected") {
    const oldIndex = project.committedClips.findIndex((clip) => clip.id === clipId);
    if (oldIndex === -1) return project;
    const newIndex = Math.max(0, Math.min(project.committedClips.length - 1, oldIndex + command.direction));
    if (oldIndex === newIndex) return project;
    const next = [...project.committedClips];
    const [moved] = next.splice(oldIndex, 1);
    next.splice(newIndex, 0, moved);
    return {
      ...project,
      committedClips: resequence(next),
      lastAnnouncement: `Clip ${oldIndex + 1} moved to position ${newIndex + 1} of ${next.length}.`,
    };
  }

  if (command.type === "delete-selected") {
    const next = project.committedClips.filter((clip) => clip.id !== clipId);
    return { ...project, committedClips: resequence(next), selectedTarget: next[0] ? { type: "clip", clipId: next[0].id } : null };
  }

  if (command.type === "set-volume") {
    return { ...project, committedClips: updateClip(project.committedClips, command.clipId, (clip) => ({ ...clip, volume: command.volume })) };
  }

  if (command.type === "set-muted") {
    return { ...project, committedClips: updateClip(project.committedClips, command.clipId, (clip) => ({ ...clip, muted: command.muted })) };
  }

  if (command.type === "set-solo") {
    return { ...project, committedClips: updateClip(project.committedClips, command.clipId, (clip) => ({ ...clip, solo: command.solo })) };
  }

  if (command.type === "set-trim") {
    return { ...project, committedClips: updateClip(project.committedClips, command.clipId, (clip) => ({ ...clip, trimStart: command.trimStart, trimEnd: command.trimEnd, flags: Array.from(new Set([...clip.flags, "trimmed"])) })) };
  }

  return project;
}

export function keyboardCommandForEvent(
  event: Pick<KeyboardEvent, "key" | "code" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">,
  context: KeyboardContext,
): ReviewCommand | null {
  if (context === "input") return null;
  const key = event.key.toLowerCase();
  if ((event.metaKey || event.ctrlKey) && key === "k") return null;
  if (event.altKey && event.code === "ArrowLeft") return { type: "move-selected", direction: -1 };
  if (event.altKey && event.code === "ArrowRight") return { type: "move-selected", direction: 1 };
  if (key === "j") return { type: "seek-backward" };
  if (key === "l") return { type: "seek-forward" };
  if (key === "k") return context === "transport" ? { type: "pause" } : { type: "keep-current" };
  if (key === "enter") return context === "loupe" ? { type: "keep-current" } : null;
  if (key === "x") return { type: "reject-current" };
  if (key === "a") return { type: "apply-proposal" };
  if (key === "f") return { type: "set-mode", mode: "focus" };
  return null;
}
```

- [ ] **Step 5: Add timeline/export-safe model**

Create `web/src/lib/movie-timeline-model.ts`:

```ts
import type { ReviewClip } from "./movie-review-types";

export interface TimelineEntry {
  clipId: string;
  index: number;
  startTime: number;
  endTime: number;
  duration: number;
  sourceStart: number;
  sourceEnd: number;
}

export interface TrimRange {
  start: number;
  end: number;
}

export interface ClipExportSafety {
  exportSafe: boolean;
  blockers: string[];
  warnings: string[];
}

export function normalizeTrimRange(range: TrimRange, duration: number): TrimRange {
  const boundedStart = Math.max(0, Math.min(duration, range.start));
  const boundedEnd = Math.max(0, Math.min(duration, range.end));
  const start = Math.min(boundedStart, boundedEnd);
  const end = Math.max(boundedStart, boundedEnd);
  return end - start < 0.05 ? { start: 0, end: duration } : { start, end };
}

export function clipDuration(clip: ReviewClip, durationByClipId: Map<string, number>): number {
  if (clip.type === "title") return clip.titleDuration ?? 3;
  if (clip.type === "image") return clip.stillDuration ?? 3;
  const sourceDuration = durationByClipId.get(clip.id) ?? 5;
  const range = normalizeTrimRange({ start: clip.trimStart ?? 0, end: clip.trimEnd ?? sourceDuration }, sourceDuration);
  return Math.max(0, range.end - range.start);
}

export function buildMovieTimeline(clips: ReviewClip[], durationByClipId: Map<string, number>): TimelineEntry[] {
  let cursor = 0;
  return clips.map((clip, index) => {
    const sourceDuration = durationByClipId.get(clip.id) ?? (clip.type === "title" ? clip.titleDuration ?? 3 : clip.type === "image" ? clip.stillDuration ?? 3 : 5);
    const trim = normalizeTrimRange({ start: clip.trimStart ?? 0, end: clip.trimEnd ?? sourceDuration }, sourceDuration);
    const duration = clip.type === "video" ? trim.end - trim.start : clipDuration(clip, durationByClipId);
    const entry = { clipId: clip.id, index, startTime: cursor, endTime: cursor + duration, duration, sourceStart: trim.start, sourceEnd: trim.end };
    cursor += duration;
    return entry;
  });
}

export function exportSafetyForClip(clip: ReviewClip, sourceDuration: number): ClipExportSafety {
  const blockers: string[] = [];
  const warnings: string[] = [];
  if (clip.type === "video" && !clip.videoUrl) blockers.push("VIDEO_URL_MISSING");
  if (!clip.sourceAssetId && clip.type !== "title") blockers.push("LOCAL_PROVENANCE_MISSING");
  if (sourceDuration <= 0) blockers.push("DURATION_INVALID");
  if (clip.hasSourceAudio === "unknown") blockers.push("AUDIO_INTENT_UNRESOLVED");
  if (clip.hasSourceAudio === true && clip.muted) warnings.push("SOURCE_AUDIO_MUTED_IN_MIX");
  if (clip.mediaError) blockers.push("MEDIA_LOAD_FAILED");
  if (clip.audioDetectionError) blockers.push("AUDIO_DETECTION_FAILED");
  return { exportSafe: blockers.length === 0, blockers, warnings };
}
```

- [ ] **Step 6: Run unit tests**

Run:

```bash
npm --prefix web run test:unit -- movie-review-reducer movie-timeline-model
```

Expected: PASS.

- [ ] **Step 7: Commit Task 2**

Run:

```bash
git add web/src/lib/movie-review-reducer.ts web/src/lib/movie-review-reducer.test.ts web/src/lib/movie-timeline-model.ts web/src/lib/movie-timeline-model.test.ts
git commit -m "feat(web): add movie review state model"
```

## Task 3: Add Director Schemas, Rule Fallback, And OpenAI-Compatible Adapter

**Files:**
- Create: `web/src/lib/movie-director.ts`
- Create: `web/src/lib/movie-director.test.ts`

- [ ] **Step 1: Write failing Director tests**

Create `web/src/lib/movie-director.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { applyDirectorChanges, createRuleBasedProposal, requestDirectorProposal, validateDirectorPayload } from "./movie-director";
import type { MovieReviewProject, ReviewClip } from "./movie-review-types";

function clip(id: string): ReviewClip {
  return {
    id,
    type: "video",
    videoUrl: `/media/${id}.mp4`,
    sourceAssetId: id,
    transition: { type: "cut", duration: 0 },
    position: 0,
    lifecycle: "kept",
    flags: [],
    volume: 1,
    muted: false,
    solo: false,
    hasSourceAudio: true,
  };
}

function project(): MovieReviewProject {
  return {
    id: "project-1",
    movieId: "movie-1",
    mode: "review",
    selectedTarget: null,
    candidates: [clip("c")],
    committedClips: [clip("a"), clip("b")],
    activeFilter: "all",
    masterAudio: { volume: 1, muted: false, solo: false, duckUnderSource: false },
    createdAt: "2026-06-27T00:00:00.000Z",
    updatedAt: "2026-06-27T00:00:00.000Z",
  };
}

describe("movie director", () => {
  it("creates a deterministic rule-based proposal with no provider configured", () => {
    const proposal = createRuleBasedProposal(project(), "2026-06-27T00:00:00.000Z");
    expect(proposal.status).toBe("pending");
    expect(proposal.confidence).toBeGreaterThan(0);
    expect(proposal.changes.length).toBeGreaterThan(0);
  });

  it("rejects invalid provider output without mutating project state", () => {
    const parsed = validateDirectorPayload({ title: "", changes: [] }, project());
    expect(parsed.status).toBe("invalid");
    expect(parsed.validationError).toContain("Invalid Director response");
  });

  it("applies only selected proposal changes to a copy of the project", () => {
    const base = project();
    const proposal = {
      id: "proposal-1",
      movieId: "movie-1",
      projectId: "project-1",
      status: "pending" as const,
      title: "Move B first",
      rationale: "Better opening motion.",
      confidence: 0.8,
      changes: [{ type: "move-clip" as const, clipId: "b", toIndex: 0 }],
      createdAt: "2026-06-27T00:00:00.000Z",
    };
    const updated = applyDirectorChanges(base, proposal, [0]);
    expect(updated.committedClips.map((clip) => clip.id)).toEqual(["b", "a"]);
    expect(base.committedClips.map((clip) => clip.id)).toEqual(["a", "b"]);
  });

  it("uses an OpenAI-compatible chat completions payload for configured providers", async () => {
    const calls: unknown[] = [];
    const response = await requestDirectorProposal(project(), {
      enabled: true,
      baseUrl: "http://127.0.0.1:8317/v1",
      model: "fake-model",
      apiKeyEnvName: "CLIENT_API_KEY",
    }, async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({ title: "Keep A", rationale: "Strongest clip.", confidence: 0.7, changes: [{ type: "keep-clip", clipId: "a" }] }) } }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }, "client-sample");
    expect(response.status).toBe("pending");
    expect(calls[0]).toMatchObject({ url: "http://127.0.0.1:8317/v1/chat/completions" });
  });
});
```

- [ ] **Step 2: Run Director tests to verify they fail**

Run:

```bash
npm --prefix web run test:unit -- movie-director
```

Expected: FAIL because `movie-director.ts` does not exist.

- [ ] **Step 3: Add Director module**

Create `web/src/lib/movie-director.ts`:

```ts
import { v4 as uuidv4 } from "uuid";
import { z } from "zod";
import type { DirectorChange, DirectorProposal, DirectorProviderConfig, MovieReviewProject, ReviewClip } from "./movie-review-types";
import { directorChangeSchema, directorProposalSchema } from "./movie-review-types";

type Fetcher = typeof fetch;

const providerResponseSchema = z.object({
  title: z.string().min(1),
  rationale: z.string().min(1),
  confidence: z.number().min(0).max(1),
  changes: z.array(directorChangeSchema).min(1),
});

function nowIso(now?: string): string {
  return now ?? new Date().toISOString();
}

function baseProposal(project: MovieReviewProject, now?: string): Omit<DirectorProposal, "title" | "rationale" | "confidence" | "changes"> {
  return {
    id: uuidv4(),
    movieId: project.movieId,
    projectId: project.id,
    status: "pending",
    createdAt: nowIso(now),
  };
}

function describeClip(clip: ReviewClip): string {
  return `${clip.id} ${clip.sourceAssetId ?? "unknown-source"} ${clip.lifecycle} volume=${clip.volume} muted=${clip.muted}`;
}

export function createRuleBasedProposal(project: MovieReviewProject, now?: string): DirectorProposal {
  const changes: DirectorChange[] = [];
  for (const candidate of project.candidates.slice(0, 3)) {
    changes.push({ type: "keep-clip", clipId: candidate.id });
  }
  if (project.committedClips.length > 1) {
    changes.push({ type: "move-clip", clipId: project.committedClips[0].id, toIndex: 0 });
  }
  return directorProposalSchema.parse({
    ...baseProposal(project, now),
    title: "Rule-based assembly pass",
    rationale: "Keeps the first strong candidates and preserves existing committed order.",
    confidence: 0.55,
    changes: changes.length > 0 ? changes : [{ type: "add-note", clipId: project.committedClips[0]?.id ?? "project", body: "No eligible automatic changes found." }],
  });
}

export function validateDirectorPayload(payload: unknown, project: MovieReviewProject): DirectorProposal {
  const parsed = providerResponseSchema.safeParse(payload);
  if (!parsed.success) {
    return {
      ...baseProposal(project),
      status: "invalid",
      title: "Invalid Director response",
      rationale: "Provider output did not match the Director schema.",
      confidence: 0,
      changes: [{ type: "add-note", clipId: project.committedClips[0]?.id ?? "project", body: "Invalid provider response." }],
      validationError: `Invalid Director response: ${parsed.error.issues.map((issue) => issue.message).join(", ")}`,
    };
  }
  return directorProposalSchema.parse({ ...baseProposal(project), ...parsed.data });
}

export async function requestDirectorProposal(
  project: MovieReviewProject,
  config: DirectorProviderConfig,
  fetcher: Fetcher = fetch,
  apiKey?: string,
): Promise<DirectorProposal> {
  if (!config.enabled) return createRuleBasedProposal(project);
  if (!apiKey) throw new Error("DIRECTOR_API_KEY_MISSING");
  const url = `${config.baseUrl.replace(/\/$/, "")}/chat/completions`;
  const prompt = [
    "You are Director for a local movie review tool.",
    "Return JSON only with title, rationale, confidence, and changes.",
    "Never mutate current state directly. Propose a reviewable changeset.",
    `Committed clips: ${project.committedClips.map(describeClip).join("; ")}`,
    `Candidate clips: ${project.candidates.map(describeClip).join("; ")}`,
  ].join("\n");
  const response = await fetcher(url, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: config.model,
      messages: [
        { role: "system", content: "Return valid JSON only." },
        { role: "user", content: prompt },
      ],
      temperature: 0.2,
    }),
  });
  if (!response.ok) throw new Error(`DIRECTOR_PROVIDER_HTTP_${response.status}`);
  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string") return validateDirectorPayload(data, project);
  try {
    return validateDirectorPayload(JSON.parse(content), project);
  } catch {
    return validateDirectorPayload(content, project);
  }
}

export function applyDirectorChanges(project: MovieReviewProject, proposal: DirectorProposal, changeIndexes: number[]): MovieReviewProject {
  const selected = new Set(changeIndexes);
  let committed = [...project.committedClips];
  let candidates = [...project.candidates];
  for (const [index, change] of proposal.changes.entries()) {
    if (!selected.has(index)) continue;
    if (change.type === "keep-clip") {
      const candidate = candidates.find((clip) => clip.id === change.clipId);
      if (candidate) {
        candidates = candidates.filter((clip) => clip.id !== change.clipId);
        committed = [...committed, { ...candidate, lifecycle: "kept" }];
      }
    }
    if (change.type === "reject-clip") {
      candidates = candidates.filter((clip) => clip.id !== change.clipId);
    }
    if (change.type === "move-clip") {
      const oldIndex = committed.findIndex((clip) => clip.id === change.clipId);
      if (oldIndex !== -1) {
        const [moved] = committed.splice(oldIndex, 1);
        committed.splice(Math.max(0, Math.min(change.toIndex, committed.length)), 0, moved);
      }
    }
    if (change.type === "trim-clip") {
      committed = committed.map((clip) => clip.id === change.clipId ? { ...clip, trimStart: change.trimStart, trimEnd: change.trimEnd, flags: Array.from(new Set([...clip.flags, "trimmed"])) } : clip);
    }
    if (change.type === "set-volume") {
      committed = committed.map((clip) => clip.id === change.clipId ? { ...clip, volume: change.volume } : clip);
    }
  }
  return {
    ...project,
    candidates,
    committedClips: committed.map((clip, position) => ({ ...clip, position })),
  };
}
```

- [ ] **Step 4: Run Director tests**

Run:

```bash
npm --prefix web run test:unit -- movie-director
```

Expected: PASS.

- [ ] **Step 5: Commit Task 3**

Run:

```bash
git add web/src/lib/movie-director.ts web/src/lib/movie-director.test.ts
git commit -m "feat(web): add movie director proposals"
```

## Task 4: Add FFmpeg Export Argument Builder And Audio Proof Contract

**Files:**
- Create: `web/src/lib/movie-export-args.ts`
- Create: `web/src/lib/movie-export-args.test.ts`

- [ ] **Step 1: Write failing export args tests**

Create `web/src/lib/movie-export-args.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildMovieExportArgs, outputMimeForFormat, validateExportAudioProof } from "./movie-export-args";
import type { ReviewClip } from "./movie-review-types";

function clip(id: string, patch: Partial<ReviewClip> = {}): ReviewClip {
  return {
    id,
    type: "video",
    videoUrl: `/media/${id}.mp4`,
    sourceAssetId: id,
    transition: { type: "cut", duration: 0 },
    position: 0,
    lifecycle: "kept",
    flags: ["has-source-audio", "export-safe"],
    volume: 1,
    muted: false,
    solo: false,
    hasSourceAudio: true,
    ...patch,
  };
}

describe("movie export args", () => {
  it("builds MP4 args with h264 video and AAC audio", () => {
    const args = buildMovieExportArgs({ format: "mp4", width: 1080, height: 1920, fps: 30, clips: [clip("a")], durations: new Map([["a", 2]]) });
    expect(args).toContain("-filter_complex");
    expect(args).toContain("-c:v");
    expect(args).toContain("libx264");
    expect(args).toContain("-c:a");
    expect(args).toContain("aac");
    expect(args.at(-1)).toBe("output.mp4");
  });

  it("uses generated silence for muted source audio so the MP4 still has an intentional audio track", () => {
    const args = buildMovieExportArgs({ format: "mp4", width: 1080, height: 1920, fps: 30, clips: [clip("a", { muted: true })], durations: new Map([["a", 2]]) });
    expect(args.join(" ")).toContain("anullsrc");
  });

  it("keeps WebM fallback separate from MP4", () => {
    expect(outputMimeForFormat("mp4")).toBe("video/mp4");
    expect(outputMimeForFormat("webm")).toBe("video/webm");
  });

  it("requires audio proof for MP4 when source mix has audio", () => {
    expect(validateExportAudioProof({ format: "mp4", expectedAudio: true, hasAudioTrack: false })).toEqual({ ok: false, reason: "MP4_AUDIO_TRACK_MISSING" });
    expect(validateExportAudioProof({ format: "mp4", expectedAudio: true, hasAudioTrack: true })).toEqual({ ok: true });
  });
});
```

- [ ] **Step 2: Run export args tests to verify they fail**

Run:

```bash
npm --prefix web run test:unit -- movie-export-args
```

Expected: FAIL because `movie-export-args.ts` does not exist.

- [ ] **Step 3: Add export args module**

Create `web/src/lib/movie-export-args.ts`:

```ts
import type { ReviewClip } from "./movie-review-types";
import { normalizeTrimRange } from "./movie-timeline-model";

export interface MovieExportArgsInput {
  format: "mp4" | "webm";
  width: number;
  height: number;
  fps: number;
  clips: ReviewClip[];
  durations: Map<string, number>;
}

export interface ExportAudioProofInput {
  format: "mp4" | "webm";
  expectedAudio: boolean;
  hasAudioTrack: boolean;
}

export function outputNameForFormat(format: "mp4" | "webm"): string {
  return format === "mp4" ? "output.mp4" : "output.webm";
}

export function outputMimeForFormat(format: "mp4" | "webm"): string {
  return format === "mp4" ? "video/mp4" : "video/webm";
}

function inputName(index: number): string {
  return `clip-${index}.mp4`;
}

function videoFilter(index: number, clip: ReviewClip, duration: number, width: number, height: number, fps: number): string {
  const trim = normalizeTrimRange({ start: clip.trimStart ?? 0, end: clip.trimEnd ?? duration }, duration);
  return `[${index}:v]trim=start=${trim.start.toFixed(3)}:end=${trim.end.toFixed(3)},setpts=PTS-STARTPTS,scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${fps},format=yuv420p[v${index}]`;
}

function audioFilter(index: number, clip: ReviewClip, duration: number): string {
  const trim = normalizeTrimRange({ start: clip.trimStart ?? 0, end: clip.trimEnd ?? duration }, duration);
  const seconds = Math.max(0.05, trim.end - trim.start);
  if (clip.hasSourceAudio !== true || clip.muted) {
    return `anullsrc=channel_layout=stereo:sample_rate=48000,atrim=0:${seconds.toFixed(3)}[a${index}]`;
  }
  return `[${index}:a]atrim=start=${trim.start.toFixed(3)}:end=${trim.end.toFixed(3)},asetpts=PTS-STARTPTS,volume=${clip.volume.toFixed(3)}[a${index}]`;
}

export function buildMovieExportArgs(input: MovieExportArgsInput): string[] {
  const args: string[] = [];
  input.clips.forEach((_clip, index) => args.push("-i", inputName(index)));
  const filters: string[] = [];
  input.clips.forEach((clip, index) => {
    const duration = input.durations.get(clip.id) ?? 5;
    filters.push(videoFilter(index, clip, duration, input.width, input.height, input.fps));
    filters.push(audioFilter(index, clip, duration));
  });
  const joinedVideo = input.clips.map((_clip, index) => `[v${index}]`).join("");
  const joinedAudio = input.clips.map((_clip, index) => `[a${index}]`).join("");
  filters.push(`${joinedVideo}concat=n=${input.clips.length}:v=1:a=0[vout]`);
  filters.push(`${joinedAudio}concat=n=${input.clips.length}:v=0:a=1[aout]`);
  args.push("-filter_complex", filters.join(";"), "-map", "[vout]", "-map", "[aout]");
  if (input.format === "mp4") {
    args.push("-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-movflags", "+faststart", "output.mp4");
  } else {
    args.push("-c:v", "libvpx-vp9", "-b:v", "4M", "-c:a", "libopus", "output.webm");
  }
  return args;
}

export function validateExportAudioProof(input: ExportAudioProofInput): { ok: true } | { ok: false; reason: "MP4_AUDIO_TRACK_MISSING" | "WEBM_AUDIO_TRACK_MISSING" } {
  if (input.expectedAudio && !input.hasAudioTrack) {
    return { ok: false, reason: input.format === "mp4" ? "MP4_AUDIO_TRACK_MISSING" : "WEBM_AUDIO_TRACK_MISSING" };
  }
  return { ok: true };
}
```

- [ ] **Step 4: Run export args tests**

Run:

```bash
npm --prefix web run test:unit -- movie-export-args
```

Expected: PASS.

- [ ] **Step 5: Commit Task 4**

Run:

```bash
git add web/src/lib/movie-export-args.ts web/src/lib/movie-export-args.test.ts
git commit -m "feat(web): add movie export args"
```

## Task 5: Build Review Bay Shell, Header, Modes, And Keyboard Wiring

**Files:**
- Modify: `web/src/components/movie/MovieMaker.tsx`
- Create: `web/src/components/movie/review/useMovieReviewProject.ts`
- Create: `web/src/components/movie/review/useMovieKeyboard.ts`
- Create: `web/src/components/movie/review/MovieReviewBay.tsx`
- Create: `web/src/components/movie/review/MovieReviewHeader.tsx`
- Create: `web/src/components/movie/review/MovieStatusBadges.tsx`
- Create: `tests/e2e-web/movie-review-bay.spec.js`

- [ ] **Step 1: Write failing Review Bay E2E shell test**

Create `tests/e2e-web/movie-review-bay.spec.js`:

```js
const { test, expect } = require("@playwright/test");

async function seedReviewMovie(page) {
  await page.goto("/movie");
  return page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("grok-power-tools");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    const now = new Date().toISOString();
    const movie = {
      id: "review-bay-movie",
      name: "Review Bay Fixture",
      resolution: { w: 320, h: 240 },
      clips: [
        { id: "clip-a", type: "video", videoUrl: "/api/vault/media/asset-video-1?objectKey=grok-powertools%2Fv1%2Fusers%2Fgreymaker%2Fmedia%2Fby-asset%2Fasset-video-1.mp4", sourceAssetId: "asset-video-1", transition: { type: "cut", duration: 0 }, position: 0 },
        { id: "clip-b", type: "video", videoUrl: "/api/vault/media/asset-video-2?objectKey=grok-powertools%2Fv1%2Fusers%2Fgreymaker%2Fmedia%2Fby-asset%2Fasset-video-2.mp4", sourceAssetId: "asset-video-2", transition: { type: "cut", duration: 0 }, position: 1 },
      ],
      createdAt: now,
      updatedAt: now,
    };
    const tx = db.transaction("movies", "readwrite");
    tx.objectStore("movies").put(movie);
    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    db.close();
    return movie.id;
  });
}

test("Movie Maker opens as Review Bay with mode controls and typed regions", async ({ page }) => {
  const movieId = await seedReviewMovie(page);
  await page.goto(`/movie?id=${movieId}`);
  await expect(page.getByRole("heading", { name: /Review Bay Fixture/i })).toBeVisible();
  await expect(page.getByRole("tab", { name: /Draft Queue/i })).toBeVisible();
  await expect(page.getByRole("tab", { name: /Director/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /Review/i })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("region", { name: /Candidates Grid/i })).toBeVisible();
  await expect(page.getByRole("region", { name: /Clip Strip/i })).toBeVisible();
  await expect(page.getByRole("region", { name: /Inspector/i })).toBeVisible();
});

test("keyboard keep/reject commands auto-advance through candidates", async ({ page }) => {
  const movieId = await seedReviewMovie(page);
  await page.goto(`/movie?id=${movieId}`);
  await page.keyboard.press("KeyK");
  await expect(page.getByText(/Kept clip/i)).toBeVisible();
  await page.keyboard.press("KeyX");
  await expect(page.getByText(/Rejected clip/i)).toBeVisible();
});
```

- [ ] **Step 2: Run E2E shell test to verify it fails**

Run:

```bash
npx playwright test -c playwright.web.config.js tests/e2e-web/movie-review-bay.spec.js
```

Expected: FAIL because the current `/movie` surface is the simple editor.

- [ ] **Step 3: Add project hook and keyboard hook**

Create `web/src/components/movie/review/useMovieReviewProject.ts`:

```ts
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { loadOrCreateReviewProject, updateReviewProject } from "@/lib/movie-review-storage";
import type { MovieReviewProject } from "@/lib/movie-review-types";

export function useMovieReviewProject(movieId: string) {
  const [project, setProject] = useState<MovieReviewProject | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const saveRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loadOrCreateReviewProject(movieId)
      .then((next) => {
        if (!cancelled) setProject(next);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "PROJECT_LOAD_FAILED");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [movieId]);

  const saveProject = useCallback((next: MovieReviewProject) => {
    setProject(next);
    if (saveRef.current) window.clearTimeout(saveRef.current);
    saveRef.current = window.setTimeout(() => {
      updateReviewProject(next).catch((err) => setError(err instanceof Error ? err.message : "PROJECT_SAVE_FAILED"));
    }, 250);
  }, []);

  return { project, loading, error, saveProject };
}
```

Create `web/src/components/movie/review/useMovieKeyboard.ts`:

```ts
"use client";

import { useEffect } from "react";
import { applyReviewCommand, keyboardCommandForEvent, type KeyboardContext, type ReviewCommand } from "@/lib/movie-review-reducer";
import type { MovieReviewProject } from "@/lib/movie-review-types";

function contextFromTarget(target: EventTarget | null): KeyboardContext {
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return "input";
  const element = target instanceof HTMLElement ? target : null;
  if (element?.closest("[data-keyboard-context='transport']")) return "transport";
  if (element?.closest("[data-keyboard-context='loupe']")) return "loupe";
  if (element?.closest("[data-keyboard-context='strip']")) return "strip";
  return "grid";
}

export function useMovieKeyboard(project: MovieReviewProject | null, saveProject: (project: MovieReviewProject) => void, onTransportCommand: (command: ReviewCommand) => void) {
  useEffect(() => {
    if (!project) return;
    function onKeyDown(event: KeyboardEvent) {
      const command = keyboardCommandForEvent(event, contextFromTarget(event.target));
      if (!command) return;
      event.preventDefault();
      if (command.type === "pause" || command.type === "play" || command.type === "seek-backward" || command.type === "seek-forward") {
        onTransportCommand(command);
        return;
      }
      saveProject(applyReviewCommand(project, command));
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onTransportCommand, project, saveProject]);
}
```

- [ ] **Step 4: Add shell components**

Create `web/src/components/movie/review/MovieStatusBadges.tsx`:

```tsx
"use client";

import { Check, Diamond, Music, Scissors, Square, VolumeX, X } from "lucide-react";
import type { ClipFlag, ClipLifecycle } from "@/lib/movie-review-types";

const lifecycleLabel: Record<ClipLifecycle, string> = {
  proposed: "Proposed",
  kept: "Kept",
  rejected: "Rejected",
};

export function MovieLifecycleBadge({ lifecycle }: { lifecycle: ClipLifecycle }) {
  const Icon = lifecycle === "proposed" ? Diamond : lifecycle === "kept" ? Check : X;
  const classes = lifecycle === "proposed" ? "border-orange-400 text-orange-300" : lifecycle === "kept" ? "border-green-400 text-green-300" : "border-neutral-600 text-neutral-400";
  return (
    <span className={`inline-flex items-center gap-1 rounded-[3px] border px-1.5 py-0.5 text-[11px] ${classes}`} aria-label={`Lifecycle ${lifecycleLabel[lifecycle]}`}>
      <Icon className="h-3 w-3" />
      {lifecycleLabel[lifecycle]}
    </span>
  );
}

export function MovieFlagBadge({ flag }: { flag: ClipFlag }) {
  const icon = flag === "trimmed" ? Scissors : flag === "has-source-audio" ? Music : flag === "muted-in-mix" ? VolumeX : flag === "export-safe" ? Square : X;
  const Icon = icon;
  const label = flag.replace(/-/g, " ");
  return (
    <span className="inline-flex items-center gap-1 rounded-[3px] border border-neutral-600 px-1.5 py-0.5 text-[11px] text-neutral-300" aria-label={`Flag ${label}`}>
      <Icon className="h-3 w-3" />
      {label}
    </span>
  );
}
```

Create `web/src/components/movie/review/MovieReviewHeader.tsx`:

```tsx
"use client";

import { ArrowLeft, Clapperboard, Focus, Grid2X2, ListVideo } from "lucide-react";
import type { MovieMode, MovieReviewProject } from "@/lib/movie-review-types";
import MovieExportGate from "./MovieExportGate";

interface MovieReviewHeaderProps {
  title: string;
  project: MovieReviewProject;
  onBack: () => void;
  onModeChange: (mode: MovieMode) => void;
}

const modes: Array<{ mode: MovieMode; label: string; icon: React.ElementType }> = [
  { mode: "review", label: "Review", icon: Grid2X2 },
  { mode: "focus", label: "Focus", icon: Focus },
  { mode: "assemble", label: "Assemble", icon: ListVideo },
];

export default function MovieReviewHeader({ title, project, onBack, onModeChange }: MovieReviewHeaderProps) {
  return (
    <header className="flex min-h-12 items-center gap-3 border-b border-neutral-800 bg-neutral-950 px-4">
      <button type="button" onClick={onBack} className="rounded-[5px] p-1.5 text-neutral-400 hover:bg-neutral-900 hover:text-neutral-100" aria-label="Back to movies">
        <ArrowLeft className="h-4 w-4" />
      </button>
      <Clapperboard className="h-4 w-4 text-neutral-500" />
      <h1 className="max-w-[22rem] truncate text-base font-semibold text-neutral-100">{title}</h1>
      <span className="text-xs text-neutral-500">{project.committedClips.length} committed</span>
      <div className="ml-4 flex rounded-[5px] border border-neutral-800 bg-neutral-900 p-0.5" role="group" aria-label="Movie mode">
        {modes.map(({ mode, label, icon: Icon }) => (
          <button key={mode} type="button" aria-pressed={project.mode === mode} onClick={() => onModeChange(mode)} className={`flex min-h-8 items-center gap-1.5 rounded-[3px] px-2.5 text-xs ${project.mode === mode ? "bg-neutral-800 text-cyan-200" : "text-neutral-400 hover:text-neutral-100"}`}>
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>
      <div className="ml-auto">
        <MovieExportGate project={project} />
      </div>
    </header>
  );
}
```

Create `web/src/components/movie/review/MovieReviewBay.tsx`:

```tsx
"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import type { Movie } from "@/lib/types";
import { applyReviewCommand } from "@/lib/movie-review-reducer";
import MovieReviewHeader from "./MovieReviewHeader";
import MovieLeftRail from "./MovieLeftRail";
import MovieCandidatesGrid from "./MovieCandidatesGrid";
import MovieFocusLoupe from "./MovieFocusLoupe";
import MovieAssembleView from "./MovieAssembleView";
import MovieClipStrip from "./MovieClipStrip";
import MovieInspector from "./MovieInspector";
import { useMovieKeyboard } from "./useMovieKeyboard";
import { useMovieReviewProject } from "./useMovieReviewProject";

export default function MovieReviewBay({ movie }: { movie: Movie }) {
  const router = useRouter();
  const { project, loading, error, saveProject } = useMovieReviewProject(movie.id);
  const [announcement, setAnnouncement] = useState("");

  const onTransportCommand = useCallback(() => {}, []);

  useMovieKeyboard(project, (next) => {
    saveProject(next);
    if ("lastAnnouncement" in next && next.lastAnnouncement) setAnnouncement(next.lastAnnouncement);
  }, onTransportCommand);

  if (loading) return <div className="flex h-[calc(100vh-3.5rem)] items-center justify-center bg-neutral-950 text-sm text-neutral-400">Loading movie project...</div>;
  if (error || !project) return <div className="flex h-[calc(100vh-3.5rem)] items-center justify-center bg-neutral-950 text-sm text-red-300">{error || "Movie project unavailable"}</div>;

  return (
    <div className="flex h-[calc(100vh-3.5rem)] min-w-[1024px] flex-col bg-neutral-950 text-neutral-100">
      <MovieReviewHeader title={movie.name} project={project} onBack={() => router.push("/movie")} onModeChange={(mode) => saveProject(applyReviewCommand(project, { type: "set-mode", mode }))} />
      <div className="grid min-h-0 flex-1 grid-cols-[220px_minmax(720px,1fr)_280px] gap-3 p-3 max-[1439px]:grid-cols-[56px_minmax(720px,1fr)]">
        <MovieLeftRail project={project} onProjectChange={saveProject} />
        {project.mode === "review" && <MovieCandidatesGrid project={project} onProjectChange={saveProject} />}
        {project.mode === "focus" && <MovieFocusLoupe project={project} onProjectChange={saveProject} />}
        {project.mode === "assemble" && <MovieAssembleView project={project} onProjectChange={saveProject} />}
        <MovieInspector project={project} onProjectChange={saveProject} />
      </div>
      <MovieClipStrip project={project} onProjectChange={saveProject} />
      <div className="sr-only" aria-live="polite">{announcement}</div>
    </div>
  );
}
```

Modify `web/src/components/movie/MovieMaker.tsx` so it loads the existing `Movie` and renders `MovieReviewBay`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Movie } from "@/lib/types";
import { getMovie } from "@/lib/local-storage";
import MovieReviewBay from "./review/MovieReviewBay";

interface MovieMakerProps {
  movieId: string;
}

export default function MovieMaker({ movieId }: MovieMakerProps) {
  const router = useRouter();
  const [movie, setMovie] = useState<Movie | null>(null);

  useEffect(() => {
    getMovie(movieId).then((loaded) => {
      if (loaded) setMovie(loaded);
      else router.push("/movie");
    });
  }, [movieId, router]);

  if (!movie) {
    return (
      <div className="flex h-[calc(100vh-3.5rem)] items-center justify-center bg-neutral-950">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-neutral-600 border-t-cyan-300" />
      </div>
    );
  }

  return <MovieReviewBay movie={movie} />;
}
```

- [ ] **Step 5: Add shell surface components for the first E2E pass**

Create functional first-pass versions of `MovieExportGate.tsx`, `MovieLeftRail.tsx`, `MovieDraftQueue.tsx`, `MovieDirectorPanel.tsx`, `MovieCandidatesGrid.tsx`, `MovieFocusLoupe.tsx`, `MovieAssembleView.tsx`, `MovieClipStrip.tsx`, `MovieInspector.tsx`, `MoviePreview.tsx`, and `MovieWaveform.tsx`. These files must expose the named regions, render real project data, and call `applyReviewCommand`; Tasks 6-9 expand the same files instead of replacing fake placeholders.

Create `web/src/components/movie/review/MovieExportGate.tsx`:

```tsx
"use client";

import type { MovieReviewProject } from "@/lib/movie-review-types";

export default function MovieExportGate({ project }: { project: MovieReviewProject }) {
  const unresolved = project.candidates.length;
  return (
    <button type="button" disabled={project.committedClips.length === 0 || unresolved > 0} className="min-h-8 rounded-[5px] border border-neutral-700 px-3 text-xs text-neutral-200 disabled:text-neutral-500" aria-label={unresolved > 0 ? `Export blocked by ${unresolved} unresolved candidates` : "Export movie"}>
      {unresolved > 0 ? `Export blocked ${unresolved}` : "Export"}
    </button>
  );
}
```

Create `web/src/components/movie/review/MovieLeftRail.tsx`:

```tsx
"use client";

import { useState } from "react";
import type { MovieReviewProject } from "@/lib/movie-review-types";
import MovieDirectorPanel from "./MovieDirectorPanel";
import MovieDraftQueue from "./MovieDraftQueue";

export default function MovieLeftRail({ project, onProjectChange }: { project: MovieReviewProject; onProjectChange: (project: MovieReviewProject) => void }) {
  const [tab, setTab] = useState<"drafts" | "director">("drafts");
  return (
    <aside className="min-h-0 border border-neutral-800 bg-neutral-900" aria-label="Drafts and Director">
      <div className="flex border-b border-neutral-800">
        <button type="button" role="tab" aria-selected={tab === "drafts"} onClick={() => setTab("drafts")} className="min-h-8 flex-1 text-xs text-neutral-200">Draft Queue</button>
        <button type="button" role="tab" aria-selected={tab === "director"} onClick={() => setTab("director")} className="min-h-8 flex-1 text-xs text-neutral-200">Director</button>
      </div>
      {tab === "drafts" ? <MovieDraftQueue project={project} onProjectChange={onProjectChange} /> : <MovieDirectorPanel project={project} onProjectChange={onProjectChange} />}
    </aside>
  );
}
```

Create `web/src/components/movie/review/MovieDraftQueue.tsx`:

```tsx
"use client";

import type { MovieReviewProject } from "@/lib/movie-review-types";

export default function MovieDraftQueue({ project }: { project: MovieReviewProject; onProjectChange: (project: MovieReviewProject) => void }) {
  return (
    <section className="p-3" aria-label="Draft Queue">
      <p className="text-xs text-neutral-400">Current cut</p>
      <p className="mt-1 text-sm text-neutral-200">{project.committedClips.length} committed clips</p>
    </section>
  );
}
```

Create `web/src/components/movie/review/MovieDirectorPanel.tsx`:

```tsx
"use client";

import type { MovieReviewProject } from "@/lib/movie-review-types";

export default function MovieDirectorPanel({ project }: { project: MovieReviewProject; onProjectChange: (project: MovieReviewProject) => void }) {
  return (
    <section className="p-3" aria-label="Director panel">
      <p className="text-xs text-neutral-400">Director is in local rules mode.</p>
      <button type="button" className="mt-3 min-h-8 rounded-[5px] border border-neutral-700 px-3 text-xs text-neutral-200">
        Run rule-based Director
      </button>
      <p className="mt-3 text-[11px] text-neutral-500">{project.candidates.length} candidates available</p>
    </section>
  );
}
```

Create `web/src/components/movie/review/MovieCandidatesGrid.tsx`:

```tsx
"use client";

import { applyReviewCommand } from "@/lib/movie-review-reducer";
import type { MovieReviewProject } from "@/lib/movie-review-types";
import { MovieLifecycleBadge } from "./MovieStatusBadges";

export default function MovieCandidatesGrid({ project, onProjectChange }: { project: MovieReviewProject; onProjectChange: (project: MovieReviewProject) => void }) {
  return (
    <section role="region" aria-label="Candidates Grid" className="min-h-0 overflow-auto border border-neutral-800 bg-neutral-950 p-3" data-keyboard-context="grid">
      <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-2">
        {project.candidates.map((clip) => {
          const selected = project.selectedTarget?.clipId === clip.id;
          return (
            <button key={clip.id} type="button" role="option" aria-selected={selected} aria-label={`${clip.sourceAssetId ?? clip.id}, ${clip.lifecycle}, ${clip.flags.join(", ") || "no flags"}`} onClick={() => onProjectChange(applyReviewCommand(project, { type: "select", target: { type: "candidate", clipId: clip.id } }))} onDoubleClick={() => onProjectChange(applyReviewCommand(project, { type: "keep-current" }))} className={`relative aspect-video border bg-neutral-900 text-left ${selected ? "border-cyan-300" : "border-neutral-800"}`}>
              {clip.videoUrl ? <video src={clip.videoUrl} muted preload="metadata" className="h-full w-full object-cover" /> : null}
              <span className="absolute left-2 top-2 max-w-[80%] truncate text-xs text-neutral-100">{clip.sourceAssetId ?? clip.id}</span>
              <span className="absolute bottom-2 left-2"><MovieLifecycleBadge lifecycle={clip.lifecycle} /></span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
```

Create `web/src/components/movie/review/MovieFocusLoupe.tsx`:

```tsx
"use client";

import { applyReviewCommand } from "@/lib/movie-review-reducer";
import type { MovieReviewProject } from "@/lib/movie-review-types";

export default function MovieFocusLoupe({ project, onProjectChange }: { project: MovieReviewProject; onProjectChange: (project: MovieReviewProject) => void }) {
  const selected = [...project.candidates, ...project.committedClips].find((clip) => clip.id === project.selectedTarget?.clipId) ?? project.candidates[0] ?? project.committedClips[0];
  return (
    <section role="region" aria-label="Focus Loupe" className="min-h-0 border border-neutral-800 bg-neutral-950 p-3" data-keyboard-context="loupe">
      {selected ? <video src={selected.videoUrl} controls className="h-full max-h-[70vh] w-full object-contain" /> : <p className="text-sm text-neutral-500">No clip selected.</p>}
      <div className="mt-2 flex gap-2">
        <button type="button" onClick={() => onProjectChange(applyReviewCommand(project, { type: "keep-current" }))} className="min-h-8 rounded-[5px] border border-green-500 px-3 text-xs text-green-200">Keep</button>
        <button type="button" onClick={() => onProjectChange(applyReviewCommand(project, { type: "reject-current" }))} className="min-h-8 rounded-[5px] border border-neutral-700 px-3 text-xs text-neutral-200">Reject</button>
      </div>
    </section>
  );
}
```

Create `web/src/components/movie/review/MoviePreview.tsx`:

```tsx
"use client";

import type { ReviewClip } from "@/lib/movie-review-types";

export default function MoviePreview({ clip }: { clip: ReviewClip | null }) {
  return (
    <section role="region" aria-label="Clip preview" className="flex min-h-0 items-center justify-center bg-black" data-keyboard-context="transport">
      {clip?.videoUrl ? <video src={clip.videoUrl} controls className="max-h-full max-w-full" /> : <p className="text-sm text-neutral-500">No preview clip.</p>}
    </section>
  );
}
```

Create `web/src/components/movie/review/MovieWaveform.tsx`:

```tsx
"use client";

function formatTime(value: number): string {
  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

export default function MovieWaveform({ trimStart, trimEnd, duration, onTrimStartChange, onTrimEndChange }: { trimStart: number; trimEnd: number; duration: number; onTrimStartChange: (value: number) => void; onTrimEndChange: (value: number) => void }) {
  return (
    <div className="space-y-2" aria-label="Waveform trim controls">
      <input type="range" aria-label="Trim in" aria-valuetext={formatTime(trimStart)} min={0} max={duration} step={0.05} value={trimStart} onChange={(event) => onTrimStartChange(Number(event.target.value))} />
      <input type="range" aria-label="Trim out" aria-valuetext={formatTime(trimEnd)} min={0} max={duration} step={0.05} value={trimEnd} onChange={(event) => onTrimEndChange(Number(event.target.value))} />
    </div>
  );
}
```

Create `web/src/components/movie/review/MovieAssembleView.tsx`:

```tsx
"use client";

import type { MovieReviewProject } from "@/lib/movie-review-types";
import MoviePreview from "./MoviePreview";

export default function MovieAssembleView({ project }: { project: MovieReviewProject; onProjectChange: (project: MovieReviewProject) => void }) {
  const selected = project.committedClips.find((clip) => clip.id === project.selectedTarget?.clipId) ?? project.committedClips[0] ?? null;
  return (
    <section className="grid min-h-0 grid-rows-[minmax(0,1fr)_auto] gap-3">
      <MoviePreview clip={selected} />
      <section role="region" aria-label="Time-proportional ribbon" className="border border-neutral-800 bg-neutral-900 p-2 text-xs text-neutral-300">
        {project.committedClips.map((clip) => <span key={clip.id} className="mr-2 inline-block rounded-[3px] border border-neutral-700 px-2 py-1">{clip.sourceAssetId ?? clip.id}</span>)}
        <div className="mt-2 text-[11px] text-neutral-500">Source audio lane</div>
      </section>
    </section>
  );
}
```

Create `web/src/components/movie/review/MovieClipStrip.tsx`:

```tsx
"use client";

import { applyReviewCommand } from "@/lib/movie-review-reducer";
import type { MovieReviewProject } from "@/lib/movie-review-types";
import { MovieFlagBadge, MovieLifecycleBadge } from "./MovieStatusBadges";

export default function MovieClipStrip({ project, onProjectChange }: { project: MovieReviewProject; onProjectChange: (project: MovieReviewProject) => void }) {
  return (
    <section role="region" aria-label="Clip Strip" className="border-t border-neutral-800 bg-neutral-950 p-2" data-keyboard-context="strip">
      <div className="flex gap-1 overflow-x-auto">
        {project.committedClips.map((clip) => (
          <button key={clip.id} type="button" aria-label={`${clip.sourceAssetId ?? clip.id}, ${clip.lifecycle}, ${clip.flags.join(", ") || "no flags"}`} onClick={() => onProjectChange(applyReviewCommand(project, { type: "select", target: { type: "clip", clipId: clip.id } }))} className="min-w-40 border border-neutral-800 bg-neutral-900 p-2 text-left">
            <span className="block truncate text-xs text-neutral-100">{clip.sourceAssetId ?? clip.id}</span>
            <span className="mt-2 flex flex-wrap gap-1"><MovieLifecycleBadge lifecycle={clip.lifecycle} />{clip.flags.map((flag) => <MovieFlagBadge key={flag} flag={flag} />)}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
```

Create `web/src/components/movie/review/MovieInspector.tsx`:

```tsx
"use client";

import { applyReviewCommand } from "@/lib/movie-review-reducer";
import type { MovieReviewProject, ReviewClip } from "@/lib/movie-review-types";

function selectedClip(project: MovieReviewProject): ReviewClip | null {
  const clipId = project.selectedTarget?.clipId;
  return [...project.candidates, ...project.committedClips].find((clip) => clip.id === clipId) ?? null;
}

export default function MovieInspector({ project, onProjectChange }: { project: MovieReviewProject; onProjectChange: (project: MovieReviewProject) => void }) {
  const selected = selectedClip(project);
  return (
    <aside role="region" aria-label="Inspector" className="min-h-0 overflow-auto border border-neutral-800 bg-neutral-900 p-3 max-[1439px]:hidden">
      {selected ? (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-neutral-100">{selected.sourceAssetId ?? selected.id}</h2>
          <label className="block text-xs text-neutral-400">Trim in<input aria-label="Trim in" type="number" step="0.05" value={selected.trimStart ?? 0} onChange={(event) => onProjectChange(applyReviewCommand(project, { type: "set-trim", clipId: selected.id, trimStart: Number(event.target.value), trimEnd: selected.trimEnd ?? 5 }))} className="mt-1 w-full bg-neutral-950 p-1 text-neutral-100" /></label>
          <label className="block text-xs text-neutral-400">Trim out<input aria-label="Trim out" type="number" step="0.05" value={selected.trimEnd ?? 5} onChange={(event) => onProjectChange(applyReviewCommand(project, { type: "set-trim", clipId: selected.id, trimStart: selected.trimStart ?? 0, trimEnd: Number(event.target.value) }))} className="mt-1 w-full bg-neutral-950 p-1 text-neutral-100" /></label>
          <label className="block text-xs text-neutral-400">Clip volume<input aria-label="Clip volume" type="number" min="0" max="2" step="0.05" value={selected.volume} onChange={(event) => onProjectChange(applyReviewCommand(project, { type: "set-volume", clipId: selected.id, volume: Number(event.target.value) }))} className="mt-1 w-full bg-neutral-950 p-1 text-neutral-100" /></label>
          <p className="text-[11px] text-neutral-500">Lifecycle: {selected.lifecycle}</p>
        </div>
      ) : (
        <p className="text-sm text-neutral-500">Select a clip.</p>
      )}
    </aside>
  );
}
```

- [ ] **Step 6: Run shell E2E**

Run:

```bash
npx playwright test -c playwright.web.config.js tests/e2e-web/movie-review-bay.spec.js
```

Expected: PASS for shell and keyboard keep/reject.

- [ ] **Step 7: Run lint on touched web code**

Run:

```bash
npm --prefix web run lint
```

Expected: PASS.

- [ ] **Step 8: Commit Task 5**

Run:

```bash
git add web/src/components/movie/MovieMaker.tsx web/src/components/movie/review tests/e2e-web/movie-review-bay.spec.js
git commit -m "feat(web): add movie review bay shell"
```

## Task 6: Build Candidates Grid, Clip Strip, Inspector, Draft Queue, And Focus/Loupe

**Files:**
- Modify: `web/src/components/movie/review/MovieCandidatesGrid.tsx`
- Modify: `web/src/components/movie/review/MovieClipStrip.tsx`
- Modify: `web/src/components/movie/review/MovieInspector.tsx`
- Modify: `web/src/components/movie/review/MovieDraftQueue.tsx`
- Modify: `web/src/components/movie/review/MovieLeftRail.tsx`
- Modify: `web/src/components/movie/review/MovieFocusLoupe.tsx`
- Modify: `tests/e2e-web/movie-review-bay.spec.js`

- [ ] **Step 1: Extend E2E for typed surfaces and fine editing**

Add to `tests/e2e-web/movie-review-bay.spec.js`:

```js
test("Review Bay keeps Candidates Grid separate from committed Clip Strip", async ({ page }) => {
  const movieId = await seedReviewMovie(page);
  await page.goto(`/movie?id=${movieId}`);
  await expect(page.getByRole("region", { name: /Candidates Grid/i }).getByText("clip-a")).toBeVisible();
  await page.keyboard.press("KeyK");
  await expect(page.getByRole("region", { name: /Clip Strip/i }).getByText("clip-a")).toBeVisible();
  await expect(page.getByRole("region", { name: /Candidates Grid/i }).getByText("clip-a")).toHaveCount(0);
});

test("Inspector updates trim and volume for the selected committed clip", async ({ page }) => {
  const movieId = await seedReviewMovie(page);
  await page.goto(`/movie?id=${movieId}`);
  await page.keyboard.press("KeyK");
  await page.getByLabel(/Trim in/i).fill("0.4");
  await page.getByLabel(/Trim out/i).fill("1.8");
  await page.getByLabel(/Clip volume/i).fill("0.5");
  await expect(page.getByRole("region", { name: /Clip Strip/i }).getByLabel(/trimmed/i)).toBeVisible();
});

test("Focus Loupe supports Enter to keep and Escape to return to Review", async ({ page }) => {
  const movieId = await seedReviewMovie(page);
  await page.goto(`/movie?id=${movieId}`);
  await page.keyboard.press("KeyF");
  await expect(page.getByRole("region", { name: /Focus Loupe/i })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.getByText(/Kept clip/i)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: /Review/i })).toHaveAttribute("aria-pressed", "true");
});
```

- [ ] **Step 2: Run E2E to verify failures**

Run:

```bash
npx playwright test -c playwright.web.config.js tests/e2e-web/movie-review-bay.spec.js
```

Expected: FAIL for incomplete surface behavior.

- [ ] **Step 3: Implement Candidates Grid**

Implement `MovieCandidatesGrid.tsx` with:

- `role="region"` and `aria-label="Candidates Grid"`.
- Roving focus by arrow keys.
- Candidate cells with accessible names that include lifecycle and active flags.
- Keep, reject, and focus actions wired to `applyReviewCommand`.
- Proposed lifecycle uses orange only for proposals, and selection uses cyan/neutral border.

The core cell shape must follow this structure:

```tsx
<button
  type="button"
  role="option"
  aria-selected={isSelected}
  aria-label={`${clip.sourceAssetId ?? clip.id}, ${clip.lifecycle}, ${clip.flags.join(", ") || "no flags"}`}
  data-keyboard-context="grid"
  onClick={() => onProjectChange(applyReviewCommand(project, { type: "select", target: { type: "candidate", clipId: clip.id } }))}
  onDoubleClick={() => onProjectChange(applyReviewCommand(project, { type: "keep-current" }))}
  className={cellClassName}
>
  <video src={clip.videoUrl} muted preload="metadata" className="h-full w-full object-cover" />
  <span className="absolute left-2 top-2">{clip.sourceAssetId ?? clip.id}</span>
  <MovieLifecycleBadge lifecycle={clip.lifecycle} />
</button>
```

- [ ] **Step 4: Implement Clip Strip**

Implement `MovieClipStrip.tsx` with:

- `role="region"` and `aria-label="Clip Strip"`.
- `data-keyboard-context="strip"`.
- Committed clips only.
- Time-proportional widths using `buildMovieTimeline`.
- Reorder buttons and Alt+Arrow support through reducer.
- Lifecycle plus flag badges.
- A polite live-region update through the shell.

- [ ] **Step 5: Implement Inspector**

Implement `MovieInspector.tsx` with:

- `role="region"` and `aria-label="Inspector"`.
- selected clip lookup across candidates and committed clips.
- numeric `Trim in`, `Trim out`, and `Clip volume` fields.
- mute and solo toggle buttons.
- metadata rows for `sourceAssetId`, URL, lifecycle, flags, and media/audio errors.
- no independent trim state; every edit calls `applyReviewCommand`.

Use this command shape:

```tsx
onProjectChange(applyReviewCommand(project, {
  type: "set-trim",
  clipId: selected.id,
  trimStart: Number(trimStartValue),
  trimEnd: Number(trimEndValue),
}));
```

- [ ] **Step 6: Implement Draft Queue and Focus Loupe**

Implement `MovieDraftQueue.tsx` and `MovieFocusLoupe.tsx`:

- Draft Queue lists whole-project versions from `listMovieVersions`.
- Selecting a version replaces `committedClips`; it never writes per-clip lifecycle into Draft Queue.
- Focus Loupe shows a single selected clip, Enter keeps, X rejects, Escape returns to Review.
- Focus Loupe remains available below desktop width.

- [ ] **Step 7: Run E2E and unit tests**

Run:

```bash
npx playwright test -c playwright.web.config.js tests/e2e-web/movie-review-bay.spec.js
npm --prefix web run test:unit -- movie-review-reducer movie-timeline-model
```

Expected: PASS.

- [ ] **Step 8: Commit Task 6**

Run:

```bash
git add web/src/components/movie/review tests/e2e-web/movie-review-bay.spec.js
git commit -m "feat(web): build movie review surfaces"
```

## Task 7: Add Audio-Capable Preview, Waveform Controls, And Assemble Mode

**Files:**
- Create: `web/src/components/movie/review/useMovieMediaEngine.ts`
- Create: `web/src/components/movie/review/useMovieAudioPreview.ts`
- Modify: `web/src/components/movie/review/MoviePreview.tsx`
- Modify: `web/src/components/movie/review/MovieWaveform.tsx`
- Modify: `web/src/components/movie/review/MovieAssembleView.tsx`
- Modify: `tests/e2e-web/movie-player-stability.spec.js`
- Modify: `tests/e2e-web/movie-review-bay.spec.js`

- [ ] **Step 1: Add E2E coverage for Assemble and audible preview state**

Add to `tests/e2e-web/movie-review-bay.spec.js`:

```js
test("Assemble mode shows continuous preview, ribbon, and audio lanes", async ({ page }) => {
  const movieId = await seedReviewMovie(page);
  await page.goto(`/movie?id=${movieId}`);
  await page.keyboard.press("KeyK");
  await page.getByRole("button", { name: /Assemble/i }).click();
  await expect(page.getByRole("region", { name: /Clip preview/i })).toBeVisible();
  await expect(page.getByRole("region", { name: /Time-proportional ribbon/i })).toBeVisible();
  await expect(page.getByRole("slider", { name: /Trim in/i })).toBeVisible();
  await expect(page.getByRole("slider", { name: /Trim out/i })).toBeVisible();
  await expect(page.getByText(/Source audio/i)).toBeVisible();
});
```

Add to `tests/e2e-web/movie-player-stability.spec.js`:

```js
test("Movie Review Bay does not mute source video elements by default", async ({ page }) => {
  const movieId = await seedMovie(page);
  await page.goto(`/movie?id=${movieId}`);
  const mutedValues = await page.locator("video").evaluateAll((videos) => videos.map((video) => video.muted));
  expect(mutedValues.every((muted) => muted === false)).toBe(true);
});
```

- [ ] **Step 2: Run E2E to verify failures**

Run:

```bash
npx playwright test -c playwright.web.config.js tests/e2e-web/movie-review-bay.spec.js tests/e2e-web/movie-player-stability.spec.js
```

Expected: FAIL for missing audio-aware preview and Assemble details.

- [ ] **Step 3: Implement media engine hook**

Create `useMovieMediaEngine.ts` with:

- video metadata collection per clip.
- source-audio detection using browser media properties where available.
- no `video.muted = true` default for source preview.
- last good frame retention.
- error state returned to caller for Inspector and export-safe logic.

Use this source-audio detector:

```ts
export function detectSourceAudio(video: HTMLVideoElement): boolean | "unknown" {
  const maybeMoz = video as HTMLVideoElement & { mozHasAudio?: boolean };
  const maybeWebkit = video as HTMLVideoElement & { webkitAudioDecodedByteCount?: number };
  if (typeof maybeMoz.mozHasAudio === "boolean") return maybeMoz.mozHasAudio;
  if (typeof maybeWebkit.webkitAudioDecodedByteCount === "number" && maybeWebkit.webkitAudioDecodedByteCount > 0) return true;
  if (video.audioTracks && video.audioTracks.length > 0) return true;
  return "unknown";
}
```

- [ ] **Step 4: Implement audio preview hook**

Create `useMovieAudioPreview.ts` with:

- one `AudioContext`.
- one `MediaElementAudioSourceNode` per video element.
- per-clip `GainNode`.
- master gain.
- solo semantics: if any committed clip is soloed, only soloed clips can be audible.
- mute semantics: muted clip gain is zero.
- cleanup on unmount.

Pause and ask before changing solo semantics if this behavior conflicts with user expectation.

- [ ] **Step 5: Implement preview, waveform, and Assemble**

Modify:

- `MoviePreview.tsx`: labelled region "Clip preview", transport buttons with accessible names, J/K/L/Space support, nonblank canvas, audible video elements.
- `MovieWaveform.tsx`: render deterministic canvas/SVG waveform bars from clip duration, expose trim in/out sliders with `aria-valuetext`.
- `MovieAssembleView.tsx`: continuous preview, time-proportional ribbon, source audio lane, master lane, per-clip waveform.

The waveform component must expose:

```tsx
<input type="range" aria-label="Trim in" aria-valuetext={formatTime(trimStart)} />
<input type="range" aria-label="Trim out" aria-valuetext={formatTime(trimEnd)} />
```

- [ ] **Step 6: Run E2E and stability tests**

Run:

```bash
npx playwright test -c playwright.web.config.js tests/e2e-web/movie-review-bay.spec.js tests/e2e-web/movie-player-stability.spec.js
```

Expected: PASS.

- [ ] **Step 7: Commit Task 7**

Run:

```bash
git add web/src/components/movie/review tests/e2e-web/movie-review-bay.spec.js tests/e2e-web/movie-player-stability.spec.js
git commit -m "feat(web): add movie preview audio"
```

## Task 8: Add Director Panel UI, Proposal Preview, Partial Accept, And Alternate Drafts

**Files:**
- Modify: `web/src/components/movie/review/MovieDirectorPanel.tsx`
- Modify: `web/src/components/movie/review/MovieLeftRail.tsx`
- Modify: `web/src/components/movie/review/MovieDraftQueue.tsx`
- Modify: `web/src/lib/movie-review-storage.ts`
- Create: `tests/e2e-web/movie-director.spec.js`

- [ ] **Step 1: Write failing Director E2E**

Create `tests/e2e-web/movie-director.spec.js`:

```js
const { test, expect } = require("@playwright/test");
const { seedReviewMovie } = require("./support/movie-fixtures");

test("Director creates reviewable proposals without mutating the current cut", async ({ page }) => {
  const movieId = await seedReviewMovie(page);
  await page.goto(`/movie?id=${movieId}`);
  const before = await page.getByRole("region", { name: /Clip Strip/i }).textContent();
  await page.getByRole("tab", { name: /Director/i }).click();
  await page.getByRole("button", { name: /Run rule-based Director/i }).click();
  await expect(page.getByRole("article", { name: /Director proposal/i })).toBeVisible();
  const after = await page.getByRole("region", { name: /Clip Strip/i }).textContent();
  expect(after).toBe(before);
});

test("Director partial accept applies selected changes only", async ({ page }) => {
  const movieId = await seedReviewMovie(page);
  await page.goto(`/movie?id=${movieId}`);
  await page.getByRole("tab", { name: /Director/i }).click();
  await page.getByRole("button", { name: /Run rule-based Director/i }).click();
  await page.getByLabel(/Select change 1/i).check();
  await page.getByRole("button", { name: /Apply selected changes/i }).click();
  await expect(page.getByText(/partially applied/i)).toBeVisible();
});
```

If `tests/e2e-web/support/movie-fixtures.js` does not exist, create it and move the shared `seedReviewMovie` helper from `movie-review-bay.spec.js` into that file.

- [ ] **Step 2: Run Director E2E to verify failures**

Run:

```bash
npx playwright test -c playwright.web.config.js tests/e2e-web/movie-director.spec.js
```

Expected: FAIL for missing Director UI behavior.

- [ ] **Step 3: Implement Director Panel**

Implement `MovieDirectorPanel.tsx`:

- Provider off by default.
- Rule-based Director button always available.
- Optional provider controls are visible but disabled until config is present.
- Proposals render as `article` with `aria-label="Director proposal ..."`.
- Changes render with checkboxes for partial accept.
- Preview proposed cut button shows ghost/reorder preview without changing saved project.
- Apply selected changes calls `applyDirectorChanges` and updates proposal status.
- Invalid provider output shows schema validation error and does not alter project.

- [ ] **Step 4: Implement alternate local draft creation**

Add storage helper:

```ts
export async function createMovieVersionFromProposal(project: MovieReviewProject, name: string, description: string): Promise<MovieVersion> {
  const timestamp = new Date().toISOString();
  const version: MovieVersion = {
    id: uuidv4(),
    movieId: project.movieId,
    projectId: project.id,
    name,
    description,
    clips: project.committedClips,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  return saveMovieVersion(version);
}
```

Draft Queue loads these versions and replaces the whole Clip Strip when selected.

- [ ] **Step 5: Run Director tests**

Run:

```bash
npm --prefix web run test:unit -- movie-director movie-review-storage
npx playwright test -c playwright.web.config.js tests/e2e-web/movie-director.spec.js
```

Expected: PASS.

- [ ] **Step 6: Commit Task 8**

Run:

```bash
git add web/src/components/movie/review web/src/lib/movie-review-storage.ts tests/e2e-web/movie-director.spec.js tests/e2e-web/support
git commit -m "feat(web): add movie director panel"
```

## Task 9: Add Export Pre-Flight, MP4 With Audio, WebM Fallback, And Export History

**Files:**
- Modify: `web/src/components/movie/review/MovieExportGate.tsx`
- Modify: `web/src/components/movie/review/MovieExportButton.tsx`
- Modify: `web/src/lib/useFFmpeg.ts`
- Modify: `web/src/lib/movie-review-storage.ts`
- Modify: `tests/e2e-web/fixtures/fake-vault-worker.mjs`
- Add: `tests/e2e-web/fixtures/tiny-video-with-audio.mp4`
- Create: `tests/e2e-web/movie-export.spec.js`

- [ ] **Step 1: Create or verify audio fixture**

Run:

```bash
ffmpeg -y -f lavfi -i testsrc=size=320x240:rate=30 -f lavfi -i sine=frequency=440:sample_rate=48000 -t 1.5 -c:v libx264 -pix_fmt yuv420p -c:a aac tests/e2e-web/fixtures/tiny-video-with-audio.mp4
ffprobe -v error -select_streams a:0 -show_entries stream=codec_name -of default=nw=1:nk=1 tests/e2e-web/fixtures/tiny-video-with-audio.mp4
```

Expected:

```text
aac
```

- [ ] **Step 2: Write failing export E2E**

Create `tests/e2e-web/movie-export.spec.js`:

```js
const { test, expect } = require("@playwright/test");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { seedReviewMovie } = require("./support/movie-fixtures");

test("Export pre-flight blocks unresolved candidates and enables clean cut", async ({ page }) => {
  const movieId = await seedReviewMovie(page);
  await page.goto(`/movie?id=${movieId}`);
  await expect(page.getByRole("button", { name: /Export blocked/i })).toBeDisabled();
  await page.keyboard.press("KeyK");
  await page.keyboard.press("KeyK");
  await expect(page.getByRole("button", { name: /^Export movie$/i })).toBeEnabled();
});

test("Movie export creates MP4 with an audio stream and keeps WebM fallback", async ({ page }, testInfo) => {
  const movieId = await seedReviewMovie(page, { useAudioFixture: true });
  await page.goto(`/movie?id=${movieId}`);
  await page.keyboard.press("KeyK");
  await page.keyboard.press("KeyK");
  await page.getByRole("button", { name: /^Export movie$/i }).click();
  await page.getByRole("button", { name: /Load FFmpeg/i }).click();
  await page.getByRole("button", { name: /Export MP4/i }).click();
  const download = await page.waitForEvent("download", { timeout: 120000 });
  const outputPath = path.join(testInfo.outputDir, "review-bay-export.mp4");
  await download.saveAs(outputPath);
  const codec = execFileSync("ffprobe", ["-v", "error", "-select_streams", "a:0", "-show_entries", "stream=codec_name", "-of", "default=nw=1:nk=1", outputPath], { encoding: "utf8" }).trim();
  expect(codec).toBe("aac");
  await expect(page.getByRole("button", { name: /Export WebM/i })).toBeVisible();
});
```

- [ ] **Step 3: Run export E2E to verify failures**

Run:

```bash
npx playwright test -c playwright.web.config.js tests/e2e-web/movie-export.spec.js
```

Expected: FAIL because export pre-flight and MP4 export are not implemented.

- [ ] **Step 4: Implement pre-flight gate**

Implement `MovieExportGate.tsx`:

- compute blockers from candidates, unresolved pending proposals, export safety, and missing duration.
- warn on partial audio coverage.
- disable export only for blockers.
- show exact blocker count.
- keep `aria-label` specific.
- include export history from `listExportRuns`.

- [ ] **Step 5: Implement FFmpeg MP4/WebM export**

Implement `MovieExportButton.tsx`:

- load FFmpeg through `useFFmpeg`.
- fetch every committed video clip as a blob.
- write `clip-N.mp4` files to FFmpeg FS.
- call `buildMovieExportArgs`.
- read `output.mp4` or `output.webm`.
- validate expected audio with `validateExportAudioProof`.
- save an export run with `saveExportRun`.
- trigger browser download.
- support cancellation by setting a local cancelled flag and terminating FFmpeg where technically possible.

Do not use `canvas.captureStream` for MP4. Keep WebM fallback through FFmpeg or a separate fallback path, but do not label canvas-only video as MP4.

- [ ] **Step 6: Run export tests**

Run:

```bash
npm --prefix web run test:unit -- movie-export-args movie-timeline-model
npx playwright test -c playwright.web.config.js tests/e2e-web/movie-export.spec.js
```

Expected: PASS. The MP4 file downloaded in the test must contain an AAC audio stream verified by `ffprobe`.

- [ ] **Step 7: Commit Task 9**

Run:

```bash
git add web/src/components/movie/review/MovieExportGate.tsx web/src/components/movie/review/MovieExportButton.tsx web/src/lib/useFFmpeg.ts web/src/lib/movie-review-storage.ts web/src/lib/movie-export-args.ts tests/e2e-web/fixtures/fake-vault-worker.mjs tests/e2e-web/fixtures/tiny-video-with-audio.mp4 tests/e2e-web/movie-export.spec.js
git commit -m "feat(web): add movie export gate"
```

## Task 10: Mobile Review, Accessibility, And Visual Polish

**Files:**
- Modify: `web/src/app/globals.css`
- Modify: `web/src/components/movie/review/*.tsx`
- Modify: `tests/e2e-web/movie-review-bay.spec.js`

- [ ] **Step 1: Add E2E for mobile and accessibility basics**

Add to `tests/e2e-web/movie-review-bay.spec.js`:

```js
test("mobile width supports review and hides fine editing clearly", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const movieId = await seedReviewMovie(page);
  await page.goto(`/movie?id=${movieId}`);
  await expect(page.getByRole("region", { name: /Candidates Grid/i })).toBeVisible();
  await expect(page.getByText(/Fine editing is available on desktop/i)).toBeVisible();
  await expect(page.getByLabel(/Trim in/i)).toHaveCount(0);
});

test("status and focus affordances are non-color-only", async ({ page }) => {
  const movieId = await seedReviewMovie(page);
  await page.goto(`/movie?id=${movieId}`);
  await page.keyboard.press("Tab");
  const focused = page.locator(":focus");
  await expect(focused).toBeVisible();
  await expect(page.getByLabel(/Lifecycle Proposed/i).first()).toBeVisible();
  await expect(page.getByLabel(/Flag has source audio/i).first()).toBeVisible();
});
```

- [ ] **Step 2: Run E2E to verify failures**

Run:

```bash
npx playwright test -c playwright.web.config.js tests/e2e-web/movie-review-bay.spec.js
```

Expected: FAIL for missing mobile/accessibility polish.

- [ ] **Step 3: Add Review Bay CSS tokens**

Modify `web/src/app/globals.css` under `@theme inline` with semantic tokens:

```css
  --color-movie-canvas: #090a0b;
  --color-movie-panel: #111315;
  --color-movie-panel-raised: #181b1e;
  --color-movie-inset: #0c0e10;
  --color-movie-text: #f4f1ea;
  --color-movie-muted: #aaa39a;
  --color-movie-proposal: #f97316;
  --color-movie-kept: #22c55e;
  --color-movie-export-safe: #7cff6b;
  --color-movie-waveform: #22d3ee;
  --color-movie-audio: #f59e0b;
  --color-movie-error: #ef4444;
```

Use these tokens in Review Bay components instead of raw one-off colors where practical. Do not repaint unrelated app surfaces.

- [ ] **Step 4: Add reduced motion, focus, and mobile behavior**

Implement:

- `@media (prefers-reduced-motion: reduce)` disables hover-preview autoplay and transition animations.
- 2px focus ring plus offset on all movie controls.
- F6 cycles Draft/Director, Preview, Inspector, Clip Strip.
- mobile layout under 768px shows review/focus/director status only.
- Inspector fine editing displays "Fine editing is available on desktop" on mobile and does not render trim/volume controls.

- [ ] **Step 5: Run accessibility/mobile E2E**

Run:

```bash
npx playwright test -c playwright.web.config.js tests/e2e-web/movie-review-bay.spec.js
```

Expected: PASS.

- [ ] **Step 6: Commit Task 10**

Run:

```bash
git add web/src/app/globals.css web/src/components/movie/review tests/e2e-web/movie-review-bay.spec.js
git commit -m "feat(web): polish movie review accessibility"
```

## Task 11: Full Validation, Manual Browser Pass, And Cleanup

**Files:**
- Modify: `implementation-notes.html`
- Modify only files needed to fix validation failures.

- [ ] **Step 1: Run all web unit tests**

Run:

```bash
npm --prefix web run test:unit
```

Expected: PASS.

- [ ] **Step 2: Run full web E2E**

Run:

```bash
npx playwright test -c playwright.web.config.js
```

Expected: PASS.

- [ ] **Step 3: Run web lint**

Run:

```bash
npm --prefix web run lint
```

Expected: PASS with no warnings that require code changes.

- [ ] **Step 4: Run web build**

Run:

```bash
npm --prefix web run build
```

Expected: PASS. If Next reports root inference or lockfile warnings, fix the repo configuration instead of leaving the warning.

- [ ] **Step 5: Run root extension tests to catch unrelated regressions**

Run:

```bash
npm run test:unit
npm run lint
```

Expected: PASS. Root extension code should not have changed.

- [ ] **Step 6: Start local app for manual browser validation**

Run:

```bash
npm --prefix web run dev -- --port 3002
```

Expected: local app is reachable at `http://localhost:3002`.

Manual browser checks:

- open `http://localhost:3002/vault`, preview/commit local Vault data if needed.
- open `http://localhost:3002/movie`.
- create or select a Vault movie draft.
- confirm Review mode first viewport shows Draft/Director, Candidates Grid, Inspector, and Clip Strip.
- keep and reject with keyboard.
- enter Focus/Loupe with `F`, keep with `Enter`, exit with `Esc`.
- enter Assemble and play with audio.
- trim a clip, change volume, mute, solo, reorder, delete.
- run rule-based Director, preview proposal, partially apply one change, create an alternate draft.
- export MP4, download it, and verify audio:

```bash
ffprobe -v error -select_streams a:0 -show_entries stream=codec_name -of default=nw=1:nk=1 /path/to/downloaded-file.mp4
```

Expected:

```text
aac
```

- export WebM fallback.
- set viewport to mobile width and confirm review/status works while fine editing is hidden.

- [ ] **Step 7: Confirm hard boundaries**

Run:

```bash
git status --short
git diff --name-only HEAD
git diff -- web/.env.local .env cloud background.js content.js popup.js popup.html popup.css cloudSyncUtils.js
```

Expected:

- changed files are limited to approved web app files, tests, docs, and `implementation-notes.html`.
- no env, R2/D1/Worker, extension backup, processed-ID, live Grok, OAuth, secret, or bucket config files changed.
- no API keys, bearer tokens, cookies, or credentials appear in diffs.

- [ ] **Step 8: Commit validation notes and final cleanup**

Run:

```bash
git add implementation-notes.html
git commit -m "docs: record movie review validation"
```

If validation fixes changed app/test files after Task 10, include them in a semantic commit before this docs commit.

## Self-Review

### Spec Coverage

- Review/Triage, Focus/Loupe, Assemble modes: Tasks 5, 6, 7, 10, 11.
- Candidates Grid distinct from Clip Strip: Tasks 2, 5, 6.
- Draft Queue and Director tab: Tasks 1, 5, 6, 8.
- Inspector: Task 6.
- Keyboard keep/reject/apply, auto-advance, collision rules: Tasks 2, 5, 6.
- Trim, reorder, delete, volume, mute, solo: Tasks 2, 6, 7.
- Source-audio detection and audible preview: Task 7.
- MP4 export with audio and WebM fallback: Tasks 4, 9, 11.
- Export pre-flight and history: Tasks 1, 2, 4, 9.
- Director proposals, alternate drafts, OpenAI-compatible adapter, CLIProxyAPI compatibility, provider off by default, rule fallback: Tasks 1, 3, 8.
- Local versions and review notes: Tasks 1, 8.
- Accessibility, grayscale/non-color status, reduced motion, mobile review: Tasks 5, 6, 10, 11.
- No R2/D1/Worker/processed/live/env/secret/cloud writes: Task 11 boundary check.

### Placeholder Scan

This plan intentionally avoids "fill in details", "write tests for above", and unspecified future behavior. The only defer point is an explicit pause condition: ask the user before changing solo semantics or before shipping anything less than real MP4 audio.

### Type Consistency

The plan uses these canonical names throughout:

- `MovieReviewProject`
- `ReviewClip`
- `MovieVersion`
- `DirectorProposal`
- `MovieExportRun`
- `MovieReviewNote`
- `MovieMode`
- `ClipLifecycle`
- `ClipFlag`
- `applyReviewCommand`
- `buildMovieTimeline`
- `buildMovieExportArgs`
- `MovieReviewBay`

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-27-movie-maker-review-bay-phase1.md`. Two execution options:

1. Subagent-Driven (recommended): dispatch a fresh subagent per task, review between tasks, fast iteration.
2. Inline Execution: execute tasks in this session using executing-plans, batch execution with checkpoints.

Recommended choice for this plan: Subagent-Driven, because Tasks 1-4 are pure model/contract work, Tasks 5-8 are UI/domain slices, and Tasks 9-11 need focused export and validation passes.
