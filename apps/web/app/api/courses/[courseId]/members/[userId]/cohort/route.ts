import { NextResponse } from "next/server";
import { getMajoranaAuth } from "../../../../../../../lib/auth";
import { controlPlaneUnavailable, controlPlaneUrl, fetchControlPlane } from "../../../../../../../lib/control-plane";

export const dynamic = "force-dynamic";

/**
 * Assign, move or clear one member's cohort: `SetCohortMembershipRequest`
 * (`{ cohort_id }`, `null` clears) -> 204. Creator-only.
 */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ courseId: string; userId: string }> },
) {
  const [{ accessToken }, { courseId, userId }, body] = await Promise.all([
    getMajoranaAuth({ ensureSignedIn: true }),
    params,
    request.text(),
  ]);
  try {
    const upstream = await fetchControlPlane(
      controlPlaneUrl(
        `/v1/courses/${encodeURIComponent(courseId)}/members/${encodeURIComponent(userId)}/cohort`,
      ),
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": request.headers.get("Content-Type") ?? "application/json",
        },
        body,
      },
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
