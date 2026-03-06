"use client";

import { Play, Pause } from "lucide-react";
import type { MovieClip } from "@/lib/types";

interface CanvasPlayerProps {
  clips: MovieClip[];
  resolution: { w: number; h: number };
  isPlaying: boolean;
  onPlayingChange: (playing: boolean) => void;
}

export default function CanvasPlayer({
  clips,
  resolution,
  isPlaying,
  onPlayingChange,
}: CanvasPlayerProps) {
  return (
    <div className="flex flex-1 flex-col">
      {/* Canvas area */}
      <div className="flex flex-1 items-center justify-center bg-black">
        {clips.length === 0 ? (
          <p className="text-sm text-neutral-500">Add clips to preview your movie</p>
        ) : (
          <div className="flex items-center justify-center text-neutral-500">
            <p className="text-sm">Canvas player — coming next</p>
          </div>
        )}
      </div>

      {/* Transport controls */}
      <div className="flex items-center justify-center gap-3 border-t border-neutral-800 py-2">
        <button
          type="button"
          onClick={() => onPlayingChange(!isPlaying)}
          className="rounded p-2 text-neutral-300 hover:bg-neutral-800"
        >
          {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </button>
        <span className="text-xs text-neutral-500">0:00 / 0:00</span>
      </div>
    </div>
  );
}
