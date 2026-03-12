import { NextRequest, NextResponse } from "next/server";

const GIH_BASE = "https://www.grokimaginehub.com";

// UUID pattern used in Grok Imagine
const UUID_PATTERN =
  /[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/gi;

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;

  // Mode 1: Fetch share page and extract UUIDs
  const shareId = searchParams.get("shareId");
  if (shareId) {
    return handleShareImport(shareId);
  }

  // Mode 2: Proxy prompt fetch from GIH
  const prompts = searchParams.get("prompts");
  if (prompts) {
    return handlePromptFetch(prompts);
  }

  return NextResponse.json({ error: "Missing shareId or prompts param" }, { status: 400 });
}

async function handleShareImport(shareId: string) {
  try {
    const res = await fetch(`${GIH_BASE}/s/${shareId}`, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; GrokPowerTools/1.0)",
        Accept: "text/html",
      },
    });

    if (!res.ok) {
      return NextResponse.json(
        { error: `GIH returned ${res.status}` },
        { status: res.status }
      );
    }

    const html = await res.text();

    // Extract collection name from <title>
    const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
    let name = "GIH Import";
    if (titleMatch) {
      // Title format: "CollectionName - Shared Grok Imagine Collection | GrokImagineHub"
      const raw = titleMatch[1];
      const dashIdx = raw.indexOf(" - ");
      if (dashIdx > 0) name = raw.slice(0, dashIdx).trim();
    }

    // Extract UUIDs from the RSC payload (self.__next_f.push() calls)
    // The UUIDs appear in an array within the streaming payload
    const allUuids = html.match(UUID_PATTERN) || [];
    // Deduplicate while preserving order
    const seen = new Set<string>();
    const uuids: string[] = [];
    for (const uuid of allUuids) {
      const lower = uuid.toLowerCase();
      if (!seen.has(lower)) {
        seen.add(lower);
        uuids.push(lower);
      }
    }

    return NextResponse.json({ name, uuids, count: uuids.length });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to fetch GIH share" },
      { status: 500 }
    );
  }
}

async function handlePromptFetch(uuidsCsv: string) {
  try {
    const res = await fetch(
      `${GIH_BASE}/api/prompts?uuids=${encodeURIComponent(uuidsCsv)}`,
      {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; GrokPowerTools/1.0)",
          Accept: "application/json",
        },
      }
    );

    if (!res.ok) {
      return NextResponse.json(
        { error: `GIH prompts API returned ${res.status}` },
        { status: res.status }
      );
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to fetch prompts" },
      { status: 500 }
    );
  }
}
