import { NextResponse } from "next/server";
import { getMajoranaAuth } from "../../../../../lib/auth";
import {
  controlPlaneUnavailable,
  controlPlaneUrl,
  fetchControlPlane,
} from "../../../../../lib/control-plane";

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
    const upstream = await fetchControlPlane(
      controlPlaneUrl("/v1/atlas/workflows/ansatz-migrations"),
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": contentType,
          "Idempotency-Key": idempotencyKey,
        },
        body: await request.text(),
      },
    );
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
