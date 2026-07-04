"use client";

import { useEffect, useRef, useState } from "react";
import type { ReviewClip } from "@/lib/movie-review-types";

export function detectSourceAudio(video: HTMLVideoElement): boolean | "unknown" {
  const maybeMoz = video as HTMLVideoElement & { mozHasAudio?: boolean };
  const maybeWebkit = video as HTMLVideoElement & { webkitAudioDecodedByteCount?: number };
  const maybeAudioTracks = video as HTMLVideoElement & { audioTracks?: { length: number } };
  if (typeof maybeMoz.mozHasAudio === "boolean") return maybeMoz.mozHasAudio;
  if (typeof maybeWebkit.webkitAudioDecodedByteCount === "number" && maybeWebkit.webkitAudioDecodedByteCount > 0) return true;
  if (maybeAudioTracks.audioTracks && maybeAudioTracks.audioTracks.length > 0) return true;
  return "unknown";
}

export function useMovieMediaEngine(clips: ReviewClip[]) {
  const [videos] = useState(() => new Map<string, HTMLVideoElement>());
  const frameCallbacksRef = useRef(new Map<string, number>());

  useEffect(() => {
    const existing = videos;
    const frameCallbacks = frameCallbacksRef.current;
    for (const clip of clips) {
      if (clip.mediaType !== "video" || !clip.videoUrl || existing.has(clip.id)) continue;
      const video = document.createElement("video");
      video.src = clip.videoUrl;
      video.preload = "metadata";
      video.crossOrigin = "anonymous";
      video.playsInline = true;
      video.controls = true;
      video.className = "h-full w-full rounded bg-black object-contain";
      existing.set(clip.id, video);
    }
    for (const [clipId, video] of existing) {
      if (!clips.some((clip) => clip.id === clipId)) {
        video.pause();
        video.removeAttribute("src");
        video.load();
        existing.delete(clipId);
      }
    }
    return () => {
      for (const [clipId, handle] of frameCallbacks) {
        const video = existing.get(clipId);
        video?.cancelVideoFrameCallback?.(handle);
      }
      for (const video of existing.values()) {
        video.pause();
        video.removeAttribute("src");
        video.load();
      }
      existing.clear();
      frameCallbacks.clear();
    };
  }, [clips, videos]);

  return { videos, detectSourceAudio };
}
