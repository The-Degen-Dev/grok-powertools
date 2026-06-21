# Vault Repair Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first safe Vault Repair Workbench slice: read-only repair scan, T1 index-drift planning, approval binding, local repair history, and fail-closed run behavior.

**Architecture:** The web app owns the operator UI, local IndexedDB repair records, plan review, and approval state. Next API routes proxy read-only Worker proof and create deterministic plans, while write-capable routes remain blocked until a separately approved repair route exists. Cloud Worker changes in this plan are limited to read-only proof regression coverage.

**Tech Stack:** Next.js App Router, React client components, IndexedDB via `idb`, Playwright web tests, Cloudflare Worker TypeScript acceptance tests.

---

## Scope Check

The brainstorming spec covers T0 through T4 repair tiers. This plan intentionally builds the smallest safe vertical slice:

- Included: T0 scan, T1 D1/index drift classification, deterministic planning, approval binding, local repair ledger, UI review flow, and fail-closed run route.
- Included as blocked evidence: live-Grok-required and media-restore issues can be displayed, but they cannot run.
- Excluded from this plan: T2 metadata writes, T3 canonicalization writes, T4 direct R2 media restore, processed-ID changes, backfill, retry-unsynced, live Grok automation, and production R2/D1 mutation routes.

Execution must start from the current dirty worktree without reverting unrelated files. Stage only files touched by the active task.

## File Structure

- Create `web/src/lib/vault-repair-types.ts`: repair enums, data types, canonical JSON, deterministic plan hash, request/response parsers.
- Create `web/src/lib/vault-preview-server.ts`: shared server-side Vault preview loader extracted from the existing preview route.
- Create `web/src/lib/vault-repair-classifier.ts`: converts preview, gaps, warnings, and identity scope into `RepairIssue` records.
- Create `web/src/app/api/vault/repair/scan/route.ts`: read-only scan endpoint.
- Create `web/src/app/api/vault/repair/plan/route.ts`: deterministic plan endpoint.
- Create `web/src/app/api/vault/repair/approve/route.ts`: approval binding endpoint.
- Create `web/src/app/api/vault/repair/run/route.ts`: fail-closed write route.
- Create `web/src/app/api/vault/repair/proof/route.ts`: read-only object proof proxy using Worker `HEAD /v1/objects/verify`.
- Modify `web/src/app/api/vault/preview/route.ts`: call `loadVaultPreviewFromWorker()`.
- Modify `web/src/lib/vault-client.ts`: add repair client helpers.
- Modify `web/src/lib/local-storage.ts`: bump IndexedDB version from 4 to 5.
- Modify `web/src/lib/vault-storage.ts`: add repair stores and persistence helpers.
- Create `web/src/components/vault/VaultRepairWorkbench.tsx`: repair UI panel, issue inventory, plan builder, approval gate, run history.
- Modify `web/src/components/vault/VaultPage.tsx`: mount `VaultRepairWorkbench`.
- Modify `tests/e2e-web/fixtures/fake-vault-worker.mjs`: add repair fixture gaps, request logging, and Worker HEAD proof response.
- Create `tests/e2e-web/vault-repair-api.spec.js`: API tests for scan, plan, approval, fail-closed run, and read-only proof.
- Create `tests/e2e-web/vault-repair-ui.spec.js`: UI tests for scan, planning, approval, blocked run, and local history.
- Modify `cloud/tests/vault-routes.test.ts`: add no-write regression for Worker `HEAD /v1/objects/verify`.

### Task 1: Repair Types And Deterministic Plan Hash

**Files:**
- Create: `web/src/lib/vault-repair-types.ts`
- Create: `web/src/app/api/vault/repair/plan/route.ts`
- Create: `tests/e2e-web/vault-repair-api.spec.js`

- [x] **Step 1: Write the failing plan API test**

Add this file:

```js
const { test, expect } = require("@playwright/test");

const fakeWorkerUrl = "http://127.0.0.1:43117";

const identityScope = {
  workerHost: "127.0.0.1",
  keyPrefix: "grok-powertools/v1",
  bucketName: "fake-vault-bucket",
  apiKeyFingerprint: "fp_client_sample",
};

const indexDriftIssue = {
  issueId: "repair-gap-index-drift-asset-image-1",
  assetId: "asset-image-1",
  issueType: "index_drift",
  riskTier: "T1",
  sourceProof: [
    {
      kind: "d1_index",
      label: "Worker gap gap-index-drift-asset-image-1",
      objectKey: "grok-powertools/v1/users/greymaker/media/by-asset/asset-image-1.png",
      observedAt: "2026-06-20T00:00:00.000Z",
    },
  ],
  writeClass: "d1_index",
};

test("repair plan API produces deterministic hash and exact write impact", async ({ request }) => {
  const first = await request.post("/api/vault/repair/plan", {
    data: { identityScope, issues: [indexDriftIssue], selectedIssueIds: [indexDriftIssue.issueId] },
  });
  expect(first.ok()).toBe(true);
  const firstBody = await first.json();

  const second = await request.post("/api/vault/repair/plan", {
    data: { selectedIssueIds: [indexDriftIssue.issueId], issues: [indexDriftIssue], identityScope },
  });
  expect(second.ok()).toBe(true);
  const secondBody = await second.json();

  expect(firstBody.plan.planHash).toBe(secondBody.plan.planHash);
  expect(firstBody.plan.targetCount).toBe(1);
  expect(firstBody.plan.writeClasses).toEqual(["d1_index"]);
  expect(firstBody.plan.riskTierMax).toBe("T1");
  expect(firstBody.plan.objectKeys).toEqual([
    "grok-powertools/v1/users/greymaker/media/by-asset/asset-image-1.png",
  ]);
  expect(firstBody.plan.actions).toHaveLength(1);
  expect(firstBody.plan.actions[0]).toMatchObject({
    actionId: "action-repair-gap-index-drift-asset-image-1",
    writeClass: "d1_index",
    target: "asset-image-1",
    idempotencyKey: expect.stringContaining(firstBody.plan.planHash),
  });
  expect(JSON.stringify(firstBody)).not.toContain("client-sample");
});
```

- [x] **Step 2: Run the failing test**

Run:

```bash
npx playwright test -c playwright.web.config.js tests/e2e-web/vault-repair-api.spec.js -g "repair plan API produces deterministic hash"
```

Expected: FAIL with a 404 for `/api/vault/repair/plan`.

- [x] **Step 3: Add repair types and stable hash helpers**

Create `web/src/lib/vault-repair-types.ts`:

