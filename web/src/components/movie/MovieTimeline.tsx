"use client";

import type { MovieClip } from "@/lib/types";

interface MovieTimelineProps {
  clips: MovieClip[];
  totalDuration: number;
  currentTime: number;
  onSeek: (time: number) => void;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function MovieTimeline({
  clips,
  totalDuration,
  currentTime,
  onSeek,
}: MovieTimelineProps) {
  if (clips.length === 0 || totalDuration <= 0) return null;

  function handleClick(e: React.MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const ratio = x / rect.width;
    onSeek(ratio * totalDuration);
  }

  // Build simple clip blocks (proportional width)
  let accumulated = 0;
  const blocks = clips.map((clip) => {
    const dur = clip.type === "title" ? (clip.titleDuration ?? 3) : 5; // approximate for video
    const start = accumulated;
    accumulated += dur;
    return { clip, start, dur };
  });
  const total = accumulated || 1;

  const playheadPct = totalDuration > 0 ? (currentTime / totalDuration) * 100 : 0;

  return (
    <div className="border-t border-neutral-800 px-4 py-2">
      <div
        className="relative h-6 cursor-pointer overflow-hidden rounded bg-neutral-800"
        onClick={handleClick}
      >
        {/* Clip blocks */}
        {blocks.map((b, i) => (
          <div
            key={b.clip.id}
            className={`absolute top-0 h-full border-r border-neutral-900 ${
              b.clip.type === "title" ? "bg-neutral-600" : "bg-neutral-700"
            }`}
            style={{
              left: `${(b.start / total) * 100}%`,
              width: `${(b.dur / total) * 100}%`,
            }}
          >
            <span className="absolute inset-0 flex items-center px-1 text-[9px] text-neutral-400 truncate">
              {b.clip.type === "title" ? b.clip.titleText : `Clip ${i + 1}`}
            </span>
          </div>
        ))}

        {/* Playhead */}
        <div
          className="absolute top-0 h-full w-0.5 bg-orange-500"
          style={{ left: `${playheadPct}%` }}
        />
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-neutral-500">
        <span>{formatTime(currentTime)}</span>
        <span>{formatTime(totalDuration)} total</span>
      </div>
    </div>
  );
}
