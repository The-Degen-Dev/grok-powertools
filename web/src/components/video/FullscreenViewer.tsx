"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import {
  X,
  ChevronLeft,
  ChevronRight,
  Play,
  Pause,
  SkipForward,
  Repeat,
  Copy,
  Download,
  ExternalLink,
  Info,
} from "lucide-react";
import type { VideoItem } from "@/lib/types";

interface FullscreenViewerProps {
  items: VideoItem[];
  startIndex: number;
  onClose: () => void;
}

export default function FullscreenViewer({
  items,
  startIndex,
  onClose,
}: FullscreenViewerProps) {
  const [currentIndex, setCurrentIndex] = useState(startIndex);
  const [isPlaying, setIsPlaying] = useState(true);
  const [slideshowActive, setSlideshowActive] = useState(false);
  const [slideshowInterval, setSlideshowInterval] = useState(5); // seconds
  const [loopVideo, setLoopVideo] = useState(true);
  const [showInfo, setShowInfo] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const slideshowTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const currentItem = items[currentIndex];
  if (!currentItem) return null;

  const goTo = useCallback(
    (index: number) => {
      const wrapped = ((index % items.length) + items.length) % items.length;
      setCurrentIndex(wrapped);
      setIsPlaying(true);
    },
    [items.length]
  );

  const goNext = useCallback(() => goTo(currentIndex + 1), [currentIndex, goTo]);
  const goPrev = useCallback(() => goTo(currentIndex - 1), [currentIndex, goTo]);

  // Auto-play video when index changes
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.load();
    if (isPlaying) {
      video.play().catch(() => {});
    }
  }, [currentIndex, isPlaying]);

  // Slideshow timer
  useEffect(() => {
    if (!slideshowActive) return;
    slideshowTimerRef.current = setTimeout(goNext, slideshowInterval * 1000);
    return () => clearTimeout(slideshowTimerRef.current);
  }, [slideshowActive, slideshowInterval, currentIndex, goNext]);

  // Auto-hide controls
  useEffect(() => {
    function resetTimer() {
      setShowControls(true);
      clearTimeout(controlsTimerRef.current);
      controlsTimerRef.current = setTimeout(() => setShowControls(false), 3000);
    }

    function handleMouseMove() {
      resetTimer();
    }

    resetTimer();
    window.addEventListener("mousemove", handleMouseMove);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      clearTimeout(controlsTimerRef.current);
    };
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      switch (e.key) {
        case "Escape":
          onClose();
          break;
        case "ArrowRight":
          goNext();
          break;
        case "ArrowLeft":
          goPrev();
          break;
        case " ":
          e.preventDefault();
          togglePlay();
          break;
        case "i":
          setShowInfo((v) => !v);
          break;
        case "s":
          setSlideshowActive((v) => !v);
          break;
        case "l":
          setLoopVideo((v) => !v);
          break;
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [goNext, goPrev, onClose]);

  function togglePlay() {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      video.play().catch(() => {});
      setIsPlaying(true);
    } else {
      video.pause();
      setIsPlaying(false);
    }
  }

  function handleCopyPrompt() {
    if (currentItem.promptText) {
      navigator.clipboard.writeText(currentItem.promptText);
    }
  }

  function handleDownload() {
    if (currentItem.videoUrl) {
      const a = document.createElement("a");
      a.href = currentItem.videoUrl;
      a.download = `${currentItem.grokPostId}.mp4`;
      a.click();
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black">
      {/* Video */}
      <video
        ref={videoRef}
        src={currentItem.videoUrl}
        className="h-full w-full object-contain"
        loop={loopVideo}
        muted={false}
        playsInline
        autoPlay
        onClick={togglePlay}
      />

      {/* Controls overlay */}
      <div
        className={`absolute inset-0 transition-opacity duration-300 ${
          showControls ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
      >
        {/* Top bar */}
        <div className="absolute top-0 left-0 right-0 flex items-center justify-between bg-gradient-to-b from-black/70 to-transparent px-6 py-4">
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-white/90">
              {currentIndex + 1} / {items.length}
            </span>
            {slideshowActive && (
              <span className="rounded-full bg-orange-500/20 px-2 py-0.5 text-xs font-medium text-orange-400">
                Slideshow
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full bg-white/10 p-2 text-white/80 backdrop-blur-sm transition hover:bg-white/20 hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Left/Right navigation */}
        {items.length > 1 && (
          <>
            <button
              type="button"
              onClick={goPrev}
              className="absolute left-4 top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-3 text-white/80 backdrop-blur-sm transition hover:bg-white/20 hover:text-white"
            >
              <ChevronLeft className="h-6 w-6" />
            </button>
            <button
              type="button"
              onClick={goNext}
              className="absolute right-4 top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-3 text-white/80 backdrop-blur-sm transition hover:bg-white/20 hover:text-white"
            >
              <ChevronRight className="h-6 w-6" />
            </button>
          </>
        )}

        {/* Bottom bar */}
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent px-6 py-4">
          {/* Prompt info */}
          {showInfo && currentItem.promptText && (
            <div className="mb-4 flex items-start gap-2 rounded-lg bg-black/60 p-3 backdrop-blur-sm">
              <p className="flex-1 text-sm leading-relaxed text-white/90">
                {currentItem.promptText}
              </p>
              <button
                type="button"
                onClick={handleCopyPrompt}
                className="flex-shrink-0 rounded p-1 text-white/60 hover:text-white"
                title="Copy prompt"
              >
                <Copy className="h-4 w-4" />
              </button>
            </div>
          )}

          {/* Control buttons */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1">
              <ControlButton
                icon={isPlaying ? Pause : Play}
                label={isPlaying ? "Pause (Space)" : "Play (Space)"}
                onClick={togglePlay}
              />
              <ControlButton
                icon={SkipForward}
                label={`Slideshow ${slideshowActive ? "ON" : "OFF"} (S)`}
                onClick={() => setSlideshowActive((v) => !v)}
                active={slideshowActive}
              />
              <ControlButton
                icon={Repeat}
                label={`Loop ${loopVideo ? "ON" : "OFF"} (L)`}
                onClick={() => setLoopVideo((v) => !v)}
                active={loopVideo}
              />
              {slideshowActive && (
                <select
                  value={slideshowInterval}
                  onChange={(e) => setSlideshowInterval(Number(e.target.value))}
                  className="ml-2 rounded bg-white/10 px-2 py-1.5 text-sm text-white/80 backdrop-blur-sm"
                >
                  <option value={3}>3s</option>
                  <option value={5}>5s</option>
                  <option value={8}>8s</option>
                  <option value={10}>10s</option>
                  <option value={15}>15s</option>
                </select>
              )}
            </div>
            <div className="flex items-center gap-1">
              <ControlButton
                icon={Info}
                label="Prompt info (I)"
                onClick={() => setShowInfo((v) => !v)}
                active={showInfo}
              />
              <ControlButton
                icon={ExternalLink}
                label="Open on Grok"
                onClick={() => window.open(currentItem.sourceUrl, "_blank")}
              />
              <ControlButton
                icon={Download}
                label="Download"
                onClick={handleDownload}
              />
            </div>
          </div>

          {/* Keyboard hint */}
          <div className="mt-2 text-center text-xs text-white/30">
            Arrow keys: navigate &middot; Space: play/pause &middot; S: slideshow &middot; I: info &middot; Esc: close
          </div>
        </div>
      </div>
    </div>
  );
}

function ControlButton({
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
      className={`rounded-lg p-2 transition ${
        active
          ? "bg-orange-500/20 text-orange-400"
          : "bg-white/10 text-white/70 hover:bg-white/20 hover:text-white"
      }`}
      title={label}
    >
      <Icon className="h-5 w-5" />
    </button>
  );
}
