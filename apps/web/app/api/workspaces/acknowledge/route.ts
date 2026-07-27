import { NextResponse } from "next/server";
import { getMajoranaAuth } from "../../../../lib/auth";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export const dynamic = "force-dynamic";

/**
 * Stop announcing a workspace — the notice's "not now".
 *
 * The id is not trusted here and is not meant to be: the control plane resolves
 * it against the caller's own memberships and answers 404 for one they do not
 * belong to. This route only checks it is a string, because sending anything
 * else would produce an unreadable 422.
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
    const upstream = await fetch(new URL("/v1/workspaces/acknowledge", API_URL), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ workspace_id: workspaceId }),
      cache: "no-store",
    });
    // 204 upstream. Forwarding `upstream.body` would be a null stream with a
    // JSON content type, which some clients read as a parse error.
    if (upstream.status === 204) return new NextResponse(null, { status: 204 });
    return new NextResponse(upstream.body, {
      status: upstream.status,
      headers: { "Content-Type": upstream.headers.get("Content-Type") ?? "application/json" },
    });
  } catch {
    return NextResponse.json({ error: "control plane unavailable" }, { status: 502 });
  }
}
