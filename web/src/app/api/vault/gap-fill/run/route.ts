import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    { ok: false, error: "LIVE_GROK_REPAIR_NOT_ARMED" },
    { status: 409 },
  );
}
