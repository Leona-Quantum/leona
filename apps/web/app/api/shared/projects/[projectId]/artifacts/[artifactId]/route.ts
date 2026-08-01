import { getMajoranaAuth } from "../../../../../../../lib/auth";
import {
  controlPlaneUnavailable,
  controlPlaneUrl,
  fetchControlPlane,
  forwardFromControlPlane,
} from "../../../../../../../lib/control-plane";

export const dynamic = "force-dynamic";

/** One shared circuit, with its current version's verification grade. */
export async function GET(
  _request: Request,
  context: { params: Promise<{ projectId: string; artifactId: string }> },
) {
  const { projectId, artifactId } = await context.params;
  const { accessToken } = await getMajoranaAuth({ ensureSignedIn: true });
  try {
    return forwardFromControlPlane(
      await fetchControlPlane(
        controlPlaneUrl(
          `/v1/shared/projects/${encodeURIComponent(projectId)}/artifacts/${encodeURIComponent(artifactId)}`,
        ),
        { headers: { Authorization: `Bearer ${accessToken}` } },
      ),
    );
  } catch (error) {
    return controlPlaneUnavailable(error);
  }
}
