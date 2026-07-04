"use client";

import { Volume2, VolumeX } from "lucide-react";
import MediaDetailsForm from "@/components/ui/MediaDetailsForm";
import { applyReviewCommand } from "@/lib/movie-review-reducer";
import type { MovieReviewProject, ReviewClip } from "@/lib/movie-review-types";
import { clipDisplayTitle } from "./movieReviewPresentation";

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
  const clipIndex = clip ? [...project.candidates, ...project.committedClips].findIndex((item) => item.id === clip.id) : -1;
  const clipTitle = clip ? clipDisplayTitle(clip, Math.max(0, clipIndex)) : "";
  const trimOut = clip?.trimEndSeconds || clip?.durationSeconds || 5;
  const hasSourceAudio = Boolean(clip?.flags.includes("has-source-audio"));
  return (
    <aside role="region" aria-label="Inspector" className="movie-review-inspector min-h-0 overflow-y-auto border-l border-(--hairline) bg-(--surface-panel) p-[var(--space-3)]">
      {clip ? (
        <div className="space-y-[var(--space-4)]">
          <div>
            <div className="text-[length:var(--text-11)] uppercase tracking-wide text-(--color-surface-400)">Selected</div>
            <div className="mt-1 truncate text-[length:var(--text-14)] font-medium text-(--color-surface-100)">{clipTitle}</div>
            <div className="text-[length:var(--text-12)] text-(--color-surface-400)">{clip.mediaType}</div>
          </div>
          <MediaDetailsForm
            idPrefix={clip.id}
            title={clip.titleText || ""}
            titlePlaceholder={clipTitle}
            tags={clip.tags}
            notes={clip.notes}
            onChange={(patch) =>
              onProjectChange(
                applyReviewCommand(project, {
                  type: "set-metadata",
                  clipId: clip.id,
                  titleText: patch.title,
                  tags: patch.tags,
                  notes: patch.notes,
                }),
              )
            }
          />
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
              {clip.mediaType === "video" && (
                <button
                  type="button"
                  aria-label={hasSourceAudio ? "Clear source audio" : "Confirm source audio"}
                  onClick={() =>
                    onProjectChange(
                      applyReviewCommand(project, {
                        type: "set-source-audio",
                        clipId: clip.id,
                        hasSourceAudio: !hasSourceAudio,
                      }),
                    )
                  }
                  className="flex w-full items-center justify-center gap-2 rounded bg-neutral-900 px-3 py-2 text-sm text-neutral-200 hover:bg-neutral-800"
                >
                  <Volume2 className="h-4 w-4" />
                  {hasSourceAudio ? "Clear source audio" : "Confirm source audio"}
                </button>
              )}
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
              <button
                type="button"
                aria-label={clip.solo ? "Unsolo clip" : "Solo clip"}
                onClick={() =>
                  onProjectChange(
                    applyReviewCommand(project, {
                      type: "set-audio",
                      clipId: clip.id,
                      volume: clip.volume,
                      muted: clip.muted,
                      solo: !clip.solo,
                    }),
                  )
                }
                className="flex w-full items-center justify-center gap-2 rounded bg-neutral-900 px-3 py-2 text-sm text-neutral-200 hover:bg-neutral-800"
              >
                <Volume2 className="h-4 w-4" />
                {clip.solo ? "Unsolo clip" : "Solo clip"}
              </button>
            </>
          ) : (
            <div className="text-sm text-neutral-400">Candidate awaiting keep or reject.</div>
          )}
        </div>
      ) : (
        <div className="flex h-full min-h-40 items-center justify-center text-sm text-neutral-400">No clip selected.</div>
      )}
    </aside>
  );
}
