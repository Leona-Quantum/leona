import Link from "next/link";
import { controlPlaneUrl, fetchControlPlane } from "../../lib/control-plane";
import { qappCopy } from "../../lib/qapp-copy";
import { getPublicLocale } from "../../lib/public-locale-server";
import { readPublicQappPage, type PublicQappPage } from "../../lib/qapp-management";

export const metadata = {
  title: "Explore Qapps — Leona Quantum",
  description: "Published, interactive quantum applications anyone can run.",
};

/**
 * The public Qapp gallery. Real server-side paging and search — `q` and
 * `cursor` are read here and pushed into the control-plane query, not
 * filtered client-side out of one fixed page (proposal 6, item 2).
 *
 * No sign-in state is read on this page (unlike `/q/[slug]`, which needs to
 * know whether a visitor can execute): the gallery only links to individual
 * Qapp pages, which handle that themselves. That keeps this route eligible
 * for the same edge-cache-in-front-of-the-render treatment `/repository`
 * uses (`next.config.ts`'s `edgeCacheRules("/q", ...)`) — reading
 * `searchParams` still opts it out of Next's own static prerender, the same
 * way `/repository/layers` is not in `REQUIRED_STATIC_ROUTES` either.
 */
export default async function QappGalleryPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; cursor?: string }>;
}) {
  const [{ q, cursor }, locale] = await Promise.all([searchParams, getPublicLocale()]);
  const copy = qappCopy(locale).gallery;

  const url = controlPlaneUrl("/v1/qapps/public");
  if (q) url.searchParams.set("q", q);
  if (cursor) url.searchParams.set("cursor", cursor);
  const response = await fetchControlPlane(url);
  const page: PublicQappPage =
    (response.ok ? readPublicQappPage(await response.json()) : null) ?? { items: [], next_cursor: null };

  return (
    <main className="mj-qapps-page qapp-gallery-page">
      <div className="mj-qapps-scroll">
        <header className="mj-qapps-hero">
          <div>
            <h1>{copy.title}</h1>
            <p>{copy.lede}</p>
          </div>
        </header>

        <form className="mj-library-toolbar" method="get" action="/q">
          <label className="mj-library-search">
            <span className="sr-only">{copy.searchPlaceholder}</span>
            <input type="search" name="q" defaultValue={q ?? ""} placeholder={copy.searchPlaceholder} />
          </label>
          <button className="mj-secondary-button" type="submit">{copy.searchAction}</button>
          {q ? <Link className="mj-secondary-button" href="/q">{copy.clear}</Link> : null}
        </form>

        {page.items.length === 0 ? (
          <div className="mj-library-empty leona-workspace-state">
            <strong>{q ? copy.noMatch : copy.empty}</strong>
          </div>
        ) : (
          <div className="mj-qapps-grid">
            {page.items.map((item) => (
              <article className="mj-qapp-card" key={item.slug}>
                <div className="mj-qapp-card-meta">
                  <span data-public="true">{item.framework}</span>
                  <time dateTime={item.published_at}>{copy.publishedOn} {item.published_at}</time>
                </div>
                <div className="mj-qapp-card-copy">
                  <h2>{item.title}</h2>
                  <p>{item.description}</p>
                </div>
                <div className="mj-qapp-card-detail">
                  <span>{copy.qubits(item.qubits_estimate)}</span>
                  <span>{copy.version(item.version)}</span>
                </div>
                <div className="mj-qapp-card-actions">
                  <Link className="mj-primary-button" href={`/q/${encodeURIComponent(item.slug)}`}>{copy.open}</Link>
                </div>
              </article>
            ))}
          </div>
        )}

        {page.next_cursor ? (
          <Link
            className="mj-secondary-button qapp-gallery-next"
            href={`/q?${new URLSearchParams({ ...(q ? { q } : {}), cursor: page.next_cursor }).toString()}`}
          >
            {copy.next}
          </Link>
        ) : null}
      </div>
    </main>
  );
}
