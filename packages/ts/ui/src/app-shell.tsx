// Shared shell: top nav across the three surfaces (07-ui-product.md §1).
// Server-compatible; active-link highlighting is the caller's job (pass currentPath).
import type { ReactNode } from "react";
import { BRAND_NAME, NAV_SURFACES } from "./nav-config";

export function AppShell({
  children,
  currentPath,
  headerRight,
}: {
  children: ReactNode;
  /** Pathname for aria-current on the active surface. */
  currentPath?: string;
  /** Right side of the header: quota meter, account chip. */
  headerRight?: ReactNode;
}): ReactNode {
  return (
    <div className="mj-shell">
      <header className="mj-shell-header">
        <a href="/" className="mj-shell-brand">
          {BRAND_NAME}
        </a>
        <nav className="mj-shell-nav" aria-label="Primary">
          {NAV_SURFACES.map((surface) => (
            <a
              key={surface.href}
              href={surface.href}
              aria-current={
                currentPath === surface.href || currentPath?.startsWith(`${surface.href}/`)
                  ? "page"
                  : undefined
              }
            >
              {surface.label}
            </a>
          ))}
        </nav>
        {headerRight ? <div className="mj-shell-right">{headerRight}</div> : null}
      </header>
      <main className="mj-shell-main">{children}</main>
    </div>
  );
}
