"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { clipDurationSeconds, getExportPreflight } from "@/lib/movie-timeline-model";
import { listDirectorProposals, listExportRuns } from "@/lib/movie-review-storage";
import type { MovieExportRun, MovieReviewProject } from "@/lib/movie-review-types";
import { useFFmpeg } from "@/lib/useFFmpeg";
import MovieExportButton from "./MovieExportButton";

function plural(count: number, singular: string, pluralLabel = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralLabel}`;
}

function exportBlockerDetails(project: MovieReviewProject, pendingProposalCount: number, blockers: string[]) {
  const details: string[] = [];
  const unresolvedCandidates = project.candidates.filter((clip) => clip.lifecycle !== "rejected").length;
  const missingMedia = project.committedClips.filter(
    (clip) => (clip.mediaType === "video" && !clip.videoUrl) || (clip.mediaType === "image" && !clip.imageUrl),
  ).length;
  const invalidDurations = project.committedClips.filter((clip) => clipDurationSeconds(clip) <= 0).length;
  const unknownAudio = project.committedClips.filter(
    (clip) => clip.mediaType === "video" && !clip.flags.includes("has-source-audio") && !clip.flags.includes("muted-in-mix"),
  ).length;

  if (project.committedClips.length === 0) details.push("No committed clips in the timeline.");
  if (unresolvedCandidates > 0) details.push(`${plural(unresolvedCandidates, "candidate")} still awaiting keep or reject.`);
  if (pendingProposalCount > 0) details.push(`${plural(pendingProposalCount, "pending Director proposal")} could change export state.`);
  if (missingMedia > 0) details.push(`${plural(missingMedia, "clip")} missing source media.`);
  if (invalidDurations > 0) details.push(`${plural(invalidDurations, "clip")} with invalid duration.`);
  if (unknownAudio > 0) details.push(`Unconfirmed source audio on ${plural(unknownAudio, "video clip")}.`);

  const covered = new Set([
    "No committed clips",
    "Unresolved unsafe candidate state",
    "Pending proposal that would change export state",
    "Missing media",
    "Invalid duration",
    "Unknown audio intent",
  ]);
  for (const blocker of blockers) {
    if (!covered.has(blocker)) details.push(blocker);
  }
  return details;
}

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
  const blockerDetails = useMemo(
    () => exportBlockerDetails(project, pendingProposalCount, preflight.blockers),
    [pendingProposalCount, preflight.blockers, project],
  );
  const blockerSummary = blockerDetails[0] ?? "Review preflight blockers.";

  function refreshRuns() {
    listExportRuns(project.id).then(setRuns);
  }

  return (
    <div className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-label={blocked ? `Export blocked: ${blockerSummary}` : "Export movie"}
        onClick={() => setOpen((current) => !current)}
        className={`inline-flex items-center gap-1.5 rounded px-3 py-2 text-xs font-medium ${
          blocked
            ? "border border-(--state-rejected-border) bg-(--state-rejected-bg-subtle) text-(--state-rejected-fg) hover:border-(--state-rejected)"
            : "bg-(--state-accent) text-white hover:opacity-90"
        }`}
      >
        {blocked && <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />}
        {blocked ? "Export blocked" : "Export movie"}
      </button>
      {open && (
        <div className="movie-export-popover absolute right-0 z-20 mt-2 w-80 rounded border border-(--hairline) bg-(--surface-panel) p-3 shadow-xl">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-medium text-neutral-100">{blocked ? "Export blocked" : "Export"}</div>
              <div className="text-xs text-neutral-400">{ffmpeg.loaded ? "Engine loaded" : ffmpeg.loading ? "Loading engine..." : "Engine not loaded"}</div>
            </div>
            {!blocked && (
              <button
                type="button"
                onClick={() => {
                  void ffmpeg.load();
                }}
                className="rounded bg-neutral-900 px-2 py-1 text-xs text-neutral-200 hover:bg-neutral-800"
              >
                Load export engine
              </button>
            )}
          </div>
          {ffmpeg.error && <div className="mt-2 rounded border border-red-500/40 bg-red-500/10 p-2 text-xs text-red-200">{ffmpeg.error}</div>}
          {blocked && (
            <div className="mt-2 rounded border border-(--state-rejected-border) bg-(--state-rejected-bg-subtle) p-2">
              <div className="text-xs font-medium text-(--state-rejected-fg)">Resolve before export</div>
              <ul className="mt-1 list-disc space-y-1 pl-4 text-xs text-(--state-rejected-fg)">
                {blockerDetails.map((blocker) => (
                  <li key={blocker}>{blocker}</li>
                ))}
              </ul>
            </div>
          )}
          {preflight.warnings.length > 0 && (
            <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-amber-200">
              {preflight.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          )}
          {!blocked && (
            <>
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
            </>
          )}
          <div className="mt-3 border-t border-neutral-800 pt-3">
            <div className="text-xs uppercase tracking-wide text-neutral-400">Export history</div>
            <div className="mt-2 space-y-1">
              {runs.slice(0, 3).map((run) => (
                <div key={run.id} className="flex justify-between gap-2 text-xs text-neutral-400">
                  <span>{run.format.toUpperCase()}</span>
                  <span>{run.audioProof.codec || "no audio proof"}</span>
                </div>
              ))}
              {runs.length === 0 && <div className="text-xs text-neutral-400">No exports yet.</div>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
