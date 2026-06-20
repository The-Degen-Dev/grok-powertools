import { NextResponse } from "next/server";
import { workerJson } from "@/lib/vault-server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const workerPath = `/v1/vault/inventory${url.search}`;
  const data = await workerJson(workerPath);
  return NextResponse.json(data);
}
