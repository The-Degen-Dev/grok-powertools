"use client";

import { useState, useRef } from "react";
import {
  Play,
  Pause,
  Maximize2,
  Info,
  ExternalLink,
  Download,
  Trash2,
  GripVertical,
  Copy,
  X,
} from "lucide-react";
import type { VideoItem } from "@/lib/types";

interface VideoCardProps {
  item: VideoItem;
  aspectRatio?: string;
  size?: "small" | "medium" | "large";
  fitMode?: "cover" | "contain";
  showNotes?: boolean;
  onDelete?: (id: string) => void;
  onExpand?: (item: VideoItem) => void;
  dragHandleProps?: Record<string, unknown>;
}

const SIZE_CLASSES = {
  small: "w-48",
  medium: "w-64",
  large: "w-80",
};

export default function VideoCard({
  item,
  aspectRatio = "2:3",
  size = "medium",
  fitMode = "cover",
  showNotes = false,
  onDelete,
  onExpand,
  dragHandleProps,
}: VideoCardProps) {
  const [showInfo, setShowInfo] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [loadVideo, setLoadVideo] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  const [w, h] = aspectRatio.split(":").map(Number);
  const paddingPercent = (h / w) * 100;

  function handleTogglePlay() {
    if (!loadVideo) setLoadVideo(true);
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.pause();
        setIsPlaying(false);
      } else {
        videoRef.current.play().catch(() => {});
        setIsPlaying(true);
      }
    }
  }

  function handleMouseEnter() {
    // Trigger video load on first hover
    if (!loadVideo) setLoadVideo(true);
    if (videoRef.current && !isPlaying) {
      videoRef.current.play().catch(() => {});
    }
  }

  function handleMouseLeave() {
    if (videoRef.current && !isPlaying) {
      videoRef.current.pause();
      videoRef.current.currentTime = 0;
    }
  }

  function handleDownload() {
    if (item.videoUrl) {
      const a = document.createElement("a");
      a.href = item.videoUrl;
      a.download = `${item.grokPostId}.mp4`;
      a.click();
    }
  }

  function handleCopyPrompt() {
    if (item.promptText) {
      navigator.clipboard.writeText(item.promptText);
    }
  }

  return (
    <div className={`group relative flex-shrink-0 ${SIZE_CLASSES[size]}`}>
      {/* Drag handle + delete bar */}
      <div className="flex items-center justify-between rounded-t-lg border border-b-0 border-neutral-200 bg-neutral-50 px-2 py-1 dark:border-neutral-700 dark:bg-neutral-900">
        <div
          className="cursor-grab text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300"
          {...dragHandleProps}
        >
          <GripVertical className="h-4 w-4" />
        </div>
        <button
          type="button"
          onClick={() => onDelete?.(item.id)}
          className="rounded p-0.5 text-neutral-400 transition hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Video container */}
      <div
        className="relative overflow-hidden border border-neutral-200 bg-black dark:border-neutral-700"
        style={{ paddingBottom: `${paddingPercent}%` }}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        {item.videoUrl ? (
          <>
            {loadVideo && (
              <video
                ref={videoRef}
                src={item.videoUrl}
                className={`absolute inset-0 h-full w-full ${fitMode === "contain" ? "object-contain" : "object-cover"}`}
                loop
                muted
                playsInline
                preload="auto"
                poster={item.thumbnailUrl || undefined}
                onLoadedData={() => setHasLoaded(true)}
              />
            )}
            {!hasLoaded && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-3">
                {loadVideo ? (
                  <div className="h-6 w-6 animate-spin rounded-full border-2 border-neutral-600 border-t-orange-500" />
                ) : (
                  <Play className="h-8 w-8 text-neutral-500" />
                )}
                {item.promptText && (
                  <p className="line-clamp-3 text-center text-xs leading-relaxed text-neutral-500">
                    {item.promptText}
                  </p>
                )}
              </div>
            )}
          </>

        ) : item.thumbnailUrl ? (
          <img
            src={item.thumbnailUrl}
            alt={item.promptText || "Grok Imagine"}
            className={`absolute inset-0 h-full w-full ${fitMode === "contain" ? "object-contain" : "object-cover"}`}
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-neutral-500">
            No preview
          </div>
        )}

        {/* Info overlay */}
        {showInfo && item.promptText && (
          <div className="absolute inset-0 flex flex-col justify-start bg-black/80 p-3">
            <div className="flex items-start justify-between">
              <p className="flex-1 text-xs leading-relaxed text-white/90">
                {item.promptText}
              </p>
              <div className="ml-2 flex flex-col gap-1">
                <button
                  type="button"
                  onClick={() => setShowInfo(false)}
                  className="rounded p-1 text-white/70 hover:bg-white/10 hover:text-white"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={handleCopyPrompt}
                  className="rounded p-1 text-white/70 hover:bg-white/10 hover:text-white"
                  title="Copy prompt"
                >
                  <Copy className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Action bar */}
      <div className="flex items-center justify-between rounded-b-lg border border-t-0 border-neutral-200 bg-white px-2 py-1.5 dark:border-neutral-700 dark:bg-neutral-900">
        <div className="flex gap-0.5">
          <ActionButton
            icon={isPlaying ? Pause : Play}
            label={isPlaying ? "Pause" : "Play"}
            onClick={handleTogglePlay}
          />
          <ActionButton
            icon={Maximize2}
            label="Fullscreen"
            onClick={() => onExpand?.(item)}
          />
          <ActionButton
            icon={Info}
            label="Prompt info"
            onClick={() => setShowInfo(!showInfo)}
            active={showInfo}
          />
          <ActionButton
            icon={ExternalLink}
            label="Open on Grok"
            onClick={() => window.open(item.sourceUrl, "_blank")}
          />
          <ActionButton
            icon={Download}
            label="Download"
            onClick={handleDownload}
          />
        </div>
      </div>

      {/* Notes */}
      {showNotes && item.notes && (
        <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
          {item.notes}
        </p>
      )}
    </div>
  );
}

function ActionButton({
  icon: Icon,
  label,
  onClick,
  active = false,
}: {
  icon: React.ElementType;
  label: string;
  onClick: () => void;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded p-1.5 transition ${
        active
          ? "bg-orange-50 text-orange-600 dark:bg-orange-950 dark:text-orange-400"
          : "text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800 dark:hover:text-neutral-300"
      }`}
      title={label}
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}
