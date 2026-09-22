import { qappCopy } from "../../../lib/qapp-copy";

/**
 * The 404 for `/embed/q/[slug]` — an unpublished, private, deleted, or
 * unknown Qapp answers exactly this, the same status code the public page
 * answers with `notFound()` (`app/q/[slug]/page.tsx` and this route both call
 * it from the same shared `loadPublicQapp`, `lib/qapp-public.ts`).
 *
 * Deliberately NOT `NotFoundBody` (the shared 404 rendered by `app/q/not-
 * found.tsx` and the site-wide boundary): that component renders the full
 * `PublicSite` marketing chrome, including a sign-in link, and this page is
 * meant to sit inside a third party's <iframe> with no sign-in surface at
 * all, even in its error state. A minimal, unstyled-chrome message is the
 * right amount of page here.
 *
 * A `notFound()` thrown inside a segment falls through to the NEAREST
 * `not-found.tsx` above it in the tree — without this file it would be
 * `app/not-found.tsx`, the root boundary, which (per `app/q/not-found.tsx`'s
 * own comment) renders with no stylesheet at all: measured on production,
 * `/q/zzz` once answered 404 with zero `rel="stylesheet"` links. This file
 * exists for the same reason that one does.
 */
export default function EmbedQappNotFound() {
  const copy = qappCopy("en").embed;
  return (
    <main className="qapp-embed-page qapp-embed-not-found" role="status">
      <p className="qapp-embed-badge">{copy.notFoundTitle}</p>
      <p>{copy.notFoundBody}</p>
    </main>
  );
}
