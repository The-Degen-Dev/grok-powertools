"use client";

import { useEffect, useMemo, useState } from "react";
import Button from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import VaultLoadPanel from "./VaultLoadPanel";
import VaultGrid from "./VaultGrid";
import VaultMediaViewer from "./VaultMediaViewer";
import VaultRepairWorkbench from "./VaultRepairWorkbench";
import { createCollection, createMovie, getAllCollections, getAllMovies, getDB, updateCollection, updateMovie } from "@/lib/local-storage";
import { commitVaultPreview, getVaultAssets, getVaultOverlays, putVaultOverlay } from "@/lib/vault-storage";
import type { VaultAsset, VaultMediaType, VaultOverlay, VaultPreview, VaultSourceStatus } from "@/lib/vault-types";
import { fetchVaultPreview } from "@/lib/vault-client";
import { vaultAssetToMovieClip, vaultAssetToVideoItem } from "@/lib/vault-view-models";

type VaultViewMode = "grid" | "table";
type VisibilityFilter = "visible" | "all" | "hidden";

function emptyOverlay(assetId: string): VaultOverlay {
  return {
    assetId,
    tags: [],
    hidden: false,
    favorite: false,
    updatedAt: new Date(0).toISOString(),
    syncVersion: 0,
  };
}

function searchableAssetText(asset: VaultAsset): string {
  return [
    asset.assetId,
    asset.promptText,
    asset.canonicalObjectKey,
    ...asset.legacyObjectKeys,
    asset.grokPostId,
    asset.sourceUrl,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

async function writeClipboardText(text: string): Promise<void> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {
    // Fall back to the selection API below.
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("clipboard copy failed");
}

export default function VaultPage() {
  const [preview, setPreview] = useState<VaultPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [assets, setAssets] = useState<VaultAsset[]>([]);
  const [overlays, setOverlays] = useState<VaultOverlay[]>([]);
  const [viewerAsset, setViewerAsset] = useState<VaultAsset | null>(null);
  const [viewMode, setViewMode] = useState<VaultViewMode>("grid");
  const [search, setSearch] = useState("");
  const [mediaFilter, setMediaFilter] = useState<VaultMediaType | "all">("all");
  const [statusFilter, setStatusFilter] = useState<VaultSourceStatus | "all">("all");
  const [visibilityFilter, setVisibilityFilter] = useState<VisibilityFilter>("visible");
  const [selectedAssetIds, setSelectedAssetIds] = useState<Set<string>>(() => new Set());
  const { toast } = useToast();

  useEffect(() => {
    getDB()
      .then(async (db) => {
        const [nextAssets, nextOverlays] = await Promise.all([getVaultAssets(db), getVaultOverlays(db)]);
        setAssets(nextAssets);
        setOverlays(nextOverlays);
      })
      .catch(() => {
        setAssets([]);
        setOverlays([]);
      });
  }, []);

  const overlayByAssetId = useMemo(() => new Map(overlays.map((overlay) => [overlay.assetId, overlay])), [overlays]);
  const selectedAssets = useMemo(
    () => assets.filter((asset) => selectedAssetIds.has(asset.assetId)),
    [assets, selectedAssetIds],
  );
  const filteredAssets = useMemo(() => {
    const query = search.trim().toLowerCase();
    return assets.filter((asset) => {
      const overlay = overlayByAssetId.get(asset.assetId);
      if (mediaFilter !== "all" && asset.mediaType !== mediaFilter) return false;
      if (statusFilter !== "all" && asset.verificationStatus !== statusFilter) return false;
      if (visibilityFilter === "visible" && overlay?.hidden) return false;
      if (visibilityFilter === "hidden" && !overlay?.hidden) return false;
      if (query && !searchableAssetText(asset).includes(query)) return false;
      return true;
    });
  }, [assets, mediaFilter, overlayByAssetId, search, statusFilter, visibilityFilter]);

  async function handlePreview() {
    setLoading(true);
    try {
      setPreview(await fetchVaultPreview());
    } finally {
      setLoading(false);
    }
  }

  async function handleCommit() {
    if (!preview) return;
    const db = await getDB();
    await commitVaultPreview(db, preview);
    const [nextAssets, nextOverlays] = await Promise.all([getVaultAssets(db), getVaultOverlays(db)]);
    setAssets(nextAssets);
    setOverlays(nextOverlays);
  }

  async function handleAddToCollection(asset: VaultAsset) {
    await handleAddAssetsToCollection([asset]);
  }

  async function handleAddAssetsToCollection(nextAssets: VaultAsset[]) {
    if (nextAssets.length === 0) return;
    const collections = await getAllCollections();
    const existing = collections.find((collection) => collection.name === "New Collection");
    const existingAssetIds = new Set(existing?.items.map((item) => item.assetId).filter(Boolean));
    const newItems = nextAssets
      .filter((asset) => !existingAssetIds.has(asset.assetId))
      .map((asset, index) => ({
        ...vaultAssetToVideoItem(asset, (existing?.items.length || 0) + index),
        id: crypto.randomUUID(),
      }));
    if (newItems.length === 0) {
      toast("Already in New Collection", "info");
      return;
    }
    if (existing) {
      await updateCollection({ ...existing, items: [...existing.items, ...newItems] });
    } else {
      await createCollection("New Collection", newItems);
    }
    toast(newItems.length === 1 ? "Added to New Collection" : `Added ${newItems.length} assets to New Collection`, "success");
  }

  async function handleAddToMovie(asset: VaultAsset) {
    const movies = await getAllMovies();
    const existing = movies.find((movie) => movie.name === "Vault Movie");
    const movie = existing || (await createMovie("Vault Movie"));
    if (movie.clips.some((clip) => clip.sourceAssetId === asset.assetId)) {
      toast("Already in Vault Movie", "info");
      return;
    }
    movie.clips.push(vaultAssetToMovieClip(asset, movie.clips.length));
    await updateMovie(movie);
    toast("Added to Vault Movie", "success");
  }

  async function handleCopyPrompt(asset: VaultAsset) {
    if (!asset.promptText) return;
    try {
      await writeClipboardText(asset.promptText);
      toast("Prompt copied", "success");
    } catch {
      toast("Prompt copy failed", "error");
    }
  }

  function handleSelectionChange(assetId: string, selected: boolean) {
    setSelectedAssetIds((current) => {
      const next = new Set(current);
      if (selected) {
        next.add(assetId);
      } else {
        next.delete(assetId);
      }
      return next;
    });
  }

  async function handleOverlayChange(assetId: string, patch: Partial<Pick<VaultOverlay, "favorite" | "hidden" | "notes" | "tags">>) {
    const current = overlayByAssetId.get(assetId) || emptyOverlay(assetId);
    const nextOverlay: VaultOverlay = {
      ...current,
      ...patch,
      updatedAt: new Date().toISOString(),
      syncVersion: (current.syncVersion || 0) + 1,
    };
    setOverlays((currentOverlays) => {
      const withoutCurrent = currentOverlays.filter((overlay) => overlay.assetId !== assetId);
      return [...withoutCurrent, nextOverlay];
    });
    const db = await getDB();
    await putVaultOverlay(db, nextOverlay);
  }

  async function handleBulkFavorite() {
    await Promise.all(selectedAssets.map((asset) => handleOverlayChange(asset.assetId, { favorite: true })));
    toast(`Favorited ${selectedAssets.length} selected`, "success");
  }

  async function handleBulkHide() {
    await Promise.all(selectedAssets.map((asset) => handleOverlayChange(asset.assetId, { hidden: true })));
    setSelectedAssetIds(new Set());
    toast(`Hid ${selectedAssets.length} selected locally`, "success");
  }

  return (
    <div className="mx-auto max-w-screen-2xl px-6 py-8">
      <VaultLoadPanel onPreview={handlePreview} />
      {loading && <p className="mt-4 text-sm text-(--color-surface-500)">Loading Vault preview...</p>}
      {preview && (
        <section className="mt-6 rounded-(--radius-card) border border-(--color-surface-200) bg-(--color-surface-0) p-4 dark:border-(--color-surface-800) dark:bg-(--color-surface-900)">
          <h2 className="text-sm font-semibold">Preview</h2>
          <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-(--color-surface-500)">
              {preview.counts.assets} assets, {preview.counts.images} images, {preview.counts.videos} videos, {preview.counts.prompts} prompts.
            </p>
            <Button variant="primary" onClick={handleCommit}>
              Commit Vault
            </Button>
          </div>
        </section>
      )}
      <VaultRepairWorkbench />
      <section className="mt-6">
        <VaultGrid
          assets={filteredAssets}
          allAssetsCount={assets.length}
          overlays={overlayByAssetId}
          viewMode={viewMode}
          search={search}
          mediaFilter={mediaFilter}
          statusFilter={statusFilter}
          visibilityFilter={visibilityFilter}
          selectedAssetIds={selectedAssetIds}
          onViewModeChange={setViewMode}
          onSearchChange={setSearch}
          onMediaFilterChange={setMediaFilter}
          onStatusFilterChange={setStatusFilter}
          onVisibilityFilterChange={setVisibilityFilter}
          onSelectionChange={handleSelectionChange}
          onClearSelection={() => setSelectedAssetIds(new Set())}
          onBulkFavorite={handleBulkFavorite}
          onBulkHide={handleBulkHide}
          onOpen={setViewerAsset}
          onCopyPrompt={handleCopyPrompt}
          onAddToCollection={handleAddToCollection}
          onAddToMovie={handleAddToMovie}
          onOverlayChange={handleOverlayChange}
        />
      </section>
      <VaultMediaViewer asset={viewerAsset} onClose={() => setViewerAsset(null)} />
    </div>
  );
}
