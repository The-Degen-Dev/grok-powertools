"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { ArrowLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import type { Movie, MovieClip } from "@/lib/types";
import { getMovie, updateMovie } from "@/lib/local-storage";
import StoryboardPanel from "./StoryboardPanel";
import CanvasPlayer from "./CanvasPlayer";
import MovieTimeline from "./MovieTimeline";
import ExportMovieButton from "./ExportMovieButton";

interface MovieMakerProps {
  movieId: string;
}

export default function MovieMaker({ movieId }: MovieMakerProps) {
  const router = useRouter();
  const [movie, setMovie] = useState<Movie | null>(null);
  const [activeClipIndex, setActiveClipIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [totalDuration, setTotalDuration] = useState(0);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    getMovie(movieId).then((m) => {
      if (m) setMovie(m);
      else router.push("/movie");
    });
  }, [movieId, router]);

  // Auto-save on changes (debounced 500ms)
  const save = useCallback(
    (updated: Movie) => {
      setMovie(updated);
      clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = setTimeout(() => {
        updateMovie(updated);
      }, 500);
    },
    []
  );

  const handleClipsChange = useCallback(
    (clips: MovieClip[]) => {
      if (!movie) return;
      save({ ...movie, clips: clips.map((c, i) => ({ ...c, position: i })) });
    },
    [movie, save]
  );

  // Keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Don't intercept when typing in inputs
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;

      switch (e.code) {
        case "Space":
          e.preventDefault();
          setIsPlaying((p) => !p);
          break;
        case "Escape":
          if (isFullscreen) setIsFullscreen(false);
          break;
        case "ArrowLeft":
          e.preventDefault();
          setActiveClipIndex((i) => Math.max(0, i - 1));
          break;
        case "ArrowRight":
          e.preventDefault();
          if (movie) {
            setActiveClipIndex((i) => Math.min(movie.clips.length - 1, i + 1));
          }
          break;
        case "Delete":
        case "Backspace":
          if (movie && movie.clips.length > 0) {
            e.preventDefault();
            const next = movie.clips.filter((_, i) => i !== activeClipIndex);
            handleClipsChange(next);
            setActiveClipIndex((i) => Math.max(0, Math.min(i, next.length - 1)));
          }
          break;
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isFullscreen, movie, activeClipIndex, handleClipsChange]);

  if (!movie) {
    return (
      <div className="flex h-[calc(100vh-3.5rem)] items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-neutral-600 border-t-orange-500" />
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col bg-neutral-950">
      {/* Header bar */}
      {!isFullscreen && (
        <div className="flex items-center gap-3 border-b border-neutral-800 px-4 py-2">
          <button
            type="button"
            onClick={() => router.push("/movie")}
            className="rounded p-1 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <h2 className="text-sm font-medium text-neutral-200">{movie.name}</h2>
          <span className="text-xs text-neutral-500">
            {movie.clips.length} clip{movie.clips.length !== 1 ? "s" : ""}
          </span>
          <div className="ml-auto">
            <ExportMovieButton
              canvasRef={canvasRef}
              totalDuration={totalDuration}
              onStartPlayback={() => {
                setCurrentTime(0);
                setIsPlaying(true);
              }}
              onStopPlayback={() => setIsPlaying(false)}
              movieName={movie.name}
            />
          </div>
        </div>
      )}

      {/* Main panels */}
      <div className="flex flex-1 min-h-0">
        {/* Storyboard — left (hidden in fullscreen) */}
        {!isFullscreen && (
          <div className="w-80 flex-shrink-0 overflow-y-auto border-r border-neutral-800">
            <StoryboardPanel
              clips={movie.clips}
              onClipsChange={handleClipsChange}
              activeIndex={activeClipIndex}
              onActiveIndexChange={setActiveClipIndex}
            />
          </div>
        )}

        {/* Preview — right */}
        <div className="flex flex-1 flex-col min-h-0">
          <CanvasPlayer
            clips={movie.clips}
            resolution={movie.resolution}
            isPlaying={isPlaying}
            onPlayingChange={setIsPlaying}
            fullscreen={isFullscreen}
            onFullscreenChange={setIsFullscreen}
            currentTime={currentTime}
            onTimeUpdate={setCurrentTime}
            onCanvasRef={(el) => { canvasRef.current = el; }}
            onTotalDurationChange={setTotalDuration}
          />
        </div>
      </div>

      {/* Timeline strip */}
      {!isFullscreen && (
        <MovieTimeline
          clips={movie.clips}
          totalDuration={totalDuration}
          currentTime={currentTime}
          onSeek={setCurrentTime}
        />
      )}
    </div>
  );
}
