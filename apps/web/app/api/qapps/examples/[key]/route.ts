import { getMajoranaAuth } from "../../../../../lib/auth";
import { controlPlaneUnavailable, controlPlaneUrl, fetchControlPlane, forwardFromControlPlane } from "../../../../../lib/control-plane";

/**
 * Copies one example into the signed-in caller's own account as a new PRIVATE
 * Qapp. Publishing it stays a separate act, refused until the copy has run.
 */
export async function POST(_request: Request, context: { params: Promise<{ key: string }> }) {
  const [{ accessToken }, { key }] = await Promise.all([getMajoranaAuth({ ensureSignedIn: true }), context.params]);
  try {
    return forwardFromControlPlane(
      await fetchControlPlane(controlPlaneUrl(`/v1/qapps/examples/${encodeURIComponent(key)}`), {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
      }),
    );
  } catch (error) {
    return controlPlaneUnavailable(error);
  }
}
