import { NotFoundBody } from "../../components/not-found-body";

/**
 * The signed-in app's 404, for the reason written out in
 * `app/repository/not-found.tsx`. `/qapps/[qappId]`, `/library/[artifactId]`,
 * `/shared/[projectId]` and `/run/[taskId]` all `notFound()` on an id that does
 * not resolve, and all four fell through to a boundary with no stylesheet.
 *
 * **What is deliberately NOT settled here.** `NotFoundBody` renders the PUBLIC
 * chrome, so a signed-in reader who mistypes an artifact id gets the marketing
 * header rather than the app shell. That is worse than an app-chrome 404 and
 * much better than an unstyled page, so it ships as the smaller of two known
 * defects rather than as the right answer. Giving this tree its own body is a
 * design call, not a bug fix, and it is not being made from a terminal.
 */
export default function AppNotFound() {
  return <NotFoundBody />;
}
