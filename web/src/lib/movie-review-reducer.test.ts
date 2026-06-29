import { describe, expect, it } from "vitest";
import type { MovieReviewProject, ReviewClip } from "./movie-review-types";
import { applyReviewCommand } from "./movie-review-reducer";

function clip(id: string, position = 0): ReviewClip {
  return {
    id,
    sourceAssetId: id,
    mediaType: "video",
    mediaRef: { type: "vault", assetId: id },
    videoUrl: `/api/vault/media/${id}`,
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
    const next = applyReviewCommand(project(), { type: "reject-current" });
    expect(next.candidates[0]).toMatchObject({ id: "b" });
    expect(next.committedClips).toEqual([]);
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

  it("uses solo semantics where any soloed clip silences other clips", () => {
    const keptA = applyReviewCommand(project(), { type: "keep-current" });
    const keptB = applyReviewCommand(keptA, { type: "keep-current" });
    const solo = applyReviewCommand(keptB, { type: "set-audio", clipId: "a", volume: 1, muted: false, solo: true });
    expect(solo.committedClips.find((item) => item.id === "a")?.solo).toBe(true);
    expect(solo.committedClips.find((item) => item.id === "b")?.solo).toBe(false);
  });
});
