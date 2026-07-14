export const THEME_STORAGE_KEY = "majorana.theme.v1";

export type Theme = "light" | "dark";

export function readDocumentTheme(): Theme {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}
