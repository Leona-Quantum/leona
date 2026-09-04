import { NextResponse } from "next/server";
import { getMajoranaAuth } from "../../../../lib/auth";
import { controlPlaneUnavailable, controlPlaneUrl, fetchControlPlane } from "../../../../lib/control-plane";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ notebookId: string }> },
) {
  const { notebookId } = await params;
  const { accessToken } = await getMajoranaAuth({ ensureSignedIn: true });
  try {
    const upstream = await fetchControlPlane(controlPlaneUrl(`/v1/notebooks/${encodeURIComponent(notebookId)}`), {
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

/** Title/summary edits (`UpdateNotebookRequest`). */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ notebookId: string }> },
) {
  const [{ accessToken }, { notebookId }, body] = await Promise.all([
    getMajoranaAuth({ ensureSignedIn: true }),
    params,
    request.text(),
  ]);
  try {
    const upstream = await fetchControlPlane(controlPlaneUrl(`/v1/notebooks/${encodeURIComponent(notebookId)}`), {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": request.headers.get("Content-Type") ?? "application/json",
      },
      body,
    });
    return new NextResponse(upstream.body, {
      status: upstream.status,
      headers: { "Content-Type": upstream.headers.get("Content-Type") ?? "application/json" },
    });
  } catch (error) {
    return controlPlaneUnavailable(error);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ notebookId: string }> },
) {
  const { notebookId } = await params;
  const { accessToken } = await getMajoranaAuth({ ensureSignedIn: true });
  try {
    const upstream = await fetchControlPlane(controlPlaneUrl(`/v1/notebooks/${encodeURIComponent(notebookId)}`), {
      method: "DELETE",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    // 204 carries no body; forwarding upstream.body would violate the contract.
    if (upstream.status === 204) return new NextResponse(null, { status: 204 });
    return new NextResponse(upstream.body, {
      status: upstream.status,
      headers: { "Content-Type": upstream.headers.get("Content-Type") ?? "application/json" },
    });
  } catch (error) {
    return controlPlaneUnavailable(error);
  }
}
