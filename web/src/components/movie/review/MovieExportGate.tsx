"use client";

import { useEffect, useMemo, useState } from "react";
import { getExportPreflight } from "@/lib/movie-timeline-model";
import { listDirectorProposals, listExportRuns } from "@/lib/movie-review-storage";
import type { MovieExportRun, MovieReviewProject } from "@/lib/movie-review-types";
import { useFFmpeg } from "@/lib/useFFmpeg";
import MovieExportButton from "./MovieExportButton";

export default function MovieExportGate({ project }: { project: MovieReviewProject }) {
  const [open, setOpen] = useState(false);
  const [pendingProposalCount, setPendingProposalCount] = useState(0);
  const [runs, setRuns] = useState<MovieExportRun[]>([]);
  const ffmpeg = useFFmpeg();

  useEffect(() => {
    let cancelled = false;
    listDirectorProposals(project.id).then((rows) => {
      if (!cancelled) setPendingProposalCount(rows.filter((proposal) => proposal.status === "pending").length);
    });
    listExportRuns(project.id).then((rows) => {
      if (!cancelled) setRuns(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [project.id, project.updatedAt]);

  const preflight = useMemo(
    () => getExportPreflight({ committedClips: project.committedClips, candidates: project.candidates, pendingProposalCount }),
    [pendingProposalCount, project.candidates, project.committedClips],
  );
  const blocked = preflight.blockers.length > 0;

  function refreshRuns() {
    listExportRuns(project.id).then(setRuns);
  }

  return (
    <div className="relative">
      <button
        type="button"
        disabled={blocked}
        onClick={() => setOpen((current) => !current)}
        className={`rounded px-3 py-2 text-xs font-medium ${
          blocked ? "cursor-not-allowed bg-neutral-800 text-neutral-500" : "bg-orange-600 text-white hover:bg-orange-500"
        }`}
      >
        {blocked ? "Export blocked" : "Export movie"}
      </button>
      {open && !blocked && (
        <div className="absolute right-0 z-20 mt-2 w-80 rounded border border-neutral-800 bg-neutral-950 p-3 shadow-xl">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-medium text-neutral-100">Export</div>
              <div className="text-xs text-neutral-500">{ffmpeg.loaded ? "Engine loaded" : ffmpeg.loading ? "Loading engine..." : "Engine not loaded"}</div>
            </div>
            <button
              type="button"
              onClick={() => {
                void ffmpeg.load();
              }}
              className="rounded bg-neutral-900 px-2 py-1 text-xs text-neutral-200 hover:bg-neutral-800"
            >
              Load export engine
            </button>
          </div>
          {ffmpeg.error && <div className="mt-2 rounded border border-red-500/40 bg-red-500/10 p-2 text-xs text-red-200">{ffmpeg.error}</div>}
          {preflight.warnings.length > 0 && (
            <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-amber-200">
              {preflight.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          )}
          <div className="mt-3 grid gap-2">
            <MovieExportButton project={project} format="mp4" ffmpeg={ffmpeg} onExportSaved={refreshRuns} />
            <MovieExportButton project={project} format="webm" ffmpeg={ffmpeg} onExportSaved={refreshRuns} />
          </div>
          <button
            type="button"
            onClick={ffmpeg.terminate}
            className="mt-3 w-full rounded border border-neutral-800 px-3 py-2 text-xs text-neutral-400 hover:bg-neutral-900"
          >
            Cancel and unload engine
          </button>
          <div className="mt-3 border-t border-neutral-800 pt-3">
            <div className="text-xs uppercase tracking-wide text-neutral-500">Export history</div>
            <div className="mt-2 space-y-1">
              {runs.slice(0, 3).map((run) => (
                <div key={run.id} className="flex justify-between gap-2 text-xs text-neutral-400">
                  <span>{run.format.toUpperCase()}</span>
                  <span>{run.audioProof.codec || "no audio proof"}</span>
                </div>
              ))}
              {runs.length === 0 && <div className="text-xs text-neutral-500">No exports yet.</div>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
