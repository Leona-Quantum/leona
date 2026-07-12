import { NextResponse } from "next/server";
import { getMajoranaAuth } from "../../../lib/auth";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export async function POST(request: Request) {
  const { accessToken } = await getMajoranaAuth({ ensureSignedIn: true });
  const body = await request.text();
  const idempotencyKey = request.headers.get("Idempotency-Key");

  try {
    const upstream = await fetch(`${API_URL}/v1/runs`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": request.headers.get("Content-Type") ?? "application/json",
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
      },
      body,
      cache: "no-store",
    });

    return new NextResponse(upstream.body, {
      status: upstream.status,
      headers: {
        "Content-Type": upstream.headers.get("Content-Type") ?? "application/json",
      },
    });
  } catch {
    return NextResponse.json({ error: "control plane unavailable" }, { status: 502 });
  }
}
