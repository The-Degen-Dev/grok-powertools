import { NextRequest, NextResponse } from "next/server";

/**
 * Proxy endpoint that fetches Grok Imagine post metadata.
 * This avoids CORS issues when the client fetches from grok.com.
 *
 * GET /api/video-meta?id={uuid}
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const postId = searchParams.get("id");

  if (!postId || !/^[a-f0-9-]{36}$/i.test(postId)) {
    return NextResponse.json({ error: "Invalid post ID" }, { status: 400 });
  }

  try {
    // Fetch the share page HTML to extract metadata
    const shareUrl = `https://x.com/i/grok/share/${postId}`;
    const res = await fetch(shareUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        Accept: "text/html",
      },
      redirect: "follow",
    });

    if (!res.ok) {
      return NextResponse.json(
        { error: "Failed to fetch post", status: res.status },
        { status: 502 }
      );
    }

    const html = await res.text();

    // Extract video URL from meta tags or embedded data
    const videoUrl = extractMetaContent(html, "og:video") ||
      extractMetaContent(html, "og:video:url") ||
      extractVideoFromHtml(html) ||
      "";

    const thumbnailUrl = extractMetaContent(html, "og:image") ||
      extractMetaContent(html, "twitter:image") ||
      "";

    const promptText = extractMetaContent(html, "og:description") ||
      extractMetaContent(html, "description") ||
      "";

    const title = extractMetaContent(html, "og:title") || "";

    return NextResponse.json({
      postId,
      videoUrl,
      thumbnailUrl,
      promptText,
      title,
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to fetch metadata" },
      { status: 500 }
    );
  }
}

function extractMetaContent(html: string, property: string): string {
  // Try property attribute
  const propRegex = new RegExp(
    `<meta[^>]*property=["'](?:og:)?${escapeRegex(property)}["'][^>]*content=["']([^"']+)["']`,
    "i"
  );
  const propMatch = html.match(propRegex);
  if (propMatch) return propMatch[1];

  // Try content before property
  const reverseRegex = new RegExp(
    `<meta[^>]*content=["']([^"']+)["'][^>]*property=["'](?:og:)?${escapeRegex(property)}["']`,
    "i"
  );
  const reverseMatch = html.match(reverseRegex);
  if (reverseMatch) return reverseMatch[1];

  // Try name attribute
  const nameRegex = new RegExp(
    `<meta[^>]*name=["']${escapeRegex(property)}["'][^>]*content=["']([^"']+)["']`,
    "i"
  );
  const nameMatch = html.match(nameRegex);
  if (nameMatch) return nameMatch[1];

  return "";
}

function extractVideoFromHtml(html: string): string {
  // Look for video source URLs in the HTML
  const videoSrcRegex = /https:\/\/imagine-public\.x\.ai\/[^"'\s]+\.mp4[^"'\s]*/i;
  const match = html.match(videoSrcRegex);
  return match ? match[0] : "";
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
