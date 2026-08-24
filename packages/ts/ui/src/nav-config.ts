// Surface names are owner-revisable, so nav labels are centralized here and renaming is
// a one-file change (docs/ui/README.md map). Rename HERE only — never inline.
export interface NavSurface {
  href: string;
  labels: { en: string; ja: string };
}

export const NAV_SURFACES: NavSurface[] = [
  { href: "/run", labels: { en: "Run", ja: "Run" } },
  { href: "/studio", labels: { en: "Studio", ja: "Studio" } },
  { href: "/qapps", labels: { en: "Qapps", ja: "Qapps" } },
  { href: "/account", labels: { en: "Account", ja: "アカウント" } },
];

export function navSurfaceLabel(surface: NavSurface, locale: "en" | "ja" = "en"): string {
  return surface.labels[locale];
}

export const BRAND_NAME = "Leona Quantum";
