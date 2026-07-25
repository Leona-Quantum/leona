import { NextResponse } from "next/server";
import { getMajoranaAuth } from "../../../../lib/auth";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export async function GET(request: Request) {
  const { accessToken } = await getMajoranaAuth({ ensureSignedIn: true });
  const upstreamUrl = new URL("/v1/atlas/workflows", API_URL);
  const requestedLimit = new URL(request.url).searchParams.get("limit");
  const limit = Number(requestedLimit ?? "50");
  upstreamUrl.searchParams.set(
    "limit",
    String(Number.isInteger(limit) && limit >= 1 && limit <= 200 ? limit : 50),
  );
  try {
    const upstream = await fetch(upstreamUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
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

export const dynamic = "force-dynamic";