```ts
export type RepairRiskTier = "T0" | "T1" | "T2" | "T3" | "T4";
export type RepairIssueType =
  | "index_drift"
  | "metadata_drift"
  | "duplicate_canonical_mismatch"
  | "missing_media_object"
  | "corrupt_media_object"
  | "live_grok_required"
  | "scan_warning";
export type RepairWriteClass = "none" | "d1_index" | "r2_metadata" | "r2_media" | "live_grok_runbook";
export type SourceProofKind =
  | "r2_object"
  | "d1_index"
  | "metadata_snapshot"
  | "local_verified_object"
  | "live_grok_existing_chrome"
  | "worker_gap"
  | "scan_warning";

export interface SourceProof {
  kind: SourceProofKind;
  label: string;
  objectKey?: string;
  contentSha256?: string;
  sizeBytes?: number;
  observedAt: string;
}

export interface RepairIssue {
  issueId: string;
  assetId?: string;
  issueType: RepairIssueType;
  riskTier: RepairRiskTier;
  sourceProof: SourceProof[];
  writeClass: RepairWriteClass;
  blockedReason?: string;
}

export interface RepairAction {
  actionId: string;
  idempotencyKey: string;
  writeClass: RepairWriteClass;
  target: string;
  expectedProof: SourceProof[];
}

export interface RepairIdentityScope {
  workerHost: string;
  keyPrefix: string;
  bucketName?: string;
  apiKeyFingerprint?: string;
}

export interface RepairPlan {
  planId: string;
  issueIds: string[];
  targetCount: number;
  objectKeys: string[];
  writeClasses: RepairWriteClass[];
  riskTierMax: RepairRiskTier;
  actions: RepairAction[];
  planHash: string;
  createdAt: string;
  identityScope: RepairIdentityScope;
}

const riskTierRank: Record<RepairRiskTier, number> = { T0: 0, T1: 1, T2: 2, T3: 3, T4: 4 };

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim() !== "") : [];
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!isRecord(value)) return value;
  return Object.keys(value)
    .sort()
    .reduce<Record<string, unknown>>((acc, key) => {
      acc[key] = sortJson(value[key]);
      return acc;
    }, {});
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function parseRepairIssue(input: unknown): RepairIssue {
  if (!isRecord(input)) throw new Error("repair issue must be an object");
  const issueId = stringValue(input.issueId);
  const issueType = stringValue(input.issueType) as RepairIssueType;
  const riskTier = stringValue(input.riskTier) as RepairRiskTier;
  const writeClass = stringValue(input.writeClass) as RepairWriteClass;
  if (!issueId) throw new Error("repair issue must include issueId");
  if (!["index_drift", "metadata_drift", "duplicate_canonical_mismatch", "missing_media_object", "corrupt_media_object", "live_grok_required", "scan_warning"].includes(issueType)) {
    throw new Error(`unsupported repair issue type: ${issueType}`);
  }
  if (!["T0", "T1", "T2", "T3", "T4"].includes(riskTier)) throw new Error(`unsupported repair tier: ${riskTier}`);
  if (!["none", "d1_index", "r2_metadata", "r2_media", "live_grok_runbook"].includes(writeClass)) {
    throw new Error(`unsupported repair write class: ${writeClass}`);
  }
  const sourceProof = Array.isArray(input.sourceProof)
    ? input.sourceProof.map((proof, index): SourceProof => {
        if (!isRecord(proof)) throw new Error(`sourceProof[${index}] must be an object`);
        const kind = stringValue(proof.kind) as SourceProofKind;
        const label = stringValue(proof.label);
        const observedAt = stringValue(proof.observedAt);
        if (!kind || !label || !observedAt) throw new Error(`sourceProof[${index}] is missing kind, label, or observedAt`);
        return {
          kind,
          label,
          objectKey: stringValue(proof.objectKey) || undefined,
          contentSha256: stringValue(proof.contentSha256) || undefined,
          sizeBytes: typeof proof.sizeBytes === "number" ? proof.sizeBytes : undefined,
          observedAt,
        };
      })
    : [];
  return {
    issueId,
    assetId: stringValue(input.assetId) || undefined,
    issueType,
    riskTier,
    sourceProof,
    writeClass,
    blockedReason: stringValue(input.blockedReason) || undefined,
  };
}

export function parseRepairIdentityScope(input: unknown): RepairIdentityScope {
  if (!isRecord(input)) throw new Error("identityScope must be an object");
  const workerHost = stringValue(input.workerHost);
  const keyPrefix = stringValue(input.keyPrefix);
  if (!workerHost || !keyPrefix) throw new Error("identityScope requires workerHost and keyPrefix");
  return {
    workerHost,
    keyPrefix,
    bucketName: stringValue(input.bucketName) || undefined,
    apiKeyFingerprint: stringValue(input.apiKeyFingerprint) || undefined,
  };
}

function maxRiskTier(issues: RepairIssue[]): RepairRiskTier {
  return issues.reduce<RepairRiskTier>((max, issue) => (riskTierRank[issue.riskTier] > riskTierRank[max] ? issue.riskTier : max), "T0");
}

function planObjectKeys(issues: RepairIssue[]): string[] {
  return [...new Set(issues.flatMap((issue) => issue.sourceProof.map((proof) => proof.objectKey).filter((key): key is string => !!key)))].sort();
}

function planWriteClasses(issues: RepairIssue[]): RepairWriteClass[] {
  return [...new Set(issues.map((issue) => issue.writeClass))].sort();
}

export async function buildRepairPlan(params: {
  identityScope: RepairIdentityScope;
  issues: RepairIssue[];
  selectedIssueIds: string[];
  createdAt?: string;
}): Promise<RepairPlan> {
  const selected = new Set(params.selectedIssueIds);
  const issues = params.issues
    .filter((issue) => selected.has(issue.issueId))
    .sort((a, b) => a.issueId.localeCompare(b.issueId));
  if (issues.length === 0) throw new Error("REPAIR_PLAN_EMPTY");

  const objectKeys = planObjectKeys(issues);
  const writeClasses = planWriteClasses(issues);
  const hashInput = {
    identityScope: params.identityScope,
    issueIds: issues.map((issue) => issue.issueId),
    objectKeys,
    writeClasses,
    riskTierMax: maxRiskTier(issues),
    actions: issues.map((issue) => ({
      actionId: `action-${issue.issueId}`,
      writeClass: issue.writeClass,
      target: issue.assetId || issue.issueId,
      expectedProof: issue.sourceProof,
    })),
  };
  const planHash = await sha256Hex(canonicalJson(hashInput));
  const actions = issues.map((issue): RepairAction => ({
    actionId: `action-${issue.issueId}`,
    idempotencyKey: `${planHash}:${issue.issueId}`,
    writeClass: issue.writeClass,
    target: issue.assetId || issue.issueId,
    expectedProof: issue.sourceProof,
  }));

  return {
    planId: `repair-plan-${planHash.slice(0, 16)}`,
    issueIds: issues.map((issue) => issue.issueId),
    targetCount: issues.length,
    objectKeys,
    writeClasses,
    riskTierMax: maxRiskTier(issues),
    actions,
    planHash,
    createdAt: params.createdAt || new Date().toISOString(),
    identityScope: params.identityScope,
  };
}

export function parseRepairPlanRequest(input: unknown): {
  identityScope: RepairIdentityScope;
  issues: RepairIssue[];
  selectedIssueIds: string[];
} {
  if (!isRecord(input)) throw new Error("request body must be an object");
  const identityScope = parseRepairIdentityScope(input.identityScope);
  const issues = Array.isArray(input.issues) ? input.issues.map(parseRepairIssue) : [];
  const selectedIssueIds = stringArray(input.selectedIssueIds);
  return { identityScope, issues, selectedIssueIds };
}
```

- [x] **Step 4: Add the plan API route**

Create `web/src/app/api/vault/repair/plan/route.ts`:

```ts
import { NextResponse } from "next/server";
import { buildRepairPlan, parseRepairPlanRequest } from "@/lib/vault-repair-types";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = parseRepairPlanRequest(body);
    const plan = await buildRepairPlan(parsed);
    return NextResponse.json({ ok: true, plan });
  } catch (error) {
    const message = error instanceof Error ? error.message : "REPAIR_PLAN_INVALID";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
```

- [x] **Step 5: Run the focused test**

Run:

```bash
npx playwright test -c playwright.web.config.js tests/e2e-web/vault-repair-api.spec.js -g "repair plan API produces deterministic hash"
```

Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add web/src/lib/vault-repair-types.ts web/src/app/api/vault/repair/plan/route.ts tests/e2e-web/vault-repair-api.spec.js
git commit -m "feat: add vault repair plan hashing"
```

### Task 2: Shared Preview Loader And Read-Only Repair Scan

**Files:**
- Create: `web/src/lib/vault-preview-server.ts`
- Create: `web/src/lib/vault-repair-classifier.ts`
- Create: `web/src/app/api/vault/repair/scan/route.ts`
- Modify: `web/src/app/api/vault/preview/route.ts`
- Modify: `tests/e2e-web/fixtures/fake-vault-worker.mjs`
- Modify: `tests/e2e-web/vault-repair-api.spec.js`

- [x] **Step 1: Add the failing scan tests**

Append to `tests/e2e-web/vault-repair-api.spec.js`:

```js
test("repair scan is read-only and classifies index drift and runbook-only issues", async ({ request }) => {
  await request.get(`${fakeWorkerUrl}/__fake-worker/debug/requests`);
  const res = await request.post("/api/vault/repair/scan");
  expect(res.ok()).toBe(true);
  const body = await res.json();

  expect(body.ok).toBe(true);
  expect(body.scan.identityScope).toMatchObject({
    workerHost: "127.0.0.1",
    keyPrefix: "grok-powertools/v1",
    bucketName: "fake-vault-bucket",
    apiKeyFingerprint: "fp_client_sample",
  });
  expect(body.scan.issues).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        issueId: "repair-gap-index-drift-asset-image-1",
        issueType: "index_drift",
        riskTier: "T1",
        writeClass: "d1_index",
      }),
      expect.objectContaining({
        issueId: "repair-gap-live-grok-asset-missing",
        issueType: "live_grok_required",
        riskTier: "T4",
        writeClass: "live_grok_runbook",
        blockedReason: "LIVE_GROK_RUNBOOK_ONLY",
      }),
    ]),
  );
  expect(body.scan.summary).toMatchObject({
    totalIssues: 3,
    writableIssues: 1,
    blockedIssues: 1,
  });

  const log = await (await request.get(`${fakeWorkerUrl}/__fake-worker/debug/requests`)).json();
  const mutatingWorkerCalls = log.requests.filter((entry) => entry.method !== "GET" && entry.method !== "HEAD");
  expect(mutatingWorkerCalls).toEqual([]);
});
```

- [x] **Step 2: Run the failing scan test**

Run:

```bash
npx playwright test -c playwright.web.config.js tests/e2e-web/vault-repair-api.spec.js -g "repair scan is read-only"
```

Expected: FAIL because `/api/vault/repair/scan` and `/__fake-worker/debug/requests` do not exist.

- [x] **Step 3: Add fake Worker repair fixtures and request logging**

Modify `tests/e2e-web/fixtures/fake-vault-worker.mjs`:

```js
const requestLog = [];

