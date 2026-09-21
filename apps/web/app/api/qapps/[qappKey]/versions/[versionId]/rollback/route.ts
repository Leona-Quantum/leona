import { getMajoranaAuth } from "../../../../../../../lib/auth";
import { controlPlaneUnavailable, controlPlaneUrl, fetchControlPlane, forwardFromControlPlane } from "../../../../../../../lib/control-plane";

export async function POST(_request: Request, context: { params: Promise<{ qappKey: string; versionId: string }> }) {
  const [{ accessToken }, { qappKey, versionId }] = await Promise.all([
    getMajoranaAuth({ ensureSignedIn: true }),
    context.params,
  ]);
  try {
    return forwardFromControlPlane(
      await fetchControlPlane(
        controlPlaneUrl(
          `/v1/qapps/${encodeURIComponent(qappKey)}/versions/${encodeURIComponent(versionId)}/rollback`,
        ),
        { method: "POST", headers: { Authorization: `Bearer ${accessToken}` } },
      ),
    );
  } catch (error) { return controlPlaneUnavailable(error); }
}
