import { NotFoundBody } from "../../components/not-found-body";

/**
 * The signed-in app's 404, for the reason written out in
 * `app/repository/not-found.tsx`.
 *
 * **This boundary is precautionary, and the first draft of this comment said
 * otherwise.** It claimed `/qapps/[qappId]`, `/library/[artifactId]`,
 * `/shared/[projectId]` and `/run/[taskId]` "all `notFound()` on an id that does
 * not resolve". Grepped rather than believed: **nothing under `app/(app)/` calls
 * `notFound()` at all.** `library/[artifactId]` redirects into Studio, and the
 * others resolve a missing id without throwing. So no URL is known to reach this
 * file today; it is here so that the next dynamic route added under this tree
 * cannot reintroduce the unstyled 404, and `not-found-boundaries.test.ts` holds
 * that invariant.
 *
 * **What it renders, corrected on Sourcery's review of PR 824.** The draft said a
 * signed-in reader would get "the marketing header rather than the app shell".
 * That is wrong in the reader's favour: `app/(app)/layout.tsx` wraps its children
 * in `RootDocument` *and* `Shell`, and a `not-found.tsx` composes with its
 * segment's layout, so this renders inside the app shell with the shared
 * `NotFoundBody` nested in the content area. Not a design anyone chose — the body
 * is the public one — but it is styled, in-chrome, and not the defect the draft
 * apologised for.
 */
export default function AppNotFound() {
  return <NotFoundBody />;
}
