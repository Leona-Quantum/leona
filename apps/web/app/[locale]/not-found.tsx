import { NotFoundBody } from "../../components/not-found-body";

/**
 * The public marketing tree's 404, for the reason written out in
 * `app/repository/not-found.tsx`.
 *
 * This one is the least reachable of the four and is here so the invariant
 * holds rather than because a URL was measured failing: `/en/...` and `/ja/...`
 * answer 308 — the locale is a cookie, `leona.locale.v2`, not a path segment —
 * so this tree's own dynamic route is served at `/repository/layers/[id]`
 * instead, and that URL is covered by the sibling file above. If a path-shaped
 * locale ever stops redirecting, this is already in place.
 */
export default function LocaleNotFound() {
  return <NotFoundBody />;
}
