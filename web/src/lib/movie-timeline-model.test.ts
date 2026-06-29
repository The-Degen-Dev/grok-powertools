import { describe, expect, it } from "vitest";
import type { ReviewClip } from "./movie-review-types";
import { secondsToTicks, ticksToSeconds } from "./movie-timebase";
import { buildMovieTimeline, clipDurationSeconds, clipEffectiveGain, getExportPreflight, normalizeClipTrim } from "./movie-timeline-model";

function clip(id: string, patch: Partial<ReviewClip> = {}): ReviewClip {
  return {
    id,
    sourceAssetId: id,
    mediaType: "video",
    mediaRef: { type: "vault", assetId: id },
    videoUrl: `/api/vault/media/${id}`,
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
    ...patch,
  };
}

describe("movie timebase", () => {
  it("round-trips seconds through integer ticks", () => {
    expect(secondsToTicks(1.5)).toBe(45000);
    expect(ticksToSeconds(45000)).toBe(1.5);
  });
});

describe("movie timeline model", () => {
  it("builds stable entries from trimmed committed clips", () => {
    const entries = buildMovieTimeline([
      clip("a", { trimStartSeconds: 0.25, trimEndSeconds: 1.25, position: 0 }),
      clip("b", { trimStartSeconds: 0, trimEndSeconds: 2, position: 1 }),
    ]);
    expect(entries.map((entry) => ({ id: entry.clipId, start: entry.startTick, end: entry.endTick }))).toEqual([
      { id: "a", start: 0, end: 30000 },
      { id: "b", start: 30000, end: 90000 },
    ]);
  });

  it("normalizes invalid trim ranges", () => {
    expect(normalizeClipTrim(clip("a", { trimStartSeconds: 3, trimEndSeconds: 1, durationSeconds: 4 }))).toEqual({
      trimStartSeconds: 1,
      trimEndSeconds: 3,
    });
  });

  it("uses a nonzero provisional duration for videos before metadata loads", () => {
    const pendingMetadata = clip("a", { trimEndSeconds: undefined, durationSeconds: undefined });
    expect(clipDurationSeconds(pendingMetadata)).toBe(5);
    expect(buildMovieTimeline([pendingMetadata])[0]).toMatchObject({
      startTick: 0,
      endTick: 150000,
    });
  });

  it("blocks export for unresolved candidates and unknown audio intent", () => {
    const preflight = getExportPreflight({
      committedClips: [clip("a", { flags: [] })],
      candidates: [clip("b", { lifecycle: "proposed" })],
      pendingProposalCount: 0,
    });
    expect(preflight.blockers).toContain("Unresolved unsafe candidate state");
    expect(preflight.blockers).toContain("Unknown audio intent");
  });

  it("checks image media without requiring source-audio intent", () => {
    const imageClip = clip("image-a", {
      mediaType: "image",
      mediaRef: { type: "vault", assetId: "image-a" },
      videoUrl: undefined,
      imageUrl: "/api/vault/media/image-a",
      durationSeconds: 3,
      flags: [],
    });
    const missingImage = { ...imageClip, id: "image-b", imageUrl: undefined };
    const titleClip = clip("title-a", {
      mediaType: "title",
      mediaRef: { type: "title" },
      videoUrl: undefined,
      titleText: "Title",
      durationSeconds: 3,
      flags: [],
    });
    expect(getExportPreflight({ committedClips: [imageClip, titleClip], candidates: [], pendingProposalCount: 0 }).blockers).toEqual([]);
    expect(getExportPreflight({ committedClips: [missingImage], candidates: [], pendingProposalCount: 0 }).blockers).toContain("Missing media");
  });

  it("computes solo-aware effective gain for preview and export", () => {
    const clips = [
      clip("a", { volume: 0.8 }),
      clip("b", { volume: 0.5, solo: true }),
      clip("c", { volume: 1, muted: true }),
    ];
    expect(clipEffectiveGain(clips[0], clips)).toBe(0);
    expect(clipEffectiveGain(clips[1], clips, 0.8)).toBe(0.4);
    expect(clipEffectiveGain(clips[2], clips)).toBe(0);
  });
});
