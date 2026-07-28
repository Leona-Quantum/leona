import { NextResponse } from "next/server";
import { getMajoranaAuth } from "../../../../lib/auth";
import { controlPlaneUnavailable, controlPlaneUrl, fetchControlPlane } from "../../../../lib/control-plane";

export const dynamic = "force-dynamic";

/**
 * Change which workspace this account's requests act in.
 *
 * The id in the body is not trusted here and is not meant to be: the control
 * plane validates it against the caller's memberships and answers 404 for one
 * they do not belong to, which is the same answer it gives for a workspace that
 * does not exist. This route only checks it is a string, because sending
 * something else would produce an unreadable 422.
 *
 * The caller reloads the page afterwards rather than re-rendering. The browser's
 * local mirror of chats and Vault entries is keyed by workspace, and that key is
 * read during the authenticated layout's render — so a soft navigation would
 * leave the previous workspace's sidebar on screen next to the new workspace's
 * data.
 */
export async function POST(request: Request) {
  const { accessToken } = await getMajoranaAuth({ ensureSignedIn: true });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "expected a JSON body" }, { status: 400 });
  }
  const workspaceId =
    body && typeof body === "object" && "workspace_id" in body
      ? (body as { workspace_id: unknown }).workspace_id
      : undefined;
  if (typeof workspaceId !== "string" || !workspaceId) {
    return NextResponse.json({ error: "workspace_id is required" }, { status: 400 });
  }
  try {
    const upstream = await fetchControlPlane(controlPlaneUrl("/v1/workspaces/active"), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ workspace_id: workspaceId }),
    });
    return new NextResponse(upstream.body, {
      status: upstream.status,
      headers: { "Content-Type": upstream.headers.get("Content-Type") ?? "application/json" },
    });
  } catch (error) {
    return controlPlaneUnavailable(error);
  }
}
