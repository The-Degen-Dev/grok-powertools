import { NextResponse } from "next/server";

function arraysMatch(left: unknown, right: unknown): boolean {
  return Array.isArray(left) && Array.isArray(right) && JSON.stringify(left) === JSON.stringify(right);
}

function asBodyRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function POST(request: Request) {
  const body = asBodyRecord(await request.json().catch(() => ({})));
  const plan = body.plan;
  const approvedPlanHash = body.approvedPlanHash;
  const approvedTargetCount = body.approvedTargetCount;
  const approvedWriteClasses = body.approvedWriteClasses;

  if (!isRecord(plan) || typeof plan.planHash !== "string" || typeof plan.planId !== "string") {
    return NextResponse.json({ ok: false, error: "REPAIR_PLAN_REQUIRED" }, { status: 400 });
  }
  if (approvedPlanHash !== plan.planHash) {
    return NextResponse.json({ ok: false, error: "REPAIR_PLAN_HASH_STALE" }, { status: 409 });
  }
  if (approvedTargetCount !== plan.targetCount) {
    return NextResponse.json({ ok: false, error: "REPAIR_TARGET_COUNT_CHANGED" }, { status: 409 });
  }
  if (!arraysMatch(approvedWriteClasses, plan.writeClasses)) {
    return NextResponse.json({ ok: false, error: "REPAIR_WRITE_CLASSES_CHANGED" }, { status: 409 });
  }

  return NextResponse.json({
    ok: true,
    run: {
      runId: `repair-run-${Date.now()}`,
      planId: plan.planId,
      planHash: plan.planHash,
      targetCount: plan.targetCount,
      writeClasses: plan.writeClasses,
      status: "approved",
      createdAt: new Date().toISOString(),
    },
  });
}
