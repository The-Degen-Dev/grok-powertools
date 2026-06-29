import { NextResponse } from "next/server";
import { parseDirectorProviderPayload } from "../../../../lib/movie-director";
import { movieReviewProjectSchema } from "../../../../lib/movie-review-types";

function directorConfig() {
  return {
    baseUrl: process.env.MOVIE_DIRECTOR_BASE_URL || process.env.CLIPROXYAPI_BASE_URL || "",
    apiKey: process.env.MOVIE_DIRECTOR_API_KEY || process.env.CLIPROXYAPI_API_KEY || "",
    model: process.env.MOVIE_DIRECTOR_MODEL || process.env.CLIPROXYAPI_MODEL || "",
  };
}

export async function GET() {
  const config = directorConfig();
  return NextResponse.json({ configured: Boolean(config.baseUrl && config.apiKey && config.model), model: config.model || null });
}

export async function POST(request: Request) {
  const config = directorConfig();
  if (!config.baseUrl || !config.apiKey || !config.model) {
    return NextResponse.json({ error: "MOVIE_DIRECTOR_NOT_CONFIGURED" }, { status: 503 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "MOVIE_DIRECTOR_INVALID_JSON" }, { status: 400 });
  }

  const projectBody = typeof body === "object" && body !== null ? (body as { project?: unknown }).project : undefined;
  const project = movieReviewProjectSchema.safeParse(projectBody);
  if (!project.success) {
    return NextResponse.json({ error: "MOVIE_DIRECTOR_INVALID_PROJECT" }, { status: 400 });
  }
  let response: Response;
  try {
    response = await fetch(`${config.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          {
            role: "system",
            content:
              "Return strict JSON with title, rationale, and changes. Valid change types are keep, reject, reorder, and trim. Do not claim edits were applied.",
          },
          { role: "user", content: JSON.stringify({ project: project.data }) },
        ],
        response_format: { type: "json_object" },
      }),
    });
  } catch {
    return NextResponse.json({ error: "MOVIE_DIRECTOR_PROVIDER_FAILED" }, { status: 502 });
  }
  if (!response.ok) {
    return NextResponse.json({ error: "MOVIE_DIRECTOR_PROVIDER_FAILED" }, { status: 502 });
  }

  try {
    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    const parsedContent = typeof content === "string" ? JSON.parse(content) : content;
    const proposal = parseDirectorProviderPayload(parsedContent, project.data);
    return NextResponse.json({ proposal });
  } catch {
    return NextResponse.json({ error: "MOVIE_DIRECTOR_INVALID_PROVIDER_RESPONSE" }, { status: 502 });
  }
}
