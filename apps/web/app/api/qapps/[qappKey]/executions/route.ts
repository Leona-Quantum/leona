import { getMajoranaAuth } from "../../../../../lib/auth";
import { controlPlaneUnavailable, controlPlaneUrl, fetchControlPlane, forwardFromControlPlane } from "../../../../../lib/control-plane";

export async function POST(request: Request, context: { params: Promise<{ qappKey: string }> }) {
  const [{ accessToken }, { qappKey }, body] = await Promise.all([getMajoranaAuth({ ensureSignedIn: true }), context.params, request.text()]);
  try {
    return forwardFromControlPlane(await fetchControlPlane(controlPlaneUrl(`/v1/qapps/${encodeURIComponent(qappKey)}/executions`), {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body,
    }));
  } catch (error) { return controlPlaneUnavailable(error); }
}
