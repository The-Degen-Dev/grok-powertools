import { z } from "zod";

export const reviewModeSchema = z.enum(["review", "focus", "assemble"]);
export const clipLifecycleSchema = z.enum(["proposed", "kept", "rejected"]);
export const clipFlagSchema = z.enum(["trimmed", "has-source-audio", "muted-in-mix", "export-safe", "needs-attention"]);

export const mediaRefSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("vault"), assetId: z.string().min(1) }),
  z.object({ type: z.literal("url"), url: z.string().min(1) }),
  z.object({ type: z.literal("title") }),
]);

export const reviewClipSchema = z.object({
  id: z.string().min(1),
  movieClipId: z.string().optional(),
  sourceAssetId: z.string().optional(),
  mediaType: z.enum(["video", "image", "title"]),
  mediaRef: mediaRefSchema,
  videoUrl: z.string().optional(),
  imageUrl: z.string().optional(),
  titleText: z.string().optional(),
  tags: z.array(z.string()).default([]),
  position: z.number().int().nonnegative(),
  lifecycle: clipLifecycleSchema,
  flags: z.array(clipFlagSchema),
  trimStartSeconds: z.number().nonnegative(),
  trimEndSeconds: z.number().positive().optional(),
  durationSeconds: z.number().positive().optional(),
  volume: z.number().min(0).max(2),
  muted: z.boolean(),
  solo: z.boolean(),
  notes: z.string().default(""),
  promptText: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const selectedTargetSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("candidate"), clipId: z.string().min(1) }),
  z.object({ type: z.literal("clip"), clipId: z.string().min(1) }),
  z.object({ type: z.literal("proposal"), proposalId: z.string().min(1) }),
]);

export const movieReviewProjectSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  movieId: z.string().min(1),
  mode: reviewModeSchema,
  title: z.string().min(1),
  candidates: z.array(reviewClipSchema),
  committedClips: z.array(reviewClipSchema),
  selectedTarget: selectedTargetSchema.optional(),
  activeIndex: z.number().int().nonnegative(),
  masterVolume: z.number().min(0).max(2),
  masterMuted: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const directorChangeSchema = z.discriminatedUnion("type", [
  z.object({ id: z.string().min(1).optional(), type: z.literal("keep"), clipId: z.string().min(1), rationale: z.string().optional() }),
  z.object({ id: z.string().min(1).optional(), type: z.literal("reject"), clipId: z.string().min(1), rationale: z.string().optional() }),
  z.object({ id: z.string().min(1).optional(), type: z.literal("reorder"), clipIds: z.array(z.string().min(1)), rationale: z.string().optional() }),
  z.object({
    id: z.string().min(1).optional(),
    type: z.literal("trim"),
    clipId: z.string().min(1),
    trimStartSeconds: z.number().nonnegative(),
    trimEndSeconds: z.number().positive(),
    rationale: z.string().optional(),
  }),
]);

export const directorProposalSchema = z.object({
  id: z.string().min(1),
  movieId: z.string().min(1),
  projectId: z.string().min(1),
  status: z.enum(["pending", "partially-applied", "applied", "rejected", "invalid"]),
  title: z.string().min(1),
  rationale: z.string(),
  changes: z.array(directorChangeSchema),
  validationError: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const movieVersionSchema = z.object({
  id: z.string().min(1),
  movieId: z.string().min(1),
  projectId: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  clips: z.array(reviewClipSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const movieExportRunSchema = z.object({
  id: z.string().min(1),
  movieId: z.string().min(1),
  projectId: z.string().min(1),
  format: z.enum(["mp4", "webm"]),
  status: z.enum(["pending", "running", "complete", "failed", "cancelled"]),
  warnings: z.array(z.string()),
  blockers: z.array(z.string()),
  durationSeconds: z.number().nonnegative().optional(),
  outputBytes: z.number().nonnegative().optional(),
  audioProof: z.object({
    expectedAudio: z.boolean(),
    hasAudioStream: z.boolean(),
    codec: z.string().optional(),
  }),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type ReviewMode = z.infer<typeof reviewModeSchema>;
export type ClipLifecycle = z.infer<typeof clipLifecycleSchema>;
export type ClipFlag = z.infer<typeof clipFlagSchema>;
export type MediaRef = z.infer<typeof mediaRefSchema>;
export type ReviewClip = z.infer<typeof reviewClipSchema>;
export type SelectedTarget = z.infer<typeof selectedTargetSchema>;
export type MovieReviewProject = z.infer<typeof movieReviewProjectSchema>;
export type DirectorChange = z.infer<typeof directorChangeSchema>;
export type DirectorProposal = z.infer<typeof directorProposalSchema>;
export type MovieVersion = z.infer<typeof movieVersionSchema>;
export type MovieExportRun = z.infer<typeof movieExportRunSchema>;
