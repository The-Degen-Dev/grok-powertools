# R2 Backed Vault Web App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local web Vault that loads the real backed-up Grok saved gallery from R2, keeps source facts immutable, and lets the user browse, collect, watch, use prompts, make movies, and inspect proof states locally.

**Architecture:** Add read-only Vault APIs to the Worker, broker them through Next.js server routes, normalize data into versioned IndexedDB stores, and project Vault assets into the existing web product surfaces. Keep R2 source records immutable and store user work as local or synced overlays.

**Tech Stack:** Cloudflare Worker, R2, D1, Next.js 16, React 19, TypeScript, IndexedDB through `idb`, Auth.js, Playwright, Node test runner for Worker tests.

---

## Scope Check

This is one connected build because the web app is not useful until Worker inventory, Next server routes, IndexedDB commit, media display, and Ops proof all work together. The tasks below still cut the work into independently testable commits:

- Worker read contract and tests.
- Web server broker and fake Worker test harness.
- Local Vault storage and UI.
- Existing app surfaces, collections, movies, prompts, watch, Ops, and sync.
- Final real-data validation.

Do not run live Grok repair, production backfill, retry unsynced, full media backup, processed-ID reset, or R2 mutation during these tasks.

## File Structure

Create these files:

- `implementation-notes.html`: running execution notes requested by the user.
- `playwright.web.config.js`: web app Playwright config with a fake Worker service and Next dev server.
- `tests/e2e-web/fixtures/fake-vault-worker.mjs`: local fake Worker for repeatable web tests.
- `tests/e2e-web/vault-api.spec.js`: server-route proof for identity, preview, media proxy, and blocking behavior.
- `tests/e2e-web/vault-ui.spec.js`: browser proof for Vault preview, commit, media grid, collections, watch, movies, prompts, and Ops.
- `cloud/src/vault.ts`: Worker-side Vault normalization and redaction helpers.
- `cloud/tests/vault.test.ts`: pure Worker helper tests.
- `cloud/tests/vault-routes.test.ts`: Worker route tests.
- `web/src/lib/vault-types.ts`: schema-first web Vault types and parsers.
- `web/src/lib/vault-storage.ts`: IndexedDB Vault read/write helpers.
- `web/src/lib/vault-client.ts`: browser client for Next Vault routes.
- `web/src/lib/vault-view-models.ts`: projection helpers from Vault assets to collection/movie/viewer items.
- `web/src/app/api/vault/identity/route.ts`
- `web/src/app/api/vault/inventory/route.ts`
- `web/src/app/api/vault/metadata/[kind]/route.ts`
- `web/src/app/api/vault/media/[assetId]/route.ts`
- `web/src/app/api/vault/preview/route.ts`
- `web/src/app/api/vault/gaps/route.ts`
- `web/src/app/api/vault/gap-fill/plan/route.ts`
- `web/src/app/api/vault/gap-fill/run/route.ts`
- `web/src/app/api/vault/reconcile/index/route.ts`
- `web/src/app/vault/page.tsx`
- `web/src/components/vault/VaultPage.tsx`
- `web/src/components/vault/VaultLoadPanel.tsx`
- `web/src/components/vault/VaultGrid.tsx`
- `web/src/components/vault/VaultMediaCard.tsx`
- `web/src/components/vault/VaultMediaViewer.tsx`
- `web/src/components/vault/VaultBulkBar.tsx`
- `web/src/components/vault/VaultGapPanel.tsx`
- `web/src/components/vault/VaultOpsSummary.tsx`

Modify these files:

- `cloud/src/index.ts`: route Vault endpoints.
- `cloud/src/types.ts`: add Vault request/response types.
- `cloud/src/db.ts`: add D1 query helpers for `r2_dedupe_index`, `metadata_snapshot_index`, and `vault_overlays`.
- `cloud/schema.sql`: add `vault_overlays`.
- `web/src/lib/types.ts`: add `mediaType`, `assetId`, and image movie clip support.
- `web/src/lib/local-storage.ts`: bump IndexedDB version and preserve existing stores.
- `web/src/lib/sync-engine.ts`: sync overlay rows after local owner flow is proven.
- `web/src/components/layout/Header.tsx`: add Vault nav and breadcrumb.
- `web/src/components/dashboard/Dashboard.tsx`: make real Vault load the primary empty state when Worker config exists.
- `web/src/components/collections/CollectionView.tsx`: support Vault-backed media, Watch All, Watch Selected, and collection creation from Vault assets.
- `web/src/components/video/VideoCard.tsx`: support image assets without treating them as broken videos.
- `web/src/components/video/FullscreenViewer.tsx`: become media-aware and queue-aware.
- `web/src/components/movie/CanvasPlayer.tsx`: render image clips.
- `web/src/components/movie/StoryboardPanel.tsx`: show image clips.
- `web/src/components/movie/ClipSourcePicker.tsx`: add Vault source tab and image clip support.
- `web/src/components/prompts/PromptLibrary.tsx`: merge Vault prompts and local prompts by normalized hash.
- `web/src/components/ops/OpsConsole.tsx`: show Vault proof states and gap plan entry point.

## Task 1: Notes, Web Test Harness, And Vault Identity Route

**Files:**
- Create: `implementation-notes.html`
- Create: `playwright.web.config.js`
- Create: `tests/e2e-web/fixtures/fake-vault-worker.mjs`
- Create: `tests/e2e-web/vault-api.spec.js`
- Create: `web/src/app/api/vault/identity/route.ts`
- Create: `web/src/lib/vault-server.ts`

- [x] **Step 1: Create execution notes**

Create `implementation-notes.html` with this content:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>R2 Backed Vault Web App Notes</title>
    <style>
      body { margin: 0; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #111827; background: #f8fafc; }
      main { max-width: 980px; margin: 0 auto; padding: 32px 20px 56px; }
      h1 { margin: 0 0 8px; font-size: 28px; }
      h2 { margin-top: 28px; font-size: 18px; }
      table { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid #e5e7eb; }
      th, td { padding: 10px 12px; border-bottom: 1px solid #e5e7eb; text-align: left; vertical-align: top; font-size: 14px; }
      th { background: #f3f4f6; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; }
      code { background: #eef2ff; padding: 2px 4px; border-radius: 4px; }
    </style>
  </head>
  <body>
    <main>
      <h1>R2 Backed Vault Web App Notes</h1>
      <p>
        Running notes for <code>docs/superpowers/specs/2026-06-18-r2-backed-vault-webapp-design.md</code>.
      </p>
      <h2>Notes</h2>
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
            <td>2026-06-18</td>
            <td>Design decision</td>
            <td>Use a fake Worker for browser tests so local UI work proves the server-route contract without touching production R2 or D1.</td>
          </tr>
        </tbody>
      </table>
      <h2>Open Questions</h2>
      <p>None at execution start.</p>
    </main>
  </body>
</html>
```

- [x] **Step 2: Add fake Worker fixture**

Create `tests/e2e-web/fixtures/fake-vault-worker.mjs`:

```js
import http from "node:http";

const port = Number(process.env.FAKE_VAULT_WORKER_PORT || 43117);
const apiKey = process.env.FAKE_VAULT_WORKER_API_KEY || "client-sample";
const headerName = "x-gpt-api-key";

const fixtureAssets = [
  {
    assetId: "asset-video-1",
    mediaType: "video",
    canonicalObjectKey: "grok-powertools/v1/users/greymaker/media/by-asset/asset-video-1.mp4",
    legacyObjectKeys: [],
    contentType: "video/mp4",
    sizeBytes: 1024,
    etag: "etag-video-1",
    sha256: "sha-video-1",
    sourceUrl: "https://grok.com/imagine/post/post-video-1",
    grokPostId: "post-video-1",
    promptId: "prompt-1",
    promptText: "A cinematic neon canyon flythrough.",
    durationSeconds: 5,
    firstSeenAt: "2026-06-18T00:00:00.000Z",
    lastSeenAt: "2026-06-18T00:00:00.000Z",
    verificationStatus: "verified",
    gapCodes: [],
    createdAt: "2026-06-18T00:00:00.000Z",
    updatedAt: "2026-06-18T00:00:00.000Z"
  },
  {
    assetId: "asset-image-1",
    mediaType: "image",
    canonicalObjectKey: "grok-powertools/v1/users/greymaker/media/by-asset/asset-image-1.png",
    legacyObjectKeys: ["grok-powertools/v1/users/greymaker/media/2025-12-20_Auto/asset-image-1.png"],
    contentType: "image/png",
    sizeBytes: 512,
    etag: "etag-image-1",
    sha256: "sha-image-1",
    sourceUrl: "https://grok.com/imagine/post/post-image-1",
    grokPostId: "post-image-1",
    promptId: "prompt-2",
    promptText: "A quiet glass library at sunrise.",
    width: 960,
    height: 960,
    firstSeenAt: "2026-06-18T00:00:00.000Z",
    lastSeenAt: "2026-06-18T00:00:00.000Z",
    verificationStatus: "verified",
    gapCodes: [],
    createdAt: "2026-06-18T00:00:00.000Z",
    updatedAt: "2026-06-18T00:00:00.000Z"
  }
];

const fixturePrompts = [
  { id: "prompt-1", text: "A cinematic neon canyon flythrough.", tags: ["vault"], sourceAssetIds: ["asset-video-1"], usageCount: 1, createdAt: "2026-06-18T00:00:00.000Z" },
  { id: "prompt-2", text: "A quiet glass library at sunrise.", tags: ["vault"], sourceAssetIds: ["asset-image-1"], usageCount: 1, createdAt: "2026-06-18T00:00:00.000Z" }
];

function sendJson(res, status, body) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*"
  });
  res.end(JSON.stringify(body));
}

function authorized(req) {
  return req.headers[headerName] === apiKey;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);
  if (req.method === "OPTIONS") return sendJson(res, 200, { ok: true });
  if (!authorized(req)) return sendJson(res, 401, { ok: false, error: "Unauthorized" });

  if (url.pathname === "/v1/vault/identity") {
    return sendJson(res, 200, {
      ok: true,
      service: "fake-grok-r2-backup",
      workerHost: "127.0.0.1",
      keyPrefix: "grok-powertools/v1",
      r2: { bucketName: "fake-vault-bucket", bindingPresent: true },
      d1: { databaseName: "fake-vault-db", bindingPresent: true },
      apiKeyFingerprint: "fp_client_sample"
    });
  }

  if (url.pathname === "/v1/vault/inventory") {
    return sendJson(res, 200, {
      ok: true,
      items: fixtureAssets,
      nextCursor: null,
      counts: { assets: 2, images: 1, videos: 1, verified: 2, blocked: 0, failed: 0, unproven: 0 }
    });
  }

  if (url.pathname === "/v1/vault/metadata/savedPrompts" || url.pathname === "/v1/vault/metadata/promptHistory") {
    return sendJson(res, 200, { ok: true, kind: url.pathname.split("/").pop(), prompts: fixturePrompts });
  }

  if (url.pathname === "/v1/vault/gaps") {
    return sendJson(res, 200, { ok: true, gaps: [] });
  }

  if (url.pathname === "/v1/vault/media") {
    const assetId = url.searchParams.get("assetId");
    if (assetId === "asset-image-1") {
      const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lp7dNwAAAABJRU5ErkJggg==", "base64");
      res.writeHead(200, { "content-type": "image/png", "cache-control": "no-store" });
      return res.end(png);
    }
    res.writeHead(200, { "content-type": "video/mp4", "cache-control": "no-store" });
    return res.end(Buffer.from([0, 0, 0, 24, 102, 116, 121, 112, 109, 112, 52, 50]));
  }

  return sendJson(res, 404, { ok: false, error: `Unhandled ${url.pathname}` });
});

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`fake-vault-worker listening on ${port}\n`);
});
```

- [x] **Step 3: Add Playwright web config**

Create `playwright.web.config.js`:

```js
// playwright.web.config.js
// @ts-check
const { defineConfig, devices } = require("@playwright/test");

const workerPort = 43117;
const webPort = 3001;

module.exports = defineConfig({
  testDir: "./tests/e2e-web",
  fullyParallel: false,
  timeout: 120000,
  reporter: "list",
  use: {
    baseURL: `http://127.0.0.1:${webPort}`,
    trace: "on-first-retry"
  },
  webServer: [
    {
      command: `FAKE_VAULT_WORKER_PORT=${workerPort} FAKE_VAULT_WORKER_API_KEY=client-sample node tests/e2e-web/fixtures/fake-vault-worker.mjs`,
      url: `http://127.0.0.1:${workerPort}/v1/vault/identity`,
      reuseExistingServer: true,
      timeout: 30000
    },
    {
      command: `WORKER_URL=http://127.0.0.1:${workerPort} CLIENT_API_KEY=client-sample AUTH_SECRET=local-test-secret npm --prefix web run dev`,
      url: `http://127.0.0.1:${webPort}`,
      reuseExistingServer: true,
      timeout: 120000
    }
  ],
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    }
  ]
});
```

- [x] **Step 4: Write failing identity API test**

Create `tests/e2e-web/vault-api.spec.js`:

```js
const { test, expect } = require("@playwright/test");

