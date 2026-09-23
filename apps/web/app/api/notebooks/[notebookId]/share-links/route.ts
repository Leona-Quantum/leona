import { NextResponse } from "next/server";
import { getMajoranaAuth } from "../../../../../lib/auth";
import { controlPlaneUnavailable, controlPlaneUrl, fetchControlPlane } from "../../../../../lib/control-plane";

export const dynamic = "force-dynamic";

/**
 * This notebook's share links, newest first. Proxies `GET /v1/notebooks/{id}/share-links`.
 *
 * Creator-only at the control plane: a signed-in workspace member who did not
 * create this notebook gets 403 from upstream, forwarded as-is — the dialog
 * that calls this should never render for them in the first place, but the
 * route does not trust that and re-derives nothing here.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ notebookId: string }> },
) {
  const [{ accessToken }, { notebookId }] = await Promise.all([
    getMajoranaAuth({ ensureSignedIn: true }),
    params,
  ]);
  try {
    const upstream = await fetchControlPlane(
      controlPlaneUrl(`/v1/notebooks/${encodeURIComponent(notebookId)}/share-links`),
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    return new NextResponse(upstream.body, {
      status: upstream.status,
      headers: { "Content-Type": upstream.headers.get("Content-Type") ?? "application/json" },
    });
  } catch (error) {
    return controlPlaneUnavailable(error);
  }
}

/**
 * Mint one: `CreateNotebookShareLinkRequest` -> `MintedNotebookShareLink`.
 * Proxies `POST /v1/notebooks/{id}/share-links`.
 *
 * The response carries the secret token, once — same discipline
 * `app/api/tokens/route.ts` follows for personal access tokens: the upstream
 * body is streamed through rather than parsed, so the token never becomes a
 * value in this process, and nothing here logs the body.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ notebookId: string }> },
) {
  const [{ accessToken }, { notebookId }, body] = await Promise.all([
    getMajoranaAuth({ ensureSignedIn: true }),
    params,
    request.text(),
  ]);
  try {
    const upstream = await fetchControlPlane(
      controlPlaneUrl(`/v1/notebooks/${encodeURIComponent(notebookId)}/share-links`),
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": request.headers.get("Content-Type") ?? "application/json",
          ...(request.headers.get("Idempotency-Key")
            ? { "Idempotency-Key": request.headers.get("Idempotency-Key")! }
            : {}),
        },
        body,
      },
    );
    return new NextResponse(upstream.body, {
      status: upstream.status,
      headers: { "Content-Type": upstream.headers.get("Content-Type") ?? "application/json" },
    });
  } catch (error) {
    return controlPlaneUnavailable(error);
  }
}
