const { test, expect } = require("@playwright/test");

test("Vault identity API returns redacted Worker identity", async ({ request }) => {
  const res = await request.get("/api/vault/identity");
  expect(res.ok()).toBe(true);
  const body = await res.json();
  expect(body.ok).toBe(true);
  expect(body.service).toBe("fake-grok-r2-backup");
  expect(body.keyPrefix).toBe("grok-powertools/v1");
  expect(JSON.stringify(body)).not.toContain("client-sample");
});

test("Vault preview returns inventory, prompts, gaps, and counts", async ({ request }) => {
  const res = await request.get("/api/vault/preview");
  expect(res.ok()).toBe(true);
  const body = await res.json();
  expect(body.assets).toHaveLength(4);
  expect(body.prompts).toHaveLength(2);
  expect(body.gaps).toHaveLength(2);
  expect(body.counts.assets).toBe(4);
  expect(body.counts.images).toBe(2);
  expect(body.counts.videos).toBe(2);
  expect(body.counts.verified).toBe(4);
  expect(body.scanTruncated).toBe(false);
  expect(body.warnings).toEqual(
    expect.arrayContaining([
      expect.stringContaining("inventory.items[3]"),
      expect.stringContaining("metadata.prompts[2]"),
    ]),
  );
  expect(body.gaps).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: "gap-index-drift-asset-image-1",
        objectKey: "grok-powertools/v1/users/greymaker/media/by-asset/asset-image-1.png",
        requiresCloudWrite: true,
      }),
      expect.objectContaining({
        id: "gap-live-grok-asset-missing",
        requiresLiveGrok: true,
      }),
    ]),
  );
  expect(JSON.stringify(body)).not.toContain("asset-malformed-1");
  expect(JSON.stringify(body)).not.toContain("prompt-malformed-1");
});

test("Vault media route proxies media without exposing Worker API key", async ({ request }) => {
  const res = await request.get("/api/vault/media/asset-image-1");
  expect(res.ok()).toBe(true);
  expect(res.headers()["content-type"]).toContain("image/png");
  const body = await res.body();
  expect(body.byteLength).toBeGreaterThan(0);
});

test("Vault media route can proxy an exact inventory object key", async ({ request }) => {
  const objectKey = "grok-powertools/v1/users/greymaker/media/by-asset/zz-page-2-image.png";
  const res = await request.get(`/api/vault/media/zz-page-2-image?objectKey=${encodeURIComponent(objectKey)}`);
  expect(res.ok()).toBe(true);
  expect(res.headers()["content-type"]).toContain("image/png");
  const body = await res.body();
  expect(body.byteLength).toBeGreaterThan(0);
});

test("Gap-fill run is blocked by default", async ({ request }) => {
  const res = await request.post("/api/vault/gap-fill/run", {
    data: { assetIds: ["asset-image-1"] },
  });
  expect(res.status()).toBe(409);
  const body = await res.json();
  expect(body.error).toBe("LIVE_GROK_REPAIR_NOT_ARMED");
});
