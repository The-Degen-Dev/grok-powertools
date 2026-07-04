# Movie Maker Review Bay Phase 0 And Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the safe local Movie Maker Review Bay foundation: verify the current base, choose a proven export engine, add schema-first Review Bay state, replace the simple editor with a usable review console, preview with audio, export real MP4 with audio proof, and keep Director proposal-only.

**Architecture:** Keep all work local to the web app. Add additive IndexedDB stores, schema-first persisted state, pure timeline/reducer/export/director modules, focused React components, a media engine hook that owns browser media lifecycle, and an export adapter selected by a short proof. No R2, D1, Worker repair, extension backup, processed-ID, live Grok, env, secret, or cloud-sync changes are in scope.

**Tech Stack:** Next.js 16.1.6, React 19.2.3, TypeScript, IndexedDB via `idb`, Zod 4, Vitest, Playwright 1.57.0, FFmpeg.wasm or WebCodecs plus Mediabunny after proof, `ffmpeg` and `ffprobe` for local fixture/output verification.

---

## Scope Check

The full-program spec covers Phase 0 through Phase 4. This plan intentionally executes only Phase 0 and Phase 1 because Phase 2 through Phase 4 depend on real Phase 1 project state, media-engine behavior, export proof, and user feedback.

This plan must produce working, testable software on its own:

- Existing Vault and Movie Maker data remains intact.
- Vault-backed movie drafts still open.
- Review Bay replaces the simple `/movie?id=...` editor.
- The user can review, keep, reject, trim, order, mute, solo, preview with audio, run rule-based Director proposals, optionally call a server-routed provider, and export MP4 with audio proof.

The next plans are separate:

- Phase 2 plan: Prompt Spine and review intelligence.
- Phase 3 plan: deeper timeline editing.
- Phase 4 plan: provider-assisted generation and sharing.

Do not start Phase 2, Phase 3, or Phase 4 work while executing this plan.

## Required Source Artifacts

Before execution, read these files in full:

- `AGENTS.md`
- `docs/superpowers/specs/2026-06-28-movie-maker-review-bay-full-program-spec.md`
- `docs/superpowers/specs/2026-06-28-movie-maker-review-bay-research-audit.md`
- `docs/superpowers/plans/2026-06-27-movie-maker-review-bay-phase1.md`
- `web/src/lib/types.ts`
- `web/src/lib/local-storage.ts`
- `web/src/lib/vault-movie-drafts.ts`
- `web/src/lib/vault-movie-draft-storage.ts`
- `web/src/components/movie/MovieMaker.tsx`
- `web/src/components/movie/CanvasPlayer.tsx`
- `web/src/components/movie/ExportMovieButton.tsx`
- `tests/e2e-web/vault-movie-drafts.spec.js`
- `tests/e2e-web/movie-player-stability.spec.js`
- `playwright.web.config.js`

## Pause Gates

Pause and ask the user before proceeding if any of these happen:

- The current branch is not `codex/vault-movie-drafts-exec`, or `origin/main` has moved and merge conflicts affect Movie/Vault code.
- Existing local movies or Vault records would be deleted, reset, or migrated destructively.
- MP4 with AAC audio cannot be proven on fixture media.
- The only viable export path requires a server-rendered Remotion pipeline, a new paid license decision, or cloud infrastructure.
- WebCodecs plus Mediabunny is selected but browser support or cleanup cannot be proven in local Chromium.
- Any provider route requires exposing API keys, bearer tokens, raw provider base URLs intended to be secret, cookies, or auth headers to browser components.
- Live Grok, R2, D1, Worker repair, extension backup, processed IDs, OAuth, bucket config, or env rotation appears necessary.
- Solo or mute semantics need to differ from this plan: if any clip is soloed, only soloed and unmuted clips are audible.

## File Structure

### Domain And Storage

- Modify `web/package.json`: add direct `zod` dependency and optional chosen export dependency after Task 2.
- Modify `web/package-lock.json`: lock dependency changes.
- Modify `web/src/lib/local-storage.ts`: bump `DB_VERSION` from `5` to `6` and create additive Review Bay stores.
- Create `web/src/lib/movie-review-types.ts`: Zod schemas and derived types.
- Create `web/src/lib/movie-review-storage.ts`: storage helpers and legacy movie hydration.
- Create `web/src/lib/movie-review-storage.test.ts`: migration and persistence tests.

### Pure Logic

- Create `web/src/lib/movie-timebase.ts`: integer frame tick helpers.
- Create `web/src/lib/movie-timeline-model.ts`: timeline entries, duration math, audio intent, export-safe predicates.
- Create `web/src/lib/movie-timeline-model.test.ts`: timeline/timebase/export-safe tests.
- Create `web/src/lib/movie-review-reducer.ts`: pure commands and Review Bay state transitions.
- Create `web/src/lib/movie-review-reducer.test.ts`: lifecycle, selection, keyboard, trim, mute, solo, and proposal tests.
- Create `web/src/lib/movie-director.ts`: rule Director, schemas, provider payload adapters, proposal validation/application.
- Create `web/src/lib/movie-director.test.ts`: proposal-only and invalid-output tests.
- Create `web/src/lib/movie-export-engines.ts`: selected export engine interface and shared proof types.
- Create `web/src/lib/movie-export-args.ts`: FFmpeg args if FFmpeg.wasm remains selected.
- Create `web/src/lib/movie-export-args.test.ts`: export arg tests.

### Server Boundary

- Create `web/src/app/api/movie/director/route.ts`: server-only OpenAI-compatible Director route.

### React Hooks And Components

- Create directory `web/src/components/movie/review/`.
- Create `web/src/components/movie/review/useMovieReviewProject.ts`: load/save hook.
- Create `web/src/components/movie/review/useMovieKeyboard.ts`: keyboard map and live-region messages.
- Create `web/src/components/movie/review/useMovieMediaEngine.ts`: media element lifecycle, metadata, frame sync, cleanup.
- Create `web/src/components/movie/review/useMovieAudioPreview.ts`: Web Audio graph for gain, mute, and solo.
- Create `web/src/components/movie/review/MovieReviewBay.tsx`: top-level shell.
- Create `web/src/components/movie/review/MovieReviewHeader.tsx`: project title, modes, Director state, export gate.
- Create `web/src/components/movie/review/MovieLeftRail.tsx`: Draft Queue and Director tabs.
- Create `web/src/components/movie/review/MovieDraftQueue.tsx`: whole-version list.
- Create `web/src/components/movie/review/MovieDirectorPanel.tsx`: proposals and apply controls.
- Create `web/src/components/movie/review/MovieCandidatesGrid.tsx`: Review/Triage candidates.
- Create `web/src/components/movie/review/MovieFocusLoupe.tsx`: single-clip inspection.
- Create `web/src/components/movie/review/MovieAssembleView.tsx`: continuous preview and audio lanes.
- Create `web/src/components/movie/review/MovieClipStrip.tsx`: committed cut.
- Create `web/src/components/movie/review/MovieInspector.tsx`: selected target details.
- Create `web/src/components/movie/review/MoviePreview.tsx`: canvas/video preview.
- Create `web/src/components/movie/review/MovieWaveform.tsx`: deterministic waveform and trim controls.
- Create `web/src/components/movie/review/MovieStatusBadges.tsx`: non-color-only status badges.
- Create `web/src/components/movie/review/MovieExportGate.tsx`: blockers, warnings, export actions, history.
- Create `web/src/components/movie/review/MovieExportButton.tsx`: selected export engine orchestration.
- Modify `web/src/components/movie/MovieMaker.tsx`: delegate to `MovieReviewBay`.
- Modify `web/src/app/globals.css`: Review Bay tokens and responsive layout only.

### Tests And Fixtures

- Create `tests/e2e-web/support/movie-fixtures.js`: browser-side seeded movie helpers.
- Create `tests/e2e-web/movie-phase0.spec.js`: safety/base checks.
- Create `tests/e2e-web/movie-review-bay.spec.js`: main Review Bay workflow.
- Create `tests/e2e-web/movie-director.spec.js`: proposal-only Director workflow.
- Create `tests/e2e-web/movie-export.spec.js`: export pre-flight and MP4 audio proof.
- Modify `tests/e2e-web/movie-player-stability.spec.js`: keep non-strobing coverage under Review Bay.
- Modify `tests/e2e-web/fixtures/fake-vault-worker.mjs`: serve audio fixture media for export tests.
- Add `tests/e2e-web/fixtures/tiny-video-with-audio.mp4`: generated fixture with AAC audio.
- Create `docs/superpowers/specs/2026-06-28-movie-maker-export-engine-decision.md`: export proof decision record.
- Maintain `implementation-notes.html`: task-by-task notes.

## Task 0: Preflight, Notes File, And Phase Boundaries

**Files:**
- Create or modify: `implementation-notes.html`
- Modify only if missing or outdated: no source files in this task

- [ ] **Step 1: Verify branch and clean state**

Run:

```bash
pwd
git status --short --branch
git log --oneline --decorate -6
```

Expected:

```text
/Users/philipbankier/.codex/worktrees/vault-movie-drafts-exec/chrome-extension-powertools
## codex/vault-movie-drafts-exec
```

If the branch or worktree differs, pause.

- [ ] **Step 2: Verify `origin/main` relationship**

Run:

```bash
git fetch origin
git merge-base --is-ancestor origin/main HEAD && echo "origin/main is included"
```

Expected:

```text
origin/main is included
```

If this fails, merge `origin/main` into the branch and resolve conflicts before editing.

- [ ] **Step 3: Create `implementation-notes.html` if needed**

If the file does not exist, create it with:

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Movie Maker Review Bay Implementation Notes</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 32px; line-height: 1.5; color: #1f2937; }
    h1, h2 { color: #111827; }
    section { border: 1px solid #d1d5db; border-radius: 8px; padding: 16px; margin: 16px 0; }
    code { background: #f3f4f6; padding: 2px 4px; border-radius: 4px; }
  </style>
</head>
<body>
  <h1>Movie Maker Review Bay Implementation Notes</h1>
  <section>
    <h2>Task 0: Preflight</h2>
    <ul>
      <li><strong>Design decisions:</strong> Execute Phase 0 and Phase 1 only. Phase 2 through Phase 4 get separate plans after Phase 1 is verified.</li>
      <li><strong>Deviations:</strong> None.</li>
      <li><strong>Tradeoffs:</strong> A single all-phase plan was rejected because future phases depend on the actual Phase 1 data model and export engine decision.</li>
      <li><strong>Open questions:</strong> None.</li>
      <li><strong>Validation:</strong> Branch, worktree, and origin/main relationship checked.</li>
    </ul>
  </section>
</body>
</html>
```

- [ ] **Step 4: Commit Task 0**

Run:

```bash
git add implementation-notes.html
git commit -m "docs: start movie review implementation notes"
```

Expected: commit succeeds. If `implementation-notes.html` already existed with equivalent current notes, do not create an empty commit.

## Task 1: Phase 0 Safety And Current Flow Verification

**Files:**
- Create: `tests/e2e-web/movie-phase0.spec.js`
- Modify: `implementation-notes.html`

- [ ] **Step 1: Write Phase 0 E2E tests**

Create `tests/e2e-web/movie-phase0.spec.js`:

```js
const { test, expect } = require("@playwright/test");

async function clearAppStores(page) {
  await page.goto("/vault");
  await page.waitForFunction(async () => {
    const databases = await indexedDB.databases();
    return databases.some((entry) => entry.name === "grok-power-tools");
  });
  await page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("grok-power-tools");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
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
    ].filter((name) => db.objectStoreNames.contains(name));
    const tx = db.transaction(stores, "readwrite");
    stores.forEach((name) => tx.objectStore(name).clear());
    await new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    db.close();
  });
}

async function commitVaultPreview(page) {
  await page.goto("/vault");
  await page.getByRole("button", { name: /Preview Vault/i }).click();
  await page.getByRole("button", { name: /Commit Vault/i }).click();
  await expect(page.getByText("asset-video-1", { exact: true })).toBeVisible();
}

