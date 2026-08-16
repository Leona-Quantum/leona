import type { CSSProperties, ReactNode } from "react";
import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import { Instrument_Sans, Instrument_Serif, JetBrains_Mono } from "next/font/google";
import { THEME_STORAGE_KEY } from "../lib/theme";
import { AUTH_HINT_COOKIE, AUTH_HINT_SIGNED_IN } from "../lib/auth-hint";
import { LEGACY_PUBLIC_LOCALE_COOKIE, PUBLIC_LOCALE_COOKIE } from "../lib/public-locale";
import { canonicalOrigin } from "../lib/site-origin";
import { OG_IMAGE, SITE_NAME } from "../lib/public-metadata";
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

/**
 * Paint the header's sign-in control correctly on the first frame (ai-ops issue 114).
 *
 * Same shape as the two scripts above, and for the same reason: the pages that
 * need this are held on the CDN, so the answer cannot be in their HTML — it has
 * to be read from the visitor's own browser before anything is drawn. See
 * `lib/auth-hint.ts` for what the cookie is, what it is not, and why it may only
 * be written from routes that are already uncacheable.
 *
 * Absent or unreadable, this stamps `"out"`, which is exactly the state the
 * server rendered — so a first-time visitor, a visitor with cookies disabled,
 * and a visitor with JavaScript off all get today's behaviour rather than a
 * broken one.
 */
const authHintScript = `(() => {
  var signedIn = false;
  try {
    signedIn = document.cookie.split("; ").some((c) => c === ${JSON.stringify(`${AUTH_HINT_COOKIE}=${AUTH_HINT_SIGNED_IN}`)});
  } catch {}
  document.documentElement.dataset.auth = signedIn ? "in" : "out";
})();`;

// Fonts land as CSS variables that override the tokens.css fallback stacks.
const instrumentSans = Instrument_Sans({ subsets: ["latin"], variable: "--font-instrument-sans" });
// Display face for the public site only — one weight, loaded because the marketing
// surface is the only place that renders it (see --font-display in tokens.css).
const instrumentSerif = Instrument_Serif({ subsets: ["latin"], weight: "400", variable: "--font-instrument-serif" });
const jetbrainsMono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jbmono" });

export const metadata: Metadata = {
  // The origin every relative address in this application's metadata resolves
  // against — `alternates.canonical` and `og:url` on the public pages, and any
  // OG image added later. Read from the same source `robots.ts` and
  // `sitemap.ts` use, so the three cannot disagree about which origin this
  // deployment claims to be.
  //
  // Set here and NOT `alternates.canonical`: metadata is inherited by every
  // route that does not override it, so a canonical URL declared in the root
  // layout would tell a crawler that all seven hundred pages are the homepage.
  // Each public page states its own with `canonicalMetadata()`.
  metadataBase: new URL(canonicalOrigin()),
  title: {
    default: "Leona Quantum · Evidence for quantum work",
    template: "%s · Leona Quantum",
  },
  description: "Leona Quantum connects public research, private workspaces, and verifiable quantum execution.",
  // `summary_large_image`, not the `summary` X was inferring. Until
  // `app/opengraph-image.tsx` existed there was no image to be large, so the
  // small card was the honest default; now that there is one, a `summary` card
  // would crop a 1200x630 image into a thumbnail (ai-ops 133).
  twitter: { card: "summary_large_image" },
  // The default for every route that does NOT call `canonicalMetadata()` —
  // the signed-in application, and any page added later that forgets to. A
  // route which sets its own `openGraph` replaces this wholesale, which is
  // why `canonicalMetadata()` restates the same image rather than relying on
  // inheritance.
  openGraph: { siteName: SITE_NAME, type: "website", images: [OG_IMAGE] },
};

/**
 * Organization + WebSite, the two schema.org types a search engine actually
 * uses here (ai-ops 133, "Missing structured data"). Emitted once in the root
 * layout so every page carries it, rather than per page where it would drift.
 *
 * Deliberately NOT `SoftwareApplication` or an `Offer`: those invite a rich
 * result quoting a price, and the pricing on this site is early-access and
 * moving. Structured data is a claim to a crawler, and a stale claim about
 * price is worse than no claim at all.
 *
 * `@id` is the origin, so the two nodes reference one entity rather than
 * declaring two unrelated things that happen to share a name.
 */
function structuredData(origin: string) {
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": `${origin}/#organization`,
        name: "Leona Quantum",
        url: origin,
        logo: `${origin}/icon.svg`,
        description:
          "An AI workspace for generating, running and verifying quantum circuits, and a public atlas of quantum algorithms.",
      },
      {
        "@type": "WebSite",
        "@id": `${origin}/#website`,
        name: "Leona Quantum",
        url: origin,
        publisher: { "@id": `${origin}/#organization` },
      },
    ],
  };
}

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
        <script dangerouslySetInnerHTML={{ __html: authHintScript }} />
        {/* A JSON-LD data block, not executable script — browsers never run
            `application/ld+json`, so this carries none of the risk the three
            bootstrap scripts above are weighed against. `JSON.stringify` is
            what escapes it: the content is repo-authored constants today, and
            building the string by hand is how a future dynamic field would
            become an injection point. */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData(canonicalOrigin())) }}
        />
      </head>
      <body>
        {children}
        {/* Vercel Web Analytics: cookie-free pageview beacon (ai-ops#92). The
            script no-ops when the project's Analytics feature is off, so this
            is safe to render unconditionally rather than env-gating it. */}
        <Analytics />
      </body>
    </html>
  );
}
