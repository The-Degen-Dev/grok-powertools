import type { VaultAsset } from "./vault-types";

export function vaultMediaUrl(asset: VaultAsset): string {
  const params = new URLSearchParams();
  const objectKey = asset.canonicalObjectKey || asset.legacyObjectKeys[0];
  if (objectKey) params.set("objectKey", objectKey);
  const query = params.toString();
  return `/api/vault/media/${encodeURIComponent(asset.assetId)}${query ? `?${query}` : ""}`;
}
