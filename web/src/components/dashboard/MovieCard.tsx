"use client";

import Link from "next/link";
import { Film } from "lucide-react";
import type { Movie } from "@/lib/types";

interface MovieCardProps {
  movie: Movie;
}

export default function MovieCard({ movie }: MovieCardProps) {
  const dateStr = new Date(movie.updatedAt).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });

  return (
    <Link
      href={`/movie?id=${movie.id}`}
      className="group block min-w-[200px] max-w-[260px] flex-shrink-0 rounded-(--radius-card) border border-(--color-surface-200) bg-(--color-surface-0) shadow-(--shadow-card) transition-all duration-(--duration-normal) hover:shadow-(--shadow-card-hover) hover:-translate-y-0.5 dark:border-(--color-surface-800) dark:bg-(--color-surface-900)"
    >
      {/* Icon area */}
      <div className="flex aspect-[16/9] items-center justify-center rounded-t-(--radius-card) bg-(--color-surface-50) dark:bg-(--color-surface-800)">
        <Film className="h-8 w-8 text-(--color-surface-300) group-hover:text-(--color-accent) transition-colors dark:text-(--color-surface-600)" />
      </div>

      {/* Info */}
      <div className="px-3 py-2.5">
        <h3 className="truncate text-sm font-semibold text-(--color-surface-800) group-hover:text-(--color-accent) dark:text-(--color-surface-200)">
          {movie.name}
        </h3>
        <p className="mt-0.5 text-xs text-(--color-surface-400)">
          {movie.clips.length} clip{movie.clips.length !== 1 ? "s" : ""} · {dateStr}
        </p>
      </div>
    </Link>
  );
}
