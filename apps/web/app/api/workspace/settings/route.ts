import { NextResponse } from "next/server";
import { getMajoranaAuth } from "../../../../lib/auth";
import { controlPlaneUnavailable, controlPlaneUrl, fetchControlPlane } from "../../../../lib/control-plane";

export const dynamic = "force-dynamic";

/**
 * Workspace preferences. Only `auto_keep_artifacts` today (migration 0036).
 *
 * The body is re-serialised from a validated shape rather than forwarded: the
 * upstream model forbids extra fields, and passing the browser's JSON straight
 * through would turn a client typo into a 422 the user cannot read.
 */
export async function PATCH(request: Request) {
  const { accessToken } = await getMajoranaAuth({ ensureSignedIn: true });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "expected a JSON body" }, { status: 400 });
  }
  const autoKeep =
    body && typeof body === "object" && "auto_keep_artifacts" in body
      ? (body as { auto_keep_artifacts: unknown }).auto_keep_artifacts
      : undefined;
  if (typeof autoKeep !== "boolean") {
    return NextResponse.json({ error: "auto_keep_artifacts must be a boolean" }, { status: 400 });
  }
  try {
    const upstream = await fetchControlPlane(controlPlaneUrl("/v1/workspace/settings"), {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ auto_keep_artifacts: autoKeep }),
    });
    return new NextResponse(upstream.body, {
      status: upstream.status,
      headers: { "Content-Type": upstream.headers.get("Content-Type") ?? "application/json" },
    });
  } catch (error) {
    return controlPlaneUnavailable(error);
  }
}
