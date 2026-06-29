import { v4 as uuidv4 } from "uuid";
import { getDB, getMovie } from "./local-storage";
import type { MovieClip } from "./types";
import {
  directorProposalSchema,
  movieExportRunSchema,
  movieReviewProjectSchema,
  movieVersionSchema,
  type DirectorProposal,
  type MovieExportRun,
  type MovieReviewProject,
  type MovieVersion,
  type ReviewClip,
} from "./movie-review-types";

function now(): string {
  return new Date().toISOString();
}

function mediaRefFromClip(clip: MovieClip): ReviewClip["mediaRef"] {
  if (clip.type === "title") return { type: "title" };
  if (clip.sourceAssetId) return { type: "vault", assetId: clip.sourceAssetId };
  const url = clip.videoUrl || clip.imageUrl || "";
  return { type: "url", url };
}

function mediaUrlFromClip(clip: MovieClip): string | undefined {
  if (clip.type !== "video") return undefined;
  if (clip.sourceAssetId) return `/api/vault/media/${encodeURIComponent(clip.sourceAssetId)}`;
  return clip.videoUrl;
}

function imageUrlFromClip(clip: MovieClip): string | undefined {
  if (clip.type === "image" && clip.sourceAssetId) return `/api/vault/media/${encodeURIComponent(clip.sourceAssetId)}`;
  return clip.imageUrl;
}

export function reviewClipFromMovieClip(clip: MovieClip, position: number, timestamp = now()): ReviewClip {
  return {
    id: clip.id || uuidv4(),
    movieClipId: clip.id,
    sourceAssetId: clip.sourceAssetId,
    mediaType: clip.type,
    mediaRef: mediaRefFromClip(clip),
    videoUrl: mediaUrlFromClip(clip),
    imageUrl: imageUrlFromClip(clip),
    titleText: clip.titleText,
    position,
    lifecycle: "proposed",
    flags: [],
    trimStartSeconds: clip.trimStart || 0,
    trimEndSeconds: clip.trimEnd,
    durationSeconds: clip.type === "image" ? clip.stillDuration || 3 : clip.type === "title" ? clip.titleDuration || 3 : undefined,
    volume: 1,
    muted: false,
    solo: false,
    notes: "",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export async function createReviewProjectFromMovie(movieId: string): Promise<MovieReviewProject> {
  const db = await getDB();
  const existing = (await db.getAllFromIndex("movie_review_projects", "by-movie", movieId)) as MovieReviewProject[];
  const active = existing.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0];
  if (active) return movieReviewProjectSchema.parse(active);

  const movie = await getMovie(movieId);
  if (!movie) throw new Error(`Movie not found: ${movieId}`);
  const timestamp = now();
  const project: MovieReviewProject = {
    schemaVersion: 1,
    id: uuidv4(),
    movieId: movie.id,
    mode: "review",
    title: movie.name,
    candidates: movie.clips.map((clip, index) => reviewClipFromMovieClip(clip, index, timestamp)),
    committedClips: [],
    activeIndex: 0,
    masterVolume: 1,
    masterMuted: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const parsed = movieReviewProjectSchema.parse(project);
  await db.put("movie_review_projects", parsed);
  return parsed;
}

export async function getReviewProject(projectId: string): Promise<MovieReviewProject | undefined> {
  const db = await getDB();
  const record = await db.get("movie_review_projects", projectId);
  return record ? movieReviewProjectSchema.parse(record) : undefined;
}

export async function updateReviewProject(project: MovieReviewProject): Promise<MovieReviewProject> {
  const db = await getDB();
  const parsed = movieReviewProjectSchema.parse({ ...project, updatedAt: now() });
  await db.put("movie_review_projects", parsed);
  return parsed;
}

export async function saveMovieVersion(version: MovieVersion): Promise<MovieVersion> {
  const db = await getDB();
  const parsed = movieVersionSchema.parse(version);
  await db.put("movie_versions", parsed);
  return parsed;
}

export async function listMovieVersions(movieId: string): Promise<MovieVersion[]> {
  const db = await getDB();
  const rows = (await db.getAllFromIndex("movie_versions", "by-movie", movieId)) as MovieVersion[];
  return rows.map((row) => movieVersionSchema.parse(row)).sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

export async function listMovieVersionsForProject(projectId: string): Promise<MovieVersion[]> {
  const db = await getDB();
  const rows = (await db.getAllFromIndex("movie_versions", "by-project", projectId)) as MovieVersion[];
  return rows.map((row) => movieVersionSchema.parse(row)).sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

export async function saveDirectorProposal(proposal: DirectorProposal): Promise<DirectorProposal> {
  const db = await getDB();
  const parsed = directorProposalSchema.parse(proposal);
  await db.put("movie_director_proposals", parsed);
  return parsed;
}

export async function listDirectorProposals(projectId: string): Promise<DirectorProposal[]> {
  const db = await getDB();
  const rows = (await db.getAllFromIndex("movie_director_proposals", "by-project", projectId)) as DirectorProposal[];
  return rows.map((row) => directorProposalSchema.parse(row)).sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

export async function saveExportRun(run: MovieExportRun): Promise<MovieExportRun> {
  const db = await getDB();
  const parsed = movieExportRunSchema.parse(run);
  await db.put("movie_export_runs", parsed);
  return parsed;
}

export async function listExportRuns(projectId: string): Promise<MovieExportRun[]> {
  const db = await getDB();
  const rows = (await db.getAllFromIndex("movie_export_runs", "by-project", projectId)) as MovieExportRun[];
  return rows.map((row) => movieExportRunSchema.parse(row)).sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}
