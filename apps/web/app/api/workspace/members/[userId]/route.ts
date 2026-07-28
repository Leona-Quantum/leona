import { NextResponse } from "next/server";
import { getMajoranaAuth } from "../../../../../lib/auth";
import { controlPlaneUnavailable, controlPlaneUrl, fetchControlPlane } from "../../../../../lib/control-plane";

export const dynamic = "force-dynamic";

/** Roles a member can be moved to. OWNER is an ownership transfer and is not
 *  one of them; the control plane refuses it independently. */
const ASSIGNABLE_ROLES = new Set(["admin", "member", "viewer"]);

type Context = { params: Promise<{ userId: string }> };

/** Change a member's role. Admin-only, enforced upstream. */
export async function PATCH(request: Request, context: Context) {
  const { accessToken } = await getMajoranaAuth({ ensureSignedIn: true });
  const { userId } = await context.params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "expected a JSON body" }, { status: 400 });
  }
  const role =
    body && typeof body === "object" && "role" in body
      ? (body as { role: unknown }).role
      : undefined;
  if (typeof role !== "string" || !ASSIGNABLE_ROLES.has(role)) {
    return NextResponse.json({ error: "role must be admin, member or viewer" }, { status: 400 });
  }
  return proxy(`/v1/workspace/members/${encodeURIComponent(userId)}`, {
    method: "PATCH",
    accessToken,
    body: JSON.stringify({ role }),
  });
}

/** Revoke access. Their runs and artifacts stay — they are the workspace's. */
export async function DELETE(_request: Request, context: Context) {
  const { accessToken } = await getMajoranaAuth({ ensureSignedIn: true });
  const { userId } = await context.params;
  return proxy(`/v1/workspace/members/${encodeURIComponent(userId)}`, {
    method: "DELETE",
    accessToken,
  });
}

async function proxy(
  path: string,
  options: { method: string; accessToken: string; body?: string },
): Promise<Response> {
  try {
    const upstream = await fetchControlPlane(controlPlaneUrl(path), {
      method: options.method,
      headers: {
        Authorization: `Bearer ${options.accessToken}`,
        ...(options.body ? { "Content-Type": "application/json" } : {}),
      },
      body: options.body,
    });
    // 204 carries no body, and constructing a NextResponse with one for a 204
    // throws in the Node runtime.
    if (upstream.status === 204) return new NextResponse(null, { status: 204 });
    return new NextResponse(upstream.body, {
      status: upstream.status,
      headers: { "Content-Type": upstream.headers.get("Content-Type") ?? "application/json" },
    });
  } catch (error) {
    return controlPlaneUnavailable(error);
  }
}
