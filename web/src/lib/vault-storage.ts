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
    await tx.objectStore("vault_assets").put(asset);
  }
  for (const gap of preview.gaps) {
    await tx.objectStore("vault_gaps").put(gap);
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
