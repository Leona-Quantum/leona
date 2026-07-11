// Surface names are owner-revisable (07-ui-product.md: "nav labels centralized in
// one config file so renaming is trivial"). Rename HERE only — never inline.
export interface NavSurface {
  href: string;
  label: string;
}

export const NAV_SURFACES: NavSurface[] = [
  { href: "/run", label: "Run" },
  { href: "/library", label: "Library" },
  { href: "/account", label: "Account" },
];

export const BRAND_NAME = "Majorana";
