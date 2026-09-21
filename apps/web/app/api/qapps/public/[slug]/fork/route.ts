import { getMajoranaAuth } from "../../../../../../lib/auth";
import { controlPlaneUnavailable, controlPlaneUrl, fetchControlPlane, forwardFromControlPlane } from "../../../../../../lib/control-plane";

/**
 * Forking requires a signed-in caller, even though it lives under the
 * `/api/qapps/public` subtree — that path is in `PUBLIC_PATHS` (its whole
 * subtree is unauthenticated as far as `middleware.ts` is concerned), the
 * same shape `/api/qapps/public/{executions,visibility}` already have via
 * the sibling `[qappKey]` route. `getMajoranaAuth({ ensureSignedIn: true })`
 * is this route's own gate — see `lib/public-paths.ts`'s comment on the
 * `/api/qapps/public` entry for why that is deliberate defence-in-depth
 * rather than an oversight, and why this file needs no change there.
 */
export async function POST(_request: Request, context: { params: Promise<{ slug: string }> }) {
  const [{ accessToken }, { slug }] = await Promise.all([getMajoranaAuth({ ensureSignedIn: true }), context.params]);
  try {
    return forwardFromControlPlane(
      await fetchControlPlane(controlPlaneUrl(`/v1/qapps/public/${encodeURIComponent(slug)}/fork`), {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
      }),
    );
  } catch (error) { return controlPlaneUnavailable(error); }
}
