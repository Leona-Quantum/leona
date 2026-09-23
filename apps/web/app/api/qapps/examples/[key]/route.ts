import { getMajoranaAuth } from "../../../../../lib/auth";
import { controlPlaneUnavailable, controlPlaneUrl, fetchControlPlane, forwardFromControlPlane } from "../../../../../lib/control-plane";

/**
 * Copies one example into the signed-in caller's own account as a new PRIVATE
 * Qapp. Publishing it stays a separate act, refused until the copy has run.
 *
 * `Idempotency-Key` is forwarded, the way `POST /api/runs` forwards it, so a
 * retry of a copy whose response was lost gets the first copy back instead of
 * making a second one.
 */
export async function POST(request: Request, context: { params: Promise<{ key: string }> }) {
  const [{ accessToken }, { key }] = await Promise.all([getMajoranaAuth({ ensureSignedIn: true }), context.params]);
  const idempotencyKey = request.headers.get("Idempotency-Key");
  try {
    return forwardFromControlPlane(
      await fetchControlPlane(controlPlaneUrl(`/v1/qapps/examples/${encodeURIComponent(key)}`), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
        },
      }),
    );
  } catch (error) {
    return controlPlaneUnavailable(error);
  }
}
