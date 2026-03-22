import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";
import { SignJWT } from "jose";

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const workerUrl = process.env.WORKER_URL;
  const syncSecret = process.env.WORKER_SYNC_SECRET;
  if (!workerUrl || !syncSecret) {
    return NextResponse.json({ error: "Sync not configured" }, { status: 500 });
  }

  try {
    const secret = new TextEncoder().encode(syncSecret);
    const jwt = await new SignJWT({
      sub: session.user.id,
      email: session.user.email || "",
      name: session.user.name || "",
    })
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime("1h")
      .sign(secret);

    const url = new URL(request.url);
    const since = url.searchParams.get("since") || new Date(0).toISOString();

    const res = await fetch(
      `${workerUrl}/v1/sync/pull?since=${encodeURIComponent(since)}`,
      {
        headers: {
          Authorization: `Bearer ${jwt}`,
        },
      }
    );

    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err) {
    console.error("[sync/pull] error:", err);
    return NextResponse.json({ error: "Internal sync error" }, { status: 500 });
  }
}