function logRequest(req, url) {
  if (!url.pathname.startsWith("/__fake-worker")) {
    requestLog.push({ method: req.method, pathname: url.pathname, search: url.search });
  }
}
```

Call `logRequest(req, url);` immediately after `const url = new URL(...)`.

Add this before auth-protected routes return:

```js
  if (url.pathname === "/__fake-worker/debug/requests") {
    const requests = [...requestLog];
    requestLog.length = 0;
    return sendJson(res, 200, { ok: true, requests });
  }
```

Replace the `/v1/vault/gaps` response with:

```js
  if (url.pathname === "/v1/vault/gaps") {
    return sendJson(res, 200, {
      ok: true,
      gaps: [
        {
          id: "gap-index-drift-asset-image-1",
          assetId: "asset-image-1",
          code: "index-drift",
          severity: "warning",
          evidence: "D1 index is missing duplicate object proof for asset-image-1",
          recommendedAction: "Review and approve D1 index repair from existing object proof.",
          requiresLiveGrok: false,
          requiresCloudWrite: true,
          objectKey: "grok-powertools/v1/users/greymaker/media/by-asset/asset-image-1.png",
        },
        {
          id: "gap-live-grok-asset-missing",
          assetId: "asset-missing-1",
          code: "live-grok-required",
          severity: "blocking",
          evidence: "Stored proof points to a Grok saved item that is not present in R2.",
          recommendedAction: "Use the existing logged-in Chrome session to inspect Grok Saved.",
          requiresLiveGrok: true,
          requiresCloudWrite: false,
        },
      ],
    });
  }
```

- [x] **Step 4: Extract the shared preview loader**

Create `web/src/lib/vault-preview-server.ts`:

```ts
import { getWorkerHost, workerJson } from "@/lib/vault-server";
import {
  parseVaultCounts,
  parseVaultGaps,
  parseVaultInventory,
  parseVaultPrompts,
  parseVaultWorkerIdentity,
  type VaultAsset,
  type VaultPreview,
  type VaultPrompt,
} from "@/lib/vault-types";

const INVENTORY_PAGE_LIMIT = 1000;
const MAX_INVENTORY_PAGES = 100;

function promptKey(prompt: VaultPrompt): string {
  return prompt.id || prompt.text;
}

