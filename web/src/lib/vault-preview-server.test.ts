import { describe, expect, it } from "vitest";

import { dedupeAssets } from "./vault-dedupe";
import type { VaultAsset } from "./vault-types";

function asset(overrides: Partial<VaultAsset>): VaultAsset {
  return {
    assetId: "asset-1",
    mediaType: "image",
    legacyObjectKeys: [],
    verificationStatus: "verified",
    gapCodes: [],
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("dedupeAssets", () => {
  it("prefers the canonical R2 object regardless of page order and preserves legacy aliases", () => {
    const legacy = asset({
      contentType: "image/jpeg",
      legacyObjectKeys: ["grok-powertools/v1/users/greymaker/media/legacy/asset-1.jpg"],
      sizeBytes: 100,
      updatedAt: "2026-06-02T00:00:00.000Z",
    });
    const canonical = asset({
      canonicalObjectKey: "grok-powertools/v1/users/Shared_Account/media/by-asset/asset-1.jpg",
      contentType: "image/jpeg",
      sha256: "canonical-sha",
      sizeBytes: 100,
      updatedAt: "2026-06-03T00:00:00.000Z",
    });

    for (const assets of [[legacy, canonical], [canonical, legacy]]) {
      expect(dedupeAssets(assets)).toEqual([
        expect.objectContaining({
          assetId: "asset-1",
          canonicalObjectKey: canonical.canonicalObjectKey,
          sha256: "canonical-sha",
          legacyObjectKeys: legacy.legacyObjectKeys,
          updatedAt: "2026-06-03T00:00:00.000Z",
        }),
      ]);
    }
  });
});
