import { NextResponse } from "next/server";
import { getMajoranaAuth } from "../../../../lib/auth";
import {
  controlPlaneUnavailable,
  controlPlaneUrl,
  fetchControlPlane,
} from "../../../../lib/control-plane";

export const dynamic = "force-dynamic";

/**
 * Workspaces this account was added to and has not been told about.
 *
 * Read once per authenticated page load and empty almost every time, which is
 * why it is a client fetch after mount rather than a server render: an invite
 * arriving is not worth a round trip on the critical path of every page.
 */
export async function GET() {
  const { accessToken } = await getMajoranaAuth({ ensureSignedIn: true });
  try {
    const upstream = await fetchControlPlane(controlPlaneUrl("/v1/workspaces/invitations"), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    return new NextResponse(upstream.body, {
      status: upstream.status,
      headers: { "Content-Type": upstream.headers.get("Content-Type") ?? "application/json" },
    });
  } catch (error) {
    // The notice simply does not appear. It is an announcement, not a gate —
    // failing it closed would be worse than the outage it reports. It still
    // answers through the shared helper: the client treats every failure the
    // same way, but a hung control plane and a refused one have to stay
    // separable in the logs, and this route is the likeliest to see either —
    // it is fetched on every authenticated page load.
    return controlPlaneUnavailable(error);
  }
}
