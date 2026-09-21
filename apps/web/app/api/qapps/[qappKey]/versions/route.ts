import { getMajoranaAuth } from "../../../../../lib/auth";
import { controlPlaneUnavailable, controlPlaneUrl, fetchControlPlane, forwardFromControlPlane } from "../../../../../lib/control-plane";

export async function GET(request: Request, context: { params: Promise<{ qappKey: string }> }) {
  const [{ accessToken }, { qappKey }] = await Promise.all([getMajoranaAuth({ ensureSignedIn: true }), context.params]);
  try {
    const url = controlPlaneUrl(`/v1/qapps/${encodeURIComponent(qappKey)}/versions`);
    const incoming = new URL(request.url).searchParams;
    for (const key of ["before_seq", "limit"]) {
      const value = incoming.get(key);
      if (value !== null) url.searchParams.set(key, value);
    }
    return forwardFromControlPlane(await fetchControlPlane(url, { headers: { Authorization: `Bearer ${accessToken}` } }));
  } catch (error) { return controlPlaneUnavailable(error); }
}
