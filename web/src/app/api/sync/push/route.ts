import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";
import { SignJWT } from "jose";

export async function POST(request: Request) {
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

    const body = await request.json();

    const res = await fetch(`${workerUrl}/v1/sync/push`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${jwt}`,
      },
      body: JSON.stringify(body),
    });

    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err) {
    console.error("[sync/push] error:", err);
    return NextResponse.json({ error: "Internal sync error" }, { status: 500 });
  }
}
