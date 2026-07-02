"use client";

import { Film, Trash2 } from "lucide-react";
import { applyReviewCommand } from "@/lib/movie-review-reducer";
import type { MovieReviewProject } from "@/lib/movie-review-types";
import { MovieFlagBadges, MovieLifecycleBadge } from "./MovieStatusBadges";
import { clipDisplayTitle } from "./movieReviewPresentation";

export default function MovieClipStrip({
  project,
  onProjectChange,
}: {
  project: MovieReviewProject;
  onProjectChange: (project: MovieReviewProject) => void;
}) {
  return (
    <section aria-label="Clip Strip" className="border-t border-neutral-800 bg-(--color-surface-950) p-3">
      <div className="scrollbar-thin flex min-h-24 gap-2 overflow-x-auto">
        {project.committedClips.map((clip, index) => {
          const selected = project.selectedTarget?.type === "clip" && project.selectedTarget.clipId === clip.id;
          const title = clipDisplayTitle(clip, clip.position);
          return (
            <article
              key={clip.id}
              className={`flex min-w-48 flex-col justify-between rounded border p-2 ${
                selected ? "border-(--state-accent-border) bg-(--state-accent-bg-subtle)" : "border-(--hairline) bg-(--surface-panel)"
              }`}
            >
              <button
                type="button"
                onClick={() => onProjectChange(applyReviewCommand(project, { type: "select", target: { type: "clip", clipId: clip.id } }))}
                className="text-left"
              >
                <div className="text-xs text-neutral-400">#{index + 1}</div>
                <div className="truncate text-sm font-medium text-neutral-100">{title}</div>
                <div className="mt-1 flex gap-1">
                  <MovieLifecycleBadge lifecycle={clip.lifecycle} />
                  <MovieFlagBadges flags={clip.flags} />
                </div>
              </button>
              <div className="mt-2 flex items-center justify-between text-xs text-neutral-400">
                <span>{clip.mediaType}</span>
                <button
                  type="button"
                  aria-label={`Delete ${title}`}
                  onClick={() => onProjectChange(applyReviewCommand(project, { type: "delete-committed", clipId: clip.id }))}
                  className="rounded p-1 text-neutral-400 hover:bg-red-500/10 hover:text-red-300"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </article>
          );
        })}
        {project.committedClips.length === 0 && (
          <div className="flex min-h-24 flex-1 flex-col items-center justify-center rounded border border-neutral-800 text-center text-sm text-neutral-400">
            <Film className="mb-1 h-5 w-5" aria-hidden="true" />
            <div className="font-medium text-neutral-200">No committed clips</div>
            <div className="text-xs">Keep a candidate to add it to the cut.</div>
          </div>
        )}
      </div>
    </section>
  );
}
