import type { ReactNode } from "react";
import { getMajoranaAuth, getMajoranaSignInUrl, isMajoranaAuthConfigured } from "../lib/auth";
import { ThemeToggle } from "./theme-toggle";

export const CONTACT_EMAIL = "eshuneesh@gmail.com";
export const CONTACT_MAILTO = `mailto:${CONTACT_EMAIL}?subject=Majorana%20inquiry`;
export const REPOSITORY_URL = "https://github.com/EshMis/majorana";

const PUBLIC_NAV = [
  { href: "/", label: "Product" },
  { href: "/pricing", label: "Pricing" },
  { href: "/repository", label: "Repository" },
  { href: "/open-source", label: "Open source" },
  { href: "/contact", label: "Contact" },
];

export async function PublicSite({
  activePath,
  children,
  className = "",
}: {
  activePath?: string;
  children: ReactNode;
  className?: string;
}) {
  const { user } = await getMajoranaAuth();
  const signInHref = isMajoranaAuthConfigured() ? await getMajoranaSignInUrl() : null;
  const primaryAction = user
    ? { href: "/run", label: "Open workspace" }
    : signInHref
      ? { href: signInHref, label: "Sign in" }
      : { href: "/contact", label: "Talk to us" };

  return (
    <main className={["mj-public-site", className].filter(Boolean).join(" ")}>
      <div className="mj-public-frame">
        <header className="mj-public-header">
          <a className="mj-public-brand" href="/" aria-label="Majorana home">
            <span className="mj-public-brand-mark" aria-hidden="true">M</span>
            <span>Majorana</span>
          </a>
          <nav className="mj-public-nav" aria-label="Public navigation">
            {PUBLIC_NAV.map((item) => (
              <a
                key={item.href}
                href={item.href}
                aria-current={activePath === item.href ? "page" : undefined}
              >
                {item.label}
              </a>
            ))}
          </nav>
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
            <p>Trustworthy quantum work, one verified artifact at a time.</p>
          </div>
          <div className="mj-public-footer-links">
            <div>
              <span>Explore</span>
              <a href="/repository">Repository</a>
              <a href="/open-source">Open source</a>
              <a href="/pricing">Pricing</a>
            </div>
            <div>
              <span>Company</span>
              <a href="/contact">Contact us</a>
              <a href={CONTACT_MAILTO}>Email Eshaan</a>
              <a href={REPOSITORY_URL} target="_blank" rel="noreferrer">GitHub ↗</a>
            </div>
            <div>
              <span>Legal</span>
              <a href="/privacy">Privacy policy</a>
              <a href="/terms">Terms</a>
            </div>
          </div>
          <div className="mj-public-footer-bottom">
            <span>© 2026 Majorana</span>
            <span>Built for researchers, engineers, and teams who need evidence.</span>
          </div>
        </footer>
      </div>
    </main>
  );
}
