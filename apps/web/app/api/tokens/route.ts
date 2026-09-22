import { NextResponse } from "next/server";
import { getMajoranaAuth } from "../../../lib/auth";
import { controlPlaneUnavailable, controlPlaneUrl, fetchControlPlane } from "../../../lib/control-plane";

export const dynamic = "force-dynamic";

/**
 * The signed-in person's own personal access tokens. Proxies `GET /v1/tokens`.
 *
 * Whose tokens is decided by the bearer token this route attaches, never by a
 * parameter: there is no user or workspace id to forward, so there is nothing a
 * caller could edit to ask for somebody else's.
 *
 * A **404 is a real answer here**, not an error to smooth over. The control plane
 * answers 404 for every route in this family while `MAJORANA_PERSONAL_ACCESS_TOKENS`
 * is off, and the settings pane reads that as "this deployment has no tokens" and
 * renders nothing. So the status is passed through exactly as it came.
 */
export async function GET() {
  const { accessToken } = await getMajoranaAuth({ ensureSignedIn: true });
  try {
    const upstream = await fetchControlPlane(controlPlaneUrl("/v1/tokens"), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    return new NextResponse(upstream.body, {
      status: upstream.status,
      headers: { "Content-Type": upstream.headers.get("Content-Type") ?? "application/json" },
    });
  } catch (error) {
    return controlPlaneUnavailable(error);
  }
}

/**
 * Mint one: `CreateTokenRequest` -> `MintedToken`. Proxies `POST /v1/tokens`.
 *
 * The response carries the secret, once. Nothing here logs the body, and the
 * upstream body is streamed through rather than parsed, so the token does not
 * become a value in this process at all.
 */
export async function POST(request: Request) {
  const [{ accessToken }, body] = await Promise.all([
    getMajoranaAuth({ ensureSignedIn: true }),
    request.text(),
  ]);
  try {
    const upstream = await fetchControlPlane(controlPlaneUrl("/v1/tokens"), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": request.headers.get("Content-Type") ?? "application/json",
      },
      body,
    });
    return new NextResponse(upstream.body, {
      status: upstream.status,
      headers: { "Content-Type": upstream.headers.get("Content-Type") ?? "application/json" },
    });
  } catch (error) {
    return controlPlaneUnavailable(error);
  }
}
