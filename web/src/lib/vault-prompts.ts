import type { SavedPrompt } from "./types";
import { normalizePromptText, type VaultPrompt } from "./vault-types";

export function vaultPromptToSavedPrompt(prompt: VaultPrompt): SavedPrompt {
  return {
    id: `vault-${prompt.id}`,
    text: prompt.text,
    tags: Array.from(new Set(["vault", ...(prompt.tags || [])])),
    sourceVideoId: prompt.sourceAssetIds?.[0],
    usageCount: prompt.usageCount ?? 0,
    createdAt: prompt.createdAt ?? new Date(0).toISOString(),
  };
}

export function mergePrompts(localPrompts: SavedPrompt[], vaultPrompts: SavedPrompt[]): SavedPrompt[] {
  const byHash = new Map<string, SavedPrompt>();
  for (const prompt of [...localPrompts, ...vaultPrompts]) {
    const key = normalizePromptText(prompt.text);
    if (!key) continue;
    const existing = byHash.get(key);
    if (!existing) {
      byHash.set(key, prompt);
      continue;
    }

    const preferPrompt =
      prompt.usageCount > existing.usageCount ||
      (existing.id.startsWith("vault-") && !prompt.id.startsWith("vault-"));
    const displayPrompt = preferPrompt ? prompt : existing;
    const latestCreatedAt =
      new Date(prompt.createdAt).getTime() > new Date(existing.createdAt).getTime()
        ? prompt.createdAt
        : existing.createdAt;
    byHash.set(key, {
      ...displayPrompt,
      tags: Array.from(new Set([...(existing.tags || []), ...(prompt.tags || [])])),
      sourceVideoId: displayPrompt.sourceVideoId || existing.sourceVideoId || prompt.sourceVideoId,
      usageCount: Math.max(existing.usageCount || 0, prompt.usageCount || 0),
      createdAt: latestCreatedAt,
    });
  }
  return Array.from(byHash.values()).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export function filterPrompts(prompts: SavedPrompt[], query: string): SavedPrompt[] {
  const lower = query.trim().toLowerCase();
  if (!lower) return prompts;
  return prompts.filter(
    (prompt) =>
      prompt.text.toLowerCase().includes(lower) ||
      prompt.tags.some((tag) => tag.toLowerCase().includes(lower)),
  );
}
