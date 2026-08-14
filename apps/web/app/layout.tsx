import type { CSSProperties, ReactNode } from "react";
import type { Metadata } from "next";
import { Instrument_Sans, Instrument_Serif, JetBrains_Mono } from "next/font/google";
import { THEME_STORAGE_KEY } from "../lib/theme";
import { LEGACY_PUBLIC_LOCALE_COOKIE, PUBLIC_LOCALE_COOKIE } from "../lib/public-locale";
import "./globals.css";

const themeScript = `(() => {
  try {
    const saved = localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});
    const theme = saved === "light" || saved === "dark"
      ? saved
      : matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    document.documentElement.dataset.theme = theme;
  } catch {}
})();`;

/**
 * `<html lang>`, set here rather than on the server, and why that is not a
 * downgrade.
 *
 * This layout used to `await getPublicLocale()`, which reads a cookie. A
 * Dynamic API in the ROOT layout makes every route in the application dynamic,
 * so one line for one attribute was disqualifying the entire site from the CDN.
 *
 * The attribute itself loses nothing measurable. A crawler carries no cookie,
 * so `getPublicLocale()` already returned the default for every crawler that
 * has ever visited — the served markup said `lang="en"` before this change and
 * says `lang="en"` after it. A screen reader reads the live DOM, which this
 * script has already corrected before paint, exactly as it corrects the theme
 * on the line above. What changes is which of the two is authoritative, and
 * nobody was reading the server's answer.
 *
 * The real fix, if `lang` ever has to be right in the served bytes, is to make
 * `app/[locale]/layout.tsx` the root layout so it comes from the path. That is
 * a move of every route in the app and it buys nothing today.
 */
const localeScript = `(() => {
  try {
    const read = (name) => document.cookie.split("; ").find((c) => c.startsWith(name + "="))?.split("=")[1];
    const value = read(${JSON.stringify(PUBLIC_LOCALE_COOKIE)}) ?? read(${JSON.stringify(LEGACY_PUBLIC_LOCALE_COOKIE)});
    if (value === "ja") document.documentElement.lang = "ja";
  } catch {}
})();`;

// Fonts land as CSS variables that override the tokens.css fallback stacks.
const instrumentSans = Instrument_Sans({ subsets: ["latin"], variable: "--font-instrument-sans" });
// Display face for the public site only — one weight, loaded because the marketing
// surface is the only place that renders it (see --font-display in tokens.css).
const instrumentSerif = Instrument_Serif({ subsets: ["latin"], weight: "400", variable: "--font-instrument-serif" });
const jetbrainsMono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jbmono" });

export const metadata: Metadata = {
  title: {
    default: "Leona Quantum · Evidence for quantum work",
    template: "%s · Leona Quantum",
  },
  description: "Leona Quantum connects public research, private workspaces, and verifiable quantum execution.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${instrumentSans.variable} ${instrumentSerif.variable} ${jetbrainsMono.variable}`}
      style={
        {
          "--font-ui": "var(--font-instrument-sans), system-ui, sans-serif",
          "--font-display": "var(--font-instrument-serif), Georgia, serif",
          "--font-mono": "var(--font-jbmono), ui-monospace, monospace",
        } as CSSProperties
      }
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <script dangerouslySetInnerHTML={{ __html: localeScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
