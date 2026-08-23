import { NOT_FOUND_COPY } from "../lib/public-copy";
import { NOT_FOUND_LOCALE_STYLE } from "../lib/not-found-style.ts";
import { PublicSite } from "../components/public-site";
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

function NotFoundBody() {
  return (
    <PublicSite className="mj-not-found-site" locale="en" chrome="static">
      <style dangerouslySetInnerHTML={{ __html: NOT_FOUND_LOCALE_STYLE }} />
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
