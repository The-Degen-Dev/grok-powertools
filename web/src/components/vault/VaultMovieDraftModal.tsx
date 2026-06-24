"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Button from "@/components/ui/Button";
import Modal from "@/components/ui/Modal";
import type { Movie } from "@/lib/types";
import { createMoviesFromVaultDrafts } from "@/lib/vault-movie-draft-storage";
import {
  buildVaultMovieDrafts,
  type VaultDraftRecipe,
  type VaultDraftScope,
} from "@/lib/vault-movie-drafts";
import type { VaultAsset, VaultOverlay } from "@/lib/vault-types";

function defaultScopeForSelection(selectedAssetIds: string[]): VaultDraftScope {
  return selectedAssetIds.length > 0 ? "selected" : "filtered";
}

function defaultRecipeForSelection(selectedAssetIds: string[]): VaultDraftRecipe {
  return selectedAssetIds.length > 0 ? "selected" : "recent";
}

export default function VaultMovieDraftModal({
  open,
  onClose,
  assets,
  overlays,
  filteredAssetIds,
  selectedAssetIds,
  defaultOpenFirstMovie = false,
}: {
  open: boolean;
  onClose: () => void;
  assets: VaultAsset[];
  overlays: VaultOverlay[];
  filteredAssetIds: string[];
  selectedAssetIds: string[];
  defaultOpenFirstMovie?: boolean;
}) {
  const router = useRouter();
  const [scope, setScope] = useState<VaultDraftScope>(() => defaultScopeForSelection(selectedAssetIds));
  const [recipe, setRecipe] = useState<VaultDraftRecipe>(() => defaultRecipeForSelection(selectedAssetIds));
  const [maxClipsPerMovie, setMaxClipsPerMovie] = useState(10);
  const [maxMovies, setMaxMovies] = useState(4);
  const [openFirstMovie, setOpenFirstMovie] = useState(defaultOpenFirstMovie);
  const [creating, setCreating] = useState(false);
  const [createdMovies, setCreatedMovies] = useState<Movie[]>([]);
  const [createdSkippedCount, setCreatedSkippedCount] = useState(0);

  useEffect(() => {
    if (!open) return;
    setScope(defaultScopeForSelection(selectedAssetIds));
    setRecipe(defaultRecipeForSelection(selectedAssetIds));
    setMaxClipsPerMovie(10);
    setMaxMovies(4);
    setOpenFirstMovie(defaultOpenFirstMovie);
    setCreating(false);
    setCreatedMovies([]);
    setCreatedSkippedCount(0);
  }, [defaultOpenFirstMovie, open, selectedAssetIds]);

  const preview = useMemo(
    () =>
      buildVaultMovieDrafts(
        { assets, overlays, filteredAssetIds, selectedAssetIds },
        { recipe, scope, maxClipsPerMovie, maxMovies },
      ),
    [assets, filteredAssetIds, maxClipsPerMovie, maxMovies, overlays, recipe, scope, selectedAssetIds],
  );

  async function handleCreate() {
    if (creating || preview.movies.length === 0) return;
    setCreating(true);
    try {
      const movies = await createMoviesFromVaultDrafts(preview.movies);
      setCreatedMovies(movies);
      setCreatedSkippedCount(preview.skipped.length);
      if (openFirstMovie && movies[0]) {
        router.push(`/movie?id=${movies[0].id}`);
      }
    } finally {
      setCreating(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Build Movies from Vault" className="max-w-xl">
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-xs text-(--color-surface-500)">
            Source scope
            <select
              aria-label="Source scope"
              value={scope}
              onChange={(event) => setScope(event.target.value as VaultDraftScope)}
              className="w-full rounded-(--radius-input) border border-(--color-surface-200) bg-transparent px-3 py-2 text-sm dark:border-(--color-surface-700)"
            >
              <option value="selected">Selected videos</option>
              <option value="filtered">Current non-hidden filtered set</option>
              <option value="visible-verified">All non-hidden verified videos</option>
              <option value="favorites">Favorite videos</option>
            </select>
          </label>
          <label className="space-y-1 text-xs text-(--color-surface-500)">
            Recipe
            <select
              aria-label="Recipe"
              value={recipe}
              onChange={(event) => setRecipe(event.target.value as VaultDraftRecipe)}
              className="w-full rounded-(--radius-input) border border-(--color-surface-200) bg-transparent px-3 py-2 text-sm dark:border-(--color-surface-700)"
            >
              <option value="recent">Recent Video Drafts</option>
              <option value="selected">Selected Video Drafts</option>
              <option value="favorites">Favorite Drafts</option>
              <option value="prompt-groups">Prompt Group Drafts</option>
            </select>
          </label>
          <label className="space-y-1 text-xs text-(--color-surface-500)">
            Max clips per movie
            <input
              aria-label="Max clips per movie"
              type="number"
              min={1}
              max={100}
              value={maxClipsPerMovie}
              onChange={(event) => setMaxClipsPerMovie(Number(event.target.value))}
              className="w-full rounded-(--radius-input) border border-(--color-surface-200) bg-transparent px-3 py-2 text-sm dark:border-(--color-surface-700)"
            />
          </label>
          <label className="space-y-1 text-xs text-(--color-surface-500)">
            Max movies
            <input
              aria-label="Max movies"
              type="number"
              min={1}
              max={20}
              value={maxMovies}
              onChange={(event) => setMaxMovies(Number(event.target.value))}
              className="w-full rounded-(--radius-input) border border-(--color-surface-200) bg-transparent px-3 py-2 text-sm dark:border-(--color-surface-700)"
            />
          </label>
          <label className="space-y-1 text-xs text-(--color-surface-500)">
            Transition
            <select
              aria-label="Transition"
              value="cut"
              disabled
              className="w-full rounded-(--radius-input) border border-(--color-surface-200) bg-transparent px-3 py-2 text-sm disabled:opacity-70 dark:border-(--color-surface-700)"
            >
              <option value="cut">Cut</option>
            </select>
          </label>
        </div>
        <label className="flex items-center gap-2 text-sm text-(--color-surface-600) dark:text-(--color-surface-300)">
          <input
            type="checkbox"
            checked={openFirstMovie}
            onChange={(event) => setOpenFirstMovie(event.target.checked)}
          />
          Open the first movie after creation
        </label>
        <div className="rounded-(--radius-card) border border-(--color-surface-200) p-3 text-sm dark:border-(--color-surface-700)">
          <p>{preview.consideredCount} source assets considered</p>
          <p>{preview.eligibleCount} eligible videos</p>
          <p>
            {preview.movies.length} movie draft{preview.movies.length === 1 ? "" : "s"} ready
          </p>
          <p>
            {preview.skipped.length} skipped asset{preview.skipped.length === 1 ? "" : "s"}
          </p>
        </div>
        {createdMovies.length > 0 && (
          <div className="space-y-2 rounded-(--radius-card) bg-green-50 p-3 text-sm text-green-700 dark:bg-green-950 dark:text-green-300">
            <p>
              Created {createdMovies.length} movie draft{createdMovies.length === 1 ? "" : "s"}. Skipped{" "}
              {createdSkippedCount} asset{createdSkippedCount === 1 ? "" : "s"}.
            </p>
            <div className="flex flex-wrap gap-2">
              {createdMovies.map((movie) => (
                <a
                  key={movie.id}
                  href={`/movie?id=${movie.id}`}
                  className="rounded-(--radius-btn) bg-white px-2.5 py-1 text-xs font-medium text-green-800 hover:underline dark:bg-green-900 dark:text-green-100"
                >
                  {movie.name}
                </a>
              ))}
            </div>
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          <Button variant="primary" onClick={handleCreate} disabled={creating || preview.movies.length === 0}>
            {creating ? "Creating..." : "Create movie drafts"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
