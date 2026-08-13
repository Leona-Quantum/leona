// The app's own 404. Before this existed an unknown URL rendered Next's stock
// black-on-white error screen — no header, no footer, no way back — and most
// unknown URLs never even got that far, because middleware answered first and
// redirected them to the AuthKit sign-in page (see lib/routed-paths.ts).
//
// No `metadata` export: Next only reads that from `layout` and `page`, so one
// here would look like it set the tab title and quietly do nothing. The title
// falls back to the default in app/layout.tsx.
import { PublicSite } from "../components/public-site";
import { NOT_FOUND_COPY } from "../lib/public-copy";
import { getPublicLocale } from "../lib/public-locale-server";

export default async function NotFound() {
  const locale = await getPublicLocale();
  const copy = NOT_FOUND_COPY[locale];
  return (
    <PublicSite className="mj-not-found-site" locale={locale}>
      <section className="mj-legal-hero" aria-labelledby="not-found-heading">
        <p className="mj-public-overline">{copy.label}</p>
        <h1 id="not-found-heading">{copy.title}</h1>
        <p>{copy.body}</p>
        <div className="mj-public-actions">
          <a className="mj-primary-button" href="/">{copy.home}</a>
          <a className="mj-secondary-button" href="/repository">{copy.repository}</a>
        </div>
      </section>
    </PublicSite>
  );
}