function dedupePrompts(prompts: VaultPrompt[]): VaultPrompt[] {
  const seen = new Set<string>();
  return prompts.filter((prompt) => {
    const key = promptKey(prompt);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function dedupeAssets(assets: VaultAsset[]): VaultAsset[] {
  const byAssetId = new Map<string, VaultAsset>();
  for (const asset of assets) {
    const current = byAssetId.get(asset.assetId);
    if (!current) {
      byAssetId.set(asset.assetId, asset);
      continue;
    }
    const legacyObjectKeys = new Set(current.legacyObjectKeys);
    if (asset.canonicalObjectKey && asset.canonicalObjectKey !== current.canonicalObjectKey) {
      legacyObjectKeys.add(asset.canonicalObjectKey);
    }
    for (const objectKey of asset.legacyObjectKeys) {
      if (objectKey !== current.canonicalObjectKey) legacyObjectKeys.add(objectKey);
    }
    byAssetId.set(asset.assetId, {
      ...current,
      legacyObjectKeys: [...legacyObjectKeys],
      lastSeenAt: asset.lastSeenAt || current.lastSeenAt,
      updatedAt: asset.updatedAt || current.updatedAt,
    });
  }
  return [...byAssetId.values()];
}

async function fetchAllInventoryPages(): Promise<{ assets: VaultAsset[]; warnings: string[]; truncated: boolean }> {
  const assets: VaultAsset[] = [];
  const warnings: string[] = [];
  let cursor: string | null = null;

  for (let page = 0; page < MAX_INVENTORY_PAGES; page += 1) {
    const search = new URLSearchParams({ limit: String(INVENTORY_PAGE_LIMIT) });
    if (cursor) search.set("cursor", cursor);
    const inventory = await workerJson<unknown>(`/v1/vault/inventory?${search.toString()}`);
    const parsed = parseVaultInventory(inventory);
    assets.push(...parsed.value.assets);
    warnings.push(...parsed.warnings.map((warning) => `inventory page ${page + 1}: ${warning}`));
    cursor =
      typeof inventory === "object" &&
      inventory !== null &&
      "nextCursor" in inventory &&
      typeof inventory.nextCursor === "string" &&
      inventory.nextCursor.trim() !== ""
        ? inventory.nextCursor
        : null;
    if (!cursor) return { assets: dedupeAssets(assets), warnings, truncated: false };
  }

  warnings.push(`inventory pagination stopped after ${MAX_INVENTORY_PAGES} pages`);
  return { assets: dedupeAssets(assets), warnings, truncated: true };
}

export async function loadVaultPreviewFromWorker(): Promise<VaultPreview & { scanTruncated: boolean }> {
  const [identity, inventory, savedPrompts, promptHistory, gaps] = await Promise.all([
    workerJson<unknown>("/v1/vault/identity"),
    fetchAllInventoryPages(),
    workerJson<unknown>("/v1/vault/metadata/savedPrompts"),
    workerJson<unknown>("/v1/vault/metadata/promptHistory"),
    workerJson<unknown>("/v1/vault/gaps"),
  ]);

  const parsedIdentity = parseVaultWorkerIdentity({
    ...(typeof identity === "object" && identity !== null ? identity : {}),
    workerHost:
      typeof identity === "object" &&
      identity !== null &&
      "workerHost" in identity &&
      typeof identity.workerHost === "string"
        ? identity.workerHost
        : getWorkerHost(),
  });
  const parsedSavedPrompts = parseVaultPrompts(savedPrompts);
  const parsedPromptHistory = parseVaultPrompts(promptHistory, "metadata.prompts");
  const parsedGaps = parseVaultGaps(gaps);
  const prompts = dedupePrompts([...parsedSavedPrompts.value, ...parsedPromptHistory.value]);
  const warnings = [
    ...inventory.warnings,
    ...parsedSavedPrompts.warnings,
    ...parsedPromptHistory.warnings,
    ...parsedGaps.warnings,
  ];

  return {
    ok: true,
    identity: parsedIdentity,
    assets: inventory.assets,
    prompts,
    gaps: parsedGaps.value,
    counts: parseVaultCounts({}, inventory.assets, prompts.length),
    warnings,
    scanTruncated: inventory.truncated,
  };
}
```

Replace `web/src/app/api/vault/preview/route.ts` with:

```ts
import { NextResponse } from "next/server";
import { loadVaultPreviewFromWorker } from "@/lib/vault-preview-server";

export async function GET() {
  return NextResponse.json(await loadVaultPreviewFromWorker());
}
```

- [x] **Step 5: Add the repair classifier**

Create `web/src/lib/vault-repair-classifier.ts`:

```ts
import type { VaultGap, VaultPreview, VaultWorkerIdentity } from "@/lib/vault-types";
import type { RepairIdentityScope, RepairIssue, SourceProof } from "@/lib/vault-repair-types";

function observedAt(): string {
  return new Date().toISOString();
}

function objectKeyFromGap(gap: VaultGap & { objectKey?: string }): string | undefined {
  return typeof gap.objectKey === "string" && gap.objectKey.trim() ? gap.objectKey : undefined;
}

function gapProof(gap: VaultGap & { objectKey?: string }): SourceProof {
  return {
    kind: "worker_gap",
    label: `Worker gap ${gap.id}: ${gap.evidence}`,
    objectKey: objectKeyFromGap(gap),
    observedAt: observedAt(),
  };
}

function classifyGap(gap: VaultGap & { objectKey?: string }): RepairIssue {
  if (gap.requiresLiveGrok) {
    return {
      issueId: `repair-${gap.id}`,
      assetId: gap.assetId,
      issueType: "live_grok_required",
      riskTier: "T4",
      sourceProof: [gapProof(gap)],
      writeClass: "live_grok_runbook",
      blockedReason: "LIVE_GROK_RUNBOOK_ONLY",
    };
  }

  if (gap.requiresCloudWrite || gap.code === "index-drift") {
    return {
      issueId: `repair-${gap.id}`,
      assetId: gap.assetId,
      issueType: "index_drift",
      riskTier: "T1",
      sourceProof: [gapProof(gap)],
      writeClass: "d1_index",
    };
  }

  return {
    issueId: `repair-${gap.id}`,
    assetId: gap.assetId,
    issueType: "scan_warning",
    riskTier: "T0",
    sourceProof: [gapProof(gap)],
    writeClass: "none",
  };
}

function warningIssue(warning: string, index: number): RepairIssue {
  return {
    issueId: `repair-scan-warning-${index + 1}`,
    issueType: "scan_warning",
    riskTier: "T0",
    sourceProof: [
      {
        kind: "scan_warning",
        label: warning,
        observedAt: observedAt(),
      },
    ],
    writeClass: "none",
  };
}

export function identityScopeFromWorker(identity: VaultWorkerIdentity): RepairIdentityScope {
  return {
    workerHost: identity.workerHost,
    keyPrefix: identity.keyPrefix,
    bucketName: identity.r2?.bucketName,
    apiKeyFingerprint: identity.apiKeyFingerprint,
  };
}

export function classifyVaultRepairScan(preview: VaultPreview & { scanTruncated?: boolean }) {
  const gapIssues = preview.gaps.map((gap) => classifyGap(gap));
  const warningIssues = preview.warnings.map(warningIssue);
  const issues = preview.scanTruncated
    ? [
        ...gapIssues,
        ...warningIssues,
        {
          issueId: "repair-scan-truncated",
          issueType: "scan_warning",
          riskTier: "T0",
          sourceProof: [
            {
              kind: "scan_warning",
              label: "Inventory pagination did not complete. Planning is blocked until a full scan completes.",
              observedAt: observedAt(),
            },
          ],
          writeClass: "none",
          blockedReason: "REPAIR_SCAN_TRUNCATED",
        } satisfies RepairIssue,
      ]
    : [...gapIssues, ...warningIssues];

  return {
    identityScope: identityScopeFromWorker(preview.identity),
    issues,
    summary: {
      totalIssues: issues.length,
      writableIssues: issues.filter((issue) => issue.writeClass !== "none" && !issue.blockedReason).length,
      blockedIssues: issues.filter((issue) => !!issue.blockedReason).length,
      readOnlyIssues: issues.filter((issue) => issue.writeClass === "none").length,
    },
  };
}
```

- [x] **Step 6: Add the scan route**

Create `web/src/app/api/vault/repair/scan/route.ts`:

```ts
import { NextResponse } from "next/server";
import { loadVaultPreviewFromWorker } from "@/lib/vault-preview-server";
import { classifyVaultRepairScan } from "@/lib/vault-repair-classifier";

export async function POST() {
  const preview = await loadVaultPreviewFromWorker();
  return NextResponse.json({
    ok: true,
    scan: {
      scannedAt: new Date().toISOString(),
      ...classifyVaultRepairScan(preview),
    },
  });
}
```

- [x] **Step 7: Run preview and scan tests**

Run:

```bash
npx playwright test -c playwright.web.config.js tests/e2e-web/vault-api.spec.js tests/e2e-web/vault-repair-api.spec.js
```

Expected: PASS.

- [x] **Step 8: Commit**

```bash
git add web/src/lib/vault-preview-server.ts web/src/lib/vault-repair-classifier.ts web/src/app/api/vault/preview/route.ts web/src/app/api/vault/repair/scan/route.ts tests/e2e-web/fixtures/fake-vault-worker.mjs tests/e2e-web/vault-repair-api.spec.js
git commit -m "feat: add read-only vault repair scan"
```

### Task 3: Local Repair History Stores

**Files:**
- Modify: `web/src/lib/local-storage.ts`
- Modify: `web/src/lib/vault-storage.ts`
- Modify: `tests/e2e-web/vault-repair-ui.spec.js`

- [x] **Step 1: Write the failing IndexedDB history test**

Create `tests/e2e-web/vault-repair-ui.spec.js`:

```js
const { test, expect } = require("@playwright/test");

async function resetDb(page) {
  await page.goto("/vault");
  await page.waitForFunction(async () => {
    const databases = await indexedDB.databases();
    const db = databases.find((entry) => entry.name === "grok-power-tools");
    return Number(db?.version || 0) >= 5;
  });
  await page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("grok-power-tools");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    const stores = [
      "vault_repair_scans",
      "vault_repair_issues",
      "vault_repair_plans",
      "vault_repair_runs",
      "vault_repair_events",
    ].filter((name) => db.objectStoreNames.contains(name));
    if (stores.length > 0) {
      const tx = db.transaction(stores, "readwrite");
      stores.forEach((name) => tx.objectStore(name).clear());
      await new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    }
    db.close();
  });
}

test("Vault repair stores exist after IndexedDB upgrade", async ({ page }) => {
  await resetDb(page);
  const stores = await page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("grok-power-tools");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    const names = Array.from(db.objectStoreNames).sort();
    db.close();
    return names;
  });
  expect(stores).toEqual(expect.arrayContaining([
    "vault_repair_scans",
    "vault_repair_issues",
    "vault_repair_plans",
    "vault_repair_runs",
    "vault_repair_events",
  ]));
});
```

- [x] **Step 2: Run the failing store test**

Run:

```bash
npx playwright test -c playwright.web.config.js tests/e2e-web/vault-repair-ui.spec.js -g "repair stores exist"
```

Expected: FAIL because the database remains version 4 and repair stores are absent.

- [x] **Step 3: Add repair stores**

Modify `web/src/lib/vault-storage.ts`:

```ts
import type { RepairIssue, RepairPlan } from "./vault-repair-types";
```

Replace `VAULT_STORE_NAMES` with:

```ts
export const VAULT_STORE_NAMES = [
  "vault_assets",
  "vault_overlays",
  "vault_import_runs",
  "vault_gaps",
  "vault_prompts",
  "vault_media_tokens",
  "vault_repair_scans",
  "vault_repair_issues",
  "vault_repair_plans",
  "vault_repair_runs",
  "vault_repair_events",
] as const;
```

Append to `upgradeVaultStores`:

```ts
  if (!db.objectStoreNames.contains("vault_repair_scans")) {
    const store = db.createObjectStore("vault_repair_scans", { keyPath: "scanId" });
    store.createIndex("by-scanned", "scannedAt");
  }
  if (!db.objectStoreNames.contains("vault_repair_issues")) {
    const store = db.createObjectStore("vault_repair_issues", { keyPath: "issueId" });
    store.createIndex("by-tier", "riskTier");
    store.createIndex("by-write-class", "writeClass");
  }
  if (!db.objectStoreNames.contains("vault_repair_plans")) {
    const store = db.createObjectStore("vault_repair_plans", { keyPath: "planId" });
    store.createIndex("by-created", "createdAt");
    store.createIndex("by-hash", "planHash");
  }
  if (!db.objectStoreNames.contains("vault_repair_runs")) {
    const store = db.createObjectStore("vault_repair_runs", { keyPath: "runId" });
    store.createIndex("by-plan", "planId");
    store.createIndex("by-status", "status");
  }
  if (!db.objectStoreNames.contains("vault_repair_events")) {
    const store = db.createObjectStore("vault_repair_events", { keyPath: "eventId" });
    store.createIndex("by-run", "runId");
    store.createIndex("by-created", "createdAt");
  }
```

Append these helper types and functions to `web/src/lib/vault-storage.ts`:

```ts
export interface VaultRepairScanRecord {
  scanId: string;
  scannedAt: string;
  identityScope: Record<string, unknown>;
  summary: {
    totalIssues: number;
    writableIssues: number;
    blockedIssues: number;
    readOnlyIssues: number;
  };
}

export interface VaultRepairRunRecord {
  runId: string;
  planId: string;
  planHash: string;
  status: "approved" | "blocked" | "succeeded" | "failed";
  createdAt: string;
  error?: string;
}

export interface VaultRepairEventRecord {
  eventId: string;
  runId?: string;
  eventType: "scan" | "plan" | "approval" | "run_blocked" | "verify";
  createdAt: string;
  message: string;
}

export async function putVaultRepairScan(
  db: IDBPDatabase,
  scan: VaultRepairScanRecord,
  issues: RepairIssue[],
): Promise<void> {
  const tx = db.transaction(["vault_repair_scans", "vault_repair_issues", "vault_repair_events"], "readwrite");
  await tx.objectStore("vault_repair_scans").put(scan);
  for (const issue of issues) {
    await tx.objectStore("vault_repair_issues").put(issue);
  }
  await tx.objectStore("vault_repair_events").put({
    eventId: `repair-event-scan-${scan.scanId}`,
    eventType: "scan",
    createdAt: scan.scannedAt,
    message: `Scan found ${scan.summary.totalIssues} repair issues`,
  });
  await tx.done;
}

