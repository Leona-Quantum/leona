import { NotFoundBody } from "../components/not-found-body";
import { RootDocument, rootMetadata } from "../components/root-document";

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
export const metadata = rootMetadata;

export default function GlobalNotFound() {
  return (
    <RootDocument lang="en">
      <NotFoundBody />
    </RootDocument>
  );
}
