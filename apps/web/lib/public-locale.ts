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

export function parsePublicLocale(value: string | undefined): PublicLocale {
  return value === "ja" ? "ja" : "en";
}

export const PUBLIC_SHELL_COPY: Record<PublicLocale, {
  nav: { product: string; pricing: string; repository: string; workspace: string; contact: string };
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
}> = {
  en: {
    // `repository` is the catalogue at `/repository`, and it is called the
    // Quantum Atlas everywhere a reader meets its name (ai-ops#78). The nav
    // said "Atlas", the page it opens is headed "The Quantum Atlas", and a
    // fifth of the surfaces under it said something else again — the owner's
    // ruling is that there is one name. The article is dropped here and only
    // here: a nav bar reads as a list of destinations, not of sentences.
    nav: { product: "Product", pricing: "Pricing", repository: "Quantum Atlas", workspace: "Workspace", contact: "Contact" },
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
  },
  ja: {
    // 量子アトラス, not the Latin "Atlas" it said before: the page's own title,
    // its heading and the folder breadcrumb are all 量子アトラス, so the nav was
    // the one surface introducing a second name in this locale.
    nav: { product: "プロダクト", pricing: "料金", repository: "量子アトラス", workspace: "ワークスペース", contact: "お問い合わせ" },
    footer: {
      promise: "量子回路の生成・実行・活用を、ひとつのプラットフォームで",
      explore: "公開研究を見る",
      company: "会社情報",
      legal: "法務",
      contact: "お問い合わせ",
      privacy: "プライバシー",
      terms: "利用規約",
      builtFor: "量子研究を検証し、再現・共有したい研究者、エンジニア、チームのために",
    },
    actions: { workspace: "ワークスペースを開く", signIn: "サインイン", talk: "相談する", signOut: "サインアウト" },
  },
};
