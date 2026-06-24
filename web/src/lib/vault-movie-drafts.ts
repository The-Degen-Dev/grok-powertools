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
    if (overlay?.hidden) {
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
