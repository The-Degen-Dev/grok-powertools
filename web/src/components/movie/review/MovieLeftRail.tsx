"use client";

import { useState } from "react";
import type { MovieReviewProject } from "@/lib/movie-review-types";
import MovieDirectorPanel from "./MovieDirectorPanel";
import MovieDraftQueue from "./MovieDraftQueue";
import type { MovieReviewProjectUpdate } from "./useMovieReviewProject";

export default function MovieLeftRail({
  project,
  onProjectChange,
}: {
  project: MovieReviewProject;
  onProjectChange: (project: MovieReviewProjectUpdate) => void;
}) {
  const [activeTab, setActiveTab] = useState<"drafts" | "director">("drafts");
  return (
    <aside role="region" aria-label="Drafts and Director" className="movie-review-left min-h-0 overflow-y-auto border-r border-neutral-800 p-3">
      <div className="space-y-3">
        <div role="tablist" aria-label="Movie side rail" className="grid grid-cols-2 rounded border border-neutral-800 bg-neutral-900 p-1">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "drafts"}
            onClick={() => setActiveTab("drafts")}
            className={`rounded px-2 py-1 text-xs ${activeTab === "drafts" ? "bg-(--state-accent) text-white" : "text-neutral-400 hover:bg-neutral-800"}`}
          >
            Drafts
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "director"}
            onClick={() => setActiveTab("director")}
            className={`rounded px-2 py-1 text-xs ${activeTab === "director" ? "bg-(--state-accent) text-white" : "text-neutral-400 hover:bg-neutral-800"}`}
          >
            Director
          </button>
        </div>
        {activeTab === "drafts" ? (
          <MovieDraftQueue project={project} onProjectChange={onProjectChange} />
        ) : (
          <MovieDirectorPanel project={project} onProjectChange={onProjectChange} />
        )}
      </div>
    </aside>
  );
}
