import type { ReviewClip } from "./movie-review-types";
import { secondsToTicks } from "./movie-timebase";

export interface MovieTimelineEntry {
  clipId: string;
  startTick: number;
  endTick: number;
  sourceStartTick: number;
  durationTick: number;
}

export interface ExportPreflightInput {
  committedClips: ReviewClip[];
  candidates: ReviewClip[];
  pendingProposalCount: number;
}

export interface ExportPreflight {
  blockers: string[];
  warnings: string[];
}

export function normalizeClipTrim(clip: ReviewClip): { trimStartSeconds: number; trimEndSeconds: number } {
  const duration = clip.durationSeconds || clip.trimEndSeconds || 0;
  const rawStart = clip.trimStartSeconds || 0;
  const rawEnd = clip.trimEndSeconds ?? duration;
  const sortedStart = Math.min(rawStart, rawEnd);
  const sortedEnd = Math.max(rawStart, rawEnd);
  return {
    trimStartSeconds: Math.max(0, Math.min(sortedStart, duration || sortedStart)),
    trimEndSeconds: Math.max(0, Math.min(sortedEnd, duration || sortedEnd)),
  };
}

export function clipDurationSeconds(clip: ReviewClip): number {
  if (clip.mediaType === "image" || clip.mediaType === "title") return clip.durationSeconds || 3;
  const trim = normalizeClipTrim(clip);
  return Math.max(0, trim.trimEndSeconds - trim.trimStartSeconds);
}

export function clipEffectiveGain(clip: ReviewClip, clips: ReviewClip[], masterVolume = 1, masterMuted = false): number {
  const anySolo = clips.some((item) => item.solo);
  const audibleBySolo = !anySolo || clip.solo;
  if (masterMuted || clip.muted || !audibleBySolo) return 0;
  return clip.volume * masterVolume;
}

export function buildMovieTimeline(clips: ReviewClip[]): MovieTimelineEntry[] {
  let cursor = 0;
  return clips
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((clip) => {
      const trim = normalizeClipTrim(clip);
      const durationTick = secondsToTicks(clipDurationSeconds(clip));
      const entry: MovieTimelineEntry = {
        clipId: clip.id,
        startTick: cursor,
        endTick: cursor + durationTick,
        sourceStartTick: secondsToTicks(trim.trimStartSeconds),
        durationTick,
      };
      cursor += durationTick;
      return entry;
    });
}

export function getExportPreflight(input: ExportPreflightInput): ExportPreflight {
  const blockers: string[] = [];
  const warnings: string[] = [];
  if (input.committedClips.length === 0) blockers.push("No committed clips");
  if (input.candidates.some((clip) => clip.lifecycle !== "rejected")) blockers.push("Unresolved unsafe candidate state");
  if (input.pendingProposalCount > 0) blockers.push("Pending proposal that would change export state");
  for (const clip of input.committedClips) {
    if (!clip.videoUrl && clip.mediaType === "video") blockers.push("Missing media");
    if (clipDurationSeconds(clip) <= 0) blockers.push("Invalid duration");
    if (!clip.flags.includes("has-source-audio") && !clip.flags.includes("muted-in-mix")) blockers.push("Unknown audio intent");
    if (clip.muted) warnings.push("Muted source audio");
  }
  return { blockers: [...new Set(blockers)], warnings: [...new Set(warnings)] };
}
