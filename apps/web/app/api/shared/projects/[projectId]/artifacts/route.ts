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

/**
 * Add a new circuit to a project shared with you (editor grants only).
 *
 * The 409 that comes back at either limit is forwarded intact. The control plane
 * writes two different sentences on purpose — the project is full, or the owner's
 * plan is — and rewording them here would collapse a distinction the contributor
 * needs: only one of the two is something they can ask to have changed.
 */
export async function POST(request: Request, context: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await context.params;
  const { accessToken } = await getMajoranaAuth({ ensureSignedIn: true });
  try {
    return forwardFromControlPlane(
      await fetchControlPlane(
        controlPlaneUrl(`/v1/shared/projects/${encodeURIComponent(projectId)}/artifacts`),
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": request.headers.get("Content-Type") ?? "application/json",
          },
          body: await request.text(),
        },
      ),
    );
  } catch (error) {
    return controlPlaneUnavailable(error);
  }
}
