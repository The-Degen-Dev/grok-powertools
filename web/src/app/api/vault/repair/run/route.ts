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
  const run = body.run;

  if (!isRecord(plan) || !isRecord(run) || run.status !== "approved") {
    return NextResponse.json({ ok: false, error: "REPAIR_APPROVAL_REQUIRED" }, { status: 409 });
  }
  if (run.planHash !== plan.planHash) {
    return NextResponse.json({ ok: false, error: "REPAIR_PLAN_HASH_STALE" }, { status: 409 });
  }
  if (run.targetCount !== plan.targetCount || !arraysMatch(run.writeClasses, plan.writeClasses)) {
    return NextResponse.json({ ok: false, error: "REPAIR_APPROVAL_STALE" }, { status: 409 });
  }
  if (Array.isArray(plan.writeClasses) && plan.writeClasses.some((writeClass: string) => writeClass !== "none")) {
    return NextResponse.json({ ok: false, error: "REPAIR_WRITE_NOT_ARMED" }, { status: 409 });
  }

  return NextResponse.json({
    ok: true,
    run: {
      ...run,
      status: "succeeded",
      resultCounts: { succeeded: 0, skipped: 0, conflicted: 0, failed: 0 },
    },
  });
}
