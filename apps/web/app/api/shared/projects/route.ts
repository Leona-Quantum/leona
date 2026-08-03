import { getMajoranaAuth } from "../../../../lib/auth";
import {
  controlPlaneUnavailable,
  controlPlaneUrl,
  fetchControlPlane,
  forwardFromControlPlane,
} from "../../../../lib/control-plane";

export const dynamic = "force-dynamic";

/**
 * Projects other workspaces have shared with the caller.
 *
 * Nothing about the caller's own workspace reaches this handler, and nothing
 * should: the control plane resolves these from the grant rows against the
 * signed-in user, and a workspace id forwarded from here would be a value the
 * browser chose.
 */
export async function GET() {
  const { accessToken } = await getMajoranaAuth({ ensureSignedIn: true });
  try {
    return forwardFromControlPlane(
      await fetchControlPlane(controlPlaneUrl("/v1/shared/projects"), {
        headers: { Authorization: `Bearer ${accessToken}` },
      }),
    );
  } catch (error) {
    return controlPlaneUnavailable(error);
  }
}
