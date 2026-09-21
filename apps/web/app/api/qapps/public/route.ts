import { controlPlaneUnavailable, controlPlaneUrl, fetchControlPlane, forwardFromControlPlane } from "../../../../lib/control-plane";

/**
 * Forwards search and paging straight through to the control plane's own
 * `q`/`cursor`/`limit` params — this route holds no pagination or search
 * logic of its own, so the two cannot drift.
 */
export async function GET(request: Request) {
  try {
    const url = controlPlaneUrl("/v1/qapps/public");
    const incoming = new URL(request.url).searchParams;
    for (const key of ["q", "cursor", "limit"]) {
      const value = incoming.get(key);
      if (value !== null) url.searchParams.set(key, value);
    }
    return forwardFromControlPlane(await fetchControlPlane(url));
  } catch (error) {
    return controlPlaneUnavailable(error);
  }
}
