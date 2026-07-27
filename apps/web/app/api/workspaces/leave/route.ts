import { NextResponse } from "next/server";
import { getMajoranaAuth } from "../../../../lib/auth";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export const dynamic = "force-dynamic";

/**
 * Give up your own access to a workspace somebody else runs.
 *
 * Distinct from `DELETE /api/workspace/members/{id}`, which is an admin
 * removing someone from the workspace currently open. This one is the member's
 * own decision about a workspace named by id, so declining an invitation does
 * not require entering the tenant you want out of.
 *
 * The owner is refused upstream with a 409 whose `detail.error` says why; the
 * refusal is passed through rather than reworded here.
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
    const upstream = await fetch(new URL("/v1/workspaces/leave", API_URL), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ workspace_id: workspaceId }),
      cache: "no-store",
    });
    if (upstream.status === 204) return new NextResponse(null, { status: 204 });
    return new NextResponse(upstream.body, {
      status: upstream.status,
      headers: { "Content-Type": upstream.headers.get("Content-Type") ?? "application/json" },
    });
  } catch {
    return NextResponse.json({ error: "control plane unavailable" }, { status: 502 });
  }
}
