import { getMajoranaAuth } from "../../../../../../../lib/auth";
import {
  controlPlaneUnavailable,
  controlPlaneUrl,
  fetchControlPlane,
  forwardFromControlPlane,
} from "../../../../../../../lib/control-plane";

export const dynamic = "force-dynamic";

/**
 * Revoke one person's access. Effective on their very next request.
 *
 * A 404 forwards as a 404 rather than being smoothed into a 204: an admin
 * pressing Remove on a list somebody else already changed should be told the
 * grant was not there, not shown a success for work nobody did.
 */
export async function DELETE(
  _request: Request,
  context: { params: Promise<{ projectId: string; granteeUserId: string }> },
) {
  const { projectId, granteeUserId } = await context.params;
  const { accessToken } = await getMajoranaAuth({ ensureSignedIn: true });
  try {
    return forwardFromControlPlane(
      await fetchControlPlane(
        controlPlaneUrl(
          `/v1/workspace/projects/${encodeURIComponent(projectId)}/shares/${encodeURIComponent(granteeUserId)}`,
        ),
        { method: "DELETE", headers: { Authorization: `Bearer ${accessToken}` } },
      ),
    );
  } catch (error) {
    return controlPlaneUnavailable(error);
  }
}
