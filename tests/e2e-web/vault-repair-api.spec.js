const { test, expect } = require("@playwright/test");

const identityScope = {
  workerHost: "127.0.0.1",
  keyPrefix: "grok-powertools/v1",
  bucketName: "fake-vault-bucket",
  apiKeyFingerprint: "fp_client_sample",
};

const indexDriftIssue = {
  issueId: "repair-gap-index-drift-asset-image-1",
  assetId: "asset-image-1",
  issueType: "index_drift",
  riskTier: "T1",
  sourceProof: [
    {
      kind: "d1_index",
      label: "Worker gap gap-index-drift-asset-image-1",
      objectKey: "grok-powertools/v1/users/greymaker/media/by-asset/asset-image-1.png",
      observedAt: "2026-06-20T00:00:00.000Z",
    },
  ],
  writeClass: "d1_index",
};

test("repair plan API produces deterministic hash and exact write impact", async ({ request }) => {
  const first = await request.post("/api/vault/repair/plan", {
    data: { identityScope, issues: [indexDriftIssue], selectedIssueIds: [indexDriftIssue.issueId] },
  });
  expect(first.ok()).toBe(true);
  const firstBody = await first.json();

  const second = await request.post("/api/vault/repair/plan", {
    data: { selectedIssueIds: [indexDriftIssue.issueId], issues: [indexDriftIssue], identityScope },
  });
  expect(second.ok()).toBe(true);
  const secondBody = await second.json();

  expect(firstBody.plan.planHash).toBe(secondBody.plan.planHash);
  expect(firstBody.plan.identityScope).toEqual(identityScope);
  expect(firstBody.plan.issueIds).toEqual([indexDriftIssue.issueId]);
  expect(firstBody.plan.targetCount).toBe(1);
  expect(firstBody.plan.writeClasses).toEqual(["d1_index"]);
  expect(firstBody.plan.riskTierMax).toBe("T1");
  expect(firstBody.plan.objectKeys).toEqual([
    "grok-powertools/v1/users/greymaker/media/by-asset/asset-image-1.png",
  ]);
  expect(firstBody.plan.actions).toHaveLength(1);
  expect(firstBody.plan.actions[0]).toEqual({
    actionId: "action-repair-gap-index-drift-asset-image-1",
    idempotencyKey: `${firstBody.plan.planHash}:${indexDriftIssue.issueId}`,
    writeClass: "d1_index",
    target: "asset-image-1",
    expectedProof: indexDriftIssue.sourceProof,
  });
  expect(JSON.stringify(firstBody)).not.toContain("client-sample");
});

test("repair plan API hash ignores observedAt but preserves returned proof timestamps", async ({ request }) => {
  const earlierIssue = {
    ...indexDriftIssue,
    sourceProof: [
      {
        ...indexDriftIssue.sourceProof[0],
        observedAt: "2026-06-20T00:00:00.000Z",
      },
    ],
  };
  const laterIssue = {
    ...indexDriftIssue,
    sourceProof: [
      {
        ...indexDriftIssue.sourceProof[0],
        observedAt: "2026-06-21T05:06:07.000Z",
      },
    ],
  };

  const first = await request.post("/api/vault/repair/plan", {
    data: { identityScope, issues: [earlierIssue], selectedIssueIds: [earlierIssue.issueId] },
  });
  const second = await request.post("/api/vault/repair/plan", {
    data: { identityScope, issues: [laterIssue], selectedIssueIds: [laterIssue.issueId] },
  });

  expect(first.ok()).toBe(true);
  expect(second.ok()).toBe(true);

  const firstBody = await first.json();
  const secondBody = await second.json();

  expect(firstBody.plan.planHash).toBe(secondBody.plan.planHash);
  expect(firstBody.plan.actions[0].expectedProof[0].observedAt).toBe("2026-06-20T00:00:00.000Z");
  expect(secondBody.plan.actions[0].expectedProof[0].observedAt).toBe("2026-06-21T05:06:07.000Z");
});

