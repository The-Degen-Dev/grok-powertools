# Vault Movie Drafts And Playback Stabilization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build local Vault-to-movie draft generation and stabilize Movie Maker preview playback for real Vault videos.

**Architecture:** Keep the existing `Movie` and `MovieClip` model, IndexedDB movie storage, Vault asset storage, and canvas preview path. Add a pure Vault draft builder, a small persistence helper, Vault and Movie Maker entry points, and a safer `CanvasPlayer` playback loop that avoids per-frame video seeking during normal playback.

**Tech Stack:** Next.js 16, React 19, TypeScript, IndexedDB via `idb`, Vitest for web unit tests, Playwright for web E2E tests, existing local fake Vault worker.

---

## Scope Check

The approved spec covers one web-app feature area: Movie Maker usability for Vault media. It has two tightly coupled parts, draft creation and player stability. They can ship in one plan because the generated drafts are only useful when Movie Maker can play them.

Out of scope for this plan:

- Chrome extension code.
- R2 writes, D1 writes, Worker repair routes, processed IDs, backup state, live Grok automation, and env files.
- Standalone Clip Editor redesign.
- Automatic cloud export or upload.

## File Structure

- Modify `web/package.json`: add a scoped web unit test script and Vitest dev dependency.
- Create `web/src/lib/vault-movie-drafts.ts`: pure recipe/filter/chunking logic. No IndexedDB, no React.
- Create `web/src/lib/vault-movie-drafts.test.ts`: Vitest tests for filtering, recipes, skips, naming, and clip defaults.
- Create `web/src/lib/vault-movie-draft-storage.ts`: saves builder output into existing local `Movie` records.
- Create `web/src/components/vault/VaultMovieDraftModal.tsx`: compact modal for scope, recipe, limits, and creation summary.
- Modify `web/src/components/vault/VaultGrid.tsx`: expose a `Build Movies` action near the existing Vault controls.
- Modify `web/src/components/vault/VaultPage.tsx`: pass committed assets, overlays, filtered set, and selected set into the modal.
- Modify `web/src/components/movie/MovieList.tsx`: add a `Build from Vault` entry point for users already in Movie Maker.
- Modify `web/src/components/movie/CanvasPlayer.tsx`: split scrub/sync behavior from normal playback and keep last good frames.
- Modify `tests/e2e-web/fixtures/fake-vault-worker.mjs`: add multiple valid video assets and a playable local MP4 fixture response.
- Create `tests/e2e-web/vault-movie-drafts.spec.js`: browser tests for Vault draft creation.
- Create `tests/e2e-web/movie-player-stability.spec.js`: browser tests for playback stability and scrubbing.

## Task 1: Add Web Unit Tests And Pure Vault Draft Builder

**Files:**
- Modify: `web/package.json`
- Create: `web/src/lib/vault-movie-drafts.ts`
- Create: `web/src/lib/vault-movie-drafts.test.ts`

- [ ] **Step 1: Install the web unit test runner**

Run:

```bash
npm --prefix web install -D vitest@4.1.9
```

Expected:

- `web/package.json` gains `vitest`.
- `web/package-lock.json` updates.
- No root `package.json` changes.

- [ ] **Step 2: Add the web unit test script**

Edit `web/package.json` so the scripts block contains this exact new line:

```json
"test:unit": "vitest run"
```

The resulting scripts block should look like this:

```json
"scripts": {
  "dev": "next dev --webpack --port 3001",
  "build": "next build",
  "start": "next start",
  "lint": "eslint",
  "test:unit": "vitest run"
}
```

- [ ] **Step 3: Write the failing draft-builder tests**

Create `web/src/lib/vault-movie-drafts.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildVaultMovieDrafts, type VaultDraftBuildInput } from "./vault-movie-drafts";
import type { VaultAsset, VaultOverlay } from "./vault-types";

function video(assetId: string, overrides: Partial<VaultAsset> = {}): VaultAsset {
  return {
    assetId,
    mediaType: "video",
    canonicalObjectKey: `grok-powertools/v1/users/greymaker/media/by-asset/${assetId}.mp4`,
    legacyObjectKeys: [],
    contentType: "video/mp4",
    sourceUrl: `https://grok.com/imagine/post/${assetId}`,
    promptText: "cinematic neon canyon flythrough",
    promptId: "prompt-shared",
    verificationStatus: "verified",
    gapCodes: [],
    createdAt: `2026-06-18T00:00:0${assetId.slice(-1)}.000Z`,
    updatedAt: `2026-06-18T00:00:0${assetId.slice(-1)}.000Z`,
    ...overrides,
  };
}

function image(assetId: string): VaultAsset {
  return {
    assetId,
    mediaType: "image",
    canonicalObjectKey: `grok-powertools/v1/users/greymaker/media/by-asset/${assetId}.png`,
    legacyObjectKeys: [],
    contentType: "image/png",
    promptText: "still frame",
    verificationStatus: "verified",
    gapCodes: [],
    createdAt: "2026-06-18T00:00:00.000Z",
    updatedAt: "2026-06-18T00:00:00.000Z",
  };
}

function overlay(assetId: string, patch: Partial<VaultOverlay>): VaultOverlay {
  return {
    assetId,
    tags: [],
    hidden: false,
    favorite: false,
    updatedAt: "2026-06-18T00:00:00.000Z",
    ...patch,
  };
}

function input(assets: VaultAsset[], overlays: VaultOverlay[] = []): VaultDraftBuildInput {
  return {
    assets,
    overlays,
    filteredAssetIds: assets.map((asset) => asset.assetId),
    selectedAssetIds: [],
    now: "2026-06-23T15:04:05.000Z",
  };
}

