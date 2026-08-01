"use client";

import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import type { PublicLocale } from "../../../lib/public-locale";
import { ACCOUNT_COPY } from "../../../lib/workspace-locale";
// From its own module, never from account-content.tsx: that file is a server
// component and one constant imported out of it pulls `server-only` into this
// client bundle. `next build` is the only thing in CI that catches it.
import { ACCOUNT_TITLE_ID } from "./account-title-id";

/**
 * Settings as a centred popout over whatever the person was already doing.
 *
 * The owner's ask was that opening settings stop being a departure. The route
 * is unchanged — the URL still reads /account, it is still bookmarkable, and a
 * refresh still renders the full page — but an in-app navigation now lands here
 * instead, over a Run or a Studio session that stays mounted behind it.
 *
 * Closing is `router.back()` and not a piece of local state, because the modal
 * IS a history entry. Anything else would leave the URL saying /account with no
 * settings on screen, and would make the browser's own Back button do something
 * different from the close button sitting next to it.
 */

// Everything the keyboard can land on. `[tabindex="-1"]` is programmatic-only
// focus (the dialog shell itself) and must not be a Tab stop.
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Set on <body> while the dialog is up; see the rule in styles.css.
const SCROLL_LOCK_CLASS = "mj-modal-open";

export function AccountModal({ locale, children }: { locale: PublicLocale; children: ReactNode }) {
  const copy = ACCOUNT_COPY[locale];
  const router = useRouter();
  const dialogRef = useRef<HTMLDivElement>(null);
  // A ref rather than a dependency, so the effect below is a genuine
  // once-per-mount effect and cannot re-run and re-steal focus mid-session.
  const closeRef = useRef<() => void>(() => undefined);
  closeRef.current = () => router.back();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    // Who to hand focus back to. Normally the sidebar menu item that opened
    // this — the drawer stays open behind the modal, so that element is still
    // there and still focusable. `[data-modal-return-focus]` is the documented
    // fallback for when it is not: dismissing the drawer (a click on this
    // dialog's backdrop counts as a click outside it) puts that item inside an
    // `inert` subtree, where .focus() silently does nothing at all.
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const reachable = (element: HTMLElement) =>
      element.getClientRects().length > 0 && !element.closest("[inert]");

    const focusable = () =>
      Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(reachable);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        // Settings can open a dialog of its own — deleting an archived chat
        // asks first. Escape belongs to the INNERMOST dialog, so when one is
        // up this handler stands down completely: no stopPropagation either,
        // because that confirmation listens on window and swallowing the event
        // here would leave neither dialog closable by keyboard. Without this,
        // answering "are you sure" with Escape closed the whole settings panel
        // instead of the question.
        if (dialog.querySelector(".mj-delete-dialog-backdrop")) return;
        // Capture phase and stopPropagation because the sidebar's account
        // drawer ALSO listens for Escape on window, and would otherwise close
        // itself and yank focus to the avatar button underneath this dialog.
        // While a modal is open and alone, Escape belongs to the modal.
        event.stopPropagation();
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const stops = focusable();
      if (stops.length === 0) {
        // Nothing to move to. Refusing the keystroke is still better than
        // letting Tab walk out into the page behind an aria-modal dialog.
        event.preventDefault();
        return;
      }
      const first = stops[0]!;
      const last = stops[stops.length - 1]!;
      const active = document.activeElement;
      const inside = active instanceof Node && dialog.contains(active) && active !== dialog;
      if (event.shiftKey) {
        if (!inside || active === first) {
          event.preventDefault();
          last.focus();
        }
        return;
      }
      if (!inside || active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown, true);
    document.body.classList.add(SCROLL_LOCK_CLASS);
    // preventScroll: focusing the shell would otherwise scroll its own
    // container to the top and undo the deep-link scroll set up below.
    dialog.focus({ preventScroll: true });

    // /account#usage and /account#archived are real entry points — the profile
    // menu links to the first, the archive banner to the second. As a full page
    // the browser resolves the fragment itself; inside a modal the target lives
    // in the dialog's own scroll container, so it has to be done by hand.
    //
    // A timer rather than requestAnimationFrame: rAF does not fire in a
    // background tab, and someone who opens settings in one and comes back to
    // it should not find the panel they asked for un-scrolled to.
    let timer = 0;
    const fragment = window.location.hash.slice(1);
    if (fragment) {
      timer = window.setTimeout(() => {
        dialog.querySelector(`#${CSS.escape(fragment)}`)?.scrollIntoView({ block: "start" });
      }, 0);
    }

    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("keydown", handleKeyDown, true);
      document.body.classList.remove(SCROLL_LOCK_CLASS);
      if (opener?.isConnected && !opener.closest("[inert]")) {
        opener.focus();
        return;
      }
      document.querySelector<HTMLElement>("[data-modal-return-focus]")?.focus();
    };
  }, []);

  return (
    <div
      className="mj-account-modal-backdrop"
      role="presentation"
      // mousedown, not click: a drag that STARTS inside the dialog (selecting an
      // email address, say) and ends over the backdrop fires `click` on the
      // backdrop, and would dismiss a panel the person was reading.
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) router.back();
      }}
    >
      <div
        className="mj-account-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={ACCOUNT_TITLE_ID}
        tabIndex={-1}
        ref={dialogRef}
      >
        <button
          className="mj-icon-button mj-account-modal-close"
          type="button"
          aria-label={copy.close}
          title={copy.close}
          onClick={() => router.back()}
        >
          ×
        </button>
        {/* The scroll container is this inner element rather than the dialog
            shell, so the close button stays pinned while a long settings page
            moves under it. That makes it a scrollable region a keyboard user
            has to be able to reach — hence the tabIndex and a name of its own,
            without which arrow-key scrolling would have no way to get here. */}
        <div className="mj-account-modal-body" role="region" aria-label={copy.settingsRegion} tabIndex={0}>
          {children}
        </div>
      </div>
    </div>
  );
}
