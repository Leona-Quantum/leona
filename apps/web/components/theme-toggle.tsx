"use client";

import { useEffect, useState } from "react";

type Theme = "light" | "dark";

const THEME_STORAGE_KEY = "majorana.theme.v1";

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

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    setTheme(document.documentElement.dataset.theme === "dark" ? "dark" : "light");
  }, []);

  function selectTheme(nextTheme: Theme) {
    setTheme(nextTheme);
    applyTheme(nextTheme);
  }

  return (
    <div className="mj-theme-toggle" role="group" aria-label="Color theme">
      {(["light", "dark"] as const).map((option) => (
        <button
          key={option}
          type="button"
          data-theme-option={option}
          aria-label={`Use ${option} theme`}
          aria-pressed={theme === null ? undefined : theme === option}
          onClick={() => selectTheme(option)}
        >
          <ThemeIcon theme={option} />
          <span>{option === "light" ? "Light" : "Dark"}</span>
        </button>
      ))}
    </div>
  );
}
