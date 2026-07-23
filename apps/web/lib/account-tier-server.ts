import "server-only";

import { getMajoranaAuth } from "./auth";
import {
  limitsForTier,
  resolveAccountTier,
  type AccountTier,
  type TierLimits,
} from "./account-tier";

/**
 * The signed-in viewer's tier, resolved server-side.
 *
 * Server-only because the developer allowlist lives in LEONA_DEVELOPER_EMAILS,
 * which must never reach the browser bundle: it is a list of real collaborator
 * addresses. Pages resolve the tier here and pass the resulting LIMITS (plain
 * numbers) to client components — never the allowlist, and never the raw env.
 */
export async function getAccountTier(
  options: { isDemoSurface?: boolean } = {},
): Promise<{ tier: AccountTier; limits: TierLimits; email: string | null }> {
  if (options.isDemoSurface) {
    return { tier: "demo", limits: limitsForTier("demo"), email: null };
  }
  const { user } = await getMajoranaAuth();
  const email = user?.email ?? null;
  const tier = resolveAccountTier(email);
  return { tier, limits: limitsForTier(tier), email };
}
