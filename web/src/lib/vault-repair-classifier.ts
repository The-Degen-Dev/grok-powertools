import type { RepairIdentityScope, RepairIssue, SourceProof } from "@/lib/vault-repair-types";
import type { loadVaultPreviewFromWorker } from "@/lib/vault-preview-server";
import type { VaultWorkerIdentity } from "@/lib/vault-types";

type VaultPreviewScan = Awaited<ReturnType<typeof loadVaultPreviewFromWorker>>;
type VaultGapWithObjectKey = VaultPreviewScan["gaps"][number];

function observedAt(): string {
  return new Date().toISOString();
}

function gapProof(gap: VaultGapWithObjectKey): SourceProof {
  return {
    kind: "worker_gap",
    label: `Worker gap ${gap.id}`,
    objectKey: typeof gap.objectKey === "string" && gap.objectKey.trim() !== "" ? gap.objectKey : undefined,
    observedAt: observedAt(),
  };
}

function classifyGap(gap: VaultGapWithObjectKey): RepairIssue {
  if (gap.requiresLiveGrok) {
    return {
      issueId: `repair-${gap.id}`,
      assetId: gap.assetId,
      blockedReason: "LIVE_GROK_RUNBOOK_ONLY",
      issueType: "live_grok_required",
      riskTier: "T4",
      sourceProof: [gapProof(gap)],
      writeClass: "live_grok_runbook",
    };
  }

  if (gap.requiresCloudWrite || gap.code === "index-drift") {
    return {
      issueId: `repair-${gap.id}`,
      assetId: gap.assetId,
      issueType: "index_drift",
      riskTier: "T1",
      sourceProof: [gapProof(gap)],
      writeClass: "d1_index",
    };
  }

  return {
    issueId: `repair-${gap.id}`,
    assetId: gap.assetId,
    issueType: "scan_warning",
    riskTier: "T0",
    sourceProof: [gapProof(gap)],
    writeClass: "none",
  };
}

function warningIssue(warning: string, index: number): RepairIssue {
  return {
    issueId: `repair-scan-warning-${index + 1}`,
    issueType: "scan_warning",
    riskTier: "T0",
    sourceProof: [
      {
        kind: "scan_warning",
        label: warning,
        observedAt: observedAt(),
      },
    ],
    writeClass: "none",
  };
}

function identityScopeFromWorker(identity: VaultWorkerIdentity): RepairIdentityScope {
  return {
    workerHost: identity.workerHost,
    keyPrefix: identity.keyPrefix,
    bucketName: identity.r2?.bucketName,
    apiKeyFingerprint: identity.apiKeyFingerprint,
  };
}

export function classifyVaultRepairScan(preview: VaultPreviewScan) {
  const issues = [...preview.gaps.map(classifyGap), ...preview.warnings.map(warningIssue)];

  if (preview.scanTruncated) {
    issues.push({
      issueId: "repair-scan-truncated",
      blockedReason: "REPAIR_SCAN_TRUNCATED",
      issueType: "scan_warning",
      riskTier: "T0",
      sourceProof: [
        {
          kind: "scan_warning",
          label: "Inventory pagination did not complete. Planning is blocked until a full scan completes.",
          observedAt: observedAt(),
        },
      ],
      writeClass: "none",
    });
  }

  return {
    identityScope: identityScopeFromWorker(preview.identity),
    issues,
    summary: {
      totalIssues: issues.length,
      writableIssues: issues.filter((issue) => issue.writeClass !== "none" && !issue.blockedReason).length,
      blockedIssues: issues.filter((issue) => typeof issue.blockedReason === "string").length,
      readOnlyIssues: issues.filter((issue) => issue.writeClass === "none").length,
    },
  };
}
