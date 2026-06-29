"use client";

import { ArrowLeft, LayoutGrid, ListVideo, Plus, type LucideIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { applyReviewCommand } from "@/lib/movie-review-reducer";
import type { MovieReviewProject } from "@/lib/movie-review-types";
import MovieExportGate from "./MovieExportGate";
import MovieStatusBadges from "./MovieStatusBadges";

const modes: Array<{ mode: MovieReviewProject["mode"]; Icon: LucideIcon }> = [
  { mode: "review", Icon: LayoutGrid },
  { mode: "focus", Icon: ListVideo },
  { mode: "assemble", Icon: ListVideo },
];

export default function MovieReviewHeader({
  project,
  onProjectChange,
  onAddClipClick,
}: {
  project: MovieReviewProject;
  onProjectChange: (project: MovieReviewProject) => void;
  onAddClipClick: () => void;
}) {
  const router = useRouter();
  return (
    <header aria-label="Movie Review Header" className="flex flex-wrap items-center gap-3 border-b border-neutral-800 px-4 py-3">
      <button
        type="button"
        aria-label="Back to movies"
        onClick={() => router.push("/movie")}
        className="rounded p-2 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100"
      >
        <ArrowLeft className="h-4 w-4" />
      </button>
      <div className="min-w-0">
        <h1 className="truncate text-base font-semibold text-neutral-100">{project.title}</h1>
        <p className="text-xs text-neutral-500">Movie Review Bay</p>
      </div>
      <div className="ml-auto flex items-center gap-2">
        <button
          type="button"
          aria-label="Add Clip"
          onClick={onAddClipClick}
          className="rounded border border-neutral-800 bg-neutral-900 px-2 py-1 text-xs text-neutral-200 hover:bg-neutral-800"
        >
          <Plus className="mr-1 inline h-3 w-3" />
          <span className="hidden sm:inline">Add Clip</span>
        </button>
        <MovieStatusBadges project={project} />
        <MovieExportGate project={project} />
        <div className="flex rounded border border-neutral-800 bg-neutral-900 p-1">
          {modes.map(({ mode, Icon }) => (
            <button
              key={mode}
              type="button"
              aria-label={`Switch to ${mode} mode`}
              aria-pressed={project.mode === mode}
              onClick={() => onProjectChange(applyReviewCommand(project, { type: "set-mode", mode }))}
              className={`rounded px-2 py-1 text-xs capitalize ${
                project.mode === mode ? "bg-orange-600 text-white" : "text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100"
              }`}
            >
              <Icon className="mr-1 inline h-3 w-3" />
              {mode}
            </button>
          ))}
        </div>
      </div>
    </header>
  );
}
