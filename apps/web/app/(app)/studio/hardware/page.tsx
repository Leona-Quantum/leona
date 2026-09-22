import { getAccountTier } from "../../../../lib/account-tier-server";
import { getPublicLocale } from "../../../../lib/public-locale-server";
import { HardwareRuns } from "./hardware-runs";

// The page's own name only: the root layout's title template appends
// " · Leona Quantum" (`lib/public-metadata.ts`), so writing the site name here
// as well would put it in the tab twice.
export const metadata = { title: "Hardware runs" };

/**
 * The workspace's hardware runs, grouped by the machine that ran them
 * (proposal 5, increment 2). Under `/studio` because that is where hardware
 * jobs are sent from, which also keeps it inside the `studio` routed segment
 * and its auth gate (`lib/routed-paths.ts`).
 *
 * The tier's browser-simulation limits cross to the client for the same reason
 * Studio's page passes them: the ideal distribution is computed in the reader's
 * browser, under the same bound Studio's hardware panel applies.
 */
export default async function HardwareRunsPage() {
  const [locale, { limits }] = await Promise.all([getPublicLocale(), getAccountTier()]);
  return <HardwareRuns locale={locale} limits={limits} />;
}
