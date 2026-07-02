import { describe, expect, it } from "vitest";
import { movieReviewProjectSchema, type MovieReviewProject, type ReviewClip } from "./movie-review-types";
import { applyReviewCommand } from "./movie-review-reducer";

function clip(id: string, position = 0): ReviewClip {
  return {
    id,
    sourceAssetId: id,
    mediaType: "video",
    mediaRef: { type: "vault", assetId: id },
    videoUrl: `/api/vault/media/${id}`,
    tags: [],
    position,
    lifecycle: "proposed",
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
  };
}

function project(): MovieReviewProject {
  return {
    schemaVersion: 1,
    id: "project-a",
    movieId: "movie-a",
    title: "Movie",
    mode: "review",
    candidates: [clip("a", 0), clip("b", 1)],
    committedClips: [],
    activeIndex: 0,
    masterVolume: 1,
    masterMuted: false,
    createdAt: "2026-06-28T00:00:00.000Z",
    updatedAt: "2026-06-28T00:00:00.000Z",
  };
}

describe("movie review reducer", () => {
  it("keeps current candidate and auto-advances", () => {
    const next = applyReviewCommand(project(), { type: "keep-current" });
    expect(next.candidates.map((item) => item.id)).toEqual(["b"]);
    expect(next.committedClips.map((item) => item.id)).toEqual(["a"]);
    expect(next.activeIndex).toBe(0);
  });

  it("rejects current candidate without adding to committed cut", () => {
    const next = applyReviewCommand({ ...project(), selectedTarget: { type: "candidate", clipId: "a" } }, { type: "reject-current" });
    expect(next.candidates[0]).toMatchObject({ id: "b" });
    expect(next.committedClips).toEqual([]);
    expect(next.selectedTarget).toEqual({ type: "candidate", clipId: "b" });
  });

  it("keeps proposal ids separate from clip ids", () => {
    const next = applyReviewCommand(project(), { type: "select", target: { type: "proposal", proposalId: "proposal-a" } });
    expect(next.selectedTarget).toEqual({ type: "proposal", proposalId: "proposal-a" });
  });

  it("updates trim and flags", () => {
    const kept = applyReviewCommand(project(), { type: "keep-current" });
    const trimmed = applyReviewCommand(kept, { type: "set-trim", clipId: "a", trimStartSeconds: 0.2, trimEndSeconds: 1.5 });
    expect(trimmed.committedClips[0]).toMatchObject({ trimStartSeconds: 0.2, trimEndSeconds: 1.5 });
    expect(trimmed.committedClips[0].flags).toContain("trimmed");
  });

  it("updates trim start without inventing an unknown trim end", () => {
    const kept = applyReviewCommand(project(), { type: "keep-current" });
    const unknownDuration = {
      ...kept,
      committedClips: kept.committedClips.map((item) => ({ ...item, durationSeconds: undefined, trimEndSeconds: undefined })),
    };
    const trimmed = applyReviewCommand(unknownDuration, { type: "set-trim", clipId: "a", trimStartSeconds: 0.2 });
    expect(trimmed.committedClips[0]).toMatchObject({ trimStartSeconds: 0.2 });
    expect(trimmed.committedClips[0].trimEndSeconds).toBeUndefined();
    expect(trimmed.committedClips[0].flags).toContain("trimmed");
  });

  it("ignores invalid trims and clamps audio volume to schema-safe values", () => {
    const kept = applyReviewCommand(project(), { type: "keep-current" });
    const invalidTrim = applyReviewCommand(kept, { type: "set-trim", clipId: "a", trimStartSeconds: 2, trimEndSeconds: 1 });
    const loud = applyReviewCommand(invalidTrim, { type: "set-audio", clipId: "a", volume: 9, muted: false, solo: false });
    expect(loud.committedClips[0]).toMatchObject({ trimStartSeconds: 0, trimEndSeconds: 2, volume: 2 });
    expect(() => movieReviewProjectSchema.parse(loud)).not.toThrow();
  });

  it("uses solo semantics where any soloed clip silences other clips", () => {
    const keptA = applyReviewCommand(project(), { type: "keep-current" });
    const keptB = applyReviewCommand(keptA, { type: "keep-current" });
    const solo = applyReviewCommand(keptB, { type: "set-audio", clipId: "a", volume: 1, muted: false, solo: true });
    expect(solo.committedClips.find((item) => item.id === "a")?.solo).toBe(true);
    expect(solo.committedClips.find((item) => item.id === "b")?.solo).toBe(false);
  });

  it("records explicit source-audio intent for committed clips", () => {
    const kept = applyReviewCommand(project(), { type: "keep-current" });
    const confirmed = applyReviewCommand(kept, { type: "set-source-audio", clipId: "a", hasSourceAudio: true });
    expect(confirmed.committedClips[0].flags).toContain("has-source-audio");

    const cleared = applyReviewCommand(confirmed, { type: "set-source-audio", clipId: "a", hasSourceAudio: false });
    expect(cleared.committedClips[0].flags).not.toContain("has-source-audio");
  });

  it("clears selection when deleting the selected committed clip", () => {
    const kept = applyReviewCommand(project(), { type: "keep-current" });
    const deleted = applyReviewCommand({ ...kept, selectedTarget: { type: "clip", clipId: "a" } }, { type: "delete-committed", clipId: "a" });
    expect(deleted.committedClips).toEqual([]);
    expect(deleted.selectedTarget).toBeUndefined();
  });

  it("rejects the active focus candidate even when the selected target is a committed clip", () => {
    const kept = applyReviewCommand({ ...project(), mode: "focus" }, { type: "keep-current" });
    const rejected = applyReviewCommand(kept, { type: "reject-current" });
    expect(rejected.candidates).toEqual([]);
    expect(rejected.committedClips.map((item) => item.id)).toEqual(["a"]);
    expect(rejected.selectedTarget).toBeUndefined();
  });

  it("applies a saved version with normalized positions and valid selection", () => {
    const current = {
      ...applyReviewCommand(project(), { type: "keep-current" }),
      selectedTarget: { type: "clip" as const, clipId: "missing" },
    };
    const versionClips = [clip("z", 4), clip("y", 2)];
    const applied = applyReviewCommand(current, { type: "apply-version", clips: versionClips });
    expect(applied.committedClips.map((item) => [item.id, item.position])).toEqual([
      ["z", 0],
      ["y", 1],
    ]);
    expect(applied.selectedTarget).toEqual({ type: "clip", clipId: "z" });
  });
});
