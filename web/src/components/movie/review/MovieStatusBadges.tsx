"use client";

import { AlertTriangle, Check, Diamond, Music, Scissors, VolumeX, X } from "lucide-react";
import StatusFlag from "@/components/ui/StatusFlag";
import type { ClipFlag, ClipLifecycle, MovieReviewProject } from "@/lib/movie-review-types";

export function MovieLifecycleBadge({ lifecycle }: { lifecycle: ClipLifecycle }) {
  const Icon = lifecycle === "kept" ? Check : lifecycle === "rejected" ? X : Diamond;
  const tone = lifecycle === "kept" ? "kept" : lifecycle === "rejected" ? "rejected" : "accent";
  return <StatusFlag tone={tone} icon={Icon} label={lifecycle} compact={false} />;
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
          <StatusFlag
            key={flag}
            tone={flag === "needs-attention" ? "attention" : flag === "muted-in-mix" ? "muted" : "kept"}
            icon={Icon}
            label={flag.replaceAll("-", " ")}
            compact
          />
        );
      })}
    </span>
  );
}

export default function MovieStatusBadges({ project }: { project: MovieReviewProject }) {
  const unresolved = project.candidates.filter((clip) => clip.lifecycle !== "rejected").length;
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <StatusFlag tone="accent" label={project.mode} />
      <StatusFlag tone="muted" label={`${unresolved} candidates`} />
      <StatusFlag tone="kept" label={`${project.committedClips.length} committed`} />
    </div>
  );
}
