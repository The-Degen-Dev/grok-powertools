import { NextResponse } from "next/server";
import { workerJson } from "@/lib/vault-server";

export async function GET() {
  try {
    const data = await workerJson<Record<string, unknown>>("/v1/vault/identity");
    return NextResponse.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : "VAULT_IDENTITY_FAILED";
    return NextResponse.json(
      {
        ok: false,
        status: "blocked",
        message,
      },
      { status: message.endsWith("_MISSING") ? 200 : 502 },
    );
  }
}
