export type PublicLocale = "en" | "ja";

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
  actions: { workspace: string; signIn: string; talk: string };
}> = {
  en: {
    nav: { product: "Product", pricing: "Pricing", repository: "Repository", workspace: "Workspace", contact: "Contact" },
    footer: {
      promise: "Trustworthy quantum work, one verified artifact at a time.",
      explore: "Explore",
      company: "Company",
      legal: "Legal",
      contact: "Contact us",
      privacy: "Privacy policy",
      terms: "Terms",
      builtFor: "For researchers, engineers, and teams who need evidence.",
    },
    actions: { workspace: "Open workspace", signIn: "Sign in", talk: "Talk to us" },
  },
  ja: {
    nav: { product: "プロダクト", pricing: "料金", repository: "リポジトリ", workspace: "ワークスペース", contact: "連絡先" },
    footer: {
      promise: "検証済みアーティファクトを通じて、信頼できる量子研究を支えます。",
      explore: "探索",
      company: "会社情報",
      legal: "法務",
      contact: "お問い合わせ",
      privacy: "プライバシー",
      terms: "利用規約",
      builtFor: "根拠を必要とする研究者、エンジニア、チームのために。",
    },
    actions: { workspace: "ワークスペースを開く", signIn: "サインイン", talk: "相談する" },
  },
};
