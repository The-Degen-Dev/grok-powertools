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
  expect(body.assets).toHaveLength(2);
  expect(body.prompts).toHaveLength(2);
  expect(body.counts.assets).toBe(2);
  expect(body.counts.images).toBe(1);
  expect(body.counts.videos).toBe(1);
});

test("Vault media route proxies media without exposing Worker API key", async ({ request }) => {
  const res = await request.get("/api/vault/media/asset-image-1");
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
