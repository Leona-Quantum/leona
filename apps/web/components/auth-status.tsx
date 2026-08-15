"use client";

import { useEffect, useState } from "react";

/**
 * The auth-dependent slice of the public header, rendered client-side only.
 *
 * Used exclusively by `PublicSite`'s `chrome="static"` branch — see the long
 * comment on `chrome` there for why those pages never learn who is visiting
 * during their own (cached) render.
 *
 * ## How it decides what to show, and when
 *
 * Both controls are always in the markup. Which one the reader sees is decided
 * by CSS from `<html data-auth>`, which the inline script in `app/layout.tsx`
 * stamps from the hint cookie *before first paint*. So the server ships one
 * cached HTML payload, every visitor gets the same bytes, and each browser
 * paints the right half of it on the first frame.
 *
 * This replaced a version that started in the signed-out state and swapped after
 * hydration. That was correct but visibly late, and the lateness was not a
 * one-off: every link in this header is a plain `<a>`, so each navigation is a
 * full page load and a signed-in reader paid the swap again on every page —
 * "Sign in" for about half a second, then the top bar shifting sideways as the
 * sign-out link appeared beside it (ai-ops#114).
 *
 * The `/api/auth/session` fetch below did not go away, and is not redundant. It
 * is what makes the hint *true*: it writes the cookie, clears it when the
 * session is gone, and corrects the header in the one case the hint is stale —
 * a session that expired server-side without the reader ever clicking sign-out.
 * That correction is the old behaviour, now reserved for when it is needed
 * rather than run on every page.
 *
 * `chrome="full"` pages (`/repository/papers`, `/repository/[slug]`) do not use
 * this: they are uncached and already call `getMajoranaAuth()` on the server, so
 * they are correct from first paint on their own.
 */
export function AuthStatus({
  signOutLabel,
  signInLabel,
  workspaceLabel,
  talkLabel,
  fallbackSignInHref,
}: {
  signOutLabel: string;
  signInLabel: string;
  workspaceLabel: string;
  talkLabel: string;
  /** The constant `/auth/sign-in` redirect, and what the server renders. */
  fallbackSignInHref: string;
}) {
  // Starts at the server's value on purpose. The markup this component returns
  // must be byte-identical on the server and on the client's first render or
  // hydration reconciles it — the visible state is CSS's job, not this state's.
  const [signInHref, setSignInHref] = useState(fallbackSignInHref);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/session", { credentials: "include" })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { signedIn: boolean; signInHref: string | null } | null) => {
        if (cancelled || !data) return;
        // The route has already written or cleared the hint cookie by now; this
        // is the same answer applied to the page the reader is looking at,
        // which matters when the hint was stale (an expired session) or absent
        // (the first static page opened after signing in).
        document.documentElement.dataset.auth = data.signedIn ? "in" : "out";
        if (!data.signedIn && data.signInHref) setSignInHref(data.signInHref);
      })
      .catch(() => {
        // Left as the hint painted it. A network hiccup here now costs nothing
        // visible, where before it left a signed-in reader looking at "Sign in".
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      <span className="mj-auth-slot" data-auth-slot="in">
        <a className="mj-public-nav-signout" href="/auth/sign-out">
          {signOutLabel}
        </a>
        <a className="mj-public-nav-primary" href="/run">
          {workspaceLabel}
        </a>
      </span>
      <span className="mj-auth-slot" data-auth-slot="out">
        <a className="mj-public-nav-primary" href={signInHref || "/contact"}>
          {signInHref ? signInLabel : talkLabel}
        </a>
      </span>
    </>
  );
}
