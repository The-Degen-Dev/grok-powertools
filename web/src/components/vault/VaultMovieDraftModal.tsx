"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, ListChecks, ShieldCheck, Video } from "lucide-react";
import Button from "@/components/ui/Button";
import Modal from "@/components/ui/Modal";
import type { Movie } from "@/lib/types";
import { createMoviesFromVaultDrafts } from "@/lib/vault-movie-draft-storage";
import {
  buildVaultMovieDrafts,
  type VaultDraftRecipe,
  type VaultDraftSkippedAsset,
  type VaultDraftScope,
} from "@/lib/vault-movie-drafts";
import type { VaultAsset, VaultOverlay } from "@/lib/vault-types";

function defaultScopeForSelection(selectedAssetIds: string[]): VaultDraftScope {
  return selectedAssetIds.length > 0 ? "selected" : "filtered";
}

function defaultRecipeForSelection(selectedAssetIds: string[]): VaultDraftRecipe {
  return selectedAssetIds.length > 0 ? "selected" : "recent";
}

const scopeLabels: Record<VaultDraftScope, string> = {
  selected: "Selected videos",
  filtered: "Current filtered set",
  "visible-verified": "Visible verified videos",
  favorites: "Favorite videos",
};

const recipeLabels: Record<VaultDraftRecipe, string> = {
  recent: "Recent Video Drafts",
  selected: "Selected Video Drafts",
  favorites: "Favorite Drafts",
  "prompt-groups": "Prompt Group Drafts",
};

const reasonLabels: Record<VaultDraftSkippedAsset["reason"], string> = {
  "image-only asset": "image-only asset",
  "unverified media": "unverified media",
  "missing object key": "missing object key",
  "hidden by local overlay": "hidden by local overlay",
  "duplicate asset": "duplicate asset",
  "not in selected scope": "not in selected scope",
  "not in filtered scope": "not in filtered scope",
  "not favorite": "not favorite",
  "no prompt group with at least two videos": "no prompt group with at least two videos",
};

