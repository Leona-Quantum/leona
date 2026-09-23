import { NextResponse } from "next/server";
import { getMajoranaAuth } from "../../../lib/auth";
import { controlPlaneUnavailable, controlPlaneUrl, fetchControlPlane } from "../../../lib/control-plane";

export const dynamic = "force-dynamic";

/**
 * Who else in the workspace is looking at this run, notebook or saved
 * circuit, right now. Proxies `GET /v1/presence`.
 *
 * Only the two parameters the control plane reads are forwarded, and neither
 * is checked here: the API answers 422 for a bad one and 404 for a thing
 * outside the caller's workspace. No parameter names a workspace; the bearer
 * token decides whose presence this is.
 */
export async function GET(request: Request) {
  const { accessToken } = await getMajoranaAuth({ ensureSignedIn: true });
  const requestUrl = new URL(request.url);
  const upstreamUrl = controlPlaneUrl("/v1/presence");
  for (const key of ["target_type", "target_id"]) {
    const value = requestUrl.searchParams.get(key);
    if (value) upstreamUrl.searchParams.set(key, value);
  }
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
