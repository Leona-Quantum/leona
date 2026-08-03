import { NextResponse } from "next/server";
import { getMajoranaAuth } from "../../../../lib/auth";
import { controlPlaneUnavailable, controlPlaneUrl, fetchControlPlane } from "../../../../lib/control-plane";

export const dynamic = "force-dynamic";

/** Bring a circuit you already wrote into your own Library.
 *
 * A pass-through on purpose. Every refusal this can produce is the control
 * plane's — the source binds neither FINAL_CIRCUIT nor RESULT, it fails the
 * framework contract, or the workspace is at its artifact cap — and each one
 * arrives as a body the caller renders. Re-deciding any of them here would put
 * a second copy of the rule in a separately-deployed unit, which is how a
 * client fast path becomes the gate the moment the server's rule moves.
 */
export async function POST(request: Request) {
  const { accessToken } = await getMajoranaAuth({ ensureSignedIn: true });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }
  try {
    const upstream = await fetchControlPlane(controlPlaneUrl("/v1/artifacts/import-source"), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    return new NextResponse(upstream.body, {
      status: upstream.status,
      headers: { "Content-Type": upstream.headers.get("Content-Type") ?? "application/json" },
    });
  } catch (error) {
    return controlPlaneUnavailable(error);
  }
}
