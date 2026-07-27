import { NextResponse } from "next/server";
import { getMajoranaAuth } from "../../../../lib/auth";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export const dynamic = "force-dynamic";

/**
 * Retire a shared workspace you own.
 *
 * POST rather than DELETE because the workspace is named in a body: it is
 * usually not the one the caller is standing in, and a DELETE with a body is
 * the kind of thing intermediaries drop. The upstream refusals — 403 for a
 * member who is not the owner, 409 for a personal workspace — carry a
 * `detail.error` and are passed through rather than reworded here.
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
    const upstream = await fetch(new URL("/v1/workspaces/delete", API_URL), {
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
