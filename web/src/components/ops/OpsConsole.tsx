"use client";

import { useEffect, useMemo, useState } from "react";
import { Activity, AlertTriangle, CheckCircle2, Cloud, Database, FileJson, RefreshCw, ShieldCheck, XCircle } from "lucide-react";
import Button from "@/components/ui/Button";
import type { OpsSnapshot, OpsStatus, WorkerDiagnostics } from "@/lib/types";
import { buildEmptyOpsSnapshot, clearOpsSnapshot, loadOpsSnapshot, saveOpsSnapshot } from "@/lib/ops-storage";
import VaultGapPanel from "@/components/vault/VaultGapPanel";
import VaultOpsSummary from "@/components/vault/VaultOpsSummary";

function statusClasses(status: OpsStatus) {
  if (status === "verified") return "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:ring-emerald-900";
  if (status === "degraded") return "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:ring-amber-900";
  if (status === "blocked") return "bg-red-50 text-red-700 ring-red-200 dark:bg-red-950/30 dark:text-red-300 dark:ring-red-900";
  return "bg-(--color-surface-100) text-(--color-surface-600) ring-(--color-surface-200) dark:bg-(--color-surface-900) dark:text-(--color-surface-300) dark:ring-(--color-surface-800)";
}

function StatusBadge({ status }: { status: OpsStatus }) {
  const Icon = status === "verified" ? CheckCircle2 : status === "blocked" ? XCircle : status === "degraded" ? AlertTriangle : Activity;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium ring-1 ${statusClasses(status)}`}>
      <Icon className="h-3.5 w-3.5" />
      {status}
    </span>
  );
}

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit++;
  }
  return `${size.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function normalizeSnapshot(input: unknown, worker: WorkerDiagnostics): OpsSnapshot {
  const data = (input && typeof input === "object" ? input : {}) as Partial<OpsSnapshot>;
  const empty = buildEmptyOpsSnapshot();
  return {
    schemaVersion: 1,
    importedAt: new Date().toISOString(),
    worker: data.worker || worker,
    runId: typeof data.runId === "string" ? data.runId : undefined,
    verdict: typeof data.verdict === "string" ? data.verdict as OpsSnapshot["verdict"] : undefined,
    laneId: typeof data.laneId === "string" ? data.laneId : undefined,
    r2: { ...empty.r2, ...(data.r2 || {}) },
    rows: Array.isArray(data.rows) ? data.rows : [],
    events: Array.isArray(data.events) ? data.events : [],
  };
}

export default function OpsConsole() {
  const [snapshot, setSnapshot] = useState<OpsSnapshot>(() => loadOpsSnapshot());
  const [worker, setWorker] = useState<WorkerDiagnostics>(() => loadOpsSnapshot().worker);
  const [importError, setImportError] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    refreshWorker();
  }, []);

  async function refreshWorker() {
    setRefreshing(true);
    try {
      const res = await fetch("/api/ops/health", { cache: "no-store" });
      const data = (await res.json()) as WorkerDiagnostics;
      const nextWorker = {
        status: data.status,
        workerUrlConfigured: data.workerUrlConfigured,
        workerReachable: data.workerReachable,
        workerService: data.workerService,
        checkedAt: data.checkedAt,
        message: data.message,
      };
      setWorker(nextWorker);
      setSnapshot((current) => ({ ...current, worker: nextWorker }));
    } finally {
      setRefreshing(false);
    }
  }

  async function handleImport(file: File | null) {
    if (!file) return;
    setImportError("");
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const next = normalizeSnapshot(parsed, worker);
      saveOpsSnapshot(next);
      setSnapshot(next);
      setWorker(next.worker);
    } catch {
      setImportError("Import failed");
    }
  }

  function handleClear() {
    clearOpsSnapshot();
    const empty = buildEmptyOpsSnapshot();
    setSnapshot({ ...empty, worker });
    setImportError("");
  }

  const statusCounts = useMemo(() => {
    return snapshot.rows.reduce(
      (acc, row) => {
        acc[row.status] += 1;
        return acc;
      },
      { verified: 0, degraded: 0, blocked: 0, unproven: 0 } as Record<OpsStatus, number>
    );
  }, [snapshot.rows]);

  return (
    <div className="mx-auto max-w-screen-2xl px-6 py-8">
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold text-(--color-surface-900) dark:text-(--color-surface-100)">
            Operations
          </h1>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <StatusBadge status={worker.status} />
            <span className="text-sm text-(--color-surface-500)">
              {worker.message || "No status message"}
            </span>
            {snapshot.runId && (
              <span className="text-sm text-(--color-surface-500)">
                Run {snapshot.runId}{snapshot.verdict ? `: ${snapshot.verdict}` : ""}
              </span>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-(--radius-btn) border border-(--color-surface-200) px-3 py-1.5 text-sm font-medium text-(--color-surface-700) hover:bg-(--color-surface-50) dark:border-(--color-surface-700) dark:text-(--color-surface-300) dark:hover:bg-(--color-surface-800)">
            <FileJson className="h-4 w-4" />
            Import
            <input type="file" accept="application/json,.json" className="sr-only" onChange={(event) => handleImport(event.target.files?.[0] || null)} />
          </label>
          <Button variant="secondary" onClick={refreshWorker} disabled={refreshing}>
            <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Button variant="ghost" onClick={handleClear}>Clear</Button>
        </div>
      </div>

      {importError && (
        <div className="mb-4 rounded-(--radius-card) border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
          {importError}
        </div>
      )}

      <VaultOpsSummary />
      <VaultGapPanel />

      <div className="grid gap-4 lg:grid-cols-4">
        <section className="rounded-(--radius-card) border border-(--color-surface-200) bg-(--color-surface-0) p-4 shadow-(--shadow-card) dark:border-(--color-surface-800) dark:bg-(--color-surface-900)">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-(--color-surface-700) dark:text-(--color-surface-200)">Worker</h2>
            <Cloud className="h-4 w-4 text-(--color-accent)" />
          </div>
          <StatusBadge status={worker.status} />
          <dl className="mt-4 space-y-2 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-(--color-surface-500)">Configured</dt>
              <dd>{worker.workerUrlConfigured ? "yes" : "no"}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-(--color-surface-500)">Reachable</dt>
              <dd>{worker.workerReachable ? "yes" : "no"}</dd>
            </div>
          </dl>
        </section>

        <section className="rounded-(--radius-card) border border-(--color-surface-200) bg-(--color-surface-0) p-4 shadow-(--shadow-card) dark:border-(--color-surface-800) dark:bg-(--color-surface-900)">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-(--color-surface-700) dark:text-(--color-surface-200)">R2 Dedupe</h2>
            <ShieldCheck className="h-4 w-4 text-(--color-accent)" />
          </div>
          <div className="text-2xl font-semibold">{snapshot.r2.duplicateUploadsSkipped}</div>
          <p className="mt-1 text-sm text-(--color-surface-500)">duplicates skipped</p>
        </section>

        <section className="rounded-(--radius-card) border border-(--color-surface-200) bg-(--color-surface-0) p-4 shadow-(--shadow-card) dark:border-(--color-surface-800) dark:bg-(--color-surface-900)">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-(--color-surface-700) dark:text-(--color-surface-200)">Storage</h2>
            <Database className="h-4 w-4 text-(--color-accent)" />
          </div>
          <div className="text-2xl font-semibold">{formatBytes(snapshot.r2.bytesUploadedNew)}</div>
          <p className="mt-1 text-sm text-(--color-surface-500)">new bytes uploaded</p>
        </section>

        <section className="rounded-(--radius-card) border border-(--color-surface-200) bg-(--color-surface-0) p-4 shadow-(--shadow-card) dark:border-(--color-surface-800) dark:bg-(--color-surface-900)">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-(--color-surface-700) dark:text-(--color-surface-200)">Conflicts</h2>
            <AlertTriangle className="h-4 w-4 text-(--color-accent)" />
          </div>
          <div className="text-2xl font-semibold">{snapshot.r2.conflictsDetected}</div>
          <p className="mt-1 text-sm text-(--color-surface-500)">canonical key conflicts</p>
        </section>
      </div>

      <section className="mt-6 rounded-(--radius-card) border border-(--color-surface-200) bg-(--color-surface-0) shadow-(--shadow-card) dark:border-(--color-surface-800) dark:bg-(--color-surface-900)">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-(--color-surface-200) px-4 py-3 dark:border-(--color-surface-800)">
          <h2 className="text-sm font-semibold text-(--color-surface-700) dark:text-(--color-surface-200)">Reconciliation</h2>
          <div className="flex flex-wrap gap-2 text-xs">
            {Object.entries(statusCounts).map(([status, count]) => (
              <span key={status} className="rounded-full bg-(--color-surface-100) px-2 py-1 text-(--color-surface-600) dark:bg-(--color-surface-800) dark:text-(--color-surface-300)">
                {status}: {count}
              </span>
            ))}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-(--color-surface-200) text-sm dark:divide-(--color-surface-800)">
            <thead className="bg-(--color-surface-50) dark:bg-(--color-surface-950)">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-(--color-surface-500)">Status</th>
                <th className="px-4 py-3 text-left font-medium text-(--color-surface-500)">Asset</th>
                <th className="px-4 py-3 text-left font-medium text-(--color-surface-500)">R2 Object</th>
                <th className="px-4 py-3 text-left font-medium text-(--color-surface-500)">Hash</th>
                <th className="px-4 py-3 text-left font-medium text-(--color-surface-500)">Blocker</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-(--color-surface-100) dark:divide-(--color-surface-800)">
              {snapshot.rows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-(--color-surface-500)">No reconciliation rows loaded</td>
                </tr>
              ) : (
                snapshot.rows.map((row) => (
                  <tr key={row.id}>
                    <td className="px-4 py-3"><StatusBadge status={row.status} /></td>
                    <td className="max-w-56 truncate px-4 py-3 font-mono text-xs">{row.assetId}</td>
                    <td className="max-w-96 truncate px-4 py-3 font-mono text-xs">{row.r2ObjectKey || "-"}</td>
                    <td className="max-w-48 truncate px-4 py-3 font-mono text-xs">{row.sha256 || row.sourceUrlHash || "-"}</td>
                    <td className="px-4 py-3">{row.blockerCode || "-"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
