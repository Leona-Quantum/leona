/**
 * Which settings pane a URL fragment asks for (ai-ops 134).
 *
 * ## Why this is a module and not three lines inside the component
 *
 * `/account#usage` and `/account#archived` are entry points that predate the
 * rail: the profile menu links to the first and the archive banner to the
 * second. Before ai-ops 134 a fragment scrolled a long stack; now it has to
 * SELECT a pane, because the section it names is `hidden` until something does.
 * That makes the mapping a contract two other files depend on, and a contract
 * belongs somewhere a test can reach it — `account-panes.tsx` is a client
 * component and `node --test` cannot import one.
 *
 * The failure this guards against is quiet in exactly the way that matters: get
 * it wrong and `/account#usage` still renders a settings page, still returns
 * 200, and simply shows the wrong section. Nothing errors, so nothing reports
 * it.
 *
 * Self-contained by deliberate policy — no sibling import at all. The app's
 * imports are extensionless, bare `node --test` cannot resolve those, and one
 * of them here would fail the whole hand-run suite at load time. Same rule as
 * `canonical-locale-redirect.ts`; the trap is recorded there.
 */

/** A leading `#` is optional, so both `location.hash` and a bare id work. */
export function paneForHash(paneIds: readonly string[], hash: string): string | null {
  const fragment = hash.replace(/^#/, "");
  if (fragment === "") return null;
  // An unknown fragment returns null rather than throwing or picking something.
  // `/account#anything` was a harmless no-op scroll before the rail existed and
  // has to stay harmless: a stale bookmark or a mistyped anchor must land on the
  // default pane, not on an empty detail area.
  return paneIds.includes(fragment) ? fragment : null;
}
