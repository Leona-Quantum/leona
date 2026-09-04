import { NotFoundBody } from "../../components/not-found-body";

/**
 * For the reason written out in `app/repository/not-found.tsx`: a `notFound()`
 * thrown inside a segment composes with that segment's own root layout, and
 * without this file it falls through to `app/not-found.tsx`, which sits above
 * every root layout and so renders with no stylesheet.
 *
 * `/lab` renders the 404 on production by design — `isLabDirectionEnabled()` is
 * false there — so this boundary sits on a path a real reader reaches, not a
 * hypothetical one.
 *
 * Added after Greptile caught the gap on PR 824, which is worth recording. The
 * first version of the guard required a boundary only of segments containing a
 * **dynamic route**, reasoning that a dynamic route is what `notFound()`s on an
 * id that does not resolve. A static page that 404s on a feature flag does the
 * same thing and was not covered. The guard now asks whether anything in the
 * segment calls `notFound()` at all.
 */
export default function LabNotFound() {
  return <NotFoundBody />;
}
