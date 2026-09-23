import { NextResponse } from "next/server";
import { getMajoranaAuth } from "../../../../../../lib/auth";
import { controlPlaneUnavailable, controlPlaneUrl, fetchControlPlane } from "../../../../../../lib/control-plane";

export const dynamic = "force-dynamic";

/** Rename a cohort: `UpdateCohortRequest` -> `CourseCohort`. Creator-only. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ courseId: string; cohortId: string }> },
) {
  const [{ accessToken }, { courseId, cohortId }, body] = await Promise.all([
    getMajoranaAuth({ ensureSignedIn: true }),
    params,
    request.text(),
  ]);
  try {
    const upstream = await fetchControlPlane(
      controlPlaneUrl(
        `/v1/courses/${encodeURIComponent(courseId)}/cohorts/${encodeURIComponent(cohortId)}`,
      ),
      {
        method: "PATCH",
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

/** Delete a cohort. Its former members simply have none — see the control
 * plane's own docstring on `repos.cohorts.delete_cohort`. Creator-only. */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ courseId: string; cohortId: string }> },
) {
  const { courseId, cohortId } = await params;
  const { accessToken } = await getMajoranaAuth({ ensureSignedIn: true });
  try {
    const upstream = await fetchControlPlane(
      controlPlaneUrl(
        `/v1/courses/${encodeURIComponent(courseId)}/cohorts/${encodeURIComponent(cohortId)}`,
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
