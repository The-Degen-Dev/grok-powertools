"use client";

import type { OpsSnapshot } from "./types";

const OPS_SNAPSHOT_KEY = "grok-power-tools:ops-snapshot";

export function buildEmptyOpsSnapshot(): OpsSnapshot {
  return {
    schemaVersion: 1,
    importedAt: new Date().toISOString(),
    worker: {
      status: "unproven",
      workerUrlConfigured: false,
      workerReachable: false,
      checkedAt: new Date().toISOString(),
      message: "No diagnostic import loaded",
    },
    r2: {
      bytesVerifiedExisting: 0,
      bytesUploadedNew: 0,
      duplicateUploadsSkipped: 0,
      metadataSnapshotsSkippedUnchanged: 0,
      conflictsDetected: 0,
    },
    rows: [],
    events: [],
  };
}

export function loadOpsSnapshot(): OpsSnapshot {
  if (typeof window === "undefined") return buildEmptyOpsSnapshot();

  const raw = window.localStorage.getItem(OPS_SNAPSHOT_KEY);
  if (!raw) return buildEmptyOpsSnapshot();

  try {
    const parsed = JSON.parse(raw) as OpsSnapshot;
    if (parsed.schemaVersion !== 1) return buildEmptyOpsSnapshot();
    return parsed;
  } catch {
    return buildEmptyOpsSnapshot();
  }
}

export function saveOpsSnapshot(snapshot: OpsSnapshot): void {
  window.localStorage.setItem(OPS_SNAPSHOT_KEY, JSON.stringify(snapshot));
}

export function clearOpsSnapshot(): void {
  window.localStorage.removeItem(OPS_SNAPSHOT_KEY);
}
