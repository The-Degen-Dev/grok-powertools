"use client";

import { AlertTriangle, Check, Diamond, Music, Scissors, VolumeX, X } from "lucide-react";
import type { ClipFlag, ClipLifecycle, MovieReviewProject } from "@/lib/movie-review-types";

export function MovieLifecycleBadge({ lifecycle }: { lifecycle: ClipLifecycle }) {
  const Icon = lifecycle === "kept" ? Check : lifecycle === "rejected" ? X : Diamond;
  return (
    <span aria-label={`lifecycle ${lifecycle}`} className="inline-flex items-center gap-1 rounded border border-neutral-700 px-1.5 py-0.5 text-[11px] text-neutral-300">
      <Icon className="h-3 w-3" />
      {lifecycle}
    </span>
  );
}

export function MovieFlagBadges({ flags }: { flags: ClipFlag[] }) {
  return (
    <span className="inline-flex flex-wrap gap-1">
      {flags.map((flag) => {
        const Icon =
          flag === "trimmed"
            ? Scissors
            : flag === "has-source-audio"
              ? Music
              : flag === "muted-in-mix"
                ? VolumeX
                : flag === "needs-attention"
                  ? AlertTriangle
                  : Check;
        return (
          <span
            key={flag}
            role="img"
            aria-label={flag.replaceAll("-", " ")}
            className="inline-flex items-center rounded border border-neutral-700 px-1 py-0.5 text-neutral-300"
          >
            <Icon className="h-3 w-3" />
          </span>
        );
      })}
    </span>
  );
}

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
