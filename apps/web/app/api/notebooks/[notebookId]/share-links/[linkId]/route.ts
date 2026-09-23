import { NextResponse } from "next/server";
import { getMajoranaAuth } from "../../../../../../lib/auth";
import { controlPlaneUnavailable, controlPlaneUrl, fetchControlPlane } from "../../../../../../lib/control-plane";

export const dynamic = "force-dynamic";

/**
 * Revoke one of this notebook's share links. Proxies
 * `DELETE /v1/notebooks/{notebookId}/share-links/{linkId}`.
 *
 * Both ids are forwarded encoded and unchecked here: the control plane answers
 * 404 for a link that is not this notebook's or not the caller's to manage —
 * the same "absent or not yours" every other resource gives.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ notebookId: string; linkId: string }> },
) {
  const [{ accessToken }, { notebookId, linkId }] = await Promise.all([
    getMajoranaAuth({ ensureSignedIn: true }),
    params,
  ]);
  try {
    const upstream = await fetchControlPlane(
      controlPlaneUrl(
        `/v1/notebooks/${encodeURIComponent(notebookId)}/share-links/${encodeURIComponent(linkId)}`,
      ),
      { method: "DELETE", headers: { Authorization: `Bearer ${accessToken}` } },
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
