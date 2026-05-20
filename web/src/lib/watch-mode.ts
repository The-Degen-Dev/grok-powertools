import type { Movie, MovieClip, VideoItem } from "./types";
import { createMovie, updateMovie } from "./local-storage";

export type WatchQueueKind = "compilation" | "selection";

export interface CreateMovieFromWatchQueueInput {
  queue: VideoItem[];
  collectionName: string;
  kind: WatchQueueKind;
  sourceCollectionId?: string;
}

export function getPlayableQueue(items: VideoItem[]): VideoItem[] {
  return items.filter((item) => Boolean(item.videoUrl));
}

export function getSelectedPlayableQueue(
  items: VideoItem[],
  selectedIds: Set<string>
): VideoItem[] {
  return items.filter((item) => selectedIds.has(item.id) && Boolean(item.videoUrl));
}

export function getWatchMovieName(
  collectionName: string,
  kind: WatchQueueKind
): string {
  const baseName = collectionName.trim() || "Untitled Collection";
  return `${baseName} ${kind === "selection" ? "Selection" : "Compilation"}`;
}

export function buildMovieClipsFromQueue(
  queue: VideoItem[],
  sourceCollectionId?: string,
  createId: () => string = () => crypto.randomUUID()
): MovieClip[] {
  return queue.map((item, index) => ({
    id: createId(),
    type: "video",
    videoUrl: item.videoUrl,
    ...(sourceCollectionId ? { sourceCollectionId } : {}),
    transition: index === 0
      ? { type: "cut", duration: 0 }
      : { type: "crossfade", duration: 0.5 },
    position: index,
  }));
}

export async function createMovieFromWatchQueue({
  queue,
  collectionName,
  kind,
  sourceCollectionId,
}: CreateMovieFromWatchQueueInput): Promise<Movie> {
  if (queue.length === 0) {
    throw new Error("Cannot create a movie from an empty watch queue.");
  }

  const movie = await createMovie(getWatchMovieName(collectionName, kind));
  const updated: Movie = {
    ...movie,
    clips: buildMovieClipsFromQueue(queue, sourceCollectionId),
  };

  return updateMovie(updated);
}
