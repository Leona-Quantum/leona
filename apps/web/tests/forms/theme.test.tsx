import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { ThemeController } from "../../components/theme-controller";
import { ThemeToggle } from "../../components/theme-toggle";
import { AccentPicker } from "../../components/accent-picker";
import { ACCENT_STORAGE_KEY, THEME_STORAGE_KEY } from "../../lib/theme";

beforeEach(() => { window.history.replaceState(null, "", "/run"); });

afterEach(() => { cleanup(); window.localStorage.clear(); delete document.documentElement.dataset.theme; delete document.documentElement.dataset.accent; });

function installMedia() {
  const media = { matches: true, addEventListener() {}, removeEventListener() {} };
  Object.defineProperty(window, "matchMedia", { configurable: true, value: () => media });
}

test("locale root replacement restores the chosen theme and keeps both controls in sync", () => {
  installMedia();
  window.localStorage.setItem(THEME_STORAGE_KEY, "light");
  const ui = (locale: "en" | "ja") => <><ThemeController locale={locale} /><ThemeToggle locale={locale} /><ThemeToggle locale={locale} /></>;
  const view = render(ui("en"));
  assert.equal(document.documentElement.dataset.theme, "light", "explicit light overrides dark OS preference");
  fireEvent.click(view.getAllByRole("button", { name: "Use dark theme" })[0]!);
  assert.ok(view.getAllByRole("button", { name: "Use dark theme" }).every(button => button.getAttribute("aria-pressed") === "true"));
  assert.equal(window.localStorage.getItem(THEME_STORAGE_KEY), "dark");
  // Next replaces HTML singleton attributes when the localized root changes.
  delete document.documentElement.dataset.theme;
  view.rerender(ui("ja"));
  assert.equal(document.documentElement.dataset.theme, "dark");
  assert.ok(view.getAllByRole("button", { name: "ダークテーマを使用" }).every(button => button.getAttribute("aria-pressed") === "true"));
  fireEvent.click(view.getAllByRole("button", { name: "ライトテーマを使用" })[1]!);
  delete document.documentElement.dataset.theme;
  view.rerender(ui("en"));
  assert.equal(document.documentElement.dataset.theme, "light");
  assert.ok(view.getAllByRole("button", { name: "Use light theme" }).every(button => button.getAttribute("aria-pressed") === "true"));
});

test("a theme change from another tab updates the page and controls", () => {
  installMedia();
  window.localStorage.setItem(THEME_STORAGE_KEY, "light");
  const view = render(<><ThemeController locale="en" /><ThemeToggle /></>);
  act(() => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "dark");
    window.dispatchEvent(new window.StorageEvent("storage", { key: THEME_STORAGE_KEY, newValue: "dark" }));
  });
  assert.equal(document.documentElement.dataset.theme, "dark");
  assert.equal(view.getByRole("button", { name: "Use dark theme" }).getAttribute("aria-pressed"), "true");
});


test("the public website is dark whatever was saved, and the saved choice is kept for the workspace", () => {
  installMedia();
  window.localStorage.setItem(THEME_STORAGE_KEY, "light");
  const view = render(<ThemeController locale="en" />);
  assert.equal(document.documentElement.dataset.theme, "light", "/run keeps the saved light");
  for (const path of ["/", "/workspace", "/repository", "/repository/layers", "/about", "/pricing", "/contact", "/privacy", "/terms", "/ja/about"]) {
    window.history.replaceState(null, "", path);
    view.rerender(<ThemeController locale="en" />);
    assert.equal(document.documentElement.dataset.theme, "dark", path);
    assert.equal(window.localStorage.getItem(THEME_STORAGE_KEY), "light", `${path} leaves the saved choice alone`);
  }
  for (const path of ["/run", "/account"]) {
    window.history.replaceState(null, "", path);
    view.rerender(<ThemeController locale="en" />);
    assert.equal(document.documentElement.dataset.theme, "light", path);
  }
});

