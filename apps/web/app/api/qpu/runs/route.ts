import { NextResponse } from "next/server";
import { getMajoranaAuth } from "../../../../lib/auth";
import { controlPlaneUnavailable, controlPlaneUrl, fetchControlPlane } from "../../../../lib/control-plane";

export const dynamic = "force-dynamic";

/**
 * The signed-in workspace's hardware runs. Proxies `GET /v1/qpu/runs` 1:1.
 *
 * Only the three parameters the control plane reads are forwarded, and none of
 * them is checked here: the API validates all three and answers 422, and a
 * second set of rules in this file would be a second thing to disagree with it.
 * No parameter names a workspace; the bearer token decides whose runs these are.
 */
export async function GET(request: Request) {
  const { accessToken } = await getMajoranaAuth({ ensureSignedIn: true });
  const requestUrl = new URL(request.url);
  const upstreamUrl = controlPlaneUrl("/v1/qpu/runs");
  for (const key of ["cursor", "limit", "source_fingerprint"]) {
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
