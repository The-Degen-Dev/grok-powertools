"use client";

import { Check, X } from "lucide-react";
import { applyReviewCommand } from "@/lib/movie-review-reducer";
import type { MovieReviewProject, ReviewClip } from "@/lib/movie-review-types";

function clipLabel(clip: ReviewClip): string {
  return clip.sourceAssetId || (clip.mediaRef.type === "vault" ? clip.mediaRef.assetId : clip.titleText || clip.id);
}

export default function MovieFocusLoupe({
  project,
  onProjectChange,
}: {
  project: MovieReviewProject;
  onProjectChange: (project: MovieReviewProject) => void;
}) {
  const clip = project.candidates[project.activeIndex];
  return (
    <section role="region" aria-label="Focus Loupe" className="movie-review-center flex min-h-0 flex-col p-4">
      {clip ? (
        <div className="flex min-h-0 flex-1 flex-col rounded border border-orange-500/40 bg-orange-500/10 p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-xs uppercase tracking-wide text-orange-200">Focus</div>
              <h2 className="mt-1 text-lg font-semibold text-neutral-100">{clipLabel(clip)}</h2>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                aria-label={`Keep ${clipLabel(clip)}`}
                onClick={() => onProjectChange(applyReviewCommand(project, { type: "keep-current" }))}
                className="rounded bg-green-600 px-3 py-2 text-sm text-white hover:bg-green-500"
              >
                <Check className="mr-1 inline h-4 w-4" />
                Keep
              </button>
              <button
                type="button"
                aria-label={`Reject ${clipLabel(clip)}`}
                onClick={() => onProjectChange(applyReviewCommand(project, { type: "reject-current" }))}
                className="rounded bg-neutral-900 px-3 py-2 text-sm text-neutral-200 hover:bg-neutral-800"
              >
                <X className="mr-1 inline h-4 w-4" />
                Reject
              </button>
            </div>
          </div>
          <div className="mt-4 flex min-h-80 flex-1 items-center justify-center rounded bg-neutral-950 text-sm text-neutral-400">{clipLabel(clip)}</div>
        </div>
      ) : (
        <div className="flex h-full min-h-64 items-center justify-center rounded border border-neutral-800 text-sm text-neutral-500">No candidate in focus.</div>
      )}
    </section>
  );
}
