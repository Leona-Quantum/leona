/**
 * The one `<html>`/`<body>` document, shared by every root layout.
 *
 * **Why there is more than one root layout.** `<html lang>` has to come from
 * the server, and a layout only ever receives params for segments from the
 * root down to itself — so a single `app/layout.tsx` sitting *above*
 * `[locale]` could never see the locale, on any route. Next's answer is
 * "multiple root layouts": delete the one at the top and give each top-level
 * segment its own. That is what each segment's own `layout.tsx` now is, and this is the
 * document all of them render, so the head, the fonts, the three bootstrap
 * scripts and the JSON-LD have exactly one writer.
 *
 * Owner ruling, ai-ops issue 151: *"option 2"* — fold it into the Atlas
 * revamp rather than doing it on its own or leaving it.
 *
 * **What each caller passes as `lang`, and why it differs.** The issue framed
 * this as one restructuring with one cost. Measured against production it is
 * two different situations and only one of them was ever expensive:
 *
 *     [locale] pages   /  /pricing  /contact  /privacy
 *                      cache-control: public          x-vercel-cache: PRERENDER
 *                      locale comes from the PATH, so `params.locale` sets
 *                      `lang` with no Dynamic API and no cache lost at all.
 *
 *     /repository/*    cache-control: private, no-cache, NO-STORE
 *                      x-vercel-cache: MISS
 *                      locale comes from the COOKIE, and this route tree is
 *                      already fully dynamic — so `getPublicLocale()` costs
 *                      nothing here that is not already being paid.
 *
 * The argument against reading the locale on the server was *"it would take
 * every public page out of the CDN cache"*. That is true of the pages whose
 * locale is a cookie and false of the pages that are cached — and those two
 * sets do not overlap. Neither surface pays the cost the issue priced.
 *
 * Everything else — the signed-in app, `auth`, `dev`, `lab`, and the three
 * segments that only redirect — passes `"en"`, which is exactly what it
 * served before. This change does not invent a localisation those surfaces
 * do not have.
 */
import type { CSSProperties, ReactNode } from "react";
import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import { Instrument_Sans, Instrument_Serif, JetBrains_Mono } from "next/font/google";
import Script from "next/script";
import { THEME_STORAGE_KEY } from "../lib/theme";
import { AUTH_HINT_COOKIE, AUTH_HINT_SIGNED_IN } from "../lib/auth-hint";
import { LEGACY_PUBLIC_LOCALE_COOKIE, PUBLIC_LOCALE_COOKIE } from "../lib/public-locale";
import { canonicalOrigin } from "../lib/site-origin";
import { OG_IMAGE, SITE_NAME, TITLE_TEMPLATE } from "../lib/public-metadata";
import "../app/globals.css";

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
 * The locale script — **a client-side backstop now, not the mechanism.**
 *
 * This comment used to argue at length that `<html lang>` could not come from
 * the server, and that this script was the only thing that would ever set it.
 * Both halves are now false, and the whole argument is deleted rather than left
 * standing with a note: it was the case for a single root layout, and there is
 * no longer a single root layout. See the block at the top of this file.
 *
 * Today `<html lang>` is server-rendered correctly on both surfaces that serve
 * Japanese — `[locale]` from the path, `/repository` from the cookie — so a
 * screen reader, a crawler and a no-JS load all get the right answer from the
 * bytes, which is what ai-ops issue 151 was about.
 *
 * The script stays for the segments that still ship a fixed `lang="en"` and for
 * the language toggle's own `router.refresh()`, where the re-render produces
 * the same literal it produced before. It is cheap, it runs pre-paint, and it
 * can only ever agree with the server on the two surfaces that now decide for
 * themselves — on `[locale]` the cookie is what chose the path in the first
 * place, and on `/repository` it is the same cookie the layout just read.
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

export const rootMetadata: Metadata = {
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
    template: TITLE_TEMPLATE,
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


export function RootDocument({ lang, children }: { lang: string; children: ReactNode }) {
  return (
    <html
      lang={lang}
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
        <Script
          id="leona-theme"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{ __html: themeScript }}
        />
        <Script
          id="leona-locale"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{ __html: localeScript }}
        />
        <Script
          id="leona-auth-hint"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{ __html: authHintScript }}
        />
        {/* A JSON-LD data block. Browsers never execute `application/ld+json`,
            so it carries none of the risk the three bootstrap scripts above are
            weighed against. Rendered as a TEXT CHILD, deliberately, rather than
            through React's raw-HTML escape hatch — React escapes text children
            of a script element and does nothing at all to raw HTML, so a value
            containing a literal closing script tag would close THIS element and
            everything after it would become real markup. The inputs are
            compile-time constants today; structured data grows to carry page
            titles and record names, and the construct worth choosing is the one
            still safe on that day. Escaping `<` is the second layer, surviving
            even if someone later "simplifies" this back to the raw-HTML prop. */}
        <script type="application/ld+json">
          {JSON.stringify(structuredData(canonicalOrigin())).replace(/</g, "\\u003c")}
        </script>
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
