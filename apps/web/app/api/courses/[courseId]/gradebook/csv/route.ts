import { NextResponse } from "next/server";
import { getMajoranaAuth } from "../../../../../../lib/auth";
import { controlPlaneUnavailable, controlPlaneUrl, fetchControlPlane } from "../../../../../../lib/control-plane";

export const dynamic = "force-dynamic";

/**
 * The gradebook `.csv` download, streamed through as-is, the same way the
 * course `.zip` export is. The control plane names the file, sets its type, and
 * has already made every cell safe to open in a spreadsheet (a leading `=`, `+`,
 * `-` or `@` is quoted), so this route reinterprets nothing.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ courseId: string }> },
) {
  const { courseId } = await params;
  const { accessToken } = await getMajoranaAuth({ ensureSignedIn: true });
  try {
    const upstream = await fetchControlPlane(
      controlPlaneUrl(`/v1/courses/${encodeURIComponent(courseId)}/gradebook.csv`),
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
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
