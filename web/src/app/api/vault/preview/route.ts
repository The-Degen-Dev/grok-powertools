import { NextResponse } from "next/server";
import { workerJson } from "@/lib/vault-server";

interface InventoryResponse {
  items?: unknown[];
  counts?: Record<string, number>;
}

interface PromptResponse {
  prompts?: unknown[];
  data?: unknown[];
}

function promptRows(response: PromptResponse): unknown[] {
  return response.prompts || response.data || [];
}

function promptKey(prompt: unknown): string {
  if (!prompt || typeof prompt !== "object") return JSON.stringify(prompt);
  const record = prompt as Record<string, unknown>;
  return String(record.id || record.text || JSON.stringify(record));
}

function dedupePrompts(prompts: unknown[]): unknown[] {
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
    workerJson<Record<string, unknown>>("/v1/vault/identity"),
    workerJson<InventoryResponse>("/v1/vault/inventory"),
    workerJson<PromptResponse>("/v1/vault/metadata/savedPrompts"),
    workerJson<PromptResponse>("/v1/vault/metadata/promptHistory"),
    workerJson<{ gaps?: unknown[] }>("/v1/vault/gaps"),
  ]);

  const items = inventory.items || [];
  const counts = inventory.counts || {};
  const prompts = dedupePrompts([...promptRows(savedPrompts), ...promptRows(promptHistory)]);

  return NextResponse.json({
    ok: true,
    identity,
    assets: items,
    prompts,
    gaps: gaps.gaps || [],
    counts: {
      assets: counts.assets || items.length,
      images: counts.images || 0,
      videos: counts.videos || 0,
      prompts: prompts.length,
      verified: counts.verified || 0,
      blocked: counts.blocked || 0,
      failed: counts.failed || 0,
      unproven: counts.unproven || 0,
    },
    warnings: [],
  });
}
