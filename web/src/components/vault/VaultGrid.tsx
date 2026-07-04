"use client";

import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Archive, EyeOff, Film, Grid2X2, Keyboard, List, Search, Star } from "lucide-react";
import Button from "@/components/ui/Button";
import BulkActionBar from "@/components/ui/BulkActionBar";
import EmptyState from "@/components/ui/EmptyState";
import { Toolbar, ToolbarGroup } from "@/components/ui/Toolbar";
import type { VaultAsset, VaultMediaType, VaultOverlay, VaultSourceStatus } from "@/lib/vault-types";
import VaultMediaCard, { vaultAssetDisplayTitle } from "./VaultMediaCard";

type VaultViewMode = "grid" | "table";
type VisibilityFilter = "visible" | "all" | "hidden";
type OverlayPatch = Partial<Pick<VaultOverlay, "favorite" | "hidden" | "notes" | "tags" | "title">>;

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(target.closest("input, textarea, select, button, a, [contenteditable='true']"));
}

function SkeletonGrid() {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-[var(--space-2)]" aria-label="Loading Vault assets">
      {Array.from({ length: 12 }, (_, index) => (
        <div key={index} className="overflow-hidden rounded-(--radius) border border-(--hairline) bg-(--surface-raised) dark:bg-(--surface-panel)">
          <div className="skeleton aspect-[4/3]" />
          <div className="space-y-1 px-[var(--space-2)] py-[var(--space-2)]">
            <div className="skeleton h-3 w-4/5 rounded-(--radius-sm)" />
            <div className="skeleton h-3 w-1/2 rounded-(--radius-sm)" />
          </div>
        </div>
      ))}
    </div>
  );
}

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
  loading = false,
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
  loading?: boolean;
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
  onOverlayChange: (assetId: string, patch: OverlayPatch) => void;
  onBuildMovies: () => void;
}) {
  const cardRefs = useRef(new Map<string, HTMLElement>());
  const [focusedAssetId, setFocusedAssetId] = useState<string | null>(null);
  const selectedCount = selectedAssetIds.size;
  const selectedInViewCount = useMemo(
    () => assets.filter((asset) => selectedAssetIds.has(asset.assetId)).length,
    [assets, selectedAssetIds],
  );
  const activeFocusedAssetId = focusedAssetId && assets.some((asset) => asset.assetId === focusedAssetId) ? focusedAssetId : assets[0]?.assetId || null;

  function registerCard(assetId: string) {
    return (node: HTMLElement | null) => {
      if (node) {
        cardRefs.current.set(assetId, node);
      } else {
        cardRefs.current.delete(assetId);
      }
    };
  }

  function focusAssetAt(index: number) {
    if (assets.length === 0) return;
    const nextIndex = Math.max(0, Math.min(index, assets.length - 1));
    const assetId = assets[nextIndex].assetId;
    setFocusedAssetId(assetId);
    window.requestAnimationFrame(() => cardRefs.current.get(assetId)?.focus());
  }

  function handleCardKeyDown(event: KeyboardEvent<HTMLElement>, asset: VaultAsset, index: number) {
    if (isEditableTarget(event.target)) return;

    const next = () => focusAssetAt(index + 1);
    const previous = () => focusAssetAt(index - 1);

    if (event.code === "ArrowRight" || event.code === "ArrowDown" || event.code === "KeyJ") {
      event.preventDefault();
      next();
      return;
    }
    if (event.code === "ArrowLeft" || event.code === "ArrowUp") {
      event.preventDefault();
      previous();
      return;
    }
    if (event.code === "Space") {
      event.preventDefault();
      onSelectionChange(asset.assetId, !selectedAssetIds.has(asset.assetId));
      return;
    }
    if (event.code === "Enter") {
      event.preventDefault();
      onOpen(asset);
      return;
    }
    if (event.code === "Escape") {
      event.preventDefault();
      onClearSelection();
      return;
    }
    if (event.code === "KeyF") {
      event.preventDefault();
      onOverlayChange(asset.assetId, { favorite: !overlays.get(asset.assetId)?.favorite });
      return;
    }
    if (event.code === "KeyH") {
      event.preventDefault();
      onOverlayChange(asset.assetId, { hidden: true });
    }
  }

  const controlClass =
    "h-8 rounded-(--radius) border border-(--hairline) bg-transparent px-[var(--space-2)] text-[length:var(--text-13)] text-(--color-surface-700) outline-none focus:border-(--state-accent) dark:text-(--color-surface-200)";

  return (
    <div className="space-y-[var(--space-3)]">
      <Toolbar>
        <div className="flex flex-col gap-[var(--space-3)]">
          <ToolbarGroup className="lg:flex-nowrap">
            <div className="relative min-w-[220px] flex-1">
              <Search className="pointer-events-none absolute left-[var(--space-2)] top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-(--color-surface-500)" />
              <input
                type="search"
                aria-label="Search Vault assets"
                value={search}
                onChange={(event) => onSearchChange(event.target.value)}
                placeholder="Search prompt, source, local details"
                className={`${controlClass} w-full pl-8`}
              />
            </div>
            <select
              aria-label="Media filter"
              value={mediaFilter}
              onChange={(event) => onMediaFilterChange(event.target.value as VaultMediaType | "all")}
              className={controlClass}
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
              className={controlClass}
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
              className={controlClass}
            >
              <option value="visible">Visible</option>
              <option value="all">All visibility</option>
              <option value="hidden">Hidden</option>
            </select>
            <div className="flex items-center gap-[var(--space-1)]">
              <Button variant={viewMode === "grid" ? "primary" : "secondary"} size="sm" onClick={() => onViewModeChange("grid")} aria-label="Grid view">
                <Grid2X2 className="h-3.5 w-3.5" />
              </Button>
              <Button variant={viewMode === "table" ? "primary" : "secondary"} size="sm" onClick={() => onViewModeChange("table")} aria-label="Table view">
                <List className="h-3.5 w-3.5" />
              </Button>
            </div>
            <Button size="sm" variant="primary" onClick={onBuildMovies} aria-label="Build movies from current Vault filters">
              <Film className="h-3.5 w-3.5" />
              Build Movies
            </Button>
          </ToolbarGroup>

          <div className="flex flex-col gap-[var(--space-2)] text-[length:var(--text-12)] text-(--color-surface-500) md:flex-row md:items-center md:justify-between">
            <span>
              Showing {assets.length} of {allAssetsCount} assets{selectedCount > 0 ? ` · ${selectedCount} selected, ${selectedInViewCount} in view` : ""}
            </span>
            <span className="inline-flex items-center gap-[var(--space-1)]">
              <Keyboard className="h-3.5 w-3.5" aria-hidden="true" />
              Arrows/J move, Space select, Enter open, F favorite, H hide
            </span>
          </div>
        </div>
      </Toolbar>

      {loading ? (
        <SkeletonGrid />
      ) : allAssetsCount === 0 ? (
        <EmptyState
          icon={Archive}
          title="No Vault assets committed locally"
          description="Preview and commit the Vault above to load media into this local workspace."
        />
      ) : assets.length === 0 ? (
        <EmptyState
          icon={Search}
          title="No Vault assets match these filters"
          description="Clear search or switch media, status, or visibility filters to recover the grid."
          action={<Button onClick={() => onSearchChange("")}>Clear search</Button>}
        />
      ) : viewMode === "grid" ? (
        <div role="grid" aria-label="Vault media grid" className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-[var(--space-2)]">
          {assets.map((asset, index) => (
            <VaultMediaCard
              key={asset.assetId}
              asset={asset}
              overlay={overlays.get(asset.assetId)}
              selected={selectedAssetIds.has(asset.assetId)}
              focused={activeFocusedAssetId === asset.assetId}
              displayIndex={index}
              cardRef={registerCard(asset.assetId)}
              tabIndex={activeFocusedAssetId === asset.assetId ? 0 : -1}
              onFocus={() => setFocusedAssetId(asset.assetId)}
              onKeyDown={(event) => handleCardKeyDown(event, asset, index)}
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
        <div className="overflow-x-auto rounded-(--radius) border border-(--hairline) bg-(--surface-raised) dark:bg-(--surface-panel)">
          <table className="min-w-full divide-y divide-(--hairline) text-[length:var(--text-13)]">
            <thead className="bg-(--surface-panel) text-left text-[length:var(--text-11)] uppercase text-(--color-surface-500)">
              <tr>
                <th className="w-10 px-[var(--space-3)] py-[var(--space-2)]" scope="col">Select</th>
                <th className="px-[var(--space-3)] py-[var(--space-2)]" scope="col">Title</th>
                <th className="px-[var(--space-3)] py-[var(--space-2)]" scope="col">Prompt</th>
                <th className="px-[var(--space-3)] py-[var(--space-2)]" scope="col">Status</th>
                <th className="px-[var(--space-3)] py-[var(--space-2)]" scope="col">Source</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-(--hairline)">
              {assets.map((asset, index) => {
                const title = vaultAssetDisplayTitle(asset, overlays.get(asset.assetId), index);
                return (
                  <tr key={asset.assetId}>
                    <td className="px-[var(--space-3)] py-[var(--space-2)]">
                      <input
                        type="checkbox"
                        aria-label={`Select ${asset.assetId}`}
                        checked={selectedAssetIds.has(asset.assetId)}
                        onChange={(event) => onSelectionChange(asset.assetId, event.target.checked)}
                      />
                    </td>
                    <td className="max-w-xs px-[var(--space-3)] py-[var(--space-2)]">
                      <button type="button" onClick={() => onOpen(asset)} className="truncate font-medium text-(--state-accent-fg) dark:text-(--state-accent-fg)" aria-label={`Open ${asset.assetId} details`}>
                        {title}
                      </button>
                    </td>
                    <td className="max-w-md truncate px-[var(--space-3)] py-[var(--space-2)]">{asset.promptText || "-"}</td>
                    <td className="px-[var(--space-3)] py-[var(--space-2)] capitalize">{asset.mediaType} / {asset.verificationStatus}</td>
                    <td className="px-[var(--space-3)] py-[var(--space-2)]">
                      {asset.sourceUrl ? (
                        <a href={asset.sourceUrl} target="_blank" rel="noreferrer" aria-label={`Open source for ${asset.assetId}`} className="text-(--state-accent-fg) hover:underline dark:text-(--state-accent-fg)">
                          Open source
                        </a>
                      ) : (
                        <span className="text-(--state-muted-fg)">Unknown</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <BulkActionBar selectedCount={selectedCount} selectedInViewCount={selectedInViewCount} onClear={onClearSelection}>
        <Button size="sm" variant="primary" onClick={onBuildMovies}>
          <Film className="h-3.5 w-3.5" />
          Build selected movies
        </Button>
        <Button size="sm" onClick={onBulkFavorite}>
          <Star className="h-3.5 w-3.5" />
          Favorite
        </Button>
        <Button size="sm" variant="danger" onClick={onBulkHide}>
          <EyeOff className="h-3.5 w-3.5" />
          Hide
        </Button>
      </BulkActionBar>
    </div>
  );
}
