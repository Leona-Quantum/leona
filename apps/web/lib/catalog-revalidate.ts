/**
 * How long the public site may serve a page before it re-renders.
 *
 * ## Why this is its own module
 *
 * It lived in `repository-source.ts`, which is the natural home — that file is
 * what passes it to `fetch`. But `repository-source.ts` reaches
 * `./catalog-pagination` through an extensionless relative import, and bare
 * `node --test` cannot resolve those, so every test that imported the constant
 * died on module resolution before running an assertion. A constant with no
 * dependencies of its own does not need to drag a fetch layer behind it.
 *
 * ## Why the number is load-bearing
 *
 * `sync-bootstrap` publishes corpus changes WITHOUT a deploy, and the site is
 * expected to pick them up in about five minutes. `force-static` would freeze
 * the corpus until the next deploy and silently break catalog-sync — which has
 * already caused one production incident: 362 records served against a manifest
 * of 369, for a day.
 *
 * Next requires `export const revalidate` to be a statically analyzable literal,
 * so the public pages cannot import this and write `300` themselves.
 * `public-revalidate.test.ts` asserts every one of them still matches it.
 */
export const CATALOG_REVALIDATE_SECONDS = 300;
