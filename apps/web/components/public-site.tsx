import type { ReactNode } from "react";
import { getMajoranaAuth, getMajoranaSignInUrl, isMajoranaAuthConfigured } from "../lib/auth";
import { PUBLIC_SHELL_COPY, type PublicLocale } from "../lib/public-locale";
import { LanguageToggle } from "./language-toggle";
import { ThemeToggle } from "./theme-toggle";

export const CONTACT_EMAIL = "eshuneesh@gmail.com";
export const CONTACT_MAILTO = `mailto:${CONTACT_EMAIL}?subject=Majorana%20inquiry`;
export const REPOSITORY_URL = "https://github.com/EshMis/majorana";

export async function PublicSite({
  activePath,
  children,
  className = "",
  locale = "en",
  showLanguageToggle = false,
}: {
  activePath?: string;
  children: ReactNode;
  className?: string;
  locale?: PublicLocale;
  showLanguageToggle?: boolean;
}) {
  const copy = PUBLIC_SHELL_COPY[locale];
  const publicNav = [
    { href: "/", label: copy.nav.product },
    { href: "/pricing", label: copy.nav.pricing },
    { href: "/repository", label: copy.nav.repository },
    { href: "/open-source", label: copy.nav.openSource },
    { href: "/contact", label: copy.nav.contact },
  ];
  const { user } = await getMajoranaAuth();
  const signInHref = isMajoranaAuthConfigured() ? await getMajoranaSignInUrl() : null;
  const primaryAction = user
    ? { href: "/run", label: copy.actions.workspace }
    : signInHref
      ? { href: signInHref, label: copy.actions.signIn }
      : { href: "/contact", label: copy.actions.talk };

  return (
    <main className={["mj-public-site", className].filter(Boolean).join(" ")}>
      <div className="mj-public-frame">
        <header className="mj-public-header">
          <a className="mj-public-brand" href="/" aria-label="Majorana home">
            <span className="mj-public-brand-mark" aria-hidden="true">M</span>
            <span>Majorana</span>
          </a>
          <nav className="mj-public-nav" aria-label="Public navigation">
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
          {showLanguageToggle ? <LanguageToggle locale={locale} /> : null}
          <ThemeToggle />
          <a className="mj-public-nav-primary" href={primaryAction.href}>
            {primaryAction.label}
          </a>
        </header>

        {children}

        <footer className="mj-public-footer">
          <div className="mj-public-footer-brand">
            <a className="mj-public-brand" href="/">
              <span className="mj-public-brand-mark" aria-hidden="true">M</span>
              <span>Majorana</span>
            </a>
            <p>{copy.footer.promise}</p>
          </div>
          <div className="mj-public-footer-links">
            <div>
              <span>{copy.footer.explore}</span>
              <a href="/repository">{copy.nav.repository}</a>
              <a href="/open-source">{copy.nav.openSource}</a>
              <a href="/pricing">{copy.nav.pricing}</a>
            </div>
            <div>
              <span>{copy.footer.company}</span>
              <a href="/contact">{copy.footer.contact}</a>
              <a href={CONTACT_MAILTO}>{copy.footer.email}</a>
              <a href={REPOSITORY_URL} target="_blank" rel="noreferrer">GitHub ↗</a>
            </div>
            <div>
              <span>{copy.footer.legal}</span>
              <a href="/privacy">{copy.footer.privacy}</a>
              <a href="/terms">{copy.footer.terms}</a>
            </div>
          </div>
          <div className="mj-public-footer-bottom">
            <span>© 2026 Majorana</span>
            <span>{copy.footer.builtFor}</span>
          </div>
        </footer>
      </div>
    </main>
  );
}
