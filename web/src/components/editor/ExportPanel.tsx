"use client";

import { Download, Loader2, AlertCircle } from "lucide-react";

interface ExportPanelProps {
  format: "mp4" | "gif";
  onFormatChange: (f: "mp4" | "gif") => void;
  ffmpegLoaded: boolean;
  ffmpegLoading: boolean;
  ffmpegError: string | null;
  onLoadFFmpeg: () => void;
  exporting: boolean;
  exportProgress: number;
  exportedBlobUrl: string | null;
  exportError: string | null;
  onExport: () => void;
  disabled: boolean;
}

export default function ExportPanel({
  format,
  onFormatChange,
  ffmpegLoaded,
  ffmpegLoading,
  ffmpegError,
  onLoadFFmpeg,
  exporting,
  exportProgress,
  exportedBlobUrl,
  exportError,
  onExport,
  disabled,
}: ExportPanelProps) {
  function handleDownload() {
    if (!exportedBlobUrl) return;
    const a = document.createElement("a");
    a.href = exportedBlobUrl;
    a.download = `clip.${format}`;
    a.click();
  }

  const activeError = exportError || ffmpegError;

  return (
    <div className="flex flex-wrap items-center gap-3">
      {/* Format toggle */}
      <div className="flex rounded bg-neutral-800">
        {(["mp4", "gif"] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => onFormatChange(f)}
            className={`rounded px-3 py-1 text-xs font-medium uppercase transition ${
              format === f
                ? "bg-orange-500/20 text-orange-400"
                : "text-neutral-400 hover:text-neutral-200"
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {/* Load FFmpeg / Export / Download */}
      {!ffmpegLoaded ? (
        <button
          type="button"
          onClick={onLoadFFmpeg}
          disabled={ffmpegLoading || disabled}
          className="flex items-center gap-1.5 rounded bg-neutral-700 px-3 py-1.5 text-xs font-medium text-neutral-200 transition hover:bg-neutral-600 disabled:opacity-40"
        >
          {ffmpegLoading ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Loading FFmpeg...
            </>
          ) : ffmpegError ? (
            "Retry Load FFmpeg"
          ) : (
            "Load FFmpeg (~25MB)"
          )}
        </button>
      ) : exporting ? (
        <div className="flex items-center gap-2">
          <div className="h-1.5 w-32 overflow-hidden rounded-full bg-neutral-700">
            <div
              className="h-full rounded-full bg-orange-500 transition-all"
              style={{ width: `${Math.round(exportProgress * 100)}%` }}
            />
          </div>
          <span className="text-xs text-neutral-400">
            {Math.round(exportProgress * 100)}%
          </span>
        </div>
      ) : exportedBlobUrl ? (
        <button
          type="button"
          onClick={handleDownload}
          className="flex items-center gap-1.5 rounded bg-orange-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-orange-500"
        >
          <Download className="h-3.5 w-3.5" />
          Download .{format}
        </button>
      ) : (
        <button
          type="button"
          onClick={onExport}
          disabled={disabled}
          className="flex items-center gap-1.5 rounded bg-orange-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-orange-500 disabled:opacity-40"
        >
          Export {format.toUpperCase()}
        </button>
      )}

      {/* Re-export after download */}
      {exportedBlobUrl && !exporting && (
        <button
          type="button"
          onClick={onExport}
          disabled={disabled}
          className="text-xs text-neutral-400 underline hover:text-neutral-200"
        >
          Re-export
        </button>
      )}

      {/* Error display */}
      {activeError && (
        <span className="flex items-center gap-1 text-xs text-red-400">
          <AlertCircle className="h-3 w-3" />
          {activeError}
        </span>
      )}
    </div>
  );
}
