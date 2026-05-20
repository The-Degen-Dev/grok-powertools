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
  Film,
} from "lucide-react";
import type { VideoItem } from "@/lib/types";

type PlaybackMode = "manual" | "natural" | "skim";

const SKIM_INTERVALS = [5, 10, 15];

interface FullscreenViewerProps {
  items: VideoItem[];
  startIndex: number;
  onClose: () => void;
  sourceName?: string;
  watchMode?: boolean;
  onSaveAsMovie?: (queue: VideoItem[]) => Promise<void>;
}

export default function FullscreenViewer({
  items,
  startIndex,
  onClose,
  sourceName,
  watchMode = false,
  onSaveAsMovie,
}: FullscreenViewerProps) {
  const [currentIndex, setCurrentIndex] = useState(startIndex);
  const [isPlaying, setIsPlaying] = useState(true);
  const [playbackMode, setPlaybackMode] = useState<PlaybackMode>(
    watchMode ? "natural" : "manual"
  );
  const [skimInterval, setSkimInterval] = useState(10);
  const [slideshowActive, setSlideshowActive] = useState(false);
  const [slideshowInterval, setSlideshowInterval] = useState(5);
  const [loopVideo, setLoopVideo] = useState(!watchMode);
  const [showInfo, setShowInfo] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [videoError, setVideoError] = useState(false);
  const [isSavingMovie, setIsSavingMovie] = useState(false);
  const [saveMovieError, setSaveMovieError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const slideshowTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const skimTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const currentItem = items[currentIndex];
  const previousDisabled = watchMode && currentIndex <= 0;
  const nextDisabled = watchMode && currentIndex >= items.length - 1;

  const goTo = useCallback(
    (index: number) => {
      if (items.length === 0) return;

      const nextIndex = watchMode
        ? Math.max(0, Math.min(index, items.length - 1))
        : ((index % items.length) + items.length) % items.length;

      if (watchMode && nextIndex === currentIndex) return;

      setCurrentIndex(nextIndex);
      setIsPlaying(true);
      setVideoError(false);
    },
    [currentIndex, items.length, watchMode]
  );

  const goNext = useCallback(() => goTo(currentIndex + 1), [currentIndex, goTo]);
  const goPrev = useCallback(() => goTo(currentIndex - 1), [currentIndex, goTo]);

  // Auto-play video when index changes
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !isPlaying) return;

    let cancelled = false;
    video.load();

    video
      .play()
      .then(() => {
        if (cancelled) return;
        setIsPlaying(true);
        setVideoError(false);
      })
      .catch(() => {
        if (cancelled) return;
        setIsPlaying(false);
        setVideoError(true);
      });

    return () => {
      cancelled = true;
    };
  }, [currentIndex, isPlaying]);

  useEffect(() => {
    if (watchMode || !slideshowActive) return;

    clearTimeout(slideshowTimerRef.current);
    slideshowTimerRef.current = setTimeout(goNext, slideshowInterval * 1000);

    return () => clearTimeout(slideshowTimerRef.current);
  }, [watchMode, slideshowActive, slideshowInterval, currentIndex, goNext]);

  useEffect(() => {
    if (!watchMode || playbackMode !== "skim" || !isPlaying) return;

    clearTimeout(skimTimerRef.current);
    skimTimerRef.current = setTimeout(goNext, skimInterval * 1000);

    return () => clearTimeout(skimTimerRef.current);
  }, [watchMode, playbackMode, skimInterval, currentIndex, isPlaying, goNext]);

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
          if (watchMode) {
            setPlaybackMode((mode) => (mode === "skim" ? "natural" : "skim"));
          } else {
            setSlideshowActive((v) => !v);
          }
          break;
        case "l":
          if (!watchMode) {
            setLoopVideo((v) => !v);
          }
          break;
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [goNext, goPrev, onClose, watchMode]);

  function togglePlay() {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      video
        .play()
        .then(() => {
          setIsPlaying(true);
          setVideoError(false);
        })
        .catch(() => {
          setIsPlaying(false);
          setVideoError(true);
        });
    } else {
      video.pause();
      setIsPlaying(false);
    }
  }

  function handleCopyPrompt() {
    if (currentItem?.promptText) {
      navigator.clipboard.writeText(currentItem.promptText);
    }
  }

  function handleDownload() {
    if (currentItem?.videoUrl) {
      const a = document.createElement("a");
      a.href = currentItem.videoUrl;
      a.download = `${currentItem.grokPostId}.mp4`;
      a.click();
    }
  }

  function handleVideoEnded() {
    if (!watchMode) return;

    if (playbackMode === "natural" && currentIndex < items.length - 1) {
      goNext();
      return;
    }

    setIsPlaying(false);
  }

  async function handleSaveAsMovie() {
    if (!onSaveAsMovie || items.length === 0) return;
    setIsSavingMovie(true);
    setSaveMovieError(null);
    try {
      await onSaveAsMovie(items);
    } catch (error) {
      const message =
        error instanceof Error && error.message ? error.message : "Please try again.";
      setSaveMovieError(message);
    } finally {
      setIsSavingMovie(false);
    }
  }

  if (!currentItem) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black"
      data-testid="fullscreen-viewer"
    >
      {/* Video */}
      <video
        ref={videoRef}
        src={currentItem.videoUrl}
        className="h-full w-full object-contain"
        loop={!watchMode && loopVideo}
        muted={false}
        playsInline
        autoPlay
        onClick={togglePlay}
        onEnded={handleVideoEnded}
        onError={() => {
          setVideoError(true);
          setIsPlaying(false);
        }}
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
            {watchMode && (
              <span className="rounded-full bg-orange-500/20 px-2 py-0.5 text-xs font-medium text-orange-400">
                Watch Mode
              </span>
            )}
            {sourceName && (
              <span className="max-w-[40vw] truncate text-xs text-white/60">
                {sourceName}
              </span>
            )}
            {videoError && (
              <span className="rounded-full bg-red-500/20 px-2 py-0.5 text-xs font-medium text-red-300">
                Video failed to load
              </span>
            )}
            {saveMovieError && (
              <span className="rounded-full bg-red-500/20 px-2 py-0.5 text-xs font-medium text-red-300">
                Save as Movie failed
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
              disabled={previousDisabled}
              aria-label="Previous"
              className="absolute left-4 top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-3 text-white/80 backdrop-blur-sm transition hover:bg-white/20 hover:text-white disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-white/10 disabled:hover:text-white/80"
            >
              <ChevronLeft className="h-6 w-6" />
            </button>
            <button
              type="button"
              onClick={goNext}
              disabled={nextDisabled}
              aria-label="Next"
              className="absolute right-4 top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-3 text-white/80 backdrop-blur-sm transition hover:bg-white/20 hover:text-white disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-white/10 disabled:hover:text-white/80"
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

          {saveMovieError && (
            <div className="mb-3 rounded-lg bg-red-500/15 px-3 py-2 text-sm text-red-200 backdrop-blur-sm">
              Save as Movie failed. {saveMovieError}
            </div>
          )}

          {/* Control buttons */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-1">
              <ControlButton
                icon={isPlaying ? Pause : Play}
                label={isPlaying ? "Pause (Space)" : "Play (Space)"}
                onClick={togglePlay}
              />
              {watchMode ? (
                <>
                  <button
                    type="button"
                    onClick={() => setPlaybackMode("natural")}
                    className={`whitespace-nowrap rounded-lg px-3 py-2 text-sm transition ${
                      playbackMode === "natural"
                        ? "bg-orange-500/20 text-orange-400"
                        : "bg-white/10 text-white/70 hover:bg-white/20 hover:text-white"
                    }`}
                  >
                    Natural
                  </button>
                  <button
                    type="button"
                    onClick={() => setPlaybackMode("skim")}
                    className={`whitespace-nowrap rounded-lg px-3 py-2 text-sm transition ${
                      playbackMode === "skim"
                        ? "bg-orange-500/20 text-orange-400"
                        : "bg-white/10 text-white/70 hover:bg-white/20 hover:text-white"
                    }`}
                  >
                    Skim
                  </button>
                  {playbackMode === "skim" && (
                    <select
                      value={skimInterval}
                      onChange={(e) => setSkimInterval(Number(e.target.value))}
                      className="ml-2 rounded bg-white/10 px-2 py-1.5 text-sm text-white/80 backdrop-blur-sm"
                      aria-label="Skim interval"
                    >
                      {SKIM_INTERVALS.map((seconds) => (
                        <option key={seconds} value={seconds}>
                          {seconds}s
                        </option>
                      ))}
                    </select>
                  )}
                </>
              ) : (
                <>
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
                      aria-label="Slideshow interval"
                    >
                      <option value={3}>3s</option>
                      <option value={5}>5s</option>
                      <option value={8}>8s</option>
                      <option value={10}>10s</option>
                      <option value={15}>15s</option>
                    </select>
                  )}
                </>
              )}
            </div>
            <div className="flex flex-wrap items-center justify-end gap-1">
              {watchMode && onSaveAsMovie && (
                <button
                  type="button"
                  onClick={handleSaveAsMovie}
                  disabled={isSavingMovie || items.length === 0}
                  className="inline-flex items-center gap-2 whitespace-nowrap rounded-lg bg-white/10 px-3 py-2 text-sm text-white/80 transition hover:bg-white/20 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Film className="h-4 w-4" />
                  {isSavingMovie ? "Saving..." : "Save as Movie"}
                </button>
              )}
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
            Arrow keys: navigate &middot; Space: play/pause &middot; {watchMode ? "S: skim/natural" : "S: slideshow"} &middot; {!watchMode && <>L: loop &middot; </>}I: info &middot; Esc: close
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
