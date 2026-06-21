import { NextResponse } from "next/server";
import { buildRepairPlan, parseRepairPlanRequest } from "@/lib/vault-repair-types";

export async function POST(request: Request) {
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ ok: false, error: "REPAIR_PLAN_INVALID_JSON" }, { status: 400 });
    }
    const parsed = parseRepairPlanRequest(body);
    const plan = await buildRepairPlan(parsed);
    return NextResponse.json({ ok: true, plan });
  } catch (error) {
    const message = error instanceof Error ? error.message : "REPAIR_PLAN_INVALID";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
