"use client";

import { useState, useRef } from "react";
import {
  Play,
  Pause,
  Maximize2,
  Download,
  Trash2,
  GripVertical,
  Copy,
  Scissors,
  FilmIcon,
  Volume2,
  VolumeX,
  BookmarkPlus,
} from "lucide-react";
import type { VideoItem } from "@/lib/types";
import Spinner from "@/components/ui/Spinner";

interface VideoCardProps {
  item: VideoItem;
  aspectRatio?: string;
  fitMode?: "cover" | "contain";
  onDelete?: (id: string) => void;
  onExpand?: (item: VideoItem) => void;
  onEdit?: (item: VideoItem) => void;
  onAddToMovie?: (item: VideoItem) => void;
  onSavePrompt?: (item: VideoItem) => void;
  dragHandleProps?: Record<string, unknown>;
  isMultiSelectMode?: boolean;
  isSelected?: boolean;
  onSelect?: (id: string) => void;
}

export default function VideoCard({
  item,
  aspectRatio = "9:16",
  fitMode = "cover",
  onDelete,
  onExpand,
  onEdit,
  onAddToMovie,
  onSavePrompt,
  dragHandleProps,
  isMultiSelectMode = false,
  isSelected = false,
  onSelect,
}: VideoCardProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [loadVideo, setLoadVideo] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const videoRef = useRef<HTMLVideoElement>(null);

  const [w, h] = aspectRatio.split(":").map(Number);
  const paddingPercent = (h / w) * 100;

  function handleTogglePlay(e: React.MouseEvent) {
    e.stopPropagation();
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
    setIsHovered(true);
    if (!loadVideo) setLoadVideo(true);
    if (videoRef.current && !isPlaying) {
      videoRef.current.play().catch(() => {});
    }
  }

  function handleMouseLeave() {
    setIsHovered(false);
    if (videoRef.current && !isPlaying) {
      videoRef.current.pause();
      videoRef.current.currentTime = 0;
    }
  }

  function handleDownload(e: React.MouseEvent) {
    e.stopPropagation();
    if (item.videoUrl) {
      const a = document.createElement("a");
      a.href = item.videoUrl;
      a.download = `${item.grokPostId}.mp4`;
      a.click();
    }
  }

  function handleToggleMute(e: React.MouseEvent) {
    e.stopPropagation();
    const next = !isMuted;
    setIsMuted(next);
    if (videoRef.current) videoRef.current.muted = next;
  }

  function handleCopyPrompt(e: React.MouseEvent) {
    e.stopPropagation();
    if (item.promptText) {
      navigator.clipboard.writeText(item.promptText);
    }
  }

  function handleCardClick() {
    if (isMultiSelectMode && onSelect) {
      onSelect(item.id);
    }
  }

  return (
    <div
      className={`group relative w-full overflow-hidden rounded-(--radius-card) bg-(--color-surface-0) shadow-(--shadow-card) transition-all duration-(--duration-normal) hover:shadow-(--shadow-card-hover) hover:scale-[1.02] dark:bg-(--color-surface-900) ${isMultiSelectMode ? "cursor-pointer" : ""} ${isSelected ? "ring-2 ring-(--color-accent) ring-offset-2 dark:ring-offset-(--color-surface-950)" : ""}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onClick={handleCardClick}
    >
      {/* Multi-select checkbox */}
      {isMultiSelectMode && (
        <div className="absolute right-2 top-2 z-30">
          <div
            className={`flex h-5 w-5 items-center justify-center rounded-full border-2 transition-colors ${
              isSelected
                ? "border-(--color-accent) bg-(--color-accent) text-white"
                : "border-white/70 bg-black/30"
            }`}
          >
            {isSelected && (
              <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none">
                <path d="M2.5 6L5 8.5L9.5 3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </div>
        </div>
      )}

      {/* Drag handle — visible on hover */}
      <div
        className="absolute left-1/2 top-1 z-20 -translate-x-1/2 cursor-grab opacity-0 transition-opacity group-hover:opacity-100"
        {...dragHandleProps}
      >
        <div className="rounded-full bg-black/40 px-3 py-0.5 backdrop-blur-sm">
          <GripVertical className="h-3.5 w-3.5 text-white/80" />
        </div>
      </div>

      {/* Video container */}
      <div
        className="relative overflow-hidden bg-(--color-surface-950)"
        style={{ paddingBottom: `${paddingPercent}%` }}
      >
        {item.mediaType === "image" && (item.imageUrl || item.thumbnailUrl) ? (
          // eslint-disable-next-line @next/next/no-img-element -- Vault images are served through local API proxy.
          <img
            src={item.imageUrl || item.thumbnailUrl}
            alt={item.promptText || "Grok Imagine"}
            className={`absolute inset-0 h-full w-full ${fitMode === "contain" ? "object-contain" : "object-cover"}`}
          />
        ) : item.videoUrl ? (
          <>
            {loadVideo && (
              <video
                ref={videoRef}
                src={item.videoUrl}
                className={`absolute inset-0 h-full w-full ${fitMode === "contain" ? "object-contain" : "object-cover"}`}
                loop
                muted={isMuted}
                playsInline
                preload="auto"
                poster={item.thumbnailUrl || undefined}
                onLoadedData={() => setHasLoaded(true)}
              />
            )}
            {!hasLoaded && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4">
                {loadVideo ? (
                  <Spinner className="h-6 w-6" />
                ) : (
                  <Play className="h-10 w-10 text-white/40" />
                )}
                {item.promptText && (
                  <p className="line-clamp-4 text-center text-xs leading-relaxed text-white/50">
                    {item.promptText}
                  </p>
                )}
              </div>
            )}
          </>
        ) : item.thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- Thumbnails may come from arbitrary Grok/export URLs.
          <img
            src={item.thumbnailUrl}
            alt={item.promptText || "Grok Imagine"}
            className={`absolute inset-0 h-full w-full ${fitMode === "contain" ? "object-contain" : "object-cover"}`}
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <Play className="h-10 w-10 text-white/30" />
          </div>
        )}

        {/* Hover overlay — frosted glass with actions + prompt */}
        <div
          className={`absolute inset-0 flex flex-col justify-between transition-opacity duration-(--duration-fast) ${
            isHovered ? "opacity-100" : "opacity-0 pointer-events-none"
          }`}
        >
          {/* Top actions */}
          <div className="flex items-start justify-between p-2">
            <div className="flex gap-1">
              <OverlayButton
                icon={isPlaying ? Pause : Play}
                label={isPlaying ? "Pause" : "Play"}
                onClick={handleTogglePlay}
              />
              <OverlayButton
                icon={isMuted ? VolumeX : Volume2}
                label={isMuted ? "Unmute" : "Mute"}
                onClick={handleToggleMute}
              />
              <OverlayButton
                icon={Maximize2}
                label="Fullscreen"
                onClick={(e) => { e.stopPropagation(); onExpand?.(item); }}
              />
            </div>
            <div className="flex gap-1">
              {item.videoUrl && onEdit && (
                <OverlayButton
                  icon={Scissors}
                  label="Edit clip"
                  onClick={(e) => { e.stopPropagation(); onEdit(item); }}
                />
              )}
              {item.videoUrl && onAddToMovie && (
                <OverlayButton
                  icon={FilmIcon}
                  label="Add to Movie"
                  onClick={(e) => { e.stopPropagation(); onAddToMovie(item); }}
                />
              )}
              {item.promptText && onSavePrompt && (
                <OverlayButton
                  icon={BookmarkPlus}
                  label="Save prompt"
                  onClick={(e) => { e.stopPropagation(); onSavePrompt(item); }}
                />
              )}
              <OverlayButton icon={Download} label="Download" onClick={handleDownload} />
              <OverlayButton
                icon={Trash2}
                label="Delete"
                onClick={(e) => { e.stopPropagation(); onDelete?.(item.id); }}
                danger
              />
            </div>
          </div>

          {/* Bottom — prompt text */}
          {item.promptText && (
            <div className="bg-gradient-to-t from-black/70 via-black/30 to-transparent p-3 pt-8">
              <p className="line-clamp-3 text-xs leading-relaxed text-white/90">
                {item.promptText}
              </p>
              <button
                type="button"
                onClick={handleCopyPrompt}
                className="mt-1.5 flex items-center gap-1 text-[10px] text-white/50 hover:text-white/80 transition-colors"
              >
                <Copy className="h-3 w-3" />
                Copy prompt
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function OverlayButton({
  icon: Icon,
  label,
  onClick,
  danger = false,
}: {
  icon: React.ElementType;
  label: string;
  onClick: (e: React.MouseEvent) => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-(--radius-btn) p-1.5 backdrop-blur-sm transition-colors ${
        danger
          ? "bg-black/30 text-white/70 hover:bg-red-600/80 hover:text-white"
          : "bg-black/30 text-white/70 hover:bg-black/50 hover:text-white"
      }`}
      title={label}
    >
      <Icon className="h-3.5 w-3.5" />
    </button>
  );
}