export async function putVaultRepairPlan(db: IDBPDatabase, plan: RepairPlan): Promise<void> {
  const tx = db.transaction(["vault_repair_plans", "vault_repair_events"], "readwrite");
  await tx.objectStore("vault_repair_plans").put(plan);
  await tx.objectStore("vault_repair_events").put({
    eventId: `repair-event-plan-${plan.planId}`,
    eventType: "plan",
    createdAt: plan.createdAt,
    message: `Plan ${plan.planHash.slice(0, 12)} targets ${plan.targetCount} issue${plan.targetCount === 1 ? "" : "s"}`,
  });
  await tx.done;
}

export async function putVaultRepairRun(db: IDBPDatabase, run: VaultRepairRunRecord): Promise<void> {
  const tx = db.transaction(["vault_repair_runs", "vault_repair_events"], "readwrite");
  await tx.objectStore("vault_repair_runs").put(run);
  await tx.objectStore("vault_repair_events").put({
    eventId: `repair-event-run-${run.runId}`,
    runId: run.runId,
    eventType: run.status === "blocked" ? "run_blocked" : "approval",
    createdAt: run.createdAt,
    message: run.error || `Run ${run.runId} is ${run.status}`,
  });
  await tx.done;
}

export async function getVaultRepairIssues(db: IDBPDatabase): Promise<RepairIssue[]> {
  return (await db.getAll("vault_repair_issues")) as RepairIssue[];
}

export async function getVaultRepairPlans(db: IDBPDatabase): Promise<RepairPlan[]> {
  return (await db.getAll("vault_repair_plans")) as RepairPlan[];
}

export async function getVaultRepairRuns(db: IDBPDatabase): Promise<VaultRepairRunRecord[]> {
  return (await db.getAll("vault_repair_runs")) as VaultRepairRunRecord[];
}

export async function getVaultRepairEvents(db: IDBPDatabase): Promise<VaultRepairEventRecord[]> {
  return (await db.getAll("vault_repair_events")) as VaultRepairEventRecord[];
}
```

Modify `web/src/lib/local-storage.ts`:

```ts
const DB_VERSION = 5;
```

Change the upgrade condition:

```ts
        if (oldVersion < 5) {
          upgradeVaultStores(db);
        }
```

- [x] **Step 4: Run the store test**

Run:

```bash
npx playwright test -c playwright.web.config.js tests/e2e-web/vault-repair-ui.spec.js -g "repair stores exist"
```

Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add web/src/lib/local-storage.ts web/src/lib/vault-storage.ts tests/e2e-web/vault-repair-ui.spec.js
git commit -m "feat: add local vault repair history stores"
```

### Task 4: Repair Workbench UI Scan And Issue Inventory

**Files:**
- Modify: `web/src/lib/vault-client.ts`
- Create: `web/src/components/vault/VaultRepairWorkbench.tsx`
- Modify: `web/src/components/vault/VaultPage.tsx`
- Modify: `tests/e2e-web/vault-repair-ui.spec.js`

- [x] **Step 1: Add the failing UI scan test**

Append to `tests/e2e-web/vault-repair-ui.spec.js`:

```js
test("Repair Workbench scans and displays classified repair issues", async ({ page }) => {
  await resetDb(page);
  await page.goto("/vault");
  await expect(page.getByRole("heading", { name: "Repair Workbench" })).toBeVisible();
  await page.getByRole("button", { name: "Scan for Repair Issues" }).click();
  await expect(page.getByText("3 issues")).toBeVisible();
  await expect(page.getByText("1 writable")).toBeVisible();
  await expect(page.getByText("1 blocked")).toBeVisible();
  await expect(page.getByText("repair-gap-index-drift-asset-image-1")).toBeVisible();
  await expect(page.getByText("T1")).toBeVisible();
  await expect(page.getByText("d1_index")).toBeVisible();
  await expect(page.getByText("repair-gap-live-grok-asset-missing")).toBeVisible();
  await expect(page.getByText("LIVE_GROK_RUNBOOK_ONLY")).toBeVisible();

  const localIssues = await page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("grok-power-tools");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    const issues = await new Promise((resolve, reject) => {
      const tx = db.transaction("vault_repair_issues", "readonly");
      const request = tx.objectStore("vault_repair_issues").getAll();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    db.close();
    return issues.map((issue) => issue.issueId).sort();
  });
  expect(localIssues).toEqual([
    "repair-gap-index-drift-asset-image-1",
    "repair-gap-live-grok-asset-missing",
    "repair-scan-warning-1",
  ]);
});
```

- [x] **Step 2: Run the failing UI scan test**

Run:

```bash
npx playwright test -c playwright.web.config.js tests/e2e-web/vault-repair-ui.spec.js -g "scans and displays"
```

Expected: FAIL because `VaultRepairWorkbench` is not mounted.

- [x] **Step 3: Add repair client helpers**

Add the type import near the top of `web/src/lib/vault-client.ts`, then append the interfaces and functions below the existing exported helpers:

```ts
import type { RepairIssue, RepairPlan } from "./vault-repair-types";

export interface RepairScanResponse {
  ok: true;
  scan: {
    scannedAt: string;
    identityScope: {
      workerHost: string;
      keyPrefix: string;
      bucketName?: string;
      apiKeyFingerprint?: string;
    };
    issues: RepairIssue[];
    summary: {
      totalIssues: number;
      writableIssues: number;
      blockedIssues: number;
      readOnlyIssues: number;
    };
  };
}

export function fetchVaultRepairScan() {
  return json<RepairScanResponse>("/api/vault/repair/scan", { method: "POST" });
}

export function createVaultRepairPlan(payload: {
  identityScope: RepairScanResponse["scan"]["identityScope"];
  issues: RepairIssue[];
  selectedIssueIds: string[];
}) {
  return json<{ ok: true; plan: RepairPlan }>("/api/vault/repair/plan", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}
```

- [x] **Step 4: Add the workbench component**

Create `web/src/components/vault/VaultRepairWorkbench.tsx`:

