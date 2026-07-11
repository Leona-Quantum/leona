import type { CSSProperties, ReactNode } from "react";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

// Fonts land as CSS variables that override the tokens.css fallback stacks.
const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const jetbrainsMono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jbmono" });

export const metadata = { title: "Majorana" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${jetbrainsMono.variable}`}
      style={
        {
          "--font-ui": "var(--font-inter), system-ui, sans-serif",
          "--font-mono": "var(--font-jbmono), ui-monospace, monospace",
        } as CSSProperties
      }
    >
      <body>{children}</body>
    </html>
  );
}
