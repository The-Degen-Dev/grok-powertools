import { NextResponse } from "next/server";

export async function GET() {
  const checkedAt = new Date().toISOString();
  const workerUrl = process.env.WORKER_URL || "";
  const workerApiKey = process.env.WORKER_API_KEY || process.env.CLIENT_API_KEY || "";

  if (!workerUrl) {
    return NextResponse.json({
      status: "blocked",
      checkedAt,
      workerUrlConfigured: false,
      workerReachable: false,
      message: "WORKER_URL is not configured",
    });
  }

  try {
    const res = await fetch(`${workerUrl.replace(/\/+$/, "")}/health`, {
      method: "GET",
      cache: "no-store",
    });
    const data = await res.json().catch(() => ({}));

    let diagnostics: unknown = null;
    if (res.ok && workerApiKey) {
      const diagRes = await fetch(`${workerUrl.replace(/\/+$/, "")}/v1/diagnostics`, {
        method: "GET",
        headers: { "x-gpt-api-key": workerApiKey },
        cache: "no-store",
      }).catch(() => null);
      if (diagRes?.ok) diagnostics = await diagRes.json().catch(() => null);
    }

    return NextResponse.json({
      status: res.ok ? "verified" : "degraded",
      checkedAt,
      workerUrlConfigured: true,
      workerReachable: res.ok,
      workerService: typeof data.service === "string" ? data.service : undefined,
      diagnostics,
      message: res.ok ? "Worker health endpoint is reachable" : `Worker health returned ${res.status}`,
    });
  } catch {
    return NextResponse.json({
      status: "blocked",
      checkedAt,
      workerUrlConfigured: true,
      workerReachable: false,
      message: "Worker health request failed",
    });
  }
}
