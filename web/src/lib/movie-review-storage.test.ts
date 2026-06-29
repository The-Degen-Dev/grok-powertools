import "fake-indexeddb/auto";

import { beforeEach, describe, expect, it } from "vitest";
import { createMovie, getDB } from "./local-storage";
import {
  createReviewProjectFromMovie,
  createMovieVersionFromProject,
  getReviewProject,
  listExportRuns,
  listMovieVersions,
  listMovieVersionsForProject,
  saveDirectorProposal,
  saveExportRun,
  saveMovieVersion,
  updateReviewProject,
} from "./movie-review-storage";
import type { DirectorProposal, MovieExportRun, MovieVersion } from "./movie-review-types";

async function clearStores() {
  const db = await getDB();
  const stores = [
    "collections",
    "movies",
    "prompts",
    "settings",
    "sync_meta",
    "vault_assets",
    "vault_overlays",
    "vault_import_runs",
    "vault_gaps",
    "vault_prompts",
    "vault_media_tokens",
    "movie_review_projects",
    "movie_versions",
    "movie_director_proposals",
    "movie_export_runs",
    "movie_review_notes",
  ].filter((name) => db.objectStoreNames.contains(name));
  if (stores.length === 0) return;
  const tx = db.transaction(stores, "readwrite");
  stores.forEach((name) => tx.objectStore(name).clear());
  await tx.done;
}

