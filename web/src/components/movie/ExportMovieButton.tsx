"use client";

import { useState, useRef, useCallback } from "react";
import { Download, Square, CheckCircle } from "lucide-react";
import Button from "@/components/ui/Button";

interface ExportMovieButtonProps {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  totalDuration: number;
  onStartPlayback: () => void;
  onStopPlayback: () => void;
  movieName: string;
}

export default function ExportMovieButton({
  canvasRef,
  totalDuration,
  onStartPlayback,
  onStopPlayback,
  movieName,
}: ExportMovieButtonProps) {
  const [state, setState] = useState<"idle" | "recording" | "done">("idle");
  const [progress, setProgress] = useState(0);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const progressIntervalRef = useRef<ReturnType<typeof setInterval>>(undefined);

  const stopRecording = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.stop();
    }
    onStopPlayback();
    clearInterval(progressIntervalRef.current);
  }, [onStopPlayback]);

  const startRecording = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || totalDuration <= 0) return;

    // Clean up previous export
    if (blobUrl) {
      URL.revokeObjectURL(blobUrl);
      setBlobUrl(null);
    }

    chunksRef.current = [];
    setState("recording");
    setProgress(0);

    const stream = canvas.captureStream(30); // 30fps
    const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
      ? "video/webm;codecs=vp9"
      : "video/webm";
    const recorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: 5_000_000,
    });
    recorderRef.current = recorder;

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };

    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: mimeType });
      const url = URL.createObjectURL(blob);
      setBlobUrl(url);
      setState("done");
      clearInterval(progressIntervalRef.current);
      setProgress(100);
    };

    recorder.start(100); // collect data every 100ms

    // Track progress based on elapsed time
    const startTime = Date.now();
    progressIntervalRef.current = setInterval(() => {
      const elapsed = (Date.now() - startTime) / 1000;
      const pct = Math.min(99, (elapsed / totalDuration) * 100);
      setProgress(pct);

      if (elapsed >= totalDuration + 0.5) {
        // Auto-stop after duration + buffer
        stopRecording();
      }
    }, 200);

    // Start movie playback from beginning
    onStartPlayback();
  }, [canvasRef, totalDuration, onStartPlayback, blobUrl, stopRecording]);

  const handleDownload = useCallback(() => {
    if (!blobUrl) return;
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = `${movieName.replace(/[^a-zA-Z0-9-_ ]/g, "")}.webm`;
    a.click();
  }, [blobUrl, movieName]);

  if (state === "recording") {
    return (
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-2 rounded-(--radius-btn) bg-red-600/20 px-3 py-1.5">
          <div className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
          <span className="text-xs font-medium text-red-400">
            Recording {Math.round(progress)}%
          </span>
        </div>
        <div className="h-1 w-24 overflow-hidden rounded-full bg-(--color-surface-800)">
          <div
            className="h-full rounded-full bg-red-500 transition-all duration-200"
            style={{ width: `${progress}%` }}
          />
        </div>
        <Button variant="ghost" onClick={stopRecording}>
          <Square className="h-3.5 w-3.5" />
          Stop
        </Button>
      </div>
    );
  }

  if (state === "done" && blobUrl) {
    return (
      <div className="flex items-center gap-2">
        <CheckCircle className="h-4 w-4 text-green-500" />
        <span className="text-xs text-green-400">Export ready</span>
        <Button variant="primary" onClick={handleDownload}>
          <Download className="h-3.5 w-3.5" />
          Download WebM
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            setState("idle");
            if (blobUrl) URL.revokeObjectURL(blobUrl);
            setBlobUrl(null);
          }}
        >
          Dismiss
        </Button>
      </div>
    );
  }

  return (
    <Button
      variant="secondary"
      onClick={startRecording}
      disabled={totalDuration <= 0}
    >
      <Download className="h-3.5 w-3.5" />
      Export WebM
    </Button>
  );
}
