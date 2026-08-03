import { getMajoranaAuth } from "../../../../../../lib/auth";
import {
  controlPlaneUnavailable,
  controlPlaneUrl,
  fetchControlPlane,
  forwardFromControlPlane,
} from "../../../../../../lib/control-plane";

export const dynamic = "force-dynamic";

function upstreamUrl(projectId: string) {
  return controlPlaneUrl(`/v1/workspace/projects/${encodeURIComponent(projectId)}/shares`);
}

/** Who this project is shared with. Admin-only upstream; a 403 forwards as one. */
export async function GET(_request: Request, context: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await context.params;
  const { accessToken } = await getMajoranaAuth({ ensureSignedIn: true });
  try {
    return forwardFromControlPlane(
      await fetchControlPlane(upstreamUrl(projectId), {
        headers: { Authorization: `Bearer ${accessToken}` },
      }),
    );
  } catch (error) {
    return controlPlaneUnavailable(error);
  }
}

/**
 * Share it, or change what somebody may do with it.
 *
 * The body goes through untouched. Validating the address or the role here as
 * well as upstream would mean two definitions of a valid grant, and the one the
 * browser can see is not the one that decides.
 */
export async function POST(request: Request, context: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await context.params;
  const { accessToken } = await getMajoranaAuth({ ensureSignedIn: true });
  try {
    return forwardFromControlPlane(
      await fetchControlPlane(upstreamUrl(projectId), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": request.headers.get("Content-Type") ?? "application/json",
        },
        body: await request.text(),
      }),
    );
  } catch (error) {
    return controlPlaneUnavailable(error);
  }
}

/** Stop sharing with everybody, without deleting the project. */
export async function DELETE(
  _request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await context.params;
  const { accessToken } = await getMajoranaAuth({ ensureSignedIn: true });
  try {
    return forwardFromControlPlane(
      await fetchControlPlane(upstreamUrl(projectId), {
        method: "DELETE",
        headers: { Authorization: `Bearer ${accessToken}` },
      }),
    );
  } catch (error) {
    return controlPlaneUnavailable(error);
  }
}
