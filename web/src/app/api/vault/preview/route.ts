import { NextResponse } from "next/server";
import { getWorkerHost, workerJson } from "@/lib/vault-server";
import {
  parseVaultGaps,
  parseVaultInventory,
  parseVaultPrompts,
  parseVaultWorkerIdentity,
  parseVaultCounts,
  type VaultPrompt,
} from "@/lib/vault-types";

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

export async function GET() {
  const [identity, inventory, savedPrompts, promptHistory, gaps] = await Promise.all([
    workerJson<unknown>("/v1/vault/identity"),
    workerJson<unknown>("/v1/vault/inventory"),
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
  const parsedInventory = parseVaultInventory(inventory);
  const parsedSavedPrompts = parseVaultPrompts(savedPrompts);
  const parsedPromptHistory = parseVaultPrompts(promptHistory, "metadata.prompts");
  const parsedGaps = parseVaultGaps(gaps);
  const prompts = dedupePrompts([...parsedSavedPrompts.value, ...parsedPromptHistory.value]);
  const warnings = [
    ...parsedInventory.warnings,
    ...parsedSavedPrompts.warnings,
    ...parsedPromptHistory.warnings,
    ...parsedGaps.warnings,
  ];

  return NextResponse.json({
    ok: true,
    identity: parsedIdentity,
    assets: parsedInventory.value.assets,
    prompts,
    gaps: parsedGaps.value,
    counts: parseVaultCounts(parsedInventory.value.counts, parsedInventory.value.assets, prompts.length),
    warnings,
  });
}
