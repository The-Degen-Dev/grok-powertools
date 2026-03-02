import type { Collection, VideoItem } from "./types";

/**
 * Compact representation for sharing — only essential fields.
 */
interface SharedCollection {
  n: string; // name
  i: SharedItem[]; // items
}

interface SharedItem {
  g: string; // grokPostId
  v: string; // videoUrl
  t: string; // thumbnailUrl
  p: string; // promptText
  s: string; // sourceUrl
}

/**
 * Compress a collection into a URL-safe share string.
 * Uses JSON + base64url encoding (no external compression library needed).
 */
export function encodeShareData(collection: Collection): string {
  const compact: SharedCollection = {
    n: collection.name,
    i: collection.items.map((item) => ({
      g: item.grokPostId,
      v: item.videoUrl,
      t: item.thumbnailUrl,
      p: item.promptText,
      s: item.sourceUrl,
    })),
  };

  const json = JSON.stringify(compact);
  // Use base64url encoding (URL-safe variant)
  const encoded = btoa(json)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return encoded;
}

/**
 * Decode a share string back into collection data.
 */
export function decodeShareData(
  encoded: string
): { name: string; items: VideoItem[] } | null {
  try {
    // Restore standard base64 from base64url
    let base64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
    // Add padding if needed
    while (base64.length % 4 !== 0) base64 += "=";

    const json = atob(base64);
    const compact: SharedCollection = JSON.parse(json);

    const items: VideoItem[] = compact.i.map((item, index) => ({
      id: crypto.randomUUID(),
      grokPostId: item.g,
      videoUrl: item.v,
      thumbnailUrl: item.t,
      promptText: item.p,
      sourceUrl: item.s,
      position: index,
      notes: "",
      createdAt: new Date().toISOString(),
    }));

    return { name: compact.n, items };
  } catch {
    return null;
  }
}

/**
 * Generate a full share URL for a collection.
 */
export function generateShareUrl(collection: Collection): string {
  const data = encodeShareData(collection);
  const base =
    typeof window !== "undefined"
      ? window.location.origin
      : "https://grokpowertools.com";
  return `${base}/share?d=${data}`;
}
