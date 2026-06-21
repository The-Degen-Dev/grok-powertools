"use client";

import { useMemo, useState } from "react";
import Button from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { getDB } from "@/lib/local-storage";
import {
  approveVaultRepairPlan,
  createVaultRepairPlan,
  fetchVaultRepairScan,
  runVaultRepairPlan,
  type RepairRunRecord,
  type RepairScanResponse,
} from "@/lib/vault-client";
import type { RepairIssue, RepairPlan } from "@/lib/vault-repair-types";
import { putVaultRepairPlan, putVaultRepairRun, putVaultRepairScan } from "@/lib/vault-storage";

function badgeClass(value: string) {
  if (value === "T4") return "border-red-300 text-red-700 dark:border-red-900 dark:text-red-300";
  if (value === "T1" || value === "d1_index") {
    return "border-amber-300 text-amber-700 dark:border-amber-900 dark:text-amber-300";
  }
  return "border-(--color-surface-300) text-(--color-surface-600) dark:border-(--color-surface-700) dark:text-(--color-surface-300)";
}

function IssueRow({
  issue,
  selected,
  onSelectedChange,
}: {
  issue: RepairIssue;
  selected: boolean;
  onSelectedChange: (selected: boolean) => void;
}) {
  const disabled = !!issue.blockedReason || issue.writeClass === "none";
  const evidence = issue.blockedReason || issue.sourceProof[0]?.label || "No evidence";

  return (
    <tr className="border-t border-(--color-surface-200) dark:border-(--color-surface-800)">
      <td className="px-3 py-3 align-top">
        <input
          type="checkbox"
          aria-label={`Select ${issue.issueId}`}
          checked={selected}
          disabled={disabled}
          onChange={(event) => onSelectedChange(event.target.checked)}
        />
      </td>
      <td className="px-3 py-3 align-top">
        <div className="font-mono text-xs text-(--color-surface-900) dark:text-(--color-surface-100)">
          {issue.issueId}
        </div>
        <div className="mt-1 font-mono text-xs text-(--color-surface-500)">{issue.assetId || "scan-level"}</div>
      </td>
      <td className="px-3 py-3 align-top">
        <span className={`rounded border px-2 py-1 text-xs ${badgeClass(issue.riskTier)}`}>{issue.riskTier}</span>
      </td>
      <td className="px-3 py-3 align-top font-mono text-xs">{issue.issueType}</td>
      <td className="px-3 py-3 align-top">
        <span className={`rounded border px-2 py-1 text-xs ${badgeClass(issue.writeClass)}`}>{issue.writeClass}</span>
      </td>
      <td className="px-3 py-3 align-top text-sm text-(--color-surface-500)">{evidence}</td>
    </tr>
  );
}

