import { describe, expect, it } from "vitest";
import { buildVaultMovieDrafts, type VaultDraftBuildInput } from "./vault-movie-drafts";
import type { VaultAsset, VaultOverlay } from "./vault-types";

function video(assetId: string, overrides: Partial<VaultAsset> = {}): VaultAsset {
  return {
    assetId,
    mediaType: "video",
    canonicalObjectKey: `grok-powertools/v1/users/greymaker/media/by-asset/${assetId}.mp4`,
    legacyObjectKeys: [],
    contentType: "video/mp4",
    sourceUrl: `https://grok.com/imagine/post/${assetId}`,
    promptText: "cinematic neon canyon flythrough",
    promptId: "prompt-shared",
    verificationStatus: "verified",
    gapCodes: [],
    createdAt: `2026-06-18T00:00:0${assetId.slice(-1)}.000Z`,
    updatedAt: `2026-06-18T00:00:0${assetId.slice(-1)}.000Z`,
    ...overrides,
  };
}

function image(assetId: string): VaultAsset {
  return {
    assetId,
    mediaType: "image",
    canonicalObjectKey: `grok-powertools/v1/users/greymaker/media/by-asset/${assetId}.png`,
    legacyObjectKeys: [],
    contentType: "image/png",
    promptText: "still frame",
    verificationStatus: "verified",
    gapCodes: [],
    createdAt: "2026-06-18T00:00:00.000Z",
    updatedAt: "2026-06-18T00:00:00.000Z",
  };
}

function overlay(assetId: string, patch: Partial<VaultOverlay>): VaultOverlay {
  return {
    assetId,
    tags: [],
    hidden: false,
    favorite: false,
    updatedAt: "2026-06-18T00:00:00.000Z",
    ...patch,
  };
}

function input(assets: VaultAsset[], overlays: VaultOverlay[] = []): VaultDraftBuildInput {
  return {
    assets,
    overlays,
    filteredAssetIds: assets.map((asset) => asset.assetId),
    selectedAssetIds: [],
    now: "2026-06-23T15:04:05.000Z",
  };
}

describe("buildVaultMovieDrafts", () => {
  it("builds recent verified video drafts with cut transitions and source asset ids", () => {
    const result = buildVaultMovieDrafts(input([video("asset-video-1"), video("asset-video-2"), image("asset-image-1")]), {
      recipe: "recent",
      scope: "filtered",
      maxClipsPerMovie: 1,
      maxMovies: 4,
    });

    expect(result.movies).toHaveLength(2);
    expect(result.movies.map((movie) => movie.clips[0].sourceAssetId)).toEqual(["asset-video-2", "asset-video-1"]);
    expect(result.movies.every((movie) => movie.clips[0].transition.type === "cut")).toBe(true);
    expect(result.skipped).toContainEqual({
      assetId: "asset-image-1",
      reason: "image-only asset",
    });
  });

  it("uses selected assets only for selected scope", () => {
    const result = buildVaultMovieDrafts(
      {
        ...input([video("asset-video-1"), video("asset-video-2")]),
        selectedAssetIds: ["asset-video-1"],
      },
      {
        recipe: "selected",
        scope: "selected",
        maxClipsPerMovie: 10,
        maxMovies: 2,
      },
    );

    expect(result.movies).toHaveLength(1);
    expect(result.movies[0].clips.map((clip) => clip.sourceAssetId)).toEqual(["asset-video-1"]);
  });

  it("uses favorite overlays for favorite drafts", () => {
    const result = buildVaultMovieDrafts(
      input([video("asset-video-1"), video("asset-video-2")], [overlay("asset-video-2", { favorite: true })]),
      {
        recipe: "favorites",
        scope: "favorites",
        maxClipsPerMovie: 10,
        maxMovies: 2,
      },
    );

    expect(result.movies).toHaveLength(1);
    expect(result.movies[0].clips.map((clip) => clip.sourceAssetId)).toEqual(["asset-video-2"]);
  });

  it("skips hidden assets for visible verified scope", () => {
    const result = buildVaultMovieDrafts(
      input([video("asset-video-1"), video("asset-video-2")], [overlay("asset-video-1", { hidden: true })]),
      {
        recipe: "recent",
        scope: "visible-verified",
        maxClipsPerMovie: 10,
        maxMovies: 2,
      },
    );

    expect(result.movies[0].clips.map((clip) => clip.sourceAssetId)).toEqual(["asset-video-2"]);
    expect(result.skipped).toContainEqual({
      assetId: "asset-video-1",
      reason: "hidden by local overlay",
    });
  });

  it("creates deterministic prompt groups only when a group has at least two videos", () => {
    const result = buildVaultMovieDrafts(
      input([
        video("asset-video-1", { promptId: "prompt-a", promptText: "red glass city at sunrise" }),
        video("asset-video-2", { promptId: "prompt-a", promptText: "red glass city at sunrise" }),
        video("asset-video-3", { promptId: "prompt-b", promptText: "lonely single prompt" }),
      ]),
      {
        recipe: "prompt-groups",
        scope: "filtered",
        maxClipsPerMovie: 10,
        maxMovies: 4,
      },
    );

    expect(result.movies).toHaveLength(1);
    expect(result.movies[0].name).toContain("Prompt Group");
    expect(result.movies[0].clips.map((clip) => clip.sourceAssetId)).toEqual(["asset-video-2", "asset-video-1"]);
    expect(result.skipped).toContainEqual({
      assetId: "asset-video-3",
      reason: "no prompt group with at least two videos",
    });
  });
});
