"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Plus, Film, Trash2, Pencil } from "lucide-react";
import type { Movie } from "@/lib/types";
import { getAllMovies, createMovie, deleteMovie, updateMovie } from "@/lib/local-storage";

export default function MovieList() {
  const router = useRouter();
  const [movies, setMovies] = useState<Movie[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  useEffect(() => {
    getAllMovies().then(setMovies);
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

  return (
    <div className="mx-auto max-w-2xl px-4 py-12">
      <div className="mb-8 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-neutral-900 dark:text-neutral-100">
          Movie Maker
        </h1>
        <button
          type="button"
          onClick={handleCreate}
          className="flex items-center gap-1.5 rounded-lg bg-orange-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-orange-500"
        >
          <Plus className="h-4 w-4" />
          New Movie
        </button>
      </div>

      {movies.length === 0 ? (
        <div className="rounded-lg border border-dashed border-neutral-300 p-12 text-center dark:border-neutral-700">
          <Film className="mx-auto h-10 w-10 text-neutral-400" />
          <p className="mt-3 text-neutral-500">No movies yet. Create one to get started.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {movies.map((movie) => (
            <div
              key={movie.id}
              className="flex items-center justify-between rounded-lg border border-neutral-200 bg-white px-4 py-3 transition hover:border-neutral-300 dark:border-neutral-700 dark:bg-neutral-900 dark:hover:border-neutral-600"
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
                    className="rounded bg-neutral-100 px-2 py-0.5 text-sm text-neutral-900 outline-none dark:bg-neutral-800 dark:text-neutral-100"
                  />
                ) : (
                  <>
                    <p className="font-medium text-neutral-900 dark:text-neutral-100">
                      {movie.name}
                    </p>
                    <p className="text-xs text-neutral-500">
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
                  className="rounded p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800"
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
                  className="rounded p-1.5 text-neutral-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950"
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
