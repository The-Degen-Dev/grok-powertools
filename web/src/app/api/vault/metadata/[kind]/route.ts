import { NextResponse } from "next/server";
import { workerJson } from "@/lib/vault-server";

export async function GET(_request: Request, { params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  const data = await workerJson(`/v1/vault/metadata/${encodeURIComponent(kind)}`);
  return NextResponse.json(data);
}
