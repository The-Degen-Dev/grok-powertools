import type { IDBPDatabase } from "idb";
import type { RepairIssue, RepairPlan } from "./vault-repair-types";
import {
  parseVaultPreview,
  parseVaultWorkerIdentity,
  type VaultAsset,
  type VaultGap,
  type VaultImportRun,
  type VaultOverlay,
  type VaultPreview,
} from "./vault-types";

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
}

export async function commitVaultPreview(db: IDBPDatabase, preview: VaultPreview): Promise<VaultImportRun> {
  const parsedPreview = parseVaultPreview(preview).value;
  const identity = parseVaultWorkerIdentity(parsedPreview.identity);
  const now = new Date().toISOString();
  const run: VaultImportRun = {
    id: `vault-import-${Date.now()}`,
    source: "production-r2",
    workerHost: identity.workerHost,
    keyPrefix: identity.keyPrefix,
    importedAt: now,
    status: "committed",
    counts: parsedPreview.counts,
    warnings: parsedPreview.warnings,
  };

  const tx = db.transaction(["vault_assets", "vault_gaps", "vault_prompts", "vault_import_runs"], "readwrite");
  for (const asset of parsedPreview.assets) {
    await tx.objectStore("vault_assets").put(asset);
  }
  for (const gap of parsedPreview.gaps) {
    await tx.objectStore("vault_gaps").put(gap);
  }
  for (const prompt of parsedPreview.prompts) {
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

export async function getVaultOverlaysIncludingDeleted(db: IDBPDatabase): Promise<VaultOverlay[]> {
  return (await db.getAll("vault_overlays")) as VaultOverlay[];
}

export async function getVaultOverlay(db: IDBPDatabase, assetId: string): Promise<VaultOverlay | undefined> {
  return db.get("vault_overlays", assetId) as Promise<VaultOverlay | undefined>;
}

export async function putVaultOverlay(db: IDBPDatabase, overlay: VaultOverlay): Promise<void> {
  await db.put("vault_overlays", overlay);
}

export async function getVaultGaps(db: IDBPDatabase): Promise<VaultGap[]> {
  return (await db.getAll("vault_gaps")) as VaultGap[];
}

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

export async function getVaultRepairScans(db: IDBPDatabase): Promise<VaultRepairScanRecord[]> {
  return (await db.getAll("vault_repair_scans")) as VaultRepairScanRecord[];
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
