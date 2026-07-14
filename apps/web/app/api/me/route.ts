import { NextResponse } from "next/server";
import { getMajoranaAuth } from "../../../lib/auth";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export const dynamic = "force-dynamic";

export async function GET() {
  const { accessToken } = await getMajoranaAuth({ ensureSignedIn: true });
  try {
    const upstream = await fetch(`${API_URL}/v1/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
    return new NextResponse(upstream.body, {
      status: upstream.status,
      headers: { "Content-Type": upstream.headers.get("Content-Type") ?? "application/json" },
    });
  } catch {
    return NextResponse.json({ error: "control plane unavailable" }, { status: 502 });
  }
}

export async function PATCH(request: Request) {
  const { accessToken } = await getMajoranaAuth({ ensureSignedIn: true });
  try {
    const upstream = await fetch(`${API_URL}/v1/me`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": request.headers.get("Content-Type") ?? "application/json",
      },
      body: await request.text(),
      cache: "no-store",
    });
    return new NextResponse(upstream.body, {
      status: upstream.status,
      headers: { "Content-Type": upstream.headers.get("Content-Type") ?? "application/json" },
    });
  } catch {
    return NextResponse.json({ error: "control plane unavailable" }, { status: 502 });
  }
}
