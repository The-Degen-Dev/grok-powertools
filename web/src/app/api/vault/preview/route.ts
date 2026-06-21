import { NextResponse } from "next/server";
import { loadVaultPreviewFromWorker } from "@/lib/vault-preview-server";

export async function GET() {
  return NextResponse.json(await loadVaultPreviewFromWorker());
}
