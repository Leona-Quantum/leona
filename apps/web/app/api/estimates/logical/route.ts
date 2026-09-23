import { NextResponse } from "next/server";
import { getMajoranaAuth } from "../../../../lib/auth";
import { controlPlaneUnavailable, controlPlaneUrl, fetchControlPlane } from "../../../../lib/control-plane";

export const dynamic = "force-dynamic";

/**
 * Physical qubits and runtime for the Atlas planner's logical points. Proxies
 * `POST /v1/estimates/logical`, which is arithmetic only (no database, no
 * provider, nothing executed) and signed-in only, so the bearer token this
 * attaches is the whole of what the upstream checks.
 */
export async function POST(request: Request) {
  const [{ accessToken }, body] = await Promise.all([
    getMajoranaAuth({ ensureSignedIn: true }),
    request.text(),
  ]);
  try {
    const upstream = await fetchControlPlane(controlPlaneUrl("/v1/estimates/logical"), {
      method: "POST",
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
