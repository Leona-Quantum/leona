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
 */
export function NotFoundBody() {
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
