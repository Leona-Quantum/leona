export const THEME_STORAGE_KEY = "majorana.theme.v1";
export const ACCENT_STORAGE_KEY = "majorana.accent.v1";

export type Theme = "light" | "dark";
/** The workspace's one colour: moss (the default) or the owner's plum (2026-09-12). */
export type Accent = "moss" | "plum";
export const ACCENTS: ReadonlyArray<Accent> = ["moss", "plum"];

/**
 * The public website is dark, with no choice (owner, 2026-09-12: "website: only dark
 * theme, no togglable option"). These paths render dark whatever a visitor saved. The
 * saved value is left in storage, untouched, because the signed-in workspace still
 * reads it. The purely public root layouts also pass `forcedTheme="dark"` to
 * `RootDocument`, so their served HTML is dark before any script runs; this list
 * covers the public pages under a root that does not force it (the Atlas).
 */
export const DARK_PUBLIC_PATHS = ["/", "/workspace", "/repository", "/about", "/pricing", "/contact", "/privacy", "/terms"];

export function stripLocale(pathname: string): string {
  return pathname.replace(/^\/(en|ja)(?=\/|$)/, "").replace(/\/$/, "") || "/";
}

export function isDarkPublicPath(pathname: string): boolean {
  const path = stripLocale(pathname);
  return DARK_PUBLIC_PATHS.includes(path) || path.startsWith("/repository/");
}

/** The public site (marketing pages, the Atlas, events) keeps moss; the accent choice is the workspace's. */
export function isPublicPath(pathname: string): boolean {
  const path = stripLocale(pathname);
  return isDarkPublicPath(path) || path === "/events" || path.startsWith("/events/");
}

const THEME_CHANGE_EVENT = "leona:theme-change";
let sessionTheme: Theme | null = null;
let sessionAccent: Accent | null = null;
let transitionFrame = 0;

/** The saved choice, or null; the in-memory copy only stands in where storage itself is unavailable. */
export function savedTheme(): Theme | null {
  try {
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
    return saved === "light" || saved === "dark" ? saved : null;
  } catch {
    // The in-memory choice still survives locale navigation without storage.
    return sessionTheme;
  }
}

export function preferredTheme(): Theme {
  return savedTheme() ?? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
}

/**
 * What the page at `pathname` should show: the document's forced theme if its layout
 * set one, else dark on the public site, else the saved choice, else the OS.
 */
export function resolveTheme(pathname: string, forcedTheme?: Theme): Theme {
  return forcedTheme ?? (isDarkPublicPath(pathname) ? "dark" : preferredTheme());
}

export function preferredAccent(): Accent {
  try {
    const saved = window.localStorage.getItem(ACCENT_STORAGE_KEY);
    return saved === "moss" || saved === "plum" ? saved : "moss";
  } catch {
    // As above.
    return sessionAccent ?? "moss";
  }
}

/** The accent the page at `pathname` should carry: the chosen one in the workspace, moss everywhere public. */
export function resolveAccent(pathname: string): Accent {
  return isPublicPath(pathname) ? "moss" : preferredAccent();
}

export function applyTheme(theme: Theme, persist = false) {
  const root = document.documentElement;
  if (root.dataset.theme !== theme) {
    // Apply the whole palette together. Interpolated backgrounds paired with
    // the new text color can be unreadable during an otherwise brief transition.
    if (transitionFrame) window.cancelAnimationFrame(transitionFrame);
    root.classList.add("lq-theme-switching");
    root.dataset.theme = theme;
    transitionFrame = window.requestAnimationFrame(() => {
      transitionFrame = window.requestAnimationFrame(() => {
        root.classList.remove("lq-theme-switching");
        transitionFrame = 0;
      });
    });
  }
  if (persist) {
    sessionTheme = theme;
    try { window.localStorage.setItem(THEME_STORAGE_KEY, theme); } catch {}
  }
  window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
}

/** Moss is the absence of the attribute, so the tokens' defaults hold with nothing set. */
export function applyAccent(accent: Accent, persist = false) {
  const root = document.documentElement;
  if (accent === "moss") delete root.dataset.accent;
  else root.dataset.accent = accent;
  if (persist) {
    sessionAccent = accent;
    try { window.localStorage.setItem(ACCENT_STORAGE_KEY, accent); } catch {}
  }
  window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
}

export function subscribeTheme(onChange: () => void) {
  window.addEventListener(THEME_CHANGE_EVENT, onChange);
  return () => window.removeEventListener(THEME_CHANGE_EVENT, onChange);
}

export function readDocumentTheme(): Theme {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

export function readDocumentAccent(): Accent {
  return document.documentElement.dataset.accent === "plum" ? "plum" : "moss";
}
