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
  actions: { workspace: string; signIn: string; talk: string; signOut: string };
}> = {
  en: {
    nav: { product: "Product", pricing: "Pricing", repository: "Atlas", workspace: "Workspace", contact: "Contact" },
    footer: {
      promise: "Generate, optimize, and use quantum circuits on one platform.",
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
    nav: { product: "プロダクト", pricing: "料金", repository: "Atlas", workspace: "ワークスペース", contact: "お問い合わせ" },
    footer: {
      promise: "量子回路の生成・最適化・活用を、ひとつのプラットフォームで",
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
