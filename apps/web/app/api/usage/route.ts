import { NextResponse } from "next/server";
import { getMajoranaAuth } from "../../../lib/auth";
import { controlPlaneUnavailable, controlPlaneUrl, fetchControlPlane } from "../../../lib/control-plane";

/**
 * The account's spent allowance, straight from the control plane.
 *
 * A pass-through rather than a computation on purpose. The BFF already knows
 * how to assess an allowance (`lib/run-allowance.ts`) and could answer this
 * from the run list — but that number would be the BFF's opinion, and the one
 * that refuses a submission is the control plane's. Two servers agreeing is
 * something to arrange by not asking twice.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const { accessToken } = await getMajoranaAuth({ ensureSignedIn: true });
  try {
    const upstream = await fetchControlPlane(controlPlaneUrl("/v1/usage"), {
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
