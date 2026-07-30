import { NextResponse } from "next/server";
import { getMajoranaAuth } from "../../../../lib/auth";
import { controlPlaneUnavailable, controlPlaneUrl, fetchControlPlane } from "../../../../lib/control-plane";

export const dynamic = "force-dynamic";

/** Roles this route will forward. The control plane refuses the rest anyway;
 *  filtering here is what makes the refusal readable instead of a 422. */
const INVITABLE_ROLES = new Set(["member", "viewer"]);

/**
 * Invite an existing account into the active workspace.
 *
 * This route used to answer 409 "workspace collaboration is deferred". It is
 * not deferred any more.
 *
 * Admin-only, enforced by the control plane against the caller's membership.
 * This route holds no opinion about who may invite, because a check here would
 * bind only callers who come through the web app.
 */
export async function POST(request: Request) {
  const { accessToken } = await getMajoranaAuth({ ensureSignedIn: true });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "expected a JSON body" }, { status: 400 });
  }
  const record = (body ?? {}) as { email?: unknown; role?: unknown };
  const email = typeof record.email === "string" ? record.email.trim().toLowerCase() : "";
  if (!email.includes("@") || email.startsWith("@") || email.endsWith("@")) {
    return NextResponse.json({ error: "an email address is required" }, { status: 400 });
  }
  const role = typeof record.role === "string" ? record.role : "member";
  if (!INVITABLE_ROLES.has(role)) {
    return NextResponse.json({ error: "role must be member or viewer" }, { status: 400 });
  }
  try {
    const upstream = await fetchControlPlane(controlPlaneUrl("/v1/workspace/members"), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email, role }),
    });
    return new NextResponse(upstream.body, {
      status: upstream.status,
      headers: { "Content-Type": upstream.headers.get("Content-Type") ?? "application/json" },
    });
  } catch (error) {
    return controlPlaneUnavailable(error);
  }
}
