"use client";

import { Film, Grid2X2, List } from "lucide-react";
import Button from "@/components/ui/Button";
import type { VaultAsset, VaultMediaType, VaultOverlay, VaultSourceStatus } from "@/lib/vault-types";
import VaultMediaCard from "./VaultMediaCard";

type VaultViewMode = "grid" | "table";
type VisibilityFilter = "visible" | "all" | "hidden";

export default function VaultGrid({
  assets,
  allAssetsCount,
  overlays,
  viewMode,
  search,
  mediaFilter,
  statusFilter,
  visibilityFilter,
  selectedAssetIds,
  onViewModeChange,
  onSearchChange,
  onMediaFilterChange,
  onStatusFilterChange,
  onVisibilityFilterChange,
  onSelectionChange,
  onClearSelection,
  onBulkFavorite,
  onBulkHide,
  onOpen,
  onCopyPrompt,
  onAddToCollection,
  onAddToMovie,
  onOverlayChange,
  onBuildMovies,
}: {
  assets: VaultAsset[];
  allAssetsCount: number;
  overlays: Map<string, VaultOverlay>;
  viewMode: VaultViewMode;
  search: string;
  mediaFilter: VaultMediaType | "all";
  statusFilter: VaultSourceStatus | "all";
  visibilityFilter: VisibilityFilter;
  selectedAssetIds: Set<string>;
  onViewModeChange: (mode: VaultViewMode) => void;
  onSearchChange: (value: string) => void;
  onMediaFilterChange: (value: VaultMediaType | "all") => void;
  onStatusFilterChange: (value: VaultSourceStatus | "all") => void;
  onVisibilityFilterChange: (value: VisibilityFilter) => void;
  onSelectionChange: (assetId: string, selected: boolean) => void;
  onClearSelection: () => void;
  onBulkFavorite: () => void;
  onBulkHide: () => void;
  onOpen: (asset: VaultAsset) => void;
  onCopyPrompt: (asset: VaultAsset) => void;
  onAddToCollection: (asset: VaultAsset) => void;
  onAddToMovie: (asset: VaultAsset) => void;
  onOverlayChange: (assetId: string, patch: Partial<Pick<VaultOverlay, "favorite" | "hidden" | "notes" | "tags">>) => void;
  onBuildMovies: () => void;
}) {
  const selectedCount = selectedAssetIds.size;

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 rounded-(--radius-card) border border-(--color-surface-200) bg-(--color-surface-0) p-3 dark:border-(--color-surface-800) dark:bg-(--color-surface-900)">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <input
            type="search"
            aria-label="Search Vault assets"
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search asset, prompt, object key"
            className="min-w-0 flex-1 rounded-(--radius-input) border border-(--color-surface-200) bg-transparent px-3 py-2 text-sm outline-none focus:border-(--color-accent) dark:border-(--color-surface-700)"
          />
          <select
            aria-label="Media filter"
            value={mediaFilter}
            onChange={(event) => onMediaFilterChange(event.target.value as VaultMediaType | "all")}
            className="rounded-(--radius-input) border border-(--color-surface-200) bg-transparent px-3 py-2 text-sm dark:border-(--color-surface-700)"
          >
            <option value="all">All media</option>
            <option value="image">Images</option>
            <option value="video">Videos</option>
            <option value="unknown">Unknown</option>
          </select>
          <select
            aria-label="Status filter"
            value={statusFilter}
            onChange={(event) => onStatusFilterChange(event.target.value as VaultSourceStatus | "all")}
            className="rounded-(--radius-input) border border-(--color-surface-200) bg-transparent px-3 py-2 text-sm dark:border-(--color-surface-700)"
          >
            <option value="all">All status</option>
            <option value="verified">Verified</option>
            <option value="blocked">Blocked</option>
            <option value="failed">Failed</option>
            <option value="unproven">Unproven</option>
          </select>
          <select
            aria-label="Visibility filter"
            value={visibilityFilter}
            onChange={(event) => onVisibilityFilterChange(event.target.value as VisibilityFilter)}
            className="rounded-(--radius-input) border border-(--color-surface-200) bg-transparent px-3 py-2 text-sm dark:border-(--color-surface-700)"
          >
            <option value="visible">Visible</option>
            <option value="all">All visibility</option>
            <option value="hidden">Hidden</option>
          </select>
          <div className="flex items-center gap-1">
            <Button variant={viewMode === "grid" ? "primary" : "secondary"} size="sm" onClick={() => onViewModeChange("grid")} aria-label="Grid view">
              <Grid2X2 className="h-3.5 w-3.5" />
            </Button>
            <Button variant={viewMode === "table" ? "primary" : "secondary"} size="sm" onClick={() => onViewModeChange("table")} aria-label="Table view">
              <List className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
        <div className="flex flex-col gap-2 text-xs text-(--color-surface-500) sm:flex-row sm:items-center sm:justify-between">
          <span>
            Showing {assets.length} of {allAssetsCount} assets
          </span>
          {selectedCount > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span>{selectedCount} selected</span>
              <Button size="sm" variant="primary" onClick={onBuildMovies}>
                <Film className="h-3.5 w-3.5" />
                Build Movies
              </Button>
              <Button size="sm" onClick={onBulkFavorite}>Favorite selected</Button>
              <Button size="sm" variant="danger" onClick={onBulkHide}>Hide selected locally</Button>
              <Button size="sm" variant="ghost" onClick={onClearSelection}>Clear selection</Button>
            </div>
          )}
          {selectedCount === 0 && (
            <Button size="sm" variant="secondary" onClick={onBuildMovies}>
              <Film className="h-3.5 w-3.5" />
              Build Movies
            </Button>
          )}
        </div>
      </div>

      {allAssetsCount === 0 ? (
        <p className="py-10 text-center text-sm text-(--color-surface-500)">No Vault assets committed locally.</p>
      ) : assets.length === 0 ? (
        <p className="py-10 text-center text-sm text-(--color-surface-500)">No Vault assets match the current filters.</p>
      ) : viewMode === "grid" ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
          {assets.map((asset) => (
            <VaultMediaCard
              key={asset.assetId}
              asset={asset}
              overlay={overlays.get(asset.assetId)}
              selected={selectedAssetIds.has(asset.assetId)}
              onSelectedChange={onSelectionChange}
              onOpen={onOpen}
              onCopyPrompt={onCopyPrompt}
              onAddToCollection={onAddToCollection}
              onAddToMovie={onAddToMovie}
              onOverlayChange={onOverlayChange}
            />
          ))}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-(--radius-card) border border-(--color-surface-200) bg-(--color-surface-0) dark:border-(--color-surface-800) dark:bg-(--color-surface-900)">
          <table className="min-w-full divide-y divide-(--color-surface-200) text-sm dark:divide-(--color-surface-800)">
            <thead className="bg-(--color-surface-50) text-left text-xs uppercase text-(--color-surface-500) dark:bg-(--color-surface-950)">
              <tr>
                <th className="w-10 px-3 py-2" scope="col">Select</th>
                <th className="px-3 py-2" scope="col">Asset</th>
                <th className="px-3 py-2" scope="col">Prompt</th>
                <th className="px-3 py-2" scope="col">Object key</th>
                <th className="px-3 py-2" scope="col">Status</th>
                <th className="px-3 py-2" scope="col">Source</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-(--color-surface-100) dark:divide-(--color-surface-800)">
              {assets.map((asset) => (
                <tr key={asset.assetId}>
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      aria-label={`Select ${asset.assetId}`}
                      checked={selectedAssetIds.has(asset.assetId)}
                      onChange={(event) => onSelectionChange(asset.assetId, event.target.checked)}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <button type="button" onClick={() => onOpen(asset)} className="font-mono text-xs text-(--color-accent)">
                      {asset.assetId}
                    </button>
                  </td>
                  <td className="max-w-md truncate px-3 py-2">{asset.promptText || "-"}</td>
                  <td className="max-w-sm truncate px-3 py-2 font-mono text-xs">{asset.canonicalObjectKey || asset.legacyObjectKeys[0] || "-"}</td>
                  <td className="px-3 py-2">{asset.mediaType} / {asset.verificationStatus}</td>
                  <td className="px-3 py-2">
                    {asset.sourceUrl ? (
                      <a href={asset.sourceUrl} target="_blank" rel="noreferrer" aria-label={`Open source for ${asset.assetId}`} className="text-(--color-accent) hover:underline">
                        Open source
                      </a>
                    ) : (
                      <span className="text-(--color-surface-400)">Unknown</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
