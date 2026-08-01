import { getMajoranaAuth } from "../../../../../../lib/auth";
import {
  controlPlaneUnavailable,
  controlPlaneUrl,
  fetchControlPlane,
  forwardFromControlPlane,
} from "../../../../../../lib/control-plane";

export const dynamic = "force-dynamic";

/** The circuits inside a shared project. */
export async function GET(_request: Request, context: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await context.params;
  const { accessToken } = await getMajoranaAuth({ ensureSignedIn: true });
  try {
    return forwardFromControlPlane(
      await fetchControlPlane(
        controlPlaneUrl(`/v1/shared/projects/${encodeURIComponent(projectId)}/artifacts`),
        { headers: { Authorization: `Bearer ${accessToken}` } },
      ),
    );
  } catch (error) {
    return controlPlaneUnavailable(error);
  }
}
