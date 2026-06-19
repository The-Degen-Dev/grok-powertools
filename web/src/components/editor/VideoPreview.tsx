"use client";

import { useRef, useState, useEffect, useImperativeHandle, forwardRef } from "react";
import type { CropRect, CropPreset } from "@/lib/ffmpeg-commands";
import CropOverlay from "./CropOverlay";

export interface VideoPreviewHandle {
  seek: (time: number) => void;
  play: () => void;
  pause: () => void;
  togglePlay: () => void;
  isPaused: () => boolean;
}

interface VideoPreviewProps {
  blobUrl: string | null;
  crop: CropRect;
  cropPreset: CropPreset;
  videoWidth: number;
  videoHeight: number;
  onLoadedMetadata: (meta: { duration: number; width: number; height: number }) => void;
  onTimeUpdate: (time: number) => void;
  onCropChange: (crop: CropRect) => void;
}

const VideoPreview = forwardRef<VideoPreviewHandle, VideoPreviewProps>(
  function VideoPreview(
    { blobUrl, crop, cropPreset, videoWidth, videoHeight, onLoadedMetadata, onTimeUpdate, onCropChange },
    ref
  ) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    // Track container size reactively with ResizeObserver
    const [containerSize, setContainerSize] = useState({ w: 0, h: 0 });

    useEffect(() => {
      const el = containerRef.current;
      if (!el) return;
      const observer = new ResizeObserver((entries) => {
        const entry = entries[0];
        if (entry) {
          setContainerSize({ w: entry.contentRect.width, h: entry.contentRect.height });
        }
      });
      observer.observe(el);
      return () => observer.disconnect();
    }, []);

    useImperativeHandle(ref, () => ({
      seek: (t: number) => {
        if (videoRef.current) videoRef.current.currentTime = t;
      },
      play: () => {
        videoRef.current?.play().catch(() => {});
      },
      pause: () => {
        videoRef.current?.pause();
      },
      togglePlay: () => {
        const v = videoRef.current;
        if (!v) return;
        if (v.paused) {
          v.play().catch(() => {});
        } else {
          v.pause();
        }
      },
      isPaused: () => videoRef.current?.paused ?? true,
    }));

    useEffect(() => {
      const v = videoRef.current;
      if (!v) return;
      const handler = () => onTimeUpdate(v.currentTime);
      v.addEventListener("timeupdate", handler);
      return () => v.removeEventListener("timeupdate", handler);
    }, [onTimeUpdate]);

    if (!blobUrl) {
      return (
        <div className="flex h-full items-center justify-center bg-neutral-950 text-neutral-500">
          No video loaded
        </div>
      );
    }

    // Compute the video's display rect within the object-contain container
    const displayRect = computeDisplayRect(videoWidth, videoHeight, containerSize.w, containerSize.h);

    return (
      <div ref={containerRef} className="relative flex h-full items-center justify-center overflow-hidden bg-black">
        <video
          ref={videoRef}
          src={blobUrl}
          className="h-full w-full object-contain"
          loop
          playsInline
          onLoadedMetadata={() => {
            const v = videoRef.current;
            if (v) {
              onLoadedMetadata({
                duration: v.duration,
                width: v.videoWidth,
                height: v.videoHeight,
              });
            }
          }}
          onClick={() => {
            const v = videoRef.current;
            if (!v) return;
            if (v.paused) {
              v.play().catch(() => {});
            } else {
              v.pause();
            }
          }}
        />

        {/* Interactive crop overlay */}
        {videoWidth > 0 && containerSize.w > 0 && (
          <CropOverlay
            crop={crop}
            cropPreset={cropPreset}
            videoWidth={videoWidth}
            videoHeight={videoHeight}
            displayRect={displayRect}
            onCropChange={onCropChange}
          />
        )}
      </div>
    );
  }
);

export default VideoPreview;

/** Compute the display rect of a video using object-contain within a container */
function computeDisplayRect(
  videoWidth: number,
  videoHeight: number,
  containerWidth: number,
  containerHeight: number
): { x: number; y: number; w: number; h: number } {
  if (videoWidth <= 0 || videoHeight <= 0 || containerWidth <= 0 || containerHeight <= 0) {
    return { x: 0, y: 0, w: 0, h: 0 };
  }

  const videoRatio = videoWidth / videoHeight;
  const containerRatio = containerWidth / containerHeight;

  let w: number, h: number;
  if (videoRatio > containerRatio) {
    w = containerWidth;
    h = containerWidth / videoRatio;
  } else {
    h = containerHeight;
    w = containerHeight * videoRatio;
  }

  return {
    x: (containerWidth - w) / 2,
    y: (containerHeight - h) / 2,
    w,
    h,
  };
}
