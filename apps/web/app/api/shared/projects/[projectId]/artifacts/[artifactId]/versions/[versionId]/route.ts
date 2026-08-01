import { getMajoranaAuth } from "../../../../../../../../../lib/auth";
import {
  controlPlaneUnavailable,
  controlPlaneUrl,
  fetchControlPlane,
  forwardFromControlPlane,
} from "../../../../../../../../../lib/control-plane";

export const dynamic = "force-dynamic";

/**
 * One version's actual content — the code a shared circuit is opened with.
 *
 * This file was missing on the first pass, and nothing said so: the control
 * plane answered 200, every Python test passed, and the browser got a Next 404
 * because no handler existed at this path. The shared project page rendered its
 * list perfectly and simply could not open anything.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ projectId: string; artifactId: string; versionId: string }> },
) {
  const { projectId, artifactId, versionId } = await context.params;
  const { accessToken } = await getMajoranaAuth({ ensureSignedIn: true });
  try {
    return forwardFromControlPlane(
      await fetchControlPlane(
        controlPlaneUrl(
          `/v1/shared/projects/${encodeURIComponent(projectId)}/artifacts/${encodeURIComponent(artifactId)}/versions/${encodeURIComponent(versionId)}`,
        ),
        { headers: { Authorization: `Bearer ${accessToken}` } },
      ),
    );
  } catch (error) {
    return controlPlaneUnavailable(error);
  }
}
