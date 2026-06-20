import { NextResponse } from "next/server";
import { workerJson } from "@/lib/vault-server";

export async function GET() {
  return NextResponse.json(await workerJson("/v1/vault/gaps"));
}
