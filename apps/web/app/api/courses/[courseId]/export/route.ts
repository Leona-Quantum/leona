import { NextResponse } from "next/server";
import { getMajoranaAuth } from "../../../../../lib/auth";
import { controlPlaneUnavailable, controlPlaneUrl, fetchControlPlane } from "../../../../../lib/control-plane";

export const dynamic = "force-dynamic";

/**
 * The course-as-a-repository `.zip` download. Streamed through as-is — the
 * control plane names the file (`Content-Disposition: attachment`) and its
 * type; this route adds nothing and reinterprets nothing, it only carries the
 * session's bearer token to an otherwise-unauthenticated proxy call. The
 * control plane answers 409 until every module is ready; that status (and its
 * JSON refusal body) is forwarded unchanged for the workspace to read with
 * `refusalSentence`.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ courseId: string }> },
) {
  const { courseId } = await params;
  const { accessToken } = await getMajoranaAuth({ ensureSignedIn: true });
  try {
    const upstream = await fetchControlPlane(
      controlPlaneUrl(`/v1/courses/${encodeURIComponent(courseId)}/export.zip`),
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    const headers: Record<string, string> = {
      "Content-Type": upstream.headers.get("Content-Type") ?? "application/zip",
    };
    const disposition = upstream.headers.get("Content-Disposition");
    if (disposition) headers["Content-Disposition"] = disposition;
    return new NextResponse(upstream.body, { status: upstream.status, headers });
  } catch (error) {
    return controlPlaneUnavailable(error);
  }
}
