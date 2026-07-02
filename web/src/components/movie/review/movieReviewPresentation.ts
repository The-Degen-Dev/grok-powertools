import type { ReviewClip } from "@/lib/movie-review-types";

export function clipDisplayTitle(clip: ReviewClip, index = clip.position): string {
  const title = clip.titleText?.trim();
  if (title) return title;
  const prompt = clip.promptText?.trim().replace(/\s+/g, " ");
  if (prompt) return prompt;
  if (clip.mediaType === "title") return `Title ${index + 1}`;
  if (clip.mediaType === "image") return `Image ${index + 1}`;
  return `Clip ${index + 1}`;
}

export function clipDurationLabel(clip: ReviewClip): string | undefined {
  const seconds = clip.trimEndSeconds ?? clip.durationSeconds;
  if (!seconds || !Number.isFinite(seconds)) return undefined;
  const total = Math.max(0, Math.round(seconds - clip.trimStartSeconds));
  const minutes = Math.floor(total / 60);
  const remaining = total % 60;
  return `${minutes}:${remaining.toString().padStart(2, "0")}`;
}

export function clipMetaLabel(clip: ReviewClip, index = 0): string {
  const parts = [`${clip.mediaType[0].toUpperCase()}${clip.mediaType.slice(1)} ${index + 1}`];
  if (clip.flags.includes("has-source-audio")) parts.push("source audio");
  if (clip.flags.includes("trimmed")) parts.push("trimmed");
  if (clip.muted) parts.push("muted");
  return parts.join(" · ");
}

export function clipMediaUrl(clip: ReviewClip): string | undefined {
  if (clip.mediaType === "image") return clip.imageUrl;
  if (clip.mediaType === "video") return clip.videoUrl;
  return undefined;
}
