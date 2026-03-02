"use client";

import { RotateCcw } from "lucide-react";
import type { CropPreset, CropRect } from "@/lib/ffmpeg-commands";
import { cropRectForPreset } from "@/lib/ffmpeg-commands";

const PRESETS: { label: string; value: CropPreset }[] = [
  { label: "Free", value: "free" },
  { label: "9:16", value: "9:16" },
  { label: "16:9", value: "16:9" },
  { label: "1:1", value: "1:1" },
  { label: "4:5", value: "4:5" },
  { label: "2:3", value: "2:3" },
];

interface CropControlsProps {
  preset: CropPreset;
  crop: CropRect;
  videoWidth: number;
  videoHeight: number;
  onPresetChange: (preset: CropPreset) => void;
  onCropChange: (crop: CropRect) => void;
}

export default function CropControls({
  preset,
  crop,
  videoWidth,
  videoHeight,
  onPresetChange,
  onCropChange,
}: CropControlsProps) {
  function handlePreset(p: CropPreset) {
    onPresetChange(p);
    if (p !== "free") {
      onCropChange(cropRectForPreset(p, videoWidth, videoHeight));
    }
  }

  function handleReset() {
    onPresetChange("free");
    onCropChange({ x: 0, y: 0, w: videoWidth, h: videoHeight });
  }

  function handleFieldChange(field: keyof CropRect, value: string) {
    const num = parseInt(value, 10);
    if (isNaN(num) || num < 0) return;
    const next = { ...crop, [field]: num };
    // Clamp to video bounds
    next.x = Math.min(next.x, videoWidth - 2);
    next.y = Math.min(next.y, videoHeight - 2);
    next.w = Math.min(next.w, videoWidth - next.x);
    next.h = Math.min(next.h, videoHeight - next.y);
    // Ensure even dimensions
    next.w = next.w - (next.w % 2);
    next.h = next.h - (next.h % 2);
    onCropChange(next);
    onPresetChange("free");
  }

  const disabled = videoWidth === 0;

  return (
    <div className="flex flex-wrap items-center gap-3">
      {/* Preset buttons */}
      <div className="flex gap-1">
        {PRESETS.map(({ label, value }) => (
          <button
            key={value}
            type="button"
            disabled={disabled}
            onClick={() => handlePreset(value)}
            className={`rounded px-2.5 py-1 text-xs font-medium transition ${
              preset === value
                ? "bg-orange-500/20 text-orange-400"
                : "bg-neutral-800 text-neutral-400 hover:bg-neutral-700 hover:text-neutral-200"
            } disabled:opacity-40`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Pixel inputs */}
      <div className="flex items-center gap-2 text-xs text-neutral-400">
        {(["x", "y", "w", "h"] as const).map((field) => (
          <label key={field} className="flex items-center gap-1">
            <span className="uppercase">{field}</span>
            <input
              type="number"
              disabled={disabled}
              value={crop[field]}
              onChange={(e) => handleFieldChange(field, e.target.value)}
              className="w-16 rounded bg-neutral-800 px-1.5 py-1 text-xs text-neutral-200 disabled:opacity-40"
            />
          </label>
        ))}
      </div>

      {/* Reset */}
      <button
        type="button"
        disabled={disabled}
        onClick={handleReset}
        className="flex items-center gap-1 rounded px-2 py-1 text-xs text-neutral-400 transition hover:bg-neutral-800 hover:text-neutral-200 disabled:opacity-40"
      >
        <RotateCcw className="h-3 w-3" />
        Reset
      </button>
    </div>
  );
}
