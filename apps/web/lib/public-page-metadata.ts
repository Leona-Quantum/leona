import type { Metadata } from "next";
import type { PublicLocale } from "./public-locale";
// `.ts` extensions, deliberately, unlike the rest of this app's imports (see
// `tsconfig.json`'s `allowImportingTsExtensions`, and `repository-source.ts`'s
// `./repository/estimate.ts` import for existing precedent). This file is
// imported directly by `public-page-metadata.test.ts`, which runs under plain
// `node --experimental-strip-types --test` rather than Next's bundler — and
// bare Node ESM resolution cannot find an extensionless relative specifier.
// A type-only import (`PublicLocale` above) does not need this: it is erased
// entirely before Node ever tries to resolve it.
import { PUBLIC_SHELL_COPY } from "./public-locale.ts";
import { CONTACT_COPY, HOME_COPY, PRICING_COPY, PRIVACY_COPY, TERMS_COPY, WORKSPACE_LANDING_COPY } from "./public-copy.ts";

/**
 * `title`/`description` for the six `[locale]` marketing pages that, until
 * now, declared a static `export const metadata` with no locale branch at
 * all — home, contact, pricing, privacy, terms, workspace.
 *
 * Measured on production: with the Japanese locale active, `<h1>` and the
 * rest of the page body render correctly in Japanese (they read from
 * `HOME_COPY`/`CONTACT_COPY`/etc., keyed by `locale`), but `document.title`,
 * `og:title` and `meta[name=description]` stayed English, because these six
 * pages' `metadata` export never varied by locale — unlike their siblings
 * under `[locale]/repository/`, which already do this correctly (see
 * `claims/page.tsx` and `layers/page.tsx`).
 *
 * ## Why this changes nothing about caching
 *
 * These pages are prerendered per locale — `revalidate = 300`,
 * `dynamicParams = false`, `generateStaticParams` returning both
 * `PUBLIC_LOCALES` — and `middleware.ts` rewrites the clean, cookie-free URL
 * a reader sees (`/pricing`) to the locale-prefixed one that renders it
 * (`/en/pricing` or `/ja/pricing`), which is what gives each language its own
 * CDN cache entry. The functions below take `locale` as a plain argument
 * resolved from that path segment — exactly how the page body already picks
 * its copy — and read no cookie and no other per-request state. So turning
 * `metadata` into `generateMetadata` does not make a page dynamic and does
 * not put a cookie anywhere near a cached response: see the long comment
 * on `middleware.ts`'s `localeRewrite()` and on `[locale]/page.tsx` for the
 * measurements this rests on. The trap this codebase has already been bitten
 * by is a DIFFERENT one — a dynamic route with `Vercel-CDN-Cache-Control` in
 * front of it (`[locale]/repository/layers/page.tsx`) reading the locale
 * COOKIE directly, where the cache key has no room for it. None of these six
 * pages read `searchParams`, so none of them are on that path.
 *
 * ## Why a separate file rather than the ternary inline in `generateMetadata`
 *
 * `claims/page.tsx` and `layers/page.tsx` write the locale branch directly
 * inside `generateMetadata`, and that is fine there because nothing asserts
 * it — there is no test today that calls either page's `generateMetadata`
 * with `en` and `ja` and checks what comes back. `page.tsx` cannot be loaded
 * by `node --test` at all: its imports are extensionless and it renders JSX,
 * both of which `node --experimental-strip-types --test` chokes on (the same
 * reason `lib/canonical-locale-redirect.ts` and `lib/locale-rewrite.ts` take
 * no sibling import). Pulling the selection out to a plain function here is
 * what lets `public-page-metadata.test.ts` call it directly and prove a
 * broken locale check — a swapped `===`, a dropped branch, an `en` string
 * pasted into the `ja` return — fails a real assertion instead of only being
 * catchable by eye on a live deploy.
 *
 * ## Why the Japanese values are never string literals here
 *
 * Every `ja` branch below reads from the same copy table the page body
 * already renders (`HOME_COPY`, `CONTACT_COPY`, …) rather than a second,
 * hand-typed Japanese string. Two copies of one sentence is exactly the
 * failure this codebase has paid for before ("two pages come to disagree
 * about what a URL means" — `layers/page.tsx`'s `resolveOpenSet` comment
 * makes the general case). A meta description that drifts from the page's
 * own lede is a smaller version of the same bug, and reading the existing
 * constant means it cannot drift on its own.
 */

export function homeMetadataCopy(locale: PublicLocale): Pick<Metadata, "title" | "description"> {
  if (locale === "ja") {
    return {
      // `HOME_COPY.ja.hero.title` is the exact text rendered as this page's
      // `<h1>` — the line break it wraps on is a rendering choice (the JSX
      // draws each half on its own line), not a word boundary, and a
      // `<title>` should not carry it. Removed here rather than adding a
      // second, un-wrapped copy of the heading to `public-copy.ts`.
      title: HOME_COPY.ja.hero.title.replace("\n", ""),
      description: HOME_COPY.ja.hero.lede,
    };
  }
  // No `title` on English, unchanged from the static export this replaces.
  // See the long comment beside `generateMetadata` in `page.tsx` for why the
  // home page is the one page that must inherit the root layout's standalone
  // `default` rather than composing its own through the `"%s · Leona
  // Quantum"` template — a literal `title: "Leona Quantum"` here would
  // compose to "Leona Quantum · Leona Quantum" in a reader's tab.
  return { description: "Generate, run, and use quantum circuits with AI in one platform." };
}

export function contactMetadataCopy(locale: PublicLocale): Pick<Metadata, "title" | "description"> {
  return locale === "ja"
    ? { title: CONTACT_COPY.ja.overline, description: CONTACT_COPY.ja.body }
    : { title: "Contact", description: "Contact Leona Quantum about research workflows and early product access." };
}

export function pricingMetadataCopy(locale: PublicLocale): Pick<Metadata, "title" | "description"> {
  return locale === "ja"
    ? { title: PUBLIC_SHELL_COPY.ja.nav.pricing, description: PRICING_COPY.ja.hero.body }
    : { title: "Pricing", description: "Early-access Leona Quantum plans for individual researchers and teams." };
}

export function privacyMetadataCopy(locale: PublicLocale): Pick<Metadata, "title" | "description"> {
  return locale === "ja"
    ? { title: PRIVACY_COPY.ja.title, description: PRIVACY_COPY.ja.lede }
    : {
        title: "Privacy policy",
        description: "Leona Quantum privacy policy for the early-access product and public website.",
      };
}

export function termsMetadataCopy(locale: PublicLocale): Pick<Metadata, "title" | "description"> {
  return locale === "ja"
    ? { title: TERMS_COPY.ja.title, description: TERMS_COPY.ja.lede }
    : { title: "Terms of service", description: "Leona Quantum early-access terms for the public website and product." };
}

export function workspaceMetadataCopy(locale: PublicLocale): Pick<Metadata, "title" | "description"> {
  return locale === "ja"
    ? { title: PUBLIC_SHELL_COPY.ja.nav.workspace, description: WORKSPACE_LANDING_COPY.ja.body }
    : {
        title: "Workspace",
        description: "Leona Quantum's personal quantum workspace for guided development, Studio, and verified artifacts.",
      };
}
