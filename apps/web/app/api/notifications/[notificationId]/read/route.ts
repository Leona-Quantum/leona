import { NextResponse } from "next/server";
import { getMajoranaAuth } from "../../../../../lib/auth";
import { controlPlaneUnavailable, controlPlaneUrl, fetchControlPlane } from "../../../../../lib/control-plane";

export const dynamic = "force-dynamic";

/** Mark one of the caller's own notifications read. Proxies
 * `POST /v1/notifications/{id}/read`; someone else's id comes back 404. */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ notificationId: string }> },
) {
  const { accessToken } = await getMajoranaAuth({ ensureSignedIn: true });
  const { notificationId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(notificationId)) {
    return NextResponse.json({ error: "invalid notification id" }, { status: 400 });
  }
  try {
    const upstream = await fetchControlPlane(
      controlPlaneUrl(`/v1/notifications/${notificationId}/read`),
      { method: "POST", headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (upstream.status === 204) return new NextResponse(null, { status: 204 });
    return new NextResponse(upstream.body, {
      status: upstream.status,
      headers: { "Content-Type": upstream.headers.get("Content-Type") ?? "application/json" },
    });
  } catch (error) {
    return controlPlaneUnavailable(error);
  }
}
