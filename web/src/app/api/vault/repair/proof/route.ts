import { NextResponse } from "next/server";
import { getWorkerConfig } from "@/lib/vault-server";

function validObjectKey(objectKey: string): boolean {
  if (!objectKey || objectKey.length > 1024) return false;
  if (objectKey.includes("..")) return false;
  if (objectKey.startsWith("/")) return false;
  return true;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const objectKey = url.searchParams.get("objectKey") || "";
  if (!validObjectKey(objectKey)) {
    return NextResponse.json({ ok: false, error: "REPAIR_PROOF_OBJECT_KEY_INVALID" }, { status: 400 });
  }

  const { workerUrl, apiKey } = getWorkerConfig();
  const workerSearch = new URLSearchParams({ objectKey });
  const res = await fetch(`${workerUrl}/v1/objects/verify?${workerSearch.toString()}`, {
    method: "HEAD",
    cache: "no-store",
    headers: { "x-gpt-api-key": apiKey },
  });

  if (res.status === 404) {
    return NextResponse.json({ ok: true, exists: false, objectKey });
  }
  if (!res.ok) {
    return NextResponse.json({ ok: false, error: "REPAIR_PROOF_FAILED" }, { status: res.status });
  }

  const sizeBytes = Number(res.headers.get("x-r2-size-bytes") || 0);
  return NextResponse.json({
    ok: true,
    exists: true,
    objectKey,
    sizeBytes: Number.isFinite(sizeBytes) ? sizeBytes : 0,
    etag: res.headers.get("x-r2-etag") || undefined,
    sha256: res.headers.get("x-r2-sha256") || undefined,
    contentType: res.headers.get("content-type") || undefined,
  });
}
