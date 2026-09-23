export type PublicLocale = "en" | "ja";

/**
 * Every locale the public site prerenders, and the only values `[locale]` will
 * answer to.
 *
 * Typed as the union rather than `string[]` on purpose: adding a language means
 * adding it to `PublicLocale`, and this list then fails to compile until the
 * copy records below have it too. A page's `generateStaticParams` reads this, so
 * a locale absent here is a locale nothing is built for — with
 * `dynamicParams = false` on those pages, it 404s instead of rendering English
 * under a wrong path.
 */
export const PUBLIC_LOCALES: readonly PublicLocale[] = ["en", "ja"];

export const PUBLIC_LOCALE_COOKIE = "leona.locale.v2";
export const LEGACY_PUBLIC_LOCALE_COOKIE = "majorana.locale.v1";

/** One year, in seconds — the same duration `language-toggle.tsx` has always
 * written, now named so the second writer below cannot silently drift from it. */
export const PUBLIC_LOCALE_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

/**
 * The cookie options every writer of `PUBLIC_LOCALE_COOKIE` must share: the
 * client-side switcher (`components/language-toggle.tsx`) and the canonical
 * redirect (`middleware.ts`'s `canonicalRedirect`, ai-ops 329 — a shared
 * `/ja` link sets this cookie to `ja` on its way to the unprefixed address).
 *
 * Same shape and the same reason as `authHintCookieOptions` in
 * `lib/auth-hint.ts`: a `path` or `sameSite` that drifts between two writers
 * of the same cookie name produces TWO cookies of that name, and which one a
 * reader is on then depends on write order rather than on the locale they
 * actually chose.
 *
 * No `secure` and no `httpOnly` here, and both are matches rather than
 * omissions: `document.cookie` from the switcher sets neither, and
 * `readPublicLocaleCookie()` above has to be able to read this cookie back
 * from the browser, which an `httpOnly` cookie would hide from it.
 */
export function publicLocaleCookieOptions() {
  return {
    path: "/",
    maxAge: PUBLIC_LOCALE_COOKIE_MAX_AGE_SECONDS,
    sameSite: "lax",
  } as const;
}

export function parsePublicLocale(value: string | undefined): PublicLocale {
  return value === "ja" ? "ja" : "en";
}

/**
 * Strict, unlike `parsePublicLocale`, which coerces anything to `"en"`.
 *
 * Both are needed and using the wrong one is a bug that renders rather than
 * throws. Reading a COOKIE, coercion is right — a stale or hand-edited value
 * should give the reader the default, not a 404. Reading a PATH SEGMENT it is
 * wrong: `/zz/repository/layers` is not the English page, it is a second
 * address for it.
 *
 * ## Why a page has to call this rather than lean on `dynamicParams = false`
 *
 * `dynamicParams = false` only restricts params on a route that actually
 * prerenders — it decides whether to render params OUTSIDE the prerendered set,
 * and on a route where nothing is prerendered every param is outside it. So a
 * PRERENDERED page under `[locale]` (`/zz/pricing`, `/zz/repository/claims`)
 * 404s on its own, and a DYNAMIC one (`/zz/repository/layers`, which reads
 * `searchParams` and therefore cannot prerender) served the English map at that
 * address with a 200. Measured on a preview deployment, both halves in one run.
 *
 * Left alone that undoes the mistyped-URL fix for exactly the routes with the
 * most traffic, and the `dynamicParams = false` line in their source reads as a
 * guarantee it is not giving.
 */
/**
 * The reader's locale, read in their own BROWSER.
 *
 * Both 404s need this and neither may ask the server. The global 404 is one
 * CDN-cached response served to every unmatched URL there is, and the in-segment
 * 404 renders into a document Next synthesises for its error path, where nothing
 * of ours ran at all. So the cookie is the only signal either page has, and it
 * can only be read after the page is in front of somebody.
 *
 * It lived in `components/not-found-standalone.tsx` as a file-local function
 * while only that page needed it. Shared rather than copied: the two pages
 * differ in their markup on purpose and must not differ in which cookie they
 * believe, and a second copy of a four-line cookie parse is exactly the kind of
 * thing that goes on agreeing until the cookie name changes.
 *
 * Returns `"en"` on anything it cannot read — no cookie, cookies disabled, a
 * value that is not a locale — which is the same answer the server renders, so
 * the fallback is never a third behaviour.
 */
export function readPublicLocaleCookie(): PublicLocale {
  try {
    const jar = document.cookie.split("; ");
    const read = (name: string) => jar.find((entry) => entry.startsWith(`${name}=`))?.split("=")[1];
    return parsePublicLocale(read(PUBLIC_LOCALE_COOKIE) ?? read(LEGACY_PUBLIC_LOCALE_COOKIE));
  } catch {
    return "en";
  }
}

export function isPublicLocale(value: string | undefined): value is PublicLocale {
  return (PUBLIC_LOCALES as readonly (string | undefined)[]).includes(value);
}

export const PUBLIC_SHELL_COPY: Record<PublicLocale, {
  nav: { product: string; about: string; pricing: string; repository: string; workspace: string; contact: string; notebooks: string; qapps: string };
  footer: {
    promise: string;
    explore: string;
    company: string;
    legal: string;
    contact: string;
    privacy: string;
    terms: string;
    builtFor: string;
  };
  actions: { workspace: string; signIn: string; talk: string; signOut: string };
  /** Accessible name for the wordmark link in the header and the footer.
   *
   * The wordmark itself is `aria-hidden` — it is artwork, and a screen reader
   * announcing the image would say nothing useful — so this string IS the link
   * as far as assistive technology is concerned. It was hardcoded English on
   * both, including on every `/ja` page, while the navigation landmark two
   * lines below it localized correctly. Raised by CodeRabbit on leona 713.
   *
   * The brand name stays untranslated in both, because it is a proper noun;
   * only the destination word changes. */
  brandHome: string;
}> = {
  en: {
    // Navigation uses the short name; the catalog page carries the full title.
    nav: { product: "Product", about: "About", pricing: "Pricing", repository: "Atlas", workspace: "Workspace", contact: "Contact", notebooks: "Notebooks", qapps: "Qapps" },
    footer: {
      promise: "Generate, run, and use quantum circuits on one platform.",
      explore: "Explore",
      company: "Company",
      legal: "Legal",
      contact: "Contact us",
      privacy: "Privacy policy",
      terms: "Terms",
      builtFor: "For researchers, engineers, and teams who need evidence.",
    },
    actions: { workspace: "Open workspace", signIn: "Sign in", talk: "Talk to us", signOut: "Sign out" },
    brandHome: "Leona Quantum home",
  },
  ja: {
    // Keep the compact destination label consistent between navigation menus.
    nav: { product: "プロダクト", about: "会社紹介", pricing: "料金", repository: "Atlas", workspace: "ワークスペース", contact: "お問い合わせ", notebooks: "ノートブック", qapps: "Qapps" },
    footer: {
      promise: "量子回路の生成・実行・活用を、ひとつのプラットフォームで",
      explore: "公開研究を見る",
      company: "会社情報",
      legal: "規約・ポリシー",
      contact: "お問い合わせ",
      privacy: "プライバシー",
      terms: "利用規約",
      builtFor: "量子計算の結果を検証・再現し、共有したい研究者やエンジニア、チームのために",
    },
    actions: { workspace: "ワークスペースを開く", signIn: "サインイン", talk: "相談する", signOut: "サインアウト" },
    brandHome: "Leona Quantum ホーム",
  },
};
