// This file lives in the (browse) route group, and NOT at app/repository/, on
// purpose. A loading.tsx is a Suspense boundary: the moment one streams, Next
// commits HTTP 200 and a later notFound() can no longer change the status. A
// boundary at app/repository/ covers [slug] too, which turned every unknown
// /repository/<slug> into a soft 404 (200 + not-found body). Scoping it to
// (browse) leaves [slug] unstreamed, so it returns a real 404.
//
// The root app/loading.tsx was deleted for the same reason — it sat above every
// route and re-broke the status on its own. Verified both directions with a
// production build: with the boundaries above [slug], unknown slugs returned
// 200; scoped as they are now, real slugs return 200 and unknown return 404.
// If you add a loading.tsx at app/ or app/repository/, you silently undo this.
import { LOADING_COPY } from "../../../lib/public-copy";
import { getPublicLocale } from "../../../lib/public-locale-server";

export default async function RepositoryLoading() {
  const copy = LOADING_COPY[await getPublicLocale()];
  return (
    <main className="mj-loading-screen" aria-busy="true" aria-label={copy.repository}>
      <span className="sr-only" role="status" aria-live="polite">{copy.status}</span>
      <span className="mj-skeleton mj-skeleton--eyebrow" />
      <span className="mj-skeleton mj-skeleton--title" />
      <span className="mj-skeleton mj-skeleton--copy" />
      <span className="mj-skeleton mj-skeleton--panel" />
    </main>
  );
}
