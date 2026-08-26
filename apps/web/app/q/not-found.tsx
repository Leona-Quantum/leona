import { NotFoundBody } from "../../components/not-found-body";

/**
 * The 404 for a shared Qapp link, for the reason written out in
 * `app/repository/not-found.tsx`: a `notFound()` thrown inside a segment falls
 * through to `app/not-found.tsx`, which has no root layout above it and so
 * renders with no stylesheet. Measured on production 2026-08-26: `/q/zzz`
 * answered 404 with **0** `rel="stylesheet"` links.
 *
 * This is the tree a Qapp creator hands to somebody else, so the reader who
 * meets it is the least equipped to guess that an unstyled page is a bug rather
 * than the product.
 */
export default function QappNotFound() {
  return <NotFoundBody />;
}
