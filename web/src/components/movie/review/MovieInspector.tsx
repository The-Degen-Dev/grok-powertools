"use client";

import { Volume2, VolumeX } from "lucide-react";
import { applyReviewCommand } from "@/lib/movie-review-reducer";
import type { MovieReviewProject, ReviewClip } from "@/lib/movie-review-types";

function clipLabel(clip: ReviewClip): string {
  return clip.sourceAssetId || (clip.mediaRef.type === "vault" ? clip.mediaRef.assetId : clip.titleText || clip.id);
}

function selectedClip(project: MovieReviewProject): ReviewClip | undefined {
  const target = project.selectedTarget;
  if (!target) return project.candidates[project.activeIndex];
  if (target.type === "candidate") return project.candidates.find((clip) => clip.id === target.clipId);
  if (target.type === "clip") return project.committedClips.find((clip) => clip.id === target.clipId);
  return undefined;
}

export default function MovieInspector({
  project,
  onProjectChange,
}: {
  project: MovieReviewProject;
  onProjectChange: (project: MovieReviewProject) => void;
}) {
  const clip = selectedClip(project);
  const committed = clip ? project.committedClips.some((item) => item.id === clip.id) : false;
  const trimOut = clip?.trimEndSeconds || clip?.durationSeconds || 5;
  return (
    <aside role="region" aria-label="Inspector" className="movie-review-inspector min-h-0 overflow-y-auto border-l border-neutral-800 p-4">
      {clip ? (
        <div className="space-y-4">
          <div>
            <div className="text-xs uppercase tracking-wide text-neutral-500">Selected</div>
            <div className="mt-1 truncate text-sm font-medium text-neutral-100">{clipLabel(clip)}</div>
            <div className="text-xs text-neutral-500">{clip.mediaType}</div>
          </div>
          {committed ? (
            <>
              <label className="block text-xs text-neutral-400">
                Trim in
                <input
                  type="number"
                  min="0"
                  step="0.1"
                  value={clip.trimStartSeconds}
                  onChange={(event) =>
                    onProjectChange(
                      applyReviewCommand(project, {
                        type: "set-trim",
                        clipId: clip.id,
                        trimStartSeconds: Number(event.target.value),
                      }),
                    )
                  }
                  className="mt-1 w-full rounded border border-neutral-800 bg-neutral-950 px-2 py-1 text-sm text-neutral-100"
                />
              </label>
              <label className="block text-xs text-neutral-400">
                Trim out
                <input
                  type="number"
                  min="0.1"
                  step="0.1"
                  value={trimOut}
                  onChange={(event) =>
                    onProjectChange(
                      applyReviewCommand(project, {
                        type: "set-trim",
                        clipId: clip.id,
                        trimStartSeconds: clip.trimStartSeconds,
                        trimEndSeconds: Number(event.target.value),
                      }),
                    )
                  }
                  className="mt-1 w-full rounded border border-neutral-800 bg-neutral-950 px-2 py-1 text-sm text-neutral-100"
                />
              </label>
              <label className="block text-xs text-neutral-400">
                Clip volume
                <input
                  type="number"
                  min="0"
                  max="2"
                  step="0.05"
                  value={clip.volume}
                  onChange={(event) =>
                    onProjectChange(
                      applyReviewCommand(project, {
                        type: "set-audio",
                        clipId: clip.id,
                        volume: Number(event.target.value),
                        muted: clip.muted,
                        solo: clip.solo,
                      }),
                    )
                  }
                  className="mt-1 w-full rounded border border-neutral-800 bg-neutral-950 px-2 py-1 text-sm text-neutral-100"
                />
              </label>
              <button
                type="button"
                aria-label={clip.muted ? "Unmute clip" : "Mute clip"}
                onClick={() =>
                  onProjectChange(
                    applyReviewCommand(project, {
                      type: "set-audio",
                      clipId: clip.id,
                      volume: clip.volume,
                      muted: !clip.muted,
                      solo: clip.solo,
                    }),
                  )
                }
                className="flex w-full items-center justify-center gap-2 rounded bg-neutral-900 px-3 py-2 text-sm text-neutral-200 hover:bg-neutral-800"
              >
                {clip.muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
                {clip.muted ? "Unmute clip" : "Mute clip"}
              </button>
            </>
          ) : (
            <div className="text-sm text-neutral-500">Candidate awaiting keep or reject.</div>
          )}
        </div>
      ) : (
        <div className="flex h-full min-h-40 items-center justify-center text-sm text-neutral-500">No clip selected.</div>
      )}
    </aside>
  );
}
