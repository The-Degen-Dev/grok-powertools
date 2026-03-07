"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Plus, Film, Trash2, Pencil } from "lucide-react";
import type { Movie } from "@/lib/types";
import { getAllMovies, createMovie, deleteMovie, updateMovie } from "@/lib/local-storage";
import Button from "@/components/ui/Button";
import EmptyState from "@/components/ui/EmptyState";

export default function MovieList() {
  const router = useRouter();
  const [movies, setMovies] = useState<Movie[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  useEffect(() => {
    getAllMovies().then((m) => {
      setMovies(m);
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

  if (!loaded) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-12">
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
    <div className="mx-auto max-w-2xl px-4 py-12">
      <div className="mb-8 flex items-center justify-between">
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-semibold text-(--color-surface-900) dark:text-(--color-surface-100)">
          Movie Maker
        </h1>
        <Button variant="primary" onClick={handleCreate}>
          <Plus className="h-4 w-4" />
          New Movie
        </Button>
      </div>

      {movies.length === 0 ? (
        <EmptyState
          icon={Film}
          title="No movies yet"
          description="Create a movie to start combining clips with transitions."
          action={
            <Button variant="primary" onClick={handleCreate}>
              <Plus className="h-4 w-4" />
              New Movie
            </Button>
          }
        />
      ) : (
        <div className="space-y-2">
          {movies.map((movie) => (
            <div
              key={movie.id}
              className="flex items-center justify-between rounded-(--radius-card) border border-(--color-surface-200) bg-(--color-surface-0) px-4 py-3 transition hover:border-(--color-surface-400) hover:shadow-(--shadow-card) dark:border-(--color-surface-700) dark:bg-(--color-surface-900) dark:hover:border-(--color-surface-600)"
            >
              <div
                className="flex-1 cursor-pointer"
                onClick={() => router.push(`/movie?id=${movie.id}`)}
              >
                {editingId === movie.id ? (
                  <input
                    autoFocus
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onBlur={() => handleRename(movie)}
                    onKeyDown={(e) => e.key === "Enter" && handleRename(movie)}
                    onClick={(e) => e.stopPropagation()}
                    className="rounded-(--radius-input) bg-(--color-surface-50) px-2 py-0.5 text-sm text-(--color-surface-900) outline-none dark:bg-(--color-surface-800) dark:text-(--color-surface-100)"
                  />
                ) : (
                  <>
                    <p className="font-medium text-(--color-surface-900) dark:text-(--color-surface-100)">
                      {movie.name}
                    </p>
                    <p className="text-xs text-(--color-surface-500)">
                      {movie.clips.length} clip{movie.clips.length !== 1 ? "s" : ""} · Updated{" "}
                      {new Date(movie.updatedAt).toLocaleDateString()}
                    </p>
                  </>
                )}
              </div>
              <div className="flex gap-1">
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
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
