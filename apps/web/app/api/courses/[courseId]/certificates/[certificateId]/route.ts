import { NextResponse } from "next/server";
import { getMajoranaAuth } from "../../../../../../lib/auth";
import { controlPlaneUnavailable, controlPlaneUrl, fetchControlPlane } from "../../../../../../lib/control-plane";

export const dynamic = "force-dynamic";

/**
 * Revoke a certificate. The row is kept — never deleted — so its public page
 * can say "revoked" rather than 404. Callable by the certificate's own
 * learner or the course's creator; anyone else gets 403.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ courseId: string; certificateId: string }> },
) {
  const { courseId, certificateId } = await params;
  const { accessToken } = await getMajoranaAuth({ ensureSignedIn: true });
  try {
    const upstream = await fetchControlPlane(
      controlPlaneUrl(
        `/v1/courses/${encodeURIComponent(courseId)}/certificates/${encodeURIComponent(certificateId)}`,
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
