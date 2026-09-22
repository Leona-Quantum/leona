import { NextResponse } from "next/server";
import { getMajoranaAuth } from "../../../../lib/auth";
import { controlPlaneUnavailable, controlPlaneUrl, fetchControlPlane } from "../../../../lib/control-plane";

export const dynamic = "force-dynamic";

/**
 * Revoke one of the caller's own tokens. Proxies `DELETE /v1/tokens/{id}`.
 *
 * The id is forwarded encoded, and it is not checked here: the control plane
 * answers 422 for something that is not a uuid and 404 for a token that is not
 * the caller's — the same "absent or not yours" every other resource gives, which
 * is what keeps a guessed id from being confirmed as real.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ tokenId: string }> },
) {
  const [{ accessToken }, { tokenId }] = await Promise.all([
    getMajoranaAuth({ ensureSignedIn: true }),
    params,
  ]);
  try {
    const upstream = await fetchControlPlane(
      controlPlaneUrl(`/v1/tokens/${encodeURIComponent(tokenId)}`),
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