describe("buildVaultMovieDrafts", () => {
  it("builds recent verified video drafts with cut transitions and source asset ids", () => {
    const result = buildVaultMovieDrafts(input([video("asset-video-1"), video("asset-video-2"), image("asset-image-1")]), {
      recipe: "recent",
      scope: "filtered",
      maxClipsPerMovie: 1,
      maxMovies: 4,
    });

    expect(result.movies).toHaveLength(2);
    expect(result.movies.map((movie) => movie.clips[0].sourceAssetId)).toEqual(["asset-video-2", "asset-video-1"]);
    expect(result.movies.every((movie) => movie.clips[0].transition.type === "cut")).toBe(true);
    expect(result.skipped).toContainEqual({
      assetId: "asset-image-1",
      reason: "image-only asset",
    });
  });

  it("uses selected assets only for selected scope", () => {
    const result = buildVaultMovieDrafts(
      {
        ...input([video("asset-video-1"), video("asset-video-2")]),
        selectedAssetIds: ["asset-video-1"],
      },
      {
        recipe: "selected",
        scope: "selected",
        maxClipsPerMovie: 10,
        maxMovies: 2,
      },
    );

    expect(result.movies).toHaveLength(1);
    expect(result.movies[0].clips.map((clip) => clip.sourceAssetId)).toEqual(["asset-video-1"]);
  });

  it("uses favorite overlays for favorite drafts", () => {
    const result = buildVaultMovieDrafts(
      input([video("asset-video-1"), video("asset-video-2")], [overlay("asset-video-2", { favorite: true })]),
      {
        recipe: "favorites",
        scope: "favorites",
        maxClipsPerMovie: 10,
        maxMovies: 2,
      },
    );

    expect(result.movies).toHaveLength(1);
    expect(result.movies[0].clips.map((clip) => clip.sourceAssetId)).toEqual(["asset-video-2"]);
  });

  it("skips hidden assets unless the all visible verified scope is not hiding them", () => {
    const result = buildVaultMovieDrafts(
      input([video("asset-video-1"), video("asset-video-2")], [overlay("asset-video-1", { hidden: true })]),
      {
        recipe: "recent",
        scope: "filtered",
        maxClipsPerMovie: 10,
        maxMovies: 2,
      },
    );

    expect(result.movies[0].clips.map((clip) => clip.sourceAssetId)).toEqual(["asset-video-2"]);
    expect(result.skipped).toContainEqual({
      assetId: "asset-video-1",
      reason: "hidden by local overlay",
    });
  });

  it("creates deterministic prompt groups only when a group has at least two videos", () => {
    const result = buildVaultMovieDrafts(
      input([
        video("asset-video-1", { promptId: "prompt-a", promptText: "red glass city at sunrise" }),
        video("asset-video-2", { promptId: "prompt-a", promptText: "red glass city at sunrise" }),
        video("asset-video-3", { promptId: "prompt-b", promptText: "lonely single prompt" }),
      ]),
      {
        recipe: "prompt-groups",
        scope: "filtered",
        maxClipsPerMovie: 10,
        maxMovies: 4,
      },
    );

    expect(result.movies).toHaveLength(1);
    expect(result.movies[0].name).toContain("Prompt Group");
    expect(result.movies[0].clips.map((clip) => clip.sourceAssetId)).toEqual(["asset-video-2", "asset-video-1"]);
    expect(result.skipped).toContainEqual({
      assetId: "asset-video-3",
      reason: "no prompt group with at least two videos",
    });
  });
});
```

- [ ] **Step 4: Run the tests and verify they fail because the builder does not exist**

Run:

```bash
npm --prefix web run test:unit -- vault-movie-drafts
```

Expected: FAIL with an import resolution error for `./vault-movie-drafts`.

- [ ] **Step 5: Add the pure draft builder**

Create `web/src/lib/vault-movie-drafts.ts`:

```ts
import type { MovieClip } from "./types";
import type { VaultAsset, VaultOverlay } from "./vault-types";
import { vaultMediaUrl } from "./vault-media-url";

export type VaultDraftRecipe = "recent" | "selected" | "favorites" | "prompt-groups";
export type VaultDraftScope = "selected" | "filtered" | "visible-verified" | "favorites";

export interface VaultDraftBuildInput {
  assets: VaultAsset[];
  overlays?: VaultOverlay[];
  filteredAssetIds?: string[];
  selectedAssetIds?: string[];
  now?: string;
}

export interface VaultDraftBuildOptions {
  recipe: VaultDraftRecipe;
  scope: VaultDraftScope;
  maxClipsPerMovie: number;
  maxMovies: number;
}

export interface VaultDraftSkippedAsset {
  assetId: string;
  reason:
    | "image-only asset"
    | "unverified media"
    | "missing object key"
    | "hidden by local overlay"
    | "duplicate asset"
    | "not in selected scope"
    | "not in filtered scope"
    | "not favorite"
    | "no prompt group with at least two videos";
}

export interface VaultDraftMovie {
  name: string;
  recipe: VaultDraftRecipe;
  sourceScope: VaultDraftScope;
  clips: MovieClip[];
}

export interface VaultDraftBuildResult {
  consideredCount: number;
  eligibleCount: number;
  movies: VaultDraftMovie[];
  skipped: VaultDraftSkippedAsset[];
}

interface EligibleAsset {
  asset: VaultAsset;
  sortTime: number;
}

const DEFAULT_MAX_CLIPS_PER_MOVIE = 10;
const DEFAULT_MAX_MOVIES = 4;

function objectKey(asset: VaultAsset): string | undefined {
  return asset.canonicalObjectKey || asset.legacyObjectKeys[0];
}

function overlayByAssetId(overlays: VaultOverlay[] = []): Map<string, VaultOverlay> {
  return new Map(overlays.map((overlay) => [overlay.assetId, overlay]));
}

function createdOrUpdatedTime(asset: VaultAsset): number {
  const raw = asset.createdAt || asset.updatedAt;
  const value = new Date(raw).getTime();
  return Number.isFinite(value) ? value : 0;
}

function runTimestamp(now: string): string {
  return now.replace(/[:.]/g, "-").replace("T", " ").replace("Z", "");
}

function clipFromAsset(asset: VaultAsset, position: number): MovieClip {
  return {
    id: crypto.randomUUID(),
    type: "video",
    videoUrl: vaultMediaUrl(asset),
    sourceAssetId: asset.assetId,
    transition: { type: "cut", duration: 0 },
    position,
  };
}

