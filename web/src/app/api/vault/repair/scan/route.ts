import { NextResponse } from "next/server";
import { classifyVaultRepairScan } from "@/lib/vault-repair-classifier";
import { loadVaultPreviewFromWorker } from "@/lib/vault-preview-server";

export async function POST() {
  const preview = await loadVaultPreviewFromWorker();
  return NextResponse.json({
    ok: true,
    scan: {
      scannedAt: new Date().toISOString(),
      ...classifyVaultRepairScan(preview),
    },
  });
}
