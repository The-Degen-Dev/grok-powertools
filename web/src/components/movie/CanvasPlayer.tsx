"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import { Play, Pause, Maximize2, Minimize2 } from "lucide-react";
import type { MovieClip } from "@/lib/types";

interface CanvasPlayerProps {
  clips: MovieClip[];
  resolution: { w: number; h: number };
  isPlaying: boolean;
  onPlayingChange: (playing: boolean) => void;
  fullscreen?: boolean;
  onFullscreenChange?: (fs: boolean) => void;
  currentTime?: number;
  onTimeUpdate?: (time: number) => void;
}

interface TimelineEntry {
  clipIndex: number;
  startTime: number;
  endTime: number;
  clipStart: number;
  clipDuration: number;
}

function buildTimeline(clips: MovieClip[], videoDurations: Map<string, number>): TimelineEntry[] {
  const entries: TimelineEntry[] = [];
  let currentTime = 0;

  for (let i = 0; i < clips.length; i++) {
    const clip = clips[i];
    let clipDuration: number;

    if (clip.type === "title") {
      clipDuration = clip.titleDuration ?? 3;
    } else {
      const fullDuration = videoDurations.get(clip.id) ?? 5;
      const start = clip.trimStart ?? 0;
      const end = clip.trimEnd ?? fullDuration;
      clipDuration = end - start;
    }

    const overlap = i > 0 && clip.transition.type === "crossfade" ? clip.transition.duration : 0;
    const startTime = currentTime - overlap;

    entries.push({
      clipIndex: i,
      startTime,
      endTime: startTime + clipDuration,
      clipStart: clip.type === "video" ? (clip.trimStart ?? 0) : 0,
      clipDuration,
    });

    currentTime = startTime + clipDuration;
  }

  return entries;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function CanvasPlayer({
  clips,
  resolution,
  isPlaying,
  onPlayingChange,
  fullscreen = false,
  onFullscreenChange,
  currentTime: externalTime,
  onTimeUpdate,
}: CanvasPlayerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRefs = useRef<Map<string, HTMLVideoElement>>(new Map());
  const videoDurations = useRef<Map<string, number>>(new Map());
  const rafRef = useRef<number>(0);
  const playStartRef = useRef<number>(0);
  const timeOffsetRef = useRef<number>(0);
  const [localTime, setLocalTime] = useState(0);
  const [totalDuration, setTotalDuration] = useState(0);

  const currentTimeValue = externalTime ?? localTime;

  // Create/update video elements when clips change
  useEffect(() => {
    const currentIds = new Set(clips.filter((c) => c.type === "video").map((c) => c.id));
    // Remove stale
    for (const [id, el] of videoRefs.current) {
      if (!currentIds.has(id)) {
        el.pause();
        el.src = "";
        videoRefs.current.delete(id);
        videoDurations.current.delete(id);
      }
    }
    // Add new
    for (const clip of clips) {
      if (clip.type !== "video" || !clip.videoUrl) continue;
      if (videoRefs.current.has(clip.id)) continue;
      const video = document.createElement("video");
      video.crossOrigin = "anonymous";
      video.preload = "auto";
      video.muted = true;
      video.playsInline = true;
      video.src = clip.videoUrl;
      video.addEventListener("loadedmetadata", () => {
        videoDurations.current.set(clip.id, video.duration);
        // Recalculate total duration
        const timeline = buildTimeline(clips, videoDurations.current);
        if (timeline.length > 0) {
          setTotalDuration(timeline[timeline.length - 1].endTime);
        }
      });
      video.load();
      videoRefs.current.set(clip.id, video);
    }
  }, [clips]);

  // Recalculate total duration when clips change
  useEffect(() => {
    const timeline = buildTimeline(clips, videoDurations.current);
    if (timeline.length > 0) {
      setTotalDuration(timeline[timeline.length - 1].endTime);
    } else {
      setTotalDuration(0);
    }
  }, [clips]);

  // Render loop
  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const w = resolution.w;
    const h = resolution.h;
    canvas.width = w;
    canvas.height = h;

    const timeline = buildTimeline(clips, videoDurations.current);
    const t = currentTimeValue;

    // Clear
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, w, h);

    // Find active entries
    const active = timeline.filter((e) => t >= e.startTime && t < e.endTime);

    for (const entry of active) {
      const clip = clips[entry.clipIndex];

      ctx.save();

      // Calculate transition alpha
      let alpha = 1;
      if (clip.transition.type === "fade" && entry.clipIndex > 0) {
        const fadeDur = clip.transition.duration;
        const elapsed = t - entry.startTime;
        if (elapsed < fadeDur) {
          alpha = elapsed / fadeDur;
        }
      } else if (clip.transition.type === "crossfade" && entry.clipIndex > 0) {
        const xfadeDur = clip.transition.duration;
        const elapsed = t - entry.startTime;
        if (elapsed < xfadeDur) {
          // During crossfade, check if we're the incoming or outgoing
          const prevEntry = timeline.find((e) => e.clipIndex === entry.clipIndex - 1);
          if (prevEntry && t < prevEntry.endTime) {
            // We're in the overlap zone — incoming clip fades in
            alpha = elapsed / xfadeDur;
          }
        }
      }

      // Also handle outgoing alpha for crossfade
      if (entry.clipIndex < clips.length - 1) {
        const nextClip = clips[entry.clipIndex + 1];
        if (nextClip.transition.type === "crossfade") {
          const xfadeDur = nextClip.transition.duration;
          const timeUntilEnd = entry.endTime - t;
          if (timeUntilEnd < xfadeDur) {
            alpha = timeUntilEnd / xfadeDur;
          }
        }
      }

      // Handle fade-out for outgoing on "fade" transitions
      if (entry.clipIndex < clips.length - 1) {
        const nextClip = clips[entry.clipIndex + 1];
        if (nextClip.transition.type === "fade") {
          const fadeDur = nextClip.transition.duration;
          const nextEntry = timeline.find((e) => e.clipIndex === entry.clipIndex + 1);
          if (nextEntry) {
            const timeUntilEnd = entry.endTime - t;
            if (timeUntilEnd < fadeDur) {
              alpha = timeUntilEnd / fadeDur;
            }
          }
        }
      }

      ctx.globalAlpha = Math.max(0, Math.min(1, alpha));

      if (clip.type === "video") {
        const video = videoRefs.current.get(clip.id);
        if (video && video.readyState >= 2) {
          // Seek video to correct position
          const clipLocalTime = (t - entry.startTime) + entry.clipStart;
          if (Math.abs(video.currentTime - clipLocalTime) > 0.1) {
            video.currentTime = clipLocalTime;
          }
          // Draw with letterboxing
          const vw = video.videoWidth;
          const vh = video.videoHeight;
          if (vw > 0 && vh > 0) {
            const scale = Math.min(w / vw, h / vh);
            const dw = vw * scale;
            const dh = vh * scale;
            ctx.drawImage(video, (w - dw) / 2, (h - dh) / 2, dw, dh);
          }
        }
      } else if (clip.type === "title") {
        // Title card
        ctx.fillStyle = clip.titleBgColor ?? "#000000";
        ctx.fillRect(0, 0, w, h);

        ctx.fillStyle = clip.titleTextColor ?? "#ffffff";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";

        // Main title
        const fontSize = Math.round(w / 15);
        ctx.font = `bold ${fontSize}px sans-serif`;
        ctx.fillText(clip.titleText ?? "", w / 2, clip.titleSubtext ? h / 2 - fontSize * 0.6 : h / 2);

        // Subtitle
        if (clip.titleSubtext) {
          const subSize = Math.round(fontSize * 0.5);
          ctx.font = `${subSize}px sans-serif`;
          ctx.fillText(clip.titleSubtext, w / 2, h / 2 + fontSize * 0.6);
        }
      }

      ctx.restore();
    }
  }, [clips, resolution, currentTimeValue]);

  // Animation loop for playback
  useEffect(() => {
    if (!isPlaying) {
      cancelAnimationFrame(rafRef.current);
      // Pause all videos
      for (const video of videoRefs.current.values()) {
        video.pause();
      }
      return;
    }

    playStartRef.current = performance.now();
    timeOffsetRef.current = currentTimeValue;

    const loop = () => {
      const elapsed = (performance.now() - playStartRef.current) / 1000;
      const newTime = timeOffsetRef.current + elapsed;

      if (newTime >= totalDuration && totalDuration > 0) {
        // End of movie
        const finalTime = totalDuration;
        setLocalTime(finalTime);
        onTimeUpdate?.(finalTime);
        onPlayingChange(false);
        return;
      }

      setLocalTime(newTime);
      onTimeUpdate?.(newTime);
      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);

    return () => cancelAnimationFrame(rafRef.current);
  }, [isPlaying, totalDuration, onPlayingChange, onTimeUpdate, currentTimeValue]);

  // Render on every time/clip change
  useEffect(() => {
    render();
  }, [render]);

  // Seek handler
  const handleSeek = useCallback(
    (time: number) => {
      setLocalTime(time);
      onTimeUpdate?.(time);
      if (isPlaying) {
        playStartRef.current = performance.now();
        timeOffsetRef.current = time;
      }
    },
    [isPlaying, onTimeUpdate]
  );

  const containerClass = fullscreen
    ? "fixed inset-0 z-50 flex flex-col bg-black"
    : "flex flex-1 flex-col";

  return (
    <div className={containerClass}>
      {/* Canvas area */}
      <div className="flex flex-1 items-center justify-center bg-black min-h-0">
        {clips.length === 0 ? (
          <p className="text-sm text-neutral-500">Add clips to preview your movie</p>
        ) : (
          <canvas
            ref={canvasRef}
            className="max-h-full max-w-full"
            style={{
              aspectRatio: `${resolution.w}/${resolution.h}`,
            }}
          />
        )}
      </div>

      {/* Transport controls */}
      <div className="flex items-center justify-center gap-3 border-t border-neutral-800 py-2 px-4">
        <button
          type="button"
          onClick={() => onPlayingChange(!isPlaying)}
          className="rounded p-2 text-neutral-300 hover:bg-neutral-800"
        >
          {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </button>

        {/* Scrub bar */}
        <input
          type="range"
          min={0}
          max={totalDuration || 1}
          step={0.01}
          value={currentTimeValue}
          onChange={(e) => handleSeek(Number(e.target.value))}
          className="h-1 flex-1 cursor-pointer appearance-none rounded-full bg-neutral-700 accent-orange-500"
        />

        <span className="text-xs tabular-nums text-neutral-500">
          {formatTime(currentTimeValue)} / {formatTime(totalDuration)}
        </span>

        {onFullscreenChange && (
          <button
            type="button"
            onClick={() => onFullscreenChange(!fullscreen)}
            className="rounded p-2 text-neutral-300 hover:bg-neutral-800"
          >
            {fullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </button>
        )}
      </div>
    </div>
  );
}
