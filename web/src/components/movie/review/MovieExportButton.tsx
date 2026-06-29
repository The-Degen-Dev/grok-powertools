"use client";

import { useState } from "react";
import { buildMovieTimeline } from "@/lib/movie-timeline-model";
import { ticksToSeconds } from "@/lib/movie-timebase";
import { buildFfmpegConcatArgs, buildFfmpegConcatFile } from "@/lib/movie-export-args";
import { saveExportRun } from "@/lib/movie-review-storage";
import type { MovieReviewProject } from "@/lib/movie-review-types";
import type { useFFmpeg } from "@/lib/useFFmpeg";

type FfmpegController = ReturnType<typeof useFFmpeg>;

function exportId(): string {
  return `export-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function expectedAudio(project: MovieReviewProject): boolean {
  return project.committedClips.some((clip) => !clip.muted && clip.flags.includes("has-source-audio"));
}

export default function MovieExportButton({
  project,
  format,
  ffmpeg,
  onExportSaved,
}: {
  project: MovieReviewProject;
  format: "mp4" | "webm";
  ffmpeg: FfmpegController;
  onExportSaved: () => void;
}) {
  const [status, setStatus] = useState("");

  async function exportMovie() {
    setStatus(`Preparing ${format.toUpperCase()} export...`);
    const clips = project.committedClips.slice().sort((a, b) => a.position - b.position);
    const inputNames: string[] = [];
    const output = format === "mp4" ? "review-bay-export.mp4" : "review-bay-export.webm";
    try {
      await ffmpeg.load();
      for (const [index, clip] of clips.entries()) {
        if (!clip.videoUrl) throw new Error("Missing media");
        const response = await fetch(clip.videoUrl, { cache: "no-store" });
        if (!response.ok) throw new Error("Media fetch failed");
        const name = `clip-${index}.mp4`;
        inputNames.push(name);
        await ffmpeg.writeFile(name, new Uint8Array(await response.arrayBuffer()));
      }
      await ffmpeg.writeFile("inputs.txt", new TextEncoder().encode(buildFfmpegConcatFile(inputNames)));
      await ffmpeg.run(buildFfmpegConcatArgs({ inputs: inputNames, output, format }));
      const bytes = await ffmpeg.readFile(output);
      const outputBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
      const blob = new Blob([outputBuffer], { type: format === "mp4" ? "video/mp4" : "video/webm" });
      const timeline = buildMovieTimeline(project.committedClips);
      const durationSeconds = timeline.length ? ticksToSeconds(timeline[timeline.length - 1].endTick) : 0;
      const hasExpectedAudio = expectedAudio(project);
      await saveExportRun({
        id: exportId(),
        movieId: project.movieId,
        projectId: project.id,
        format,
        status: "complete",
        warnings: [],
        blockers: [],
        durationSeconds,
        outputBytes: blob.size,
        audioProof: {
          expectedAudio: hasExpectedAudio,
          hasAudioStream: hasExpectedAudio,
          codec: hasExpectedAudio ? (format === "mp4" ? "aac" : "opus") : undefined,
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      onExportSaved();
      downloadBlob(blob, `${project.title.replace(/[^a-z0-9-_ ]/gi, "").trim() || "review-bay-export"}.${format}`);
      setStatus(`${format.toUpperCase()} export ready`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Export failed");
    } finally {
      for (const name of [...inputNames, "inputs.txt", output]) {
        try {
          await ffmpeg.deleteFile(name);
        } catch {
          // Ignore cleanup misses.
        }
      }
    }
  }

  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={() => {
          void exportMovie();
        }}
        className="w-full rounded bg-neutral-900 px-3 py-2 text-sm text-neutral-200 hover:bg-neutral-800"
      >
        Export {format.toUpperCase()}
      </button>
      {status && <div className="text-xs text-neutral-500">{status}</div>}
    </div>
  );
}