describe("movie review storage", () => {
  beforeEach(async () => {
    await clearStores();
  });

  it("creates Review Bay stores while preserving legacy movies", async () => {
    const movie = await createMovie("Legacy movie");
    const db = await getDB();
    expect(db.objectStoreNames.contains("movies")).toBe(true);
    expect(db.objectStoreNames.contains("movie_review_projects")).toBe(true);
    expect(db.objectStoreNames.contains("movie_versions")).toBe(true);
    expect(db.objectStoreNames.contains("movie_director_proposals")).toBe(true);
    expect(db.objectStoreNames.contains("movie_export_runs")).toBe(true);
    expect(db.objectStoreNames.contains("movie_review_notes")).toBe(true);

    const project = await createReviewProjectFromMovie(movie.id);
    expect(project.movieId).toBe(movie.id);
    expect(project.mode).toBe("review");
    expect(project.candidates).toEqual([]);
    expect(project.committedClips).toEqual([]);
  });

  it("hydrates a legacy movie into candidates without storing object key query strings", async () => {
    const movie = await createMovie("Vault draft");
    const db = await getDB();
    await db.put("movies", {
      ...movie,
      clips: [
        {
          id: "clip-a",
          type: "video",
          videoUrl: "/api/vault/media/asset-video-1?objectKey=grok-powertools%2Fv1%2Fmedia%2Fa.mp4",
          sourceAssetId: "asset-video-1",
          transition: { type: "cut", duration: 0 },
          position: 0,
        },
        {
          id: "clip-b",
          type: "image",
          imageUrl: "/api/vault/media/asset-image-1?objectKey=grok-powertools%2Fv1%2Fmedia%2Fb.png",
          sourceAssetId: "asset-image-1",
          transition: { type: "cut", duration: 0 },
          position: 1,
          stillDuration: 4,
        },
      ],
    });

    const project = await createReviewProjectFromMovie(movie.id);
    expect(project.candidates).toHaveLength(2);
    expect(project.candidates[0].sourceAssetId).toBe("asset-video-1");
    expect(project.candidates[0].mediaRef).toEqual({ type: "vault", assetId: "asset-video-1" });
    expect(project.candidates[0].videoUrl).toBe("/api/vault/media/asset-video-1");
    expect(project.candidates[1].sourceAssetId).toBe("asset-image-1");
    expect(project.candidates[1].mediaRef).toEqual({ type: "vault", assetId: "asset-image-1" });
    expect(project.candidates[1].imageUrl).toBe("/api/vault/media/asset-image-1");
    expect(JSON.stringify(project)).not.toContain("objectKey=");
  });

  it("persists versions, proposals, and export runs independently", async () => {
    const movie = await createMovie("Project movie");
    const project = await createReviewProjectFromMovie(movie.id);
    await updateReviewProject({
      ...project,
      selectedTarget: { type: "candidate", clipId: "clip-a" },
    });

    const version: MovieVersion = {
      id: "version-a",
      movieId: movie.id,
      projectId: project.id,
      name: "Version A",
      description: "First version",
      clips: [],
      createdAt: "2026-06-28T00:00:00.000Z",
      updatedAt: "2026-06-28T00:00:00.000Z",
    };
    await saveMovieVersion(version);

    const proposal: DirectorProposal = {
      id: "proposal-a",
      movieId: movie.id,
      projectId: project.id,
      status: "pending",
      title: "Tighter ending",
      rationale: "Move strongest clip last.",
      changes: [],
      createdAt: "2026-06-28T00:00:00.000Z",
      updatedAt: "2026-06-28T00:00:00.000Z",
    };
    await saveDirectorProposal(proposal);

    const run: MovieExportRun = {
      id: "export-a",
      movieId: movie.id,
      projectId: project.id,
      format: "mp4",
      status: "complete",
      warnings: [],
      blockers: [],
      durationSeconds: 1.5,
      outputBytes: 1000,
      audioProof: { expectedAudio: true, hasAudioStream: true, codec: "aac" },
      createdAt: "2026-06-28T00:00:00.000Z",
      updatedAt: "2026-06-28T00:00:00.000Z",
    };
    await saveExportRun(run);

    expect(await getReviewProject(project.id)).toMatchObject({
      selectedTarget: { type: "candidate", clipId: "clip-a" },
    });
    expect(await listMovieVersions(movie.id)).toEqual([version]);
    expect(await listExportRuns(project.id)).toEqual([run]);
  });

  it("lists versions for only the active review project", async () => {
    const movie = await createMovie("Project scoped versions");
    const project = await createReviewProjectFromMovie(movie.id);
    const timestamp = "2026-06-28T00:00:00.000Z";
    const currentVersion: MovieVersion = {
      id: "version-current",
      movieId: movie.id,
      projectId: project.id,
      name: "Current",
      description: "Belongs to active project",
      clips: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const staleVersion: MovieVersion = {
      ...currentVersion,
      id: "version-stale",
      projectId: "project-stale",
      name: "Stale",
      description: "Belongs to another project",
    };
    await saveMovieVersion(staleVersion);
    await saveMovieVersion(currentVersion);

    expect((await listMovieVersions(movie.id)).map((version) => version.id).sort()).toEqual(["version-current", "version-stale"]);
    expect(await listMovieVersionsForProject(project.id)).toEqual([currentVersion]);
  });

  it("creates a movie version snapshot from the current project", async () => {
    const movie = await createMovie("Snapshot versions");
    const project = await createReviewProjectFromMovie(movie.id);
    const version = await createMovieVersionFromProject(
      {
        ...project,
        committedClips: [
          {
            id: "clip-a",
            sourceAssetId: "asset-video-1",
            mediaType: "video",
            mediaRef: { type: "vault", assetId: "asset-video-1" },
            videoUrl: "/api/vault/media/asset-video-1",
            position: 0,
            lifecycle: "kept",
            flags: [],
            trimStartSeconds: 0,
            trimEndSeconds: 2,
            durationSeconds: 2,
            volume: 1,
            muted: false,
            solo: false,
            notes: "",
            createdAt: "2026-06-28T00:00:00.000Z",
            updatedAt: "2026-06-28T00:00:00.000Z",
          },
        ],
      },
      "Snapshot",
      "Before Director changes",
    );

    expect(version).toMatchObject({ movieId: movie.id, projectId: project.id, name: "Snapshot" });
    expect((await listMovieVersionsForProject(project.id))[0]).toMatchObject({ id: version.id, clips: [{ id: "clip-a" }] });
  });
});
