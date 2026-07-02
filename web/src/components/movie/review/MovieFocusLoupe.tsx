"use client";

import { Check, X } from "lucide-react";
import { applyReviewCommand } from "@/lib/movie-review-reducer";
import type { MovieReviewProject } from "@/lib/movie-review-types";
import { clipDisplayTitle } from "./movieReviewPresentation";

export default function MovieFocusLoupe({
  project,
  onProjectChange,
}: {
  project: MovieReviewProject;
  onProjectChange: (project: MovieReviewProject) => void;
}) {
  const clip = project.candidates[project.activeIndex];
  const title = clip ? clipDisplayTitle(clip, project.activeIndex) : "";
  return (
    <section role="region" aria-label="Focus Loupe" className="movie-review-center flex min-h-0 flex-col p-4">
      {clip ? (
        <div className="flex min-h-0 flex-1 flex-col rounded-(--radius) border border-(--state-accent-border) bg-(--state-accent-bg-subtle) p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-xs uppercase tracking-wide text-(--state-accent-fg)">Focus</div>
              <h2 className="mt-1 text-lg font-semibold text-neutral-100">{title}</h2>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                aria-label={`Keep ${title}`}
                onClick={() => onProjectChange(applyReviewCommand(project, { type: "keep-current" }))}
                className="rounded-(--radius) bg-(--state-kept) px-3 py-2 text-sm text-white hover:opacity-90"
              >
                <Check className="mr-1 inline h-4 w-4" />
                Keep
              </button>
              <button
                type="button"
                aria-label={`Reject ${title}`}
                onClick={() => onProjectChange(applyReviewCommand(project, { type: "reject-current" }))}
                className="rounded bg-neutral-900 px-3 py-2 text-sm text-neutral-200 hover:bg-neutral-800"
              >
                <X className="mr-1 inline h-4 w-4" />
                Reject
              </button>
            </div>
          </div>
          <div className="mt-4 flex min-h-80 flex-1 items-center justify-center rounded bg-neutral-950 text-sm text-neutral-400">{title}</div>
        </div>
      ) : (
        <div className="flex h-full min-h-64 items-center justify-center rounded border border-neutral-800 text-sm text-neutral-400">No candidate in focus.</div>
      )}
    </section>
  );
}
