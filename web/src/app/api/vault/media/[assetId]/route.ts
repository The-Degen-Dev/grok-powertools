import { getWorkerConfig } from "@/lib/vault-server";

const RANGE_FALLBACK_MAX_BYTES = 100 * 1024 * 1024;

function copyMediaHeaders(source: Headers) {
  const headers = new Headers();
  for (const name of ["content-type", "content-length", "content-range", "accept-ranges", "etag"]) {
    const value = source.get(name);
    if (value) headers.set(name, value);
  }
  headers.set("cache-control", "private, no-store");
  return headers;
}

function parseSingleByteRange(rangeHeader: string | null, total: number): { start: number; end: number } | null {
  const match = rangeHeader?.trim().match(/^bytes=(\d*)-(\d*)$/);
  if (!match || !Number.isFinite(total) || total <= 0) return null;
  const [, rawStart, rawEnd] = match;
  if (!rawStart && !rawEnd) return null;

  if (!rawStart) {
    const suffixLength = Number(rawEnd);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) return null;
    const start = Math.max(total - suffixLength, 0);
    return { start, end: total - 1 };
  }

  const start = Number(rawStart);
  const end = rawEnd ? Number(rawEnd) : total - 1;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start > end || start >= total) return null;
  return { start, end: Math.min(end, total - 1) };
}

export async function GET(request: Request, { params }: { params: Promise<{ assetId: string }> }) {
  const { assetId } = await params;
  const { workerUrl, apiKey } = getWorkerConfig();
  const requestUrl = new URL(request.url);
  const workerSearch = new URLSearchParams({ assetId });
  const objectKey = requestUrl.searchParams.get("objectKey");
  if (objectKey) workerSearch.set("objectKey", objectKey);
  const workerHeaders = new Headers({ "x-gpt-api-key": apiKey });
  const rangeHeader = request.headers.get("range");
  if (rangeHeader) workerHeaders.set("range", rangeHeader);
  const res = await fetch(`${workerUrl}/v1/vault/media?${workerSearch.toString()}`, {
    headers: workerHeaders,
    cache: "no-store",
  });

  if (!res.ok || !res.body) {
    return new Response("MEDIA_OBJECT_MISSING", { status: res.status || 404 });
  }

  const headers = copyMediaHeaders(res.headers);
  if (rangeHeader && res.status === 200 && !res.headers.get("content-range")) {
    const total = Number(res.headers.get("content-length") || 0);
    if (total > 0 && total <= RANGE_FALLBACK_MAX_BYTES) {
      const range = parseSingleByteRange(rangeHeader, total);
      if (range) {
        const body = await res.arrayBuffer();
        const chunk = body.slice(range.start, range.end + 1);
        headers.set("accept-ranges", "bytes");
        headers.set("content-length", String(chunk.byteLength));
        headers.set("content-range", `bytes ${range.start}-${range.end}/${total}`);
        return new Response(chunk, { status: 206, headers });
      }
    }
  }

  return new Response(res.body, { status: res.status, headers });
}
