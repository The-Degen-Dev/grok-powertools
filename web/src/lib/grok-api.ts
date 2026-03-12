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

// GrokImagineHub share URL: https://www.grokimaginehub.com/s/{shareId}
const GIH_SHARE_PATTERN =
  /https?:\/\/(?:www\.)?grokimaginehub\.com\/s\/([a-zA-Z0-9_-]+)/i;

// Grok Imagine public CDN
const GROK_VIDEO_CDN = "https://imagine-public.x.ai/imagine-public/share-videos";

/**
 * Construct URLs for a Grok Imagine post by UUID.
 */
export function buildGrokUrls(postId: string) {
  return {
    postUrl: `https://grok.com/imagine/post/${postId}`,
    shareUrl: `https://x.com/i/grok/share/${postId}`,
    videoUrl: `${GROK_VIDEO_CDN}/${postId}.mp4?cache=1`,
  };
}

/**
 * Detect if text contains a GrokImagineHub share link.
 */
export function parseGihShareLink(text: string): string | null {
  const match = text.trim().match(GIH_SHARE_PATTERN);
  return match ? match[1] : null;
}

/**
 * Import a collection from a GrokImagineHub share link.
 * Fetches the share page to extract UUIDs, then fetches prompts from GIH API.
 */
export async function importFromGih(
  shareId: string,
  onProgress?: (loaded: number, total: number) => void
): Promise<{ name: string; items: Omit<VideoItem, "id" | "position" | "createdAt">[] }> {
  // Fetch the share page via our proxy to extract UUIDs from RSC payload
  const res = await fetch(`/api/gih-import?shareId=${shareId}`);
  if (!res.ok) throw new Error(`Failed to fetch GIH share: ${res.status}`);
  const { name, uuids } = (await res.json()) as { name: string; uuids: string[] };

  if (!uuids || uuids.length === 0) {
    throw new Error("No items found in GIH share link");
  }

  // Fetch prompts from GIH API in batches of 24
  const promptMap = new Map<string, string>();
  const batchSize = 24;
  for (let i = 0; i < uuids.length; i += batchSize) {
    const batch = uuids.slice(i, i + batchSize);
    try {
      const promptRes = await fetch(
        `/api/gih-import?prompts=${batch.join(",")}`
      );
      if (promptRes.ok) {
        const data = await promptRes.json();
        if (data.prompts) {
          for (const [uuid, info] of Object.entries(data.prompts)) {
            const p = info as { prompt?: string };
            if (p.prompt) promptMap.set(uuid, p.prompt);
          }
        }
      }
    } catch {
      // Continue without prompts for this batch
    }
    onProgress?.(Math.min(i + batchSize, uuids.length), uuids.length);
  }

  // Build items with CDN URLs and prompts
  const items: Omit<VideoItem, "id" | "position" | "createdAt">[] = uuids.map(
    (uuid) => ({
      grokPostId: uuid,
      sourceUrl: `https://grok.com/imagine/post/${uuid}`,
      videoUrl: `${GROK_VIDEO_CDN}/${uuid}.mp4?cache=1`,
      thumbnailUrl: "",
      promptText: promptMap.get(uuid) || "",
      notes: "",
    })
  );

  return { name: name || "GIH Import", items };
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
