import { NextResponse } from "next/server";
import { getMajoranaAuth } from "../../../../lib/auth";
import { controlPlaneUnavailable, controlPlaneUrl, fetchControlPlane } from "../../../../lib/control-plane";

export const dynamic = "force-dynamic";

/**
 * "I am still looking at this." Proxies `POST /v1/presence/heartbeat`.
 *
 * Sent every ~15s by a visible tab (`components/presence-bar.tsx`). A 429
 * carries the wait, the same way `POST /api/comments` forwards it, so a tab
 * heartbeating too fast backs off instead of retrying blind.
 */
export async function POST(request: Request) {
  const [{ accessToken }, body] = await Promise.all([
    getMajoranaAuth({ ensureSignedIn: true }),
    request.text(),
  ]);
  try {
    const upstream = await fetchControlPlane(controlPlaneUrl("/v1/presence/heartbeat"), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": request.headers.get("Content-Type") ?? "application/json",
      },
      body,
    });
    const retryAfter = upstream.headers.get("Retry-After");
    const headers: Record<string, string> = retryAfter ? { "Retry-After": retryAfter } : {};
    // A success carries no body (204), and constructing a Response with one on
    // that status throws — so the body is passed explicitly as null rather
    // than as whatever `upstream.body` happens to be.
    if (upstream.status === 204) {
      return new NextResponse(null, { status: 204, headers });
    }
    headers["Content-Type"] = upstream.headers.get("Content-Type") ?? "application/json";
    return new NextResponse(upstream.body, { status: upstream.status, headers });
  } catch (error) {
    return controlPlaneUnavailable(error);
  }
}
