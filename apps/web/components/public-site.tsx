import type { ReactNode } from "react";
import { getMajoranaAuth, isMajoranaAuthConfigured } from "../lib/auth";
import { majoranaSignInPath } from "../lib/sign-in";
import { PUBLIC_SHELL_COPY, type PublicLocale } from "../lib/public-locale";
import { getPublicLocale } from "../lib/public-locale-server";
import { LanguageToggle } from "./language-toggle";
import { LeonaWordmark } from "./leona-wordmark";
import { ThemeToggle } from "./theme-toggle";
import { AuthStatus } from "./auth-status";

// The repository moved to the Leona-Quantum organisation on 2026-08-14. The old
// address still 301s, so nothing was broken — it was just the pre-move name, on
// a constant the public site exports. Currently referenced nowhere; corrected
// rather than deleted because it is exported API and the fix is a line.
export const REPOSITORY_URL = "https://github.com/Leona-Quantum/leona";

export async function PublicSite({
  activePath,
  children,
  className = "",
  locale,
  showLanguageToggle = true,
  chrome = "full",
}: {
  activePath?: string;
  children: ReactNode;
  className?: string;
  locale?: PublicLocale;
  showLanguageToggle?: boolean;
  /**
   * `"none"` drops the header, the frame and the footer, leaving the `<main>`
   * and its classes.
   *
   * Added rather than letting the one route that needs it render its own
   * `<main class="mj-public-site …">` and skip this component, because the
   * moment two files know what the public shell is they start disagreeing about
   * it — and the disagreement is invisible, since neither of them fails. The
   * class list is the load-bearing part: `styles.css` scopes the entire Atlas
   * view transition on `:root:has(.mj-repository-site)`, so a surface that
   * dropped this element would lose every Atlas navigation animation with no
   * error at all, the animation simply not playing.
   *
   * What a chrome-less surface loses is the *controls*, not the settings:
   * `data-theme` is stamped on `<html>` by `app/layout.tsx` and the locale
   * comes from a cookie read on the server, so both still apply. A surface
   * asking for `"none"` therefore owes its reader a theme and a language
   * control somewhere of its own — `/repository/layers` puts both in the
   * information box's footer.
   *
   * `"static"` is the full chrome with no per-visitor part IN THE SERVER
   * RENDER: it never calls `getMajoranaAuth()`, which reaches a Dynamic API and
   * so makes the whole page uncacheable. The HTML this branch produces is the
   * same for every visitor and holds on the CDN.
   *
   * The sign-in/sign-out control is NOT frozen at "signed out" the way it used
   * to be, though (ai-ops#94 — a signed-in reader saw a different sign-in
   * status on this page than on `/repository`, which is `chrome="full"` and
   * always correct, and the inconsistency was confusing rather than merely
   * imprecise). `<AuthStatus>` renders that one control client-side: it starts
   * in the same signed-out state this render produces — so hydration matches
   * and the cached HTML is unaffected — then asks `/api/auth/session` once
   * mounted and swaps in the real state a moment later if the visitor turns
   * out to be signed in. The page stays static; only that one control learns
   * who is reading it, and it does so without ever being in the cached
   * payload itself.
   */
  chrome?: "full" | "none" | "static";
}) {
  const resolvedLocale = locale ?? await getPublicLocale();
  if (chrome === "none") {
    // Returned before `getMajoranaAuth()`, which exists only to decide what the
    // header's call-to-action says. Calling it for a page that renders no header
    // would put a WorkOS round trip in front of a public, cacheable figure for
    // no output at all.
    //
    // `lang={resolvedLocale}` — see the comment on the other `<main>` below for
    // why it lives here rather than on `<html>`.
    return (
      <main lang={resolvedLocale} className={["mj-public-site", "mj-public-site--bare", className].filter(Boolean).join(" ")}>
        {children}
      </main>
    );
  }
  const copy = PUBLIC_SHELL_COPY[resolvedLocale];
  const publicNav = [
    { href: "/", label: copy.nav.product },
    { href: "/pricing", label: copy.nav.pricing },
    { href: "/repository", label: copy.nav.repository },
    { href: "/workspace", label: copy.nav.workspace },
    { href: "/contact", label: copy.nav.contact },
  ];
  // `getMajoranaAuth()` → `withAuth()` → `headers()` reaches a Dynamic API, and
  // that alone opts every page rendering this component out of the CDN — which
  // is why `"static"` skips it.
  //
  // The sign-in href is now a constant string on BOTH branches. It used to be
  // the WorkOS authorization URL, minted here by `getMajoranaSignInUrl()`, and
  // that is a second Dynamic API read — but more importantly it is a cookie
  // write: `getSignInUrl()` → `setPKCECookie()` → `cookies().set()`, which
  // Next.js permits only in a Server Action or a Route Handler. Under
  // authkit-nextjs v2 PKCE was opt-in (`WORKOS_ENABLE_PKCE`) so the write was
  // skipped and this was merely wasteful; v4 makes PKCE unconditional, so every
  // `chrome="full"` page — `/repository/papers`, `/repository/folders`,
  // `/repository/<slug>` — returned 500 instead. See `lib/sign-in.ts` and
  // `app/auth/sign-in/route.ts`: the per-request hand-off is minted after the
  // click, never during a render.
  const { user } = chrome === "static" ? { user: null } : await getMajoranaAuth();
  const signInHref = chrome === "static" || isMajoranaAuthConfigured()
    ? majoranaSignInPath()
    : null;
  const primaryAction = user
    ? { href: "/run", label: copy.actions.workspace }
    : signInHref
      ? { href: signInHref, label: copy.actions.signIn }
      : { href: "/contact", label: copy.actions.talk };

  return (
    // `lang={resolvedLocale}`, not on `<html>` — `<html>` is declared in
    // `app/layout.tsx`, which sits ABOVE every route in the app, including the
    // ones this component never renders under (`/run`, `/account`, …). Next
    // only gives a layout the params for segments from the root down to
    // itself, so the root layout can never see `params.locale` from `[locale]`
    // below it — and there is no `lang` field on the Metadata API either
    // (checked: `next/dist/lib/metadata/types/metadata-interface.d.ts` has
    // none). Moving `<html>` itself to vary by locale would mean making
    // `app/[locale]/layout.tsx` the root layout, which `app/layout.tsx`
    // already documents as "a move of every route in the app" — a real,
    // larger decision, not this fix.
    //
    // `<main>` is the next best thing and a legitimate one: WCAG technique
    // H58 explicitly allows a `lang` change on any containing element, not
    // only `<html>`, and every visitor-facing element this component renders
    // — header, nav, the page body, footer — sits inside this one tag. It
    // costs nothing new: `resolvedLocale` above is already computed from
    // `params.locale` for every `[locale]` page (never a cookie there), the
    // same source the page body and, since PR 710, the page metadata read.
    <main lang={resolvedLocale} className={["mj-public-site", className].filter(Boolean).join(" ")}>
      <div className="mj-public-frame">
        <header className="mj-public-header">
          <a className="mj-public-brand" href="/" aria-label="Leona Quantum home" title="Leona Quantum home">
            <LeonaWordmark className="lq-wordmark--public-header" />
          </a>
          <nav className="mj-public-nav" aria-label={resolvedLocale === "ja" ? "公開ナビゲーション" : "Public navigation"}>
            {publicNav.map((item) => (
              <a
                key={item.href}
                href={item.href}
                aria-current={activePath === item.href ? "page" : undefined}
              >
                {item.label}
              </a>
            ))}
          </nav>
          {showLanguageToggle ? <LanguageToggle locale={resolvedLocale} /> : null}
          <ThemeToggle locale={resolvedLocale} />
          {chrome === "static" ? (
            <AuthStatus
              signOutLabel={copy.actions.signOut}
              signInLabel={copy.actions.signIn}
              workspaceLabel={copy.actions.workspace}
              talkLabel={copy.actions.talk}
              fallbackSignInHref={signInHref ?? "/auth/sign-in"}
            />
          ) : (
            <>
              {user ? (
                <a className="mj-public-nav-signout" href="/auth/sign-out">
                  {copy.actions.signOut}
                </a>
              ) : null}
              <a className="mj-public-nav-primary" href={primaryAction.href}>
                {primaryAction.label}
              </a>
            </>
          )}
        </header>

        {children}

        <footer className="mj-public-footer">
          <div className="mj-public-footer-brand">
            <a className="mj-public-brand" href="/" aria-label="Leona Quantum home">
              <LeonaWordmark className="lq-wordmark--public-footer" />
            </a>
            <p>{copy.footer.promise}</p>
          </div>
          <div className="mj-public-footer-links">
            <div>
              <span>{copy.footer.explore}</span>
              <a href="/repository">{copy.nav.repository}</a>
              <a href="/workspace">{copy.nav.workspace}</a>
              <a href="/pricing">{copy.nav.pricing}</a>
            </div>
            <div>
              <span>{copy.footer.company}</span>
              <a href="/contact">{copy.footer.contact}</a>
            </div>
            <div>
              <span>{copy.footer.legal}</span>
              <a href="/privacy">{copy.footer.privacy}</a>
              <a href="/terms">{copy.footer.terms}</a>
            </div>
          </div>
          <div className="mj-public-footer-bottom">
            <span>© 2026 Leona Quantum</span>
            <span>{copy.footer.builtFor}</span>
          </div>
        </footer>
      </div>
    </main>
  );
}
