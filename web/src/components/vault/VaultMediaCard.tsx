"use client";

import { Copy, ExternalLink, EyeOff, Film, ImageIcon, Play, Plus, Star } from "lucide-react";
import Button from "@/components/ui/Button";
import type { VaultAsset, VaultOverlay } from "@/lib/vault-types";
import { isVaultImageAsset } from "@/lib/vault-media";

export default function VaultMediaCard({
  asset,
  overlay,
  selected,
  onSelectedChange,
  onOpen,
  onCopyPrompt,
  onAddToCollection,
  onAddToMovie,
  onOverlayChange,
}: {
  asset: VaultAsset;
  overlay?: VaultOverlay;
  selected: boolean;
  onSelectedChange: (assetId: string, selected: boolean) => void;
  onOpen: (asset: VaultAsset) => void;
  onCopyPrompt: (asset: VaultAsset) => void;
  onAddToCollection: (asset: VaultAsset) => void;
  onAddToMovie: (asset: VaultAsset) => void;
  onOverlayChange: (assetId: string, patch: Partial<Pick<VaultOverlay, "favorite" | "hidden" | "notes" | "tags">>) => void;
}) {
  const mediaUrl = `/api/vault/media/${encodeURIComponent(asset.assetId)}`;
  const isImage = isVaultImageAsset(asset);
  const tags = overlay?.tags || [];
  const objectKey = asset.canonicalObjectKey || asset.legacyObjectKeys[0] || "";

  return (
    <article className={`overflow-hidden rounded-(--radius-card) border bg-(--color-surface-0) shadow-(--shadow-card) dark:bg-(--color-surface-900) ${selected ? "border-(--color-accent)" : "border-(--color-surface-200) dark:border-(--color-surface-800)"}`}>
      <div className="flex items-center justify-between border-b border-(--color-surface-100) px-3 py-2 dark:border-(--color-surface-800)">
        <label className="flex items-center gap-2 text-xs text-(--color-surface-500)">
          <input
            type="checkbox"
            aria-label={`Select ${asset.assetId}`}
            checked={selected}
            onChange={(event) => onSelectedChange(asset.assetId, event.target.checked)}
          />
          Select
        </label>
        <div className="flex items-center gap-1">
          {overlay?.favorite && <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" aria-label="Favorite" />}
          {overlay?.hidden && <EyeOff className="h-3.5 w-3.5 text-(--color-surface-400)" aria-label="Hidden" />}
        </div>
      </div>
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
        <button type="button" onClick={() => onOpen(asset)} className="block w-full space-y-2 text-left">
          <span className="block truncate font-mono text-xs text-(--color-surface-500)">{asset.assetId}</span>
          {objectKey && <span className="block truncate font-mono text-[11px] text-(--color-surface-400)">{objectKey}</span>}
          {asset.promptText && <span className="line-clamp-2 text-sm text-(--color-surface-700) dark:text-(--color-surface-300)">{asset.promptText}</span>}
        </button>
        <div className="grid grid-cols-2 gap-1.5">
          <Button variant="secondary" size="sm" onClick={() => onCopyPrompt(asset)} disabled={!asset.promptText} aria-label={`Copy prompt for ${asset.assetId}`}>
            <Copy className="h-3.5 w-3.5" />
            Copy
          </Button>
          {asset.sourceUrl ? (
            <a
              href={asset.sourceUrl}
              target="_blank"
              rel="noreferrer"
              aria-label={`Open source for ${asset.assetId}`}
              className="inline-flex items-center justify-center gap-1 rounded-(--radius-btn) border border-(--color-surface-200) px-2.5 py-1 text-xs font-medium text-(--color-surface-700) transition-colors hover:bg-(--color-surface-50) dark:border-(--color-surface-700) dark:text-(--color-surface-300) dark:hover:bg-(--color-surface-800)"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Source
            </a>
          ) : (
            <Button variant="secondary" size="sm" disabled>
              <ExternalLink className="h-3.5 w-3.5" />
              Source
            </Button>
          )}
          <Button variant="secondary" size="sm" onClick={() => onAddToCollection(asset)}>
            <Plus className="h-3.5 w-3.5" />
            Add to Collection
          </Button>
          <Button variant="secondary" size="sm" onClick={() => onAddToMovie(asset)} aria-label={`Add ${asset.assetId} to movie`}>
            <Film className="h-3.5 w-3.5" />
            Add to Movie
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          <Button
            variant={overlay?.favorite ? "primary" : "secondary"}
            size="sm"
            onClick={() => onOverlayChange(asset.assetId, { favorite: !overlay?.favorite })}
            aria-label={`Favorite ${asset.assetId}`}
          >
            <Star className="h-3.5 w-3.5" />
            Favorite
          </Button>
          <Button
            variant={overlay?.hidden ? "primary" : "secondary"}
            size="sm"
            onClick={() => onOverlayChange(asset.assetId, { hidden: !overlay?.hidden })}
            aria-label={`Hide ${asset.assetId}`}
          >
            <EyeOff className="h-3.5 w-3.5" />
            Hide
          </Button>
        </div>
        <input
          type="text"
          aria-label={`Tags for ${asset.assetId}`}
          value={tags.join(", ")}
          onChange={(event) =>
            onOverlayChange(asset.assetId, {
              tags: event.target.value
                .split(",")
                .map((tag) => tag.trim())
                .filter(Boolean),
            })
          }
          placeholder="Tags"
          className="w-full rounded-(--radius-input) border border-(--color-surface-200) bg-transparent px-2 py-1.5 text-xs outline-none focus:border-(--color-accent) dark:border-(--color-surface-700)"
        />
        <textarea
          aria-label={`Notes for ${asset.assetId}`}
          value={overlay?.notes || ""}
          onChange={(event) => onOverlayChange(asset.assetId, { notes: event.target.value })}
          placeholder="Notes"
          rows={2}
          className="w-full resize-none rounded-(--radius-input) border border-(--color-surface-200) bg-transparent px-2 py-1.5 text-xs outline-none focus:border-(--color-accent) dark:border-(--color-surface-700)"
        />
      </div>
    </article>
  );
}
