import { NotFoundBody } from "../components/not-found-body";
import { RootDocument, rootMetadata } from "../components/root-document";
import { NOT_FOUND_COPY } from "../lib/public-copy";
import { siteTitle } from "../lib/public-metadata";

/**
 * The 404 for a URL that matches **no segment at all**.
 *
 * Since ai-ops issue 151 there is no `app/layout.tsx`; each top-level segment
 * owns its own root layout. A globally unmatched URL belongs to no segment, so
 * `app/not-found.tsx` has no root layout to compose with and Next renders it
 * inside a synthesised bare `<html><body>` — no `lang`, no fonts, and **no
 * `globals.css`**. That shipped, briefly: `leonaqt.com/<anything-unmatched>`
 * served this page with no stylesheet at all, browser-default serif and blue
 * underlined links.
 *
 * `global-not-found.tsx` is Next's own answer to exactly that case — its docs
 * name "your app has multiple root layouts" as the first trigger. It renders
 * the **whole document**, so it may not be layered on top of `not-found.tsx`:
 * the first thing tried was wrapping that file in `RootDocument`, which nests a
 * second `<html>` inside the boundary's default one and fails hydration with
 * *"You are mounting a new html component when a previous one has not first
 * unmounted"*. One document, rendered here, is the shape that works.
 *
 * `app/not-found.tsx` stays and still handles a `notFound()` thrown from inside
 * a segment, where a root layout does exist. The two share `NotFoundBody` so
 * the copy cannot drift.
 */
/**
 * `rootMetadata` with one field replaced: the **tab said the site's own default
 * title**, so a reader with several tabs open could not tell a missing page from
 * the home page. It now says what the page is.
 *
 * `absolute`, because `rootMetadata` declares `title.template` — a plain string
 * here would come out as "This page does not exist. · Leona Quantum · Leona
 * Quantum".
 *
 * **It is English for every reader, and that is a real remainder, not an
 * oversight.** The rest of this page localises by rendering both languages and
 * hiding one with CSS keyed on `<html lang>` (see `lib/not-found-style.ts`);
 * `<title>` cannot be rendered twice, and the page may not read the locale
 * cookie on the server because one CDN-cached response answers every unmatched
 * URL there is. The obvious alternative was tried and does not work: a client
 * effect writing `document.title`, the same fix `NotFoundStandalone` makes in
 * its own document, is overwritten here. Measured on a production build with the
 * locale cookie set to `ja` — the effect's value never appears, while
 * `document.title` set by hand from the console at the same moment sticks, and
 * `AuthStatus` on this page does hydrate and does fetch, so it is not that
 * client components are inert. The remaining suspect is React re-committing the
 * hoisted `<title>` on the re-render `AuthStatus`'s own fetch triggers. Whoever
 * picks this up: that is where to look, and an English page name is a better
 * placeholder than an English page name that is also the wrong page.
 */
export const metadata = {
  ...rootMetadata,
  title: { absolute: siteTitle(NOT_FOUND_COPY.en.title) },
};

export default function GlobalNotFound() {
  return (
    <RootDocument lang="en">
      <NotFoundBody />
    </RootDocument>
  );
}