test("Phase 0 preserves Vault-to-Movie draft creation", async ({ page }) => {
  await clearAppStores(page);
  await commitVaultPreview(page);
  await page.goto("/movie");
  await page.getByRole("button", { name: /Build from Vault/i }).click();
  await page.getByLabel(/Recipe/i).selectOption("recent");
  await page.getByRole("button", { name: /Create movie drafts/i }).click();
  await expect(page).toHaveURL(/\/movie\?id=/);
  await expect(page.getByText(/clip/i)).toBeVisible();
});

test("Phase 0 keeps current Movie list usable", async ({ page }) => {
  await clearAppStores(page);
  await page.goto("/movie");
  await page.getByRole("button", { name: /New Movie/i }).click();
  await expect(page).toHaveURL(/\/movie\?id=/);
  await page.goto("/movie");
  await expect(page.getByText(/Untitled Movie/i)).toBeVisible();
});
```

- [ ] **Step 2: Run Phase 0 E2E**

Run:

```bash
npx playwright test -c playwright.web.config.js tests/e2e-web/movie-phase0.spec.js
```

Expected: PASS against the current app before Review Bay replacement. If it fails because the baseline is broken, fix the baseline before proceeding.

- [ ] **Step 3: Run current unit and lint surfaces**

Run:

```bash
npm --prefix web run test:unit
npm --prefix web run lint
```

Expected: PASS. If lint warns about existing generated build artifacts, fix the repo config before proceeding.

- [ ] **Step 4: Update notes**

Append this section to `implementation-notes.html` before `</body>`:

```html
  <section>
    <h2>Task 1: Phase 0 Safety</h2>
    <ul>
      <li><strong>Design decisions:</strong> Added persistent E2E checks for existing Movie and Vault draft flows before replacement work.</li>
      <li><strong>Deviations:</strong> None.</li>
      <li><strong>Tradeoffs:</strong> Verified current behavior in Playwright rather than relying on manual memory of the existing app.</li>
      <li><strong>Open questions:</strong> None unless Phase 0 tests fail.</li>
      <li><strong>Validation:</strong> Record exact command output for Phase 0 E2E, web unit tests, and web lint.</li>
    </ul>
  </section>
```

- [ ] **Step 5: Commit Task 1**

Run:

```bash
git add tests/e2e-web/movie-phase0.spec.js implementation-notes.html
git commit -m "test(web): lock movie phase zero flows"
```

## Task 2: Export Engine Proof And Decision Record

**Files:**
- Create: `docs/superpowers/specs/2026-06-28-movie-maker-export-engine-decision.md`
- Create: `tests/e2e-web/fixtures/tiny-video-with-audio.mp4`
- Modify: `implementation-notes.html`
- Modify only if selected: `web/package.json`, `web/package-lock.json`

- [ ] **Step 1: Generate audio fixture**

Run:

```bash
ffmpeg -y -f lavfi -i testsrc=size=320x240:rate=30 -f lavfi -i sine=frequency=440:sample_rate=48000 -t 1.5 -c:v libx264 -pix_fmt yuv420p -c:a aac tests/e2e-web/fixtures/tiny-video-with-audio.mp4
ffprobe -v error -select_streams a:0 -show_entries stream=codec_name -of default=nw=1:nk=1 tests/e2e-web/fixtures/tiny-video-with-audio.mp4
```

Expected:

```text
aac
```

- [ ] **Step 2: Verify current package versions**

Run:

```bash
npm view @ffmpeg/core version
npm view @ffmpeg/core-mt version
npm view @ffmpeg/ffmpeg version
npm view mediabunny version
npm view remotion version
```

Expected on 2026-06-28 was:

```text
0.12.10
0.12.10
0.12.15
1.49.0
4.0.484
```

If any version changed, record the new values in the decision record.

- [ ] **Step 3: Prove FFmpeg.wasm conservative path**

Create a temporary local scratch file outside git:

```bash
mkdir -p /tmp/grok-movie-export-spike
cp tests/e2e-web/fixtures/tiny-video-with-audio.mp4 /tmp/grok-movie-export-spike/input.mp4
ffmpeg -y -i /tmp/grok-movie-export-spike/input.mp4 -c:v libx264 -pix_fmt yuv420p -c:a aac /tmp/grok-movie-export-spike/ffmpeg-output.mp4
ffprobe -v error -select_streams a:0 -show_entries stream=codec_name -of default=nw=1:nk=1 /tmp/grok-movie-export-spike/ffmpeg-output.mp4
```

Expected:

```text
aac
```

This proves the fixture and local output verification. FFmpeg.wasm browser proof happens in Task 10 with Playwright.

- [ ] **Step 4: Decide whether Mediabunny needs a proof in this plan**

If choosing to proof Mediabunny now, run:

```bash
npm --prefix web install mediabunny@1.49.0
```

Then create `web/src/lib/movie-export-engines.ts` in Task 10 with an adapter interface that can host either engine. If the proof fails or is not selected, remove Mediabunny before committing:

```bash
npm --prefix web uninstall mediabunny
```

Default decision for this plan: use FFmpeg.wasm single-thread for Phase 1, keep WebCodecs plus Mediabunny as the next export-engine spike unless there is clear evidence it beats FFmpeg.wasm on the same fixture during this task.

- [ ] **Step 5: Write decision record**

Create `docs/superpowers/specs/2026-06-28-movie-maker-export-engine-decision.md`:

```markdown
# Movie Maker Export Engine Decision

Date: 2026-06-28

Decision: Use FFmpeg.wasm single-thread as the Phase 1 export engine unless this file records a successful same-fixture Mediabunny proof before Task 10 starts.

Why:

- Phase 1 needs reliable MP4 with AAC audio proof more than a larger editor engine.
- FFmpeg.wasm is already in the web app dependency graph.
- Single-thread FFmpeg.wasm avoids cross-origin isolation and SharedArrayBuffer work.
- MediaRecorder remains a WebM fallback only.

Rejected for Phase 1:

- Remotion server rendering, because local-only Phase 1 must not introduce a hidden server or licensing decision.
- FFmpeg.wasm multithread, unless cross-origin isolation is separately proven.
- WebCodecs without Mediabunny or another muxer, because WebCodecs alone does not produce MP4 containers.

Proof:

- Fixture: `tests/e2e-web/fixtures/tiny-video-with-audio.mp4`
- Fixture audio proof: `aac`
- Browser export proof: completed in Task 10 E2E before final validation.

Versions checked:

- `@ffmpeg/core`: record actual version from Step 2
- `@ffmpeg/core-mt`: record actual version from Step 2
- `@ffmpeg/ffmpeg`: record actual version from Step 2
- `mediabunny`: record actual version from Step 2
- `remotion`: record actual version from Step 2

Fallback:

- Keep WebM export available.
- Pause if MP4 with AAC audio cannot be proven.
```

Replace the `record actual version` text with exact values from Step 2 before committing.

- [ ] **Step 6: Update notes and commit**

Append this section to `implementation-notes.html` before `</body>`:

```html
  <section>
    <h2>Task 2: Export Engine Decision</h2>
    <ul>
      <li><strong>Design decisions:</strong> Record the selected Phase 1 export engine and exact package versions.</li>
      <li><strong>Deviations:</strong> Record any deviation from FFmpeg.wasm single-thread default.</li>
      <li><strong>Tradeoffs:</strong> Compare FFmpeg.wasm, WebCodecs plus Mediabunny, and Remotion.</li>
      <li><strong>Open questions:</strong> Pause if no engine can prove MP4 with AAC audio.</li>
      <li><strong>Validation:</strong> Record `ffprobe` result and any dependency changes.</li>
    </ul>
  </section>
```

Run:

```bash
git add docs/superpowers/specs/2026-06-28-movie-maker-export-engine-decision.md tests/e2e-web/fixtures/tiny-video-with-audio.mp4 implementation-notes.html web/package.json web/package-lock.json
git commit -m "docs(web): choose movie export engine"
```

If `web/package.json` and `web/package-lock.json` did not change, leave them out of `git add`.

## Task 3: Schema-First Review Bay Domain And Storage

**Files:**
- Modify: `web/package.json`
- Modify: `web/package-lock.json`
- Modify: `web/src/lib/local-storage.ts`
- Create: `web/src/lib/movie-review-types.ts`
- Create: `web/src/lib/movie-review-storage.ts`
- Create: `web/src/lib/movie-review-storage.test.ts`
- Modify: `implementation-notes.html`

- [ ] **Step 1: Install direct Zod dependency**

Run:

```bash
npm --prefix web install zod@4.4.3
```

Expected:

- `web/package.json` includes `"zod": "^4.4.3"`.
- `web/package-lock.json` changes.
- Root `package.json` does not change.

- [ ] **Step 2: Write failing storage tests**

Create `web/src/lib/movie-review-storage.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { createMovie, getDB } from "./local-storage";
import {
  createReviewProjectFromMovie,
  getReviewProject,
  listExportRuns,
  listMovieVersions,
  saveDirectorProposal,
  saveExportRun,
  saveMovieVersion,
  updateReviewProject,
} from "./movie-review-storage";
import type { DirectorProposal, MovieExportRun, MovieVersion } from "./movie-review-types";

async function clearStores() {
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
    await clearStores();
  });

  it("creates Review Bay stores while preserving legacy movies", async () => {
    const movie = await createMovie("Legacy movie");
    const db = await getDB();
    expect(db.objectStoreNames.contains("movies")).toBe(true);
    expect(db.objectStoreNames.contains("movie_review_projects")).toBe(true);
    expect(db.objectStoreNames.contains("movie_versions")).toBe(true);
    expect(db.objectStoreNames.contains("movie_director_proposals")).toBe(true);
    expect(db.objectStoreNames.contains("movie_export_runs")).toBe(true);
    expect(db.objectStoreNames.contains("movie_review_notes")).toBe(true);

    const project = await createReviewProjectFromMovie(movie.id);
    expect(project.movieId).toBe(movie.id);
    expect(project.mode).toBe("review");
    expect(project.candidates).toEqual([]);
    expect(project.committedClips).toEqual([]);
  });

  it("hydrates a legacy movie into candidates without storing signed URLs", async () => {
    const movie = await createMovie("Vault draft");
    const db = await getDB();
    await db.put("movies", {
      ...movie,
      clips: [
        {
          id: "clip-a",
          type: "video",
          videoUrl: "/api/vault/media/asset-video-1?objectKey=grok-powertools%2Fv1%2Fmedia%2Fa.mp4",
          sourceAssetId: "asset-video-1",
          transition: { type: "cut", duration: 0 },
          position: 0,
        },
      ],
    });

    const project = await createReviewProjectFromMovie(movie.id);
    expect(project.candidates).toHaveLength(1);
    expect(project.candidates[0].sourceAssetId).toBe("asset-video-1");
    expect(project.candidates[0].mediaRef.type).toBe("vault");
    expect(JSON.stringify(project)).not.toContain("objectKey=");
  });

  it("persists versions, proposals, and export runs independently", async () => {
    const movie = await createMovie("Project movie");
    const project = await createReviewProjectFromMovie(movie.id);
    await updateReviewProject({
      ...project,
      selectedTarget: { type: "candidate", clipId: "clip-a" },
    });

    const version: MovieVersion = {
      id: "version-a",
      movieId: movie.id,
      projectId: project.id,
      name: "Version A",
      description: "First version",
      clips: [],
      createdAt: "2026-06-28T00:00:00.000Z",
      updatedAt: "2026-06-28T00:00:00.000Z",
    };
    await saveMovieVersion(version);

    const proposal: DirectorProposal = {
      id: "proposal-a",
      movieId: movie.id,
      projectId: project.id,
      status: "pending",
      title: "Tighter ending",
      rationale: "Move strongest clip last.",
      changes: [],
      createdAt: "2026-06-28T00:00:00.000Z",
      updatedAt: "2026-06-28T00:00:00.000Z",
    };
    await saveDirectorProposal(proposal);

    const run: MovieExportRun = {
      id: "export-a",
      movieId: movie.id,
      projectId: project.id,
      format: "mp4",
      status: "complete",
      warnings: [],
      blockers: [],
      durationSeconds: 1.5,
      outputBytes: 1000,
      audioProof: { expectedAudio: true, hasAudioStream: true, codec: "aac" },
      createdAt: "2026-06-28T00:00:00.000Z",
      updatedAt: "2026-06-28T00:00:00.000Z",
    };
    await saveExportRun(run);

    expect(await getReviewProject(project.id)).toMatchObject({ selectedTarget: { type: "candidate", clipId: "clip-a" } });
    expect(await listMovieVersions(movie.id)).toEqual([version]);
    expect(await listExportRuns(project.id)).toEqual([run]);
  });
});
```

- [ ] **Step 3: Run tests to verify failure**

Run:

```bash
npm --prefix web run test:unit -- movie-review-storage
```

Expected: FAIL because the new modules and stores do not exist.

- [ ] **Step 4: Add schemas and types**

Create `web/src/lib/movie-review-types.ts`:

```ts
import { z } from "zod";