```tsx
"use client";

import { useMemo, useState } from "react";
import Button from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { fetchVaultRepairScan, type RepairScanResponse } from "@/lib/vault-client";
import { getDB } from "@/lib/local-storage";
import { putVaultRepairScan } from "@/lib/vault-storage";
import type { RepairIssue } from "@/lib/vault-repair-types";

function badgeClass(value: string) {
  if (value === "T4" || value.includes("blocked")) return "border-red-300 text-red-700 dark:border-red-900 dark:text-red-300";
  if (value === "T1" || value.includes("d1")) return "border-amber-300 text-amber-700 dark:border-amber-900 dark:text-amber-300";
  return "border-(--color-surface-300) text-(--color-surface-600) dark:border-(--color-surface-700) dark:text-(--color-surface-300)";
}

function IssueRow({
  issue,
  selected,
  onSelectedChange,
}: {
  issue: RepairIssue;
  selected: boolean;
  onSelectedChange: (selected: boolean) => void;
}) {
  const disabled = !!issue.blockedReason || issue.writeClass === "none";
  return (
    <tr className="border-t border-(--color-surface-200) dark:border-(--color-surface-800)">
      <td className="px-3 py-3 align-top">
        <input
          aria-label={`Select ${issue.issueId}`}
          type="checkbox"
          disabled={disabled}
          checked={selected}
          onChange={(event) => onSelectedChange(event.target.checked)}
        />
      </td>
      <td className="px-3 py-3 align-top">
        <div className="font-medium">{issue.issueId}</div>
        <div className="text-xs text-(--color-surface-500)">{issue.assetId || "scan-level"}</div>
      </td>
      <td className="px-3 py-3 align-top">
        <span className={`rounded border px-2 py-1 text-xs ${badgeClass(issue.riskTier)}`}>{issue.riskTier}</span>
      </td>
      <td className="px-3 py-3 align-top text-sm">{issue.issueType}</td>
      <td className="px-3 py-3 align-top">
        <span className={`rounded border px-2 py-1 text-xs ${badgeClass(issue.writeClass)}`}>{issue.writeClass}</span>
      </td>
      <td className="px-3 py-3 align-top text-sm text-(--color-surface-500)">
        {issue.blockedReason || issue.sourceProof[0]?.label || "No proof label"}
      </td>
    </tr>
  );
}

export default function VaultRepairWorkbench() {
  const [scan, setScan] = useState<RepairScanResponse["scan"] | null>(null);
  const [selectedIssueIds, setSelectedIssueIds] = useState<Set<string>>(() => new Set());
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const issues = scan?.issues || [];
  const selectedIssues = useMemo(() => issues.filter((issue) => selectedIssueIds.has(issue.issueId)), [issues, selectedIssueIds]);

  async function handleScan() {
    setLoading(true);
    try {
      const response = await fetchVaultRepairScan();
      setScan(response.scan);
      setSelectedIssueIds(new Set());
      const db = await getDB();
      await putVaultRepairScan(
        db,
        {
          scanId: `repair-scan-${Date.now()}`,
          scannedAt: response.scan.scannedAt,
          identityScope: response.scan.identityScope,
          summary: response.scan.summary,
        },
        response.scan.issues,
      );
      toast("Repair scan complete", "success");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Repair scan failed", "error");
    } finally {
      setLoading(false);
    }
  }

  function setIssueSelected(issueId: string, selected: boolean) {
    setSelectedIssueIds((current) => {
      const next = new Set(current);
      if (selected) next.add(issueId);
      else next.delete(issueId);
      return next;
    });
  }

  return (
    <section className="mt-6 rounded-(--radius-card) border border-(--color-surface-200) bg-(--color-surface-0) p-4 dark:border-(--color-surface-800) dark:bg-(--color-surface-900)">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-sm font-semibold">Repair Workbench</h2>
          <p className="mt-1 text-sm text-(--color-surface-500)">Read-only detection and approval-gated repair planning.</p>
        </div>
        <Button variant="secondary" onClick={handleScan} disabled={loading}>
          {loading ? "Scanning..." : "Scan for Repair Issues"}
        </Button>
      </div>

      {scan && (
        <div className="mt-4 grid gap-3 sm:grid-cols-4">
          <div className="rounded border border-(--color-surface-200) p-3 dark:border-(--color-surface-800)">
            <div className="text-xs text-(--color-surface-500)">Issues</div>
            <div className="text-lg font-semibold">{scan.summary.totalIssues} issues</div>
          </div>
          <div className="rounded border border-(--color-surface-200) p-3 dark:border-(--color-surface-800)">
            <div className="text-xs text-(--color-surface-500)">Writable</div>
            <div className="text-lg font-semibold">{scan.summary.writableIssues} writable</div>
          </div>
          <div className="rounded border border-(--color-surface-200) p-3 dark:border-(--color-surface-800)">
            <div className="text-xs text-(--color-surface-500)">Blocked</div>
            <div className="text-lg font-semibold">{scan.summary.blockedIssues} blocked</div>
          </div>
          <div className="rounded border border-(--color-surface-200) p-3 dark:border-(--color-surface-800)">
            <div className="text-xs text-(--color-surface-500)">Selected</div>
            <div className="text-lg font-semibold">{selectedIssues.length} selected</div>
          </div>
        </div>
      )}

      {issues.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="text-xs uppercase text-(--color-surface-500)">
              <tr>
                <th className="px-3 py-2">Select</th>
                <th className="px-3 py-2">Issue</th>
                <th className="px-3 py-2">Tier</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">Write class</th>
                <th className="px-3 py-2">Evidence</th>
              </tr>
            </thead>
            <tbody>
              {issues.map((issue) => (
                <IssueRow
                  key={issue.issueId}
                  issue={issue}
                  selected={selectedIssueIds.has(issue.issueId)}
                  onSelectedChange={(selected) => setIssueSelected(issue.issueId, selected)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
```

- [x] **Step 5: Mount the workbench**

Modify `web/src/components/vault/VaultPage.tsx`:

```tsx
import VaultRepairWorkbench from "./VaultRepairWorkbench";
```

Add this after the preview panel and before `VaultGrid`:

```tsx
      <VaultRepairWorkbench />
```

- [x] **Step 6: Run the UI scan test**

Run:

```bash
npx playwright test -c playwright.web.config.js tests/e2e-web/vault-repair-ui.spec.js -g "scans and displays"
```

Expected: PASS.

- [x] **Step 7: Commit**

```bash
git add web/src/lib/vault-client.ts web/src/components/vault/VaultRepairWorkbench.tsx web/src/components/vault/VaultPage.tsx tests/e2e-web/vault-repair-ui.spec.js
git commit -m "feat: show vault repair scan workbench"
```

### Task 5: Approval Gate And Fail-Closed Run Route

**Files:**
- Create: `web/src/app/api/vault/repair/approve/route.ts`
- Create: `web/src/app/api/vault/repair/run/route.ts`
- Modify: `web/src/lib/vault-client.ts`
- Modify: `web/src/components/vault/VaultRepairWorkbench.tsx`
- Modify: `tests/e2e-web/vault-repair-api.spec.js`
- Modify: `tests/e2e-web/vault-repair-ui.spec.js`

- [x] **Step 1: Add failing API tests for approval and blocked run**

Append to `tests/e2e-web/vault-repair-api.spec.js`:

```js
test("repair approval binds to plan hash and run fails closed for writes", async ({ request }) => {
  const scan = await (await request.post("/api/vault/repair/scan")).json();
  const selectedIssue = scan.scan.issues.find((issue) => issue.writeClass === "d1_index");
  const plan = await (await request.post("/api/vault/repair/plan", {
    data: {
      identityScope: scan.scan.identityScope,
      issues: scan.scan.issues,
      selectedIssueIds: [selectedIssue.issueId],
    },
  })).json();

  const approvalRes = await request.post("/api/vault/repair/approve", {
    data: {
      plan: plan.plan,
      approvedPlanHash: plan.plan.planHash,
      approvedTargetCount: plan.plan.targetCount,
      approvedWriteClasses: plan.plan.writeClasses,
    },
  });
  expect(approvalRes.ok()).toBe(true);
  const approval = await approvalRes.json();
  expect(approval.run).toMatchObject({
    planId: plan.plan.planId,
    planHash: plan.plan.planHash,
    status: "approved",
  });

  const runRes = await request.post("/api/vault/repair/run", {
    data: {
      plan: plan.plan,
      run: approval.run,
    },
  });
  expect(runRes.status()).toBe(409);
  const blocked = await runRes.json();
  expect(blocked).toMatchObject({
    ok: false,
    error: "REPAIR_WRITE_NOT_ARMED",
  });
});

test("repair approval rejects stale plan hash", async ({ request }) => {
  const scan = await (await request.post("/api/vault/repair/scan")).json();
  const selectedIssue = scan.scan.issues.find((issue) => issue.writeClass === "d1_index");
  const plan = await (await request.post("/api/vault/repair/plan", {
    data: {
      identityScope: scan.scan.identityScope,
      issues: scan.scan.issues,
      selectedIssueIds: [selectedIssue.issueId],
    },
  })).json();

  const res = await request.post("/api/vault/repair/approve", {
    data: {
      plan: plan.plan,
      approvedPlanHash: "sha256-stale",
      approvedTargetCount: plan.plan.targetCount,
      approvedWriteClasses: plan.plan.writeClasses,
    },
  });
  expect(res.status()).toBe(409);
  const body = await res.json();
  expect(body.error).toBe("REPAIR_PLAN_HASH_STALE");
});
```

- [x] **Step 2: Add the failing UI approval test**

Append to `tests/e2e-web/vault-repair-ui.spec.js`:

```js
test("Repair Workbench creates an approved plan and records blocked run history", async ({ page }) => {
  await resetDb(page);
  await page.goto("/vault");
  await page.getByRole("button", { name: "Scan for Repair Issues" }).click();
  await page.getByLabel("Select repair-gap-index-drift-asset-image-1").check();
  await page.getByRole("button", { name: "Create Repair Plan" }).click();
  await expect(page.getByText(/Plan hash/)).toBeVisible();
  await expect(page.getByText(/1 target/)).toBeVisible();
  await page.getByRole("button", { name: "Approve Exact Plan" }).click();
  await expect(page.getByText("Approved")).toBeVisible();
  await page.getByRole("button", { name: "Run Approved Repair" }).click();
  await expect(page.getByText("REPAIR_WRITE_NOT_ARMED")).toBeVisible();

  const history = await page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("grok-power-tools");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    const runs = await new Promise((resolve, reject) => {
      const tx = db.transaction("vault_repair_runs", "readonly");
      const request = tx.objectStore("vault_repair_runs").getAll();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    const events = await new Promise((resolve, reject) => {
      const tx = db.transaction("vault_repair_events", "readonly");
      const request = tx.objectStore("vault_repair_events").getAll();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    db.close();
    return { runs, events };
  });
  expect(history.runs).toEqual(expect.arrayContaining([
    expect.objectContaining({ status: "blocked", error: "REPAIR_WRITE_NOT_ARMED" }),
  ]));
  expect(history.events.map((event) => event.eventType)).toEqual(expect.arrayContaining(["plan", "approval", "run_blocked"]));
});
```

- [x] **Step 3: Run the failing approval tests**

Run:

```bash
npx playwright test -c playwright.web.config.js tests/e2e-web/vault-repair-api.spec.js tests/e2e-web/vault-repair-ui.spec.js -g "approval|approved plan"
```

