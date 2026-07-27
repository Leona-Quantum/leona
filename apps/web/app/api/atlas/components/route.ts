import { NextResponse } from "next/server";
import { getMajoranaAuth } from "../../../../lib/auth";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export async function GET(request: Request) {
  const { accessToken } = await getMajoranaAuth({ ensureSignedIn: true });
  const requested = new URL(request.url).searchParams;
  const componentType = requested.get("component_type");
  const requestedLimit = Number(requested.get("limit") ?? "50");
  if (componentType !== "parameter_optimizer") {
    return NextResponse.json(
      { error: "unsupported component type" },
      { status: 400 },
    );
  }
  const upstreamUrl = new URL("/v1/atlas/components", API_URL);
  upstreamUrl.searchParams.set("component_type", componentType);
  upstreamUrl.searchParams.set(
    "limit",
    String(
      Number.isInteger(requestedLimit)
        && requestedLimit >= 1
        && requestedLimit <= 200
        ? requestedLimit
        : 50,
    ),
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
    return NextResponse.json(
      { error: "control plane unavailable" },
      { status: 502 },
    );
  }
}

export const dynamic = "force-dynamic";
