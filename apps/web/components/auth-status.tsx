"use client";

import { useEffect, useState } from "react";

/**
 * The auth-dependent slice of the public header, rendered client-side only.
 *
 * Used exclusively by `PublicSite`'s `chrome="static"` branch — see the long
 * comment on `chrome` there for why those pages never learn who is visiting
 * during their own (cached) render. This component is how they find out
 * afterward, without giving up the cache: it starts in the same signed-out
 * state the server already rendered (so hydration has nothing to reconcile),
 * then asks `/api/auth/session` once the page is interactive and swaps in the
 * real state if the visitor turns out to be signed in.
 *
 * `chrome="full"` pages (`/repository/papers`, `/repository/[slug]`) do not
 * use this: they are uncached and already call `getMajoranaAuth()` on the
 * server, so they are correct from first paint and switching them to this
 * component would only add a visible flash where none exists today.
 *
 * `/repository` (the Atlas browse index) used to be one of these and is not
 * anymore — it moved to `chrome="static"` so the page itself could cache. Its
 * header uses this component like every other `chrome="static"` page; its
 * per-entry "Add to Studio" buttons resolve sign-in state the same way but
 * independently, via `RepositoryBrowser`'s own `/api/auth/session` fetch,
 * because that state lives on ~369 buttons rather than one header control.
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
  /** The constant `/auth/sign-in` redirect — used until the real session answer lands. */
  fallbackSignInHref: string;
}) {
  const [session, setSession] = useState<{ signedIn: boolean; signInHref: string | null } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/session", { credentials: "include" })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { signedIn: boolean; signInHref: string | null } | null) => {
        if (!cancelled && data) setSession(data);
      })
      .catch(() => {
        // Left in the default signed-out state — the same thing this page
        // rendered on the server, so a network hiccup here is silent, not broken.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const signedIn = session?.signedIn ?? false;
  const signInHref = session?.signInHref ?? fallbackSignInHref;
  const primaryAction = signedIn
    ? { href: "/run", label: workspaceLabel }
    : signInHref
      ? { href: signInHref, label: signInLabel }
      : { href: "/contact", label: talkLabel };

  return (
    <>
      {signedIn ? (
        <a className="mj-public-nav-signout" href="/auth/sign-out">
          {signOutLabel}
        </a>
      ) : null}
      <a className="mj-public-nav-primary" href={primaryAction.href}>
        {primaryAction.label}
      </a>
    </>
  );
}
