import { NextResponse } from "next/server";
import { getMajoranaAuth } from "../../../../../lib/auth";
import { controlPlaneUnavailable, controlPlaneUrl, fetchControlPlane } from "../../../../../lib/control-plane";

export const dynamic = "force-dynamic";

/**
 * The course gradebook as JSON (`CourseGradebook`). Passed through unchanged: the
 * control plane decides whose rows the caller may see (the course's creator gets
 * everyone's, anyone else only their own), so there is nothing for this route to
 * filter and it must not try.
 *
 * `?cohort_id=` (ai-ops 349 proposal 8) is forwarded unchecked, same as
 * `/api/comments`'s own query parameters — the control plane validates it.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ courseId: string }> },
) {
  const { courseId } = await params;
  const { accessToken } = await getMajoranaAuth({ ensureSignedIn: true });
  const upstreamUrl = controlPlaneUrl(`/v1/courses/${encodeURIComponent(courseId)}/gradebook`);
  const cohortId = new URL(request.url).searchParams.get("cohort_id");
  if (cohortId) upstreamUrl.searchParams.set("cohort_id", cohortId);
  try {
    const upstream = await fetchControlPlane(upstreamUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    return new NextResponse(upstream.body, {
      status: upstream.status,
      headers: { "Content-Type": upstream.headers.get("Content-Type") ?? "application/json" },
    });
  } catch (error) {
    return controlPlaneUnavailable(error);
  }
}
