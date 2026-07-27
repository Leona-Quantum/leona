import { NextResponse } from "next/server";
import { getMajoranaAuth } from "../../../../lib/auth";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export const dynamic = "force-dynamic";

/**
 * Hand the open workspace to one of its existing members.
 *
 * Under `/workspace/` rather than `/workspaces/`, matching the members routes:
 * this one acts on the workspace the caller currently has open, and the member
 * it names is chosen from that workspace's own list. The response is that list
 * with two roles changed, so the Settings panel replaces its state wholesale
 * rather than patching two rows and hoping they agree.
 */
export async function POST(request: Request) {
  const { accessToken } = await getMajoranaAuth({ ensureSignedIn: true });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "expected a JSON body" }, { status: 400 });
  }
  const userId =
    body && typeof body === "object" && "user_id" in body
      ? (body as { user_id: unknown }).user_id
      : undefined;
  if (typeof userId !== "string" || !userId) {
    return NextResponse.json({ error: "user_id is required" }, { status: 400 });
  }
  try {
    const upstream = await fetch(new URL("/v1/workspace/transfer-ownership", API_URL), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ user_id: userId }),
      cache: "no-store",
    });
    return new NextResponse(upstream.body, {
      status: upstream.status,
      headers: { "Content-Type": upstream.headers.get("Content-Type") ?? "application/json" },
    });
  } catch {
    return NextResponse.json({ error: "control plane unavailable" }, { status: 502 });
  }
}
