import { v4 as uuidv4 } from "uuid";
import { z } from "zod";
import { applyReviewCommand } from "./movie-review-reducer";
import { directorProposalSchema, type DirectorProposal, type MovieReviewProject } from "./movie-review-types";

export const providerDirectorPayloadSchema = z.object({
  title: z.string().min(1),
  rationale: z.string().min(1),
  changes: z.array(
    z.discriminatedUnion("type", [
      z.object({
        id: z.string().min(1).optional(),
        type: z.literal("keep"),
        clipId: z.string().min(1),
        rationale: z.string().min(1),
      }),
      z.object({
        id: z.string().min(1).optional(),
        type: z.literal("reject"),
        clipId: z.string().min(1),
        rationale: z.string().min(1),
      }),
      z.object({
        id: z.string().min(1).optional(),
        type: z.literal("reorder"),
        clipIds: z.array(z.string().min(1)).min(1),
        rationale: z.string().min(1),
      }),
      z.object({
        id: z.string().min(1).optional(),
        type: z.literal("trim"),
        clipId: z.string().min(1),
        trimStartSeconds: z.number().nonnegative(),
        trimEndSeconds: z.number().positive(),
        rationale: z.string().min(1),
      }),
    ]),
  ),
});

function projectClipIds(project: MovieReviewProject): Set<string> {
  return new Set([...project.candidates, ...project.committedClips].map((clip) => clip.id));
}

function assertChangeTargetsProject(proposal: DirectorProposal, project: MovieReviewProject) {
  const clipIds = projectClipIds(project);
  for (const change of proposal.changes) {
    if ((change.type === "keep" || change.type === "reject") && !clipIds.has(change.clipId)) {
      throw new Error(`DIRECTOR_UNKNOWN_CLIP:${change.clipId}`);
    }
    if (change.type === "trim") {
      if (!clipIds.has(change.clipId)) throw new Error(`DIRECTOR_UNKNOWN_CLIP:${change.clipId}`);
      if (change.trimEndSeconds <= change.trimStartSeconds) throw new Error("DIRECTOR_INVALID_TRIM");
    }
    if (change.type === "reorder" && change.clipIds.some((clipId) => !clipIds.has(clipId))) {
      throw new Error("DIRECTOR_UNKNOWN_REORDER_CLIP");
    }
  }
}

export function createRuleBasedDirectorProposal(project: MovieReviewProject): DirectorProposal {
  const timestamp = new Date().toISOString();
  const first = project.candidates[0];
  const changes = first
    ? [{ id: uuidv4(), type: "keep" as const, clipId: first.id, rationale: "Keep the first available candidate to start the cut." }]
    : [];
  return directorProposalSchema.parse({
    id: uuidv4(),
    movieId: project.movieId,
    projectId: project.id,
    status: "pending",
    title: "Start with strongest available clip",
    rationale: "Rule-based Director uses the current candidate order and proposes a conservative first assembly.",
    changes,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}

export function parseDirectorProviderPayload(payload: unknown, project: MovieReviewProject): DirectorProposal {
  const parsed = providerDirectorPayloadSchema.parse(payload);
  const timestamp = new Date().toISOString();
  const proposal = directorProposalSchema.parse({
    id: uuidv4(),
    movieId: project.movieId,
    projectId: project.id,
    status: "pending",
    title: parsed.title,
    rationale: parsed.rationale,
    changes: parsed.changes.map((change) => ({ ...change, id: change.id || uuidv4() })),
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  assertChangeTargetsProject(proposal, project);
  return proposal;
}

export function applyDirectorChanges(project: MovieReviewProject, proposal: DirectorProposal, selectedChangeIds: string[]): MovieReviewProject {
  const selected = new Set(selectedChangeIds);
  let next = project;
  for (const change of proposal.changes) {
    if (!change.id || !selected.has(change.id)) continue;
    if (change.type === "keep") {
      const index = next.candidates.findIndex((clip) => clip.id === change.clipId);
      if (index < 0) continue;
      next = applyReviewCommand({ ...next, activeIndex: index }, { type: "keep-current" });
    }
    if (change.type === "reject") {
      const index = next.candidates.findIndex((clip) => clip.id === change.clipId);
      if (index < 0) continue;
      next = applyReviewCommand({ ...next, activeIndex: index }, { type: "reject-current" });
    }
    if (change.type === "trim") {
      next = applyReviewCommand(next, {
        type: "set-trim",
        clipId: change.clipId,
        trimStartSeconds: change.trimStartSeconds,
        trimEndSeconds: change.trimEndSeconds,
      });
    }
  }
  return next;
}