export const reviewModeSchema = z.enum(["review", "focus", "assemble"]);
export const clipLifecycleSchema = z.enum(["proposed", "kept", "rejected"]);
export const clipFlagSchema = z.enum(["trimmed", "has-source-audio", "muted-in-mix", "export-safe", "needs-attention"]);

export const mediaRefSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("vault"), assetId: z.string().min(1) }),
  z.object({ type: z.literal("url"), url: z.string().min(1) }),
  z.object({ type: z.literal("title") }),
]);

export const reviewClipSchema = z.object({
  id: z.string().min(1),
  movieClipId: z.string().optional(),
  sourceAssetId: z.string().optional(),
  mediaType: z.enum(["video", "image", "title"]),
  mediaRef: mediaRefSchema,
  videoUrl: z.string().optional(),
  imageUrl: z.string().optional(),
  titleText: z.string().optional(),
  position: z.number().int().nonnegative(),
  lifecycle: clipLifecycleSchema,
  flags: z.array(clipFlagSchema).default([]),
  trimStartSeconds: z.number().nonnegative().default(0),
  trimEndSeconds: z.number().positive().optional(),
  durationSeconds: z.number().positive().optional(),
  volume: z.number().min(0).max(2).default(1),
  muted: z.boolean().default(false),
  solo: z.boolean().default(false),
  notes: z.string().default(""),
  promptText: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const selectedTargetSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("candidate"), clipId: z.string().min(1) }),
  z.object({ type: z.literal("clip"), clipId: z.string().min(1) }),
  z.object({ type: z.literal("proposal"), proposalId: z.string().min(1) }),
]);

export const movieReviewProjectSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  movieId: z.string().min(1),
  mode: reviewModeSchema,
  title: z.string().min(1),
  candidates: z.array(reviewClipSchema),
  committedClips: z.array(reviewClipSchema),
  selectedTarget: selectedTargetSchema.optional(),
  activeIndex: z.number().int().nonnegative().default(0),
  masterVolume: z.number().min(0).max(2).default(1),
  masterMuted: z.boolean().default(false),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const directorChangeSchema = z.discriminatedUnion("type", [
  z.object({ id: z.string().min(1), type: z.literal("keep"), clipId: z.string().min(1), rationale: z.string() }),
  z.object({ id: z.string().min(1), type: z.literal("reject"), clipId: z.string().min(1), rationale: z.string() }),
  z.object({ id: z.string().min(1), type: z.literal("reorder"), clipIds: z.array(z.string().min(1)), rationale: z.string() }),
  z.object({ id: z.string().min(1), type: z.literal("trim"), clipId: z.string().min(1), trimStartSeconds: z.number().nonnegative(), trimEndSeconds: z.number().positive(), rationale: z.string() }),
]);