Expected: FAIL because approve/run routes and UI controls do not exist.

- [x] **Step 4: Add approval and run routes**

Create `web/src/app/api/vault/repair/approve/route.ts`:

```ts
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const plan = body.plan;
  const approvedPlanHash = body.approvedPlanHash;
  const approvedTargetCount = body.approvedTargetCount;
  const approvedWriteClasses = body.approvedWriteClasses;

  if (!plan || typeof plan.planHash !== "string") {
    return NextResponse.json({ ok: false, error: "REPAIR_PLAN_REQUIRED" }, { status: 400 });
  }
  if (approvedPlanHash !== plan.planHash) {
    return NextResponse.json({ ok: false, error: "REPAIR_PLAN_HASH_STALE" }, { status: 409 });
  }
  if (approvedTargetCount !== plan.targetCount) {
    return NextResponse.json({ ok: false, error: "REPAIR_TARGET_COUNT_CHANGED" }, { status: 409 });
  }
  if (JSON.stringify(approvedWriteClasses) !== JSON.stringify(plan.writeClasses)) {
    return NextResponse.json({ ok: false, error: "REPAIR_WRITE_CLASSES_CHANGED" }, { status: 409 });
  }

  return NextResponse.json({
    ok: true,
    run: {
      runId: `repair-run-${Date.now()}`,
      planId: plan.planId,
      planHash: plan.planHash,
      status: "approved",
      createdAt: new Date().toISOString(),
    },
  });
}
```

Create `web/src/app/api/vault/repair/run/route.ts`:

```ts
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const plan = body.plan;
  const run = body.run;

  if (!plan || !run || run.status !== "approved") {
    return NextResponse.json({ ok: false, error: "REPAIR_APPROVAL_REQUIRED" }, { status: 409 });
  }
  if (run.planHash !== plan.planHash) {
    return NextResponse.json({ ok: false, error: "REPAIR_PLAN_HASH_STALE" }, { status: 409 });
  }
  if (Array.isArray(plan.writeClasses) && plan.writeClasses.some((writeClass: string) => writeClass !== "none")) {
    return NextResponse.json({ ok: false, error: "REPAIR_WRITE_NOT_ARMED" }, { status: 409 });
  }

  return NextResponse.json({
    ok: true,
    run: {
      ...run,
      status: "succeeded",
      resultCounts: { succeeded: 0, skipped: 0, conflicted: 0, failed: 0 },
    },
  });
}
```

- [x] **Step 5: Add client helpers**

Append these interfaces and functions below the repair scan and plan helpers in `web/src/lib/vault-client.ts`:

```ts
export interface RepairRunRecord {
  runId: string;
  planId: string;
  planHash: string;
  status: "approved" | "blocked" | "succeeded" | "failed";
  createdAt: string;
  error?: string;
}

export function approveVaultRepairPlan(payload: {
  plan: RepairPlan;
  approvedPlanHash: string;
  approvedTargetCount: number;
  approvedWriteClasses: string[];
}) {
  return json<{ ok: true; run: RepairRunRecord }>("/api/vault/repair/approve", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function runVaultRepairPlan(payload: { plan: RepairPlan; run: RepairRunRecord }) {
  return json<{ ok: true; run: RepairRunRecord }>("/api/vault/repair/run", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}
```

- [x] **Step 6: Extend the workbench UI**

Modify imports in `web/src/components/vault/VaultRepairWorkbench.tsx`:

```tsx
import { approveVaultRepairPlan, createVaultRepairPlan, fetchVaultRepairScan, runVaultRepairPlan, type RepairRunRecord, type RepairScanResponse } from "@/lib/vault-client";
import { putVaultRepairPlan, putVaultRepairRun, putVaultRepairScan } from "@/lib/vault-storage";
import type { RepairIssue, RepairPlan } from "@/lib/vault-repair-types";
```

Add state inside `VaultRepairWorkbench`:

```tsx
  const [plan, setPlan] = useState<RepairPlan | null>(null);
  const [run, setRun] = useState<RepairRunRecord | null>(null);
  const [runError, setRunError] = useState("");
```

Add handlers inside `VaultRepairWorkbench`:

```tsx
  async function handleCreatePlan() {
    if (!scan || selectedIssues.length === 0) return;
    const response = await createVaultRepairPlan({
      identityScope: scan.identityScope,
      issues,
      selectedIssueIds: selectedIssues.map((issue) => issue.issueId),
    });
    setPlan(response.plan);
    setRun(null);
    setRunError("");
    const db = await getDB();
    await putVaultRepairPlan(db, response.plan);
    toast("Repair plan created", "success");
  }

  async function handleApprovePlan() {
    if (!plan) return;
    const response = await approveVaultRepairPlan({
      plan,
      approvedPlanHash: plan.planHash,
      approvedTargetCount: plan.targetCount,
      approvedWriteClasses: plan.writeClasses,
    });
    setRun(response.run);
    const db = await getDB();
    await putVaultRepairRun(db, response.run);
    toast("Repair plan approved", "success");
  }

  async function handleRunPlan() {
    if (!plan || !run) return;
    try {
      const response = await runVaultRepairPlan({ plan, run });
      setRun(response.run);
      const db = await getDB();
      await putVaultRepairRun(db, response.run);
    } catch (error) {
      const message = error instanceof Error ? error.message : "REPAIR_RUN_FAILED";
      setRunError(message);
      const blockedRun = { ...run, status: "blocked" as const, error: message };
      setRun(blockedRun);
      const db = await getDB();
      await putVaultRepairRun(db, blockedRun);
    }
  }
```

Add this UI block before `</section>`:

```tsx
      {scan && (
        <div className="mt-4 flex flex-col gap-3 rounded border border-(--color-surface-200) p-3 dark:border-(--color-surface-800)">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-sm font-medium">Plan Builder</div>
              <div className="text-xs text-(--color-surface-500)">{selectedIssues.length} selected issue{selectedIssues.length === 1 ? "" : "s"}</div>
            </div>
            <Button variant="primary" onClick={handleCreatePlan} disabled={selectedIssues.length === 0}>
              Create Repair Plan
            </Button>
          </div>
          {plan && (
            <div className="rounded bg-(--color-surface-50) p-3 text-sm dark:bg-(--color-surface-950)">
              <div>Plan hash: <span className="font-mono">{plan.planHash.slice(0, 16)}</span></div>
              <div>{plan.targetCount} target{plan.targetCount === 1 ? "" : "s"}: {plan.writeClasses.join(", ")}</div>
              <div className="mt-3 flex gap-2">
                <Button variant="secondary" onClick={handleApprovePlan}>Approve Exact Plan</Button>
                <Button variant="primary" onClick={handleRunPlan} disabled={!run}>Run Approved Repair</Button>
              </div>
              {run && <div className="mt-2 text-sm">Approved</div>}
              {runError && <div className="mt-2 text-sm text-red-600 dark:text-red-300">{runError}</div>}
            </div>
          )}
        </div>
      )}
```

- [x] **Step 7: Run approval tests**

Run:

```bash
npx playwright test -c playwright.web.config.js tests/e2e-web/vault-repair-api.spec.js tests/e2e-web/vault-repair-ui.spec.js -g "approval|approved plan"
```

Expected: PASS.

- [x] **Step 8: Commit**

```bash
git add web/src/app/api/vault/repair/approve/route.ts web/src/app/api/vault/repair/run/route.ts web/src/lib/vault-client.ts web/src/components/vault/VaultRepairWorkbench.tsx tests/e2e-web/vault-repair-api.spec.js tests/e2e-web/vault-repair-ui.spec.js
git commit -m "feat: add vault repair approval gate"
```

### Task 6: Read-Only Object Proof Proxy

**Files:**
- Create: `web/src/app/api/vault/repair/proof/route.ts`
- Modify: `tests/e2e-web/fixtures/fake-vault-worker.mjs`
- Modify: `tests/e2e-web/vault-repair-api.spec.js`
- Modify: `cloud/tests/vault-routes.test.ts`

- [x] **Step 1: Add failing proof proxy and Worker no-write tests**

Append to `tests/e2e-web/vault-repair-api.spec.js`:

```js
test("repair proof proxy uses Worker HEAD without exposing API keys", async ({ request }) => {
  const objectKey = "grok-powertools/v1/users/greymaker/media/by-asset/asset-image-1.png";
  await request.get(`${fakeWorkerUrl}/__fake-worker/debug/requests`);
  const res = await request.get(`/api/vault/repair/proof?objectKey=${encodeURIComponent(objectKey)}`);
  expect(res.ok()).toBe(true);
  const body = await res.json();
  expect(body).toMatchObject({
    ok: true,
    exists: true,
    objectKey,
    sizeBytes: 512,
    sha256: "sha-image-1",
  });
  expect(JSON.stringify(body)).not.toContain("client-sample");

  const log = await (await request.get(`${fakeWorkerUrl}/__fake-worker/debug/requests`)).json();
  expect(log.requests).toEqual([
    expect.objectContaining({ method: "HEAD", pathname: "/v1/objects/verify" }),
  ]);
});
```

