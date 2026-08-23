import type { VaultAsset } from "./vault-types";

function laterTimestamp(first?: string, second?: string): string | undefined {
  if (!first) return second;
  if (!second) return first;
  return first >= second ? first : second;
}

function earlierTimestamp(first?: string, second?: string): string | undefined {
  if (!first) return second;
  if (!second) return first;
  return first <= second ? first : second;
}

function assetPreferenceKey(asset: VaultAsset): string {
  return [
    asset.canonicalObjectKey ? "1" : "0",
    asset.updatedAt || "",
    asset.canonicalObjectKey || asset.legacyObjectKeys[0] || "",
  ].join(":");
}

export function dedupeAssets(assets: VaultAsset[]): VaultAsset[] {
  const byAssetId = new Map<string, VaultAsset>();
  for (const asset of assets) {
    const current = byAssetId.get(asset.assetId);
    if (!current) {
      byAssetId.set(asset.assetId, asset);
      continue;
    }

    const preferred = assetPreferenceKey(asset) > assetPreferenceKey(current) ? asset : current;
    const secondary = preferred === asset ? current : asset;
    const canonicalObjectKey = preferred.canonicalObjectKey || secondary.canonicalObjectKey;
    const legacyObjectKeys = new Set([...current.legacyObjectKeys, ...asset.legacyObjectKeys]);
    for (const objectKey of [current.canonicalObjectKey, asset.canonicalObjectKey]) {
      if (objectKey && objectKey !== canonicalObjectKey) legacyObjectKeys.add(objectKey);
    }
    if (canonicalObjectKey) legacyObjectKeys.delete(canonicalObjectKey);

    byAssetId.set(asset.assetId, {
      ...secondary,
      ...preferred,
      canonicalObjectKey,
      legacyObjectKeys: [...legacyObjectKeys].sort(),
      firstSeenAt: earlierTimestamp(current.firstSeenAt, asset.firstSeenAt),
      lastSeenAt: laterTimestamp(current.lastSeenAt, asset.lastSeenAt),
      createdAt: earlierTimestamp(current.createdAt, asset.createdAt) || preferred.createdAt,
      updatedAt: laterTimestamp(current.updatedAt, asset.updatedAt) || preferred.updatedAt,
    });
  }
  return [...byAssetId.values()];
}
