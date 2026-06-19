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
