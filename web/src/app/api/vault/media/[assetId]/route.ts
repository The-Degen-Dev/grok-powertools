import { getWorkerConfig } from "@/lib/vault-server";

export async function GET(_request: Request, { params }: { params: Promise<{ assetId: string }> }) {
  const { assetId } = await params;
  const { workerUrl, apiKey } = getWorkerConfig();
  const res = await fetch(`${workerUrl}/v1/vault/media?assetId=${encodeURIComponent(assetId)}`, {
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
