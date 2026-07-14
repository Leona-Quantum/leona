"use client";

import { useEffect, useState } from "react";
import { THEME_STORAGE_KEY, readDocumentTheme, type Theme } from "../lib/theme";
import type { PublicLocale } from "../lib/public-locale";

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // The active page can still switch themes when storage is unavailable.
  }
}

function ThemeIcon({ theme }: { theme: Theme }) {
  return theme === "light" ? (
    <svg aria-hidden="true" viewBox="0 0 16 16">
      <circle cx="8" cy="8" r="2.5" />
      <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.4 1.4M11.55 11.55l1.4 1.4M12.95 3.05l-1.4 1.4M4.45 11.55l-1.4 1.4" />
    </svg>
  ) : (
    <svg aria-hidden="true" viewBox="0 0 16 16">
      <path d="M13.6 10.1A5.6 5.6 0 0 1 5.9 2.4 5.8 5.8 0 1 0 13.6 10Z" />
    </svg>
  );
}

export function ThemeToggle({ locale = "en" }: { locale?: PublicLocale }) {
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    // The blocking layout script applies the stored theme before hydration.
    // Keep aria-pressed unset until this client-only sync so server and client
    // markup match while CSS still reflects the active document theme.
    setTheme(readDocumentTheme());
  }, []);

  function selectTheme(nextTheme: Theme) {
    setTheme(nextTheme);
    applyTheme(nextTheme);
  }

  const copy = locale === "ja"
    ? { group: "カラーテーマ", light: "ライト", dark: "ダーク", lightTitle: "ライトテーマを使用", darkTitle: "ダークテーマを使用" }
    : { group: "Color theme", light: "Light", dark: "Dark", lightTitle: "Use light theme", darkTitle: "Use dark theme" };

  return (
    <div className="mj-theme-toggle" role="group" aria-label={copy.group} title={copy.group}>
      {(["light", "dark"] as const).map((option) => (
        <button
          key={option}
          type="button"
          data-theme-option={option}
          aria-label={option === "light" ? copy.lightTitle : copy.darkTitle}
          title={option === "light" ? copy.lightTitle : copy.darkTitle}
          aria-pressed={theme === null ? undefined : theme === option}
          onClick={() => selectTheme(option)}
        >
          <ThemeIcon theme={option} />
          <span>{option === "light" ? copy.light : copy.dark}</span>
        </button>
      ))}
    </div>
  );
}
