import { NextResponse } from "next/server";
import { getMajoranaAuth } from "../../../../lib/auth";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

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
    const upstream = await fetch(new URL("/v1/workspaces/invitations", API_URL), {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
    return new NextResponse(upstream.body, {
      status: upstream.status,
      headers: { "Content-Type": upstream.headers.get("Content-Type") ?? "application/json" },
    });
  } catch {
    // The notice simply does not appear. It is an announcement, not a gate —
    // failing it closed would be worse than the outage it reports.
    return NextResponse.json({ error: "control plane unavailable" }, { status: 502 });
  }
}
