// Surface names are owner-revisable (07-ui-product.md: "nav labels centralized in
// one config file so renaming is trivial"). Rename HERE only — never inline.
export interface NavSurface {
  href: string;
  labels: { en: string; ja: string };
}

export const NAV_SURFACES: NavSurface[] = [
  { href: "/run", labels: { en: "Run", ja: "実行" } },
  { href: "/library", labels: { en: "Library", ja: "ライブラリ" } },
  { href: "/studio", labels: { en: "Studio", ja: "スタジオ" } },
  { href: "/account", labels: { en: "Account", ja: "アカウント" } },
];

export function navSurfaceLabel(surface: NavSurface, locale: "en" | "ja" = "en"): string {
  return surface.labels[locale];
}

export const BRAND_NAME = "LeonaQ";
