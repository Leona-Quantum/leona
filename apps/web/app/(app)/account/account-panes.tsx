"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";
// Pure, and in `lib/` so `node --test` can assert the deep-link contract — this
// file is a client component and the suite cannot import one.
import { paneForHash } from "../../../lib/account-pane-selection";

/**
 * Settings as a sidebar of sections plus one large detail pane (ai-ops 134).
 *
 * The owner asked for the shape the map's information card already uses, so
 * this is deliberately the same construction as `components/map-info-popup.tsx`
 * rather than a second one invented here: a `<details>` rail that collapses on
 * a narrow viewport, a scrolling body beside it, and every section present in
 * the document with the inactive ones `hidden`. The class names are new because
 * the two live in differently-sized dialogs, but the idiom is not.
 *
 * ## Every pane stays mounted
 *
 * Only one is visible, but all six render. Three panels here own live state —
 * `QpuCredentials` and `UsageNow` fetch on mount, `ArchivedChats` holds a
 * pending-delete — and unmounting the inactive ones would re-run those fetches
 * every time someone clicked back to a section they had already opened, and
 * would silently discard a half-finished edit in `AccountSettings`. `hidden`
 * costs one paint and keeps all of that.
 *
 * It also keeps the modal's focus trap correct for free. `account-modal.tsx`
 * filters its tab stops through `getClientRects().length > 0`, and a `hidden`
 * subtree has no client rects, so the controls inside a pane nobody is looking
 * at are already excluded from Tab — no second mechanism, and nothing to keep
 * in sync with this file.
 *
 * ## Why the hash is replaced and never pushed
 *
 * `/account#usage` and `/account#archived` are real entry points: the profile
 * menu links to the first and the archive banner to the second. Those now have
 * to select a pane rather than scroll to one, which is what `paneForHash` does
 * on mount.
 *
 * Clicking a rail item updates the hash so the section stays linkable — with
 * `replaceState`, NOT `pushState`. The modal IS a history entry and closes with
 * `router.back()`; pushing a hash per click would mean the close button walked
 * back through the sections a reader had visited instead of closing the dialog,
 * and the browser's own Back button would do the same. Measured on the map
 * surface first, where the sections are anchors and closing is an href, so the
 * same mistake would not have shown up there.
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
  useEffect(() => {
    if (window.matchMedia("(max-width: 720px)").matches) setNavOpen(false);
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
    // After paint: the pane is `hidden` until React commits this state, and a
    // hidden element has no box to scroll to.
    requestAnimationFrame(() => {
      document.getElementById(paneDomId(id))?.scrollIntoView({ block: "start", behavior: "smooth" });
    });
  };

  return (
    <div className="mj-account-layout">
      <details
        className="mj-account-nav"
        open={navOpen}
        onToggle={(event) => setNavOpen(event.currentTarget.open)}
      >
        <summary>{navLabel}</summary>
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
            aria-label={pane.label}
          >
            {pane.panel}
          </div>
        ))}
      </div>
    </div>
  );
}
