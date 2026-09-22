import "server-only";

import { featureIsAbsent } from "./access-tokens";
import { getMajoranaAuth } from "./auth";
import { controlPlaneUrl, fetchControlPlane } from "./control-plane";

/**
 * Whether this deployment has personal access tokens switched on.
 *
 * Asked of the control plane rather than read from an environment variable here,
 * because the switch is `LEONA_PERSONAL_ACCESS_TOKENS` on the API and there must be
 * exactly one of it. A second variable in the web app would be the same setting stored
 * twice, and the interesting state — the one nobody tests — is the two disagreeing: a
 * page offering a feature the API refuses, or hiding one it serves.
 *
 * Resolved server-side, before the settings page renders, because the pane has to be
 * ABSENT and not merely empty. A client check can only hide the panel's contents; the
 * rail entry is built from the pane list, so a pane registered unconditionally leaves
 * an "Access tokens" link that opens onto nothing (Greptile, PR 973).
 *
 * **Only a 404 hides it.** A first version failed closed on every error, and that was
 * wrong for a reason worth keeping written down: the pane is not only where a token is
 * created, it is the only place one can be REVOKED. Hiding it on a transient 401, 429
 * or 5xx takes the revoke button away from somebody who may be reaching for it because
 * a token has been compromised — at exactly the moment the API is misbehaving. So
 * anything that is not a definite "this deployment has no such feature" keeps the pane,
 * and the pane shows its own error state (Greptile, PR 973; `apps/web/AGENTS.md` asks
 * every async view for loading, empty and error states, and this is the error one).
 *
 * The asymmetry is deliberate: being wrong by showing a pane that reports an error
 * costs a confusing screen, and being wrong by hiding it costs somebody their only way
 * to revoke a credential.
 */
export async function personalAccessTokensEnabled(): Promise<boolean> {
  const { accessToken } = await getMajoranaAuth({ ensureSignedIn: true });
  try {
    const upstream = await fetchControlPlane(controlPlaneUrl("/v1/tokens"), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    // 404 is the switched-off answer, and the ONLY status that means "no feature here".
    return !featureIsAbsent(upstream.status);
  } catch {
    // Unreachable: an outage, not an absence. Show the pane and let it say so.
    return true;
  }
}
