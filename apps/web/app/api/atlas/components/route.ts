import { NextResponse } from "next/server";
import { getMajoranaAuth } from "../../../../lib/auth";
import {
  controlPlaneUnavailable,
  controlPlaneUrl,
  fetchControlPlane,
} from "../../../../lib/control-plane";

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
  const upstreamUrl = controlPlaneUrl("/v1/atlas/components");
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
