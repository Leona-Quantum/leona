// The app's own 404. Before this existed an unknown URL rendered Next's stock
// black-on-white error screen — no header, no footer, no way back — and most
// unknown URLs never even got that far, because middleware answered first and
// redirected them to the AuthKit sign-in page (see lib/routed-paths.ts).
//
// No `metadata` export: Next only reads that from `layout` and `page`, so one
// here would look like it set the tab title and quietly do nothing. The title
// falls back to the default in the root metadata (`components/root-document.tsx`).
//
// ## Why this file may not read a cookie or a header, which is not obvious
//
// Next puts the root not-found boundary in EVERY route's render tree. A Dynamic
// API called here is therefore called on every page in the app, and opts every
// one of them out of static rendering — including pages that import nothing and
// render a single line of text. That is measurable: with an earlier version of
// this file, which called `getPublicLocale()` and rendered `PublicSite` with
// the default chrome (`getMajoranaAuth()`, another Dynamic API), a page
// consisting of exactly
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
// into the static HTML and one is hidden by CSS keyed on the `lang` on
// `<html>` at paint time. No flash, and with JavaScript off the
// reader gets English — the honest fallback for a page that cannot know.
import { NotFoundBody } from "../components/not-found-body";

// Scoped to this page and inlined rather than added to globals.css, because it
// is meaningful only while a 404 is on screen. It keys off the `lang` that the
// locale script in `components/root-document.tsx` has already put on `<html>`
// before paint, so
// there is one mechanism rather than two. The default — no script, no
// JavaScript at all — shows English.
//
// The CSS itself moved to `lib/not-found-style.ts` so that `style-src-elem` can
// name it by hash instead of the policy admitting every inline stylesheet on
// every page. It is imported rather than written here because the hash is taken
// over this exact constant at build time — see that file.

export default function NotFound() {
  return <NotFoundBody />;
}
