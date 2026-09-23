import { NextResponse } from "next/server";
import { getMajoranaAuth } from "../../../../../lib/auth";
import { controlPlaneUnavailable, controlPlaneUrl, fetchControlPlane } from "../../../../../lib/control-plane";

export const dynamic = "force-dynamic";

/**
 * A course's certificates (ai-ops 349 proposal 8). Passed through unchanged:
 * the creator sees every one issued, anyone else sees only their own (0 or 1).
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ courseId: string }> },
) {
  const { courseId } = await params;
  const { accessToken } = await getMajoranaAuth({ ensureSignedIn: true });
  try {
    const upstream = await fetchControlPlane(
      controlPlaneUrl(`/v1/courses/${encodeURIComponent(courseId)}/certificates`),
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

/**
 * Claim the caller's own certificate: `ClaimCertificateRequest` ->
 * `CourseCertificate`. Idempotent (a second claim returns the first one), and
 * refused 409 until every graded exercise in the course is passed.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ courseId: string }> },
) {
  const [{ accessToken }, { courseId }, body] = await Promise.all([
    getMajoranaAuth({ ensureSignedIn: true }),
    params,
    request.text(),
  ]);
  try {
    const upstream = await fetchControlPlane(
      controlPlaneUrl(`/v1/courses/${encodeURIComponent(courseId)}/certificates`),
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": request.headers.get("Content-Type") ?? "application/json",
        },
        body,
      },
    );
    return new NextResponse(upstream.body, {
      status: upstream.status,
      headers: { "Content-Type": upstream.headers.get("Content-Type") ?? "application/json" },
    });
  } catch (error) {
    return controlPlaneUnavailable(error);
  }
}
