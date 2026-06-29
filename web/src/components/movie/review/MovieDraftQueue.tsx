"use client";

import { useEffect, useState } from "react";
import { listMovieVersions } from "@/lib/movie-review-storage";
import type { MovieReviewProject, MovieVersion } from "@/lib/movie-review-types";

export default function MovieDraftQueue({
  project,
  onProjectChange,
}: {
  project: MovieReviewProject;
  onProjectChange: (project: MovieReviewProject) => void;
}) {
  const [versions, setVersions] = useState<MovieVersion[]>([]);

  useEffect(() => {
    let cancelled = false;
    listMovieVersions(project.movieId).then((rows) => {
      if (!cancelled) setVersions(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [project.movieId, project.updatedAt]);

  return (
    <div className="rounded border border-neutral-800 p-3">
      <div className="text-xs uppercase tracking-wide text-neutral-500">Draft queue</div>
      <div className="mt-2 text-sm text-neutral-300">{project.committedClips.length} clips in current cut</div>
      <div className="mt-3 space-y-2">
        {versions.map((version) => (
          <button
            key={version.id}
            type="button"
            onClick={() => onProjectChange({ ...project, committedClips: version.clips, updatedAt: new Date().toISOString() })}
            className="block w-full rounded border border-neutral-800 px-2 py-1 text-left text-xs text-neutral-300 hover:bg-neutral-900"
          >
            {version.name}
          </button>
        ))}
        {versions.length === 0 && <div className="text-xs text-neutral-500">No alternate versions.</div>}
      </div>
    </div>
  );
}
