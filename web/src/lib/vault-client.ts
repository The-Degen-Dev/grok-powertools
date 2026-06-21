import { parseVaultPreview } from "./vault-types";
import type { RepairIdentityScope, RepairIssue, RepairPlan, RepairWriteClass } from "./vault-repair-types";

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, cache: "no-store" });
  const data: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message =
      typeof data === "object" &&
      data !== null &&
      "error" in data &&
      typeof data.error === "string"
        ? data.error
        : `Request failed: ${res.status}`;
    throw new Error(message);
  }
  return data as T;
}

export function fetchVaultIdentity() {
  return json<Record<string, unknown>>("/api/vault/identity");
}

export async function fetchVaultPreview() {
  const data = await json<unknown>("/api/vault/preview");
  return parseVaultPreview(data).value;
}

export function fetchVaultGaps() {
  return json("/api/vault/gaps");
}

export interface RepairScanResponse {
  ok: true;
  scan: {
    scannedAt: string;
    identityScope: RepairIdentityScope;
    issues: RepairIssue[];
    summary: {
      totalIssues: number;
      writableIssues: number;
      blockedIssues: number;
      readOnlyIssues: number;
    };
  };
}

export function fetchVaultRepairScan() {
  return json<RepairScanResponse>("/api/vault/repair/scan", { method: "POST" });
}

export function createVaultRepairPlan(payload: {
  identityScope: RepairIdentityScope;
  issues: RepairIssue[];
  selectedIssueIds: string[];
}) {
  return json<{ ok: true; plan: RepairPlan }>("/api/vault/repair/plan", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export interface RepairRunRecord {
  runId: string;
  planId: string;
  planHash: string;
  targetCount: number;
  writeClasses: RepairWriteClass[];
  status: "approved" | "blocked" | "succeeded" | "failed";
  createdAt: string;
  error?: string;
  resultCounts?: {
    succeeded: number;
    skipped: number;
    conflicted: number;
    failed: number;
  };
}

export function approveVaultRepairPlan(payload: {
  plan: RepairPlan;
  approvedPlanHash: string;
  approvedTargetCount: number;
  approvedWriteClasses: RepairWriteClass[];
}) {
  return json<{ ok: true; run: RepairRunRecord }>("/api/vault/repair/approve", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function runVaultRepairPlan(payload: { plan: RepairPlan; run: RepairRunRecord }) {
  return json<{ ok: true; run: RepairRunRecord }>("/api/vault/repair/run", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}
