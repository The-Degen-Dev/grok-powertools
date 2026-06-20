import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    { ok: false, error: "RECONCILE_INDEX_NOT_ARMED" },
    { status: 409 },
  );
}
