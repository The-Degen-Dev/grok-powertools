"use client";

import { Plus } from "lucide-react";
import type { MovieClip } from "@/lib/types";

interface StoryboardPanelProps {
  clips: MovieClip[];
  onClipsChange: (clips: MovieClip[]) => void;
  activeIndex: number;
  onActiveIndexChange: (index: number) => void;
}

export default function StoryboardPanel({
  clips,
  onClipsChange,
  activeIndex,
  onActiveIndexChange,
}: StoryboardPanelProps) {
  return (
    <div className="flex flex-col gap-1 p-3">
      {clips.length === 0 ? (
        <p className="py-8 text-center text-xs text-neutral-500">
          No clips yet. Add some to start building your movie.
        </p>
      ) : (
        clips.map((clip, index) => (
          <div
            key={clip.id}
            onClick={() => onActiveIndexChange(index)}
            className={`rounded-lg border px-3 py-2 text-xs transition cursor-pointer ${
              index === activeIndex
                ? "border-orange-500/50 bg-orange-500/10 text-orange-400"
                : "border-neutral-800 text-neutral-400 hover:border-neutral-700"
            }`}
          >
            {clip.type === "video" ? `Video: ${clip.videoUrl?.slice(-20) ?? "?"}` : `Title: ${clip.titleText ?? "Untitled"}`}
          </div>
        ))
      )}

      <button
        type="button"
        onClick={() => {/* TODO: open clip source picker */}}
        className="mt-2 flex items-center justify-center gap-1 rounded-lg border border-dashed border-neutral-700 py-2 text-xs text-neutral-500 transition hover:border-neutral-500 hover:text-neutral-300"
      >
        <Plus className="h-3 w-3" />
        Add Clip
      </button>
    </div>
  );
}
