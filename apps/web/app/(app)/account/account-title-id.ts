/**
 * The id on the settings <h1>, and the modal's accessible name.
 *
 * Its own module, and a boring one, because it is shared across the
 * server/client boundary: `account-content.tsx` renders the heading and pulls
 * in `server-only` transitively (auth, the tier table, the locale cookie),
 * while `account-modal.tsx` is a client component that needs the same string
 * for `aria-labelledby`. Importing one constant out of the content module drags
 * the whole server graph into the client bundle, and `next build` refuses it —
 * correctly, and this is the only place in the change that could have shipped a
 * server import to the browser.
 *
 * Safe as a constant rather than a generated id because the two shapes are
 * mutually exclusive by construction: an intercepted navigation renders the
 * modal slot while `children` still holds the PREVIOUS route, and a direct load
 * renders the page while the modal slot falls through to `default.tsx`. There
 * is no state in which both mount and the id is duplicated.
 */
export const ACCOUNT_TITLE_ID = "mj-account-title";
