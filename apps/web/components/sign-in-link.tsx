"use client";

import { useEffect, useState, type MouseEvent, type ReactNode } from "react";

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
    const reset = () => setNavigating(false);
    window.addEventListener("pageshow", reset);
    return () => window.removeEventListener("pageshow", reset);
  }, []);

  function markNavigation(event: MouseEvent<HTMLAnchorElement>) {
    // Modified clicks leave this page open, so loading feedback here would lie.
    if (
      event.button === 0 &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.shiftKey &&
      !event.altKey
    ) {
      setNavigating(true);
    }
  }

  return (
    <a
      className={className}
      href={href}
      aria-busy={navigating || undefined}
      onClick={markNavigation}
    >
      {navigating ? pendingLabel : children}
    </a>
  );
}