function chunk<T>(items: T[], size: number, maxChunks: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length && chunks.length < maxChunks; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function promptGroupKey(asset: VaultAsset): string | null {
  if (asset.promptId) return `id:${asset.promptId}`;
  const normalized = (asset.promptText || "").trim().toLowerCase().replace(/\s+/g, " ");
  if (!normalized) return null;
  const words = normalized.split(" ").slice(0, 4);
  return words.length >= 4 ? `text:${words.join(" ")}` : null;
}

function movieName(recipe: VaultDraftRecipe, scope: VaultDraftScope, index: number, now: string, suffix?: string): string {
  const label: Record<VaultDraftRecipe, string> = {
    recent: "Recent Video Draft",
    selected: "Selected Video Draft",
    favorites: "Favorite Video Draft",
    "prompt-groups": "Prompt Group Draft",
  };
  const suffixText = suffix ? ` ${suffix}` : "";
  return `${label[recipe]} ${index + 1}${suffixText} - ${scope} - ${runTimestamp(now)}`;
}

function collectEligible(input: VaultDraftBuildInput, options: VaultDraftBuildOptions): {
  eligible: EligibleAsset[];
  skipped: VaultDraftSkippedAsset[];
  consideredCount: number;
} {
  const overlays = overlayByAssetId(input.overlays);
  const filtered = new Set(input.filteredAssetIds || input.assets.map((asset) => asset.assetId));
  const selected = new Set(input.selectedAssetIds || []);
  const seen = new Set<string>();
  const skipped: VaultDraftSkippedAsset[] = [];
  const eligible: EligibleAsset[] = [];

  for (const asset of input.assets) {
    const overlay = overlays.get(asset.assetId);
    if (seen.has(asset.assetId)) {
      skipped.push({ assetId: asset.assetId, reason: "duplicate asset" });
      continue;
    }
    seen.add(asset.assetId);

    if (options.scope === "selected" && !selected.has(asset.assetId)) {
      skipped.push({ assetId: asset.assetId, reason: "not in selected scope" });
      continue;
    }
    if (options.scope === "filtered" && !filtered.has(asset.assetId)) {
      skipped.push({ assetId: asset.assetId, reason: "not in filtered scope" });
      continue;
    }
    if (options.scope === "favorites" && !overlay?.favorite) {
      skipped.push({ assetId: asset.assetId, reason: "not favorite" });
      continue;
    }
    if (overlay?.hidden && options.scope !== "visible-verified") {
      skipped.push({ assetId: asset.assetId, reason: "hidden by local overlay" });
      continue;
    }
    if (asset.mediaType === "image") {
      skipped.push({ assetId: asset.assetId, reason: "image-only asset" });
      continue;
    }
    if (asset.mediaType !== "video" || asset.verificationStatus !== "verified") {
      skipped.push({ assetId: asset.assetId, reason: "unverified media" });
      continue;
    }
    if (!objectKey(asset)) {
      skipped.push({ assetId: asset.assetId, reason: "missing object key" });
      continue;
    }
    eligible.push({ asset, sortTime: createdOrUpdatedTime(asset) });
  }

  eligible.sort((a, b) => b.sortTime - a.sortTime || b.asset.assetId.localeCompare(a.asset.assetId));
  return { eligible, skipped, consideredCount: input.assets.length };
}

export function buildVaultMovieDrafts(
  input: VaultDraftBuildInput,
  rawOptions: VaultDraftBuildOptions,
): VaultDraftBuildResult {
  const options = {
    ...rawOptions,
    maxClipsPerMovie: Math.max(1, rawOptions.maxClipsPerMovie || DEFAULT_MAX_CLIPS_PER_MOVIE),
    maxMovies: Math.max(1, rawOptions.maxMovies || DEFAULT_MAX_MOVIES),
  };
  const now = input.now || new Date().toISOString();
  const { eligible, skipped, consideredCount } = collectEligible(input, options);
  const movies: VaultDraftMovie[] = [];

  if (options.recipe === "prompt-groups") {
    const byGroup = new Map<string, VaultAsset[]>();
    for (const item of eligible) {
      const key = promptGroupKey(item.asset);
      if (!key) {
        skipped.push({ assetId: item.asset.assetId, reason: "no prompt group with at least two videos" });
        continue;
      }
      byGroup.set(key, [...(byGroup.get(key) || []), item.asset]);
    }
    const groups = [...byGroup.entries()]
      .map(([key, assets]) => ({ key, assets }))
      .filter((group) => group.assets.length >= 2)
      .slice(0, options.maxMovies);
    const groupedAssetIds = new Set(groups.flatMap((group) => group.assets.map((asset) => asset.assetId)));
    for (const item of eligible) {
      if (!groupedAssetIds.has(item.asset.assetId)) {
        skipped.push({ assetId: item.asset.assetId, reason: "no prompt group with at least two videos" });
      }
    }
    for (const [index, group] of groups.entries()) {
      const assets = group.assets.slice(0, options.maxClipsPerMovie);
      movies.push({
        name: movieName(options.recipe, options.scope, index, now, group.key.replace(/^(id|text):/, "")),
        recipe: options.recipe,
        sourceScope: options.scope,
        clips: assets.map((asset, position) => clipFromAsset(asset, position)),
      });
    }
  } else {
    const chunks = chunk(
      eligible.map((item) => item.asset),
      options.maxClipsPerMovie,
      options.maxMovies,
    );
    for (const [index, assets] of chunks.entries()) {
      movies.push({
        name: movieName(options.recipe, options.scope, index, now),
        recipe: options.recipe,
        sourceScope: options.scope,
        clips: assets.map((asset, position) => clipFromAsset(asset, position)),
      });
    }
  }

  return {
    consideredCount,
    eligibleCount: eligible.length,
    movies,
    skipped,
  };
}
```

- [ ] **Step 6: Run the unit tests and verify they pass**

Run:

```bash
npm --prefix web run test:unit -- vault-movie-drafts
```

Expected: PASS for all `buildVaultMovieDrafts` tests.

- [ ] **Step 7: Run lint and build**

Run:

```bash
npm --prefix web run lint
npm --prefix web run build
```

Expected: both commands pass.

- [ ] **Step 8: Commit Task 1**

Run:

```bash
git add web/package.json web/package-lock.json web/src/lib/vault-movie-drafts.ts web/src/lib/vault-movie-drafts.test.ts
git commit -m "feat(web): add vault movie draft builder"
```

## Task 2: Persist Drafts And Add Vault Build Movies UI

**Files:**
- Create: `web/src/lib/vault-movie-draft-storage.ts`
- Create: `web/src/components/vault/VaultMovieDraftModal.tsx`
- Modify: `web/src/components/vault/VaultGrid.tsx`
- Modify: `web/src/components/vault/VaultPage.tsx`
- Modify: `tests/e2e-web/fixtures/fake-vault-worker.mjs`
- Create: `tests/e2e-web/vault-movie-drafts.spec.js`

- [ ] **Step 1: Write failing E2E tests for Vault draft creation**

Create `tests/e2e-web/vault-movie-drafts.spec.js`:

```js
const { test, expect } = require("@playwright/test");

async function resetDb(page) {
  await page.goto("/vault");
  await page.waitForFunction(async () => {
    const databases = await indexedDB.databases();
    const db = databases.find((entry) => entry.name === "grok-power-tools");
    return Number(db?.version || 0) >= 4;
  });
  await page.evaluate(async () => {
    const storeNames = [
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
    ];
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("grok-power-tools");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    const existingStores = storeNames.filter((name) => db.objectStoreNames.contains(name));
    const tx = db.transaction(existingStores, "readwrite");
    await Promise.all(existingStores.map((name) => tx.objectStore(name).clear()));
    await new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    db.close();
  });
}

async function readMovies(page) {
  return page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("grok-power-tools");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    const movies = await new Promise((resolve, reject) => {
      const tx = db.transaction("movies", "readonly");
      const request = tx.objectStore("movies").getAll();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    db.close();
    return movies;
  });
}

test("Vault Build Movies creates local selected video drafts with cut transitions", async ({ page }) => {
  await resetDb(page);
  await page.goto("/vault");
  await page.getByRole("button", { name: /Preview Vault/i }).click();
  await page.getByRole("button", { name: /Commit Vault/i }).click();
  await page.getByLabel(/Select asset-video-1/i).check();
  await page.getByLabel(/Select asset-video-2/i).check();
  await page.getByRole("button", { name: /Build Movies/i }).click();
  await page.getByLabel(/Recipe/i).selectOption("selected");
  await page.getByLabel(/Max clips per movie/i).fill("10");
  await page.getByLabel(/Max movies/i).fill("2");
  await page.getByRole("button", { name: /Create movie drafts/i }).click();
  await expect(page.getByText(/Created 1 movie draft/i)).toBeVisible();

  const movies = await readMovies(page);
  const draft = movies.find((movie) => movie.name.includes("Selected Video Draft"));
  expect(draft.clips.map((clip) => clip.sourceAssetId).sort()).toEqual(["asset-video-1", "asset-video-2"]);
  expect(draft.clips.every((clip) => clip.transition.type === "cut")).toBe(true);
});

test("Vault Build Movies uses current filtered visible set when nothing is selected", async ({ page }) => {
  await resetDb(page);
  await page.goto("/vault");
  await page.getByRole("button", { name: /Preview Vault/i }).click();
  await page.getByRole("button", { name: /Commit Vault/i }).click();
  await page.getByLabel(/Search Vault assets/i).fill("asset-video");
  await page.getByRole("button", { name: /Build Movies/i }).click();
  await page.getByLabel(/Recipe/i).selectOption("recent");
  await page.getByLabel(/Max clips per movie/i).fill("1");
  await page.getByLabel(/Max movies/i).fill("4");
  await page.getByRole("button", { name: /Create movie drafts/i }).click();
  await expect(page.getByText(/Created 2 movie drafts/i)).toBeVisible();

  const movies = await readMovies(page);
  expect(movies.filter((movie) => movie.name.includes("Recent Video Draft"))).toHaveLength(2);
});

test("Vault Build Movies can create favorite drafts", async ({ page }) => {
  await resetDb(page);
  await page.goto("/vault");
  await page.getByRole("button", { name: /Preview Vault/i }).click();
  await page.getByRole("button", { name: /Commit Vault/i }).click();
  await page.getByRole("button", { name: /Favorite asset-video-2/i }).click();
  await page.getByRole("button", { name: /Build Movies/i }).click();
  await page.getByLabel(/Source scope/i).selectOption("favorites");
  await page.getByLabel(/Recipe/i).selectOption("favorites");
  await page.getByRole("button", { name: /Create movie drafts/i }).click();
  await expect(page.getByText(/Created 1 movie draft/i)).toBeVisible();

  const movies = await readMovies(page);
  const draft = movies.find((movie) => movie.name.includes("Favorite Video Draft"));
  expect(draft.clips.map((clip) => clip.sourceAssetId)).toEqual(["asset-video-2"]);
});
```

- [ ] **Step 2: Run the E2E test and verify it fails because the UI does not exist**

Run:

```bash
npx playwright test -c playwright.web.config.js tests/e2e-web/vault-movie-drafts.spec.js
```

Expected: FAIL because the `Build Movies` button is missing.

- [ ] **Step 3: Add more video assets to the fake Vault worker**

Modify `tests/e2e-web/fixtures/fake-vault-worker.mjs` so `fixtureAssets` includes this second video before `asset-image-1`:

```js
{
  assetId: "asset-video-2",
  mediaType: "video",
  canonicalObjectKey: "grok-powertools/v1/users/greymaker/media/by-asset/asset-video-2.mp4",
  legacyObjectKeys: [],
  contentType: "video/mp4",
  sizeBytes: 1024,
  etag: "etag-video-2",
  sha256: "sha-video-2",
  sourceUrl: "https://grok.com/imagine/post/post-video-2",
  grokPostId: "post-video-2",
  promptId: "prompt-1",
  promptText: "A cinematic neon canyon flythrough.",
  durationSeconds: 5,
  firstSeenAt: "2026-06-18T00:00:02.000Z",
  lastSeenAt: "2026-06-18T00:00:02.000Z",
  verificationStatus: "verified",
  gapCodes: [],
  createdAt: "2026-06-18T00:00:02.000Z",
  updatedAt: "2026-06-18T00:00:02.000Z",
},
```

Update the first inventory counts from:

```js
counts: { assets: 3, images: 1, videos: 1, verified: 3, blocked: 0, failed: 0, unproven: 0 },
```

to:

```js
counts: { assets: 4, images: 1, videos: 2, verified: 4, blocked: 0, failed: 0, unproven: 0 },
```

- [ ] **Step 4: Add the draft persistence helper**

Create `web/src/lib/vault-movie-draft-storage.ts`:

```ts
import { createMovie, updateMovie } from "./local-storage";
import type { Movie } from "./types";
import type { VaultDraftMovie } from "./vault-movie-drafts";

export async function createMoviesFromVaultDrafts(drafts: VaultDraftMovie[]): Promise<Movie[]> {
  const created: Movie[] = [];
  for (const draft of drafts) {
    const movie = await createMovie(draft.name);
    const saved = await updateMovie({
      ...movie,
      resolution: { w: 1080, h: 1920 },
      clips: draft.clips.map((clip, position) => ({ ...clip, position })),
    });
    created.push(saved);
  }
  return created;
}
```

- [ ] **Step 5: Add the Vault draft modal**

Create `web/src/components/vault/VaultMovieDraftModal.tsx`:

```tsx
"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Button from "@/components/ui/Button";
import Modal from "@/components/ui/Modal";
import { buildVaultMovieDrafts, type VaultDraftBuildOptions, type VaultDraftRecipe, type VaultDraftScope } from "@/lib/vault-movie-drafts";
import { createMoviesFromVaultDrafts } from "@/lib/vault-movie-draft-storage";
import type { VaultAsset, VaultOverlay } from "@/lib/vault-types";

export default function VaultMovieDraftModal({
  open,
  onClose,
  assets,
  overlays,
  filteredAssetIds,
  selectedAssetIds,
}: {
  open: boolean;
  onClose: () => void;
  assets: VaultAsset[];
  overlays: VaultOverlay[];
  filteredAssetIds: string[];
  selectedAssetIds: string[];
}) {
  const router = useRouter();
  const defaultScope: VaultDraftScope = selectedAssetIds.length > 0 ? "selected" : "filtered";
  const defaultRecipe: VaultDraftRecipe = selectedAssetIds.length > 0 ? "selected" : "recent";
  const [scope, setScope] = useState<VaultDraftScope>(defaultScope);
  const [recipe, setRecipe] = useState<VaultDraftRecipe>(defaultRecipe);
  const [maxClipsPerMovie, setMaxClipsPerMovie] = useState(10);
  const [maxMovies, setMaxMovies] = useState(4);
  const [openFirstMovie, setOpenFirstMovie] = useState(true);
  const [creating, setCreating] = useState(false);
  const [summary, setSummary] = useState<{ createdCount: number; skippedCount: number; firstMovieId?: string } | null>(null);

  const preview = useMemo(
    () =>
      buildVaultMovieDrafts(
        { assets, overlays, filteredAssetIds, selectedAssetIds },
        { recipe, scope, maxClipsPerMovie, maxMovies },
      ),
    [assets, filteredAssetIds, maxClipsPerMovie, maxMovies, overlays, recipe, scope, selectedAssetIds],
  );

  async function handleCreate() {
    if (preview.movies.length === 0 || creating) return;
    setCreating(true);
    try {
      const movies = await createMoviesFromVaultDrafts(preview.movies);
      setSummary({
        createdCount: movies.length,
        skippedCount: preview.skipped.length,
        firstMovieId: movies[0]?.id,
      });
      if (openFirstMovie && movies[0]) {
        router.push(`/movie?id=${movies[0].id}`);
      }
    } finally {
      setCreating(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Build Movies from Vault" className="max-w-xl">
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-xs text-(--color-surface-500)">
            Source scope
            <select
              aria-label="Source scope"
              value={scope}
              onChange={(event) => setScope(event.target.value as VaultDraftScope)}
              className="w-full rounded-(--radius-input) border border-(--color-surface-200) bg-transparent px-3 py-2 text-sm dark:border-(--color-surface-700)"
            >
              <option value="selected">Selected assets</option>
              <option value="filtered">Current filtered set</option>
              <option value="visible-verified">All visible verified videos</option>
              <option value="favorites">Favorites</option>
            </select>
          </label>
          <label className="space-y-1 text-xs text-(--color-surface-500)">
            Recipe
            <select
              aria-label="Recipe"
              value={recipe}
              onChange={(event) => setRecipe(event.target.value as VaultDraftRecipe)}
              className="w-full rounded-(--radius-input) border border-(--color-surface-200) bg-transparent px-3 py-2 text-sm dark:border-(--color-surface-700)"
            >
              <option value="recent">Recent Video Drafts</option>
              <option value="selected">Selected Video Drafts</option>
              <option value="favorites">Favorite Drafts</option>
              <option value="prompt-groups">Prompt Group Drafts</option>
            </select>
          </label>
          <label className="space-y-1 text-xs text-(--color-surface-500)">
            Max clips per movie
            <input
              aria-label="Max clips per movie"
              type="number"
              min={1}
              max={100}
              value={maxClipsPerMovie}
              onChange={(event) => setMaxClipsPerMovie(Number(event.target.value))}
              className="w-full rounded-(--radius-input) border border-(--color-surface-200) bg-transparent px-3 py-2 text-sm dark:border-(--color-surface-700)"
            />
          </label>
          <label className="space-y-1 text-xs text-(--color-surface-500)">
            Max movies
            <input
              aria-label="Max movies"
              type="number"
              min={1}
              max={20}
              value={maxMovies}
              onChange={(event) => setMaxMovies(Number(event.target.value))}
              className="w-full rounded-(--radius-input) border border-(--color-surface-200) bg-transparent px-3 py-2 text-sm dark:border-(--color-surface-700)"
            />
          </label>
        </div>
        <label className="flex items-center gap-2 text-sm text-(--color-surface-600) dark:text-(--color-surface-300)">
          <input type="checkbox" checked={openFirstMovie} onChange={(event) => setOpenFirstMovie(event.target.checked)} />
          Open the first movie after creation
        </label>
        <div className="rounded-(--radius-card) border border-(--color-surface-200) p-3 text-sm dark:border-(--color-surface-700)">
          <p>{preview.consideredCount} source assets considered</p>
          <p>{preview.eligibleCount} eligible videos</p>
          <p>{preview.movies.length} movie draft{preview.movies.length === 1 ? "" : "s"} ready</p>
          <p>{preview.skipped.length} skipped asset{preview.skipped.length === 1 ? "" : "s"}</p>
        </div>
        {summary && (
          <div className="rounded-(--radius-card) bg-green-50 p-3 text-sm text-green-700 dark:bg-green-950 dark:text-green-300">
            Created {summary.createdCount} movie draft{summary.createdCount === 1 ? "" : "s"}. Skipped {summary.skippedCount} asset{summary.skippedCount === 1 ? "" : "s"}.
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Close</Button>
          <Button variant="primary" onClick={handleCreate} disabled={creating || preview.movies.length === 0}>
            {creating ? "Creating..." : "Create movie drafts"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
```

- [ ] **Step 6: Add Build Movies support to VaultGrid**

Modify `web/src/components/vault/VaultGrid.tsx`.

Add `Film` to the icon import:

```ts
import { Film, Grid2X2, List } from "lucide-react";
```

Add props:

```ts
  onBuildMovies,
}: {
  // existing props stay unchanged
  onBuildMovies: () => void;
}) {
```

In the selected action row, place this button before `Favorite selected`:

```tsx
<Button size="sm" variant="primary" onClick={onBuildMovies}>
  <Film className="h-3.5 w-3.5" />
  Build Movies
</Button>
```

When `selectedCount === 0`, add this button after the “Showing” text:

```tsx
<Button size="sm" variant="secondary" onClick={onBuildMovies}>
  <Film className="h-3.5 w-3.5" />
  Build Movies
</Button>
```

- [ ] **Step 7: Wire the modal in VaultPage**

Modify `web/src/components/vault/VaultPage.tsx`.

Import the modal:

```ts
import VaultMovieDraftModal from "./VaultMovieDraftModal";
```

Add state:

```ts
const [showMovieDraftModal, setShowMovieDraftModal] = useState(false);
```

Pass the new prop into `VaultGrid`:

```tsx
onBuildMovies={() => setShowMovieDraftModal(true)}
```

Render the modal after `VaultMediaViewer`:

```tsx
<VaultMovieDraftModal
  open={showMovieDraftModal}
  onClose={() => setShowMovieDraftModal(false)}
  assets={assets}
  overlays={overlays}
  filteredAssetIds={filteredAssets.map((asset) => asset.assetId)}
  selectedAssetIds={[...selectedAssetIds]}
/>
```

- [ ] **Step 8: Run the Vault draft E2E tests and verify they pass**

Run:

```bash
npx playwright test -c playwright.web.config.js tests/e2e-web/vault-movie-drafts.spec.js
```

Expected: PASS for all Vault draft creation tests.

- [ ] **Step 9: Run web unit tests, lint, and build**

Run:

```bash
npm --prefix web run test:unit -- vault-movie-drafts
npm --prefix web run lint
npm --prefix web run build
```

Expected: all commands pass.

- [ ] **Step 10: Commit Task 2**

Run:

```bash
git add tests/e2e-web/fixtures/fake-vault-worker.mjs tests/e2e-web/vault-movie-drafts.spec.js web/src/lib/vault-movie-draft-storage.ts web/src/components/vault/VaultMovieDraftModal.tsx web/src/components/vault/VaultGrid.tsx web/src/components/vault/VaultPage.tsx
git commit -m "feat(web): build movie drafts from vault"
```

## Task 3: Add Movie Maker Build From Vault Entry Point

**Files:**
- Modify: `web/src/components/movie/MovieList.tsx`
- Test: `tests/e2e-web/vault-movie-drafts.spec.js`

- [ ] **Step 1: Add a failing E2E test for the Movie Maker entry point**

Append this test to `tests/e2e-web/vault-movie-drafts.spec.js`:

```js
test("Movie Maker exposes Build from Vault after Vault assets are committed", async ({ page }) => {
  await resetDb(page);
  await page.goto("/vault");
  await page.getByRole("button", { name: /Preview Vault/i }).click();
  await page.getByRole("button", { name: /Commit Vault/i }).click();
  await page.goto("/movie");
  await page.getByRole("button", { name: /Build from Vault/i }).click();
  await page.getByLabel(/Recipe/i).selectOption("recent");
  await page.getByRole("button", { name: /Create movie drafts/i }).click();
  await expect(page).toHaveURL(/\/movie\?id=/);
});
```

- [ ] **Step 2: Run the test and verify it fails because the button is missing**

Run:

```bash
npx playwright test -c playwright.web.config.js tests/e2e-web/vault-movie-drafts.spec.js -g "Movie Maker exposes Build from Vault"
```

Expected: FAIL because `Build from Vault` is missing on `/movie`.

- [ ] **Step 3: Add the Movie Maker entry point**

Modify `web/src/components/movie/MovieList.tsx`.

Add imports:

```ts
import { getDB } from "@/lib/local-storage";
import { getVaultAssets, getVaultOverlays } from "@/lib/vault-storage";
import type { VaultAsset, VaultOverlay } from "@/lib/vault-types";
import VaultMovieDraftModal from "@/components/vault/VaultMovieDraftModal";
```

Add state:

```ts
const [showVaultBuilder, setShowVaultBuilder] = useState(false);
const [vaultAssets, setVaultAssets] = useState<VaultAsset[]>([]);
const [vaultOverlays, setVaultOverlays] = useState<VaultOverlay[]>([]);
```

Inside the existing `useEffect`, load movies and Vault state together:

```ts
useEffect(() => {
  async function load() {
    const [nextMovies, db] = await Promise.all([getAllMovies(), getDB()]);
    const [nextAssets, nextOverlays] = await Promise.all([getVaultAssets(db), getVaultOverlays(db)]);
    setMovies(nextMovies);
    setVaultAssets(nextAssets);
    setVaultOverlays(nextOverlays);
    setLoaded(true);
  }
  load().catch(() => {
    setMovies([]);
    setVaultAssets([]);
    setVaultOverlays([]);
    setLoaded(true);
  });
}, []);
```

Add a secondary button next to `New Movie`:

```tsx
<Button variant="secondary" onClick={() => setShowVaultBuilder(true)} disabled={vaultAssets.length === 0}>
  <Film className="h-4 w-4" />
  Build from Vault
</Button>
```

Render the modal near the end of the component:

```tsx
<VaultMovieDraftModal
  open={showVaultBuilder}
  onClose={() => setShowVaultBuilder(false)}
  assets={vaultAssets}
  overlays={vaultOverlays}
  filteredAssetIds={vaultAssets.map((asset) => asset.assetId)}
  selectedAssetIds={[]}
/>
```

- [ ] **Step 4: Run the Movie Maker entry point test**

Run:

```bash
npx playwright test -c playwright.web.config.js tests/e2e-web/vault-movie-drafts.spec.js -g "Movie Maker exposes Build from Vault"
```

Expected: PASS.

- [ ] **Step 5: Run the full Vault draft E2E file**

Run:

```bash
npx playwright test -c playwright.web.config.js tests/e2e-web/vault-movie-drafts.spec.js
```

Expected: PASS.

- [ ] **Step 6: Commit Task 3**

Run:

```bash
git add web/src/components/movie/MovieList.tsx tests/e2e-web/vault-movie-drafts.spec.js
git commit -m "feat(web): add movie maker vault draft entry"
```

## Task 4: Stabilize CanvasPlayer Playback

**Files:**
- Modify: `web/src/components/movie/CanvasPlayer.tsx`
- Create: `tests/e2e-web/movie-player-stability.spec.js`
- Modify: `tests/e2e-web/fixtures/fake-vault-worker.mjs`

- [ ] **Step 1: Add a failing playback stability E2E test**

Create `tests/e2e-web/movie-player-stability.spec.js`:

```js
const { test, expect } = require("@playwright/test");

async function seedMovie(page) {
  await page.goto("/movie");
  return page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("grok-power-tools");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    const now = new Date().toISOString();
    const movie = {
      id: "movie-playback-stability",
      name: "Playback Stability",
      resolution: { w: 320, h: 240 },
      clips: [
        {
          id: "clip-1",
          type: "video",
          videoUrl: "/api/vault/media/asset-video-1?objectKey=grok-powertools%2Fv1%2Fusers%2Fgreymaker%2Fmedia%2Fby-asset%2Fasset-video-1.mp4",
          sourceAssetId: "asset-video-1",
          transition: { type: "cut", duration: 0 },
          position: 0,
        },
        {
          id: "clip-2",
          type: "video",
          videoUrl: "/api/vault/media/asset-video-2?objectKey=grok-powertools%2Fv1%2Fusers%2Fgreymaker%2Fmedia%2Fby-asset%2Fasset-video-2.mp4",
          sourceAssetId: "asset-video-2",
          transition: { type: "cut", duration: 0 },
          position: 1,
        },
      ],
      createdAt: now,
      updatedAt: now,
    };
    await new Promise((resolve, reject) => {
      const tx = db.transaction("movies", "readwrite");
      const request = tx.objectStore("movies").put(movie);
      request.onerror = () => reject(request.error);
      tx.oncomplete = () => resolve();
    });
    db.close();
    return movie.id;
  });
}

test("Movie Maker playback does not seek the active video every frame", async ({ page }) => {
  const movieId = await seedMovie(page);
  await page.addInitScript(() => {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "currentTime");
    window.__movieSeekWrites = 0;
    Object.defineProperty(HTMLMediaElement.prototype, "currentTime", {
      get() {
        return descriptor.get.call(this);
      },
      set(value) {
        window.__movieSeekWrites += 1;
        descriptor.set.call(this, value);
      },
    });
  });
  await page.goto(`/movie?id=${movieId}`);
  await page.getByRole("button", { name: /^Play$/i }).click();
  await page.waitForTimeout(1600);
  const seekWrites = await page.evaluate(() => window.__movieSeekWrites);
  expect(seekWrites).toBeLessThan(12);
});

test("Movie Maker scrubbing still updates the canvas", async ({ page }) => {
  const movieId = await seedMovie(page);
  await page.goto(`/movie?id=${movieId}`);
  const range = page.locator('input[type="range"]');
  await range.evaluate((input) => {
    input.value = "1";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await expect
    .poll(async () =>
      page.locator("canvas").evaluate((canvas) => {
        const ctx = canvas.getContext("2d");
        if (!ctx) return 0;
        const [r, g, b] = ctx.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data;
        return r + g + b;
      }),
    )
    .toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run the playback test and verify seek-thrash failure**

Run:

```bash
npx playwright test -c playwright.web.config.js tests/e2e-web/movie-player-stability.spec.js
```

Expected: FAIL because `currentTime` is written too often or because the fake video response is not playable enough for the test.

- [ ] **Step 3: Add a playable video fixture response**

Modify `tests/e2e-web/fixtures/fake-vault-worker.mjs` to return a real tiny MP4 file for `/v1/vault/media`.

Use this approach instead of hand-writing MP4 bytes:

```js
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const playableVideo = fs.readFileSync(path.join(__dirname, "tiny-video.mp4"));
```

Create `tests/e2e-web/fixtures/tiny-video.mp4` using a checked-in small MP4 fixture. Keep it under 100 KB. If no fixture exists locally, generate it once with:

```bash
ffmpeg -f lavfi -i testsrc=size=320x240:rate=30:duration=2 -pix_fmt yuv420p tests/e2e-web/fixtures/tiny-video.mp4
```

Then replace the existing video response body:

```js
res.writeHead(200, { "content-type": "video/mp4", "cache-control": "no-store" });
return res.end(playableVideo);
```

- [ ] **Step 4: Refactor CanvasPlayer playback state**

Modify `web/src/components/movie/CanvasPlayer.tsx`.

Add refs near the existing refs:

```ts
const lastDrawnVideoFrames = useRef<Map<string, HTMLCanvasElement>>(new Map());
const activeVideoIdRef = useRef<string | null>(null);
const lastSeekAtRef = useRef<Map<string, number>>(new Map());
```

Add helpers above `render`:

```ts
function shouldSyncVideo(video: HTMLVideoElement, targetTime: number, isPlaying: boolean, clipChanged: boolean): boolean {
  if (!isPlaying) return Math.abs(video.currentTime - targetTime) > 0.05;
  if (clipChanged) return true;
  return Math.abs(video.currentTime - targetTime) > 0.75;
}

function drawLetterboxed(ctx: CanvasRenderingContext2D, source: CanvasImageSource, sw: number, sh: number, w: number, h: number): void {
  if (sw <= 0 || sh <= 0) return;
  const scale = Math.min(w / sw, h / sh);
  const dw = sw * scale;
  const dh = sh * scale;
  ctx.drawImage(source, (w - dw) / 2, (h - dh) / 2, dw, dh);
}
```

Replace the video branch inside `render` with this behavior:

```ts
if (clip.type === "video") {
  const video = videoRefs.current.get(clip.id);
  if (video) {
    const clipLocalTime = (t - entry.startTime) + entry.clipStart;
    const clipChanged = activeVideoIdRef.current !== clip.id;
    if (clipChanged) {
      activeVideoIdRef.current = clip.id;
    }

    const lastSeekAt = lastSeekAtRef.current.get(clip.id) || 0;
    const canSeekNow = performance.now() - lastSeekAt > 250;
    if (canSeekNow && shouldSyncVideo(video, clipLocalTime, isPlaying, clipChanged)) {
      lastSeekAtRef.current.set(clip.id, performance.now());
      video.currentTime = clipLocalTime;
    }

    if (isPlaying && video.paused && video.readyState >= 2) {
      video.play().catch(() => {});
    }

    if (video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) {
      drawLetterboxed(ctx, video, video.videoWidth, video.videoHeight, w, h);
      const cache = lastDrawnVideoFrames.current.get(clip.id) || document.createElement("canvas");
      cache.width = w;
      cache.height = h;
      cache.getContext("2d")?.drawImage(canvas, 0, 0);
      lastDrawnVideoFrames.current.set(clip.id, cache);
    } else {
      const cached = lastDrawnVideoFrames.current.get(clip.id);
      if (cached) drawLetterboxed(ctx, cached, cached.width, cached.height, w, h);
    }
  }
}
```

Update the playback effect so only the active video plays and inactive videos pause:

```ts
for (const [id, video] of videoRefs.current) {
  if (id === activeVideoIdRef.current) {
    video.play().catch(() => {});
  } else {
    video.pause();
  }
}
```

- [ ] **Step 5: Add accessible labels to playback buttons**

Modify the play button in `CanvasPlayer.tsx`:

```tsx
<button
  type="button"
  aria-label={isPlaying ? "Pause" : "Play"}
  onClick={() => onPlayingChange(!isPlaying)}
  className="rounded p-2 text-neutral-300 hover:bg-neutral-800"
>
```

Modify the fullscreen button:

```tsx
<button
  type="button"
  aria-label={fullscreen ? "Exit fullscreen" : "Enter fullscreen"}
  onClick={() => onFullscreenChange(!fullscreen)}
  className="rounded p-2 text-neutral-300 hover:bg-neutral-800"
>
```

- [ ] **Step 6: Run playback tests**

Run:

```bash
npx playwright test -c playwright.web.config.js tests/e2e-web/movie-player-stability.spec.js
```

Expected: PASS.

- [ ] **Step 7: Run existing Movie Maker Vault tests**

Run:

```bash
npx playwright test -c playwright.web.config.js tests/e2e-web/vault-ui.spec.js -g "Movie Maker"
```

Expected: PASS.

- [ ] **Step 8: Run web lint and build**

Run:

```bash
npm --prefix web run lint
npm --prefix web run build
```

Expected: PASS.

- [ ] **Step 9: Commit Task 4**

Run:

```bash
git add web/src/components/movie/CanvasPlayer.tsx tests/e2e-web/movie-player-stability.spec.js tests/e2e-web/fixtures/fake-vault-worker.mjs tests/e2e-web/fixtures/tiny-video.mp4
git commit -m "fix(web): stabilize movie preview playback"
```

## Task 5: Final Integrated Validation

**Files:**
- Modify only if a prior task exposed a real issue in the files it changed.

- [ ] **Step 1: Run focused unit tests**

Run:

```bash
npm --prefix web run test:unit -- vault-movie-drafts
```

Expected: PASS.

- [ ] **Step 2: Run focused web E2E tests**

Run:

```bash
npx playwright test -c playwright.web.config.js tests/e2e-web/vault-movie-drafts.spec.js tests/e2e-web/movie-player-stability.spec.js
```

Expected: PASS.

- [ ] **Step 3: Run full web E2E suite**

Run:

```bash
npx playwright test -c playwright.web.config.js
```

Expected: PASS.

- [ ] **Step 4: Run web lint and build**

Run:

```bash
npm --prefix web run lint
npm --prefix web run build
```

Expected: PASS.

- [ ] **Step 5: Confirm no forbidden surfaces changed**

Run:

```bash
git diff --name-only origin/main...HEAD
```

Expected: changed files are limited to web app code, web tests, the fake web fixture, package files, and docs. No root extension files, cloud Worker files, `.env` files, R2 state, processed-ID state, or secrets.

- [ ] **Step 6: Manual local validation**

Run the web app:

```bash
npm --prefix web run dev
```

Open `http://localhost:3001/vault` and validate:

- Vault assets already committed locally are visible.
- `Build Movies` opens the modal.
- Selected videos create a selected draft.
- No selection creates recent drafts from the filtered visible set.
- Favorite videos create a favorite draft.
- A generated movie opens in Movie Maker.
- Movie playback does not visibly strobe.
- Scrubbing still changes the preview frame.
- Export WebM creates a downloadable file.

- [ ] **Step 7: Commit any validation-only corrections**

If validation required small corrections, commit them:

```bash
git add <changed-files-from-validation>
git commit -m "fix(web): polish vault movie draft flow"
```

If no corrections were needed, do not create an empty commit.

## Self-Review Results

- Spec coverage: covered draft builder, local-only persistence, Vault UI, Movie Maker entry, playback stabilization, skips, deterministic prompt groups, tests, manual validation, and forbidden cloud or extension surfaces.
- Placeholder scan: no red-flag placeholder wording remains.
- Type consistency: plan uses `VaultDraftRecipe`, `VaultDraftScope`, `VaultDraftBuildInput`, `VaultDraftBuildOptions`, `VaultDraftMovie`, and `VaultDraftBuildResult` consistently across builder, modal, and storage helper.
