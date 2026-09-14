/**
 * One collapsible section of an Atlas page, as a native `<details>`.
 *
 * Native on purpose. A closed section's text is still in the server HTML —
 * a crawler, `curl`, find-in-page and a reader with JavaScript off all get it —
 * and the browser opens the section itself when a link lands on its id. KaTeX
 * inside it is rendered on the server like everywhere else, so opening a
 * section never waits on a script.
 *
 * The heading stays an `<h2>`, inside the summary, so the page outline a screen
 * reader navigates by is the one it had before the sections could fold.
 */
import type { ReactNode } from "react";

export function AtlasFold({
  id,
  title,
  count,
  open = false,
  variant,
  children,
}: {
  id: string;
  title: string;
  /** A count the section's own content produced — never an estimate. */
  count?: number;
  open?: boolean;
  variant?: "contested";
  children: ReactNode;
}): React.ReactElement {
  return (
    <details
      className={`mj-atlas-fold${variant === "contested" ? " mj-atlas-fold--contested" : ""}`}
      id={id}
      open={open}
      data-fold={id}
    >
      <summary className="mj-atlas-fold-summary">
        <h2 className="mj-atlas-fold-title">{title}</h2>
        {count !== undefined ? <span className="mj-atlas-fold-count">{count}</span> : null}
      </summary>
      <div className="mj-atlas-fold-body">{children}</div>
    </details>
  );
}