Append to `cloud/tests/vault-routes.test.ts`:

```ts
test('Object HEAD proof does not write to D1', async () => {
    const writes: string[] = [];
    const response = await worker.fetch(
        new Request('https://worker.example/v1/objects/verify?objectKey=grok-powertools/v1/users/greymaker/media/by-asset/asset-video-1.mp4', {
            method: 'HEAD',
            headers: { [headerName]: sampleKey },
        }),
        env({
            R2_BUCKET: {
                head: async () => ({
                    size: 2048,
                    etag: 'etag-1',
                    uploaded: new Date('2026-06-18T00:00:00.000Z'),
                    httpMetadata: { contentType: 'video/mp4' },
                    customMetadata: { sha256: 'sha-1' },
                }),
            },
            DB: {
                prepare: (sql: string) => {
                    writes.push(sql);
                    return {
                        bind: () => ({
                            all: async () => ({ results: [] }),
                            first: async () => null,
                        }),
                    };
                },
            },
        })
    );
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-r2-size-bytes'), '2048');
    assert.equal(response.headers.get('x-r2-sha256'), 'sha-1');
    assert.deepEqual(writes, []);
});
```

- [x] **Step 2: Run the failing proof tests**

Run:

```bash
npx playwright test -c playwright.web.config.js tests/e2e-web/vault-repair-api.spec.js -g "repair proof proxy"
npm --prefix cloud run test:acceptance
```

Expected: Playwright FAIL because the proof route and fake Worker HEAD fixture are missing. Cloud acceptance may PASS if the existing Worker route already satisfies the no-write assertion.

- [x] **Step 3: Add fake Worker HEAD proof**

Add to `tests/e2e-web/fixtures/fake-vault-worker.mjs` before `/v1/vault/media`:

```js
  if (req.method === "HEAD" && url.pathname === "/v1/objects/verify") {
    const objectKey = url.searchParams.get("objectKey") || "";
    if (objectKey.endsWith("asset-image-1.png")) {
      res.writeHead(200, {
        "access-control-allow-origin": "*",
        "x-r2-size-bytes": "512",
        "x-r2-etag": "etag-image-1",
        "x-r2-sha256": "sha-image-1",
        "content-type": "image/png",
      });
      return res.end();
    }
    res.writeHead(404, { "access-control-allow-origin": "*" });
    return res.end();
  }
```

- [x] **Step 4: Add the proof proxy route**

Create `web/src/app/api/vault/repair/proof/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getWorkerConfig } from "@/lib/vault-server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const objectKey = url.searchParams.get("objectKey") || "";
  if (!objectKey || objectKey.includes("..") || objectKey.startsWith("/")) {
    return NextResponse.json({ ok: false, error: "REPAIR_PROOF_OBJECT_KEY_INVALID" }, { status: 400 });
  }

  const { workerUrl, apiKey } = getWorkerConfig();
  const workerSearch = new URLSearchParams({ objectKey });
  const res = await fetch(`${workerUrl}/v1/objects/verify?${workerSearch.toString()}`, {
    method: "HEAD",
    cache: "no-store",
    headers: { "x-gpt-api-key": apiKey },
  });

  if (res.status === 404) {
    return NextResponse.json({ ok: true, exists: false, objectKey }, { status: 200 });
  }
  if (!res.ok) {
    return NextResponse.json({ ok: false, error: "REPAIR_PROOF_FAILED" }, { status: res.status });
  }

  return NextResponse.json({
    ok: true,
    exists: true,
    objectKey,
    sizeBytes: Number(res.headers.get("x-r2-size-bytes") || 0),
    etag: res.headers.get("x-r2-etag") || undefined,
    sha256: res.headers.get("x-r2-sha256") || undefined,
    contentType: res.headers.get("content-type") || undefined,
  });
}
```

- [x] **Step 5: Run proof tests**

Run:

```bash
npx playwright test -c playwright.web.config.js tests/e2e-web/vault-repair-api.spec.js -g "repair proof proxy"
npm --prefix cloud run test:acceptance
```

Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add web/src/app/api/vault/repair/proof/route.ts tests/e2e-web/fixtures/fake-vault-worker.mjs tests/e2e-web/vault-repair-api.spec.js cloud/tests/vault-routes.test.ts
git commit -m "feat: add read-only vault repair proof"
```

### Task 7: Final Gates And Documentation Notes

**Files:**
- Modify: `docs/superpowers/specs/2026-06-20-vault-repair-workbench-design.md`
- Create or modify: `implementation-notes.html`

- [x] **Step 1: Update the spec with the phase boundary**

Add this section after `## Summary` in `docs/superpowers/specs/2026-06-20-vault-repair-workbench-design.md`:

```md
## Phase 1 Build Boundary

The first implementation slice builds T0 read-only scan, T1 D1/index drift planning, approval binding, local repair history, read-only object proof, and fail-closed run behavior. T2 metadata repair, T3 canonicalization repair, T4 direct media restore, processed-ID changes, backfill, retry-unsynced, and live Grok automation require separate specs and separate approval.

Vault repair operates from recorded source proof. Current Worker inventory prefers `r2_dedupe_index` rows and falls back to R2 listing. The workbench must record which proof source was observed instead of assuming a single source of truth.
```

- [x] **Step 2: Add implementation notes**

Create or append to `implementation-notes.html`:

```html
<section>
  <h2>Vault Repair Workbench Phase 1 Notes</h2>
  <ul>
    <li>Built only T0 read-only scan and T1 index-drift planning.</li>
    <li>Kept T2, T3, T4, processed-ID changes, backfill, retry-unsynced, and live Grok automation blocked.</li>
    <li>Used local IndexedDB repair history for owner-mode review before adding cloud repair ledger tables.</li>
    <li>Added read-only proof through Worker HEAD instead of mutating POST object verification.</li>
    <li>Run route intentionally returns REPAIR_WRITE_NOT_ARMED for write classes until a narrow approved Worker repair route exists.</li>
  </ul>
</section>
```

- [x] **Step 3: Run focused web repair gates**

Run:

```bash
npx playwright test -c playwright.web.config.js tests/e2e-web/vault-repair-api.spec.js tests/e2e-web/vault-repair-ui.spec.js
```

Expected: PASS.

- [x] **Step 4: Run existing Vault web gates**

Run:

```bash
npx playwright test -c playwright.web.config.js tests/e2e-web/vault-api.spec.js tests/e2e-web/vault-ui.spec.js tests/e2e-web/vault-sync.spec.js
```

Expected: PASS.

- [x] **Step 5: Run cloud acceptance and typecheck**

Run:

```bash
npm --prefix cloud run test:acceptance
npm --prefix cloud run typecheck
```

Expected: PASS for both commands.

- [x] **Step 6: Run web build and lint**

Run:

```bash
npm --prefix web run build
npm --prefix web run lint
```

Expected: PASS for both commands.

- [x] **Step 7: Run root lint and unit tests**

Run:

```bash
npm run lint
npm run test:unit
```

Expected: PASS. If an unrelated dirty-file failure appears, rerun the focused failing test once. If the same unrelated failure repeats, stop and report the exact file and failure without editing unrelated code.

- [x] **Step 8: Commit**

```bash
git add docs/superpowers/specs/2026-06-20-vault-repair-workbench-design.md implementation-notes.html
git commit -m "docs: record vault repair phase boundary"
```

## Self-Review

Spec coverage:

- T0 read-only scan: Task 2 and Task 4.
- T1 D1/index drift planning: Task 1, Task 2, Task 5.
- Approval gate and stable plan hash: Task 1 and Task 5.
- Direct proof without cached URLs: Task 6.
- Fail-closed writes: Task 5.
- Local ledger/history: Task 3 and Task 5.
- UI issue inventory, plan builder, approval gate, and run history: Task 4 and Task 5.
- T2, T3, T4, live Grok, processed IDs, backfill, retry-unsynced: explicitly outside this phase and preserved as blocked.

Placeholder scan:

- No task uses forbidden placeholder markers or unnamed error handling.
- Every code-changing task includes concrete code blocks and exact commands.

Type consistency:

- `RepairIssue`, `RepairPlan`, `RepairIdentityScope`, `RepairRunRecord`, and storage helper names are consistent across tasks.
- API route payload fields match client helper payload fields.
- IndexedDB store names match reset tests and storage helpers.
