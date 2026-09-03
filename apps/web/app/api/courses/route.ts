import { NextResponse } from "next/server";
import { getMajoranaAuth } from "../../../lib/auth";
import { controlPlaneUnavailable, controlPlaneUrl, fetchControlPlane } from "../../../lib/control-plane";

export const dynamic = "force-dynamic";

/** List the signed-in workspace's courses. Proxies `GET /v1/courses` 1:1. */
export async function GET(request: Request) {
  const { accessToken } = await getMajoranaAuth({ ensureSignedIn: true });
  const requestUrl = new URL(request.url);
  const upstreamUrl = controlPlaneUrl("/v1/courses");
  for (const key of ["cursor", "limit"]) {
    const value = requestUrl.searchParams.get(key);
    if (value) upstreamUrl.searchParams.set(key, value);
  }
  try {
    const upstream = await fetchControlPlane(upstreamUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    return new NextResponse(upstream.body, {
      status: upstream.status,
      headers: { "Content-Type": upstream.headers.get("Content-Type") ?? "application/json" },
    });
  } catch (error) {
    return controlPlaneUnavailable(error);
  }
}

/**
 * Plan a course: `brief` (+ module_count/audience/style/framework/seeds)
 * becomes a queued plan run that decomposes it into modules. `Idempotency-Key`
 * is forwarded so a retried submit from the composer cannot double-create a
 * course — same reasoning as `app/api/notebooks/route.ts`.
 */
export async function POST(request: Request) {
  const { accessToken } = await getMajoranaAuth({ ensureSignedIn: true });
  const body = await request.text();
  const idempotencyKey = request.headers.get("Idempotency-Key");
  try {
    const upstream = await fetchControlPlane(controlPlaneUrl("/v1/courses"), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": request.headers.get("Content-Type") ?? "application/json",
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
      },
      body,
    });
    return new NextResponse(upstream.body, {
      status: upstream.status,
      headers: { "Content-Type": upstream.headers.get("Content-Type") ?? "application/json" },
    });
  } catch (error) {
    return controlPlaneUnavailable(error);
  }
}
