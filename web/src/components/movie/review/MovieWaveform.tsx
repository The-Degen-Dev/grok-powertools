"use client";

import { applyReviewCommand } from "@/lib/movie-review-reducer";
import type { ReviewClip } from "@/lib/movie-review-types";
import type { MovieReviewProjectUpdate } from "./useMovieReviewProject";

function clipLabel(clip: ReviewClip): string {
  return clip.sourceAssetId || (clip.mediaRef.type === "vault" ? clip.mediaRef.assetId : clip.titleText || clip.id);
}

export default function MovieWaveform({
  clip,
  onProjectChange,
}: {
  clip: ReviewClip | undefined;
  onProjectChange: (project: MovieReviewProjectUpdate) => void;
}) {
  const trimStartSeconds = clip?.trimStartSeconds ?? 0;
  const trimEndSeconds = clip?.trimEndSeconds ?? clip?.durationSeconds ?? 5;
  const maxSeconds = Math.max(trimEndSeconds, clip?.durationSeconds ?? 5);

  return (
    <section role="region" aria-label="Clip waveform" className="rounded border border-neutral-800 bg-neutral-900 p-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium text-neutral-100">Waveform</h2>
        <span className="truncate text-xs text-neutral-500">{clip ? clipLabel(clip) : "No committed clip"}</span>
      </div>
      <div
        className="mt-3 grid h-12 items-end gap-1 rounded bg-neutral-950 p-2"
        style={{ gridTemplateColumns: "repeat(16, minmax(0, 1fr))" }}
        aria-hidden="true"
      >
        {Array.from({ length: 16 }).map((_, index) => (
          <span
            key={index}
            className="rounded-sm bg-orange-500/70"
            style={{ height: `${20 + ((index * 13) % 28)}px` }}
          />
        ))}
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="text-xs text-neutral-400">
          Trim in
          <input
            type="range"
            aria-label="Trim in"
            aria-valuetext={`${trimStartSeconds.toFixed(2)} seconds`}
            min="0"
            max={maxSeconds}
            step="0.05"
            value={trimStartSeconds}
            disabled={!clip}
            onChange={(event) => {
              if (!clip) return;
              onProjectChange((current) =>
                applyReviewCommand(current, {
                  type: "set-trim",
                  clipId: clip.id,
                  trimStartSeconds: Number(event.target.value),
                }),
              );
            }}
            className="mt-2 w-full accent-orange-500"
          />
        </label>
        <label className="text-xs text-neutral-400">
          Trim out
          <input
            type="range"
            aria-label="Trim out"
            aria-valuetext={`${trimEndSeconds.toFixed(2)} seconds`}
            min="0.05"
            max={maxSeconds}
            step="0.05"
            value={trimEndSeconds}
            disabled={!clip}
            onChange={(event) => {
              if (!clip) return;
              onProjectChange((current) =>
                applyReviewCommand(current, {
                  type: "set-trim",
                  clipId: clip.id,
                  trimEndSeconds: Number(event.target.value),
                }),
              );
            }}
            className="mt-2 w-full accent-orange-500"
          />
        </label>
      </div>
    </section>
  );
}
