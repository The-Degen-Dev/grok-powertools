import { NextResponse } from "next/server";
import { getWorkerHost, workerJson } from "@/lib/vault-server";
import {
  parseVaultGaps,
  parseVaultInventory,
  parseVaultPrompts,
  parseVaultWorkerIdentity,
  parseVaultCounts,
  type VaultAsset,
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

async function fetchAllInventoryPages(): Promise<{ assets: VaultAsset[]; warnings: string[] }> {
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

    if (!cursor) return { assets: dedupeAssets(assets), warnings };
  }

  warnings.push(`inventory pagination stopped after ${MAX_INVENTORY_PAGES} pages`);
  return { assets: dedupeAssets(assets), warnings };
}

export async function GET() {
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

  return NextResponse.json({
    ok: true,
    identity: parsedIdentity,
    assets: inventory.assets,
    prompts,
    gaps: parsedGaps.value,
    counts: parseVaultCounts({}, inventory.assets, prompts.length),
    warnings,
  });
}
