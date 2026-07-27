import { NextResponse } from "next/server";
import { getMajoranaAuth } from "../../../../../lib/auth";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export async function POST(request: Request) {
  const { accessToken } = await getMajoranaAuth({ ensureSignedIn: true });
  const contentType = request.headers.get("Content-Type");
  const idempotencyKey = request.headers.get("Idempotency-Key");
  const contentLength = Number(request.headers.get("Content-Length") ?? "0");
  if (
    contentType !== "application/json"
    || !idempotencyKey
    || idempotencyKey.length > 200
    || !Number.isFinite(contentLength)
    || contentLength > 16_384
  ) {
    return NextResponse.json(
      { error: "bounded JSON and Idempotency-Key are required" },
      { status: 400 },
    );
  }
  try {
    const upstream = await fetch(new URL("/v1/atlas/workflows/swaps", API_URL), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": contentType,
        "Idempotency-Key": idempotencyKey,
      },
      body: await request.text(),
      cache: "no-store",
    });
    return new NextResponse(upstream.body, {
      status: upstream.status,
      headers: {
        "Content-Type": upstream.headers.get("Content-Type") ?? "application/json",
      },
    });
  } catch {
    return NextResponse.json(
      { error: "control plane unavailable" },
      { status: 502 },
    );
  }
}

export const dynamic = "force-dynamic";
