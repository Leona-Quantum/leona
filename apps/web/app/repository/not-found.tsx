import { NotFoundBody } from "../../components/not-found-body";

/**
 * The Atlas's own 404, and it exists because the page a reader actually reaches
 * had **no stylesheet at all**.
 *
 * Measured against production on 2026-08-26, counting `rel="stylesheet"` links
 * in the served HTML:
 *
 * | URL | status | stylesheets |
 * |---|---|---|
 * | `/zzz-nothing-here` | 404 | **1** |
 * | `/repository/zzz` | 404 | **0** |
 * | `/repository/papers/zzz` | 404 | **0** |
 * | `/repository/folders/zzz` | 404 | **0** |
 * | `/repository/layers/zzz` | 404 | **0** |
 *
 * `global-not-found.tsx` fixed the first row — a URL matching no segment at
 * all — and only that row. Every row below it is a `notFound()` thrown from
 * INSIDE this segment, which falls through to `app/not-found.tsx`; that file
 * sits at the app root, where since ai-ops#151 there is no root layout, so Next
 * synthesises a bare `<html><body>` around it and no CSS is emitted. That file's
 * own comment says it answers a `notFound()` "where a root layout does exist" —
 * true of the segment, not of the boundary, and the difference is the bug.
 *
 * A `not-found.tsx` in the segment composes with `repository/layout.tsx`
 * instead, which renders `RootDocument` and therefore `globals.css`.
 *
 * **Why this tree and not some other.** `/repository/<slug>` is the shape of
 * every Atlas record, paper and map-region link. A stale bookmark, a corrected
 * slug, a link from outside — all of them land here, and what they got was
 * browser-default serif with blue underlined links. A status-code check passes
 * straight through that, which is why nothing caught it; the guard that does is
 * `not-found-boundaries.test.ts`.
 *
 * It reads no cookie and calls no Dynamic API, so it costs this tree nothing —
 * and this tree already answers `no-store` on every request regardless.
 */
export default function RepositoryNotFound() {
  return <NotFoundBody />;
}
