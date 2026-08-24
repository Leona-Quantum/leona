import { getMajoranaAuth } from "../../../../lib/auth";
import { controlPlaneUnavailable, controlPlaneUrl, fetchControlPlane, forwardFromControlPlane } from "../../../../lib/control-plane";

export async function GET(_request: Request, context: { params: Promise<{ qappKey: string }> }) {
  const [{ accessToken }, { qappKey }] = await Promise.all([getMajoranaAuth({ ensureSignedIn: true }), context.params]);
  try {
    return forwardFromControlPlane(await fetchControlPlane(controlPlaneUrl(`/v1/qapps/${encodeURIComponent(qappKey)}`), { headers: { Authorization: `Bearer ${accessToken}` } }));
  } catch (error) { return controlPlaneUnavailable(error); }
}
