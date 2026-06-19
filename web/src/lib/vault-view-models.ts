import type { MovieClip, VideoItem } from "./types";
import type { VaultAsset } from "./vault-types";
import { isVaultImageAsset } from "./vault-media";

export function vaultAssetToVideoItem(asset: VaultAsset, position = 0): VideoItem {
  const mediaUrl = `/api/vault/media/${encodeURIComponent(asset.assetId)}`;
  const isImage = isVaultImageAsset(asset);
  return {
    id: asset.assetId,
    assetId: asset.assetId,
    mediaType: isImage ? "image" : asset.mediaType,
    grokPostId: asset.grokPostId || asset.assetId,
    sourceUrl: asset.sourceUrl || "",
    videoUrl: isImage ? "" : mediaUrl,
    imageUrl: isImage ? mediaUrl : undefined,
    thumbnailUrl: isImage ? mediaUrl : "",
    promptText: asset.promptText || "",
    position,
    notes: "",
    createdAt: asset.createdAt,
  };
}

export function vaultAssetToMovieClip(asset: VaultAsset, position = 0): MovieClip {
  const mediaUrl = `/api/vault/media/${encodeURIComponent(asset.assetId)}`;
  const isImage = isVaultImageAsset(asset);
  return {
    id: crypto.randomUUID(),
    type: isImage ? "image" : "video",
    videoUrl: isImage ? undefined : mediaUrl,
    imageUrl: isImage ? mediaUrl : undefined,
    sourceAssetId: asset.assetId,
    stillDuration: isImage ? 3 : undefined,
    transition: position === 0 ? { type: "cut", duration: 0 } : { type: "crossfade", duration: 0.5 },
    position,
  };
}
