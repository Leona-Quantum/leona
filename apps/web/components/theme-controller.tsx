"use client";

import { useLayoutEffect } from "react";
import { usePathname } from "next/navigation";
import { ACCENT_STORAGE_KEY, applyAccent, applyTheme, resolveAccent, resolveTheme, THEME_STORAGE_KEY, type Theme } from "../lib/theme";

/**
 * Locale navigation replaces the root HTML attributes without rerunning Next
 * Script, so the theme and the workspace accent are re-resolved here on every
 * path change, on a storage change from another tab, on page restore, and when
 * the OS scheme flips. `forcedTheme` is the document's own theme when its layout
 * fixes one (the public site is dark; the Qiskit Fall Fest event is light); a
 * saved choice never overrides it.
 */
export function ThemeController({ locale, forcedTheme }: { locale: string; forcedTheme?: Theme }) {
  const pathname = usePathname();
  useLayoutEffect(() => {
    const sync = () => {
      applyTheme(resolveTheme(pathname, forcedTheme));
      applyAccent(resolveAccent(pathname));
    };
    sync();
    const onStorage = (event: StorageEvent) => {
      if (event.key === THEME_STORAGE_KEY || event.key === ACCENT_STORAGE_KEY || event.key === null) sync();
    };
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    window.addEventListener("storage", onStorage);
    window.addEventListener("pageshow", sync);
    media.addEventListener("change", sync);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("pageshow", sync);
      media.removeEventListener("change", sync);
    };
  }, [locale, pathname, forcedTheme]);
  return null;
}
