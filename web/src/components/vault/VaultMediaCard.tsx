"use client";

import { ImageIcon, Play, Plus } from "lucide-react";
import Button from "@/components/ui/Button";
import type { VaultAsset } from "@/lib/vault-types";

export default function VaultMediaCard({
  asset,
  onOpen,
  onAddToCollection,
}: {
  asset: VaultAsset;
  onOpen: (asset: VaultAsset) => void;
  onAddToCollection: (asset: VaultAsset) => void;
}) {
  const mediaUrl = `/api/vault/media/${encodeURIComponent(asset.assetId)}`;
  const isImage = asset.mediaType === "image";

  return (
    <article className="overflow-hidden rounded-(--radius-card) border border-(--color-surface-200) bg-(--color-surface-0) shadow-(--shadow-card) dark:border-(--color-surface-800) dark:bg-(--color-surface-900)">
      <button type="button" onClick={() => onOpen(asset)} className="relative block aspect-[3/4] w-full bg-black text-left">
        {isImage ? (
          // eslint-disable-next-line @next/next/no-img-element -- R2 media is served through local API proxy.
          <img src={mediaUrl} alt={asset.promptText || asset.assetId} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <Play className="h-10 w-10 text-white/70" />
          </div>
        )}
      </button>
      <div className="space-y-2 p-3">
        <div className="flex items-center gap-2 text-xs text-(--color-surface-500)">
          {isImage ? <ImageIcon className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
          <span>{asset.mediaType}</span>
          <span>{asset.verificationStatus}</span>
        </div>
        <p className="truncate font-mono text-xs text-(--color-surface-500)">{asset.assetId}</p>
        {asset.promptText && <p className="line-clamp-2 text-sm text-(--color-surface-700) dark:text-(--color-surface-300)">{asset.promptText}</p>}
        <Button variant="secondary" size="sm" onClick={() => onAddToCollection(asset)}>
          <Plus className="h-3.5 w-3.5" />
          Add to Collection
        </Button>
      </div>
    </article>
  );
}
