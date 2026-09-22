import { NextResponse } from "next/server";
import { getMajoranaAuth } from "../../../lib/auth";
import { controlPlaneUnavailable, controlPlaneUrl, fetchControlPlane } from "../../../lib/control-plane";

export const dynamic = "force-dynamic";

/**
 * The thread on one run, notebook or saved circuit. Proxies `GET /v1/comments`.
 *
 * Only the four parameters the control plane reads are forwarded, and none is
 * checked here: the API answers 422 for a bad one and 404 for a thing outside
 * the caller's workspace. No parameter names a workspace; the bearer token
 * decides whose thread this is.
 */
export async function GET(request: Request) {
  const { accessToken } = await getMajoranaAuth({ ensureSignedIn: true });
  const requestUrl = new URL(request.url);
  const upstreamUrl = controlPlaneUrl("/v1/comments");
  for (const key of ["target_type", "target_id", "cursor", "limit"]) {
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
 * Post a comment or a reply: `CreateCommentRequest` -> `Comment`.
 *
 * `Idempotency-Key` is forwarded, the way `POST /api/runs` forwards it, so the
 * panel's retry of a post whose response was lost gets the first comment back
 * instead of posting it twice.
 */
export async function POST(request: Request) {
  const [{ accessToken }, body] = await Promise.all([
    getMajoranaAuth({ ensureSignedIn: true }),
    request.text(),
  ]);
  const idempotencyKey = request.headers.get("Idempotency-Key");
  try {
    const upstream = await fetchControlPlane(controlPlaneUrl("/v1/comments"), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": request.headers.get("Content-Type") ?? "application/json",
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
      },
      body,
    });
    const headers: Record<string, string> = {
      "Content-Type": upstream.headers.get("Content-Type") ?? "application/json",
    };
    // A 429 carries the wait, and the composer reads it.
    const retryAfter = upstream.headers.get("Retry-After");
    if (retryAfter) headers["Retry-After"] = retryAfter;
    return new NextResponse(upstream.body, { status: upstream.status, headers });
  } catch (error) {
    return controlPlaneUnavailable(error);
  }
}
