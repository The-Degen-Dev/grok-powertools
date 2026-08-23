import { getWorkerHost, workerJson } from "@/lib/vault-server";
import { dedupeAssets } from "@/lib/vault-dedupe";
import {
  parseVaultCounts,
  parseVaultGap,
  parseVaultInventory,
  parseVaultPrompts,
  parseVaultWorkerIdentity,
  type VaultAsset,
  type VaultPreview,
  type VaultPrompt,
  type VaultWorkerIdentity,
} from "@/lib/vault-types";

const INVENTORY_PAGE_LIMIT = 1000;
const MAX_INVENTORY_PAGES = 100;

type VaultGapWithObjectKey = VaultPreview["gaps"][number] & { objectKey?: string };
type VaultPreviewWithObjectKey = Omit<VaultPreview, "identity" | "gaps"> & {
  identity: VaultWorkerIdentity;
  gaps: VaultGapWithObjectKey[];
  scanTruncated: boolean;
};

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

function parseVaultGapsWithObjectKey(input: unknown): { value: VaultGapWithObjectKey[]; warnings: string[] } {
  const rows =
    typeof input === "object" && input !== null && "gaps" in input && Array.isArray(input.gaps) ? input.gaps : [];
  const warnings: string[] = [];
  const gaps: VaultGapWithObjectKey[] = [];

  for (const [index, row] of rows.entries()) {
    try {
      const gap = parseVaultGap(row, `gaps[${index}]`);
      const objectKey =
        typeof row === "object" && row !== null && "objectKey" in row && typeof row.objectKey === "string"
          ? row.objectKey
          : undefined;
      gaps.push(objectKey ? { ...gap, objectKey } : gap);
    } catch (error) {
      warnings.push(error instanceof Error ? error.message : `gaps[${index}] is invalid`);
    }
  }

  return { value: gaps, warnings };
}

export async function loadVaultPreviewFromWorker(): Promise<VaultPreviewWithObjectKey> {
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
  const parsedGaps = parseVaultGapsWithObjectKey(gaps);
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
