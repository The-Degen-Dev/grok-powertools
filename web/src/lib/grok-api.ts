import type { VideoItem } from "./types";

// Grok share URLs use UUIDs: https://x.com/i/grok/share/{uuid}
const GROK_IMAGINE_URL_PATTERN =
  /https?:\/\/(?:x\.com|grok\.com)\/(?:i\/)?grok\/share\/([a-zA-Z0-9_-]+)/i;

// Grok post URLs: https://grok.com/imagine/post/{uuid}
const GROK_POST_URL_PATTERN =
  /https?:\/\/grok\.com\/imagine\/post\/([a-zA-Z0-9_-]+)/i;

/**
 * Parse a line of text and extract a Grok Imagine post UUID.
 * Supports:
 * - https://x.com/i/grok/share/{uuid}
 * - https://grok.com/imagine/post/{uuid}
 * - bare UUID
 */
export function parseGrokLink(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  // Try share URL format
  const shareMatch = trimmed.match(GROK_IMAGINE_URL_PATTERN);
  if (shareMatch) return shareMatch[1];

  // Try direct post URL format
  const postMatch = trimmed.match(GROK_POST_URL_PATTERN);
  if (postMatch) return postMatch[1];

  // Try bare UUID (with dashes)
  const uuidMatch = trimmed.match(
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
  );
  if (uuidMatch) return uuidMatch[0];

  // Try bare alphanumeric ID (Grok short IDs)
  const shortIdMatch = trimmed.match(/^[a-zA-Z0-9_-]{10,}$/);
  if (shortIdMatch) return shortIdMatch[0];

  return null;
}

/**
 * Parse multiple lines of text and return unique Grok post IDs.
 */
export function parseGrokLinks(text: string): string[] {
  const lines = text.split("\n");
  const ids = new Set<string>();

  for (const line of lines) {
    const id = parseGrokLink(line);
    if (id) ids.add(id);
  }

  return Array.from(ids);
}

/**
 * Construct URLs for a Grok Imagine post by UUID.
 */
export function buildGrokUrls(postId: string) {
  return {
    postUrl: `https://grok.com/imagine/post/${postId}`,
    shareUrl: `https://x.com/i/grok/share/${postId}`,
    // Video and image URLs follow predictable CDN patterns
    // The actual media URLs need to be fetched from the page or API
  };
}

/**
 * Fetch metadata for a Grok Imagine post.
 * This fetches the public share page and extracts video URL + prompt from the HTML.
 */
export async function fetchVideoMetadata(
  postId: string
): Promise<Partial<VideoItem> | null> {
  try {
    // Use our API route to proxy the fetch (avoid CORS)
    const res = await fetch(`/api/video-meta?id=${postId}`);
    if (!res.ok) return null;
    const data = await res.json();
    return {
      grokPostId: postId,
      sourceUrl: buildGrokUrls(postId).shareUrl,
      videoUrl: data.videoUrl || "",
      thumbnailUrl: data.thumbnailUrl || "",
      promptText: data.promptText || "",
      notes: "",
    };
  } catch {
    // Fallback: construct URLs from known patterns
    return {
      grokPostId: postId,
      sourceUrl: buildGrokUrls(postId).shareUrl,
      videoUrl: "",
      thumbnailUrl: "",
      promptText: "",
      notes: "",
    };
  }
}

/**
 * Batch fetch metadata for multiple post IDs.
 * Fetches in parallel with concurrency limit.
 */
export async function batchFetchMetadata(
  postIds: string[],
  concurrency: number = 5
): Promise<Map<string, Partial<VideoItem>>> {
  const results = new Map<string, Partial<VideoItem>>();
  const queue = [...postIds];

  async function processNext(): Promise<void> {
    while (queue.length > 0) {
      const id = queue.shift()!;
      const meta = await fetchVideoMetadata(id);
      if (meta) results.set(id, meta);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, () =>
    processNext()
  );
  await Promise.all(workers);

  return results;
}
