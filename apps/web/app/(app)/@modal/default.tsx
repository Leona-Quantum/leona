/**
 * What the `@modal` slot renders when nothing has intercepted it.
 *
 * Which is almost always: every route under `(app)` other than an in-app
 * navigation to /account, plus /account itself whenever it is loaded directly —
 * a bookmark, a refresh, a link from outside the app. Next.js needs this file
 * to exist, or a hard load of any route in this layout has an unmatched slot
 * and 404s.
 *
 * `null`, not an empty fragment, so nothing is added to the layout at all.
 */
export default function ModalSlotDefault() {
  return null;
}
