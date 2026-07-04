"use client";

import { useEffect, useState } from "react";
import { applyReviewCommand } from "@/lib/movie-review-reducer";
import { listMovieVersionsForProject, saveMovieVersion } from "@/lib/movie-review-storage";
import type { MovieReviewProject, MovieVersion } from "@/lib/movie-review-types";
import type { MovieReviewProjectUpdate } from "./useMovieReviewProject";

function autosaveId(): string {
  return `autosave-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export default function MovieDraftQueue({
  project,
  onProjectChange,
}: {
  project: MovieReviewProject;
  onProjectChange: (project: MovieReviewProjectUpdate) => void;
}) {
  const [versions, setVersions] = useState<MovieVersion[]>([]);

  useEffect(() => {
    let cancelled = false;
    listMovieVersionsForProject(project.id).then((rows) => {
      if (!cancelled) setVersions(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [project.id, project.updatedAt]);

  async function applyVersion(version: MovieVersion) {
    if (project.committedClips.length > 0) {
      const timestamp = new Date().toISOString();
      await saveMovieVersion({
        id: autosaveId(),
        movieId: project.movieId,
        projectId: project.id,
        name: `Autosave before ${version.name}`,
        description: "Automatic safety snapshot before applying a saved version.",
        clips: project.committedClips,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    }
    onProjectChange((current) => applyReviewCommand(current, { type: "apply-version", clips: version.clips }));
  }

  return (
    <div className="rounded border border-neutral-800 p-3">
      <div className="text-xs uppercase tracking-wide text-neutral-400">Draft queue</div>
      <div className="mt-2 text-sm text-neutral-300">{project.committedClips.length} clips in current cut</div>
      <div className="mt-3 space-y-2">
        {versions.map((version) => (
          <button
            key={version.id}
            type="button"
            onClick={() => {
              void applyVersion(version);
            }}
            className="block w-full rounded border border-neutral-800 px-2 py-1 text-left text-xs text-neutral-300 hover:bg-neutral-900"
          >
            {version.name}
          </button>
        ))}
        {versions.length === 0 && (
          <div className="rounded-(--radius-sm) border border-neutral-800 bg-neutral-950 p-2 text-xs text-neutral-400">
            No saved versions yet. Applying a saved Director changeset later will snapshot the current cut first.
          </div>
        )}
      </div>
    </div>
  );
}
