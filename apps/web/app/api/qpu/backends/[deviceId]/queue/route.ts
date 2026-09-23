import { NextResponse } from "next/server";
import { getMajoranaAuth } from "../../../../../../lib/auth";
import { controlPlaneUnavailable, controlPlaneUrl, fetchControlPlane } from "../../../../../../lib/control-plane";

export const dynamic = "force-dynamic";

/** How busy a device is, before submitting. Proxies
 * `GET /v1/qpu/backends/{deviceId}/queue`. `deviceId` names a catalog entry
 * (`ibm.open_plan`), not a UUID, so it is only URL-encoded, never shape-checked
 * — an unknown one is the control plane's 404 to give, not this route's. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ deviceId: string }> },
) {
  const { accessToken } = await getMajoranaAuth({ ensureSignedIn: true });
  const { deviceId } = await params;
  try {
    const upstream = await fetchControlPlane(
      controlPlaneUrl(`/v1/qpu/backends/${encodeURIComponent(deviceId)}/queue`),
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    return new NextResponse(upstream.body, {
      status: upstream.status,
      headers: { "Content-Type": upstream.headers.get("Content-Type") ?? "application/json" },
    });
  } catch (error) {
    return controlPlaneUnavailable(error);
  }
}
