import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { BrandMark } from "../../components/icons";
import { PublicSite } from "../../components/public-site";
import { getPublicLocale } from "../../lib/public-locale-server";
import {
  isSingleUserLockEnabled,
  isValidSessionCookie,
  LOCK_COOKIE,
  safeReturnTo,
} from "../../lib/single-user-lock";
import { LockSignInForm } from "./sign-in-form";

export const metadata: Metadata = {
  title: "Sign in — Leona Quantum",
  robots: { index: false, follow: false },
};

const HEADING = {
  en: { title: "Sign in", lede: "Enter your Leona Quantum credentials to open the workspace." },
  ja: { title: "サインイン", lede: "Leona Quantum の資格情報を入力してワークスペースを開きます。" },
} as const;

export default async function LockSignInPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string }>;
}) {
  // When the lock is off, this page is meaningless — route to the normal home.
  if (!isSingleUserLockEnabled()) redirect("/");

  const { returnTo } = await searchParams;
  const destination = safeReturnTo(returnTo);

  // Already signed in? Skip the form.
  const store = await cookies();
  if (await isValidSessionCookie(store.get(LOCK_COOKIE)?.value)) redirect(destination);

  const locale = await getPublicLocale();
  const copy = HEADING[locale];

  return (
    <PublicSite activePath="/lock-sign-in" className="mj-lock-page" locale={locale}>
      <section className="mj-lock-shell">
        <div className="mj-lock-card">
          <div className="mj-lock-card-head">
            <BrandMark size={36} />
            <h1>{copy.title}</h1>
            <p>{copy.lede}</p>
          </div>
          <LockSignInForm locale={locale} returnTo={destination} />
        </div>
      </section>
    </PublicSite>
  );
}
