"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { Link2, Loader2 } from "lucide-react";
import VideoPreview, { type VideoPreviewHandle } from "./VideoPreview";
import Timeline from "./Timeline";
import CropControls from "./CropControls";
import ExportPanel from "./ExportPanel";
import { useFFmpeg } from "@/lib/useFFmpeg";
import { buildExportArgs, type CropPreset, type CropRect } from "@/lib/ffmpeg-commands";

export default function ClipEditor() {
  const searchParams = useSearchParams();
  const videoPreviewRef = useRef<VideoPreviewHandle>(null);

  // Video source
  const [inputUrl, setInputUrl] = useState(searchParams.get("video") ?? "");
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Video metadata
  const [videoDuration, setVideoDuration] = useState(0);
  const [videoWidth, setVideoWidth] = useState(0);
  const [videoHeight, setVideoHeight] = useState(0);

  // Trim
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);

  // Crop
  const [cropPreset, setCropPreset] = useState<CropPreset>("free");
  const [crop, setCrop] = useState<CropRect>({ x: 0, y: 0, w: 0, h: 0 });

  // Export
  const [exportFormat, setExportFormat] = useState<"mp4" | "gif">("mp4");
  const [exporting, setExporting] = useState(false);
  const [exportedBlobUrl, setExportedBlobUrl] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const ffmpeg = useFFmpeg();

  // Auto-fetch video from URL param on mount
  useEffect(() => {
    const url = searchParams.get("video");
    if (url && !blobUrl) {
      fetchVideo(url);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Clean up blob URLs on unmount
  useEffect(() => {
    return () => {
      if (blobUrl) URL.revokeObjectURL(blobUrl);
      if (exportedBlobUrl) URL.revokeObjectURL(exportedBlobUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Don't capture when typing in the URL input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      switch (e.key) {
        case " ":
          e.preventDefault();
          videoPreviewRef.current?.togglePlay();
          break;
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  async function fetchVideo(url: string) {
    setFetching(true);
    setFetchError(null);
    if (blobUrl) URL.revokeObjectURL(blobUrl);
    setBlobUrl(null);

    try {
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const blob = await resp.blob();
      setBlobUrl(URL.createObjectURL(blob));
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : "Failed to fetch video");
    } finally {
      setFetching(false);
    }
  }

  function handleLoadUrl() {
    if (!inputUrl.trim()) return;
    fetchVideo(inputUrl.trim());
  }

  const handleLoadedMetadata = useCallback(
    (meta: { duration: number; width: number; height: number }) => {
      setVideoDuration(meta.duration);
      setVideoWidth(meta.width);
      setVideoHeight(meta.height);
      setTrimStart(0);
      setTrimEnd(meta.duration);
      setCrop({ x: 0, y: 0, w: meta.width, h: meta.height });
      setCropPreset("free");
    },
    []
  );

  const handleTimeUpdate = useCallback((t: number) => setCurrentTime(t), []);

  const handleSeek = useCallback((t: number) => {
    videoPreviewRef.current?.seek(t);
  }, []);

  // Clear exported result when settings change
  useEffect(() => {
    if (exportedBlobUrl) {
      URL.revokeObjectURL(exportedBlobUrl);
      setExportedBlobUrl(null);
    }
    setExportError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trimStart, trimEnd, crop, exportFormat]);

  async function handleExport() {
    if (!blobUrl || exporting) return;
    setExporting(true);
    setExportError(null);
    if (exportedBlobUrl) {
      URL.revokeObjectURL(exportedBlobUrl);
      setExportedBlobUrl(null);
    }

    try {
      if (!ffmpeg.loaded) {
        await ffmpeg.load();
      }

      const resp = await fetch(blobUrl);
      const bytes = new Uint8Array(await resp.arrayBuffer());
      await ffmpeg.writeFile("input.mp4", bytes);

      const hasTrim = trimStart > 0.05 || trimEnd < videoDuration - 0.05;
      const hasCrop = crop.w < videoWidth || crop.h < videoHeight || crop.x > 0 || crop.y > 0;

      const trim = hasTrim ? { start: trimStart, end: trimEnd } : null;
      const cropArg = hasCrop ? crop : null;

      const args = buildExportArgs(trim, cropArg, exportFormat);
      await ffmpeg.run(args);

      const outputName = exportFormat === "gif" ? "output.gif" : "output.mp4";
      const data = await ffmpeg.readFile(outputName);
      const mimeType = exportFormat === "gif" ? "image/gif" : "video/mp4";
      const blob = new Blob([new Uint8Array(data)], { type: mimeType });
      setExportedBlobUrl(URL.createObjectURL(blob));

      await ffmpeg.deleteFile("input.mp4");
      await ffmpeg.deleteFile(outputName);
    } catch (err) {
      console.error("Export failed:", err);
      setExportError(err instanceof Error ? err.message : "Export failed");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col bg-neutral-950">
      {/* URL input bar */}
      <div className="flex items-center gap-2 border-b border-neutral-800 px-4 py-2">
        <Link2 className="h-4 w-4 flex-shrink-0 text-neutral-500" />
        <input
          type="url"
          value={inputUrl}
          onChange={(e) => setInputUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleLoadUrl()}
          placeholder="Paste Grok Imagine video URL..."
          className="flex-1 bg-transparent text-sm text-neutral-200 outline-none placeholder:text-neutral-600"
        />
        <button
          type="button"
          onClick={handleLoadUrl}
          disabled={fetching || !inputUrl.trim()}
          className="flex items-center gap-1 rounded bg-neutral-800 px-3 py-1 text-xs font-medium text-neutral-300 transition hover:bg-neutral-700 disabled:opacity-40"
        >
          {fetching ? <Loader2 className="h-3 w-3 animate-spin" /> : "Load"}
        </button>
        {fetchError && (
          <span className="text-xs text-red-400">{fetchError}</span>
        )}
      </div>

      {/* Video preview */}
      <div className="flex-1 min-h-0">
        <VideoPreview
          ref={videoPreviewRef}
          blobUrl={blobUrl}
          crop={crop}
          cropPreset={cropPreset}
          videoWidth={videoWidth}
          videoHeight={videoHeight}
          onLoadedMetadata={handleLoadedMetadata}
          onTimeUpdate={handleTimeUpdate}
          onCropChange={setCrop}
        />
      </div>

      {/* Timeline */}
      <div className="border-t border-neutral-800">
        <Timeline
          duration={videoDuration}
          trimStart={trimStart}
          trimEnd={trimEnd}
          currentTime={currentTime}
          onTrimStartChange={setTrimStart}
          onTrimEndChange={setTrimEnd}
          onSeek={handleSeek}
        />
      </div>

      {/* Bottom controls bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-neutral-800 px-4 py-2.5">
        <CropControls
          preset={cropPreset}
          crop={crop}
          videoWidth={videoWidth}
          videoHeight={videoHeight}
          onPresetChange={setCropPreset}
          onCropChange={setCrop}
        />
        <ExportPanel
          format={exportFormat}
          onFormatChange={setExportFormat}
          ffmpegLoaded={ffmpeg.loaded}
          ffmpegLoading={ffmpeg.loading}
          ffmpegError={ffmpeg.error}
          onLoadFFmpeg={ffmpeg.load}
          exporting={exporting}
          exportProgress={ffmpeg.progress}
          exportedBlobUrl={exportedBlobUrl}
          exportError={exportError}
          onExport={handleExport}
          disabled={!blobUrl || videoWidth === 0}
        />
      </div>
    </div>
  );
}
