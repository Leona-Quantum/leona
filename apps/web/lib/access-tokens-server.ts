import "server-only";

import { featureIsAbsent } from "./access-tokens";
import { getMajoranaAuth } from "./auth";
import { controlPlaneUrl, fetchControlPlane } from "./control-plane";

/**
 * Whether this deployment has personal access tokens switched on.
 *
 * Asked of the control plane rather than read from an environment variable here,
 * because the switch is `MAJORANA_PERSONAL_ACCESS_TOKENS` on the API and there must be
 * exactly one of it. A second variable in the web app would be the same setting stored
 * twice, and the interesting state — the one nobody tests — is the two disagreeing: a
 * page offering a feature the API refuses, or hiding one it serves.
 *
 * Resolved server-side, before the settings page renders, because the pane has to be
 * ABSENT and not merely empty. A client check can only hide the panel's contents; the
 * rail entry is built from the pane list, so a pane registered unconditionally leaves
 * an "Access tokens" link that opens onto nothing (Greptile, PR 973).
 *
 * **Fails closed.** An unreachable control plane returns false, so the pane disappears
 * during an outage rather than offering buttons that cannot work. That is the right
 * way round for this pane specifically: every action in it is a credential operation,
 * and a half-working credential page is worse than an absent one. It also matches what
 * the API itself does with a token while the switch is off.
 */
export async function personalAccessTokensEnabled(): Promise<boolean> {
  const { accessToken } = await getMajoranaAuth({ ensureSignedIn: true });
  try {
    const upstream = await fetchControlPlane(controlPlaneUrl("/v1/tokens"), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    // 404 is the switched-off answer and the only one that means "no feature here".
    // Any other failure is an outage, and this fails closed on both.
    if (featureIsAbsent(upstream.status)) return false;
    return upstream.ok;
  } catch {
    return false;
  }
}
