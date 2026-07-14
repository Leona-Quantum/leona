export type PublicLocale = "en" | "ja";

export const PUBLIC_LOCALE_COOKIE = "majorana.locale.v1";

export function parsePublicLocale(value: string | undefined): PublicLocale {
  return value === "ja" ? "ja" : "en";
}

export const PUBLIC_SHELL_COPY: Record<PublicLocale, {
  nav: { product: string; pricing: string; repository: string; openSource: string; contact: string };
  footer: {
    promise: string;
    explore: string;
    company: string;
    legal: string;
    contact: string;
    email: string;
    privacy: string;
    terms: string;
    builtFor: string;
  };
  actions: { workspace: string; signIn: string; talk: string };
}> = {
  en: {
    nav: { product: "Product", pricing: "Pricing", repository: "Repository", openSource: "Open source", contact: "Contact" },
    footer: {
      promise: "Trustworthy quantum work, one verified artifact at a time.",
      explore: "Explore",
      company: "Company",
      legal: "Legal",
      contact: "Contact us",
      email: "Email Eshaan",
      privacy: "Privacy policy",
      terms: "Terms",
      builtFor: "Built for researchers, engineers, and teams who need evidence.",
    },
    actions: { workspace: "Open workspace", signIn: "Sign in", talk: "Talk to us" },
  },
  ja: {
    nav: { product: "プロダクト", pricing: "料金", repository: "リポジトリ", openSource: "オープンソース", contact: "連絡先" },
    footer: {
      promise: "検証済みアーティファクトを通じて、信頼できる量子研究を支えます。",
      explore: "探索",
      company: "会社情報",
      legal: "法務",
      contact: "お問い合わせ",
      email: "Eshaanにメール",
      privacy: "プライバシー",
      terms: "利用規約",
      builtFor: "証拠を必要とする研究者、エンジニア、チームのために。",
    },
    actions: { workspace: "ワークスペースを開く", signIn: "サインイン", talk: "相談する" },
  },
};
