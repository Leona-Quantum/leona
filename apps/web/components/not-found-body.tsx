import { NOT_FOUND_COPY } from "../lib/public-copy";
import { NOT_FOUND_LOCALE_STYLE } from "../lib/not-found-style.ts";
import { PublicSite } from "./public-site";

/**
 * The 404 page's content — the header, the copy in both languages, and the
 * links out. **One copy, because there are two boundaries that render it.**
 *
 * `app/not-found.tsx` answers a `notFound()` thrown inside a segment, where a
 * root layout exists. `app/global-not-found.tsx` answers a URL that matches no
 * segment at all, where none does, so that one renders the whole document
 * itself. They differ only in the document around them, and nothing about the
 * page a reader sees should depend on which of the two they reached.
 *
 * It lives here rather than in either route file because a route file cannot
 * import from another route file's default export without one of them owning
 * the other. It was briefly duplicated instead; CodeRabbit caught that on the
 * PR, correctly — two copies of a page's markup drift, and the commit that
 * introduced them claimed they were shared.
 *
 * Both locales are rendered and one is hidden by CSS keyed on `<html lang>`,
 * which is why the boundary may not read a cookie: see `app/not-found.tsx` for
 * the measured build-output evidence behind that constraint.
 *
 * **The whole shell is what renders twice, not only the copy.** It used to be
 * the copy alone, inside one `PublicSite` fixed at `locale="en"` — so a reader
 * whose cookie says `ja` met 「このページは存在しません。」 wrapped in an English
 * nav and an English footer, with the language control showing **EN** as the
 * selected language. The control was not merely untranslated: it told the reader
 * the opposite of their own setting. Read on leonaqt.com 2026-08-27.
 *
 * Rendering `PublicSite` twice is what fixes it, and it costs nothing that
 * matters: `chrome="static"` reaches no Dynamic API, so the page stays on the
 * CDN — which it must, because this one response is served to every unmatched
 * URL there is (`x-vercel-cache: HIT` with the same body on two different
 * paths, measured the same day). Nothing here may read a cookie on the server,
 * so the reader's locale can only be applied in their own browser, and the
 * pre-paint script in `components/root-document.tsx` that sets `<html lang>` is
 * what these rules key on.
 *
 * `PublicSite` already puts `lang` on the `<main>` it renders, so the shell
 * needs no wrapper element and no new attribute for the CSS to find.
 */
export function NotFoundBody() {
  return (
    <>
      {/* Rendered once, outside both shells: two copies of it would be two
          identical inline stylesheets for one rule set, and the CSP names this
          body by its hash, so the element has to stay byte-identical to the
          constant either way. */}
      <style dangerouslySetInnerHTML={{ __html: NOT_FOUND_LOCALE_STYLE }} />
      {(["en", "ja"] as const).map((locale) => {
        const copy = NOT_FOUND_COPY[locale];
        return (
          <PublicSite key={locale} className="mj-not-found-site" locale={locale} chrome="static">
            <section
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
          </PublicSite>
        );
      })}
    </>
  );
}