function plural(count: number, singular: string, pluralLabel = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralLabel}`;
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
  const skippedReasonCounts = useMemo(() => {
    const counts = new Map<VaultDraftSkippedAsset["reason"], number>();
    for (const skipped of preview.skipped) {
      counts.set(skipped.reason, (counts.get(skipped.reason) || 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [preview.skipped]);
  const canCreate = preview.movies.length > 0;
  const hasVaultAssets = assets.length > 0;
  const noEligibleVideos = hasVaultAssets && preview.eligibleCount === 0;
  const controlClass =
    "w-full rounded-(--radius-input) border border-(--color-surface-200) bg-transparent px-3 py-2 text-sm dark:border-(--color-surface-700)";

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

  function openVault() {
    onClose();
    router.push("/vault");
  }

  return (
    <Modal open={open} onClose={onClose} title="Build Movies from Vault" className="max-w-3xl">
      <div className="space-y-[var(--space-4)]">
        <div className="grid gap-[var(--space-3)] md:grid-cols-2">
          <label className="space-y-1 text-xs text-(--color-surface-500)">
            Source scope
            <select
              aria-label="Source scope"
              value={scope}
              onChange={(event) => setScope(event.target.value as VaultDraftScope)}
              className={controlClass}
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
              className={controlClass}
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
              className={controlClass}
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
              className={controlClass}
            />
          </label>
          <label className="space-y-1 text-xs text-(--color-surface-500)">
            Transition
            <select
              aria-label="Transition"
              value="cut"
              disabled
              className={`${controlClass} disabled:opacity-70`}
            >
              <option value="cut">Cut</option>
            </select>
          </label>
        </div>

        <section aria-label="Build movies preview" className="rounded-(--radius) border border-(--hairline) bg-(--surface-panel) p-[var(--space-3)]">
          <div className="flex flex-wrap items-start justify-between gap-[var(--space-3)]">
            <div>
              <h4 className="flex items-center gap-2 text-[length:var(--text-16)] font-semibold text-(--color-surface-800) dark:text-(--color-surface-100)">
                <ListChecks className="h-4 w-4 text-(--state-accent)" />
                What will happen
              </h4>
              <p className="mt-1 text-[length:var(--text-13)] text-(--color-surface-500)">
                {scopeLabels[scope]} using {recipeLabels[recipe]} with cut transitions.
              </p>
            </div>
            <div className="flex flex-wrap gap-1 text-[length:var(--text-12)]">
              <span className="rounded-(--radius-sm) border border-(--hairline) px-2 py-1 text-(--color-surface-600) dark:text-(--color-surface-300)">
                {plural(preview.consideredCount, "source")}
              </span>
              <span className="rounded-(--radius-sm) border border-(--state-kept-border) bg-(--state-kept-bg-subtle) px-2 py-1 text-(--state-kept-fg)">
                {plural(preview.eligibleCount, "eligible video")}
              </span>
              <span className="rounded-(--radius-sm) border border-(--state-accent-border) bg-(--state-accent-bg-subtle) px-2 py-1 text-(--state-accent-fg)">
                {plural(preview.movies.length, "local movie draft")}
              </span>
            </div>
          </div>

          {canCreate ? (
            <div className="mt-[var(--space-3)] grid gap-[var(--space-3)] lg:grid-cols-[minmax(0,1fr)_16rem]">
              <ul className="space-y-2 text-[length:var(--text-13)] text-(--color-surface-700) dark:text-(--color-surface-200)">
                <li className="flex gap-2">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-(--state-kept)" />
                  Create {plural(preview.movies.length, "local movie draft")} in IndexedDB only.
                </li>
                <li className="flex gap-2">
                  <Video className="mt-0.5 h-4 w-4 shrink-0 text-(--state-accent)" />
                  Use {plural(preview.eligibleCount, "eligible video")} split into up to {plural(maxClipsPerMovie, "clip")} per movie.
                </li>
                <li className="flex gap-2">
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-(--state-muted-fg)" />
                  No R2, D1, Worker, processed-ID, or cloud state writes.
                </li>
              </ul>
              <div className="rounded-(--radius-sm) border border-(--hairline) bg-(--surface-raised) p-[var(--space-2)]">
                <div className="text-[length:var(--text-11)] uppercase tracking-wide text-(--color-surface-500)">Draft names</div>
                <div className="mt-2 space-y-1">
                  {preview.movies.slice(0, 3).map((movie) => (
                    <div key={movie.name} className="truncate text-[length:var(--text-12)] text-(--color-surface-700) dark:text-(--color-surface-200)">
                      {movie.name}
                    </div>
                  ))}
                  {preview.movies.length > 3 && (
                    <div className="text-[length:var(--text-12)] text-(--color-surface-500)">
                      +{preview.movies.length - 3} more
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="mt-[var(--space-3)] rounded-(--radius-sm) border border-(--state-attention-border) bg-(--state-attention-bg-subtle) p-[var(--space-3)] text-[length:var(--text-13)] text-(--state-attention-fg)">
              <div className="flex gap-2 font-medium">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                {hasVaultAssets ? "No eligible videos for this setup." : "No Vault assets loaded."}
              </div>
              <p className="mt-1">
                {hasVaultAssets
                  ? "Change the source scope or recipe, or load/commit verified Vault videos first."
                  : "Preview and commit Vault assets before building local movie drafts."}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {noEligibleVideos && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      setScope("visible-verified");
                      setRecipe("recent");
                    }}
                  >
                    Use visible verified videos
                  </Button>
                )}
                <Button size="sm" variant="secondary" onClick={openVault}>
                  Open Vault
                </Button>
              </div>
            </div>
          )}
        </section>

        <div className="grid gap-[var(--space-2)] text-[length:var(--text-13)] sm:grid-cols-4">
          <div className="rounded-(--radius-sm) border border-(--hairline) p-[var(--space-2)]">
            <div className="text-[length:var(--text-11)] uppercase tracking-wide text-(--color-surface-500)">Scope</div>
            <div className="mt-1 font-medium text-(--color-surface-800) dark:text-(--color-surface-100)">{scopeLabels[scope]}</div>
          </div>
          <div className="rounded-(--radius-sm) border border-(--hairline) p-[var(--space-2)]">
            <div className="text-[length:var(--text-11)] uppercase tracking-wide text-(--color-surface-500)">Selected</div>
            <div className="mt-1 font-medium text-(--color-surface-800) dark:text-(--color-surface-100)">{selectedAssetIds.length}</div>
          </div>
          <div className="rounded-(--radius-sm) border border-(--hairline) p-[var(--space-2)]">
            <div className="text-[length:var(--text-11)] uppercase tracking-wide text-(--color-surface-500)">Filtered</div>
            <div className="mt-1 font-medium text-(--color-surface-800) dark:text-(--color-surface-100)">{filteredAssetIds.length}</div>
          </div>
          <div className="rounded-(--radius-sm) border border-(--hairline) p-[var(--space-2)]">
            <div className="text-[length:var(--text-11)] uppercase tracking-wide text-(--color-surface-500)">Skipped</div>
            <div className="mt-1 font-medium text-(--color-surface-800) dark:text-(--color-surface-100)">{preview.skipped.length}</div>
          </div>
        </div>

        {skippedReasonCounts.length > 0 && (
          <details
            open={!canCreate}
            className="rounded-(--radius) border border-(--hairline) bg-(--surface-panel) p-[var(--space-3)] text-[length:var(--text-13)]"
          >
            <summary className="cursor-pointer font-medium text-(--color-surface-700) dark:text-(--color-surface-200)">
              Skipped reasons
            </summary>
            <div className="mt-2 grid gap-1 text-(--color-surface-600) dark:text-(--color-surface-300)">
              {skippedReasonCounts.map(([reason, count]) => (
                <div key={reason} className="flex justify-between gap-3">
                  <span>{reasonLabels[reason]}</span>
                  <span>{count}</span>
                </div>
              ))}
            </div>
          </details>
        )}

        <label className="flex items-center gap-2 text-sm text-(--color-surface-600) dark:text-(--color-surface-300)">
          <input
            type="checkbox"
            checked={openFirstMovie}
            onChange={(event) => setOpenFirstMovie(event.target.checked)}
          />
          Open the first movie after creation
        </label>

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
          <Button variant="primary" onClick={handleCreate} disabled={creating || !canCreate}>
            {creating ? "Creating..." : "Create movie drafts"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
