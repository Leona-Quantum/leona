"use client";

/**
 * The 404 for a `notFound()` thrown INSIDE a segment — ai-ops issue 188.
 *
 * `NotFoundBody` is the other one, and the difference is not cosmetic. That one
 * renders inside a real document: a root layout has already written `<html>`,
 * linked the compiled `globals.css`, run the theme and locale scripts and drawn
 * the site chrome, so it can lean on all of it. This one renders into a document
 * Next synthesises for its error-recovery path — `<html id="__next_error__">`
 * with an empty `<head>`. Nothing of ours is in it.
 *
 * Measured on a production build rather than argued: `/repository/zzz`,
 * `/repository/papers/zzz` and `/q/zzz` all answered 404 with **zero**
 * `rel="stylesheet"` links, while `/zzz-nothing-here` — which matches no segment
 * and so goes to `global-not-found.tsx` instead of a boundary — answered 404 with
 * a stylesheet. Every zero is a live Atlas or Qapp URL shape: a record, a paper,
 * a shared Qapp. A reader following a stale bookmark got browser-default serif.
 *
 * ## Why this is a client component, which looks like the wrong call
 *
 * It is not a choice. The boundary's output never reaches the served HTML at all
 * — it travels in the RSC flight payload and React mounts it in the browser.
 * That is measurable: with a probe boundary rendering `<div style={{color:"green"}}>`,
 * `color:green` appeared in `self.__next_f.push(...)` and in no markup. So this
 * subtree is client-rendered no matter how it is authored, and marking it
 * `"use client"` costs nothing and buys the two things below.
 *
 * **The locale.** The synthesised `<html>` has no `lang` and the pre-paint locale
 * script in `components/root-document.tsx` is in a head that does not exist here,
 * so the trick `NotFoundBody` uses — render both languages and let CSS keyed on
 * `html[lang]` hide one — has nothing to key on and would show a reader both
 * copies stacked. Reading the cookie here is the only way this page can know.
 * `useState` + `useEffect` rather than reading during render, so the first paint
 * is deterministic and a reader with no cookie, or with cookies disabled, gets
 * English — the same fallback the server would have chosen.
 *
 * **The theme.** Same shape as the locale, and it was got wrong the same way.
 * `public/not-found.css` used to say the reader's OS preference was "the only
 * signal that exists here", and `lib/not-found-standalone-tokens.test.ts` said
 * "this page has no theme script and so no `data-theme` attribute to key on."
 * Both were false for the same reason the locale paragraph above is true: this
 * subtree runs in the browser, so `localStorage` is readable, and the site's own
 * choice lives in `majorana.theme.v1`.
 *
 * Measured on production before it was changed: a reader with `light` chosen on
 * Leona and a dark OS got `data-theme="light"` on every real page and a DARK
 * 404 inside `/repository`, because the sheet's only rule was
 * `prefers-color-scheme`. It reverses for `dark` chosen on a light OS.
 *
 * The resolution below is character-for-character the one in
 * `components/root-document.tsx`'s pre-paint script — saved value if it is one
 * of the two, otherwise the OS — so the two surfaces cannot disagree. It runs in
 * `useEffect` rather than during render for the same reason the locale does, and
 * the frame before it lands still falls back to `prefers-color-scheme`, which is
 * exactly what shipped before. Strictly better, never worse.
 *
 * **The title.** `generateMetadata` on `/q/[slug]` and `/repository/[slug]` runs
 * before the fetch that decides the page does not exist, so it titles the tab
 * after the thing that is missing: `zzz — Qapp · Leona Quantum`. Measured on
 * production. It reaches no crawler — the served error document carries the site
 * fallback and `robots: noindex`, checked with `curl` — so this is the reader's
 * tab, history entry and bookmark, and it is fixed here rather than in each
 * segment's metadata because one effect covers every in-segment 404 at once.
 *
 * **The stylesheet.** `<link rel="stylesheet" precedence>` is a React 19 hoisted
 * element: React inserts it into `<head>` itself and blocks the reveal until it
 * loads, so there is no flash of unstyled text even though the head starts empty.
 * `/not-found.css` is a stable URL in `public/` because the compiled CSS filename
 * is content-hashed and this render has no way to learn it. `style-src-elem` in
 * `lib/content-security-policy.ts` already allows `'self'`, so this needs no
 * policy change and no hash — unlike an inline `<style>`, which the CSP would
 * have to name and which does not survive to the HTML anyway.
 */
import { useEffect, useState } from "react";
import { NOT_FOUND_COPY } from "../lib/public-copy";
import { siteTitle } from "../lib/public-metadata";
import { THEME_STORAGE_KEY, type Theme } from "../lib/theme";
import {
  LEGACY_PUBLIC_LOCALE_COOKIE,
  parsePublicLocale,
  PUBLIC_LOCALE_COOKIE,
  type PublicLocale,
} from "../lib/public-locale";

/**
 * The reader's theme, resolved exactly as `root-document.tsx`'s pre-paint script
 * resolves it: a stored `light`/`dark` wins, anything else falls to the OS.
 *
 * Returns `null` rather than a guess when storage is unreadable — a private
 * window, or a browser set to block site data. `null` leaves the attribute off
 * and the sheet's `prefers-color-scheme` rule decides, which is the same answer
 * the reader got before this function existed.
 */
function readStoredTheme(): Theme | null {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === "light" || saved === "dark") return saved;
    return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  } catch {
    return null;
  }
}

function readLocaleCookie(): PublicLocale {
  try {
    const jar = document.cookie.split("; ");
    const read = (name: string) => jar.find((c) => c.startsWith(`${name}=`))?.split("=")[1];
    return parsePublicLocale(read(PUBLIC_LOCALE_COOKIE) ?? read(LEGACY_PUBLIC_LOCALE_COOKIE));
  } catch {
    return "en";
  }
}

export function NotFoundStandalone() {
  const [locale, setLocale] = useState<PublicLocale>("en");
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    const next = readLocaleCookie();
    setLocale(next);
    // The document Next synthesised has no `lang` at all. Setting it here is
    // not decoration: it is the only chance this page has to tell a screen
    // reader which language the text below is in.
    document.documentElement.lang = next;
    setTheme(readStoredTheme());
    // The tab still says whatever the segment's `generateMetadata` guessed
    // before it knew the page was missing. Overwrite it with what the reader is
    // actually looking at, in the language they are reading it in.
    document.title = siteTitle(NOT_FOUND_COPY[next].title);
  }, []);

  const copy = NOT_FOUND_COPY[locale];

  return (
    <>
      <link rel="stylesheet" href="/not-found.css" precedence="mj-not-found" />
      <div className="mj-nf" lang={locale} data-theme={theme ?? undefined}>
        <div className="mj-nf-inner">
          <a className="mj-nf-brand" href="/">Leona Quantum</a>
          <p className="mj-nf-overline">{copy.label}</p>
          <h1>{copy.title}</h1>
          <p className="mj-nf-body">{copy.body}</p>
          <div className="mj-nf-actions">
            <a className="mj-nf-primary" href="/">{copy.home}</a>
            <a className="mj-nf-secondary" href="/repository">{copy.repository}</a>
          </div>
        </div>
      </div>
    </>
  );
}
