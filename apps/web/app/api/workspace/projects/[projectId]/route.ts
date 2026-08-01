import { NextResponse } from "next/server";
import { getMajoranaAuth } from "../../../../../lib/auth";
import { controlPlaneUnavailable, controlPlaneUrl, fetchControlPlane } from "../../../../../lib/control-plane";

export const dynamic = "force-dynamic";

function upstreamUrl(projectId: string) {
  return controlPlaneUrl(`/v1/workspace/projects/${encodeURIComponent(projectId)}`);
}

/**
 * Rename, change the share contribution limit, or both.
 *
 * The body is forwarded verbatim — `{ name }`, `{ max_artifacts }`, or both — so
 * this proxy needed no change when the second field arrived and needs none when a
 * third does. The control plane owns which combinations are legal.
 */
export async function PATCH(request: Request, context: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await context.params;
  const { accessToken } = await getMajoranaAuth({ ensureSignedIn: true });
  try {
    const upstream = await fetchControlPlane(upstreamUrl(projectId), {
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

export async function DELETE(_request: Request, context: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await context.params;
  const { accessToken } = await getMajoranaAuth({ ensureSignedIn: true });
  try {
    const upstream = await fetchControlPlane(upstreamUrl(projectId), {
      method: "DELETE",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    // 204 carries no body, and forwarding `upstream.body` on a 204 makes
    // NextResponse throw — the folder and artifact DELETE proxies special-case
    // this the same way.
    if (upstream.status === 204) return new NextResponse(null, { status: 204 });
    return new NextResponse(upstream.body, {
      status: upstream.status,
      headers: { "Content-Type": upstream.headers.get("Content-Type") ?? "application/json" },
    });
  } catch (error) {
    return controlPlaneUnavailable(error);
  }
}
