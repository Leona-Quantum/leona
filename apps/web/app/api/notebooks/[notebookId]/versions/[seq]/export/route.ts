import { NextResponse } from "next/server";
import { getMajoranaAuth } from "../../../../../../../lib/auth";
import { controlPlaneUnavailable, controlPlaneUrl, fetchControlPlane } from "../../../../../../../lib/control-plane";

export const dynamic = "force-dynamic";

/**
 * The `.ipynb` download. Streamed through as-is — the control plane names the
 * file (`Content-Disposition`) and its type (`Content-Type`); this route adds
 * nothing and reinterprets nothing, it only carries the session's bearer token
 * to an otherwise-unauthenticated proxy call.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ notebookId: string; seq: string }> },
) {
  const { notebookId, seq } = await params;
  const { accessToken } = await getMajoranaAuth({ ensureSignedIn: true });
  try {
    const upstream = await fetchControlPlane(
      controlPlaneUrl(`/v1/notebooks/${encodeURIComponent(notebookId)}/versions/${encodeURIComponent(seq)}/export.ipynb`),
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    const headers: Record<string, string> = {
      "Content-Type": upstream.headers.get("Content-Type") ?? "application/x-ipynb+json",
    };
    const disposition = upstream.headers.get("Content-Disposition");
    if (disposition) headers["Content-Disposition"] = disposition;
    return new NextResponse(upstream.body, { status: upstream.status, headers });
  } catch (error) {
    return controlPlaneUnavailable(error);
  }
}
