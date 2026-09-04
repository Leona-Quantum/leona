import { NotFoundBody } from "../../components/not-found-body";

/**
 * For the reason written out in `app/repository/not-found.tsx`: a `notFound()`
 * thrown inside a segment composes with that segment's own root layout, and
 * without this file it falls through to `app/not-found.tsx`, which sits above
 * every root layout and so renders with no stylesheet.
 *
 * `/dev/ui` and `/dev/sentry-verify` both `notFound()` in production builds.
 * Middleware sends an anonymous visitor to sign-in before either runs, so the
 * reader who reaches this boundary is signed in — which makes it rarer, not
 * unreachable.
 *
 * Added after Greptile caught the gap on PR 824, which is worth recording. The
 * first version of the guard required a boundary only of segments containing a
 * **dynamic route**, reasoning that a dynamic route is what `notFound()`s on an
 * id that does not resolve. A static page that 404s on a feature flag does the
 * same thing and was not covered. The guard now asks whether anything in the
 * segment calls `notFound()` at all.
 */
export default function DevNotFound() {
  return <NotFoundBody />;
}
