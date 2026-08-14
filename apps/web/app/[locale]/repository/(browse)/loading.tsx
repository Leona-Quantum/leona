// This file lives in the (browse) route group, and NOT at
// app/[locale]/repository/, on purpose — same reason the pre-move version at
// app/repository/(browse)/loading.tsx gave, carried over unchanged: a
// loading.tsx is a Suspense boundary that streams and commits HTTP 200
// immediately, so a boundary any higher would also wrap `layers/` and
// `claims/`, which do not want it, and would wrap `[slug]`'s catch-all if it
// still lived under this tree (it does not — `/repository/<slug>` stays at
// app/repository/, uncached, on purpose; see lib/routed-paths.ts).
//
// English only, not `getPublicLocale()` and not `params`. Both were tried and
// both are wrong here, for different reasons:
//
//   - `getPublicLocale()` reads a cookie, which is exactly the read the page
//     this fronts moved here to stop doing — a loading.tsx that read it would
//     put the same class of bug one file over.
//   - `params` looked like the fix and is not reliably available: a production
//     build of this exact file with `parsePublicLocale((await params).locale)`
//     failed prerendering `/ja/repository` with "Cannot read properties of
//     undefined (reading 'locale')" — `loading.tsx` does not receive `params`
//     the same way `page.tsx` does in this Next version, at least not during
//     the export step that runs for `generateStaticParams()`'d locales.
//
// So: a fixed, locale-neutral skeleton. The window this is visible for is
// sub-second and content-free (four blank skeleton bars), which is a smaller
// cost than either bug above.
import { LOADING_COPY } from "../../../../lib/public-copy";

const copy = LOADING_COPY.en;

export default function RepositoryLoading() {
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
