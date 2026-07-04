import { createMovie, updateMovie } from "./local-storage";
import type { Movie } from "./types";
import type { VaultDraftMovie } from "./vault-movie-drafts";

export async function createMoviesFromVaultDrafts(drafts: VaultDraftMovie[]): Promise<Movie[]> {
  const created: Movie[] = [];
  for (const draft of drafts) {
    const movie = await createMovie(draft.name);
    const saved = await updateMovie({
      ...movie,
      resolution: { w: 1080, h: 1920 },
      clips: draft.clips.map((clip, position) => ({ ...clip, position })),
    });
    created.push(saved);
  }
  return created;
}
