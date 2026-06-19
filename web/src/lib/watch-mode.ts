import type { Movie, MovieClip, VideoItem } from "./types";
import { createMovie, updateMovie } from "./local-storage";

export type WatchQueueKind = "compilation" | "selection";

function isWatchable(item: VideoItem): boolean {
  if (item.mediaType === "image") return Boolean(item.imageUrl || item.thumbnailUrl);
  return Boolean(item.videoUrl);
}

export function getWatchableQueue(items: VideoItem[]): VideoItem[] {
  return items.filter(isWatchable);
}

export function getSelectedWatchableQueue(items: VideoItem[], selectedIds: Set<string>): VideoItem[] {
  return items.filter((item) => selectedIds.has(item.id) && isWatchable(item));
}

export function buildMovieClipsFromQueue(queue: VideoItem[]): MovieClip[] {
  return getWatchableQueue(queue).map((item, index) => {
    const isImage = item.mediaType === "image";
    return {
      id: crypto.randomUUID(),
      type: isImage ? "image" : "video",
      videoUrl: isImage ? undefined : item.videoUrl,
      imageUrl: isImage ? item.imageUrl || item.thumbnailUrl : undefined,
      sourceAssetId: item.assetId,
      stillDuration: isImage ? 3 : undefined,
      transition: index === 0 ? { type: "cut", duration: 0 } : { type: "crossfade", duration: 0.5 },
      position: index,
    };
  });
}

export async function createMovieFromWatchQueue(queue: VideoItem[], name: string): Promise<Movie> {
  const movie = await createMovie(name);
  return updateMovie({ ...movie, clips: buildMovieClipsFromQueue(queue) });
}
