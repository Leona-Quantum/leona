import { NextResponse } from "next/server";
import { getMajoranaAuth } from "../../../../lib/auth";
import {
  controlPlaneUnavailable,
  controlPlaneUrl,
  fetchControlPlane,
} from "../../../../lib/control-plane";

export async function GET(request: Request) {
  const { accessToken } = await getMajoranaAuth({ ensureSignedIn: true });
  const upstreamUrl = controlPlaneUrl("/v1/atlas/workflows");
  const requestedLimit = new URL(request.url).searchParams.get("limit");
  const limit = Number(requestedLimit ?? "50");
  upstreamUrl.searchParams.set(
    "limit",
    String(Number.isInteger(limit) && limit >= 1 && limit <= 200 ? limit : 50),
  );
  try {
    const upstream = await fetchControlPlane(upstreamUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    return new NextResponse(upstream.body, {
      status: upstream.status,
      headers: {
        "Content-Type": upstream.headers.get("Content-Type") ?? "application/json",
      },
    });
  } catch (error) {
    return controlPlaneUnavailable(error);
  }
}

export const dynamic = "force-dynamic";
