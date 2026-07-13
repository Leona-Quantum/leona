import { NextResponse } from "next/server";
import { getMajoranaAuth } from "../../../lib/auth";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { accessToken } = await getMajoranaAuth({ ensureSignedIn: true });
  const requestUrl = new URL(request.url);
  const upstreamUrl = new URL("/v1/artifacts", API_URL);
  for (const key of ["family", "cursor", "limit"]) {
    const value = requestUrl.searchParams.get(key);
    if (value) upstreamUrl.searchParams.set(key, value);
  }
  try {
    const upstream = await fetch(upstreamUrl, {
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
