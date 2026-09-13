"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";
// Pure, and in `lib/` so `node --test` can assert the deep-link contract — this
// file is a client component and the suite cannot import one.
import { paneForHash } from "../../../lib/account-pane-selection";

/** Settings panes load on first visit and remain mounted to preserve edits.
 * Fragment changes replace history so closing the modal returns to the workspace.
 */

export type AccountPane = {
  id: string;
  label: string;
  panel: ReactNode;
};

// The pane wrapper's DOM id. Prefixed, because a pane id is also a fragment and
// two of them ("usage", "archived") are already the ids of elements INSIDE the
// panels they wrap — `#usage` is the `<section>` in account-content.tsx. Reusing
// the bare id here would put two elements with the same id in one document and
// make `getElementById` return whichever came first.
function paneDomId(id: string): string {
  return `mj-account-pane-${id}`;
}


export function AccountPanes({
  panes,
  navLabel,
}: {
  panes: readonly AccountPane[];
  navLabel: string;
}) {
  const first = panes[0]?.id ?? "";
  // Joined into one string so the effect below can depend on the pane IDS
  // rather than on the `panes` array. `account-content.tsx` rebuilds that array
  // on every render, so depending on it would tear down and re-add the
  // `hashchange` listener on every parent render for no reason — and the effect
  // does not read anything from a pane except its id.
  const paneKey = panes.map((pane) => pane.id).join(",");
  const [active, setActive] = useState(first);
  const [visited, setVisited] = useState(() => new Set([first]));

  useEffect(() => {
    setVisited((current) => current.has(active) ? current : new Set([...current, active]));
  }, [active]);
  // Held in state rather than left to the browser so a re-render cannot spring
  // the rail back open under someone who just shut it — the same reason
  // `map-info-popup.tsx` holds its own.
  //
  // Open is the SSR default because the desktop layout is the one where the rail
  // is a column beside the content, and rendering it closed there would collapse
  // the navigation for everyone before hydration. The narrow case is corrected on
  // mount below.
  const [navOpen, setNavOpen] = useState(true);

  // On mount, not during render: `window` does not exist on the server, and the
  // server has no way to know the fragment anyway — it is never sent. The first
  // pane is therefore what SSR emits, and a deep link corrects it before paint
  // is observable because this runs in the same commit as the modal's own
  // effects.
  // Below 720px the rail is stacked ON TOP of the detail pane rather than beside
  // it, so six expanded items push the content the reader came for off the
  // screen. Collapsed, the `<summary>` is still there and still the control that
  // reopens it — the same affordance, one line tall instead of seven.
  //
  // A mount effect, not an initial state, because `matchMedia` does not exist on
  // the server: deciding this during render would make the markup depend on a
  // viewport the server cannot see, which is a hydration mismatch rather than a
  // layout choice. Runs once — reacting to later resizes would fight a reader who
  // had deliberately opened the rail.
  // `hydrated` lets the stylesheet hide the open rail's list on a narrow
  // viewport until this effect has had its say, so the reader never sees the
  // seven-item rail flash open and then snap shut.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    if (window.matchMedia("(max-width: 720px)").matches) setNavOpen(false);
    setHydrated(true);
  }, []);

  useEffect(() => {
    // Derived from `panes` directly, NOT by splitting `paneKey` back apart.
    // That round-trip shipped a separator mismatch on the first push of this
    // branch - joined on one character, split on another - which collapsed six
    // ids into a single string, so `includes()` never matched and EVERY deep
    // link fell back to the first pane. It failed in the worst way available:
    // the page still rendered, still returned 200, and simply showed the wrong
    // section. `paneKey` earns its keep as a dependency and nothing else; there
    // is no encoding here left to get wrong.
    const ids = panes.map((pane) => pane.id);
    const target = paneForHash(ids, window.location.hash);
    if (target !== null) setActive(target);
    // Someone can also arrive at a new fragment without a remount — the profile
    // menu links to /account#usage while /account is already open.
    const onHashChange = () => {
      const next = paneForHash(ids, window.location.hash);
      if (next !== null) setActive(next);
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, [paneKey]);

  const select = (id: string) => {
    setActive(id);
    // `${pathname}${search}#${id}` rather than a bare `#${id}`: assigning only
    // the fragment is fine, but spelling the whole URL keeps any query string
    // the page was opened with, and makes it obvious that nothing else moves.
    window.history.replaceState(
      window.history.state,
      "",
      `${window.location.pathname}${window.location.search}#${id}`,
    );
    // Below 720px the rail is not beside the detail pane, it is stacked ON TOP
    // of it — six rail items tall. Selecting a section there put the thing the
    // reader just asked for below the fold, with no feedback but a highlight
    // they had to scroll away from to use. Measured at 390×844. Beside the rail
    // there is nothing to scroll, so the query gates it rather than a bare
    // scrollIntoView that would yank a desktop layout for no reason.
    if (!window.matchMedia("(max-width: 720px)").matches) return;
    setNavOpen(false);
    // After paint: the pane is `hidden` until React commits this state, and a
    // hidden element has no box to scroll to.
    requestAnimationFrame(() => {
      const panel = document.getElementById(paneDomId(id));
      panel?.focus({ preventScroll: true });
      panel?.scrollIntoView({ block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    });
  };

  return (
    <div className="mj-account-layout">
      <details
        className="mj-account-nav"
        data-hydrated={hydrated ? "" : undefined}
        open={navOpen}
        onToggle={(event) => setNavOpen(event.currentTarget.open)}
      >
        <summary>{panes.find((pane) => pane.id === active)?.label ?? navLabel}</summary>
        <nav aria-label={navLabel}>
          <ul>
            {panes.map((pane) => (
              <li key={pane.id}>
                {/* A button, not an anchor. The map's rail navigates — each of
                    its sections is a real `?about=` URL the server renders. This
                    one only moves a fragment, and an anchor whose href is a
                    fragment inside an already-open dialog invites the browser to
                    scroll the dialog's container as well as select the pane. */}
                <button
                  type="button"
                  aria-current={pane.id === active ? "true" : undefined}
                  onClick={() => select(pane.id)}
                  data-tour={`settings-${pane.id}`}
                >
                  {pane.label}
                </button>
              </li>
            ))}
          </ul>
        </nav>
      </details>

      <div className="mj-account-detail">
        {panes.map((pane) => (
          <div
            key={pane.id}
            id={paneDomId(pane.id)}
            className="mj-account-pane"
            hidden={pane.id !== active}
            // Not `role="tabpanel"`: a tablist owes the reader arrow-key
            // navigation between tabs and this rail is a list of links in
            // behaviour. `aria-live` is wrong too — the reader asked for the
            // change, so announcing it is noise. A plain region with the name
            // of the section it holds is what a screen reader needs here.
            role="region"
            tabIndex={-1}
            aria-label={pane.label}
          >
            {pane.id === active || visited.has(pane.id) ? pane.panel : null}
          </div>
        ))}
      </div>
    </div>
  );
}
