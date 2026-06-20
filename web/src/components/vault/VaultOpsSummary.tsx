"use client";

import { useEffect, useState } from "react";
import { useSyncContext } from "@/components/auth/SyncProvider";
import { getDB, getSyncMeta } from "@/lib/local-storage";
import { getVaultAssets, getVaultGaps } from "@/lib/vault-storage";
import { fetchVaultPreview } from "@/lib/vault-client";
import type { OpsStatus } from "@/lib/types";
import type { SyncMeta } from "@/lib/types";
import type { VaultAsset, VaultGap, VaultImportRun, VaultPreview } from "@/lib/vault-types";

interface WorkerHealth {
  status?: OpsStatus;
  workerUrlConfigured?: boolean;
  workerReachable?: boolean;
  workerService?: string;
  checkedAt?: string;
  message?: string;
}

interface LocalProof {
  assets: VaultAsset[];
  gaps: VaultGap[];
  importRuns: VaultImportRun[];
  syncMeta?: SyncMeta;
}

function countLabel(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function statusLabel(value?: string) {
  return value || "blocked";
}

function formatDate(value?: string | null) {
  if (!value || value === new Date(0).toISOString()) return "never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "unknown";
  return date.toLocaleString();
}

function latestImport(runs: VaultImportRun[]) {
  return [...runs].sort((a, b) => new Date(b.importedAt).getTime() - new Date(a.importedAt).getTime())[0];
}

function ProofLine({ label, value }: { label: string; value: string }) {
  return (
    <div aria-label={`${label} ${value}`} className="flex justify-between gap-4">
      <dt className="text-(--color-surface-500)">{label}</dt>
      <dd className="text-right font-medium text-(--color-surface-800) dark:text-(--color-surface-100)">{value}</dd>
    </div>
  );
}

export default function VaultOpsSummary() {
  const { user, syncStatus, lastSyncAt } = useSyncContext();
  const [health, setHealth] = useState<WorkerHealth | null>(null);
  const [preview, setPreview] = useState<VaultPreview | null>(null);
  const [local, setLocal] = useState<LocalProof>({ assets: [], gaps: [], importRuns: [] });
  const [previewError, setPreviewError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const [healthResult, previewResult, localResult] = await Promise.allSettled([
        fetch("/api/ops/health", { cache: "no-store" }).then((res) => res.json() as Promise<WorkerHealth>),
        fetchVaultPreview(),
        getDB().then(async (db) => {
          const [assets, gaps, importRuns, syncMeta] = await Promise.all([
            getVaultAssets(db),
            getVaultGaps(db),
            db.getAll("vault_import_runs") as Promise<VaultImportRun[]>,
            getSyncMeta(),
          ]);
          return { assets, gaps, importRuns, syncMeta };
        }),
      ]);

      if (cancelled) return;

      setHealth(healthResult.status === "fulfilled" ? healthResult.value : {
        status: "blocked",
        workerUrlConfigured: false,
        workerReachable: false,
        message: "Worker health request failed",
      });

      if (previewResult.status === "fulfilled") {
        setPreview(previewResult.value);
        setPreviewError("");
      } else {
        setPreview(null);
        setPreviewError(previewResult.reason instanceof Error ? previewResult.reason.message : "Vault preview request failed");
      }

      setLocal(localResult.status === "fulfilled" ? localResult.value : { assets: [], gaps: [], importRuns: [] });
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const importRun = latestImport(local.importRuns);
  const workerIdentity = preview?.identity || {};
  const workerService = health?.workerService || String(workerIdentity.service || "unknown");
  const workerHost = String(workerIdentity.workerHost || "unknown");
  const keyPrefix = String(workerIdentity.keyPrefix || "unknown");
  const healthStatus = statusLabel(health?.status);
  const previewStatus = preview ? countLabel(preview.counts.assets, "asset") : `blocked: ${previewError || "no preview"}`;
  const metadataProof = preview ? countLabel(preview.counts.prompts, "prompt") : "blocked";
  const authStatus = user ? "signed in" : "signed out";
  const syncAt = lastSyncAt || local.syncMeta?.lastSyncAt;
  const pushAt = local.syncMeta?.lastPushAt;

  return (
    <section className="mt-6 rounded-(--radius-card) border border-(--color-surface-200) bg-(--color-surface-0) p-4 dark:border-(--color-surface-800) dark:bg-(--color-surface-900)">
      <h2 className="text-sm font-semibold">Vault Ops Proof</h2>
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <dl className="space-y-2 text-sm">
          <ProofLine label="Worker service" value={workerService} />
          <ProofLine label="Health endpoint" value={healthStatus} />
          <ProofLine label="Worker host" value={workerHost} />
          <ProofLine label="Key prefix" value={keyPrefix} />
        </dl>
        <dl className="space-y-2 text-sm">
          <ProofLine label="R2 preview" value={previewStatus} />
          <ProofLine label="R2 media mix" value={`${preview?.counts.images ?? 0} images, ${preview?.counts.videos ?? 0} videos`} />
          <ProofLine label="Committed locally" value={countLabel(local.assets.length, "asset")} />
          <ProofLine label="Metadata proof" value={metadataProof} />
        </dl>
        <dl className="space-y-2 text-sm">
          <ProofLine label="Latest import" value={importRun?.status || "blocked"} />
          <ProofLine label="Open gaps" value={countLabel(local.gaps.length, "gap")} />
          <ProofLine label="Owner mode" value="local IndexedDB" />
          <ProofLine label="Auth" value={authStatus} />
          <ProofLine label="Sync status" value={user ? syncStatus : "local only"} />
          <ProofLine label="Last sync" value={formatDate(syncAt)} />
          <ProofLine label="Last push" value={formatDate(pushAt)} />
        </dl>
      </div>
      <p className="mt-4 text-xs text-(--color-surface-500)">Worker health is not object proof. Vault proof comes from inventory rows, metadata routes, committed IndexedDB rows, and media routes.</p>
    </section>
  );
}
