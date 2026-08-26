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
 * What is read here is only the reader's EXPLICIT choice — see `readStoredTheme`
 * for why this stops short of resolving the OS preference the way
 * `root-document.tsx`'s script does. A stored `light`/`dark` is stamped onto
 * `.mj-nf`; anything else leaves the attribute off and the sheet's media query
 * decides, live. It runs in `useEffect` rather than during render for the same
 * reason the locale does, and the frame before it lands falls back to
 * `prefers-color-scheme`, which is exactly what shipped before. Strictly better,
 * never worse.
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
  readPublicLocaleCookie,
  type PublicLocale,
} from "../lib/public-locale";

/**
 * The reader's EXPLICIT theme choice, or `null` if they have not made one.
 *
 * Only a stored `light`/`dark` is returned. Everything else — no stored value, a
 * value that is neither, or storage that throws in a private window — is `null`,
 * and `null` leaves `data-theme` off so the sheet's `prefers-color-scheme` rule
 * decides. That is the same answer the reader got before this function existed.
 *
 * **It deliberately does NOT resolve the OS preference itself**, which the first
 * version did, mirroring `root-document.tsx`'s pre-paint script. CodeRabbit
 * caught why that is wrong here: resolving it once at mount FREEZES it into the
 * attribute, and `data-theme="light"` then blocks the very media rule it was
 * copying. A reader with no stored choice whose OS flips to dark — at sunset, on
 * a schedule — would be left on the light palette by the attribute we wrote.
 * Leaving it unset keeps the media query live, which is strictly better than
 * copying its answer.
 *
 * The explicit case is unaffected and is the whole bug this exists for: a stored
 * `light` still stamps `data-theme="light"` and still beats a dark OS.
 */
function readStoredTheme(): Theme | null {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    return saved === "light" || saved === "dark" ? saved : null;
  } catch {
    return null;
  }
}


export function NotFoundStandalone() {
  const [locale, setLocale] = useState<PublicLocale>("en");
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    const next = readPublicLocaleCookie();
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
          {/* The site's own wordmark, not the words in the body face.
              Measured on production 2026-08-26, `/repository/zzz` against
              `/repository`: every real page draws `.lq-wordmark`, a CSS mask
              over `/brand/leona-quantum-wordmark.png`, and this page wrote
              "Leona Quantum" as text in Instrument Sans 15px/500. A reader who
              knows the mark met a different one on the error page.

              This is the half of ai-ops issue 189 that needs no gamble. That
              issue proposed promoting one of Next's PRELOADED CSS CHUNKS to a
              real stylesheet so the 404 could wear the whole site chrome, and
              declined itself because chunk names are not a contract and no test
              here can see one change. None of that applies to a PNG under
              `public/`: the path is as stable as this stylesheet's own, and
              `check-static-routes` already owns both. */}
          <a className="mj-nf-brand" href="/" aria-label={copy.brandHome} title={copy.brandHome}>
            <span className="mj-nf-wordmark" aria-hidden="true" />
          </a>
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
