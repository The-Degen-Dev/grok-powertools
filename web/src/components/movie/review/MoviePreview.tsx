"use client";

import { useEffect, useRef } from "react";
import type { ReviewClip } from "@/lib/movie-review-types";

function clipLabel(clip: ReviewClip): string {
  return clip.sourceAssetId || (clip.mediaRef.type === "vault" ? clip.mediaRef.assetId : clip.titleText || clip.id);
}

export default function MoviePreview({
  clip,
  videos,
}: {
  clip: ReviewClip | undefined;
  videos: Map<string, HTMLVideoElement>;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    host.replaceChildren();
    if (!clip) return;
    const video = videos.get(clip.id);
    if (video) {
      host.appendChild(video);
    }
    return () => {
      if (video?.parentElement === host) {
        host.removeChild(video);
      }
    };
  }, [clip, videos]);

  const hasVideo = clip?.mediaType === "video" && videos.has(clip.id);
  const placeholder = !clip
    ? "Keep a clip to preview the cut."
    : clip.mediaType !== "video"
      ? clipLabel(clip)
      : hasVideo
        ? ""
        : "Preparing preview...";

  return (
    <section role="region" aria-label="Clip preview" className="flex min-h-0 flex-col rounded border border-neutral-800 bg-neutral-950 p-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium text-neutral-100">Clip preview</h2>
        <span className="truncate text-xs text-neutral-500">{clip ? clipLabel(clip) : "No committed clip"}</span>
      </div>
      <div className="relative min-h-64 flex-1 rounded bg-black">
        <div ref={hostRef} className="absolute inset-0 flex items-center justify-center" />
        {placeholder && <div className="absolute inset-0 flex items-center justify-center text-sm text-neutral-500">{placeholder}</div>}
      </div>
    </section>
  );
}
