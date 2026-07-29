import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { BrandMark } from "../../components/icons";
import { PublicSite } from "../../components/public-site";
import { hasCompleteProfileName } from "../../lib/account-profile";
import { getMajoranaAuth } from "../../lib/auth";
import { getPublicLocale } from "../../lib/public-locale-server";
import { safeReturnTo } from "../../lib/return-to";
import { WelcomeNameForm } from "./welcome-form";

export const metadata: Metadata = {
  title: "Your name — Leona Quantum",
  robots: { index: false, follow: false },
};

const HEADING = {
  en: {
    title: "Tell us your name",
    lede: "Leona Quantum records who ran a circuit and who signed off on it, so an account needs a real name before it opens.",
  },
  ja: {
    title: "お名前を教えてください",
    lede: "Leona Quantum は誰が回路を実行し、誰が承認したかを記録します。そのため、アカウントを開く前に実名が必要です。",
  },
} as const;

/**
 * The one-time name gate (Owner Inbox 2026-07-27).
 *
 * Lives outside the `(app)` route group on purpose: that layout is what
 * redirects here, so a page inside it would redirect to itself forever. It is
 * still authenticated — it is absent from the middleware's PUBLIC_PATHS — which
 * is what it needs to be, since it edits the signed-in identity.
 */
export default async function WelcomePage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string }>;
}) {
  const [auth, { returnTo }, locale] = await Promise.all([
    getMajoranaAuth({ ensureSignedIn: true }),
    searchParams,
    getPublicLocale(),
  ]);
  const destination = safeReturnTo(returnTo);

  // Nothing to ask: social sign-in usually supplies both names, and a return
  // visit to a bookmarked /welcome should not re-prompt.
  if (hasCompleteProfileName(auth.user)) redirect(destination);

  const copy = HEADING[locale];
  return (
    <PublicSite activePath="/welcome" locale={locale}>
      <section className="mj-auth-shell">
        <div className="mj-auth-card">
          <div className="mj-auth-card-head">
            <BrandMark size={36} />
            <h1>{copy.title}</h1>
            <p>{copy.lede}</p>
          </div>
          <WelcomeNameForm
            locale={locale}
            returnTo={destination}
            initialFirstName={auth.user.firstName ?? ""}
            initialLastName={auth.user.lastName ?? ""}
          />
        </div>
      </section>
    </PublicSite>
  );
}
