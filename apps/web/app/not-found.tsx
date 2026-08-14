// The app's own 404. Before this existed an unknown URL rendered Next's stock
// black-on-white error screen — no header, no footer, no way back — and most
// unknown URLs never even got that far, because middleware answered first and
// redirected them to the AuthKit sign-in page (see lib/routed-paths.ts).
//
// No `metadata` export: Next only reads that from `layout` and `page`, so one
// here would look like it set the tab title and quietly do nothing. The title
// falls back to the default in app/layout.tsx.
//
// ## Why this file may not read a cookie or a header, which is not obvious
//
// Next puts the root not-found boundary in EVERY route's render tree. A Dynamic
// API called here is therefore called on every page in the app, and opts every
// one of them out of static rendering — including pages that import nothing and
// render a single line of text. That is measurable: with an earlier version of
// this file, which called `getPublicLocale()` and rendered `PublicSite` with
// the default chrome (`getMajoranaAuth()` and `getMajoranaSignInUrl()`, two more
// Dynamic APIs), a page consisting of exactly
//
//     export default function P() { return <main>probe</main>; }
//
// built as `ƒ` — Dynamic. Making only this file static, touching no page, moved
// /demo, /dev/ui, /lab and /open-source to `○` static on their own.
//
// The trap worth naming: this file renders on no route and appears in no
// route's source, so nothing about a page that will not cache points here. A
// grep of the ten public pages for Dynamic APIs finds real ones and still
// misses the one that was disqualifying all of them.
//
// So the locale is chosen in the browser instead. Both languages are rendered
// into the static HTML and one is hidden by CSS keyed on the `lang` that
// `app/layout.tsx` sets before paint. No flash, and with JavaScript off the
// reader gets English — the honest fallback for a page that cannot know.
import { NOT_FOUND_COPY } from "../lib/public-copy";
import { PublicSite } from "../components/public-site";

// Scoped to this page and inlined rather than added to globals.css, because it
// is meaningful only while a 404 is on screen. It keys off the `lang` that
// `app/layout.tsx`'s locale script has already put on `<html>` before paint, so
// there is one mechanism rather than two. The default — no script, no
// JavaScript at all — shows English.
const localeStyle = `
  .mj-not-found-copy[lang="ja"] { display: none; }
  html[lang="ja"] .mj-not-found-copy[lang="en"] { display: none; }
  html[lang="ja"] .mj-not-found-copy[lang="ja"] { display: revert; }
`;

export default function NotFound() {
  return (
    <PublicSite className="mj-not-found-site" locale="en" chrome="static">
      <style dangerouslySetInnerHTML={{ __html: localeStyle }} />
      {(["en", "ja"] as const).map((locale) => {
        const copy = NOT_FOUND_COPY[locale];
        return (
          <section
            key={locale}
            lang={locale}
            className="mj-legal-hero mj-not-found-copy"
            aria-labelledby={`not-found-heading-${locale}`}
          >
            <p className="mj-public-overline">{copy.label}</p>
            <h1 id={`not-found-heading-${locale}`}>{copy.title}</h1>
            <p>{copy.body}</p>
            <div className="mj-public-actions">
              <a className="mj-primary-button" href="/">{copy.home}</a>
              <a className="mj-secondary-button" href="/repository">{copy.repository}</a>
            </div>
          </section>
        );
      })}
    </PublicSite>
  );
}
