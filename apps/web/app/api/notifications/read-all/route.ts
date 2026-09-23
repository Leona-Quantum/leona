import { NextResponse } from "next/server";
import { getMajoranaAuth } from "../../../../lib/auth";
import { controlPlaneUnavailable, controlPlaneUrl, fetchControlPlane } from "../../../../lib/control-plane";

export const dynamic = "force-dynamic";

/** Mark every one of the caller's own unread notifications read. Proxies
 * `POST /v1/notifications/read-all`. Registered as its own literal segment
 * beside `[notificationId]/read`: the two never collide — a literal only
 * loses to a templated sibling when both match the same shape, and
 * "read-all" is one path segment where `[notificationId]/read` is two. */
export async function POST() {
  const { accessToken } = await getMajoranaAuth({ ensureSignedIn: true });
  try {
    const upstream = await fetchControlPlane(controlPlaneUrl("/v1/notifications/read-all"), {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (upstream.status === 204) return new NextResponse(null, { status: 204 });
    return new NextResponse(upstream.body, {
      status: upstream.status,
      headers: { "Content-Type": upstream.headers.get("Content-Type") ?? "application/json" },
    });
  } catch (error) {
    return controlPlaneUnavailable(error);
  }
}