test("a fixed light event document ignores saved dark mode without overwriting it", () => {
  installMedia();
  window.history.replaceState(null, "", "/events/qiskit-fall-fest-2026");
  window.localStorage.setItem(THEME_STORAGE_KEY, "dark");
  render(<ThemeController locale="ja" forcedTheme="light" />);
  assert.equal(document.documentElement.dataset.theme, "light");
  act(() => { window.dispatchEvent(new window.Event("pageshow")); });
  assert.equal(document.documentElement.dataset.theme, "light");
  assert.equal(window.localStorage.getItem(THEME_STORAGE_KEY), "dark");
});

test("a document's forced theme beats a saved one, survives restore and other tabs, and is never written", () => {
  installMedia();
  window.history.replaceState(null, "", "/welcome");
  window.localStorage.setItem(THEME_STORAGE_KEY, "light");
  render(<ThemeController locale="en" forcedTheme="dark" />);
  assert.equal(document.documentElement.dataset.theme, "dark");
  act(() => { window.dispatchEvent(new window.Event("pageshow")); });
  assert.equal(document.documentElement.dataset.theme, "dark", "after pageshow");
  act(() => {
    window.dispatchEvent(new window.StorageEvent("storage", { key: THEME_STORAGE_KEY, newValue: "light" }));
  });
  assert.equal(document.documentElement.dataset.theme, "dark", "after a change from another tab");
  assert.equal(window.localStorage.getItem(THEME_STORAGE_KEY), "light");
});

test("with nothing saved, public pages open dark and the workspace follows the OS", () => {
  const media = { matches: false, addEventListener() {}, removeEventListener() {} };
  Object.defineProperty(window, "matchMedia", { configurable: true, value: () => media });
  const view = render(<ThemeController locale="en" />);
  for (const path of ["/", "/repository", "/repository/layers", "/about", "/ja/pricing"]) {
    window.history.replaceState(null, "", path);
    view.rerender(<ThemeController locale="en" />);
    assert.equal(document.documentElement.dataset.theme, "dark", path);
  }
  for (const path of ["/run", "/account", "/events/qiskit-fall-fest-2026"]) {
    window.history.replaceState(null, "", path);
    view.rerender(<ThemeController locale="en" />);
    assert.equal(document.documentElement.dataset.theme, "light", path);
  }
  assert.equal(window.localStorage.getItem(THEME_STORAGE_KEY), null, "resolving a default never persists it");
});

test("the plum accent applies in the workspace only and moss is the absence of the attribute", () => {
  installMedia();
  window.localStorage.setItem(ACCENT_STORAGE_KEY, "plum");
  const view = render(<ThemeController locale="en" />);
  assert.equal(document.documentElement.dataset.accent, "plum", "/run");
  for (const path of ["/", "/repository", "/about", "/events/qiskit-fall-fest-2026", "/ja/pricing"]) {
    window.history.replaceState(null, "", path);
    view.rerender(<ThemeController locale="en" />);
    assert.equal(document.documentElement.dataset.accent, undefined, path);
  }
  window.history.replaceState(null, "", "/account");
  view.rerender(<ThemeController locale="en" />);
  assert.equal(document.documentElement.dataset.accent, "plum", "/account");
  act(() => {
    window.localStorage.setItem(ACCENT_STORAGE_KEY, "moss");
    window.dispatchEvent(new window.StorageEvent("storage", { key: ACCENT_STORAGE_KEY, newValue: "moss" }));
  });
  assert.equal(document.documentElement.dataset.accent, undefined, "moss after a change from another tab");
});

test("the accent picker applies plum at once, keeps it, and moss clears the attribute", () => {
  installMedia();
  const view = render(<><ThemeController locale="en" /><AccentPicker locale="en" /></>);
  fireEvent.click(view.getByRole("radio", { name: "Use plum" }));
  assert.equal(document.documentElement.dataset.accent, "plum");
  assert.equal(window.localStorage.getItem(ACCENT_STORAGE_KEY), "plum");
  assert.equal(view.getByRole("radio", { name: "Use plum" }).getAttribute("aria-checked"), "true");
  fireEvent.click(view.getByRole("radio", { name: "Use moss" }));
  assert.equal(document.documentElement.dataset.accent, undefined);
  assert.equal(window.localStorage.getItem(ACCENT_STORAGE_KEY), "moss");
});
