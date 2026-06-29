import { NextResponse } from "next/server";
import { loadVaultPreviewFromWorker } from "@/lib/vault-preview-server";

export async function GET(request: Request) {
  const source = new URL(request.url).searchParams.get("source");
  return NextResponse.json(await loadVaultPreviewFromWorker(source === "canonical" ? { source } : undefined));
}
