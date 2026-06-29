import type { MovieReviewProject, ReviewClip, SelectedTarget } from "./movie-review-types";

export type ReviewCommand =
  | { type: "select"; target: SelectedTarget }
  | { type: "set-mode"; mode: MovieReviewProject["mode"] }
  | { type: "keep-current" }
  | { type: "reject-current" }
  | { type: "move-committed"; clipId: string; direction: -1 | 1 }
  | { type: "delete-committed"; clipId: string }
  | { type: "set-trim"; clipId: string; trimStartSeconds: number; trimEndSeconds: number }
  | { type: "set-audio"; clipId: string; volume: number; muted: boolean; solo: boolean };

function timestampProject(project: MovieReviewProject): MovieReviewProject {
  return { ...project, updatedAt: new Date().toISOString() };
}

function withPositions(clips: ReviewClip[]): ReviewClip[] {
  return clips.map((clip, position) => ({ ...clip, position }));
}

function activeCandidate(project: MovieReviewProject): ReviewClip | undefined {
  return project.candidates[project.activeIndex];
}

function flagClip(clip: ReviewClip, flag: ReviewClip["flags"][number], enabled: boolean): ReviewClip {
  const flags = new Set(clip.flags);
  if (enabled) flags.add(flag);
  else flags.delete(flag);
  return { ...clip, flags: [...flags] };
}

function updateCommittedClip(project: MovieReviewProject, clipId: string, update: (clip: ReviewClip) => ReviewClip): MovieReviewProject {
  return {
    ...project,
    committedClips: project.committedClips.map((clip) => (clip.id === clipId ? update(clip) : clip)),
  };
}

export function applyReviewCommand(project: MovieReviewProject, command: ReviewCommand): MovieReviewProject {
  switch (command.type) {
    case "select":
      return timestampProject({ ...project, selectedTarget: command.target });
    case "set-mode":
      return timestampProject({ ...project, mode: command.mode });
    case "keep-current": {
      const current = activeCandidate(project);
      if (!current) return project;
      const kept = { ...current, lifecycle: "kept" as const, position: project.committedClips.length };
      const candidates = project.candidates.filter((clip) => clip.id !== current.id);
      return timestampProject({
        ...project,
        candidates: withPositions(candidates),
        committedClips: withPositions([...project.committedClips, kept]),
        activeIndex: Math.min(project.activeIndex, Math.max(0, candidates.length - 1)),
        selectedTarget: { type: "clip", clipId: kept.id },
      });
    }
    case "reject-current": {
      const current = activeCandidate(project);
      if (!current) return project;
      const candidates = project.candidates.filter((clip) => clip.id !== current.id);
      return timestampProject({
        ...project,
        candidates: withPositions(candidates),
        activeIndex: Math.min(project.activeIndex, Math.max(0, candidates.length - 1)),
      });
    }
    case "move-committed": {
      const index = project.committedClips.findIndex((clip) => clip.id === command.clipId);
      const targetIndex = index + command.direction;
      if (index < 0 || targetIndex < 0 || targetIndex >= project.committedClips.length) return project;
      const next = [...project.committedClips];
      const [item] = next.splice(index, 1);
      next.splice(targetIndex, 0, item);
      return timestampProject({ ...project, committedClips: withPositions(next) });
    }
    case "delete-committed":
      return timestampProject({
        ...project,
        committedClips: withPositions(project.committedClips.filter((clip) => clip.id !== command.clipId)),
      });
    case "set-trim":
      return timestampProject(
        updateCommittedClip(project, command.clipId, (clip) =>
          flagClip({ ...clip, trimStartSeconds: command.trimStartSeconds, trimEndSeconds: command.trimEndSeconds }, "trimmed", true),
        ),
      );
    case "set-audio":
      return timestampProject(
        updateCommittedClip(project, command.clipId, (clip) =>
          flagClip({ ...clip, volume: command.volume, muted: command.muted, solo: command.solo }, "muted-in-mix", command.muted),
        ),
      );
  }
}
