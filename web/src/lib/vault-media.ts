import type { VaultAsset } from "./vault-types";

function objectKeyLooksLikeImage(objectKey: string | undefined): boolean {
  return /\.(avif|gif|heic|jpeg|jpg|png|webp)$/i.test(String(objectKey || "").split(/[?#]/)[0]);
}

function objectKeyLooksLikeVideo(objectKey: string | undefined): boolean {
  return /\.(m4v|mov|mp4|webm)$/i.test(String(objectKey || "").split(/[?#]/)[0]);
}

export function isVaultImageAsset(asset: Pick<VaultAsset, "mediaType" | "contentType" | "canonicalObjectKey" | "legacyObjectKeys">): boolean {
  if (asset.mediaType === "image") return true;
  if (asset.mediaType === "video") return false;
  if (asset.contentType?.toLowerCase().startsWith("image/")) return true;
  return objectKeyLooksLikeImage(asset.canonicalObjectKey) || asset.legacyObjectKeys.some(objectKeyLooksLikeImage);
}

export function isVaultVideoAsset(asset: Pick<VaultAsset, "mediaType" | "contentType" | "canonicalObjectKey" | "legacyObjectKeys">): boolean {
  if (asset.mediaType === "video") return true;
  if (asset.mediaType === "image") return false;
  if (asset.contentType?.toLowerCase().startsWith("video/")) return true;
  return objectKeyLooksLikeVideo(asset.canonicalObjectKey) || asset.legacyObjectKeys.some(objectKeyLooksLikeVideo);
}
