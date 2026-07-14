import type { CSSProperties, ReactNode } from "react";
import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { THEME_STORAGE_KEY } from "../lib/theme";
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
const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const jetbrainsMono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jbmono" });

export const metadata: Metadata = {
  title: {
    default: "Majorana · Verified quantum work",
    template: "%s · Majorana",
  },
  description: "A quantum workbench for executable code, measured evidence, and reusable verified artifacts.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${inter.variable} ${jetbrainsMono.variable}`}
      style={
        {
          "--font-ui": "var(--font-inter), system-ui, sans-serif",
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
