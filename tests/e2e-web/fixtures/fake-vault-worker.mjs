import http from "node:http";

const port = Number(process.env.FAKE_VAULT_WORKER_PORT || 43117);
const apiKey = process.env.FAKE_VAULT_WORKER_API_KEY || "client-sample";
const headerName = "x-gpt-api-key";

const fixtureAssets = [
  {
    assetId: "asset-video-1",
    mediaType: "video",
    canonicalObjectKey: "grok-powertools/v1/users/greymaker/media/by-asset/asset-video-1.mp4",
    legacyObjectKeys: [],
    contentType: "video/mp4",
    sizeBytes: 1024,
    etag: "etag-video-1",
    sha256: "sha-video-1",
    sourceUrl: "https://grok.com/imagine/post/post-video-1",
    grokPostId: "post-video-1",
    promptId: "prompt-1",
    promptText: "A cinematic neon canyon flythrough.",
    durationSeconds: 5,
    firstSeenAt: "2026-06-18T00:00:00.000Z",
    lastSeenAt: "2026-06-18T00:00:00.000Z",
    verificationStatus: "verified",
    gapCodes: [],
    createdAt: "2026-06-18T00:00:00.000Z",
    updatedAt: "2026-06-18T00:00:00.000Z",
  },
  {
    assetId: "asset-image-1",
    mediaType: "image",
    canonicalObjectKey: "grok-powertools/v1/users/greymaker/media/by-asset/asset-image-1.png",
    legacyObjectKeys: ["grok-powertools/v1/users/greymaker/media/2025-12-20_Auto/asset-image-1.png"],
    contentType: "image/png",
    sizeBytes: 512,
    etag: "etag-image-1",
    sha256: "sha-image-1",
    sourceUrl: "https://grok.com/imagine/post/post-image-1",
    grokPostId: "post-image-1",
    promptId: "prompt-2",
    promptText: "A quiet glass library at sunrise.",
    width: 960,
    height: 960,
    firstSeenAt: "2026-06-18T00:00:00.000Z",
    lastSeenAt: "2026-06-18T00:00:00.000Z",
    verificationStatus: "verified",
    gapCodes: [],
    createdAt: "2026-06-18T00:00:00.000Z",
    updatedAt: "2026-06-18T00:00:00.000Z",
  },
];

const fixturePrompts = [
  {
    id: "prompt-1",
    text: "A cinematic neon canyon flythrough.",
    tags: ["vault"],
    sourceAssetIds: ["asset-video-1"],
    usageCount: 1,
    createdAt: "2026-06-18T00:00:00.000Z",
  },
  {
    id: "prompt-2",
    text: "A quiet glass library at sunrise.",
    tags: ["vault"],
    sourceAssetIds: ["asset-image-1"],
    usageCount: 1,
    createdAt: "2026-06-18T00:00:00.000Z",
  },
];

function sendJson(res, status, body) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
  });
  res.end(JSON.stringify(body));
}

function authorized(req) {
  return req.headers[headerName] === apiKey;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);
  if (req.method === "OPTIONS") return sendJson(res, 200, { ok: true });
  if (url.pathname === "/health") return sendJson(res, 200, { ok: true, service: "fake-grok-r2-backup" });
  if (!authorized(req)) return sendJson(res, 401, { ok: false, error: "Unauthorized" });

  if (url.pathname === "/v1/vault/identity") {
    return sendJson(res, 200, {
      ok: true,
      service: "fake-grok-r2-backup",
      workerHost: "127.0.0.1",
      keyPrefix: "grok-powertools/v1",
      r2: { bucketName: "fake-vault-bucket", bindingPresent: true },
      d1: { databaseName: "fake-vault-db", bindingPresent: true },
      apiKeyFingerprint: "fp_client_sample",
    });
  }

  if (url.pathname === "/v1/vault/inventory") {
    return sendJson(res, 200, {
      ok: true,
      items: fixtureAssets,
      nextCursor: null,
      counts: { assets: 2, images: 1, videos: 1, verified: 2, blocked: 0, failed: 0, unproven: 0 },
    });
  }

  if (url.pathname === "/v1/vault/metadata/savedPrompts") {
    return sendJson(res, 200, { ok: true, kind: "savedPrompts", prompts: fixturePrompts });
  }

  if (url.pathname === "/v1/vault/metadata/promptHistory") {
    return sendJson(res, 200, { ok: true, kind: "promptHistory", data: fixturePrompts });
  }

  if (url.pathname === "/v1/vault/gaps") {
    return sendJson(res, 200, { ok: true, gaps: [] });
  }

  if (url.pathname === "/v1/vault/media") {
    const assetId = url.searchParams.get("assetId");
    if (assetId === "asset-image-1") {
      const png = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lp7dNwAAAABJRU5ErkJggg==",
        "base64",
      );
      res.writeHead(200, { "content-type": "image/png", "cache-control": "no-store" });
      return res.end(png);
    }
    res.writeHead(200, { "content-type": "video/mp4", "cache-control": "no-store" });
    return res.end(Buffer.from([0, 0, 0, 24, 102, 116, 121, 112, 109, 112, 52, 50]));
  }

  return sendJson(res, 404, { ok: false, error: `Unhandled ${url.pathname}` });
});

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`fake-vault-worker listening on ${port}\n`);
});
