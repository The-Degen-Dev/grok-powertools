import { describe, expect, it } from "vitest";
import type { MovieReviewProject, ReviewClip } from "./movie-review-types";
import { applyDirectorChanges, createRuleBasedDirectorProposal, parseDirectorProviderPayload } from "./movie-director";

function clip(id: string, position: number): ReviewClip {
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

describe("movie director", () => {
  it("creates proposal-only rule output", () => {
    const proposal = createRuleBasedDirectorProposal(project());
    expect(proposal.status).toBe("pending");
    expect(proposal.changes.length).toBeGreaterThan(0);
  });

  it("marks no-op Director output invalid instead of pending", () => {
    const original = {
      ...project(),
      candidates: [],
      committedClips: [{ ...clip("kept-a", 0), lifecycle: "kept" as const }],
    };
    const ruleProposal = createRuleBasedDirectorProposal(original);
    expect(ruleProposal.status).toBe("invalid");
    expect(ruleProposal.changes).toEqual([]);
    expect(ruleProposal.validationError).toMatch(/No actionable/i);

    const providerProposal = parseDirectorProviderPayload(
      {
        title: "No useful changes",
        rationale: "The current cut is already assembled.",
        changes: [],
      },
      original,
    );
    expect(providerProposal.status).toBe("invalid");
    expect(providerProposal.validationError).toMatch(/no actionable/i);
  });

  it("rejects invalid provider output", () => {
    expect(() => parseDirectorProviderPayload({ title: "", changes: [{ type: "deleteEverything" }] }, project())).toThrow();
    expect(() =>
      parseDirectorProviderPayload(
        {
          title: "Bad target",
          rationale: "Provider target is stale.",
          changes: [{ id: "missing-keep", type: "keep", clipId: "missing", rationale: "Stale clip id." }],
        },
        project(),
      ),
    ).toThrow("DIRECTOR_UNKNOWN_CLIP:missing");
  });

  it("rejects action targets from the wrong lane", () => {
    const original = {
      ...project(),
      committedClips: [{ ...clip("committed-a", 0), lifecycle: "kept" as const }],
    };
    expect(() =>
      parseDirectorProviderPayload(
        {
          title: "Wrong keep",
          rationale: "Committed clips cannot be kept again.",
          changes: [{ id: "keep-committed", type: "keep", clipId: "committed-a", rationale: "Wrong lane." }],
        },
        original,
      ),
    ).toThrow("DIRECTOR_INVALID_CANDIDATE_TARGET:committed-a");
    expect(() =>
      parseDirectorProviderPayload(
        {
          title: "Wrong trim",
          rationale: "Candidate clips cannot be trimmed before they are kept.",
          changes: [{ id: "trim-candidate", type: "trim", clipId: "a", trimStartSeconds: 0.2, trimEndSeconds: 1, rationale: "Wrong lane." }],
        },
        original,
      ),
    ).toThrow("DIRECTOR_INVALID_COMMITTED_TARGET:a");
  });

  it("applies only selected changes", () => {
    const original = project();
    const proposal = createRuleBasedDirectorProposal(original);
    const next = applyDirectorChanges(original, proposal, [proposal.changes[0].id ?? ""]);
    expect(next).not.toBe(original);
    expect(original.committedClips).toEqual([]);
    expect(next.committedClips.map((item) => item.id)).toEqual(["a"]);
  });

  it("does not keep a fallback clip when a selected target is missing", () => {
    const original = project();
    const proposal = parseDirectorProviderPayload(
      {
        title: "Valid target",
        rationale: "Provider target was valid when proposed.",
        changes: [{ id: "keep-b", type: "keep", clipId: "b", rationale: "Use the second clip." }],
      },
      original,
    );
    const staleProject = { ...original, candidates: [clip("a", 0)] };
    const next = applyDirectorChanges(staleProject, proposal, ["keep-b"]);
    expect(next).toEqual(staleProject);
  });

  it("applies selected reorder changes", () => {
    const original = {
      ...project(),
      candidates: [],
      committedClips: [
        { ...clip("a", 0), lifecycle: "kept" as const },
        { ...clip("b", 1), lifecycle: "kept" as const },
      ],
    };
    const proposal = parseDirectorProviderPayload(
      {
        title: "Reverse order",
        rationale: "Use the stronger ending first.",
        changes: [{ id: "reorder-a", type: "reorder", clipIds: ["b", "a"], rationale: "Swap the two clips." }],
      },
      original,
    );
    const next = applyDirectorChanges(original, proposal, ["reorder-a"]);
    expect(next.committedClips.map((item) => item.id)).toEqual(["b", "a"]);
    expect(next.committedClips.map((item) => item.position)).toEqual([0, 1]);
    expect(original.committedClips.map((item) => item.id)).toEqual(["a", "b"]);
  });
});
