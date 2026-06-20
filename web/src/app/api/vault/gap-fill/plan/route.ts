import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const assetIds: string[] = Array.isArray(body.assetIds)
    ? body.assetIds.filter((assetId: unknown): assetId is string => typeof assetId === "string")
    : [];
  return NextResponse.json({
    ok: true,
    plan: {
      assetIds,
      requiresLiveGrok: true,
      requiresCloudWrite: false,
      actions: assetIds.map((assetId) => ({
        assetId,
        action: "inspect-grok-post",
        status: "planned",
      })),
    },
  });
}