test("repair plan API fails closed when selected issue ids are missing from issues", async ({ request }) => {
  const response = await request.post("/api/vault/repair/plan", {
    data: {
      identityScope,
      issues: [indexDriftIssue],
      selectedIssueIds: [indexDriftIssue.issueId, "repair-gap-missing"],
    },
  });

  expect(response.status()).toBe(400);
  await expect(response.json()).resolves.toEqual({
    ok: false,
    error: "REPAIR_SELECTED_ISSUE_MISSING",
  });
});

test("repair plan API rejects duplicate issue ids before plan construction", async ({ request }) => {
  const duplicateIssue = {
    ...indexDriftIssue,
    assetId: "asset-image-2",
    sourceProof: [
      {
        ...indexDriftIssue.sourceProof[0],
        label: "Worker gap duplicate",
        objectKey: "grok-powertools/v1/users/greymaker/media/by-asset/asset-image-2.png",
      },
    ],
  };

  const response = await request.post("/api/vault/repair/plan", {
    data: {
      identityScope,
      issues: [indexDriftIssue, duplicateIssue],
      selectedIssueIds: [indexDriftIssue.issueId],
    },
  });

  expect(response.status()).toBe(400);
  await expect(response.json()).resolves.toEqual({
    ok: false,
    error: "REPAIR_ISSUE_ID_DUPLICATE",
  });
});

test("repair plan API normalizes malformed JSON parse failures", async ({ request }) => {
  const response = await request.post("/api/vault/repair/plan", {
    headers: { "content-type": "application/json" },
    data: Buffer.from("{\"identityScope\":"),
  });

  expect(response.status()).toBe(400);
  await expect(response.json()).resolves.toEqual({
    ok: false,
    error: "REPAIR_PLAN_INVALID_JSON",
  });
});

test("repair plan API rejects malformed optional identity scope string fields", async ({ request }) => {
  const malformedIdentityScope = {
    ...identityScope,
    bucketName: 123,
    apiKeyFingerprint: { value: "fp" },
  };

  const response = await request.post("/api/vault/repair/plan", {
    data: {
      identityScope: malformedIdentityScope,
      issues: [indexDriftIssue],
      selectedIssueIds: [indexDriftIssue.issueId],
    },
  });

  expect(response.status()).toBe(400);
  await expect(response.json()).resolves.toEqual({
    ok: false,
    error: "identityScope.bucketName must be a non-empty string when provided",
  });
});

test("repair plan API rejects malformed optional issue string fields", async ({ request }) => {
  const malformedIssue = {
    ...indexDriftIssue,
    assetId: 42,
    blockedReason: true,
  };

  const response = await request.post("/api/vault/repair/plan", {
    data: {
      identityScope,
      issues: [malformedIssue],
      selectedIssueIds: [indexDriftIssue.issueId],
    },
  });

  expect(response.status()).toBe(400);
  await expect(response.json()).resolves.toEqual({
    ok: false,
    error: "issues[0].assetId must be a non-empty string when provided",
  });
});

test("repair plan API rejects whitespace-only optional issue string fields", async ({ request }) => {
  const malformedIssue = {
    ...indexDriftIssue,
    blockedReason: "   ",
  };

  const response = await request.post("/api/vault/repair/plan", {
    data: {
      identityScope,
      issues: [malformedIssue],
      selectedIssueIds: [indexDriftIssue.issueId],
    },
  });

  expect(response.status()).toBe(400);
  await expect(response.json()).resolves.toEqual({
    ok: false,
    error: "issues[0].blockedReason must be a non-empty string when provided",
  });
});

test("repair plan API rejects malformed optional proof string fields", async ({ request }) => {
  const malformedIssue = {
    ...indexDriftIssue,
    sourceProof: [
      {
        ...indexDriftIssue.sourceProof[0],
        objectKey: 99,
        contentSha256: false,
      },
    ],
  };

  const response = await request.post("/api/vault/repair/plan", {
    data: {
      identityScope,
      issues: [malformedIssue],
      selectedIssueIds: [indexDriftIssue.issueId],
    },
  });

  expect(response.status()).toBe(400);
  await expect(response.json()).resolves.toEqual({
    ok: false,
    error: "issues[0].sourceProof[0].contentSha256 must be a non-empty string when provided",
  });
});
