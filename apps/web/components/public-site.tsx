import type { ReactNode } from "react";
import { BrandMark } from "./icons";
import { getMajoranaAuth, getMajoranaSignInUrl, isMajoranaAuthConfigured } from "../lib/auth";
import { PUBLIC_SHELL_COPY, type PublicLocale } from "../lib/public-locale";
import { getPublicLocale } from "../lib/public-locale-server";
import { LanguageToggle } from "./language-toggle";
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
   * RENDER: it never calls `getMajoranaAuth()` or `getMajoranaSignInUrl()`,
   * both of which reach a Dynamic API and so make the whole page uncacheable.
   * The HTML this branch produces is the same for every visitor and holds on
   * the CDN.
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
    // Returned before `getMajoranaAuth()` and `getMajoranaSignInUrl()`, which
    // exist only to decide what the header's call-to-action says. Calling them
    // for a page that renders no header would put a WorkOS round trip in front
    // of a public, cacheable figure for no output at all.
    return <main className={["mj-public-site", "mj-public-site--bare", className].filter(Boolean).join(" ")}>{children}</main>;
  }
  const copy = PUBLIC_SHELL_COPY[resolvedLocale];
  const publicNav = [
    { href: "/", label: copy.nav.product },
    { href: "/pricing", label: copy.nav.pricing },
    { href: "/repository", label: copy.nav.repository },
    { href: "/workspace", label: copy.nav.workspace },
    { href: "/contact", label: copy.nav.contact },
  ];
  // Both of these reach a Dynamic API — `getMajoranaAuth()` → `withAuth()` →
  // `headers()`, and `getMajoranaSignInUrl()` → `getAuthorizationUrl()` →
  // `headers()`. Either one alone opts every page rendering this component out
  // of the CDN, which is why `"static"` returns before both rather than before
  // one of them.
  const { user } = chrome === "static" ? { user: null } : await getMajoranaAuth();
  const signInHref = chrome === "static"
    ? "/auth/sign-in"
    : isMajoranaAuthConfigured() ? await getMajoranaSignInUrl() : null;
  const primaryAction = user
    ? { href: "/run", label: copy.actions.workspace }
    : signInHref
      ? { href: signInHref, label: copy.actions.signIn }
      : { href: "/contact", label: copy.actions.talk };

  return (
    <main className={["mj-public-site", className].filter(Boolean).join(" ")}>
      <div className="mj-public-frame">
        <header className="mj-public-header">
          <a className="mj-public-brand" href="/" aria-label="Leona Quantum home" title="Leona Quantum home">
            <BrandMark size={24} />
            <span>Leona Quantum</span>
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
              <BrandMark size={24} />
              <span>Leona Quantum</span>
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