export default function VaultRepairWorkbench() {
  const [scan, setScan] = useState<RepairScanResponse["scan"] | null>(null);
  const [selectedIssueIds, setSelectedIssueIds] = useState<Set<string>>(() => new Set());
  const [plan, setPlan] = useState<RepairPlan | null>(null);
  const [run, setRun] = useState<RepairRunRecord | null>(null);
  const [runError, setRunError] = useState("");
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const issues = useMemo(() => scan?.issues || [], [scan]);
  const selectedIssues = useMemo(
    () => issues.filter((issue) => selectedIssueIds.has(issue.issueId)),
    [issues, selectedIssueIds],
  );

  async function handleScan() {
    setLoading(true);
    try {
      const response = await fetchVaultRepairScan();
      setScan(response.scan);
      setSelectedIssueIds(new Set());
      setPlan(null);
      setRun(null);
      setRunError("");
      const db = await getDB();
      await putVaultRepairScan(
        db,
        {
          scanId: `repair-scan-${Date.now()}`,
          scannedAt: response.scan.scannedAt,
          identityScope: { ...response.scan.identityScope },
          summary: response.scan.summary,
        },
        response.scan.issues,
      );
      toast("Repair scan complete", "success");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Repair scan failed", "error");
    } finally {
      setLoading(false);
    }
  }

  async function handleCreatePlan() {
    if (!scan || selectedIssues.length === 0) return;
    try {
      const response = await createVaultRepairPlan({
        identityScope: scan.identityScope,
        issues,
        selectedIssueIds: selectedIssues.map((issue) => issue.issueId),
      });
      setPlan(response.plan);
      setRun(null);
      setRunError("");
      const db = await getDB();
      await putVaultRepairPlan(db, response.plan);
      toast("Repair plan created", "success");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Repair plan failed", "error");
    }
  }

  async function handleApprovePlan() {
    if (!plan) return;
    try {
      const response = await approveVaultRepairPlan({
        plan,
        approvedPlanHash: plan.planHash,
        approvedTargetCount: plan.targetCount,
        approvedWriteClasses: plan.writeClasses,
      });
      setRun(response.run);
      setRunError("");
      const db = await getDB();
      await putVaultRepairRun(db, response.run);
      toast("Repair plan approved", "success");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Repair approval failed", "error");
    }
  }

  async function handleRunPlan() {
    if (!plan || !run) return;
    try {
      const response = await runVaultRepairPlan({ plan, run });
      setRun(response.run);
      setRunError("");
      const db = await getDB();
      await putVaultRepairRun(db, response.run);
    } catch (error) {
      const message = error instanceof Error ? error.message : "REPAIR_RUN_FAILED";
      const blockedRunId = run.runId.endsWith("-blocked") ? run.runId : `${run.runId}-blocked`;
      const blockedRun: RepairRunRecord = { ...run, runId: blockedRunId, status: "blocked", error: message };
      setRun(blockedRun);
      setRunError(message);
      const db = await getDB();
      await putVaultRepairRun(db, blockedRun);
    }
  }

  function setIssueSelected(issueId: string, selected: boolean) {
    setSelectedIssueIds((current) => {
      const next = new Set(current);
      if (selected) {
        next.add(issueId);
      } else {
        next.delete(issueId);
      }
      return next;
    });
    setPlan(null);
    setRun(null);
    setRunError("");
  }

  return (
    <section className="mt-6 rounded-(--radius-card) border border-(--color-surface-200) bg-(--color-surface-0) p-4 dark:border-(--color-surface-800) dark:bg-(--color-surface-900)">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-sm font-semibold">Repair Workbench</h2>
        <Button variant="secondary" onClick={handleScan} disabled={loading}>
          {loading ? "Scanning..." : "Scan for Repair Issues"}
        </Button>
      </div>

      {scan && (
        <div className="mt-4 grid gap-3 sm:grid-cols-4">
          <div className="rounded border border-(--color-surface-200) p-3 dark:border-(--color-surface-800)">
            <div className="text-xs text-(--color-surface-500)">Issues</div>
            <div className="text-lg font-semibold">{scan.summary.totalIssues} issues</div>
          </div>
          <div className="rounded border border-(--color-surface-200) p-3 dark:border-(--color-surface-800)">
            <div className="text-xs text-(--color-surface-500)">Writable</div>
            <div className="text-lg font-semibold">{scan.summary.writableIssues} writable</div>
          </div>
          <div className="rounded border border-(--color-surface-200) p-3 dark:border-(--color-surface-800)">
            <div className="text-xs text-(--color-surface-500)">Blocked</div>
            <div className="text-lg font-semibold">{scan.summary.blockedIssues} blocked</div>
          </div>
          <div className="rounded border border-(--color-surface-200) p-3 dark:border-(--color-surface-800)">
            <div className="text-xs text-(--color-surface-500)">Selected</div>
            <div className="text-lg font-semibold">{selectedIssues.length} selected</div>
          </div>
        </div>
      )}

      {issues.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="text-xs uppercase text-(--color-surface-500)">
              <tr>
                <th className="px-3 py-2" scope="col">
                  Select
                </th>
                <th className="px-3 py-2" scope="col">
                  Issue
                </th>
                <th className="px-3 py-2" scope="col">
                  Tier
                </th>
                <th className="px-3 py-2" scope="col">
                  Type
                </th>
                <th className="px-3 py-2" scope="col">
                  Write class
                </th>
                <th className="px-3 py-2" scope="col">
                  Evidence
                </th>
              </tr>
            </thead>
            <tbody>
              {issues.map((issue) => (
                <IssueRow
                  key={issue.issueId}
                  issue={issue}
                  selected={selectedIssueIds.has(issue.issueId)}
                  onSelectedChange={(selected) => setIssueSelected(issue.issueId, selected)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {scan && (
        <div className="mt-4 flex flex-col gap-3 rounded border border-(--color-surface-200) p-3 dark:border-(--color-surface-800)">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-sm font-medium">Plan Builder</div>
              <div className="text-xs text-(--color-surface-500)">
                {selectedIssues.length} selected issue{selectedIssues.length === 1 ? "" : "s"}
              </div>
            </div>
            <Button variant="primary" onClick={handleCreatePlan} disabled={selectedIssues.length === 0}>
              Create Repair Plan
            </Button>
          </div>

          {plan && (
            <div className="rounded bg-(--color-surface-50) p-3 text-sm dark:bg-(--color-surface-950)">
              <div>
                Plan hash: <span className="font-mono">{plan.planHash.slice(0, 16)}</span>
              </div>
              <div>
                {plan.targetCount} target{plan.targetCount === 1 ? "" : "s"}: {plan.writeClasses.join(", ")}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button variant="secondary" onClick={handleApprovePlan}>
                  Approve Exact Plan
                </Button>
                <Button variant="primary" onClick={handleRunPlan} disabled={run?.status !== "approved"}>
                  Run Approved Repair
                </Button>
              </div>
              {run && <div className="mt-2 text-sm">Approved</div>}
              {runError && <div className="mt-2 text-sm text-red-600 dark:text-red-300">{runError}</div>}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
