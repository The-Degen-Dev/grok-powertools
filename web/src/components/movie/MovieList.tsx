"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Archive, Clock3, Film, Pencil, Plus, Trash2 } from "lucide-react";
import type { Movie } from "@/lib/types";
import { getAllMovies, createMovie, deleteMovie, updateMovie, getDB } from "@/lib/local-storage";
import { getVaultAssets, getVaultOverlays } from "@/lib/vault-storage";
import type { VaultAsset, VaultOverlay } from "@/lib/vault-types";
import Button from "@/components/ui/Button";
import EmptyState from "@/components/ui/EmptyState";
import VaultMovieDraftModal from "@/components/vault/VaultMovieDraftModal";

export default function MovieList() {
  const router = useRouter();
  const [movies, setMovies] = useState<Movie[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [showVaultBuilder, setShowVaultBuilder] = useState(false);
  const [vaultAssets, setVaultAssets] = useState<VaultAsset[]>([]);
  const [vaultOverlays, setVaultOverlays] = useState<VaultOverlay[]>([]);

  useEffect(() => {
    async function load() {
      const [nextMovies, db] = await Promise.all([getAllMovies(), getDB()]);
      const [nextAssets, nextOverlays] = await Promise.all([getVaultAssets(db), getVaultOverlays(db)]);
      setMovies(nextMovies);
      setVaultAssets(nextAssets);
      setVaultOverlays(nextOverlays);
      setLoaded(true);
    }

    load().catch(() => {
      setMovies([]);
      setVaultAssets([]);
      setVaultOverlays([]);
      setLoaded(true);
    });
  }, []);

  async function handleCreate() {
    const movie = await createMovie("Untitled Movie");
    router.push(`/movie?id=${movie.id}`);
  }

  async function handleDelete(id: string) {
    await deleteMovie(id);
    setMovies((prev) => prev.filter((m) => m.id !== id));
  }

  async function handleRename(movie: Movie) {
    if (!editName.trim()) return;
    const updated = await updateMovie({ ...movie, name: editName.trim() });
    setMovies((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
    setEditingId(null);
  }

  const totalClips = movies.reduce((sum, movie) => sum + movie.clips.length, 0);
  const vaultVideoCount = vaultAssets.filter((asset) => asset.mediaType === "video").length;

  if (!loaded) {
    return (
      <div className="mx-auto max-w-screen-xl px-4 py-8">
        <div className="mb-8 flex items-center justify-between">
          <div className="skeleton h-8 w-40 rounded-(--radius-btn)" />
          <div className="skeleton h-9 w-32 rounded-(--radius-btn)" />
        </div>
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="skeleton h-16 rounded-(--radius-card)" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-screen-xl px-4 py-6">
      <div className="mb-[var(--space-4)] flex flex-col gap-[var(--space-3)] border-b border-(--hairline) pb-[var(--space-4)] md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-2xl font-semibold text-(--color-surface-900) dark:text-(--color-surface-100)">
            Movie Maker
          </h1>
          <div className="mt-2 flex flex-wrap gap-2 text-[length:var(--text-12)] text-(--color-surface-500)">
            <span className="rounded-(--radius-sm) border border-(--hairline) px-2 py-1">{movies.length} movies</span>
            <span className="rounded-(--radius-sm) border border-(--hairline) px-2 py-1">{totalClips} clips</span>
            <span className="rounded-(--radius-sm) border border-(--hairline) px-2 py-1">{vaultAssets.length} Vault assets</span>
            <span className="rounded-(--radius-sm) border border-(--hairline) px-2 py-1">{vaultVideoCount} Vault videos</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            onClick={() => setShowVaultBuilder(true)}
            disabled={vaultAssets.length === 0}
            title={vaultAssets.length === 0 ? "Load and commit Vault assets first" : "Build movies from committed Vault videos"}
          >
            <Film className="h-4 w-4" />
            Build from Vault
          </Button>
          <Button variant="primary" onClick={handleCreate}>
            <Plus className="h-4 w-4" />
            New Movie
          </Button>
        </div>
      </div>

      {movies.length === 0 ? (
        <EmptyState
          icon={Film}
          title="No movies yet"
          description={vaultAssets.length > 0 ? "Create one manually or build drafts from committed Vault videos." : "Create one manually, or load the Vault first so drafts can be built from saved videos."}
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button variant="primary" onClick={handleCreate}>
                <Plus className="h-4 w-4" />
                New Movie
              </Button>
              {vaultAssets.length > 0 ? (
                <Button variant="secondary" onClick={() => setShowVaultBuilder(true)}>
                  <Film className="h-4 w-4" />
                  Build drafts
                </Button>
              ) : (
                <Button variant="secondary" onClick={() => router.push("/vault")}>
                  <Archive className="h-4 w-4" />
                  Open Vault
                </Button>
              )}
            </div>
          }
        />
      ) : (
        <div className="grid gap-[var(--space-2)]">
          {movies.map((movie) => (
            <article
              key={movie.id}
              className="grid min-w-0 gap-[var(--space-3)] overflow-hidden rounded-(--radius) border border-(--hairline) bg-(--surface-panel) px-[var(--space-3)] py-[var(--space-3)] transition-colors hover:border-(--state-accent-border) md:grid-cols-[minmax(0,1fr)_auto]"
            >
              <div className="min-w-0 overflow-hidden">
                {editingId === movie.id ? (
                  <input
                    autoFocus
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onBlur={() => handleRename(movie)}
                    onKeyDown={(e) => e.key === "Enter" && handleRename(movie)}
                    onClick={(e) => e.stopPropagation()}
                    className="w-full rounded-(--radius-input) bg-(--color-surface-50) px-2 py-0.5 text-sm text-(--color-surface-900) outline-none dark:bg-(--color-surface-800) dark:text-(--color-surface-100)"
                  />
                ) : (
                  <button type="button" className="block w-full min-w-0 max-w-full overflow-hidden text-left" onClick={() => router.push(`/movie?id=${movie.id}`)}>
                    <p className="truncate text-[length:var(--text-14)] font-medium text-(--color-surface-900) dark:text-(--color-surface-100)">
                      {movie.name}
                    </p>
                    <div className="mt-2 flex max-w-full flex-wrap gap-2 overflow-hidden text-[length:var(--text-12)] text-(--color-surface-500)">
                      <span className="inline-flex items-center gap-1">
                        <Film className="h-3 w-3" />
                        {movie.clips.length} clip{movie.clips.length !== 1 ? "s" : ""}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Clock3 className="h-3 w-3" />
                        Updated {new Date(movie.updatedAt).toLocaleDateString()}
                      </span>
                      <span className="rounded-(--radius-sm) border border-(--hairline) px-1.5 py-0.5">Review Bay</span>
                    </div>
                  </button>
                )}
              </div>
              <div className="flex items-center justify-end gap-1">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditingId(movie.id);
                    setEditName(movie.name);
                  }}
                  className="rounded-(--radius-btn) p-1.5 text-(--color-surface-400) hover:bg-(--color-surface-100) hover:text-(--color-surface-600) dark:hover:bg-(--color-surface-800)"
                  title="Rename"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(movie.id);
                  }}
                  className="rounded-(--radius-btn) p-1.5 text-(--color-surface-400) hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950"
                  title="Delete"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
      <VaultMovieDraftModal
        open={showVaultBuilder}
        onClose={() => setShowVaultBuilder(false)}
        assets={vaultAssets}
        overlays={vaultOverlays}
        filteredAssetIds={vaultAssets.map((asset) => asset.assetId)}
        selectedAssetIds={[]}
        defaultOpenFirstMovie
      />
    </div>
  );
}
