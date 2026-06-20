import { getWorkerConfig } from "@/lib/vault-server";

export async function GET(request: Request, { params }: { params: Promise<{ assetId: string }> }) {
  const { assetId } = await params;
  const { workerUrl, apiKey } = getWorkerConfig();
  const requestUrl = new URL(request.url);
  const workerSearch = new URLSearchParams({ assetId });
  const objectKey = requestUrl.searchParams.get("objectKey");
  if (objectKey) workerSearch.set("objectKey", objectKey);
  const res = await fetch(`${workerUrl}/v1/vault/media?${workerSearch.toString()}`, {
    headers: { "x-gpt-api-key": apiKey },
    cache: "no-store",
  });

  if (!res.ok || !res.body) {
    return new Response("MEDIA_OBJECT_MISSING", { status: res.status || 404 });
  }

  const headers = new Headers();
  const contentType = res.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);
  headers.set("cache-control", "private, no-store");
  return new Response(res.body, { status: 200, headers });
}
