"use client";

import { Wand2 } from "lucide-react";
import { createRuleBasedDirectorProposal } from "@/lib/movie-director";
import { saveDirectorProposal } from "@/lib/movie-review-storage";
import type { MovieReviewProject } from "@/lib/movie-review-types";

export default function MovieLeftRail({
  project,
}: {
  project: MovieReviewProject;
  onProjectChange: (project: MovieReviewProject) => void;
}) {
  return (
    <aside role="region" aria-label="Drafts and Director" className="min-h-0 overflow-y-auto border-r border-neutral-800 p-3">
      <div className="space-y-3">
        <button
          type="button"
          onClick={() => {
            const proposal = createRuleBasedDirectorProposal(project);
            saveDirectorProposal(proposal).catch(() => {});
          }}
          className="flex w-full items-center justify-center gap-2 rounded bg-neutral-900 px-3 py-2 text-sm text-neutral-200 hover:bg-neutral-800"
        >
          <Wand2 className="h-4 w-4 text-orange-400" />
          Director Proposal
        </button>
        <div className="rounded border border-neutral-800 p-3">
          <div className="text-xs uppercase tracking-wide text-neutral-500">Draft queue</div>
          <div className="mt-2 text-sm text-neutral-300">{project.committedClips.length} clips in current cut</div>
        </div>
      </div>
    </aside>
  );
}
