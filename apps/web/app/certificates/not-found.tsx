import { NotFoundBody } from "../../components/not-found-body";

/**
 * The 404 for an unknown or mistyped certificate link — same reasoning as
 * `app/q/not-found.tsx`: a `notFound()` thrown inside this segment falls
 * through to the root `app/not-found.tsx`, which has no styled layout above
 * it. This is a link a learner shares outside the app, so the reader who
 * meets it is the least equipped to guess an unstyled page is a bug.
 */
export default function CertificateNotFound() {
  return <NotFoundBody />;
}
