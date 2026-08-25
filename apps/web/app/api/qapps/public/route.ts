import { controlPlaneUnavailable, controlPlaneUrl, fetchControlPlane, forwardFromControlPlane } from "../../../../lib/control-plane";

export async function GET() {
  try {
    return forwardFromControlPlane(await fetchControlPlane(controlPlaneUrl("/v1/qapps/public")));
  } catch (error) {
    return controlPlaneUnavailable(error);
  }
}
