"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { ExternalLink, Play, Pause } from "lucide-react";
import Link from "next/link";
import SlideOver from "@/components/ui/SlideOver";
import Timeline from "./Timeline";
import Button from "@/components/ui/Button";

interface SlideOverEditorProps {
  open: boolean;
  onClose: () => void;
  videoUrl: string;
}

export default function SlideOverEditor({
  open,
  onClose,
  videoUrl,
}: SlideOverEditorProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  // Reset state when video changes
  useEffect(() => {
    setDuration(0);
    setCurrentTime(0);
    setTrimStart(0);
    setTrimEnd(0);
    setIsPlaying(false);
  }, [videoUrl]);

  const handleLoadedMetadata = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    setDuration(v.duration);
    setTrimEnd(v.duration);
  }, []);

  const handleTimeUpdate = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    setCurrentTime(v.currentTime);
    // Clamp playback to trim range
    if (v.currentTime >= trimEnd) {
      v.pause();
      v.currentTime = trimStart;
      setIsPlaying(false);
    }
  }, [trimStart, trimEnd]);

  const handleSeek = useCallback((t: number) => {
    const v = videoRef.current;
    if (v) v.currentTime = t;
  }, []);

  function togglePlay() {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      if (v.currentTime < trimStart || v.currentTime >= trimEnd) {
        v.currentTime = trimStart;
      }
      v.play().catch(() => {});
      setIsPlaying(true);
    } else {
      v.pause();
      setIsPlaying(false);
    }
  }

  return (
    <SlideOver open={open} onClose={onClose} title="Quick Trim" width="max-w-lg">
      <div className="flex flex-col gap-4">
        {/* Video preview */}
        <div className="relative overflow-hidden rounded-(--radius-card) bg-black">
          <video
            ref={videoRef}
            src={videoUrl}
            className="w-full"
            playsInline
            muted
            loop={false}
            onLoadedMetadata={handleLoadedMetadata}
            onTimeUpdate={handleTimeUpdate}
            onClick={togglePlay}
          />
          {/* Play/Pause overlay */}
          <button
            type="button"
            onClick={togglePlay}
            className="absolute bottom-3 left-3 rounded-full bg-black/50 p-2 text-white/80 backdrop-blur-sm transition-colors hover:bg-black/70"
          >
            {isPlaying ? (
              <Pause className="h-4 w-4" />
            ) : (
              <Play className="h-4 w-4" />
            )}
          </button>
        </div>

        {/* Trim timeline */}
        <div className="rounded-(--radius-card) border border-(--color-surface-200) bg-(--color-surface-50) dark:border-(--color-surface-800) dark:bg-(--color-surface-900)">
          <Timeline
            duration={duration}
            trimStart={trimStart}
            trimEnd={trimEnd}
            currentTime={currentTime}
            onTrimStartChange={setTrimStart}
            onTrimEndChange={setTrimEnd}
            onSeek={handleSeek}
          />
        </div>

        {/* Trim info */}
        {duration > 0 && (
          <p className="text-xs text-(--color-surface-500)">
            Trim: {formatTime(trimStart)} &ndash; {formatTime(trimEnd)} ({formatTime(trimEnd - trimStart)})
          </p>
        )}

        {/* Open in full editor */}
        <div className="pt-2">
          <Link href={`/edit?video=${encodeURIComponent(videoUrl)}&trimStart=${trimStart}&trimEnd=${trimEnd}`}>
            <Button variant="primary" className="w-full">
              <ExternalLink className="h-4 w-4" />
              Open in Full Editor
            </Button>
          </Link>
          <p className="mt-2 text-center text-xs text-(--color-surface-400)">
            Full editor supports crop, export to MP4/GIF
          </p>
        </div>
      </div>
    </SlideOver>
  );
}

function formatTime(s: number): string {
  const mins = Math.floor(s / 60);
  const secs = s % 60;
  return `${mins}:${secs.toFixed(1).padStart(4, "0")}`;
}
