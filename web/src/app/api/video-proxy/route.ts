import { NextResponse } from "next/server";

const MAX_SIZE = 50 * 1024 * 1024; // 50MB limit

// Cache fetched videos in memory for range request support
const videoCache = new Map<string, { buffer: ArrayBuffer; contentType: string }>();

async function getVideo(videoUrl: string) {
  const cached = videoCache.get(videoUrl);
  if (cached) return cached;

  const resp = await fetch(videoUrl);
  if (!resp.ok) throw new Error(`Upstream returned ${resp.status}`);

  const buffer = await resp.arrayBuffer();
  if (buffer.byteLength > MAX_SIZE) throw new Error("Video too large");

  const contentType = resp.headers.get("content-type") || "video/mp4";
  const entry = { buffer, contentType };
  videoCache.set(videoUrl, entry);

  // Evict after 5 minutes
  setTimeout(() => videoCache.delete(videoUrl), 5 * 60 * 1000);
  return entry;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const videoUrl = url.searchParams.get("url");

  if (!videoUrl) {
    return NextResponse.json({ error: "Missing url param" }, { status: 400 });
  }

  try {
    new URL(videoUrl);
  } catch {
    return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
  }

  try {
    const { buffer, contentType } = await getVideo(videoUrl);
    const total = buffer.byteLength;

    const rangeHeader = request.headers.get("range");
    if (rangeHeader) {
      const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
      if (match) {
        const start = parseInt(match[1], 10);
        const end = match[2] ? parseInt(match[2], 10) : total - 1;
        const chunk = buffer.slice(start, end + 1);

        return new NextResponse(chunk, {
          status: 206,
          headers: {
            "Content-Type": contentType,
            "Content-Length": String(chunk.byteLength),
            "Content-Range": `bytes ${start}-${end}/${total}`,
            "Accept-Ranges": "bytes",
            "Cross-Origin-Resource-Policy": "cross-origin",
            "Access-Control-Allow-Origin": "*",
          },
        });
      }
    }

    return new NextResponse(buffer, {
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(total),
        "Accept-Ranges": "bytes",
        "Cross-Origin-Resource-Policy": "cross-origin",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to fetch video";
    console.error("[video-proxy] error:", message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
