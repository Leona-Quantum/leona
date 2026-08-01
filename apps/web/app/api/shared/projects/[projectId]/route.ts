import { getMajoranaAuth } from "../../../../../lib/auth";
import {
  controlPlaneUnavailable,
  controlPlaneUrl,
  fetchControlPlane,
  forwardFromControlPlane,
} from "../../../../../lib/control-plane";

export const dynamic = "force-dynamic";

/** One shared project's header, including the revision a client polls. */
export async function GET(_request: Request, context: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await context.params;
  const { accessToken } = await getMajoranaAuth({ ensureSignedIn: true });
  try {
    return forwardFromControlPlane(
      await fetchControlPlane(
        controlPlaneUrl(`/v1/shared/projects/${encodeURIComponent(projectId)}`),
        { headers: { Authorization: `Bearer ${accessToken}` } },
      ),
    );
  } catch (error) {
    return controlPlaneUnavailable(error);
  }
}