export const directorProposalSchema = z.object({
  id: z.string().min(1),
  movieId: z.string().min(1),
  projectId: z.string().min(1),
  status: z.enum(["pending", "partially-applied", "applied", "rejected", "invalid"]),
  title: z.string().min(1),
  rationale: z.string(),
  changes: z.array(directorChangeSchema),
  validationError: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const movieVersionSchema = z.object({
  id: z.string().min(1),
  movieId: z.string().min(1),
  projectId: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  clips: z.array(reviewClipSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const movieExportRunSchema = z.object({
  id: z.string().min(1),
  movieId: z.string().min(1),
  projectId: z.string().min(1),
  format: z.enum(["mp4", "webm"]),
  status: z.enum(["pending", "running", "complete", "failed", "cancelled"]),
  warnings: z.array(z.string()),
  blockers: z.array(z.string()),
  durationSeconds: z.number().nonnegative().optional(),
  outputBytes: z.number().nonnegative().optional(),
  audioProof: z.object({
    expectedAudio: z.boolean(),
    hasAudioStream: z.boolean(),
    codec: z.string().optional(),
  }),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type ReviewMode = z.infer<typeof reviewModeSchema>;
export type ClipLifecycle = z.infer<typeof clipLifecycleSchema>;
export type ClipFlag = z.infer<typeof clipFlagSchema>;
export type MediaRef = z.infer<typeof mediaRefSchema>;
export type ReviewClip = z.infer<typeof reviewClipSchema>;
export type SelectedTarget = z.infer<typeof selectedTargetSchema>;
export type MovieReviewProject = z.infer<typeof movieReviewProjectSchema>;
export type DirectorChange = z.infer<typeof directorChangeSchema>;
export type DirectorProposal = z.infer<typeof directorProposalSchema>;
export type MovieVersion = z.infer<typeof movieVersionSchema>;
export type MovieExportRun = z.infer<typeof movieExportRunSchema>;
```

- [ ] **Step 5: Add additive stores**

Modify `web/src/lib/local-storage.ts`:

```ts
const DB_VERSION = 6;
```

Inside the `upgrade` callback, after the existing movie store block and before `upgradeVaultStores(db);`, add:

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
          store.createIndex("by-updated", "updatedAt");
        } else {
          const store = transaction.objectStore("movie_versions");
          ensureIndex(store, "by-movie", "movieId");
          ensureIndex(store, "by-project", "projectId");
          ensureIndex(store, "by-updated", "updatedAt");
        }
        if (!db.objectStoreNames.contains("movie_director_proposals")) {
          const store = db.createObjectStore("movie_director_proposals", { keyPath: "id" });
          store.createIndex("by-project", "projectId");
          store.createIndex("by-updated", "updatedAt");
        } else {
          const store = transaction.objectStore("movie_director_proposals");
          ensureIndex(store, "by-project", "projectId");
          ensureIndex(store, "by-updated", "updatedAt");
        }
        if (!db.objectStoreNames.contains("movie_export_runs")) {
          const store = db.createObjectStore("movie_export_runs", { keyPath: "id" });
          store.createIndex("by-project", "projectId");
          store.createIndex("by-updated", "updatedAt");
        } else {
          const store = transaction.objectStore("movie_export_runs");
          ensureIndex(store, "by-project", "projectId");
          ensureIndex(store, "by-updated", "updatedAt");
        }
        if (!db.objectStoreNames.contains("movie_review_notes")) {
          const store = db.createObjectStore("movie_review_notes", { keyPath: "id" });
          store.createIndex("by-project", "projectId");
          store.createIndex("by-updated", "updatedAt");
        } else {
          const store = transaction.objectStore("movie_review_notes");
          ensureIndex(store, "by-project", "projectId");
          ensureIndex(store, "by-updated", "updatedAt");
        }
```

- [ ] **Step 6: Add storage helpers**

Create `web/src/lib/movie-review-storage.ts`:

```ts
import { v4 as uuidv4 } from "uuid";
import { getDB, getMovie } from "./local-storage";
import type { MovieClip } from "./types";
import {
  directorProposalSchema,
  movieExportRunSchema,
  movieReviewProjectSchema,
  movieVersionSchema,
  type DirectorProposal,
  type MovieExportRun,
  type MovieReviewProject,
  type MovieVersion,
  type ReviewClip,
} from "./movie-review-types";

function now(): string {
  return new Date().toISOString();
}

function mediaRefFromClip(clip: MovieClip): ReviewClip["mediaRef"] {
  if (clip.type === "title") return { type: "title" };
  if (clip.sourceAssetId) return { type: "vault", assetId: clip.sourceAssetId };
  const url = clip.videoUrl || clip.imageUrl || "";
  return { type: "url", url };
}

export function reviewClipFromMovieClip(clip: MovieClip, position: number, timestamp = now()): ReviewClip {
  return {
    id: clip.id || uuidv4(),
    movieClipId: clip.id,
    sourceAssetId: clip.sourceAssetId,
    mediaType: clip.type,
    mediaRef: mediaRefFromClip(clip),
    videoUrl: clip.sourceAssetId ? `/api/vault/media/${encodeURIComponent(clip.sourceAssetId)}` : clip.videoUrl,
    imageUrl: clip.imageUrl,
    titleText: clip.titleText,
    position,
    lifecycle: "proposed",
    flags: [],
    trimStartSeconds: clip.trimStart || 0,
    trimEndSeconds: clip.trimEnd,
    durationSeconds: clip.type === "image" ? clip.stillDuration || 3 : clip.titleDuration,
    volume: 1,
    muted: false,
    solo: false,
    notes: "",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export async function createReviewProjectFromMovie(movieId: string): Promise<MovieReviewProject> {
  const db = await getDB();
  const existing = await db.getAllFromIndex("movie_review_projects", "by-movie", movieId) as MovieReviewProject[];
  const active = existing.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0];
  if (active) return movieReviewProjectSchema.parse(active);

  const movie = await getMovie(movieId);
  if (!movie) throw new Error(`Movie not found: ${movieId}`);
  const timestamp = now();
  const project: MovieReviewProject = {
    schemaVersion: 1,
    id: uuidv4(),
    movieId: movie.id,
    mode: "review",
    title: movie.name,
    candidates: movie.clips.map((clip, index) => reviewClipFromMovieClip(clip, index, timestamp)),
    committedClips: [],
    activeIndex: 0,
    masterVolume: 1,
    masterMuted: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const parsed = movieReviewProjectSchema.parse(project);
  await db.put("movie_review_projects", parsed);
  return parsed;
}

export async function getReviewProject(projectId: string): Promise<MovieReviewProject | undefined> {
  const db = await getDB();
  const record = await db.get("movie_review_projects", projectId);
  return record ? movieReviewProjectSchema.parse(record) : undefined;
}

export async function updateReviewProject(project: MovieReviewProject): Promise<MovieReviewProject> {
  const db = await getDB();
  const parsed = movieReviewProjectSchema.parse({ ...project, updatedAt: now() });
  await db.put("movie_review_projects", parsed);
  return parsed;
}

export async function saveMovieVersion(version: MovieVersion): Promise<MovieVersion> {
  const db = await getDB();
  const parsed = movieVersionSchema.parse(version);
  await db.put("movie_versions", parsed);
  return parsed;
}

export async function listMovieVersions(movieId: string): Promise<MovieVersion[]> {
  const db = await getDB();
  const rows = await db.getAllFromIndex("movie_versions", "by-movie", movieId) as MovieVersion[];
  return rows.map((row) => movieVersionSchema.parse(row)).sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

export async function saveDirectorProposal(proposal: DirectorProposal): Promise<DirectorProposal> {
  const db = await getDB();
  const parsed = directorProposalSchema.parse(proposal);
  await db.put("movie_director_proposals", parsed);
  return parsed;
}

export async function listDirectorProposals(projectId: string): Promise<DirectorProposal[]> {
  const db = await getDB();
  const rows = await db.getAllFromIndex("movie_director_proposals", "by-project", projectId) as DirectorProposal[];
  return rows.map((row) => directorProposalSchema.parse(row)).sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

export async function saveExportRun(run: MovieExportRun): Promise<MovieExportRun> {
  const db = await getDB();
  const parsed = movieExportRunSchema.parse(run);
  await db.put("movie_export_runs", parsed);
  return parsed;
}

export async function listExportRuns(projectId: string): Promise<MovieExportRun[]> {
  const db = await getDB();
  const rows = await db.getAllFromIndex("movie_export_runs", "by-project", projectId) as MovieExportRun[];
  return rows.map((row) => movieExportRunSchema.parse(row)).sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}
```

- [ ] **Step 7: Run storage tests**

Run:

```bash
npm --prefix web run test:unit -- movie-review-storage
```

Expected: PASS.

- [ ] **Step 8: Commit Task 3**

Run:

```bash
git add web/package.json web/package-lock.json web/src/lib/local-storage.ts web/src/lib/movie-review-types.ts web/src/lib/movie-review-storage.ts web/src/lib/movie-review-storage.test.ts implementation-notes.html
git commit -m "feat(web): add movie review storage"
```

## Task 4: Timebase, Timeline Model, And Review Reducer

**Files:**
- Create: `web/src/lib/movie-timebase.ts`
- Create: `web/src/lib/movie-timeline-model.ts`
- Create: `web/src/lib/movie-timeline-model.test.ts`
- Create: `web/src/lib/movie-review-reducer.ts`
- Create: `web/src/lib/movie-review-reducer.test.ts`
- Modify: `implementation-notes.html`

- [ ] **Step 1: Write failing timeline tests**

Create `web/src/lib/movie-timeline-model.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { ReviewClip } from "./movie-review-types";
import { secondsToTicks, ticksToSeconds } from "./movie-timebase";
import { buildMovieTimeline, getExportPreflight, normalizeClipTrim } from "./movie-timeline-model";

function clip(id: string, patch: Partial<ReviewClip> = {}): ReviewClip {
  return {
    id,
    sourceAssetId: id,
    mediaType: "video",
    mediaRef: { type: "vault", assetId: id },
    videoUrl: `/api/vault/media/${id}`,
    position: 0,
    lifecycle: "kept",
    flags: [],
    trimStartSeconds: 0,
    trimEndSeconds: 2,
    durationSeconds: 2,
    volume: 1,
    muted: false,
    solo: false,
    notes: "",
    createdAt: "2026-06-28T00:00:00.000Z",
    updatedAt: "2026-06-28T00:00:00.000Z",
    ...patch,
  };
}

describe("movie timebase", () => {
  it("round-trips seconds through integer ticks", () => {
    expect(secondsToTicks(1.5)).toBe(45000);
    expect(ticksToSeconds(45000)).toBe(1.5);
  });
});

describe("movie timeline model", () => {
  it("builds stable entries from trimmed committed clips", () => {
    const entries = buildMovieTimeline([
      clip("a", { trimStartSeconds: 0.25, trimEndSeconds: 1.25, position: 0 }),
      clip("b", { trimStartSeconds: 0, trimEndSeconds: 2, position: 1 }),
    ]);
    expect(entries.map((entry) => ({ id: entry.clipId, start: entry.startTick, end: entry.endTick }))).toEqual([
      { id: "a", start: 0, end: 30000 },
      { id: "b", start: 30000, end: 90000 },
    ]);
  });

  it("normalizes invalid trim ranges", () => {
    expect(normalizeClipTrim(clip("a", { trimStartSeconds: 3, trimEndSeconds: 1, durationSeconds: 4 }))).toEqual({
      trimStartSeconds: 1,
      trimEndSeconds: 3,
    });
  });

  it("blocks export for unresolved candidates and unknown audio intent", () => {
    const preflight = getExportPreflight({
      committedClips: [clip("a", { flags: [] })],
      candidates: [clip("b", { lifecycle: "proposed" })],
      pendingProposalCount: 0,
    });
    expect(preflight.blockers).toContain("Unresolved unsafe candidate state");
    expect(preflight.blockers).toContain("Unknown audio intent");
  });
});
```

- [ ] **Step 2: Write failing reducer tests**

Create `web/src/lib/movie-review-reducer.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { MovieReviewProject, ReviewClip } from "./movie-review-types";
import { applyReviewCommand } from "./movie-review-reducer";

function clip(id: string, position = 0): ReviewClip {
  return {
    id,
    sourceAssetId: id,
    mediaType: "video",
    mediaRef: { type: "vault", assetId: id },
    videoUrl: `/api/vault/media/${id}`,
    position,
    lifecycle: "proposed",
    flags: [],
    trimStartSeconds: 0,
    trimEndSeconds: 2,
    durationSeconds: 2,
    volume: 1,
    muted: false,
    solo: false,
    notes: "",
    createdAt: "2026-06-28T00:00:00.000Z",
    updatedAt: "2026-06-28T00:00:00.000Z",
  };
}

function project(): MovieReviewProject {
  return {
    schemaVersion: 1,
    id: "project-a",
    movieId: "movie-a",
    title: "Movie",
    mode: "review",
    candidates: [clip("a", 0), clip("b", 1)],
    committedClips: [],
    activeIndex: 0,
    masterVolume: 1,
    masterMuted: false,
    createdAt: "2026-06-28T00:00:00.000Z",
    updatedAt: "2026-06-28T00:00:00.000Z",
  };
}

describe("movie review reducer", () => {
  it("keeps current candidate and auto-advances", () => {
    const next = applyReviewCommand(project(), { type: "keep-current" });
    expect(next.candidates.map((item) => item.id)).toEqual(["b"]);
    expect(next.committedClips.map((item) => item.id)).toEqual(["a"]);
    expect(next.activeIndex).toBe(0);
  });

  it("rejects current candidate without adding to committed cut", () => {
    const next = applyReviewCommand(project(), { type: "reject-current" });
    expect(next.candidates[0]).toMatchObject({ id: "b" });
    expect(next.committedClips).toEqual([]);
  });

  it("keeps proposal ids separate from clip ids", () => {
    const next = applyReviewCommand(project(), { type: "select", target: { type: "proposal", proposalId: "proposal-a" } });
    expect(next.selectedTarget).toEqual({ type: "proposal", proposalId: "proposal-a" });
  });

  it("updates trim and flags", () => {
    const kept = applyReviewCommand(project(), { type: "keep-current" });
    const trimmed = applyReviewCommand(kept, { type: "set-trim", clipId: "a", trimStartSeconds: 0.2, trimEndSeconds: 1.5 });
    expect(trimmed.committedClips[0]).toMatchObject({ trimStartSeconds: 0.2, trimEndSeconds: 1.5 });
    expect(trimmed.committedClips[0].flags).toContain("trimmed");
  });

  it("uses solo semantics where any soloed clip silences other clips", () => {
    const keptA = applyReviewCommand(project(), { type: "keep-current" });
    const keptB = applyReviewCommand(keptA, { type: "keep-current" });
    const solo = applyReviewCommand(keptB, { type: "set-audio", clipId: "a", volume: 1, muted: false, solo: true });
    expect(solo.committedClips.find((item) => item.id === "a")?.solo).toBe(true);
    expect(solo.committedClips.find((item) => item.id === "b")?.solo).toBe(false);
  });
});
```

- [ ] **Step 3: Run tests to verify failure**

Run:

```bash
npm --prefix web run test:unit -- movie-timeline-model movie-review-reducer
```

Expected: FAIL because modules do not exist.

- [ ] **Step 4: Add timebase and timeline model**

Create `web/src/lib/movie-timebase.ts`:

```ts
export const MOVIE_TIMEBASE = 30000;

export function secondsToTicks(seconds: number): number {
  return Math.round(seconds * MOVIE_TIMEBASE);
}

export function ticksToSeconds(ticks: number): number {
  return ticks / MOVIE_TIMEBASE;
}
```

Create `web/src/lib/movie-timeline-model.ts`:

```ts
import type { ReviewClip } from "./movie-review-types";
import { secondsToTicks } from "./movie-timebase";

export interface MovieTimelineEntry {
  clipId: string;
  startTick: number;
  endTick: number;
  sourceStartTick: number;
  durationTick: number;
}

export interface ExportPreflightInput {
  committedClips: ReviewClip[];
  candidates: ReviewClip[];
  pendingProposalCount: number;
}

export interface ExportPreflight {
  blockers: string[];
  warnings: string[];
}

export function normalizeClipTrim(clip: ReviewClip): { trimStartSeconds: number; trimEndSeconds: number } {
  const duration = clip.durationSeconds || clip.trimEndSeconds || 0;
  const rawStart = clip.trimStartSeconds || 0;
  const rawEnd = clip.trimEndSeconds ?? duration;
  const sortedStart = Math.min(rawStart, rawEnd);
  const sortedEnd = Math.max(rawStart, rawEnd);
  return {
    trimStartSeconds: Math.max(0, Math.min(sortedStart, duration || sortedStart)),
    trimEndSeconds: Math.max(0, Math.min(sortedEnd, duration || sortedEnd)),
  };
}

export function clipDurationSeconds(clip: ReviewClip): number {
  const trim = normalizeClipTrim(clip);
  if (clip.mediaType === "image" || clip.mediaType === "title") return clip.durationSeconds || 3;
  return Math.max(0, trim.trimEndSeconds - trim.trimStartSeconds);
}

export function buildMovieTimeline(clips: ReviewClip[]): MovieTimelineEntry[] {
  let cursor = 0;
  return clips
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((clip) => {
      const trim = normalizeClipTrim(clip);
      const durationTick = secondsToTicks(clipDurationSeconds(clip));
      const entry: MovieTimelineEntry = {
        clipId: clip.id,
        startTick: cursor,
        endTick: cursor + durationTick,
        sourceStartTick: secondsToTicks(trim.trimStartSeconds),
        durationTick,
      };
      cursor += durationTick;
      return entry;
    });
}

export function getExportPreflight(input: ExportPreflightInput): ExportPreflight {
  const blockers: string[] = [];
  const warnings: string[] = [];
  if (input.committedClips.length === 0) blockers.push("No committed clips");
  if (input.candidates.some((clip) => clip.lifecycle !== "rejected")) blockers.push("Unresolved unsafe candidate state");
  if (input.pendingProposalCount > 0) blockers.push("Pending proposal that would change export state");
  for (const clip of input.committedClips) {
    if (!clip.videoUrl && clip.mediaType === "video") blockers.push("Missing media");
    if (clipDurationSeconds(clip) <= 0) blockers.push("Invalid duration");
    if (!clip.flags.includes("has-source-audio") && !clip.flags.includes("muted-in-mix")) blockers.push("Unknown audio intent");
    if (clip.muted) warnings.push("Muted source audio");
  }
  return { blockers: [...new Set(blockers)], warnings: [...new Set(warnings)] };
}
```

- [ ] **Step 5: Add reducer**

Create `web/src/lib/movie-review-reducer.ts`:

```ts
import type { MovieReviewProject, ReviewClip, SelectedTarget } from "./movie-review-types";

export type ReviewCommand =
  | { type: "select"; target: SelectedTarget }
  | { type: "set-mode"; mode: MovieReviewProject["mode"] }
  | { type: "keep-current" }
  | { type: "reject-current" }
  | { type: "move-committed"; clipId: string; direction: -1 | 1 }
  | { type: "delete-committed"; clipId: string }
  | { type: "set-trim"; clipId: string; trimStartSeconds: number; trimEndSeconds: number }
  | { type: "set-audio"; clipId: string; volume: number; muted: boolean; solo: boolean };

function timestampProject(project: MovieReviewProject): MovieReviewProject {
  return { ...project, updatedAt: new Date().toISOString() };
}

function withPositions(clips: ReviewClip[]): ReviewClip[] {
  return clips.map((clip, position) => ({ ...clip, position }));
}

function activeCandidate(project: MovieReviewProject): ReviewClip | undefined {
  return project.candidates[project.activeIndex];
}

function flagClip(clip: ReviewClip, flag: ReviewClip["flags"][number], enabled: boolean): ReviewClip {
  const flags = new Set(clip.flags);
  if (enabled) flags.add(flag);
  else flags.delete(flag);
  return { ...clip, flags: [...flags] };
}

export function applyReviewCommand(project: MovieReviewProject, command: ReviewCommand): MovieReviewProject {
  switch (command.type) {
    case "select":
      return timestampProject({ ...project, selectedTarget: command.target });
    case "set-mode":
      return timestampProject({ ...project, mode: command.mode });
    case "keep-current": {
      const current = activeCandidate(project);
      if (!current) return project;
      const kept = { ...current, lifecycle: "kept" as const, position: project.committedClips.length };
      const candidates = project.candidates.filter((clip) => clip.id !== current.id);
      return timestampProject({
        ...project,
        candidates: withPositions(candidates),
        committedClips: withPositions([...project.committedClips, kept]),
        activeIndex: Math.min(project.activeIndex, Math.max(0, candidates.length - 1)),
        selectedTarget: { type: "clip", clipId: kept.id },
      });
    }
    case "reject-current": {
      const current = activeCandidate(project);
      if (!current) return project;
      const candidates = project.candidates.filter((clip) => clip.id !== current.id);
      return timestampProject({
        ...project,
        candidates: withPositions(candidates),
        activeIndex: Math.min(project.activeIndex, Math.max(0, candidates.length - 1)),
      });
    }
    case "move-committed": {
      const index = project.committedClips.findIndex((clip) => clip.id === command.clipId);
      const targetIndex = index + command.direction;
      if (index < 0 || targetIndex < 0 || targetIndex >= project.committedClips.length) return project;
      const next = [...project.committedClips];
      const [item] = next.splice(index, 1);
      next.splice(targetIndex, 0, item);
      return timestampProject({ ...project, committedClips: withPositions(next) });
    }
    case "delete-committed":
      return timestampProject({ ...project, committedClips: withPositions(project.committedClips.filter((clip) => clip.id !== command.clipId)) });
    case "set-trim":
      return timestampProject({
        ...project,
        committedClips: project.committedClips.map((clip) =>
          clip.id === command.clipId
            ? flagClip({ ...clip, trimStartSeconds: command.trimStartSeconds, trimEndSeconds: command.trimEndSeconds }, "trimmed", true)
            : clip,
        ),
      });
    case "set-audio":
      return timestampProject({
        ...project,
        committedClips: project.committedClips.map((clip) =>
          clip.id === command.clipId
            ? flagClip({ ...clip, volume: command.volume, muted: command.muted, solo: command.solo }, "muted-in-mix", command.muted)
            : clip,
        ),
      });
  }
}
```

- [ ] **Step 6: Run tests**

Run:

```bash
npm --prefix web run test:unit -- movie-timeline-model movie-review-reducer
```

Expected: PASS.

- [ ] **Step 7: Commit Task 4**

Run:

```bash
git add web/src/lib/movie-timebase.ts web/src/lib/movie-timeline-model.ts web/src/lib/movie-timeline-model.test.ts web/src/lib/movie-review-reducer.ts web/src/lib/movie-review-reducer.test.ts implementation-notes.html
git commit -m "feat(web): add movie review state model"
```

## Task 5: Director Domain And Server Boundary

**Files:**
- Create: `web/src/lib/movie-director.ts`
- Create: `web/src/lib/movie-director.test.ts`
- Create: `web/src/app/api/movie/director/route.ts`
- Modify: `implementation-notes.html`

- [ ] **Step 1: Write failing Director unit tests**

Create `web/src/lib/movie-director.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { MovieReviewProject, ReviewClip } from "./movie-review-types";
import { applyDirectorChanges, createRuleBasedDirectorProposal, parseDirectorProviderPayload } from "./movie-director";

function clip(id: string, position: number): ReviewClip {
  return {
    id,
    sourceAssetId: id,
    mediaType: "video",
    mediaRef: { type: "vault", assetId: id },
    videoUrl: `/api/vault/media/${id}`,
    position,
    lifecycle: "proposed",
    flags: [],
    trimStartSeconds: 0,
    trimEndSeconds: 2,
    durationSeconds: 2,
    volume: 1,
    muted: false,
    solo: false,
    notes: "",
    createdAt: "2026-06-28T00:00:00.000Z",
    updatedAt: "2026-06-28T00:00:00.000Z",
  };
}

function project(): MovieReviewProject {
  return {
    schemaVersion: 1,
    id: "project-a",
    movieId: "movie-a",
    title: "Movie",
    mode: "review",
    candidates: [clip("a", 0), clip("b", 1)],
    committedClips: [],
    activeIndex: 0,
    masterVolume: 1,
    masterMuted: false,
    createdAt: "2026-06-28T00:00:00.000Z",
    updatedAt: "2026-06-28T00:00:00.000Z",
  };
}

describe("movie director", () => {
  it("creates proposal-only rule output", () => {
    const proposal = createRuleBasedDirectorProposal(project());
    expect(proposal.status).toBe("pending");
    expect(proposal.changes.length).toBeGreaterThan(0);
  });

  it("rejects invalid provider output", () => {
    expect(() => parseDirectorProviderPayload({ title: "", changes: [{ type: "deleteEverything" }] }, project())).toThrow();
  });

  it("applies only selected changes", () => {
    const original = project();
    const proposal = createRuleBasedDirectorProposal(original);
    const next = applyDirectorChanges(original, proposal, [proposal.changes[0].id]);
    expect(next).not.toBe(original);
    expect(original.committedClips).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
npm --prefix web run test:unit -- movie-director
```

Expected: FAIL because module does not exist.

- [ ] **Step 3: Add Director module**

Create `web/src/lib/movie-director.ts`:

```ts
import { v4 as uuidv4 } from "uuid";
import { z } from "zod";
import type { DirectorProposal, MovieReviewProject } from "./movie-review-types";
import { directorProposalSchema } from "./movie-review-types";
import { applyReviewCommand } from "./movie-review-reducer";

export const providerDirectorPayloadSchema = z.object({
  title: z.string().min(1),
  rationale: z.string(),
  changes: z.array(z.object({
    id: z.string().min(1).optional(),
    type: z.enum(["keep", "reject", "reorder", "trim"]),
    clipId: z.string().optional(),
    clipIds: z.array(z.string()).optional(),
    trimStartSeconds: z.number().nonnegative().optional(),
    trimEndSeconds: z.number().positive().optional(),
    rationale: z.string(),
  })),
});

export function createRuleBasedDirectorProposal(project: MovieReviewProject): DirectorProposal {
  const timestamp = new Date().toISOString();
  const first = project.candidates[0];
  const changes = first
    ? [{ id: uuidv4(), type: "keep" as const, clipId: first.id, rationale: "Keep the first available candidate to start the cut." }]
    : [];
  return directorProposalSchema.parse({
    id: uuidv4(),
    movieId: project.movieId,
    projectId: project.id,
    status: "pending",
    title: "Start with strongest available clip",
    rationale: "Rule-based Director uses the current candidate order and proposes a conservative first assembly.",
    changes,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}

export function parseDirectorProviderPayload(payload: unknown, project: MovieReviewProject): DirectorProposal {
  const parsed = providerDirectorPayloadSchema.parse(payload);
  const timestamp = new Date().toISOString();
  return directorProposalSchema.parse({
    id: uuidv4(),
    movieId: project.movieId,
    projectId: project.id,
    status: "pending",
    title: parsed.title,
    rationale: parsed.rationale,
    changes: parsed.changes.map((change) => ({ ...change, id: change.id || uuidv4() })),
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}

export function applyDirectorChanges(project: MovieReviewProject, proposal: DirectorProposal, selectedChangeIds: string[]): MovieReviewProject {
  const selected = new Set(selectedChangeIds);
  let next = project;
  for (const change of proposal.changes) {
    if (!selected.has(change.id)) continue;
    if (change.type === "keep") {
      const index = next.candidates.findIndex((clip) => clip.id === change.clipId);
      next = { ...next, activeIndex: Math.max(0, index) };
      next = applyReviewCommand(next, { type: "keep-current" });
    }
    if (change.type === "reject") {
      const index = next.candidates.findIndex((clip) => clip.id === change.clipId);
      next = { ...next, activeIndex: Math.max(0, index) };
      next = applyReviewCommand(next, { type: "reject-current" });
    }
    if (change.type === "trim") {
      next = applyReviewCommand(next, {
        type: "set-trim",
        clipId: change.clipId,
        trimStartSeconds: change.trimStartSeconds,
        trimEndSeconds: change.trimEndSeconds,
      });
    }
  }
  return next;
}
```

- [ ] **Step 4: Add server route**

Create `web/src/app/api/movie/director/route.ts`:

```ts
import { NextResponse } from "next/server";
import { movieReviewProjectSchema } from "@/lib/movie-review-types";
import { parseDirectorProviderPayload } from "@/lib/movie-director";

function directorConfig() {
  return {
    baseUrl: process.env.MOVIE_DIRECTOR_BASE_URL || process.env.CLIPROXYAPI_BASE_URL || "",
    apiKey: process.env.MOVIE_DIRECTOR_API_KEY || process.env.CLIPROXYAPI_API_KEY || "",
    model: process.env.MOVIE_DIRECTOR_MODEL || "gpt-4.1-mini",
  };
}

export async function GET() {
  const config = directorConfig();
  return NextResponse.json({ configured: Boolean(config.baseUrl && config.apiKey), model: config.model });
}

export async function POST(request: Request) {
  const config = directorConfig();
  if (!config.baseUrl || !config.apiKey) {
    return NextResponse.json({ error: "MOVIE_DIRECTOR_NOT_CONFIGURED" }, { status: 503 });
  }
  const body = await request.json();
  const project = movieReviewProjectSchema.parse(body.project);
  const response = await fetch(`${config.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages: [
        { role: "system", content: "Return strict JSON with title, rationale, and changes. Do not claim edits were applied." },
        { role: "user", content: JSON.stringify({ project }) },
      ],
      response_format: { type: "json_object" },
    }),
  });
  if (!response.ok) {
    return NextResponse.json({ error: "MOVIE_DIRECTOR_PROVIDER_FAILED" }, { status: 502 });
  }
  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  const parsedContent = typeof content === "string" ? JSON.parse(content) : content;
  const proposal = parseDirectorProviderPayload(parsedContent, project);
  return NextResponse.json({ proposal });
}
```

If this route conflicts with a newer Next route-test harness, adapt only the route exports, not the browser credential boundary.

- [ ] **Step 5: Run Director tests**

Run:

```bash
npm --prefix web run test:unit -- movie-director
```

Expected: PASS.

- [ ] **Step 6: Commit Task 5**

Run:

```bash
git add web/src/lib/movie-director.ts web/src/lib/movie-director.test.ts web/src/app/api/movie/director/route.ts implementation-notes.html
git commit -m "feat(web): add movie director boundary"
```

## Task 6: Seeded E2E Helpers And Review Bay Shell

**Files:**
- Create: `tests/e2e-web/support/movie-fixtures.js`
- Create: `tests/e2e-web/movie-review-bay.spec.js`
- Create: `web/src/components/movie/review/useMovieReviewProject.ts`
- Create: `web/src/components/movie/review/useMovieKeyboard.ts`
- Create: `web/src/components/movie/review/MovieReviewBay.tsx`
- Create: `web/src/components/movie/review/MovieReviewHeader.tsx`
- Create: `web/src/components/movie/review/MovieLeftRail.tsx`
- Create: `web/src/components/movie/review/MovieCandidatesGrid.tsx`
- Create: `web/src/components/movie/review/MovieClipStrip.tsx`
- Create: `web/src/components/movie/review/MovieInspector.tsx`
- Create: `web/src/components/movie/review/MovieStatusBadges.tsx`
- Modify: `web/src/components/movie/MovieMaker.tsx`
- Modify: `implementation-notes.html`

- [ ] **Step 1: Create E2E seed helper**

Create `tests/e2e-web/support/movie-fixtures.js`:

```js
async function seedReviewMovie(page, options = {}) {
  await page.goto("/movie");
  return page.evaluate(async ({ useAudioFixture = false } = {}) => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("grok-power-tools");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    const tx = db.transaction(["movies"], "readwrite");
    const movieId = `movie-${Date.now()}`;
    const suffix = useAudioFixture ? "audio-" : "";
    const movie = {
      id: movieId,
      name: "Seeded Review Movie",
      resolution: { w: 1080, h: 1920 },
      clips: [
        {
          id: "clip-a",
          type: "video",
          videoUrl: `/api/vault/media/asset-video-${suffix}1`,
          sourceAssetId: `asset-video-${suffix}1`,
          transition: { type: "cut", duration: 0 },
          position: 0,
        },
        {
          id: "clip-b",
          type: "video",
          videoUrl: `/api/vault/media/asset-video-${suffix}2`,
          sourceAssetId: `asset-video-${suffix}2`,
          transition: { type: "cut", duration: 0 },
          position: 1,
        },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    tx.objectStore("movies").put(movie);
    await new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    db.close();
    return movieId;
  }, options);
}

module.exports = { seedReviewMovie };
```

- [ ] **Step 2: Write failing shell E2E**

Create `tests/e2e-web/movie-review-bay.spec.js`:

```js
const { test, expect } = require("@playwright/test");
const { seedReviewMovie } = require("./support/movie-fixtures");

test("Review Bay first viewport exposes operator regions", async ({ page }) => {
  const movieId = await seedReviewMovie(page);
  await page.goto(`/movie?id=${movieId}`);
  await expect(page.getByRole("banner", { name: /Movie Review Header/i })).toBeVisible();
  await expect(page.getByRole("region", { name: /Drafts and Director/i })).toBeVisible();
  await expect(page.getByRole("region", { name: /Candidates Grid/i })).toBeVisible();
  await expect(page.getByRole("region", { name: /Inspector/i })).toBeVisible();
  await expect(page.getByRole("region", { name: /Clip Strip/i })).toBeVisible();
});

test("Keyboard keep and reject move candidates into the right lanes", async ({ page }) => {
  const movieId = await seedReviewMovie(page);
  await page.goto(`/movie?id=${movieId}`);
  await page.keyboard.press("KeyK");
  await expect(page.getByRole("region", { name: /Clip Strip/i }).getByText("asset-video-1")).toBeVisible();
  await page.keyboard.press("KeyX");
  await expect(page.getByRole("region", { name: /Candidates Grid/i }).getByText("asset-video-2")).toHaveCount(0);
});
```

- [ ] **Step 3: Run E2E to verify failure**

Run:

```bash
npx playwright test -c playwright.web.config.js tests/e2e-web/movie-review-bay.spec.js
```

Expected: FAIL because Review Bay does not exist.

- [ ] **Step 4: Create minimal Review Bay shell**

Create the listed component files with working data wiring. The shell must render real project data, not fake text.

`MovieReviewBay.tsx` minimum structure:

```tsx
"use client";

import { useEffect } from "react";
import type { Movie } from "@/lib/types";
import { applyReviewCommand } from "@/lib/movie-review-reducer";
import MovieReviewHeader from "./MovieReviewHeader";
import MovieLeftRail from "./MovieLeftRail";
import MovieCandidatesGrid from "./MovieCandidatesGrid";
import MovieClipStrip from "./MovieClipStrip";
import MovieInspector from "./MovieInspector";
import { useMovieReviewProject } from "./useMovieReviewProject";
import { useMovieKeyboard } from "./useMovieKeyboard";

export default function MovieReviewBay({ movie }: { movie: Movie }) {
  const { project, setProject, status } = useMovieReviewProject(movie.id);
  useMovieKeyboard(project, setProject);

  useEffect(() => {
    if (!project) return;
    if (project.title !== movie.name) setProject({ ...project, title: movie.name });
  }, [movie.name, project, setProject]);

  if (!project) return <div className="flex h-full items-center justify-center text-sm text-neutral-400">{status}</div>;

  return (
    <div className="movie-review-grid h-[calc(100vh-3.5rem)] bg-neutral-950 text-neutral-100">
      <MovieReviewHeader project={project} onProjectChange={setProject} />
      <MovieLeftRail project={project} onProjectChange={setProject} />
      <MovieCandidatesGrid project={project} onProjectChange={setProject} />
      <MovieInspector project={project} onProjectChange={setProject} />
      <MovieClipStrip project={project} onProjectChange={setProject} />
    </div>
  );
}
```

`useMovieReviewProject.ts` must call `createReviewProjectFromMovie(movieId)` and debounce `updateReviewProject(project)` by 300ms after local changes.

`useMovieKeyboard.ts` must ignore `input`, `textarea`, `select`, and `[contenteditable="true"]`, then map:

- `KeyK` and `Enter` to `keep-current`
- `KeyX` and `Backspace` to `reject-current` only outside text inputs
- `Digit1`, `Digit2`, `Digit3` to `review`, `focus`, `assemble`
- `ArrowLeft` and `ArrowRight` to committed clip move only when selected target is `clip`

- [ ] **Step 5: Modify MovieMaker**

Replace the internal editor body in `web/src/components/movie/MovieMaker.tsx` with:

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
    getMovie(movieId).then((record) => {
      if (record) setMovie(record);
      else router.push("/movie");
    });
  }, [movieId, router]);

  if (!movie) {
    return (
      <div className="flex h-[calc(100vh-3.5rem)] items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-neutral-600 border-t-orange-500" />
      </div>
    );
  }

  return <MovieReviewBay movie={movie} />;
}
```

- [ ] **Step 6: Run shell E2E**

Run:

```bash
npx playwright test -c playwright.web.config.js tests/e2e-web/movie-review-bay.spec.js
```

Expected: PASS.

- [ ] **Step 7: Commit Task 6**

Run:

```bash
git add web/src/components/movie/MovieMaker.tsx web/src/components/movie/review tests/e2e-web/support/movie-fixtures.js tests/e2e-web/movie-review-bay.spec.js implementation-notes.html
git commit -m "feat(web): add movie review bay shell"
```

## Task 7: Review Surfaces, Inspector, Draft Queue, And Focus Mode

**Files:**
- Modify: `web/src/components/movie/review/MovieCandidatesGrid.tsx`
- Modify: `web/src/components/movie/review/MovieClipStrip.tsx`
- Modify: `web/src/components/movie/review/MovieInspector.tsx`
- Create: `web/src/components/movie/review/MovieDraftQueue.tsx`
- Create: `web/src/components/movie/review/MovieFocusLoupe.tsx`
- Modify: `web/src/components/movie/review/MovieLeftRail.tsx`
- Modify: `web/src/components/movie/review/MovieReviewBay.tsx`
- Modify: `tests/e2e-web/movie-review-bay.spec.js`
- Modify: `implementation-notes.html`

- [ ] **Step 1: Extend E2E**

Append to `tests/e2e-web/movie-review-bay.spec.js`:

```js
test("Review Bay keeps Candidates Grid separate from committed Clip Strip", async ({ page }) => {
  const movieId = await seedReviewMovie(page);
  await page.goto(`/movie?id=${movieId}`);
  await expect(page.getByRole("region", { name: /Candidates Grid/i }).getByText("asset-video-1")).toBeVisible();
  await page.keyboard.press("KeyK");
  await expect(page.getByRole("region", { name: /Clip Strip/i }).getByText("asset-video-1")).toBeVisible();
  await expect(page.getByRole("region", { name: /Candidates Grid/i }).getByText("asset-video-1")).toHaveCount(0);
});

test("Inspector updates trim and audio state for selected committed clip", async ({ page }) => {
  const movieId = await seedReviewMovie(page);
  await page.goto(`/movie?id=${movieId}`);
  await page.keyboard.press("KeyK");
  await page.getByLabel(/Trim in/i).fill("0.4");
  await page.getByLabel(/Trim out/i).fill("1.4");
  await page.getByLabel(/Clip volume/i).fill("0.5");
  await page.getByRole("button", { name: /Mute clip/i }).click();
  await expect(page.getByRole("region", { name: /Clip Strip/i }).getByLabel(/trimmed/i)).toBeVisible();
  await expect(page.getByRole("region", { name: /Clip Strip/i }).getByLabel(/muted in mix/i)).toBeVisible();
});

test("Focus mode supports Enter to keep and Escape to return to Review", async ({ page }) => {
  const movieId = await seedReviewMovie(page);
  await page.goto(`/movie?id=${movieId}`);
  await page.keyboard.press("Digit2");
  await expect(page.getByRole("region", { name: /Focus Loupe/i })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("region", { name: /Clip Strip/i }).getByText("asset-video-1")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: /Review/i })).toHaveAttribute("aria-pressed", "true");
});
```

- [ ] **Step 2: Run E2E to verify failure**

Run:

```bash
npx playwright test -c playwright.web.config.js tests/e2e-web/movie-review-bay.spec.js
```

Expected: FAIL for missing richer surfaces.

- [ ] **Step 3: Build actual surfaces**

Requirements:

- `MovieCandidatesGrid` renders only `project.candidates` with `role="region"` and `aria-label="Candidates Grid"`.
- `MovieClipStrip` renders only `project.committedClips` with `role="region"` and `aria-label="Clip Strip"`.
- `MovieInspector` reads `project.selectedTarget` and updates only the selected clip through reducer commands.
- `MovieDraftQueue` lists `listMovieVersions(project.movieId)` and applies whole-cut versions only.
- `MovieFocusLoupe` is rendered when `project.mode === "focus"` and exposes `aria-label="Focus Loupe"`.
- Status indicators use `MovieStatusBadges` with labels for proposed, kept, rejected, trimmed, has-source-audio, muted-in-mix, export-safe, and needs-attention.

`MovieStatusBadges.tsx` must include:

```tsx
import { Check, Diamond, Music, Scissors, VolumeX, X, AlertTriangle } from "lucide-react";
import type { ClipFlag, ClipLifecycle } from "@/lib/movie-review-types";

export function MovieLifecycleBadge({ lifecycle }: { lifecycle: ClipLifecycle }) {
  const Icon = lifecycle === "kept" ? Check : lifecycle === "rejected" ? X : Diamond;
  return (
    <span aria-label={`lifecycle ${lifecycle}`} className="inline-flex items-center gap-1 rounded border border-neutral-700 px-1.5 py-0.5 text-[11px]">
      <Icon className="h-3 w-3" />
      {lifecycle}
    </span>
  );
}

export function MovieFlagBadges({ flags }: { flags: ClipFlag[] }) {
  return (
    <span className="inline-flex flex-wrap gap-1">
      {flags.map((flag) => {
        const Icon = flag === "trimmed" ? Scissors : flag === "has-source-audio" ? Music : flag === "muted-in-mix" ? VolumeX : flag === "needs-attention" ? AlertTriangle : Check;
        return (
          <span key={flag} aria-label={flag.replaceAll("-", " ")} className="inline-flex items-center rounded border border-neutral-700 px-1 py-0.5">
            <Icon className="h-3 w-3" />
          </span>
        );
      })}
    </span>
  );
}
```

- [ ] **Step 4: Run unit and E2E tests**

Run:

```bash
npm --prefix web run test:unit -- movie-review-reducer movie-timeline-model
npx playwright test -c playwright.web.config.js tests/e2e-web/movie-review-bay.spec.js
```

Expected: PASS.

- [ ] **Step 5: Commit Task 7**

Run:

```bash
git add web/src/components/movie/review tests/e2e-web/movie-review-bay.spec.js implementation-notes.html
git commit -m "feat(web): build movie review surfaces"
```

## Task 8: Media Engine, Audio Preview, And Assemble Mode

**Files:**
- Create: `web/src/components/movie/review/useMovieMediaEngine.ts`
- Create: `web/src/components/movie/review/useMovieAudioPreview.ts`
- Create: `web/src/components/movie/review/MoviePreview.tsx`
- Create: `web/src/components/movie/review/MovieWaveform.tsx`
- Create: `web/src/components/movie/review/MovieAssembleView.tsx`
- Modify: `web/src/components/movie/review/MovieReviewBay.tsx`
- Modify: `tests/e2e-web/movie-review-bay.spec.js`
- Modify: `tests/e2e-web/movie-player-stability.spec.js`
- Modify: `implementation-notes.html`

- [ ] **Step 1: Add E2E for Assemble and non-muted source preview**

Append to `tests/e2e-web/movie-review-bay.spec.js`:

```js
test("Assemble mode shows continuous preview, ribbon, waveform controls, and audio lane", async ({ page }) => {
  const movieId = await seedReviewMovie(page);
  await page.goto(`/movie?id=${movieId}`);
  await page.keyboard.press("KeyK");
  await page.keyboard.press("Digit3");
  await expect(page.getByRole("region", { name: /Clip preview/i })).toBeVisible();
  await expect(page.getByRole("region", { name: /Time-proportional ribbon/i })).toBeVisible();
  await expect(page.getByRole("slider", { name: /Trim in/i })).toBeVisible();
  await expect(page.getByRole("slider", { name: /Trim out/i })).toBeVisible();
  await expect(page.getByText(/Source audio/i)).toBeVisible();
});
```

Append to `tests/e2e-web/movie-player-stability.spec.js`:

```js
test("Movie Review Bay avoids repeated active-video seek spam", async ({ page }) => {
  const { seedReviewMovie } = require("./support/movie-fixtures");
  const movieId = await seedReviewMovie(page);
  await page.goto(`/movie?id=${movieId}`);
  await page.keyboard.press("KeyK");
  await page.keyboard.press("Digit3");
  const seekCount = await page.evaluate(async () => {
    let writes = 0;
    const descriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "currentTime");
    if (!descriptor || !descriptor.set || !descriptor.get) return -1;
    Object.defineProperty(HTMLMediaElement.prototype, "currentTime", {
      configurable: true,
      get() { return descriptor.get.call(this); },
      set(value) { writes += 1; descriptor.set.call(this, value); },
    });
    document.dispatchEvent(new KeyboardEvent("keydown", { code: "Space" }));
    await new Promise((resolve) => setTimeout(resolve, 750));
    Object.defineProperty(HTMLMediaElement.prototype, "currentTime", descriptor);
    return writes;
  });
  expect(seekCount).toBeLessThan(8);
});
```

- [ ] **Step 2: Run E2E to verify failure**

Run:

```bash
npx playwright test -c playwright.web.config.js tests/e2e-web/movie-review-bay.spec.js tests/e2e-web/movie-player-stability.spec.js
```

Expected: FAIL until media engine and Assemble mode exist.

- [ ] **Step 3: Add media engine hook**

Create `useMovieMediaEngine.ts`:

```ts
"use client";

import { useEffect, useRef } from "react";
import type { ReviewClip } from "@/lib/movie-review-types";

export function detectSourceAudio(video: HTMLVideoElement): boolean | "unknown" {
  const maybeMoz = video as HTMLVideoElement & { mozHasAudio?: boolean };
  const maybeWebkit = video as HTMLVideoElement & { webkitAudioDecodedByteCount?: number };
  const maybeAudioTracks = video as HTMLVideoElement & { audioTracks?: { length: number } };
  if (typeof maybeMoz.mozHasAudio === "boolean") return maybeMoz.mozHasAudio;
  if (typeof maybeWebkit.webkitAudioDecodedByteCount === "number" && maybeWebkit.webkitAudioDecodedByteCount > 0) return true;
  if (maybeAudioTracks.audioTracks && maybeAudioTracks.audioTracks.length > 0) return true;
  return "unknown";
}

export function useMovieMediaEngine(clips: ReviewClip[]) {
  const videosRef = useRef(new Map<string, HTMLVideoElement>());
  const frameCallbacksRef = useRef(new Map<string, number>());

  useEffect(() => {
    const existing = videosRef.current;
    for (const clip of clips) {
      if (clip.mediaType !== "video" || !clip.videoUrl || existing.has(clip.id)) continue;
      const video = document.createElement("video");
      video.src = clip.videoUrl;
      video.preload = "metadata";
      video.crossOrigin = "anonymous";
      video.playsInline = true;
      existing.set(clip.id, video);
    }
    for (const [clipId, video] of existing) {
      if (!clips.some((clip) => clip.id === clipId)) {
        video.pause();
        video.removeAttribute("src");
        video.load();
        existing.delete(clipId);
      }
    }
    return () => {
      for (const [clipId, handle] of frameCallbacksRef.current) {
        const video = existing.get(clipId);
        video?.cancelVideoFrameCallback?.(handle);
      }
      for (const video of existing.values()) {
        video.pause();
        video.removeAttribute("src");
        video.load();
      }
      existing.clear();
      frameCallbacksRef.current.clear();
    };
  }, [clips]);

  return { videos: videosRef.current, detectSourceAudio };
}
```

- [ ] **Step 4: Add audio preview hook**

Create `useMovieAudioPreview.ts`:

```ts
"use client";

import { useEffect, useRef } from "react";
import type { ReviewClip } from "@/lib/movie-review-types";

export function useMovieAudioPreview(clips: ReviewClip[], videos: Map<string, HTMLVideoElement>, masterVolume: number, masterMuted: boolean) {
  const contextRef = useRef<AudioContext | null>(null);
  const nodesRef = useRef(new Map<string, { source: MediaElementAudioSourceNode; gain: GainNode }>());

  useEffect(() => {
    const context = contextRef.current || new AudioContext();
    contextRef.current = context;
    const anySolo = clips.some((clip) => clip.solo);
    for (const clip of clips) {
      const video = videos.get(clip.id);
      if (!video || nodesRef.current.has(clip.id)) continue;
      const source = context.createMediaElementSource(video);
      const gain = context.createGain();
      source.connect(gain).connect(context.destination);
      nodesRef.current.set(clip.id, { source, gain });
    }
    for (const clip of clips) {
      const node = nodesRef.current.get(clip.id);
      if (!node) continue;
      const audibleBySolo = !anySolo || clip.solo;
      node.gain.gain.value = masterMuted || clip.muted || !audibleBySolo ? 0 : clip.volume * masterVolume;
    }
    return () => {
      for (const [clipId, node] of nodesRef.current) {
        if (!clips.some((clip) => clip.id === clipId)) {
          node.source.disconnect();
          node.gain.disconnect();
          nodesRef.current.delete(clipId);
        }
      }
    };
  }, [clips, masterMuted, masterVolume, videos]);

  useEffect(() => () => {
    for (const node of nodesRef.current.values()) {
      node.source.disconnect();
      node.gain.disconnect();
    }
    nodesRef.current.clear();
    void contextRef.current?.close();
    contextRef.current = null;
  }, []);
}
```

- [ ] **Step 5: Add Preview, Waveform, and Assemble**

Requirements:

- `MoviePreview` exposes `role="region"` and `aria-label="Clip preview"`.
- Preview uses media engine videos, not new ad hoc media elements in each cell.
- `MovieWaveform` exposes `Trim in` and `Trim out` sliders with `aria-valuetext`.
- `MovieAssembleView` exposes `aria-label="Time-proportional ribbon"` and text `Source audio`.
- `MovieReviewBay` renders `MovieAssembleView` when `project.mode === "assemble"`.

`MovieWaveform.tsx` slider shape:

```tsx
<input type="range" aria-label="Trim in" aria-valuetext={`${trimStartSeconds.toFixed(2)} seconds`} />
<input type="range" aria-label="Trim out" aria-valuetext={`${trimEndSeconds.toFixed(2)} seconds`} />
```

- [ ] **Step 6: Run media tests**

Run:

```bash
npx playwright test -c playwright.web.config.js tests/e2e-web/movie-review-bay.spec.js tests/e2e-web/movie-player-stability.spec.js
```

Expected: PASS.

- [ ] **Step 7: Commit Task 8**

Run:

```bash
git add web/src/components/movie/review tests/e2e-web/movie-review-bay.spec.js tests/e2e-web/movie-player-stability.spec.js implementation-notes.html
git commit -m "feat(web): add movie preview audio"
```

## Task 9: Director UI And Proposal Application

**Files:**
- Create or modify: `web/src/components/movie/review/MovieDirectorPanel.tsx`
- Modify: `web/src/components/movie/review/MovieLeftRail.tsx`
- Modify: `web/src/components/movie/review/MovieDraftQueue.tsx`
- Modify: `web/src/lib/movie-review-storage.ts`
- Create: `tests/e2e-web/movie-director.spec.js`
- Modify: `implementation-notes.html`

- [ ] **Step 1: Write Director E2E**

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
  await page.getByLabel(/Select Director change 1/i).check();
  await page.getByRole("button", { name: /Apply selected changes/i }).click();
  await expect(page.getByText(/partially applied/i)).toBeVisible();
});
```

- [ ] **Step 2: Run Director E2E to verify failure**

Run:

```bash
npx playwright test -c playwright.web.config.js tests/e2e-web/movie-director.spec.js
```

Expected: FAIL until Director UI exists.

- [ ] **Step 3: Build Director panel**

Requirements:

- `MovieDirectorPanel` renders inside `MovieLeftRail` as a tab named `Director`.
- Rule-based button always works.
- Provider button first calls `GET /api/movie/director`; it is disabled if `{ configured: false }`.
- Browser state may store only configured boolean, model label, loading/error state, and proposal ids.
- Proposal cards use `article` and `aria-label="Director proposal <title>"`.
- Changes use checkboxes labelled `Select Director change 1`, `Select Director change 2`, and so on.
- Applying selected changes calls `applyDirectorChanges`, then `updateReviewProject`, then marks proposal status as `partially-applied` or `applied`.

- [ ] **Step 4: Add version helper**

Add to `web/src/lib/movie-review-storage.ts`:

```ts
export async function createMovieVersionFromProject(project: MovieReviewProject, name: string, description: string): Promise<MovieVersion> {
  const timestamp = new Date().toISOString();
  return saveMovieVersion({
    id: uuidv4(),
    movieId: project.movieId,
    projectId: project.id,
    name,
    description,
    clips: project.committedClips,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}
```

- [ ] **Step 5: Run Director tests**

Run:

```bash
npm --prefix web run test:unit -- movie-director movie-review-storage
npx playwright test -c playwright.web.config.js tests/e2e-web/movie-director.spec.js
```

Expected: PASS.

- [ ] **Step 6: Commit Task 9**

Run:

```bash
git add web/src/components/movie/review web/src/lib/movie-review-storage.ts tests/e2e-web/movie-director.spec.js implementation-notes.html
git commit -m "feat(web): add movie director panel"
```

## Task 10: Export Gate, MP4 With Audio, WebM Fallback, And History

**Files:**
- Create or modify: `web/src/components/movie/review/MovieExportGate.tsx`
- Create or modify: `web/src/components/movie/review/MovieExportButton.tsx`
- Create: `web/src/lib/movie-export-engines.ts`
- Create or modify: `web/src/lib/movie-export-args.ts`
- Create: `web/src/lib/movie-export-args.test.ts`
- Modify: `web/src/lib/useFFmpeg.ts`
- Modify: `web/src/lib/movie-review-storage.ts`
- Modify: `tests/e2e-web/fixtures/fake-vault-worker.mjs`
- Create: `tests/e2e-web/movie-export.spec.js`
- Modify: `implementation-notes.html`

- [ ] **Step 1: Update fake worker for audio fixture**

Modify `tests/e2e-web/fixtures/fake-vault-worker.mjs` so `/v1/vault/media` serves `tests/e2e-web/fixtures/tiny-video-with-audio.mp4` for asset ids or object keys containing `asset-video-audio-1` or `asset-video-audio-2`. Preserve the existing tiny silent video behavior for `asset-video-1` and `asset-video-2`.

- [ ] **Step 2: Write export arg tests**

Create `web/src/lib/movie-export-args.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildFfmpegConcatArgs } from "./movie-export-args";

describe("movie export args", () => {
  it("builds MP4 concat args with AAC audio", () => {
    expect(buildFfmpegConcatArgs({ inputs: ["clip-0.mp4", "clip-1.mp4"], output: "output.mp4", format: "mp4" })).toEqual([
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      "inputs.txt",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-movflags",
      "+faststart",
      "output.mp4",
    ]);
  });
});
```

- [ ] **Step 3: Write export E2E**

Create `tests/e2e-web/movie-export.spec.js`:

```js
const { test, expect } = require("@playwright/test");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { seedReviewMovie } = require("./support/movie-fixtures");

test("Export pre-flight blocks unresolved candidates and enables clean cut", async ({ page }) => {
  const movieId = await seedReviewMovie(page, { useAudioFixture: true });
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
  await page.getByRole("button", { name: /Load export engine/i }).click();
  await page.getByRole("button", { name: /Export MP4/i }).click();
  const download = await page.waitForEvent("download", { timeout: 180000 });
  const outputPath = path.join(testInfo.outputDir, "review-bay-export.mp4");
  await download.saveAs(outputPath);
  const codec = execFileSync("ffprobe", ["-v", "error", "-select_streams", "a:0", "-show_entries", "stream=codec_name", "-of", "default=nw=1:nk=1", outputPath], { encoding: "utf8" }).trim();
  expect(codec).toBe("aac");
  await expect(page.getByRole("button", { name: /Export WebM/i })).toBeVisible();
});
```

- [ ] **Step 4: Run export tests to verify failure**

Run:

```bash
npm --prefix web run test:unit -- movie-export-args
npx playwright test -c playwright.web.config.js tests/e2e-web/movie-export.spec.js
```

Expected: FAIL until export code exists.

- [ ] **Step 5: Update FFmpeg wrapper**

Modify `web/src/lib/useFFmpeg.ts`:

```ts
const FFMPEG_CORE_VERSION = "0.12.10";
const BASE_URL = `https://unpkg.com/@ffmpeg/core@${FFMPEG_CORE_VERSION}/dist/umd`;
```

Keep single-thread core unless Task 2 selected and proved another path.

- [ ] **Step 6: Add export args and engine interface**

Create `web/src/lib/movie-export-args.ts`:

```ts
export interface FfmpegConcatArgsInput {
  inputs: string[];
  output: string;
  format: "mp4" | "webm";
}

export function buildFfmpegConcatFile(inputs: string[]): string {
  return inputs.map((input) => `file '${input.replaceAll("'", "'\\''")}'`).join("\n");
}

export function buildFfmpegConcatArgs(input: FfmpegConcatArgsInput): string[] {
  const codecArgs = input.format === "mp4"
    ? ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-movflags", "+faststart"]
    : ["-c:v", "libvpx-vp9", "-c:a", "libopus"];
  return ["-f", "concat", "-safe", "0", "-i", "inputs.txt", ...codecArgs, input.output];
}
```

Create `web/src/lib/movie-export-engines.ts`:

```ts
import type { ReviewClip } from "./movie-review-types";

export interface MovieExportInput {
  clips: ReviewClip[];
  format: "mp4" | "webm";
}

export interface MovieExportResult {
  blob: Blob;
  format: "mp4" | "webm";
  audioProof: {
    expectedAudio: boolean;
    hasAudioStream: boolean;
    codec?: string;
  };
}

export type MovieExportEngine = {
  load(): Promise<void>;
  exportMovie(input: MovieExportInput): Promise<MovieExportResult>;
  terminate(): void;
};
```

- [ ] **Step 7: Build export UI**

Requirements:

- `MovieExportGate` computes `getExportPreflight`.
- Button label is `Export blocked` when blockers exist and `Export movie` when clean.
- Dialog or panel offers `Load export engine`, `Export MP4`, and `Export WebM`.
- MP4 path fetches each committed clip from `clip.videoUrl`, writes it to FFmpeg FS, writes `inputs.txt`, runs args, reads output, saves export run, and downloads.
- WebM fallback uses the same export engine or a clearly labelled WebM-only fallback.
- Cancellation calls `terminate()`.
- Save export runs with audio proof.

- [ ] **Step 8: Run export tests**

Run:

```bash
npm --prefix web run test:unit -- movie-export-args movie-timeline-model
npx playwright test -c playwright.web.config.js tests/e2e-web/movie-export.spec.js
```

Expected: PASS. The downloaded MP4 must contain an AAC audio stream.

- [ ] **Step 9: Commit Task 10**

Run:

```bash
git add web/src/components/movie/review/MovieExportGate.tsx web/src/components/movie/review/MovieExportButton.tsx web/src/lib/useFFmpeg.ts web/src/lib/movie-export-engines.ts web/src/lib/movie-export-args.ts web/src/lib/movie-export-args.test.ts web/src/lib/movie-review-storage.ts tests/e2e-web/fixtures/fake-vault-worker.mjs tests/e2e-web/movie-export.spec.js implementation-notes.html
git commit -m "feat(web): add movie export gate"
```

## Task 11: Responsive Review, Accessibility, And Visual Polish

**Files:**
- Modify: `web/src/app/globals.css`
- Modify: `web/src/components/movie/review/*`
- Modify: `tests/e2e-web/movie-review-bay.spec.js`
- Modify: `implementation-notes.html`

- [ ] **Step 1: Add responsive and accessibility E2E**

Append to `tests/e2e-web/movie-review-bay.spec.js`:

```js
test("Review Bay remains usable at phone width", async ({ page }) => {
  const movieId = await seedReviewMovie(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/movie?id=${movieId}`);
  await expect(page.getByRole("region", { name: /Candidates Grid/i })).toBeVisible();
  await expect(page.getByRole("region", { name: /Clip Strip/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /Focus/i })).toBeVisible();
});

test("Review Bay status indicators have accessible names", async ({ page }) => {
  const movieId = await seedReviewMovie(page);
  await page.goto(`/movie?id=${movieId}`);
  await page.keyboard.press("KeyK");
  await expect(page.getByLabel(/lifecycle kept/i).first()).toBeVisible();
});
```

- [ ] **Step 2: Run E2E to verify failure**

Run:

```bash
npx playwright test -c playwright.web.config.js tests/e2e-web/movie-review-bay.spec.js
```

Expected: FAIL for mobile or missing accessible names until polish is complete.

- [ ] **Step 3: Add CSS tokens and responsive layout**

Modify `web/src/app/globals.css` with scoped classes:

```css
.movie-review-grid {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  grid-template-columns: minmax(220px, 280px) minmax(0, 1fr) minmax(260px, 320px);
}

.movie-review-header {
  grid-column: 1 / -1;
}

.movie-review-left {
  min-height: 0;
}

.movie-review-center {
  min-height: 0;
}

.movie-review-inspector {
  min-height: 0;
}

.movie-review-strip {
  grid-column: 1 / -1;
}

@media (max-width: 800px) {
  .movie-review-grid {
    grid-template-columns: 1fr;
    grid-template-rows: auto minmax(0, 1fr) auto;
  }

  .movie-review-left,
  .movie-review-inspector {
    display: none;
  }
}
```

- [ ] **Step 4: Run accessibility/mobile E2E**

Run:

```bash
npx playwright test -c playwright.web.config.js tests/e2e-web/movie-review-bay.spec.js
```

Expected: PASS.

- [ ] **Step 5: Commit Task 11**

Run:

```bash
git add web/src/app/globals.css web/src/components/movie/review tests/e2e-web/movie-review-bay.spec.js implementation-notes.html
git commit -m "feat(web): polish movie review ui"
```

## Task 12: Full Validation And Manual Browser Pass

**Files:**
- Modify: `implementation-notes.html`
- Modify only files needed to fix validation failures

- [ ] **Step 1: Run full automated validation**

Run:

```bash
npm --prefix web run test:unit
npx playwright test -c playwright.web.config.js
npm --prefix web run lint
npm --prefix web run build
npm run test:unit
npm run lint
```

Expected:

- All commands PASS.
- If Next reports root inference or lockfile warnings, fix the repo config instead of leaving the warning.
- Root extension code should not change unless a test proves a required cross-surface fix.

- [ ] **Step 2: Start local app**

Run:

```bash
npm --prefix web run dev -- --port 3002
```

Expected: app is reachable at `http://localhost:3002`.

- [ ] **Step 3: Manual browser validation**

Using Browser/browser-use, agent-browser, plwr, or the in-app browser as appropriate, verify:

- Open `http://localhost:3002/vault`.
- Preview and commit local fake Vault data if needed.
- Open `http://localhost:3002/movie`.
- Build or select a Vault-backed movie draft.
- Confirm first viewport shows Draft/Director, Candidates Grid, Inspector, and Clip Strip.
- Keep and reject with keyboard.
- Enter Focus with `2`, keep with `Enter`, exit with `Esc`.
- Enter Assemble with `3`, play preview, and confirm source audio is not silently muted when fixture audio exists.
- Trim a clip, change volume, mute, solo, reorder, and delete.
- Run rule-based Director, preview proposal, partially apply one change, and create an alternate version.
- Export MP4, download it, and verify audio:

```bash
ffprobe -v error -select_streams a:0 -show_entries stream=codec_name -of default=nw=1:nk=1 /path/to/downloaded-file.mp4
```

Expected:

```text
aac
```

- Export WebM fallback.
- Set viewport to mobile width and confirm review/status works while fine editing is intentionally limited.

- [ ] **Step 4: Confirm hard boundaries**

Run:

```bash
git status --short
git diff --name-only HEAD
git diff -- web/.env.local .env cloud background.js content.js popup.js popup.html popup.css cloudSyncUtils.js
git diff HEAD -- web/.env.local .env cloud background.js content.js popup.js popup.html popup.css cloudSyncUtils.js
git diff HEAD | rg -n "(api[_-]?key|bearer|token|password|cookie|AIza|sk-|xai-|cf-|AKIA|-----BEGIN)" || true
```

Expected:

- Changed files are limited to web app files, tests, docs, and `implementation-notes.html`.
- No env, R2/D1/Worker, extension backup, processed-ID, live Grok, OAuth, secret, or bucket config files changed.
- Secret-pattern scan finds no real credentials. Literal safety text such as `api key` in docs is acceptable only when not a value.

- [ ] **Step 5: Commit final validation notes**

Run:

```bash
git add implementation-notes.html
git commit -m "docs: record movie review validation"
```

If validation fixes changed source files, include only those approved files in the same commit or a preceding semantic commit.

## Successor Plan Gates

Do not start Phase 2 until Task 12 passes and the user confirms the Review Bay feels good enough locally.

Phase 2 plan must start from:

- Actual Review Bay schemas and storage written in this plan.
- Actual export engine chosen in Task 2 and proven in Task 10.
- Actual user feedback from manual browser validation.

Phase 3 plan must not start until Phase 2 grouping and review intelligence are stable.

Phase 4 plan must not start until local export, versioning, and provider boundaries are stable and the user explicitly approves cloud/share scope.

## Self-Review

Spec coverage:

- Phase 0 verification: Tasks 0 and 1.
- Export engine decision gate: Task 2.
- Schema-first domain and additive storage: Task 3.
- Timebase and pure reducer logic: Task 4.
- Director proposal-only model and server boundary: Tasks 5 and 9.
- Review Bay first useful viewport and panels: Tasks 6 and 7.
- Audio preview and non-strobing preview: Task 8.
- MP4 with audio proof and WebM fallback: Task 10.
- Accessibility and mobile baseline: Task 11.
- Full validation, manual browser pass, and hard boundaries: Task 12.
- Phase 2 through Phase 4: intentionally out of this executable plan, with explicit successor gates.

Placeholder scan:

- No unresolved placeholder tokens from the writing-plans banned list.
- Code-changing tasks include concrete snippets, commands, and expected outcomes.
- Pause gates cover risky unknowns instead of guessing.

Type consistency:

- `ReviewClip`, `MovieReviewProject`, `DirectorProposal`, `MovieVersion`, and `MovieExportRun` are defined in Task 3 before use.
- Reducer command names in Task 4 match component requirements in Tasks 6 through 9.
- `selectedTarget` keeps `proposalId` separate from `clipId`.
- Export preflight and export UI share `getExportPreflight`.
- Director server route parses `movieReviewProjectSchema` before provider calls.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-28-movie-maker-review-bay-phase0-phase1.md`. Two execution options:

1. Subagent-Driven (recommended) - Dispatch a fresh subagent per task, review between tasks, fast iteration.

2. Inline Execution - Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
