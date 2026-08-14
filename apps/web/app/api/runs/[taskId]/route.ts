/**
 * `GET /api/runs/{taskId}` — one run, for the queue-position poll (ai-ops#91).
 *
 * The sibling `conversation` route returns every turn plus every event, which
 * is the right payload to load a page with and the wrong one to poll every few
 * seconds for a single integer. This proxies the control plane's single-run
 * endpoint instead, whose `queue_position` is the field the run view is asking
 * about.
 *
 * Session glue only, like every other BFF route: no business logic, and the
 * control plane re-checks the scope, so a run in another workspace 404s there
 * rather than being filtered here.
 */
import { NextResponse } from "next/server";
import { getMajoranaAuth } from "../../../../lib/auth";
import { controlPlaneUnavailable, controlPlaneUrl, fetchControlPlane } from "../../../../lib/control-plane";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ taskId: string }> },
) {
  const { taskId } = await params;
  const { accessToken } = await getMajoranaAuth({ ensureSignedIn: true });

  try {
    const upstream = await fetchControlPlane(
      controlPlaneUrl(`/v1/runs/${encodeURIComponent(taskId)}`),
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );
    return new NextResponse(upstream.body, {
      status: upstream.status,
      headers: {
        "Content-Type": upstream.headers.get("Content-Type") ?? "application/json",
        // Never cached: the whole point of this route is that the answer is
        // different a few seconds from now.
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return controlPlaneUnavailable(error);
  }
}
