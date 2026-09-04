import { NextResponse } from "next/server";
import { getMajoranaAuth } from "../../../../../../lib/auth";
import { controlPlaneUnavailable, controlPlaneUrl, fetchControlPlane } from "../../../../../../lib/control-plane";

export const dynamic = "force-dynamic";

/** One immutable version — spec, source, executed ipynb, report, review. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ notebookId: string; seq: string }> },
) {
  const { notebookId, seq } = await params;
  const { accessToken } = await getMajoranaAuth({ ensureSignedIn: true });
  try {
    const upstream = await fetchControlPlane(
      controlPlaneUrl(`/v1/notebooks/${encodeURIComponent(notebookId)}/versions/${encodeURIComponent(seq)}`),
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
