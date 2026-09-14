"use client";

import { useRouter } from "next/navigation";
import { PUBLIC_LOCALE_COOKIE, type PublicLocale } from "../lib/public-locale";

/**
 * Switches the reader's locale: write the cookie, then re-render. The caller says how.
 *
 * - `"reload"` (the default, the public site): the locale can select a different
 *   `[locale]` root document, and the bootstrap scripts (`beforeInteractive`) run only on
 *   a document load, so the page reloads.
 * - `"refresh"` (the workspace): both locales share one route tree — the root layout
 *   reads the cookie — so `router.refresh()` re-renders the server components in place
 *   and keeps client state. A reload here lost more than state: /account opens as a
 *   popout only for client-side navigations (`@modal/(.)account`), and a document load
 *   lands on the full page, which is how switching the language inside Settings turned
 *   the popout into a page (owner, 2026-09-12). A refresh keeps the popout, the pane the
 *   hash selected, and a draft in the composer behind it.
 */
export function LanguageToggle({
  locale,
  label = "Language",
  mode = "reload",
}: {
  locale: PublicLocale;
  label?: string;
  mode?: "reload" | "refresh";
}) {
  const router = useRouter();

  function selectLocale(nextLocale: PublicLocale) {
    if (nextLocale === locale) return;
    document.cookie = `${PUBLIC_LOCALE_COOKIE}=${nextLocale}; Path=/; Max-Age=31536000; SameSite=Lax`;
    if (mode === "refresh") {
      // The root layout re-renders <html lang> from the cookie; set it now too so
      // nothing reads the old language during the round trip.
      document.documentElement.lang = nextLocale;
      router.refresh();
      return;
    }
    window.location.reload();
  }

  return (
    <div className="mj-language-toggle" role="group" aria-label={label}>
      {(["en", "ja"] as const).map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={locale === option}
          title={option === "en" ? "Use English" : "日本語を使用"}
          onClick={() => selectLocale(option)}
        >
          {option === "en" ? "EN" : "日本語"}
        </button>
      ))}
    </div>
  );
}
