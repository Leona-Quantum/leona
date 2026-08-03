import { getMajoranaAuth } from "../../../../../../../../lib/auth";
import {
  controlPlaneUnavailable,
  controlPlaneUrl,
  fetchControlPlane,
  forwardFromControlPlane,
} from "../../../../../../../../lib/control-plane";

export const dynamic = "force-dynamic";

/**
 * Take a copy of a shared circuit into the caller's own workspace.
 *
 * The 429 that comes back at the Vault cap is forwarded intact: its sentence is
 * the one the Studio already shows when a run cannot be filed, and rewriting it
 * here would give the same rule two different wordings.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string; artifactId: string }> },
) {
  const { projectId, artifactId } = await context.params;
  const { accessToken } = await getMajoranaAuth({ ensureSignedIn: true });
  try {
    return forwardFromControlPlane(
      await fetchControlPlane(
        controlPlaneUrl(
          `/v1/shared/projects/${encodeURIComponent(projectId)}/artifacts/${encodeURIComponent(artifactId)}/copy`,
        ),
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
