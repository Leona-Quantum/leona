"use client";

// Client wrapper so AppShell gets the live pathname for aria-current.
import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { AppShell } from "@majorana/ui";

export function Shell({
  children,
  headerRight,
}: {
  children: ReactNode;
  headerRight?: ReactNode;
}) {
  const pathname = usePathname();
  return (
    <AppShell currentPath={pathname} headerRight={headerRight}>
      {children}
    </AppShell>
  );
}
