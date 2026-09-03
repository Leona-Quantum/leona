import { NextResponse } from "next/server";
import { getMajoranaAuth } from "../../../../../lib/auth";
import { controlPlaneUnavailable, controlPlaneUrl, fetchControlPlane } from "../../../../../lib/control-plane";

export const dynamic = "force-dynamic";

/** A notebook's version history — the picker's list, `NotebookVersionList`. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ notebookId: string }> },
) {
  const { notebookId } = await params;
  const { accessToken } = await getMajoranaAuth({ ensureSignedIn: true });
  try {
    const upstream = await fetchControlPlane(
      controlPlaneUrl(`/v1/notebooks/${encodeURIComponent(notebookId)}/versions`),
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

/** A version the reader wrote: `AuthorNotebookVersionRequest` -> `{ version, run_id }`.
 * Session glue only — the body is forwarded verbatim, because deciding what a valid
 * edit is belongs to the control plane, not to a renderer. That includes the 400s: the
 * editor shows `title` off the problem+json the API produced. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ notebookId: string }> },
) {
  const [{ accessToken }, { notebookId }, body] = await Promise.all([
    getMajoranaAuth({ ensureSignedIn: true }),
    params,
    request.text(),
  ]);
  try {
    const upstream = await fetchControlPlane(
      controlPlaneUrl(`/v1/notebooks/${encodeURIComponent(notebookId)}/versions`),
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