test("Vault identity API returns redacted Worker identity", async ({ request }) => {
  const res = await request.get("/api/vault/identity");
  expect(res.ok()).toBe(true);
  const body = await res.json();
  expect(body.ok).toBe(true);
  expect(body.service).toBe("fake-grok-r2-backup");
  expect(body.keyPrefix).toBe("grok-powertools/v1");
  expect(JSON.stringify(body)).not.toContain("client-sample");
});
```

- [x] **Step 5: Run the failing test**

Run:

```bash
npx playwright test -c playwright.web.config.js tests/e2e-web/vault-api.spec.js
```

Expected: FAIL with `404` or `expect(received).toBe(true)` because `/api/vault/identity` does not exist yet.

- [x] **Step 6: Add server Worker helper**

Create `web/src/lib/vault-server.ts`:

```ts
export interface WorkerConfig {
  workerUrl: string;
  apiKey: string;
}

export function getWorkerConfig(): WorkerConfig {
  const workerUrl = (process.env.WORKER_URL || "").replace(/\/+$/, "");
  const apiKey = process.env.WORKER_API_KEY || process.env.CLIENT_API_KEY || "";

  if (!workerUrl) {
    throw new Error("WORKER_URL_MISSING");
  }

  if (!apiKey) {
    throw new Error("WORKER_API_KEY_MISSING");
  }

  return { workerUrl, apiKey };
}

export async function workerJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { workerUrl, apiKey } = getWorkerConfig();
  const res = await fetch(`${workerUrl}${path}`, {
    ...init,
    cache: "no-store",
    headers: {
      ...(init.headers || {}),
      "x-gpt-api-key": apiKey
    }
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = typeof data?.error === "string" ? data.error : `Worker request failed: ${res.status}`;
    throw new Error(message);
  }

  return data as T;
}
```

- [x] **Step 7: Add identity route**

Create `web/src/app/api/vault/identity/route.ts`:

```ts
import { NextResponse } from "next/server";
import { workerJson } from "@/lib/vault-server";

export async function GET() {
  try {
    const data = await workerJson<Record<string, unknown>>("/v1/vault/identity");
    return NextResponse.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : "VAULT_IDENTITY_FAILED";
    return NextResponse.json(
      {
        ok: false,
        status: "blocked",
        message,
      },
      { status: message.endsWith("_MISSING") ? 200 : 502 }
    );
  }
}
```

- [x] **Step 8: Run identity test and build**

Run:

```bash
npx playwright test -c playwright.web.config.js tests/e2e-web/vault-api.spec.js
cd web && npm run build
```

Expected: Playwright PASS. Build PASS and keep the known Next root behavior intact.

- [x] **Step 9: Commit**

Run:

```bash
git add implementation-notes.html playwright.web.config.js tests/e2e-web/fixtures/fake-vault-worker.mjs tests/e2e-web/vault-api.spec.js web/src/lib/vault-server.ts web/src/app/api/vault/identity/route.ts
git commit -m "feat(web): add vault identity test harness"
```

## Task 2: Worker Vault Types And Normalization Helpers

**Files:**
- Create: `cloud/src/vault.ts`
- Create: `cloud/tests/vault.test.ts`
- Modify: `cloud/src/types.ts`
- Modify: `implementation-notes.html`

- [x] **Step 1: Add failing Worker helper tests**

Create `cloud/tests/vault.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  buildVaultIdentity,
  mediaTypeFromContentType,
  normalizeVaultObject,
  redactedApiKeyFingerprint,
} from "../src/vault";

test("redactedApiKeyFingerprint returns a stable non-secret fingerprint", async () => {
  const fingerprint = await redactedApiKeyFingerprint("client-sample");
  assert.match(fingerprint, /^fp_[a-f0-9]{12}$/);
  assert.equal(fingerprint.includes("client-sample"), false);
});

test("mediaTypeFromContentType classifies images and videos", () => {
  assert.equal(mediaTypeFromContentType("image/png"), "image");
  assert.equal(mediaTypeFromContentType("video/mp4"), "video");
  assert.equal(mediaTypeFromContentType("application/octet-stream"), "unknown");
});

test("normalizeVaultObject creates stable asset records from R2 object metadata", () => {
  const asset = normalizeVaultObject(
    {
      key: "grok-powertools/v1/users/greymaker/media/by-asset/asset-video-1.mp4",
      size: 2048,
      etag: "etag-1",
      uploaded: new Date("2026-06-18T00:00:00.000Z"),
      httpMetadata: { contentType: "video/mp4" },
      customMetadata: {
        assetId: "asset-video-1",
        contentSha256: "sha-1",
        sourceUrlHash: "source-hash-1",
      },
    },
    "grok-powertools/v1"
  );

  assert.equal(asset.assetId, "asset-video-1");
  assert.equal(asset.mediaType, "video");
  assert.equal(asset.canonicalObjectKey, "grok-powertools/v1/users/greymaker/media/by-asset/asset-video-1.mp4");
  assert.deepEqual(asset.gapCodes, []);
  assert.equal(asset.verificationStatus, "verified");
});

test("buildVaultIdentity redacts secrets", async () => {
  const identity = await buildVaultIdentity({
    CLIENT_API_KEY: "client-sample",
    R2_BUCKET_NAME: "grok-gallery-001",
    KEY_PREFIX: "grok-powertools/v1",
    R2_BUCKET: {},
    DB: {},
  } as never);

  assert.equal(identity.ok, true);
  assert.equal(identity.keyPrefix, "grok-powertools/v1");
  assert.equal(identity.r2.bucketName, "grok-gallery-001");
  assert.equal(JSON.stringify(identity).includes("client-sample"), false);
});
```

- [x] **Step 2: Run the failing Worker tests**

Run:

```bash
cd cloud && npm run test:acceptance -- vault.test
```

Expected: FAIL because `cloud/src/vault.ts` does not exist.

- [x] **Step 3: Add Worker Vault types**

Append to `cloud/src/types.ts`:

```ts
export type VaultMediaType = "image" | "video" | "unknown";
export type VaultStatus = "verified" | "blocked" | "failed" | "unproven";

export interface VaultAsset {
    assetId: string;
    mediaType: VaultMediaType;
    canonicalObjectKey?: string;
    legacyObjectKeys: string[];
    contentType?: string;
    sizeBytes?: number;
    etag?: string;
    sha256?: string;
    sourceUrlHash?: string;
    sourceUrl?: string;
    grokPostId?: string;
    mediaUuid?: string;
    promptId?: string;
    promptText?: string;
    width?: number;
    height?: number;
    durationSeconds?: number;
    firstSeenAt?: string;
    lastSeenAt?: string;
    verificationStatus: VaultStatus;
    gapCodes: string[];
    createdAt: string;
    updatedAt: string;
}

export interface VaultGap {
    id: string;
    assetId?: string;
    code: string;
    severity: "info" | "warning" | "blocking";
    evidence: string;
    recommendedAction: string;
    requiresLiveGrok: boolean;
    requiresCloudWrite: boolean;
}
```

- [x] **Step 4: Add Worker Vault helper module**

Create `cloud/src/vault.ts`:

```ts
import type { Env, VaultAsset, VaultMediaType } from "./types";

interface R2ListObjectLike {
    key: string;
    size?: number;
    etag?: string;
    uploaded?: Date;
    httpMetadata?: { contentType?: string };
    customMetadata?: Record<string, string>;
}

function sanitizeKeyPrefix(keyPrefix: string | undefined): string {
    const normalized = String(keyPrefix || "grok-powertools/v1").trim().replace(/^\/+/, "").replace(/\/+$/, "");
    return normalized || "grok-powertools/v1";
}

function metadataValue(metadata: Record<string, string> | undefined, keys: string[]): string | undefined {
    for (const key of keys) {
        if (metadata?.[key]) return metadata[key];
        const lower = key.toLowerCase();
        if (metadata?.[lower]) return metadata[lower];
    }
    return undefined;
}

export function mediaTypeFromContentType(contentType: string | undefined): VaultMediaType {
    const normalized = String(contentType || "").toLowerCase();
    if (normalized.startsWith("image/")) return "image";
    if (normalized.startsWith("video/")) return "video";
    return "unknown";
}

export function assetIdFromObjectKey(objectKey: string): string {
    const byAsset = objectKey.match(/\/media\/by-asset\/([^/.?#]+)/);
    if (byAsset?.[1]) return byAsset[1];
    const filename = objectKey.split("/").pop() || objectKey;
    return filename.replace(/\.[a-z0-9]+$/i, "");
}

export async function redactedApiKeyFingerprint(apiKey: string | undefined): Promise<string | null> {
    if (!apiKey) return null;
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(apiKey));
    const hex = Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
    return `fp_${hex.slice(0, 12)}`;
}

export async function buildVaultIdentity(env: Env) {
    const keyPrefix = sanitizeKeyPrefix(env.KEY_PREFIX);
    return {
        ok: true,
        service: "grok-r2-backup",
        keyPrefix,
        r2: {
            bucketName: env.R2_BUCKET_NAME || null,
            bindingPresent: !!env.R2_BUCKET,
        },
        d1: {
            bindingPresent: !!env.DB,
        },
        apiKeyFingerprint: await redactedApiKeyFingerprint(env.CLIENT_API_KEY),
    };
}

export function normalizeVaultObject(object: R2ListObjectLike, keyPrefix: string): VaultAsset {
    const metadata = object.customMetadata || {};
    const contentType = object.httpMetadata?.contentType;
    const assetId = metadataValue(metadata, ["asset-id", "assetId"]) || assetIdFromObjectKey(object.key);
    const uploadedAt = object.uploaded?.toISOString() || new Date(0).toISOString();
    const isCanonical = object.key.includes("/media/by-asset/");

    return {
        assetId,
        mediaType: mediaTypeFromContentType(contentType),
        canonicalObjectKey: isCanonical ? object.key : undefined,
        legacyObjectKeys: isCanonical ? [] : [object.key],
        contentType,
        sizeBytes: object.size,
        etag: object.etag,
        sha256: metadataValue(metadata, ["sha256", "content-sha256", "contentSha256"]),
        sourceUrlHash: metadataValue(metadata, ["source-url-hash", "sourceUrlHash"]),
        firstSeenAt: uploadedAt,
        lastSeenAt: uploadedAt,
        verificationStatus: "verified",
        gapCodes: [],
        createdAt: uploadedAt,
        updatedAt: uploadedAt,
    };
}
```

- [x] **Step 5: Run Worker tests**

Run:

```bash
cd cloud && npm run test:acceptance
cd cloud && npm run typecheck
```

Expected: PASS.

- [x] **Step 6: Update notes**

Append this row to `implementation-notes.html`:

```html
          <tr>
            <td>2026-06-18</td>
            <td>Design decision</td>
            <td>Worker Vault helpers normalize canonical and legacy R2 keys without moving or rewriting existing objects.</td>
          </tr>
```

- [x] **Step 7: Commit**

Run:

```bash
git add cloud/src/types.ts cloud/src/vault.ts cloud/tests/vault.test.ts implementation-notes.html
git commit -m "feat(cloud): add vault normalization helpers"
```

## Task 3: Worker Vault Read Routes

**Files:**
- Create: `cloud/tests/vault-routes.test.ts`
- Modify: `cloud/src/index.ts`
- Modify: `cloud/src/vault.ts`
- Modify: `cloud/src/types.ts`
- Modify: `implementation-notes.html`

- [x] **Step 1: Write failing route tests**

Create `cloud/tests/vault-routes.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import worker from "../src/index";

const headerName = "x-gpt-api-key";
const sampleKey = "client-sample";

function env(overrides: Record<string, unknown> = {}) {
    return {
        CLIENT_API_KEY: sampleKey,
        R2_BUCKET_NAME: "grok-gallery-001",
        KEY_PREFIX: "grok-powertools/v1",
        R2_BUCKET: {
            list: async () => ({
                objects: [
                    {
                        key: "grok-powertools/v1/users/greymaker/media/by-asset/asset-video-1.mp4",
                        size: 2048,
                        etag: "etag-1",
                        uploaded: new Date("2026-06-18T00:00:00.000Z"),
                        httpMetadata: { contentType: "video/mp4" },
                        customMetadata: { assetId: "asset-video-1", contentSha256: "sha-1" },
                    },
                ],
                truncated: false,
                cursor: undefined,
            }),
            get: async (key: string) => {
                if (key.endsWith("saved-prompts.latest.json")) {
                    return {
                        text: async () => JSON.stringify({ schemaVersion: 1, data: [{ id: "prompt-1", text: "Test prompt" }] }),
                        httpMetadata: { contentType: "application/json" },
                    };
                }
                if (key.endsWith("asset-video-1.mp4")) {
                    return {
                        body: new ReadableStream({
                            start(controller) {
                                controller.enqueue(new Uint8Array([1, 2, 3]));
                                controller.close();
                            },
                        }),
                        httpMetadata: { contentType: "video/mp4" },
                    };
                }
                return null;
            },
        },
        DB: {
            prepare: () => ({
                bind: () => ({
                    all: async () => ({ results: [] }),
                    first: async () => null,
                }),
            }),
        },
        ...overrides,
    } as never;
}

test("Vault identity is auth protected", async () => {
    const response = await worker.fetch(new Request("https://worker.example/v1/vault/identity"), env());
    assert.equal(response.status, 401);
});

test("Vault identity returns redacted target proof", async () => {
    const response = await worker.fetch(new Request("https://worker.example/v1/vault/identity", {
        headers: { [headerName]: sampleKey },
    }), env());
    const body = await response.json() as Record<string, unknown>;
    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.keyPrefix, "grok-powertools/v1");
    assert.equal(JSON.stringify(body).includes(sampleKey), false);
});

test("Vault inventory lists normalized assets without D1 writes", async () => {
    const response = await worker.fetch(new Request("https://worker.example/v1/vault/inventory", {
        headers: { [headerName]: sampleKey },
    }), env());
    const body = await response.json() as { items: Array<{ assetId: string; mediaType: string }> };
    assert.equal(response.status, 200);
    assert.equal(body.items[0].assetId, "asset-video-1");
    assert.equal(body.items[0].mediaType, "video");
});

test("Vault metadata returns saved prompt snapshots", async () => {
    const response = await worker.fetch(new Request("https://worker.example/v1/vault/metadata/savedPrompts", {
        headers: { [headerName]: sampleKey },
    }), env());
    const body = await response.json() as { ok: boolean; kind: string; data: unknown[] };
    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.kind, "savedPrompts");
});

