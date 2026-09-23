import { NextResponse } from "next/server";
import { getMajoranaAuth } from "../../../../../../lib/auth";
import { controlPlaneUnavailable, controlPlaneUrl, fetchControlPlane } from "../../../../../../lib/control-plane";

export const dynamic = "force-dynamic";

/**
 * The gradebook `.csv` download, streamed through as-is, the same way the
 * course `.zip` export is. The control plane names the file, sets its type, and
 * has already made every cell safe to open in a spreadsheet (a leading `=`, `+`,
 * `-` or `@` is quoted), so this route reinterprets nothing.
 *
 * `?cohort_id=` (ai-ops 349 proposal 8) is forwarded unchecked, the same way
 * `/api/comments` forwards its own query parameters: the control plane
 * validates it and answers 404 for a cohort that is not this course's.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ courseId: string }> },
) {
  const { courseId } = await params;
  const { accessToken } = await getMajoranaAuth({ ensureSignedIn: true });
  const upstreamUrl = controlPlaneUrl(`/v1/courses/${encodeURIComponent(courseId)}/gradebook.csv`);
  const cohortId = new URL(request.url).searchParams.get("cohort_id");
  if (cohortId) upstreamUrl.searchParams.set("cohort_id", cohortId);
  try {
    const upstream = await fetchControlPlane(upstreamUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const headers: Record<string, string> = {
      "Content-Type": upstream.headers.get("Content-Type") ?? "text/csv; charset=utf-8",
    };
    const disposition = upstream.headers.get("Content-Disposition");
    if (disposition) headers["Content-Disposition"] = disposition;
    return new NextResponse(upstream.body, { status: upstream.status, headers });
  } catch (error) {
    return controlPlaneUnavailable(error);
  }
}
