import { NextResponse } from "next/server";
import { getMajoranaAuth } from "../../../../../lib/auth";
import { controlPlaneUnavailable, controlPlaneUrl, fetchControlPlane } from "../../../../../lib/control-plane";

export const dynamic = "force-dynamic";

/**
 * One reader's attempt at the graded cells: `GradeAttemptRequest` -> `{ run_id,
 * graded_cells }`, 202.
 *
 * `Idempotency-Key` is forwarded, the same way `POST /api/notebooks` forwards it: a
 * retried attempt must not buy a second sandbox run and a competing grading stream.
 *
 * A pass-through like every other notebook route, and deliberately nothing more.
 * Grading is decided on the control plane because the assertion that decides an
 * exercise must never reach the browser — a rule this route would quietly undo if it
 * ever grew logic of its own about what a correct answer is. The verdicts arrive on
 * the run's event stream as `notebook.grades`.
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
  const idempotencyKey = request.headers.get("Idempotency-Key");
  try {
    const upstream = await fetchControlPlane(
      controlPlaneUrl(`/v1/notebooks/${encodeURIComponent(notebookId)}/attempts`),
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": request.headers.get("Content-Type") ?? "application/json",
          ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
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
