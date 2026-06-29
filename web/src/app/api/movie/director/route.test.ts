import { afterEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "./route";

const envKeys = ["MOVIE_DIRECTOR_BASE_URL", "MOVIE_DIRECTOR_API_KEY", "MOVIE_DIRECTOR_MODEL", "CLIPROXYAPI_BASE_URL", "CLIPROXYAPI_API_KEY", "CLIPROXYAPI_MODEL"] as const;

function clearDirectorEnv() {
  for (const key of envKeys) delete process.env[key];
}

function project() {
  return {
    schemaVersion: 1,
    id: "project-a",
    movieId: "movie-a",
    title: "Movie",
    mode: "review",
    candidates: [
      {
        id: "a",
        sourceAssetId: "a",
        mediaType: "video",
        mediaRef: { type: "vault", assetId: "a" },
        videoUrl: "/api/vault/media/a",
        position: 0,
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
      },
    ],
    committedClips: [],
    activeIndex: 0,
    masterVolume: 1,
    masterMuted: false,
    createdAt: "2026-06-28T00:00:00.000Z",
    updatedAt: "2026-06-28T00:00:00.000Z",
  };
}

describe("movie director route", () => {
  afterEach(() => {
    clearDirectorEnv();
    vi.unstubAllGlobals();
  });

  it("reports configured status without exposing the API key", async () => {
    process.env.MOVIE_DIRECTOR_BASE_URL = "http://127.0.0.1:8317/v1";
    process.env.MOVIE_DIRECTOR_API_KEY = "test-secret";
    process.env.MOVIE_DIRECTOR_MODEL = "test-model";

    const response = await GET();
    const body = await response.json();

    expect(body).toEqual({ configured: true, model: "test-model" });
    expect(JSON.stringify(body)).not.toContain("test-secret");
  });

  it("fails closed when provider credentials are not configured", async () => {
    clearDirectorEnv();

    const response = await POST(new Request("http://localhost/api/movie/director", { method: "POST", body: "{}" }));
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toEqual({ error: "MOVIE_DIRECTOR_NOT_CONFIGURED" });
  });

  it("returns a typed 400 when JSON is not a project object", async () => {
    process.env.MOVIE_DIRECTOR_BASE_URL = "http://127.0.0.1:8317/v1";
    process.env.MOVIE_DIRECTOR_API_KEY = "test-secret";
    process.env.MOVIE_DIRECTOR_MODEL = "test-model";

    const response = await POST(new Request("http://localhost/api/movie/director", { method: "POST", body: "null" }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ error: "MOVIE_DIRECTOR_INVALID_PROJECT" });
  });

  it("normalizes provider network failures", async () => {
    process.env.MOVIE_DIRECTOR_BASE_URL = "http://127.0.0.1:8317/v1";
    process.env.MOVIE_DIRECTOR_API_KEY = "test-secret";
    process.env.MOVIE_DIRECTOR_MODEL = "test-model";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("socket closed");
      }),
    );

    const response = await POST(
      new Request("http://localhost/api/movie/director", {
        method: "POST",
        body: JSON.stringify({ project: project() }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body).toEqual({ error: "MOVIE_DIRECTOR_PROVIDER_FAILED" });
  });

  it("calls an OpenAI-compatible chat completions endpoint without returning secrets", async () => {
    process.env.MOVIE_DIRECTOR_BASE_URL = "http://127.0.0.1:8317/v1";
    process.env.MOVIE_DIRECTOR_API_KEY = "test-secret";
    process.env.MOVIE_DIRECTOR_MODEL = "test-model";
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  title: "Keep first",
                  rationale: "Start with the first candidate.",
                  changes: [{ id: "keep-a", type: "keep", clipId: "a", rationale: "Strong opener." }],
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      new Request("http://localhost/api/movie/director", {
        method: "POST",
        body: JSON.stringify({ project: project() }),
      }),
    );
    const body = await response.json();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const requestBody = JSON.parse(init.body as string);

    expect(url).toBe("http://127.0.0.1:8317/v1/chat/completions");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer test-secret");
    expect(requestBody).toMatchObject({
      model: "test-model",
      response_format: { type: "json_object" },
    });
    expect(requestBody.messages[0].role).toBe("system");
    expect(body.proposal).toMatchObject({ status: "pending", title: "Keep first" });
    expect(JSON.stringify(body)).not.toContain("test-secret");
  });
});
