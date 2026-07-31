import { NextResponse } from "next/server";
import { getMajoranaAuth } from "../../../../../lib/auth";
import { controlPlaneUnavailable, controlPlaneUrl, fetchControlPlane } from "../../../../../lib/control-plane";

export const dynamic = "force-dynamic";

function upstreamUrl(folderId: string) {
  return controlPlaneUrl(`/v1/workspace/folders/${encodeURIComponent(folderId)}`);
}

/** Rename. The body is `{ name }` — the same shape create takes. */
export async function PATCH(request: Request, context: { params: Promise<{ folderId: string }> }) {
  const { folderId } = await context.params;
  const { accessToken } = await getMajoranaAuth({ ensureSignedIn: true });
  try {
    const upstream = await fetchControlPlane(upstreamUrl(folderId), {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": request.headers.get("Content-Type") ?? "application/json",
      },
      body: await request.text(),
    });
    return new NextResponse(upstream.body, {
      status: upstream.status,
      headers: { "Content-Type": upstream.headers.get("Content-Type") ?? "application/json" },
    });
  } catch (error) {
    return controlPlaneUnavailable(error);
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ folderId: string }> }) {
  const { folderId } = await context.params;
  const { accessToken } = await getMajoranaAuth({ ensureSignedIn: true });
  try {
    const upstream = await fetchControlPlane(upstreamUrl(folderId), {
      method: "DELETE",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    // 204 carries no body, and forwarding `upstream.body` on a 204 makes
    // NextResponse throw. The artifact DELETE proxy special-cases this the same
    // way — see app/api/artifacts/[artifactId]/route.ts.
    if (upstream.status === 204) return new NextResponse(null, { status: 204 });
    return new NextResponse(upstream.body, {
      status: upstream.status,
      headers: { "Content-Type": upstream.headers.get("Content-Type") ?? "application/json" },
    });
  } catch (error) {
    return controlPlaneUnavailable(error);
  }
}