test("Vault media streams object bytes for server-side proxy", async () => {
    const response = await worker.fetch(new Request("https://worker.example/v1/vault/media?assetId=asset-video-1", {
        headers: { [headerName]: sampleKey },
    }), env());
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "video/mp4");
});
```

- [x] **Step 2: Run failing Worker route tests**

Run:

```bash
cd cloud && npm run test:acceptance
```

Expected: FAIL because `/v1/vault/*` routes are not wired.

- [x] **Step 3: Add Worker inventory and media helpers**

Add these exports to `cloud/src/vault.ts`:

```ts
export async function listVaultInventory(env: Env, cursor?: string | null, limit = 100) {
    const keyPrefix = sanitizeKeyPrefix(env.KEY_PREFIX);
    const listed = await env.R2_BUCKET.list({
        prefix: `${keyPrefix}/users/`,
        cursor: cursor || undefined,
        limit: Math.max(1, Math.min(limit, 1000)),
    });
    const items = listed.objects
        .filter((object) => object.key.includes("/media/"))
        .map((object) => normalizeVaultObject(object, keyPrefix));
    return {
        ok: true,
        items,
        nextCursor: listed.truncated ? listed.cursor || null : null,
        counts: {
            assets: items.length,
            images: items.filter((item) => item.mediaType === "image").length,
            videos: items.filter((item) => item.mediaType === "video").length,
            verified: items.filter((item) => item.verificationStatus === "verified").length,
            blocked: 0,
            failed: 0,
            unproven: 0,
        },
    };
}

export async function readVaultMetadata(env: Env, kind: string) {
    const keyPrefix = sanitizeKeyPrefix(env.KEY_PREFIX);
    const filenameByKind: Record<string, string> = {
        savedPrompts: "saved-prompts.latest.json",
        promptHistory: "prompt-history.latest.json",
        processedIds: "processed-ids.latest.json",
        backfillManifest: "backfill-manifest.latest.json",
        savedList: "saved-list.latest.json",
    };
    const filename = filenameByKind[kind];
    if (!filename) return { ok: false, status: 400, error: "Unsupported metadata kind." };
    const object = await env.R2_BUCKET.get(`${keyPrefix}/users/greymaker/metadata/${filename}`);
    if (!object) return { ok: true, kind, data: [] };
    const parsed = JSON.parse(await object.text()) as { data?: unknown };
    return { ok: true, kind, data: Array.isArray(parsed.data) ? parsed.data : parsed.data ? [parsed.data] : [] };
}

export async function findVaultMediaObject(env: Env, assetId: string) {
    const inventory = await listVaultInventory(env, null, 1000);
    const match = inventory.items.find((item) => item.assetId === assetId);
    if (!match?.canonicalObjectKey) return null;
    return env.R2_BUCKET.get(match.canonicalObjectKey);
}
```

- [x] **Step 4: Wire Worker routes**

Modify `cloud/src/index.ts` imports:

```ts
import { buildVaultIdentity, findVaultMediaObject, listVaultInventory, readVaultMetadata } from "./vault";
```

Add route handlers before the default 404:

```ts
        if (url.pathname.startsWith("/v1/vault/")) {
            const authError = assertAuthorized(request, env);
            if (authError) return errorResponse(authError, 401);

            if (request.method === "GET" && url.pathname === "/v1/vault/identity") {
                return jsonResponse(await buildVaultIdentity(env), 200);
            }

            if (request.method === "GET" && url.pathname === "/v1/vault/inventory") {
                const cursor = url.searchParams.get("cursor");
                const limit = Number(url.searchParams.get("limit") || "100");
                return jsonResponse(await listVaultInventory(env, cursor, limit), 200);
            }

            if (request.method === "GET" && url.pathname.startsWith("/v1/vault/metadata/")) {
                const kind = url.pathname.split("/").pop() || "";
                const result = await readVaultMetadata(env, kind);
                return jsonResponse(result, "status" in result && typeof result.status === "number" ? result.status : 200);
            }

            if (request.method === "GET" && url.pathname === "/v1/vault/gaps") {
                return jsonResponse({ ok: true, gaps: [] }, 200);
            }

            if (request.method === "GET" && url.pathname === "/v1/vault/media") {
                const assetId = url.searchParams.get("assetId") || "";
                const object = await findVaultMediaObject(env, assetId);
                if (!object?.body) return errorResponse("MEDIA_OBJECT_MISSING", 404);
                const headers = new Headers(corsHeaders());
                if (object.httpMetadata?.contentType) headers.set("content-type", object.httpMetadata.contentType);
                headers.set("cache-control", "private, no-store");
                return new Response(object.body, { status: 200, headers });
            }
        }
```

- [x] **Step 5: Run Worker tests**

Run:

```bash
cd cloud && npm run test:acceptance
cd cloud && npm run typecheck
```

Expected: PASS.

- [x] **Step 6: Update notes and commit**

Append this row to `implementation-notes.html`:

```html
          <tr>
            <td>2026-06-18</td>
            <td>Tradeoff</td>
            <td>Use a server-side media proxy path for first web playback so the browser never stores R2 credentials or long-lived signed URLs.</td>
          </tr>
```

Run:

```bash
git add cloud/src/index.ts cloud/src/types.ts cloud/src/vault.ts cloud/tests/vault-routes.test.ts implementation-notes.html
git commit -m "feat(cloud): add vault read routes"
```

## Task 4: Web Vault Types, Storage, And Projection Helpers

**Files:**
- Create: `web/src/lib/vault-types.ts`
- Create: `web/src/lib/vault-storage.ts`
- Create: `web/src/lib/vault-view-models.ts`
- Modify: `web/src/lib/types.ts`
- Modify: `web/src/lib/local-storage.ts`
- Modify: `implementation-notes.html`

- [x] **Step 1: Add Vault web types**

Create `web/src/lib/vault-types.ts`:

```ts
export type VaultMediaType = "image" | "video" | "unknown";
export type VaultSourceStatus = "verified" | "blocked" | "failed" | "unproven";

export interface VaultAsset {
  assetId: string;
  mediaType: VaultMediaType;
  canonicalObjectKey?: string;
  legacyObjectKeys: string[];
  contentType?: string;
  sizeBytes?: number;
  etag?: string;
  sha256?: string;
  sourceUrlHash?: string;
  sourceUrl?: string;
  grokPostId?: string;
  mediaUuid?: string;
  promptId?: string;
  promptText?: string;
  width?: number;
  height?: number;
  durationSeconds?: number;
  firstSeenAt?: string;
  lastSeenAt?: string;
  verificationStatus: VaultSourceStatus;
  gapCodes: string[];
  createdAt: string;
  updatedAt: string;
}

export interface VaultOverlay {
  assetId: string;
  title?: string;
  notes?: string;
  tags: string[];
  rating?: number;
  hidden: boolean;
  favorite: boolean;
  updatedAt: string;
  syncVersion?: number;
}

export interface VaultImportRun {
  id: string;
  source: "production-r2" | "acceptance-r2" | "fixture";
  workerHost: string;
  keyPrefix: string;
  importedAt: string;
  status: "previewed" | "committed" | "blocked" | "failed";
  counts: {
    assets: number;
    images: number;
    videos: number;
    prompts: number;
    verified: number;
    blocked: number;
    failed: number;
    unproven: number;
  };
  warnings: string[];
}

export interface VaultGap {
  id: string;
  assetId?: string;
  code: string;
  severity: "info" | "warning" | "blocking";
  evidence: string;
  recommendedAction: string;
  requiresLiveGrok: boolean;
  requiresCloudWrite: boolean;
}

export interface VaultPreview {
  ok: boolean;
  identity: Record<string, unknown>;
  assets: VaultAsset[];
  prompts: Array<{ id: string; text: string; tags?: string[]; sourceAssetIds?: string[]; usageCount?: number; createdAt?: string }>;
  gaps: VaultGap[];
  counts: VaultImportRun["counts"];
  warnings: string[];
}

export function normalizePromptText(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}
```

- [x] **Step 2: Extend shared app types**

Modify `web/src/lib/types.ts`:

```ts
export interface VideoItem {
  id: string;
  grokPostId: string;
  sourceUrl: string;
  videoUrl: string;
  thumbnailUrl: string;
  promptText: string;
  position: number;
  notes: string;
  createdAt: string;
  assetId?: string;
  mediaType?: "image" | "video" | "unknown";
  imageUrl?: string;
}
```

Change `MovieClip` type:

```ts
export interface MovieClip {
  id: string;
  type: "video" | "image" | "title";
  videoUrl?: string;
  imageUrl?: string;
  sourceCollectionId?: string;
  sourceAssetId?: string;
  trimStart?: number;
  trimEnd?: number;
  stillDuration?: number;
  titleText?: string;
  titleSubtext?: string;
  titleDuration?: number;
  titleBgColor?: string;
  titleTextColor?: string;
  transition: Transition;
  position: number;
}
```

- [x] **Step 3: Add Vault storage helpers**

Create `web/src/lib/vault-storage.ts`:

```ts
import type { IDBPDatabase } from "idb";
import type { VaultAsset, VaultGap, VaultImportRun, VaultOverlay, VaultPreview } from "./vault-types";

export const VAULT_STORE_NAMES = [
  "vault_assets",
  "vault_overlays",
  "vault_import_runs",
  "vault_gaps",
  "vault_prompts",
  "vault_media_tokens",
] as const;

export function upgradeVaultStores(db: IDBPDatabase): void {
  if (!db.objectStoreNames.contains("vault_assets")) {
    const store = db.createObjectStore("vault_assets", { keyPath: "assetId" });
    store.createIndex("by-media-type", "mediaType");
    store.createIndex("by-status", "verificationStatus");
    store.createIndex("by-updated", "updatedAt");
  }
  if (!db.objectStoreNames.contains("vault_overlays")) {
    db.createObjectStore("vault_overlays", { keyPath: "assetId" });
  }
  if (!db.objectStoreNames.contains("vault_import_runs")) {
    const store = db.createObjectStore("vault_import_runs", { keyPath: "id" });
    store.createIndex("by-imported", "importedAt");
  }
  if (!db.objectStoreNames.contains("vault_gaps")) {
    const store = db.createObjectStore("vault_gaps", { keyPath: "id" });
    store.createIndex("by-asset", "assetId");
  }
  if (!db.objectStoreNames.contains("vault_prompts")) {
    db.createObjectStore("vault_prompts", { keyPath: "id" });
  }
  if (!db.objectStoreNames.contains("vault_media_tokens")) {
    db.createObjectStore("vault_media_tokens", { keyPath: "assetId" });
  }
}

export async function commitVaultPreview(db: IDBPDatabase, preview: VaultPreview): Promise<VaultImportRun> {
  const now = new Date().toISOString();
  const run: VaultImportRun = {
    id: `vault-import-${Date.now()}`,
    source: "production-r2",
    workerHost: String(preview.identity.workerHost || preview.identity.service || "unknown"),
    keyPrefix: String(preview.identity.keyPrefix || "grok-powertools/v1"),
    importedAt: now,
    status: "committed",
    counts: preview.counts,
    warnings: preview.warnings,
  };

  const tx = db.transaction(["vault_assets", "vault_gaps", "vault_prompts", "vault_import_runs"], "readwrite");
  for (const asset of preview.assets) {
    await tx.objectStore("vault_assets").put(asset satisfies VaultAsset);
  }
  for (const gap of preview.gaps) {
    await tx.objectStore("vault_gaps").put(gap satisfies VaultGap);
  }
  for (const prompt of preview.prompts) {
    await tx.objectStore("vault_prompts").put(prompt);
  }
  await tx.objectStore("vault_import_runs").put(run);
  await tx.done;
  return run;
}

export async function getVaultAssets(db: IDBPDatabase): Promise<VaultAsset[]> {
  return (await db.getAll("vault_assets")) as VaultAsset[];
}

export async function getVaultOverlays(db: IDBPDatabase): Promise<VaultOverlay[]> {
  return (await db.getAll("vault_overlays")) as VaultOverlay[];
}
```

- [x] **Step 4: Wire IndexedDB migration**

Modify `web/src/lib/local-storage.ts`:

```ts
import { upgradeVaultStores } from "./vault-storage";
```

Change:

```ts
const DB_VERSION = 3;
```

to:

```ts
const DB_VERSION = 4;
```

Inside `upgrade(db, oldVersion)` add:

```ts
        if (oldVersion < 4) {
          upgradeVaultStores(db);
        }
```

Export `getDB` so Vault UI can commit previews through the same database:

```ts
export function getDB(): Promise<IDBPDatabase> {
```

- [x] **Step 5: Add projection helpers**

Create `web/src/lib/vault-view-models.ts`:

```ts
import type { MovieClip, VideoItem } from "./types";
import type { VaultAsset } from "./vault-types";

export function vaultAssetToVideoItem(asset: VaultAsset, position = 0): VideoItem {
  const mediaUrl = `/api/vault/media/${encodeURIComponent(asset.assetId)}`;
  return {
    id: asset.assetId,
    assetId: asset.assetId,
    mediaType: asset.mediaType,
    grokPostId: asset.grokPostId || asset.assetId,
    sourceUrl: asset.sourceUrl || "",
    videoUrl: asset.mediaType === "video" ? mediaUrl : "",
    imageUrl: asset.mediaType === "image" ? mediaUrl : undefined,
    thumbnailUrl: asset.mediaType === "image" ? mediaUrl : "",
    promptText: asset.promptText || "",
    position,
    notes: "",
    createdAt: asset.createdAt,
  };
}

export function vaultAssetToMovieClip(asset: VaultAsset, position = 0): MovieClip {
  const mediaUrl = `/api/vault/media/${encodeURIComponent(asset.assetId)}`;
  return {
    id: crypto.randomUUID(),
    type: asset.mediaType === "image" ? "image" : "video",
    videoUrl: asset.mediaType === "video" ? mediaUrl : undefined,
    imageUrl: asset.mediaType === "image" ? mediaUrl : undefined,
    sourceAssetId: asset.assetId,
    stillDuration: asset.mediaType === "image" ? 3 : undefined,
    transition: position === 0 ? { type: "cut", duration: 0 } : { type: "crossfade", duration: 0.5 },
    position,
  };
}
```

- [x] **Step 6: Run build**

Run:

```bash
cd web && npm run build
```

Expected: PASS.

- [x] **Step 7: Update notes and commit**

Append this row to `implementation-notes.html`:

```html
          <tr>
            <td>2026-06-18</td>
            <td>Design decision</td>
            <td>Vault data uses the existing IndexedDB database with a versioned migration so existing collections and movies are preserved.</td>
          </tr>
```

Run:

```bash
git add web/src/lib/types.ts web/src/lib/local-storage.ts web/src/lib/vault-types.ts web/src/lib/vault-storage.ts web/src/lib/vault-view-models.ts implementation-notes.html
git commit -m "feat(web): add vault local data model"
```

## Task 5: Next Vault API Routes

**Files:**
- Create: `web/src/lib/vault-client.ts`
- Create: `web/src/app/api/vault/inventory/route.ts`
- Create: `web/src/app/api/vault/metadata/[kind]/route.ts`
- Create: `web/src/app/api/vault/media/[assetId]/route.ts`
- Create: `web/src/app/api/vault/preview/route.ts`
- Create: `web/src/app/api/vault/gaps/route.ts`
- Create: `web/src/app/api/vault/gap-fill/plan/route.ts`
- Create: `web/src/app/api/vault/gap-fill/run/route.ts`
- Create: `web/src/app/api/vault/reconcile/index/route.ts`
- Modify: `tests/e2e-web/vault-api.spec.js`
- Modify: `implementation-notes.html`

- [x] **Step 1: Extend failing API tests**

Append to `tests/e2e-web/vault-api.spec.js`:

```js
test("Vault preview returns inventory, prompts, gaps, and counts", async ({ request }) => {
  const res = await request.get("/api/vault/preview");
  expect(res.ok()).toBe(true);
  const body = await res.json();
  expect(body.assets).toHaveLength(2);
  expect(body.prompts).toHaveLength(2);
  expect(body.counts.assets).toBe(2);
  expect(body.counts.images).toBe(1);
  expect(body.counts.videos).toBe(1);
});

test("Vault media route proxies media without exposing Worker API key", async ({ request }) => {
  const res = await request.get("/api/vault/media/asset-image-1");
  expect(res.ok()).toBe(true);
  expect(res.headers()["content-type"]).toContain("image/png");
  const body = await res.body();
  expect(body.byteLength).toBeGreaterThan(0);
});

test("Gap-fill run is blocked by default", async ({ request }) => {
  const res = await request.post("/api/vault/gap-fill/run", {
    data: { assetIds: ["asset-image-1"] },
  });
  expect(res.status()).toBe(409);
  const body = await res.json();
  expect(body.error).toBe("LIVE_GROK_REPAIR_NOT_ARMED");
});
```

- [x] **Step 2: Run failing API tests**

Run:

```bash
npx playwright test -c playwright.web.config.js tests/e2e-web/vault-api.spec.js
```

Expected: FAIL because the new API routes do not exist.

- [x] **Step 3: Add browser client**

Create `web/src/lib/vault-client.ts`:

```ts
import type { VaultPreview } from "./vault-types";

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, cache: "no-store" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = typeof data?.error === "string" ? data.error : `Request failed: ${res.status}`;
    throw new Error(message);
  }
  return data as T;
}

export function fetchVaultIdentity() {
  return json<Record<string, unknown>>("/api/vault/identity");
}

export function fetchVaultPreview() {
  return json<VaultPreview>("/api/vault/preview");
}

export function fetchVaultGaps() {
  return json("/api/vault/gaps");
}
```

- [x] **Step 4: Add inventory route**

Create `web/src/app/api/vault/inventory/route.ts`:

```ts
import { NextResponse } from "next/server";
import { workerJson } from "@/lib/vault-server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const cursor = url.searchParams.get("cursor");
  const workerPath = `/v1/vault/inventory${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`;
  const data = await workerJson(workerPath);
  return NextResponse.json(data);
}
```

- [x] **Step 5: Add metadata route**

Create `web/src/app/api/vault/metadata/[kind]/route.ts`:

```ts
import { NextResponse } from "next/server";
import { workerJson } from "@/lib/vault-server";

export async function GET(_request: Request, { params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  const data = await workerJson(`/v1/vault/metadata/${encodeURIComponent(kind)}`);
  return NextResponse.json(data);
}
```

- [x] **Step 6: Add media proxy route**

Create `web/src/app/api/vault/media/[assetId]/route.ts`:

```ts
import { getWorkerConfig } from "@/lib/vault-server";

export async function GET(_request: Request, { params }: { params: Promise<{ assetId: string }> }) {
  const { assetId } = await params;
  const { workerUrl, apiKey } = getWorkerConfig();
  const res = await fetch(`${workerUrl}/v1/vault/media?assetId=${encodeURIComponent(assetId)}`, {
    headers: { "x-gpt-api-key": apiKey },
    cache: "no-store",
  });

  if (!res.ok || !res.body) {
    return new Response("MEDIA_OBJECT_MISSING", { status: res.status || 404 });
  }

  const headers = new Headers();
  const contentType = res.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);
  headers.set("cache-control", "private, no-store");
  return new Response(res.body, { status: 200, headers });
}
```

- [x] **Step 7: Add preview and gap routes**

Create `web/src/app/api/vault/preview/route.ts`:

```ts
import { NextResponse } from "next/server";
import { workerJson } from "@/lib/vault-server";

export async function GET() {
  const [identity, inventory, savedPrompts, promptHistory, gaps] = await Promise.all([
    workerJson<Record<string, unknown>>("/v1/vault/identity"),
    workerJson<{ items: unknown[]; counts: Record<string, number> }>("/v1/vault/inventory"),
    workerJson<{ prompts?: unknown[]; data?: unknown[] }>("/v1/vault/metadata/savedPrompts"),
    workerJson<{ prompts?: unknown[]; data?: unknown[] }>("/v1/vault/metadata/promptHistory"),
    workerJson<{ gaps?: unknown[] }>("/v1/vault/gaps"),
  ]);

  const prompts = [
    ...(savedPrompts.prompts || savedPrompts.data || []),
    ...(promptHistory.prompts || promptHistory.data || []),
  ];

  return NextResponse.json({
    ok: true,
    identity,
    assets: inventory.items,
    prompts,
    gaps: gaps.gaps || [],
    counts: {
      assets: inventory.counts.assets || inventory.items.length,
      images: inventory.counts.images || 0,
      videos: inventory.counts.videos || 0,
      prompts: prompts.length,
      verified: inventory.counts.verified || 0,
      blocked: inventory.counts.blocked || 0,
      failed: inventory.counts.failed || 0,
      unproven: inventory.counts.unproven || 0,
    },
    warnings: [],
  });
}
```

Create `web/src/app/api/vault/gaps/route.ts`:

```ts
import { NextResponse } from "next/server";
import { workerJson } from "@/lib/vault-server";

export async function GET() {
  return NextResponse.json(await workerJson("/v1/vault/gaps"));
}
```

- [x] **Step 8: Add gated action routes**

Create `web/src/app/api/vault/gap-fill/plan/route.ts`:

```ts
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const assetIds = Array.isArray(body.assetIds) ? body.assetIds : [];
  return NextResponse.json({
    ok: true,
    plan: {
      assetIds,
      requiresLiveGrok: true,
      requiresCloudWrite: false,
      actions: assetIds.map((assetId) => ({
        assetId,
        action: "inspect-grok-post",
        status: "planned",
      })),
    },
  });
}
```

Create `web/src/app/api/vault/gap-fill/run/route.ts`:

```ts
import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    { ok: false, error: "LIVE_GROK_REPAIR_NOT_ARMED" },
    { status: 409 }
  );
}
```

Create `web/src/app/api/vault/reconcile/index/route.ts`:

```ts
import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    { ok: false, error: "RECONCILE_INDEX_NOT_ARMED" },
    { status: 409 }
  );
}
```

- [x] **Step 9: Run tests and build**

Run:

```bash
npx playwright test -c playwright.web.config.js tests/e2e-web/vault-api.spec.js
cd web && npm run build
```

Expected: PASS.

- [x] **Step 10: Update notes and commit**

Append this row:

```html
          <tr>
            <td>2026-06-18</td>
            <td>Safety</td>
            <td>Gap-fill run and index reconciliation routes exist but fail closed until a later approved live repair lane arms them.</td>
          </tr>
```

Run:

```bash
git add tests/e2e-web/vault-api.spec.js web/src/lib/vault-client.ts web/src/app/api/vault implementation-notes.html
git commit -m "feat(web): add vault api routes"
```

## Task 6: Vault Route, Header, And Dashboard Empty State

**Files:**
- Create: `web/src/app/vault/page.tsx`
- Create: `web/src/components/vault/VaultPage.tsx`
- Create: `web/src/components/vault/VaultLoadPanel.tsx`
- Modify: `tests/e2e-web/vault-ui.spec.js`
- Modify: `web/src/components/layout/Header.tsx`
- Modify: `web/src/components/dashboard/Dashboard.tsx`
- Modify: `implementation-notes.html`

- [x] **Step 1: Write failing UI smoke test**

Create `tests/e2e-web/vault-ui.spec.js`:

```js
const { test, expect } = require("@playwright/test");

async function resetDb(page) {
  await page.goto("/");
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      const request = indexedDB.deleteDatabase("grok-power-tools");
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
    });
  });
}

test("empty local app points to Vault load instead of demo-first flow", async ({ page }) => {
  await resetDb(page);
  await page.goto("/");
  await expect(page.getByRole("link", { name: /Vault/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /Preview Vault/i })).toBeVisible();
  await expect(page.getByText(/fake-grok-r2-backup/i)).toBeVisible();
});

test("Vault route renders preview controls", async ({ page }) => {
  await resetDb(page);
  await page.goto("/vault");
  await expect(page.getByRole("heading", { name: /Vault/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /Preview Vault/i })).toBeVisible();
});
```

- [x] **Step 2: Run failing UI test**

Run:

```bash
npx playwright test -c playwright.web.config.js tests/e2e-web/vault-ui.spec.js
```

Expected: FAIL because `/vault` and dashboard Vault load do not exist.

- [x] **Step 3: Add Vault page shell**

Create `web/src/app/vault/page.tsx`:

```tsx
import VaultPage from "@/components/vault/VaultPage";

export default function Page() {
  return <VaultPage />;
}
```

Create `web/src/components/vault/VaultLoadPanel.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { Cloud, RefreshCw } from "lucide-react";
import Button from "@/components/ui/Button";
import { fetchVaultIdentity } from "@/lib/vault-client";

export default function VaultLoadPanel({ onPreview }: { onPreview: () => void }) {
  const [identity, setIdentity] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchVaultIdentity()
      .then(setIdentity)
      .catch((error) => setIdentity({ ok: false, message: error instanceof Error ? error.message : "Vault identity failed" }))
      .finally(() => setLoading(false));
  }, []);

  return (
    <section className="rounded-(--radius-card) border border-(--color-surface-200) bg-(--color-surface-0) p-5 shadow-(--shadow-card) dark:border-(--color-surface-800) dark:bg-(--color-surface-900)">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-2xl font-semibold text-(--color-surface-900) dark:text-(--color-surface-100)">
            Vault
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-(--color-surface-500)">
            Load the backed-up Grok saved gallery from R2 into local owner mode. Preview is read-only.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-(--color-surface-500)">
            <Cloud className="h-4 w-4 text-(--color-accent)" />
            <span>{loading ? "Checking Worker..." : String(identity?.service || identity?.message || "Worker checked")}</span>
            {identity?.keyPrefix && <span>Prefix {String(identity.keyPrefix)}</span>}
          </div>
        </div>
        <Button variant="primary" onClick={onPreview} disabled={loading || identity?.ok === false}>
          <RefreshCw className="h-4 w-4" />
          Preview Vault
        </Button>
      </div>
    </section>
  );
}
```

Create `web/src/components/vault/VaultPage.tsx`:

```tsx
"use client";

import { useState } from "react";
import VaultLoadPanel from "./VaultLoadPanel";
import type { VaultPreview } from "@/lib/vault-types";
import { fetchVaultPreview } from "@/lib/vault-client";

export default function VaultPage() {
  const [preview, setPreview] = useState<VaultPreview | null>(null);
  const [loading, setLoading] = useState(false);

  async function handlePreview() {
    setLoading(true);
    try {
      setPreview(await fetchVaultPreview());
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-screen-2xl px-6 py-8">
      <VaultLoadPanel onPreview={handlePreview} />
      {loading && <p className="mt-4 text-sm text-(--color-surface-500)">Loading Vault preview...</p>}
      {preview && (
        <section className="mt-6 rounded-(--radius-card) border border-(--color-surface-200) bg-(--color-surface-0) p-4 dark:border-(--color-surface-800) dark:bg-(--color-surface-900)">
          <h2 className="text-sm font-semibold">Preview</h2>
          <p className="mt-2 text-sm text-(--color-surface-500)">
            {preview.counts.assets} assets, {preview.counts.images} images, {preview.counts.videos} videos, {preview.counts.prompts} prompts.
          </p>
        </section>
      )}
    </div>
  );
}
```

- [x] **Step 4: Add Header nav and breadcrumb**

Modify `web/src/components/layout/Header.tsx`:

```tsx
import { Scissors, Film, Sparkles, Settings, BookOpen, Activity, Archive } from "lucide-react";
```

Add Vault to `NAV_ITEMS` before Ops:

```tsx
  { href: "/vault", icon: Archive, label: "Vault" },
```

Add breadcrumb:

```tsx
  if (pathname === "/vault") return { label: "Vault", href: "/vault" };
```

- [x] **Step 5: Put Vault load on empty dashboard**

Modify `web/src/components/dashboard/Dashboard.tsx` to import:

```tsx
import VaultLoadPanel from "@/components/vault/VaultLoadPanel";
```

In the empty state branch, add this before the existing welcome copy:

```tsx
          <div className="mb-8">
            <VaultLoadPanel onPreview={() => router.push("/vault")} />
          </div>
```

- [x] **Step 6: Run UI test and build**

Run:

```bash
npx playwright test -c playwright.web.config.js tests/e2e-web/vault-ui.spec.js
cd web && npm run build
```

Expected: PASS.

- [x] **Step 7: Update notes and commit**

Append this row:

```html
          <tr>
            <td>2026-06-18</td>
            <td>Design decision</td>
            <td>The empty dashboard now leads with real Vault loading when Worker config is present. Demo examples remain secondary.</td>
          </tr>
```

Run:

```bash
git add tests/e2e-web/vault-ui.spec.js web/src/app/vault/page.tsx web/src/components/vault/VaultPage.tsx web/src/components/vault/VaultLoadPanel.tsx web/src/components/layout/Header.tsx web/src/components/dashboard/Dashboard.tsx implementation-notes.html
git commit -m "feat(web): add vault entry surface"
```

## Task 7: Preview Commit And Vault Grid

**Files:**
- Create: `web/src/components/vault/VaultGrid.tsx`
- Create: `web/src/components/vault/VaultMediaCard.tsx`
- Modify: `web/src/components/vault/VaultPage.tsx`
- Modify: `tests/e2e-web/vault-ui.spec.js`
- Modify: `implementation-notes.html`

- [x] **Step 1: Add failing commit test**

Append to `tests/e2e-web/vault-ui.spec.js`:

```js
test("preview commit stores Vault assets and survives reload", async ({ page }) => {
  await resetDb(page);
  await page.goto("/vault");
  await page.getByRole("button", { name: /Preview Vault/i }).click();
  await expect(page.getByText(/2 assets/i)).toBeVisible();
  await page.getByRole("button", { name: /Commit Vault/i }).click();
  await expect(page.getByText(/asset-video-1/i)).toBeVisible();
  await expect(page.getByText(/asset-image-1/i)).toBeVisible();
  await page.reload();
  await expect(page.getByText(/asset-video-1/i)).toBeVisible();
  await expect(page.getByText(/asset-image-1/i)).toBeVisible();
});
```

- [x] **Step 2: Run failing commit test**

Run:

```bash
npx playwright test -c playwright.web.config.js tests/e2e-web/vault-ui.spec.js
```

Expected: FAIL because commit and grid do not exist.

- [x] **Step 3: Add Vault media card and grid**

Create `web/src/components/vault/VaultMediaCard.tsx`:

```tsx
"use client";

import { ImageIcon, Play, Plus } from "lucide-react";
import type { VaultAsset } from "@/lib/vault-types";
import Button from "@/components/ui/Button";

export default function VaultMediaCard({
  asset,
  onOpen,
  onAddToCollection,
}: {
  asset: VaultAsset;
  onOpen: (asset: VaultAsset) => void;
  onAddToCollection: (asset: VaultAsset) => void;
}) {
  const mediaUrl = `/api/vault/media/${encodeURIComponent(asset.assetId)}`;
  const isImage = asset.mediaType === "image";

  return (
    <article className="overflow-hidden rounded-(--radius-card) border border-(--color-surface-200) bg-(--color-surface-0) shadow-(--shadow-card) dark:border-(--color-surface-800) dark:bg-(--color-surface-900)">
      <button type="button" onClick={() => onOpen(asset)} className="relative block aspect-[3/4] w-full bg-black text-left">
        {isImage ? (
          // eslint-disable-next-line @next/next/no-img-element -- R2 media is served through local API proxy.
          <img src={mediaUrl} alt={asset.promptText || asset.assetId} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <Play className="h-10 w-10 text-white/70" />
          </div>
        )}
      </button>
      <div className="space-y-2 p-3">
        <div className="flex items-center gap-2 text-xs text-(--color-surface-500)">
          {isImage ? <ImageIcon className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
          <span>{asset.mediaType}</span>
          <span>{asset.verificationStatus}</span>
        </div>
        <p className="truncate font-mono text-xs text-(--color-surface-500)">{asset.assetId}</p>
        {asset.promptText && <p className="line-clamp-2 text-sm text-(--color-surface-700) dark:text-(--color-surface-300)">{asset.promptText}</p>}
        <Button variant="secondary" size="sm" onClick={() => onAddToCollection(asset)}>
          <Plus className="h-3.5 w-3.5" />
          Add to Collection
        </Button>
      </div>
    </article>
  );
}
```

Create `web/src/components/vault/VaultGrid.tsx`:

```tsx
"use client";

import type { VaultAsset } from "@/lib/vault-types";
import VaultMediaCard from "./VaultMediaCard";

export default function VaultGrid({
  assets,
  onOpen,
  onAddToCollection,
}: {
  assets: VaultAsset[];
  onOpen: (asset: VaultAsset) => void;
  onAddToCollection: (asset: VaultAsset) => void;
}) {
  if (assets.length === 0) {
    return <p className="py-10 text-center text-sm text-(--color-surface-500)">No Vault assets committed locally.</p>;
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
      {assets.map((asset) => (
        <VaultMediaCard key={asset.assetId} asset={asset} onOpen={onOpen} onAddToCollection={onAddToCollection} />
      ))}
    </div>
  );
}
```

- [x] **Step 4: Wire preview commit**

Modify `web/src/components/vault/VaultPage.tsx`:

```tsx
import { useEffect, useState } from "react";
import Button from "@/components/ui/Button";
import VaultGrid from "./VaultGrid";
import { getDB } from "@/lib/local-storage";
import { commitVaultPreview, getVaultAssets } from "@/lib/vault-storage";
import type { VaultAsset, VaultPreview } from "@/lib/vault-types";
```

Add state:

```tsx
  const [assets, setAssets] = useState<VaultAsset[]>([]);
```

Add effect and commit handler:

```tsx
  useEffect(() => {
    getDB().then(getVaultAssets).then(setAssets).catch(() => setAssets([]));
  }, []);

  async function handleCommit() {
    if (!preview) return;
    const db = await getDB();
    await commitVaultPreview(db, preview);
    setAssets(await getVaultAssets(db));
  }
```

Replace the preview section body with:

```tsx
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm text-(--color-surface-500)">
              {preview.counts.assets} assets, {preview.counts.images} images, {preview.counts.videos} videos, {preview.counts.prompts} prompts.
            </p>
            <Button variant="primary" onClick={handleCommit}>Commit Vault</Button>
          </div>
```

Add below preview section:

```tsx
      <section className="mt-6">
        <VaultGrid
          assets={assets}
          onOpen={() => {}}
          onAddToCollection={() => {}}
        />
      </section>
```

- [x] **Step 5: Run test and build**

Run:

```bash
npx playwright test -c playwright.web.config.js tests/e2e-web/vault-ui.spec.js
cd web && npm run build
```

Expected: PASS.

- [x] **Step 6: Update notes and commit**

Append:

```html
          <tr>
            <td>2026-06-18</td>
            <td>Verification</td>
            <td>Vault preview commit is local IndexedDB only and repeated page loads use committed local Vault data.</td>
          </tr>
```

Run:

```bash
git add tests/e2e-web/vault-ui.spec.js web/src/components/vault/VaultPage.tsx web/src/components/vault/VaultGrid.tsx web/src/components/vault/VaultMediaCard.tsx implementation-notes.html
git commit -m "feat(web): commit vault preview locally"
```

## Task 8: Media-Aware Viewer And Cards

**Files:**
- Create: `web/src/components/vault/VaultMediaViewer.tsx`
- Modify: `web/src/components/vault/VaultPage.tsx`
- Modify: `web/src/components/vault/VaultMediaCard.tsx`
- Modify: `web/src/components/video/VideoCard.tsx`
- Modify: `web/src/components/video/FullscreenViewer.tsx`
- Modify: `tests/e2e-web/vault-ui.spec.js`
- Modify: `implementation-notes.html`

- [x] **Step 1: Add failing media viewer test**

Append:

```js
test("Vault viewer opens image and video assets", async ({ page }) => {
  await resetDb(page);
  await page.goto("/vault");
  await page.getByRole("button", { name: /Preview Vault/i }).click();
  await page.getByRole("button", { name: /Commit Vault/i }).click();
  await page.getByText("asset-image-1").click();
  await expect(page.getByRole("dialog", { name: /Vault media viewer/i })).toBeVisible();
  await expect(page.locator("img[alt*='glass library']")).toBeVisible();
  await page.getByRole("button", { name: /Close/i }).click();
  await page.getByText("asset-video-1").click();
  await expect(page.getByText(/video/i)).toBeVisible();
});
```

- [x] **Step 2: Run failing viewer test**

Run:

```bash
npx playwright test -c playwright.web.config.js tests/e2e-web/vault-ui.spec.js
```

Expected: FAIL because the viewer is not wired.

- [x] **Step 3: Add Vault media viewer**

Create `web/src/components/vault/VaultMediaViewer.tsx`:

```tsx
"use client";

import { X } from "lucide-react";
import type { VaultAsset } from "@/lib/vault-types";

export default function VaultMediaViewer({
  asset,
  onClose,
}: {
  asset: VaultAsset | null;
  onClose: () => void;
}) {
  if (!asset) return null;
  const mediaUrl = `/api/vault/media/${encodeURIComponent(asset.assetId)}`;
  const isImage = asset.mediaType === "image";

  return (
    <div role="dialog" aria-label="Vault media viewer" className="fixed inset-0 z-50 flex flex-col bg-black text-white">
      <div className="flex items-center justify-between px-4 py-3">
        <div>
          <p className="text-sm font-medium">{asset.assetId}</p>
          <p className="text-xs text-white/50">{asset.mediaType} / {asset.verificationStatus}</p>
        </div>
        <button type="button" aria-label="Close" onClick={onClose} className="rounded-full bg-white/10 p-2 hover:bg-white/20">
          <X className="h-5 w-5" />
        </button>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center">
        {isImage ? (
          // eslint-disable-next-line @next/next/no-img-element -- R2 media is served through local API proxy.
          <img src={mediaUrl} alt={asset.promptText || asset.assetId} className="max-h-full max-w-full object-contain" />
        ) : (
          <video src={mediaUrl} className="max-h-full max-w-full" controls autoPlay playsInline />
        )}
      </div>
      {asset.promptText && <p className="px-4 py-3 text-sm text-white/80">{asset.promptText}</p>}
    </div>
  );
}
```

- [x] **Step 4: Wire viewer**

Modify `web/src/components/vault/VaultPage.tsx`:

```tsx
import VaultMediaViewer from "./VaultMediaViewer";
```

Add state:

```tsx
  const [viewerAsset, setViewerAsset] = useState<VaultAsset | null>(null);
```

Change `VaultGrid` props:

```tsx
          onOpen={setViewerAsset}
```

Add at the end of the return:

```tsx
      <VaultMediaViewer asset={viewerAsset} onClose={() => setViewerAsset(null)} />
```

- [x] **Step 5: Update existing video card for images**

Modify `web/src/components/video/VideoCard.tsx` so the media container branch starts with:

```tsx
        {item.mediaType === "image" && (item.imageUrl || item.thumbnailUrl) ? (
          // eslint-disable-next-line @next/next/no-img-element -- Vault images are served through local API proxy.
          <img
            src={item.imageUrl || item.thumbnailUrl}
            alt={item.promptText || "Grok Imagine"}
            className={`absolute inset-0 h-full w-full ${fitMode === "contain" ? "object-contain" : "object-cover"}`}
          />
        ) : item.videoUrl ? (
```

Keep the rest of the existing video branch after that line.

- [x] **Step 6: Run tests and build**

Run:

```bash
npx playwright test -c playwright.web.config.js tests/e2e-web/vault-ui.spec.js
cd web && npm run build
```

Expected: PASS.

- [x] **Step 7: Update notes and commit**

Append:

```html
          <tr>
            <td>2026-06-18</td>
            <td>Design decision</td>
            <td>Vault viewer handles images and videos directly. Existing video cards get image support without renaming the whole component tree in this pass.</td>
          </tr>
```

Run:

```bash
git add tests/e2e-web/vault-ui.spec.js web/src/components/vault/VaultMediaViewer.tsx web/src/components/vault/VaultPage.tsx web/src/components/video/VideoCard.tsx implementation-notes.html
git commit -m "feat(web): add media-aware vault viewer"
```

## Task 9: Collections, Watch Queues, And Save As Movie

**Files:**
- Create: `web/src/lib/watch-mode.ts`
- Modify: `web/src/components/vault/VaultPage.tsx`
- Modify: `web/src/components/vault/VaultGrid.tsx`
- Modify: `web/src/components/collections/CollectionView.tsx`
- Modify: `web/src/components/collections/BulkActionBar.tsx`
- Modify: `web/src/components/video/FullscreenViewer.tsx`
- Modify: `web/src/components/layout/Header.tsx`
- Modify: `web/src/app/collections/page.tsx`
- Modify: `tests/e2e-web/vault-ui.spec.js`
- Modify: `implementation-notes.html`

- [x] **Step 1: Add failing collection and watch test**

Append:

```js
test("Vault assets can become a collection and watch queue", async ({ page }) => {
  await resetDb(page);
  await page.goto("/vault");
  await page.getByRole("button", { name: /Preview Vault/i }).click();
  await page.getByRole("button", { name: /Commit Vault/i }).click();
  await page.getByRole("button", { name: /Add to Collection/i }).first().click();
  await expect(page.getByText(/Added to New Collection/i)).toBeVisible();
  await page.getByRole("link", { name: /Collections/i }).click();
  await page.getByRole("button", { name: /Watch All/i }).click();
  await expect(page.getByText(/Watch Mode/i)).toBeVisible();
});
```

- [x] **Step 2: Run failing test**

Run:

```bash
npx playwright test -c playwright.web.config.js tests/e2e-web/vault-ui.spec.js
```

Expected: FAIL because collection and watch actions are not wired.

- [x] **Step 3: Add watch helper**

Create `web/src/lib/watch-mode.ts`:

```ts
import type { Movie, MovieClip, VideoItem } from "./types";
import { createMovie, updateMovie } from "./local-storage";

export type WatchQueueKind = "compilation" | "selection";

export function getWatchableQueue(items: VideoItem[]): VideoItem[] {
  return items.filter((item) => item.videoUrl || item.imageUrl || item.thumbnailUrl);
}

export function getSelectedWatchableQueue(items: VideoItem[], selectedIds: Set<string>): VideoItem[] {
  return items.filter((item) => selectedIds.has(item.id) && (item.videoUrl || item.imageUrl || item.thumbnailUrl));
}

export function buildMovieClipsFromQueue(queue: VideoItem[]): MovieClip[] {
  return queue.map((item, index) => ({
    id: crypto.randomUUID(),
    type: item.mediaType === "image" ? "image" : "video",
    videoUrl: item.mediaType === "video" ? item.videoUrl : undefined,
    imageUrl: item.mediaType === "image" ? item.imageUrl || item.thumbnailUrl : undefined,
    sourceAssetId: item.assetId,
    stillDuration: item.mediaType === "image" ? 3 : undefined,
    transition: index === 0 ? { type: "cut", duration: 0 } : { type: "crossfade", duration: 0.5 },
    position: index,
  }));
}

export async function createMovieFromWatchQueue(queue: VideoItem[], name: string): Promise<Movie> {
  const movie = await createMovie(name);
  return updateMovie({ ...movie, clips: buildMovieClipsFromQueue(queue) });
}
```

- [x] **Step 4: Wire Add to Collection from Vault**

Modify `web/src/components/vault/VaultPage.tsx` to import:

```tsx
import { createCollection, getAllCollections, updateCollection } from "@/lib/local-storage";
import { vaultAssetToVideoItem } from "@/lib/vault-view-models";
import { useToast } from "@/components/ui/Toast";
```

Add:

```tsx
  const { toast } = useToast();

  async function handleAddToCollection(asset: VaultAsset) {
    const collections = await getAllCollections();
    const existing = collections.find((collection) => collection.name === "New Collection");
    const item = vaultAssetToVideoItem(asset, existing?.items.length || 0);
    if (existing) {
      await updateCollection({ ...existing, items: [...existing.items, item] });
    } else {
      await createCollection("New Collection", [item]);
    }
    toast("Added to New Collection", "success");
  }
```

Change `VaultGrid`:

```tsx
          onAddToCollection={handleAddToCollection}
```

- [x] **Step 5: Add Watch All to collections**

Modify `web/src/components/collections/BulkActionBar.tsx` to add an `onWatchSelected` prop and a `Watch Selected` button with `Play` icon.

Modify `web/src/components/collections/CollectionView.tsx`:

```tsx
import { Play } from "lucide-react";
import { createMovieFromWatchQueue, getSelectedWatchableQueue, getWatchableQueue } from "@/lib/watch-mode";
```

Replace `viewerIndex` with:

```tsx
  const [viewerState, setViewerState] = useState<{ items: VideoItem[]; startIndex: number; watchMode: boolean } | null>(null);
```

Add handlers:

```tsx
  const handleWatchAll = useCallback(() => {
    const queue = getWatchableQueue(displayItems);
    if (queue.length === 0) return toast("No watchable media in this collection", "warning");
    setViewerState({ items: queue, startIndex: 0, watchMode: true });
  }, [displayItems, toast]);

  const handleWatchSelected = useCallback(() => {
    const queue = getSelectedWatchableQueue(displayItems, selectedIds);
    if (queue.length === 0) return toast("No watchable selected media", "warning");
    setViewerState({ items: queue, startIndex: 0, watchMode: true });
  }, [displayItems, selectedIds, toast]);
```

Add a header button before Copy Links:

```tsx
            <Button variant="primary" onClick={handleWatchAll} disabled={itemCount === 0}>
              <Play className="h-4 w-4" />
              Watch All
            </Button>
```

Replace the FullscreenViewer render with:

```tsx
      {viewerState && (
        <FullscreenViewer
          items={viewerState.items}
          startIndex={viewerState.startIndex}
          onClose={() => setViewerState(null)}
          watchMode={viewerState.watchMode}
          onSaveAsMovie={async (items) => {
            const movie = await createMovieFromWatchQueue(items, `${collectionName} Compilation`);
            router.push(`/movie?id=${movie.id}`);
          }}
        />
      )}
```

- [x] **Step 6: Extend FullscreenViewer props**

Modify `web/src/components/video/FullscreenViewer.tsx` to accept:

```tsx
interface FullscreenViewerProps {
  items: VideoItem[];
  startIndex: number;
  onClose: () => void;
  watchMode?: boolean;
  onSaveAsMovie?: (items: VideoItem[]) => Promise<void>;
}
```

For images, render:

```tsx
      {currentItem.mediaType === "image" ? (
        // eslint-disable-next-line @next/next/no-img-element -- Vault images are served through local API proxy.
        <img src={currentItem.imageUrl || currentItem.thumbnailUrl} alt={currentItem.promptText || currentItem.id} className="h-full w-full object-contain" />
      ) : (
        <video ... />
      )}
```

Add a visible `Watch Mode` label and `Save as Movie` button when `watchMode` is true.

- [x] **Step 7: Run tests and build**

Run:

```bash
npx playwright test -c playwright.web.config.js tests/e2e-web/vault-ui.spec.js
cd web && npm run build
```

Expected: PASS.

- [x] **Step 8: Update notes and commit**

Append:

```html
          <tr>
            <td>2026-06-18</td>
            <td>Design decision</td>
            <td>Watch queues accept images and videos. Images become timed stills, videos advance on playback end.</td>
          </tr>
```

Run:

```bash
git add tests/e2e-web/vault-ui.spec.js web/src/lib/watch-mode.ts web/src/components/vault/VaultPage.tsx web/src/components/vault/VaultGrid.tsx web/src/components/collections/CollectionView.tsx web/src/components/collections/BulkActionBar.tsx web/src/components/video/FullscreenViewer.tsx implementation-notes.html
git commit -m "feat(web): wire vault assets into collections and watch"
```

## Task 10: Movie Maker Image Clips And Vault Source

**Files:**
- Modify: `web/src/components/movie/CanvasPlayer.tsx`
- Modify: `web/src/components/movie/StoryboardPanel.tsx`
- Modify: `web/src/components/movie/ClipSourcePicker.tsx`
- Modify: `tests/e2e-web/vault-ui.spec.js`
- Modify: `implementation-notes.html`

- [x] **Step 1: Add failing mixed movie test**

Append:

```js
test("Movie Maker can persist mixed image and video clips from Vault", async ({ page }) => {
  await resetDb(page);
  await page.goto("/vault");
  await page.getByRole("button", { name: /Preview Vault/i }).click();
  await page.getByRole("button", { name: /Commit Vault/i }).click();
  await page.getByRole("button", { name: /Add to Collection/i }).first().click();
  await page.goto("/");
  await page.getByText("New Collection").click();
  await page.getByRole("button", { name: /Watch All/i }).click();
  await page.getByRole("button", { name: /Save as Movie/i }).click();
  await expect(page).toHaveURL(/\/movie\?id=/);
  await expect(page.getByText(/clip/i)).toBeVisible();
});
```

- [x] **Step 2: Run failing movie test**

Run:

```bash
npx playwright test -c playwright.web.config.js tests/e2e-web/vault-ui.spec.js
```

Expected: FAIL until image clips render correctly.

- [x] **Step 3: Add image clip rendering to CanvasPlayer**

In `web/src/components/movie/CanvasPlayer.tsx`, change `buildTimeline` so images use `stillDuration`:

```tsx
    if (clip.type === "title") {
      clipDuration = clip.titleDuration ?? 3;
    } else if (clip.type === "image") {
      clipDuration = clip.stillDuration ?? 3;
    } else {
      const fullDuration = videoDurations.get(clip.id) ?? 5;
      const start = clip.trimStart ?? 0;
      const end = clip.trimEnd ?? fullDuration;
      clipDuration = end - start;
    }
```

Add an image ref map:

```tsx
  const imageRefs = useRef<Map<string, HTMLImageElement>>(new Map());
```

Create image elements in the clips effect:

```tsx
    for (const clip of clips) {
      if (clip.type !== "image" || !clip.imageUrl || imageRefs.current.has(clip.id)) continue;
      const image = new Image();
      image.crossOrigin = "anonymous";
      image.src = clip.imageUrl;
      imageRefs.current.set(clip.id, image);
    }
```

Draw image clips:

```tsx
      } else if (clip.type === "image") {
        const image = imageRefs.current.get(clip.id);
        if (image && image.complete && image.naturalWidth > 0) {
          const scale = Math.min(w / image.naturalWidth, h / image.naturalHeight);
          const dw = image.naturalWidth * scale;
          const dh = image.naturalHeight * scale;
          ctx.drawImage(image, (w - dw) / 2, (h - dh) / 2, dw, dh);
        }
```

- [x] **Step 4: Update StoryboardPanel labels**

Modify `SortableClipCard` in `web/src/components/movie/StoryboardPanel.tsx`:

```tsx
        {clip.type === "video" ? (
          <Film className="h-3 w-3 flex-shrink-0" />
        ) : clip.type === "image" ? (
          <ImageIcon className="h-3 w-3 flex-shrink-0" />
        ) : (
          <Type className="h-3 w-3 flex-shrink-0" />
        )}
```

Import `ImageIcon` from `lucide-react`.

- [x] **Step 5: Add image clips in ClipSourcePicker**

Modify `web/src/components/movie/ClipSourcePicker.tsx` selected item map:

```tsx
const [selectedItems, setSelectedItems] = useState<Map<string, { videoUrl: string; imageUrl?: string; mediaType?: string; assetId?: string; collectionId: string }>>(new Map());
```

When selecting an item:

```tsx
next.set(item.id, { videoUrl: item.videoUrl, imageUrl: item.imageUrl || item.thumbnailUrl, mediaType: item.mediaType, assetId: item.assetId, collectionId });
```

When building clips:

```tsx
    const clips: MovieClip[] = Array.from(selectedItems.values()).map((item, index) => ({
      id: uuidv4(),
      type: item.mediaType === "image" ? "image" : "video",
      videoUrl: item.mediaType === "image" ? undefined : item.videoUrl,
      imageUrl: item.mediaType === "image" ? item.imageUrl : undefined,
      sourceCollectionId: item.collectionId,
      sourceAssetId: item.assetId,
      stillDuration: item.mediaType === "image" ? 3 : undefined,
      transition: index === 0 ? DEFAULT_TRANSITION : { type: "crossfade", duration: 0.5 },
      position: 0,
    }));
```

- [x] **Step 6: Run tests and build**

Run:

```bash
npx playwright test -c playwright.web.config.js tests/e2e-web/vault-ui.spec.js
cd web && npm run build
```

Expected: PASS.

- [x] **Step 7: Update notes and commit**

Append:

```html
          <tr>
            <td>2026-06-18</td>
            <td>Design decision</td>
            <td>Movie Maker supports still-image clips instead of hiding saved-gallery images from movie workflows.</td>
          </tr>
```

Run:

```bash
git add tests/e2e-web/vault-ui.spec.js web/src/components/movie/CanvasPlayer.tsx web/src/components/movie/StoryboardPanel.tsx web/src/components/movie/ClipSourcePicker.tsx implementation-notes.html
git commit -m "feat(web): support image clips in movie maker"
```

## Task 11: Prompt Merge And Prompt Library

**Files:**
- Create: `web/src/lib/vault-prompts.ts`
- Modify: `web/src/components/prompts/PromptLibrary.tsx`
- Modify: `tests/e2e-web/vault-ui.spec.js`
- Modify: `implementation-notes.html`

- [ ] **Step 1: Add failing prompt test**

Append:

```js
test("Prompt library includes Vault prompts after commit", async ({ page }) => {
  await resetDb(page);
  await page.goto("/vault");
  await page.getByRole("button", { name: /Preview Vault/i }).click();
  await page.getByRole("button", { name: /Commit Vault/i }).click();
  await page.getByRole("button", { name: /Prompts/i }).click();
  await expect(page.getByText(/cinematic neon canyon/i)).toBeVisible();
  await expect(page.getByText(/quiet glass library/i)).toBeVisible();
});
```

- [ ] **Step 2: Run failing prompt test**

Run:

```bash
npx playwright test -c playwright.web.config.js tests/e2e-web/vault-ui.spec.js
```

Expected: FAIL until Prompt Library reads Vault prompts.

- [ ] **Step 3: Add prompt merge helper**

Create `web/src/lib/vault-prompts.ts`:

```ts
import type { SavedPrompt } from "./types";
import { normalizePromptText } from "./vault-types";

export function mergePrompts(localPrompts: SavedPrompt[], vaultPrompts: SavedPrompt[]): SavedPrompt[] {
  const byHash = new Map<string, SavedPrompt>();
  for (const prompt of [...localPrompts, ...vaultPrompts]) {
    const key = normalizePromptText(prompt.text);
    if (!key) continue;
    const existing = byHash.get(key);
    if (!existing || prompt.usageCount > existing.usageCount) {
      byHash.set(key, {
        ...prompt,
        tags: Array.from(new Set([...(existing?.tags || []), ...(prompt.tags || [])])),
        usageCount: Math.max(existing?.usageCount || 0, prompt.usageCount || 0),
      });
    }
  }
  return Array.from(byHash.values()).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}
```

- [ ] **Step 4: Wire PromptLibrary**

Modify `web/src/components/prompts/PromptLibrary.tsx` so it imports:

```tsx
import { getDB, getSavedPrompts } from "@/lib/local-storage";
import { mergePrompts } from "@/lib/vault-prompts";
```

In its load function, after local prompts are loaded, read `vault_prompts`:

```tsx
      const db = await getDB();
      const vaultPrompts = await db.getAll("vault_prompts");
      setPrompts(mergePrompts(localPrompts, vaultPrompts as SavedPrompt[]));
```

Keep existing local add/edit/delete behavior unchanged.

- [ ] **Step 5: Run tests and build**

Run:

```bash
npx playwright test -c playwright.web.config.js tests/e2e-web/vault-ui.spec.js
cd web && npm run build
```

Expected: PASS.

- [ ] **Step 6: Update notes and commit**

Append:

```html
          <tr>
            <td>2026-06-18</td>
            <td>Design decision</td>
            <td>Prompt Library merges local and Vault prompt rows by normalized text, so repeated Vault imports do not duplicate prompt entries.</td>
          </tr>
```

Run:

```bash
git add tests/e2e-web/vault-ui.spec.js web/src/lib/vault-prompts.ts web/src/components/prompts/PromptLibrary.tsx implementation-notes.html
git commit -m "feat(web): merge vault prompts into prompt library"
```

## Task 12: Ops Proof And Gated Gap Fill

**Files:**
- Create: `web/src/components/vault/VaultGapPanel.tsx`
- Create: `web/src/components/vault/VaultOpsSummary.tsx`
- Modify: `web/src/components/ops/OpsConsole.tsx`
- Modify: `tests/e2e-web/vault-ui.spec.js`
- Modify: `implementation-notes.html`

- [ ] **Step 1: Add failing Ops proof test**

Append:

```js
test("Ops shows Vault proof and does not mark Worker health as object proof", async ({ page }) => {
  await resetDb(page);
  await page.goto("/vault");
  await page.getByRole("button", { name: /Preview Vault/i }).click();
  await page.getByRole("button", { name: /Commit Vault/i }).click();
  await page.goto("/ops");
  await expect(page.getByText(/Vault Import/i)).toBeVisible();
  await expect(page.getByText(/2 assets/i)).toBeVisible();
  await expect(page.getByText(/Worker health is not object proof/i)).toBeVisible();
});
```

- [ ] **Step 2: Run failing Ops test**

Run:

```bash
npx playwright test -c playwright.web.config.js tests/e2e-web/vault-ui.spec.js
```

Expected: FAIL until Ops reads Vault state.

- [ ] **Step 3: Add Vault Ops summary**

Create `web/src/components/vault/VaultOpsSummary.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { getDB } from "@/lib/local-storage";
import { getVaultAssets } from "@/lib/vault-storage";

export default function VaultOpsSummary() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    getDB().then(getVaultAssets).then((assets) => setCount(assets.length)).catch(() => setCount(0));
  }, []);

  return (
    <section className="mt-6 rounded-(--radius-card) border border-(--color-surface-200) bg-(--color-surface-0) p-4 dark:border-(--color-surface-800) dark:bg-(--color-surface-900)">
      <h2 className="text-sm font-semibold">Vault Import</h2>
      <p className="mt-2 text-sm text-(--color-surface-500)">{count} assets committed locally.</p>
      <p className="mt-2 text-xs text-(--color-surface-500)">Worker health is not object proof. Vault proof comes from inventory rows and media routes.</p>
    </section>
  );
}
```

Create `web/src/components/vault/VaultGapPanel.tsx`:

```tsx
"use client";

import Button from "@/components/ui/Button";

export default function VaultGapPanel({ gapCount }: { gapCount: number }) {
  return (
    <section className="mt-6 rounded-(--radius-card) border border-(--color-surface-200) bg-(--color-surface-0) p-4 dark:border-(--color-surface-800) dark:bg-(--color-surface-900)">
      <h2 className="text-sm font-semibold">Gap Fill</h2>
      <p className="mt-2 text-sm text-(--color-surface-500)">{gapCount} gaps currently need review.</p>
      <Button variant="secondary" disabled className="mt-3">Gap Fill Requires Approval</Button>
    </section>
  );
}
```

- [ ] **Step 4: Wire OpsConsole**

Modify `web/src/components/ops/OpsConsole.tsx`:

```tsx
import VaultOpsSummary from "@/components/vault/VaultOpsSummary";
import VaultGapPanel from "@/components/vault/VaultGapPanel";
```

Add near the top after Worker cards:

```tsx
      <VaultOpsSummary />
      <VaultGapPanel gapCount={snapshot.rows.filter((row) => row.status !== "verified").length} />
```

- [ ] **Step 5: Run tests and build**

Run:

```bash
npx playwright test -c playwright.web.config.js tests/e2e-web/vault-ui.spec.js
cd web && npm run build
```

Expected: PASS.

- [ ] **Step 6: Update notes and commit**

Append:

```html
          <tr>
            <td>2026-06-18</td>
            <td>Safety</td>
            <td>Ops explicitly says Worker health is not object proof and keeps gap-fill disabled until a later approved live repair run.</td>
          </tr>
```

Run:

```bash
git add tests/e2e-web/vault-ui.spec.js web/src/components/vault/VaultOpsSummary.tsx web/src/components/vault/VaultGapPanel.tsx web/src/components/ops/OpsConsole.tsx implementation-notes.html
git commit -m "feat(web): show vault proof in ops"
```

## Task 13: Overlay Sync Boundary

**Files:**
- Modify: `cloud/schema.sql`
- Modify: `cloud/src/types.ts`
- Modify: `cloud/src/db.ts`
- Modify: `cloud/src/index.ts`
- Modify: `cloud/tests/vault-routes.test.ts`
- Modify: `web/src/lib/sync-engine.ts`
- Modify: `web/src/lib/vault-storage.ts`
- Modify: `implementation-notes.html`

- [ ] **Step 1: Add failing cloud overlay sync test**

Append to `cloud/tests/vault-routes.test.ts`:

```ts
test("sync push accepts vault overlays without source facts", async () => {
    const writes: unknown[] = [];
    const response = await worker.fetch(new Request("https://worker.example/v1/sync/push", {
        method: "POST",
        headers: {
            authorization: "Bearer invalid-test-token",
            "content-type": "application/json",
        },
        body: JSON.stringify({
            vaultOverlays: [
                { assetId: "asset-image-1", data: JSON.stringify({ tags: ["keep"], hidden: false }), updatedAt: "2026-06-18T00:00:00.000Z" },
            ],
        }),
    }), env({
        SYNC_SECRET: "test-secret",
        DB: {
            prepare: () => ({
                bind: (...args: unknown[]) => ({
                    run: async () => { writes.push(args); },
                    all: async () => ({ results: [] }),
                    first: async () => null,
                }),
            }),
        },
    }));

    assert.equal(response.status, 401);
    assert.equal(writes.length, 0);
});
```

This first test proves invalid JWTs fail closed. The execution agent should add a valid JWT case by using the existing `jose` signing pattern from the web sync routes once cloud auth helpers are easy to import in tests.

- [ ] **Step 2: Add D1 table**

Append to `cloud/schema.sql`:

```sql
CREATE TABLE vault_overlays (
  user_id TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  PRIMARY KEY (user_id, asset_id)
);
```

- [ ] **Step 3: Add sync payload types**

Modify `cloud/src/types.ts`:

```ts
export interface SyncPushRequest {
    collections?: Array<{ id: string; data: string; updatedAt: string; deletedAt?: string | null }>;
    movies?: Array<{ id: string; data: string; updatedAt: string; deletedAt?: string | null }>;
    vaultOverlays?: Array<{ assetId: string; data: string; updatedAt: string; deletedAt?: string | null }>;
}
```

Modify `SyncPullResponse`:

```ts
    vaultOverlays?: Array<{
        assetId: string;
        data: string;
        updatedAt: string;
        deletedAt: string | null;
    }>;
```

- [ ] **Step 4: Add D1 overlay helpers**

Add to `cloud/src/db.ts`:

```ts
export async function upsertVaultOverlay(
  db: D1Database,
  record: { userId: string; assetId: string; data: string; updatedAt: string; deletedAt?: string | null }
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO vault_overlays (user_id, asset_id, data, updated_at, deleted_at)
       VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT(user_id, asset_id) DO UPDATE SET
         data = CASE WHEN excluded.updated_at > vault_overlays.updated_at THEN excluded.data ELSE vault_overlays.data END,
         updated_at = CASE WHEN excluded.updated_at > vault_overlays.updated_at THEN excluded.updated_at ELSE vault_overlays.updated_at END,
         deleted_at = CASE WHEN excluded.updated_at > vault_overlays.updated_at THEN excluded.deleted_at ELSE vault_overlays.deleted_at END`
    )
    .bind(record.userId, record.assetId, record.data, record.updatedAt, record.deletedAt ?? null)
    .run();
}

export async function getVaultOverlaysSince(db: D1Database, userId: string, since: string): Promise<Array<{ asset_id: string; data: string; updated_at: string; deleted_at: string | null }>> {
  const result = await db
    .prepare(`SELECT asset_id, data, updated_at, deleted_at FROM vault_overlays WHERE user_id = ?1 AND updated_at > ?2`)
    .bind(userId, since)
    .all<{ asset_id: string; data: string; updated_at: string; deleted_at: string | null }>();
  return result.results;
}
```

- [ ] **Step 5: Wire Worker sync**

Modify imports in `cloud/src/index.ts`:

```ts
import { upsertEntity, getEntitiesSince, ensureUser, upsertR2DedupeIndex, upsertMetadataSnapshotIndex, upsertVaultOverlay, getVaultOverlaysSince } from "./db";
```

Inside `handleSyncPush`, after movies:

```ts
    if (payload.vaultOverlays) {
        for (const overlay of payload.vaultOverlays) {
            await upsertVaultOverlay(env.DB, {
                userId,
                assetId: overlay.assetId,
                data: overlay.data,
                updatedAt: overlay.updatedAt,
                deletedAt: overlay.deletedAt ?? null,
            });
        }
    }
```

Inside `handleSyncPull`:

```ts
    const vaultOverlays = await getVaultOverlaysSince(env.DB, userId, since);
```

Add to response:

```ts
        vaultOverlays: vaultOverlays.map((overlay) => ({
            assetId: overlay.asset_id,
            data: overlay.data,
            updatedAt: overlay.updated_at,
            deletedAt: overlay.deleted_at,
        })),
```

- [ ] **Step 6: Add web overlay sync helpers**

Add to `web/src/lib/vault-storage.ts`:

```ts
export async function getVaultOverlaysIncludingDeleted(db: IDBPDatabase): Promise<VaultOverlay[]> {
  return (await db.getAll("vault_overlays")) as VaultOverlay[];
}

export async function putVaultOverlay(db: IDBPDatabase, overlay: VaultOverlay): Promise<void> {
  await db.put("vault_overlays", overlay);
}
```

Modify `web/src/lib/sync-engine.ts` imports:

```ts
import { getDB } from "./local-storage";
import { getVaultOverlaysIncludingDeleted, putVaultOverlay } from "./vault-storage";
import type { VaultOverlay } from "./vault-types";
```

Extend pull response type and merge overlays:

```ts
      vaultOverlays?: Array<{ assetId: string; data: string; updatedAt: string; deletedAt: string | null }>;
```

After movie merge:

```ts
    if (data.vaultOverlays) {
      const db = await getDB();
      for (const remote of data.vaultOverlays) {
        const overlay = JSON.parse(remote.data) as VaultOverlay;
        await putVaultOverlay(db, { ...overlay, assetId: remote.assetId, updatedAt: remote.updatedAt });
      }
    }
```

Extend push body:

```ts
    const db = await getDB();
    const allVaultOverlays = await getVaultOverlaysIncludingDeleted(db);
    const changedVaultOverlays = allVaultOverlays.filter(
      (overlay) => new Date(overlay.updatedAt).getTime() > sinceDate
    );
```

Add to body:

```ts
      vaultOverlays: changedVaultOverlays.map((overlay) => ({
        assetId: overlay.assetId,
        data: JSON.stringify(overlay),
        updatedAt: overlay.updatedAt,
        deletedAt: null,
      })),
```

- [ ] **Step 7: Run gates**

Run:

```bash
cd cloud && npm run test:acceptance
cd cloud && npm run typecheck
cd web && npm run build
```

Expected: PASS.

- [ ] **Step 8: Update notes and commit**

Append:

```html
          <tr>
            <td>2026-06-18</td>
            <td>Design decision</td>
            <td>D1 sync receives Vault overlays only. Immutable R2 source facts stay sourced from R2 and Worker inventory.</td>
          </tr>
```

Run:

```bash
git add cloud/schema.sql cloud/src/types.ts cloud/src/db.ts cloud/src/index.ts cloud/tests/vault-routes.test.ts web/src/lib/sync-engine.ts web/src/lib/vault-storage.ts implementation-notes.html
git commit -m "feat(sync): add vault overlay sync boundary"
```

## Task 14: Final Gates And Manual Real-Data Check

**Files:**
- Modify: `implementation-notes.html`

- [ ] **Step 1: Run root unit tests**

Run:

```bash
npm run test:unit
```

Expected: PASS.

- [ ] **Step 2: Run root extension E2E tests**

Run:

```bash
npm run test:e2e
```

Expected: PASS. If it fails due an unrelated pre-existing extension fixture issue, record the exact failure in `implementation-notes.html` and do not call the Vault work done until the owner decides whether to fix that blocker in scope.

- [ ] **Step 3: Run root lint**

Run:

```bash
npm run lint
```

Expected: PASS. If generated `cloud/.wrangler/tmp` files break lint, clean generated tmp files or update lint ignores in a separate explicit commit, then rerun.

- [ ] **Step 4: Run web build and lint**

Run:

```bash
cd web && npm run build
cd web && npm run lint
```

Expected: PASS. Verify `npm run dev` still uses webpack dev on port 3001 and build still respects the Next root fix.

- [ ] **Step 5: Run cloud gates**

Run:

```bash
cd cloud && npm run test:acceptance
cd cloud && npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Run web Playwright tests**

Run:

```bash
npx playwright test -c playwright.web.config.js
```

Expected: PASS.

- [ ] **Step 7: Manual local browser check with fake Worker**

Run:

```bash
FAKE_VAULT_WORKER_PORT=43117 FAKE_VAULT_WORKER_API_KEY=client-sample node tests/e2e-web/fixtures/fake-vault-worker.mjs
```

In a second terminal:

```bash
WORKER_URL=http://127.0.0.1:43117 CLIENT_API_KEY=client-sample AUTH_SECRET=local-test-secret npm --prefix web run dev
```

Open `http://localhost:3001/vault` in browser automation and verify:

- Vault preview loads.
- Commit writes local Vault.
- Image and video cards appear.
- Image opens in viewer.
- Video opens in viewer.
- Asset can be added to collection.
- Collection Watch All opens Watch Mode.
- Save as Movie opens Movie Maker.
- Prompt Library shows two Vault prompts.
- Ops shows Vault Import and says Worker health is not object proof.

- [ ] **Step 8: Manual real R2 read-only check**

Before this step, confirm `web/.env.local` has a server-only `WORKER_API_KEY` or `CLIENT_API_KEY` key name. Do not print the value.

Run:

```bash
npm --prefix web run dev
```

Open `http://localhost:3001/vault` and verify:

- Worker identity matches the intended Worker.
- Key prefix is `grok-powertools/v1`.
- Preview returns nonzero inventory or a precise blocker.
- Commit does not mutate R2, D1, extension processed IDs, or live Grok.
- Reload keeps local Vault data.
- Media preview works through `/api/vault/media/:assetId`.

Pause and ask the user before any live Grok gap-fill, R2 write, D1 source-fact write, backfill, retry, full media backup, or processed-ID reset.

- [ ] **Step 9: Record final notes**

Append a verification row to `implementation-notes.html`:

```html
          <tr>
            <td>2026-06-18</td>
            <td>Verification</td>
            <td>Final verification ran root unit, root E2E, root lint, web build, web lint, cloud tests, cloud typecheck, web Playwright, fake Worker manual smoke, and read-only real R2 preview. Any blocker is recorded with exact command and failure text.</td>
          </tr>
```

- [ ] **Step 10: Commit final notes**

Run:

```bash
git add implementation-notes.html
git commit -m "docs: record vault web app verification"
```

Skip this commit only if `implementation-notes.html` did not change after the previous task.

## Self-Review Checklist

Spec coverage:

- R2 source of truth: Tasks 2, 3, 5, 7, 14.
- Worker identity and secret redaction: Tasks 1, 2, 3, 5, 12.
- Local owner mode unsigned: Tasks 6, 7, 14.
- IndexedDB migration and local commit: Tasks 4, 7.
- Images and videos: Tasks 4, 7, 8, 10.
- Collections, watch, and movies: Tasks 9, 10.
- Prompts: Task 11.
- Ops proof and Worker health boundary: Task 12.
- Overlay sync boundary: Task 13.
- Gap-fill gated: Tasks 5, 12, 14.
- No production write during read-only load: Tasks 3, 5, 12, 14.

Placeholder scan:

- No placeholder markers or vague filler instructions should remain in this file.
- All tasks include exact files, commands, expected results, and commit commands.

Type consistency:

- `VaultAsset`, `VaultOverlay`, `VaultImportRun`, `VaultGap`, `VaultPreview`, `VideoItem`, and `MovieClip` names are used consistently.
- `assetId`, `mediaType`, `imageUrl`, `videoUrl`, `sourceAssetId`, and `stillDuration` are the shared property names across storage, collections, viewer, and Movie Maker.

Stop conditions:

- Stop if server-side Worker API key is missing.
- Stop if Worker identity points at an unexpected target.
- Stop before copying secrets out of the extension popup.
- Stop before any production R2 or D1 mutation.
- Stop before live Grok repair unless the user approves the exact plan.
