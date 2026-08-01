import { AccountContent } from "../../account/account-content";
import { AccountModal } from "../../account/account-modal";
import { getPublicLocale } from "../../../../lib/public-locale-server";

/**
 * /account, intercepted.
 *
 * `(.)` means "the same level as the slot's parent" — the slot lives at
 * `app/(app)/@modal`, so this matches `app/(app)/account`, i.e. the URL
 * /account. Next.js applies it to CLIENT-SIDE navigations only, which is the
 * whole load-bearing detail of this feature: every in-app link to /account has
 * to be a next/link <Link>, because a plain <a> is a document load and lands on
 * the full page instead. lib/account-entry-points.test.ts says so in a form
 * that fails, because the failure mode is silent — the full page still renders
 * and everything looks like it works.
 *
 * The body is the same component the page renders. Only the frame differs.
 */
export default async function AccountModalRoute() {
  const locale = await getPublicLocale();
  return (
    <AccountModal locale={locale}>
      <AccountContent />
    </AccountModal>
  );
}
