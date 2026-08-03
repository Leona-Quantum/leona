import { NextResponse } from "next/server";
import { getMajoranaAuth } from "../../../../../lib/auth";
import { controlPlaneUnavailable, controlPlaneUrl, fetchControlPlane } from "../../../../../lib/control-plane";

export const dynamic = "force-dynamic";

/**
 * Set the whole workspace's project order.
 *
 * A pass-through like every other BFF route: the body's shape is the API's
 * business, and authorization is entirely the control plane's (apps/web holds
 * none, by design). At `/order` rather than a PATCH on the collection so that a
 * future PATCH-the-collection means something else — same as folders.
 */
export async function PATCH(request: Request) {
  const { accessToken } = await getMajoranaAuth({ ensureSignedIn: true });
  try {
    const upstream = await fetchControlPlane(controlPlaneUrl("/v1/workspace/projects/order"), {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": request.headers.get("Content-Type") ?? "application/json",
      },
      body: await request.text(),
    });
    return new NextResponse(upstream.body, {
      status: upstream.status,
      headers: { "Content-Type": upstream.headers.get("Content-Type") ?? "application/json" },
    });
  } catch (error) {
    return controlPlaneUnavailable(error);
  }
}
