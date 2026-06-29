"use client";

import { Check, MousePointer2, X } from "lucide-react";
import { applyReviewCommand } from "@/lib/movie-review-reducer";
import type { MovieReviewProject, ReviewClip } from "@/lib/movie-review-types";
import { MovieFlagBadges, MovieLifecycleBadge } from "./MovieStatusBadges";

function clipLabel(clip: ReviewClip): string {
  return clip.sourceAssetId || (clip.mediaRef.type === "vault" ? clip.mediaRef.assetId : clip.titleText || clip.id);
}

export default function MovieCandidatesGrid({
  project,
  onProjectChange,
}: {
  project: MovieReviewProject;
  onProjectChange: (project: MovieReviewProject) => void;
}) {
  return (
    <section aria-label="Candidates Grid" className="min-h-0 overflow-y-auto p-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {project.candidates.map((clip, index) => {
          const selected = project.activeIndex === index;
          return (
            <article
              key={clip.id}
              className={`rounded border p-3 ${selected ? "border-orange-500 bg-orange-500/10" : "border-neutral-800 bg-neutral-900"}`}
            >
              <button
                type="button"
                onClick={() =>
                  onProjectChange({
                    ...applyReviewCommand(project, { type: "select", target: { type: "candidate", clipId: clip.id } }),
                    activeIndex: index,
                  })
                }
                className="flex aspect-video w-full items-center justify-center rounded bg-neutral-950 text-sm text-neutral-300"
              >
                <MousePointer2 className="mr-2 h-4 w-4 text-orange-400" />
                {clipLabel(clip)}
              </button>
              <div className="mt-3 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-neutral-100">{clipLabel(clip)}</div>
                  <div className="mt-1 flex gap-1">
                    <MovieLifecycleBadge lifecycle={clip.lifecycle} />
                    <MovieFlagBadges flags={clip.flags} />
                  </div>
                </div>
                <div className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    aria-label={`Keep ${clipLabel(clip)}`}
                    onClick={() => onProjectChange(applyReviewCommand({ ...project, activeIndex: index }, { type: "keep-current" }))}
                    className="rounded p-1.5 text-green-300 hover:bg-green-500/10"
                  >
                    <Check className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    aria-label={`Reject ${clipLabel(clip)}`}
                    onClick={() => onProjectChange(applyReviewCommand({ ...project, activeIndex: index }, { type: "reject-current" }))}
                    className="rounded p-1.5 text-red-300 hover:bg-red-500/10"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </article>
          );
        })}
      </div>
      {project.candidates.length === 0 && (
        <div className="flex h-full min-h-64 items-center justify-center rounded border border-neutral-800 text-sm text-neutral-500">
          No candidates in review.
        </div>
      )}
    </section>
  );
}
