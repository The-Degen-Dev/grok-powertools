"use client";

import { useMemo } from "react";
import { applyReviewCommand } from "@/lib/movie-review-reducer";
import { clipDurationSeconds, clipEffectiveGain } from "@/lib/movie-timeline-model";
import type { MovieReviewProject, ReviewClip } from "@/lib/movie-review-types";
import MoviePreview from "./MoviePreview";
import MovieWaveform from "./MovieWaveform";
import { useMovieAudioPreview } from "./useMovieAudioPreview";
import { useMovieMediaEngine } from "./useMovieMediaEngine";
import type { MovieReviewProjectUpdate } from "./useMovieReviewProject";
import { clipDisplayTitle } from "./movieReviewPresentation";

function selectedCommittedClip(project: MovieReviewProject, clips: ReviewClip[]): ReviewClip | undefined {
  if (project.selectedTarget?.type === "clip") {
    const clipId = project.selectedTarget.clipId;
    return clips.find((clip) => clip.id === clipId) ?? clips[0];
  }
  return clips[0];
}

export default function MovieAssembleView({
  project,
  onProjectChange,
}: {
  project: MovieReviewProject;
  onProjectChange: (project: MovieReviewProjectUpdate) => void;
}) {
  const clips = useMemo(() => project.committedClips.slice().sort((a, b) => a.position - b.position), [project.committedClips]);
  const { videos } = useMovieMediaEngine(clips);
  useMovieAudioPreview(clips, videos, project.masterVolume, project.masterMuted);
  const activeClip = selectedCommittedClip(project, clips);
  const totalDuration = clips.reduce((sum, clip) => sum + clipDurationSeconds(clip), 0) || 1;

  return (
    <main className="movie-review-center grid min-h-0 gap-3 overflow-y-auto p-4 lg:grid-rows-[minmax(0,1fr)_auto_auto]">
      <MoviePreview clip={activeClip} videos={videos} />
      <section role="region" aria-label="Time-proportional ribbon" className="rounded border border-neutral-800 bg-neutral-900 p-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-medium text-neutral-100">Cut ribbon</h2>
          <span className="text-xs text-neutral-400">{clips.length} committed clips</span>
        </div>
        <div className="mt-3 flex min-h-16 overflow-hidden rounded border border-neutral-800 bg-neutral-950">
          {clips.length === 0 ? (
            <div className="flex flex-1 items-center justify-center text-sm text-neutral-400">No committed clips.</div>
          ) : (
            clips.map((clip) => {
              const selected = activeClip?.id === clip.id;
              const width = `${Math.max(8, (clipDurationSeconds(clip) / totalDuration) * 100)}%`;
              return (
                <button
                  key={clip.id}
                  type="button"
                  aria-label={`Select ${clipDisplayTitle(clip, clip.position)} in cut ribbon`}
                  onClick={() => onProjectChange((current) => applyReviewCommand(current, { type: "select", target: { type: "clip", clipId: clip.id } }))}
                  className={`min-w-24 border-r border-neutral-800 px-3 py-2 text-left text-xs ${
                    selected ? "bg-(--state-accent-bg-subtle) text-(--state-accent-fg)" : "bg-neutral-950 text-neutral-300 hover:bg-neutral-800"
                  }`}
                  style={{ width }}
                >
                  <span className="block truncate font-medium">{clipDisplayTitle(clip, clip.position)}</span>
                  <span className="mt-1 block text-neutral-400">{clipDurationSeconds(clip).toFixed(1)}s</span>
                </button>
              );
            })
          )}
        </div>
      </section>
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_18rem]">
        <MovieWaveform clip={activeClip} onProjectChange={onProjectChange} />
        <section role="region" aria-label="Audio lane" className="rounded border border-neutral-800 bg-neutral-900 p-3">
          <h2 className="text-sm font-medium text-neutral-100">Source audio</h2>
          <div className="mt-3 space-y-2">
            {clips.map((clip) => (
              <div key={clip.id} className="flex items-center justify-between gap-3 rounded bg-neutral-950 px-2 py-2 text-xs">
                <span className="truncate text-neutral-300">{clipDisplayTitle(clip, clip.position)}</span>
                <span className="text-neutral-400">{clip.muted ? "Muted" : `Gain ${clipEffectiveGain(clip, clips, project.masterVolume, project.masterMuted).toFixed(2)}`}</span>
              </div>
            ))}
            {clips.length === 0 && <div className="text-sm text-neutral-400">No source audio until a clip is kept.</div>}
          </div>
        </section>
      </div>
    </main>
  );
}
