import type { MovieClip, VideoItem } from "./types";
import type { VaultAsset } from "./vault-types";

export function vaultAssetToVideoItem(asset: VaultAsset, position = 0): VideoItem {
  const mediaUrl = `/api/vault/media/${encodeURIComponent(asset.assetId)}`;
  return {
    id: asset.assetId,
    assetId: asset.assetId,
    mediaType: asset.mediaType,
    grokPostId: asset.grokPostId || asset.assetId,
    sourceUrl: asset.sourceUrl || "",
    videoUrl: asset.mediaType === "video" ? mediaUrl : "",
    imageUrl: asset.mediaType === "image" ? mediaUrl : undefined,
    thumbnailUrl: asset.mediaType === "image" ? mediaUrl : "",
    promptText: asset.promptText || "",
    position,
    notes: "",
    createdAt: asset.createdAt,
  };
}

export function vaultAssetToMovieClip(asset: VaultAsset, position = 0): MovieClip {
  const mediaUrl = `/api/vault/media/${encodeURIComponent(asset.assetId)}`;
  return {
    id: crypto.randomUUID(),
    type: asset.mediaType === "image" ? "image" : "video",
    videoUrl: asset.mediaType === "video" ? mediaUrl : undefined,
    imageUrl: asset.mediaType === "image" ? mediaUrl : undefined,
    sourceAssetId: asset.assetId,
    stillDuration: asset.mediaType === "image" ? 3 : undefined,
    transition: position === 0 ? { type: "cut", duration: 0 } : { type: "crossfade", duration: 0.5 },
    position,
  };
}
