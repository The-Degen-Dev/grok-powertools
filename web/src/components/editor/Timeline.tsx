"use client";

import { useRef, useCallback } from "react";

interface TimelineProps {
  duration: number;
  trimStart: number;
  trimEnd: number;
  currentTime: number;
  onTrimStartChange: (t: number) => void;
  onTrimEndChange: (t: number) => void;
  onSeek: (t: number) => void;
}

function formatTime(s: number): string {
  const mins = Math.floor(s / 60);
  const secs = s % 60;
  return `${mins}:${secs.toFixed(1).padStart(4, "0")}`;
}

export default function Timeline({
  duration,
  trimStart,
  trimEnd,
  currentTime,
  onTrimStartChange,
  onTrimEndChange,
  onSeek,
}: TimelineProps) {
  const barRef = useRef<HTMLDivElement>(null);

  const positionToTime = useCallback(
    (clientX: number) => {
      const bar = barRef.current;
      if (!bar || duration <= 0) return 0;
      const rect = bar.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      return ratio * duration;
    },
    [duration]
  );

  const startDrag = useCallback(
    (type: "start" | "end", e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const target = e.currentTarget as HTMLElement;
      target.setPointerCapture(e.pointerId);

      const handleMove = (ev: PointerEvent) => {
        const t = positionToTime(ev.clientX);
        if (type === "start") {
          onTrimStartChange(Math.min(t, trimEnd - 0.1));
          onSeek(Math.min(t, trimEnd - 0.1));
        } else {
          onTrimEndChange(Math.max(t, trimStart + 0.1));
          onSeek(Math.max(t, trimStart + 0.1));
        }
      };

      const handleUp = () => {
        target.removeEventListener("pointermove", handleMove);
        target.removeEventListener("pointerup", handleUp);
      };

      target.addEventListener("pointermove", handleMove);
      target.addEventListener("pointerup", handleUp);
    },
    [positionToTime, trimStart, trimEnd, onTrimStartChange, onTrimEndChange, onSeek]
  );

  const handleBarClick = (e: React.MouseEvent) => {
    const t = positionToTime(e.clientX);
    onSeek(t);
  };

  if (duration <= 0) {
    return <div className="flex h-20 items-center justify-center text-sm text-neutral-500">Load a video to enable timeline</div>;
  }

  const startPct = (trimStart / duration) * 100;
  const endPct = (trimEnd / duration) * 100;
  const playheadPct = (currentTime / duration) * 100;
  const selectionDuration = trimEnd - trimStart;

  return (
    <div className="flex h-20 flex-col justify-center gap-2 px-4">
      {/* Time labels */}
      <div className="flex items-center justify-between text-xs text-neutral-400">
        <span>{formatTime(trimStart)}</span>
        <span className="font-medium text-orange-500">
          {formatTime(selectionDuration)} selected
        </span>
        <span>{formatTime(trimEnd)}</span>
      </div>

      {/* Timeline bar */}
      <div
        ref={barRef}
        className="relative h-8 cursor-pointer rounded bg-neutral-800"
        onClick={handleBarClick}
      >
        {/* Selected range */}
        <div
          className="absolute top-0 h-full rounded bg-orange-500/20"
          style={{ left: `${startPct}%`, width: `${endPct - startPct}%` }}
        />

        {/* Playhead */}
        <div
          className="pointer-events-none absolute top-0 h-full w-0.5 bg-white"
          style={{ left: `${playheadPct}%` }}
        />

        {/* Start handle */}
        <div
          className="absolute top-0 h-full w-3 cursor-ew-resize touch-none rounded-l bg-orange-500 hover:bg-orange-400"
          style={{ left: `${startPct}%`, transform: "translateX(-100%)" }}
          onPointerDown={(e) => startDrag("start", e)}
        >
          <div className="flex h-full items-center justify-center">
            <div className="h-3 w-0.5 rounded bg-white/70" />
          </div>
        </div>

        {/* End handle */}
        <div
          className="absolute top-0 h-full w-3 cursor-ew-resize touch-none rounded-r bg-orange-500 hover:bg-orange-400"
          style={{ left: `${endPct}%` }}
          onPointerDown={(e) => startDrag("end", e)}
        >
          <div className="flex h-full items-center justify-center">
            <div className="h-3 w-0.5 rounded bg-white/70" />
          </div>
        </div>
      </div>
    </div>
  );
}
