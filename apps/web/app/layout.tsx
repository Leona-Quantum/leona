import type { CSSProperties, ReactNode } from "react";
import type { Metadata } from "next";
import { Instrument_Sans, Instrument_Serif, JetBrains_Mono } from "next/font/google";
import { THEME_STORAGE_KEY } from "../lib/theme";
import { getPublicLocale } from "../lib/public-locale-server";
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

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await getPublicLocale();
  return (
    <html
      lang={locale}
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
      </head>
      <body>{children}</body>
    </html>
  );
}
