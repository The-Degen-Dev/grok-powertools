"use client";

import type { MovieReviewProject } from "@/lib/movie-review-types";

export default function MovieStatusBadges({ project }: { project: MovieReviewProject }) {
  const unresolved = project.candidates.filter((clip) => clip.lifecycle !== "rejected").length;
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="rounded border border-orange-500/40 bg-orange-500/10 px-2 py-1 text-orange-200">{project.mode}</span>
      <span className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-neutral-300">{unresolved} candidates</span>
      <span className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-neutral-300">{project.committedClips.length} committed</span>
    </div>
  );
}
