"use client";

import { useCallback } from "react";
import type { CropRect, CropPreset } from "@/lib/ffmpeg-commands";

interface CropOverlayProps {
  crop: CropRect;
  cropPreset: CropPreset;
  videoWidth: number;
  videoHeight: number;
  /** Display rect of the video within its container (from ResizeObserver + object-contain math) */
  displayRect: { x: number; y: number; w: number; h: number };
  onCropChange: (crop: CropRect) => void;
}

const HANDLE_SIZE = 10;

const HANDLES = [
  { id: "tl", cursor: "nwse-resize", x: 0, y: 0 },
  { id: "tr", cursor: "nesw-resize", x: 1, y: 0 },
  { id: "bl", cursor: "nesw-resize", x: 0, y: 1 },
  { id: "br", cursor: "nwse-resize", x: 1, y: 1 },
  { id: "t", cursor: "ns-resize", x: 0.5, y: 0 },
  { id: "b", cursor: "ns-resize", x: 0.5, y: 1 },
  { id: "l", cursor: "ew-resize", x: 0, y: 0.5 },
  { id: "r", cursor: "ew-resize", x: 1, y: 0.5 },
] as const;

type HandleId = (typeof HANDLES)[number]["id"];

export default function CropOverlay({
  crop,
  cropPreset,
  videoWidth,
  videoHeight,
  displayRect,
  onCropChange,
}: CropOverlayProps) {
  const scale = displayRect.w / videoWidth;

  // Convert crop (video pixels) to display pixels
  const left = displayRect.x + crop.x * scale;
  const top = displayRect.y + crop.y * scale;
  const width = crop.w * scale;
  const height = crop.h * scale;

  const isFullFrame = crop.x === 0 && crop.y === 0 && crop.w === videoWidth && crop.h === videoHeight;

  const clampCrop = useCallback(
    (c: CropRect): CropRect => {
      let { x, y, w, h } = c;
      // Minimum size: 20px in video coords
      w = Math.max(20, w);
      h = Math.max(20, h);
      // Even dimensions for libx264
      w = w - (w % 2);
      h = h - (h % 2);
      // Clamp to video bounds
      x = Math.max(0, Math.min(x, videoWidth - w));
      y = Math.max(0, Math.min(y, videoHeight - h));
      return { x, y, w, h };
    },
    [videoWidth, videoHeight]
  );

  /** Convert a display-space pointer position to video-space coordinates */
  const displayToVideo = useCallback(
    (clientX: number, clientY: number) => ({
      vx: (clientX - displayRect.x) / scale,
      vy: (clientY - displayRect.y) / scale,
    }),
    [displayRect, scale]
  );

  const handleDragMove = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const target = e.currentTarget as HTMLElement;
      target.setPointerCapture(e.pointerId);

      const startVPos = displayToVideo(e.clientX, e.clientY);
      const startCrop = { ...crop };

      const onMove = (ev: PointerEvent) => {
        const curr = displayToVideo(ev.clientX, ev.clientY);
        const dx = Math.round(curr.vx - startVPos.vx);
        const dy = Math.round(curr.vy - startVPos.vy);
        onCropChange(
          clampCrop({
            x: startCrop.x + dx,
            y: startCrop.y + dy,
            w: startCrop.w,
            h: startCrop.h,
          })
        );
      };

      const onUp = () => {
        target.removeEventListener("pointermove", onMove);
        target.removeEventListener("pointerup", onUp);
      };

      target.addEventListener("pointermove", onMove);
      target.addEventListener("pointerup", onUp);
    },
    [crop, displayToVideo, clampCrop, onCropChange]
  );

  const handleResize = useCallback(
    (handleId: HandleId, e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const target = e.currentTarget as HTMLElement;
      target.setPointerCapture(e.pointerId);

      const startVPos = displayToVideo(e.clientX, e.clientY);
      const startCrop = { ...crop };
      const ratioLocked = cropPreset !== "free";
      const aspectRatio = ratioLocked && crop.w > 0 && crop.h > 0 ? crop.w / crop.h : null;

      const onMove = (ev: PointerEvent) => {
        const curr = displayToVideo(ev.clientX, ev.clientY);
        const dx = Math.round(curr.vx - startVPos.vx);
        const dy = Math.round(curr.vy - startVPos.vy);

        let { x, y, w, h } = startCrop;

        // Apply delta based on which handle
        if (handleId.includes("l")) { x += dx; w -= dx; }
        if (handleId.includes("r")) { w += dx; }
        if (handleId.includes("t")) { y += dy; h -= dy; }
        if (handleId.includes("b")) { h += dy; }

        // Enforce aspect ratio
        if (aspectRatio && w > 0 && h > 0) {
          if (handleId === "t" || handleId === "b") {
            w = Math.round(h * aspectRatio);
          } else {
            h = Math.round(w / aspectRatio);
          }
          // For corners, use the larger delta
          if (handleId.length === 2) {
            if (Math.abs(dx) > Math.abs(dy)) {
              h = Math.round(w / aspectRatio);
            } else {
              w = Math.round(h * aspectRatio);
            }
          }
        }

        onCropChange(clampCrop({ x, y, w, h }));
      };

      const onUp = () => {
        target.removeEventListener("pointermove", onMove);
        target.removeEventListener("pointerup", onUp);
      };

      target.addEventListener("pointermove", onMove);
      target.addEventListener("pointerup", onUp);
    },
    [crop, cropPreset, displayToVideo, clampCrop, onCropChange]
  );

  if (isFullFrame && cropPreset === "free") return null;

  return (
    <div className="absolute inset-0">
      {/* Dark mask via box-shadow */}
      <div
        className="absolute cursor-move touch-none"
        style={{
          left: `${left}px`,
          top: `${top}px`,
          width: `${width}px`,
          height: `${height}px`,
          boxShadow: "0 0 0 9999px rgba(0, 0, 0, 0.6)",
        }}
        onPointerDown={handleDragMove}
      >
        {/* Border */}
        <div className="absolute inset-0 border-2 border-white/60" />

        {/* Rule of thirds grid */}
        <div className="absolute left-1/3 top-0 h-full w-px bg-white/20" />
        <div className="absolute left-2/3 top-0 h-full w-px bg-white/20" />
        <div className="absolute left-0 top-1/3 h-px w-full bg-white/20" />
        <div className="absolute left-0 top-2/3 h-px w-full bg-white/20" />

        {/* Resize handles */}
        {HANDLES.map((h) => (
          <div
            key={h.id}
            className="absolute touch-none bg-white"
            style={{
              width: `${HANDLE_SIZE}px`,
              height: `${HANDLE_SIZE}px`,
              left: `${h.x * 100}%`,
              top: `${h.y * 100}%`,
              transform: "translate(-50%, -50%)",
              cursor: h.cursor,
            }}
            onPointerDown={(e) => handleResize(h.id, e)}
          />
        ))}
      </div>
    </div>
  );
}
