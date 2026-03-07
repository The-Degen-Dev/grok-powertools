"use client";

import { useState, useEffect } from "react";
import { Plus, Film } from "lucide-react";
import { v4 as uuidv4 } from "uuid";
import type { Movie, MovieClip, VideoItem } from "@/lib/types";
import { getAllMovies, createMovie, getMovie, updateMovie } from "@/lib/local-storage";
import Modal from "@/components/ui/Modal";
import Button from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";

interface AddToMoviePopoverProps {
  open: boolean;
  onClose: () => void;
  item: VideoItem;
}

export default function AddToMoviePopover({ open, onClose, item }: AddToMoviePopoverProps) {
  const [movies, setMovies] = useState<Movie[]>([]);
  const [newMovieName, setNewMovieName] = useState("");
  const [showNewInput, setShowNewInput] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (open) {
      getAllMovies().then(setMovies);
      setShowNewInput(false);
      setNewMovieName("");
    }
  }, [open]);

  async function addToMovie(movieId: string, movieName: string) {
    const movie = await getMovie(movieId);
    if (!movie) return;

    const clip: MovieClip = {
      id: uuidv4(),
      type: "video",
      videoUrl: item.videoUrl,
      transition: { type: "cut", duration: 0 },
      position: movie.clips.length,
    };

    movie.clips.push(clip);
    await updateMovie(movie);
    toast(`Added to "${movieName}"`, "success");
    onClose();
  }

  async function handleCreateAndAdd() {
    const name = newMovieName.trim();
    if (!name) return;

    const movie = await createMovie(name);
    const clip: MovieClip = {
      id: uuidv4(),
      type: "video",
      videoUrl: item.videoUrl,
      transition: { type: "cut", duration: 0 },
      position: 0,
    };

    movie.clips.push(clip);
    await updateMovie(movie);
    toast(`Created "${name}" and added clip`, "success");
    onClose();
  }

  return (
    <Modal open={open} onClose={onClose} title="Add to Movie">
      <div className="space-y-2">
        {movies.length === 0 && !showNewInput && (
          <p className="py-4 text-center text-sm text-(--color-surface-500)">
            No movies yet. Create one to get started.
          </p>
        )}

        {movies.map((movie) => (
          <button
            key={movie.id}
            type="button"
            onClick={() => addToMovie(movie.id, movie.name)}
            className="flex w-full items-center gap-3 rounded-(--radius-btn) border border-(--color-surface-200) px-4 py-3 text-left transition-colors hover:border-(--color-accent) hover:bg-(--color-accent-light) dark:border-(--color-surface-700) dark:hover:border-(--color-accent) dark:hover:bg-(--color-accent)/10"
          >
            <Film className="h-4 w-4 flex-shrink-0 text-(--color-surface-400)" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-(--color-surface-800) dark:text-(--color-surface-200)">
                {movie.name}
              </p>
              <p className="text-xs text-(--color-surface-400)">
                {movie.clips.length} clip{movie.clips.length !== 1 ? "s" : ""}
              </p>
            </div>
          </button>
        ))}

        {showNewInput ? (
          <div className="flex items-center gap-2 pt-2">
            <input
              type="text"
              value={newMovieName}
              onChange={(e) => setNewMovieName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreateAndAdd()}
              placeholder="Movie name..."
              autoFocus
              className="flex-1 rounded-(--radius-input) border border-(--color-surface-200) bg-transparent px-3 py-2 text-sm text-(--color-surface-800) outline-none focus:border-(--color-accent) dark:border-(--color-surface-700) dark:text-(--color-surface-200)"
            />
            <Button variant="primary" onClick={handleCreateAndAdd} disabled={!newMovieName.trim()}>
              Create
            </Button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setShowNewInput(true)}
            className="flex w-full items-center gap-3 rounded-(--radius-btn) border border-dashed border-(--color-surface-300) px-4 py-3 text-sm text-(--color-surface-500) transition-colors hover:border-(--color-accent) hover:text-(--color-accent) dark:border-(--color-surface-600)"
          >
            <Plus className="h-4 w-4" />
            New Movie
          </button>
        )}
      </div>
    </Modal>
  );
}
