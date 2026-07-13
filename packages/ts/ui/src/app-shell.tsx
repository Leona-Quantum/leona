// Shared shell: top nav across the three surfaces (07-ui-product.md §1).
// Server-compatible; active-link highlighting is the caller's job (pass currentPath).
import type { ReactNode } from "react";
import { BRAND_NAME, NAV_SURFACES } from "./nav-config";

function SidebarChevron({ direction }: { direction: "left" | "right" }) {
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d={direction === "left" ? "m9.5 4-4 4 4 4" : "m6.5 4 4 4-4 4"} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function AppShell({
  children,
  currentPath,
  headerRight,
  sidebar,
  sidebarCollapsed = false,
  onToggleSidebar,
  surfaceLabel,
}: {
  children: ReactNode;
  /** Pathname for aria-current on the active surface. */
  currentPath?: string;
  /** Right side of the header: quota meter, account chip. */
  headerRight?: ReactNode;
  /** Workspace navigation/history rail. Kept as a slot so the shell stays domain-agnostic. */
  sidebar?: ReactNode;
  sidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
  surfaceLabel?: string;
}): ReactNode {
  return (
    <div
      className={`mj-shell${sidebar ? " mj-shell--workspace" : ""}`}
      data-sidebar-collapsed={sidebar ? String(sidebarCollapsed) : undefined}
    >
      {sidebar ? <aside className="mj-shell-sidebar">{sidebar}</aside> : null}
      <div className="mj-shell-body">
        <header className="mj-shell-header">
          {sidebar && onToggleSidebar ? (
            <button
              className="mj-shell-toggle"
              type="button"
              aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              aria-expanded={!sidebarCollapsed}
              onClick={onToggleSidebar}
            >
              <SidebarChevron direction={sidebarCollapsed ? "right" : "left"} />
            </button>
          ) : null}
          {sidebar ? (
            <span className="mj-shell-surface">{surfaceLabel ?? BRAND_NAME}</span>
          ) : (
            <a href="/" className="mj-shell-brand">
              {BRAND_NAME}
            </a>
          )}
          {!sidebar ? (
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
          ) : null}
          {headerRight ? <div className="mj-shell-right">{headerRight}</div> : null}
        </header>
        <main className="mj-shell-main">{children}</main>
      </div>
    </div>
  );
}
