"use client";

import { Trash2 } from "lucide-react";
import { applyReviewCommand } from "@/lib/movie-review-reducer";
import type { MovieReviewProject, ReviewClip } from "@/lib/movie-review-types";
import { MovieFlagBadges, MovieLifecycleBadge } from "./MovieStatusBadges";

function clipLabel(clip: ReviewClip): string {
  return clip.sourceAssetId || (clip.mediaRef.type === "vault" ? clip.mediaRef.assetId : clip.titleText || clip.id);
}

export default function MovieClipStrip({
  project,
  onProjectChange,
}: {
  project: MovieReviewProject;
  onProjectChange: (project: MovieReviewProject) => void;
}) {
  return (
    <section aria-label="Clip Strip" className="border-t border-neutral-800 p-3">
      <div className="scrollbar-thin flex min-h-24 gap-2 overflow-x-auto">
        {project.committedClips.map((clip, index) => {
          const selected = project.selectedTarget?.type === "clip" && project.selectedTarget.clipId === clip.id;
          return (
            <article
              key={clip.id}
              className={`flex min-w-48 flex-col justify-between rounded border p-2 ${
                selected ? "border-orange-500 bg-orange-500/10" : "border-neutral-800 bg-neutral-900"
              }`}
            >
              <button
                type="button"
                onClick={() => onProjectChange(applyReviewCommand(project, { type: "select", target: { type: "clip", clipId: clip.id } }))}
                className="text-left"
              >
                <div className="text-xs text-neutral-500">#{index + 1}</div>
                <div className="truncate text-sm font-medium text-neutral-100">{clipLabel(clip)}</div>
                <div className="mt-1 flex gap-1">
                  <MovieLifecycleBadge lifecycle={clip.lifecycle} />
                  <MovieFlagBadges flags={clip.flags} />
                </div>
              </button>
              <div className="mt-2 flex items-center justify-between text-xs text-neutral-500">
                <span>{clip.mediaType}</span>
                <button
                  type="button"
                  aria-label={`Delete ${clipLabel(clip)}`}
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
          <div className="flex min-h-24 flex-1 items-center justify-center rounded border border-neutral-800 text-sm text-neutral-500">
            No clips committed locally.
          </div>
        )}
      </div>
    </section>
  );
}
