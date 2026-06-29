import { NextResponse } from "next/server";
import { workerJson } from "@/lib/vault-server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  return NextResponse.json(await workerJson(`/v1/vault/gaps${url.search}`));
}
