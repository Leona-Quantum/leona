import { getMajoranaAuth } from "../../../../lib/auth";
import { controlPlaneUnavailable, controlPlaneUrl, fetchControlPlane, forwardFromControlPlane } from "../../../../lib/control-plane";

/**
 * Leona's example Qapps (ai-ops 363): titles and descriptions only. Signed-in,
 * like the rest of `/api/qapps` outside the `public` subtree.
 */
export async function GET() {
  const { accessToken } = await getMajoranaAuth({ ensureSignedIn: true });
  try {
    return forwardFromControlPlane(await fetchControlPlane(controlPlaneUrl("/v1/qapps/examples"), {
      headers: { Authorization: `Bearer ${accessToken}` },
    }));
  } catch (error) {
    return controlPlaneUnavailable(error);
  }
}
