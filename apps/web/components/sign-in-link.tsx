"use client";

import { useEffect, useState, type MouseEvent, type ReactNode } from "react";

/**
 * A sign-in link that says it is working.
 *
 * `/auth/sign-in` is a `force-dynamic` route handler that calls WorkOS before
 * it can redirect, so the click has a visible gap with no feedback in it — long
 * enough that a reader clicks again. The label changes for the duration.
 */
export function SignInLink({
  href,
  className,
  pendingLabel,
  children,
}: {
  href: string;
  className?: string;
  pendingLabel: string;
  children: ReactNode;
}) {
  const [navigating, setNavigating] = useState(false);

  useEffect(() => {
    // Back-navigation restores this component from the bfcache with its state
    // intact, which would leave the label stuck on "Opening sign in…" for a page
    // that is no longer going anywhere. `pageshow` fires on that restore.
    const reset = () => setNavigating(false);
    window.addEventListener("pageshow", reset);
    return () => window.removeEventListener("pageshow", reset);
  }, []);

  function markNavigation(event: MouseEvent<HTMLAnchorElement>) {
    // Modified clicks open a new tab and leave this page exactly where it is,
    // so loading feedback here would be a lie about what just happened.
    if (
      event.button === 0
      && !event.metaKey
      && !event.ctrlKey
      && !event.shiftKey
      && !event.altKey
    ) {
      setNavigating(true);
    }
  }

  return (
    <a className={className} href={href} aria-busy={navigating || undefined} onClick={markNavigation}>
      {navigating ? pendingLabel : children}
    </a>
  );
}
