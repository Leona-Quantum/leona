import { getMajoranaAuth } from "../../../../../../../../lib/auth";
import {
  controlPlaneUnavailable,
  controlPlaneUrl,
  fetchControlPlane,
  forwardFromControlPlane,
} from "../../../../../../../../lib/control-plane";

export const dynamic = "force-dynamic";

function upstreamUrl(projectId: string, artifactId: string) {
  return controlPlaneUrl(
    `/v1/shared/projects/${encodeURIComponent(projectId)}/artifacts/${encodeURIComponent(artifactId)}/versions`,
  );
}

/** A shared circuit's history. */
export async function GET(
  request: Request,
  context: { params: Promise<{ projectId: string; artifactId: string }> },
) {
  const { projectId, artifactId } = await context.params;
  const { accessToken } = await getMajoranaAuth({ ensureSignedIn: true });
  const beforeSeq = new URL(request.url).searchParams.get("before_seq");
  const url = upstreamUrl(projectId, artifactId);
  if (beforeSeq) url.searchParams.set("before_seq", beforeSeq);
  try {
    return forwardFromControlPlane(
      await fetchControlPlane(url, { headers: { Authorization: `Bearer ${accessToken}` } }),
    );
  } catch (error) {
    return controlPlaneUnavailable(error);
  }
}

/**
 * Save an edit to a shared circuit. Editor grants only.
 *
 * The 409 that comes back when somebody else saved first is forwarded whole,
 * because its body names the version that won and the client needs that id to
 * offer "open theirs" and then to re-save on top of it.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string; artifactId: string }> },
) {
  const { projectId, artifactId } = await context.params;
  const { accessToken } = await getMajoranaAuth({ ensureSignedIn: true });
  try {
    return forwardFromControlPlane(
      await fetchControlPlane(upstreamUrl(projectId, artifactId), {
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
