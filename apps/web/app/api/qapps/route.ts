import { getMajoranaAuth } from "../../../lib/auth";
import { controlPlaneUnavailable, controlPlaneUrl, fetchControlPlane, forwardFromControlPlane } from "../../../lib/control-plane";

export async function GET() {
  const { accessToken } = await getMajoranaAuth({ ensureSignedIn: true });
  try {
    return forwardFromControlPlane(await fetchControlPlane(controlPlaneUrl("/v1/qapps"), {
      headers: { Authorization: `Bearer ${accessToken}` },
    }));
  } catch (error) {
    return controlPlaneUnavailable(error);
  }
}
