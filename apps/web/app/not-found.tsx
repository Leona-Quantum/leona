// The 404 boundary for a `notFound()` thrown from inside a route segment.
//
// **What this file is NOT any more.** It used to be the app's general 404 and
// rendered `NotFoundBody`, the full public site chrome. With
// `experimental.globalNotFound` on, a URL matching no segment at all goes to
// `app/global-not-found.tsx` instead, which renders the whole document and can
// therefore afford that chrome. What is left here is the other case, and it is a
// harsher environment than it looks: Next renders a boundary `notFound()` through
// its error-recovery path, inside `<html id="__next_error__">` with an empty
// `<head>` — no `globals.css`, no fonts, no theme or locale script. Rendering the
// site chrome here produced a correct 404 and a visibly broken page at the same
// time, on every record, paper and shared-Qapp URL (ai-ops issue 188).
//
// So this renders `NotFoundStandalone`, which brings its own stylesheet. The two
// still share `NOT_FOUND_COPY` in `lib/public-copy.ts`, so the words cannot drift
// even though the markup differs on purpose.
//
// No `metadata` export: Next only reads that from `layout` and `page`, so one
// here would look like it set the tab title and quietly do nothing.
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
// That constraint is why `NotFoundStandalone` reads the locale cookie in the
// browser rather than here. It is a client component for that reason among
// others; see its own header.
import { NotFoundStandalone } from "../components/not-found-standalone";

export default function NotFound() {
  return <NotFoundStandalone />;
}
