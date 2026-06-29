import type { MovieReviewProject, ReviewClip, SelectedTarget } from "./movie-review-types";

export type ReviewCommand =
  | { type: "select"; target: SelectedTarget }
  | { type: "set-mode"; mode: MovieReviewProject["mode"] }
  | { type: "keep-current" }
  | { type: "reject-current" }
  | { type: "move-committed"; clipId: string; direction: -1 | 1 }
  | { type: "delete-committed"; clipId: string }
  | { type: "set-trim"; clipId: string; trimStartSeconds?: number; trimEndSeconds?: number }
  | { type: "apply-version"; clips: ReviewClip[] }
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

function clampVolume(volume: number): number {
  if (!Number.isFinite(volume)) return 1;
  return Math.max(0, Math.min(2, volume));
}

function validTrim(trimStartSeconds: number, trimEndSeconds: number | undefined): boolean {
  return (
    Number.isFinite(trimStartSeconds) &&
    trimStartSeconds >= 0 &&
    (trimEndSeconds === undefined || (Number.isFinite(trimEndSeconds) && trimEndSeconds > trimStartSeconds))
  );
}

function candidateSelection(candidates: ReviewClip[], activeIndex: number): SelectedTarget | undefined {
  const selected = candidates[activeIndex];
  return selected ? { type: "candidate", clipId: selected.id } : undefined;
}

function committedSelection(clips: ReviewClip[], index: number): SelectedTarget | undefined {
  const selected = clips[Math.max(0, Math.min(index, clips.length - 1))];
  return selected ? { type: "clip", clipId: selected.id } : undefined;
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
      const selectedCurrent = project.selectedTarget?.type === "candidate" && project.selectedTarget.clipId === current.id;
      const candidates = project.candidates.filter((clip) => clip.id !== current.id);
      const activeIndex = Math.min(project.activeIndex, Math.max(0, candidates.length - 1));
      return timestampProject({
        ...project,
        candidates: withPositions(candidates),
        activeIndex,
        selectedTarget: selectedCurrent || project.mode === "focus" ? candidateSelection(candidates, activeIndex) : project.selectedTarget,
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
    case "delete-committed": {
      const deletedIndex = project.committedClips.findIndex((clip) => clip.id === command.clipId);
      const clips = withPositions(project.committedClips.filter((clip) => clip.id !== command.clipId));
      const selectedDeleted = project.selectedTarget?.type === "clip" && project.selectedTarget.clipId === command.clipId;
      return timestampProject({
        ...project,
        committedClips: clips,
        selectedTarget: selectedDeleted ? committedSelection(clips, deletedIndex) : project.selectedTarget,
      });
    }
    case "set-trim": {
      const existing = project.committedClips.find((clip) => clip.id === command.clipId);
      if (!existing) return project;
      const trimStartSeconds = command.trimStartSeconds ?? existing.trimStartSeconds;
      const trimEndSeconds = command.trimEndSeconds ?? existing.trimEndSeconds;
      if (!validTrim(trimStartSeconds, trimEndSeconds)) return project;
      return timestampProject(
        updateCommittedClip(project, command.clipId, (clip) =>
          flagClip({ ...clip, trimStartSeconds, trimEndSeconds }, "trimmed", trimStartSeconds > 0 || trimEndSeconds !== undefined),
        ),
      );
    }
    case "apply-version": {
      const committedClips = withPositions(command.clips.map((clip) => ({ ...clip, lifecycle: "kept" as const })));
      return timestampProject({
        ...project,
        committedClips,
        selectedTarget: committedSelection(committedClips, 0),
      });
    }
    case "set-audio":
      return timestampProject(
        updateCommittedClip(project, command.clipId, (clip) =>
          flagClip({ ...clip, volume: clampVolume(command.volume), muted: command.muted, solo: command.solo }, "muted-in-mix", command.muted),
        ),
      );
  }
}
