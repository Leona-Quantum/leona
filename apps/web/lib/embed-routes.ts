/**
 * The view-only Qapp embed's own routes, and the general anti-framing rule's
 * exclusion of them — ai-ops 355 (owner ruling: "Any website may embed a
 * published Qapp"). `next.config.ts`'s `headers()` is the only place these are
 * consumed; they live here, not there, so `embed-routes.test.ts` can assert
 * against the exact patterns that ship rather than a restatement of them.
 *
 * ## Why the general rule needs its own, narrowed source rather than a later
 * override
 *
 * Next's `headers()` MERGES the header sets of every `source` that matches a
 * request; it does not let a later, more specific match unset a header an
 * earlier, broader match already added. Two entries that both match
 * `/embed/q/<slug>` — the site-wide catch-all and an embed-specific one placed
 * after it — would both apply, so the catch-all's `X-Frame-Options: DENY`
 * would still reach the embed route even though the later entry never mentions
 * that key. (The one case where "last one wins" is real: two matching entries
 * that set the SAME key. `Content-Security-Policy` could be overridden that
 * way, but `X-Frame-Options` cannot be un-set that way, only never-set.)
 *
 * So the catch-all itself must not match the embed subtree. `GENERAL_ANTI_FRAMING_SOURCE`
 * is that catch-all, `/(.*)` with a negative lookahead carved out of it.
 */

/** The embed route's own root. Everything under it is the same page, by slug. */
export const EMBED_QAPP_ROUTE = "/embed/q";

/** The embed route and its `[slug]` subtree, as `next.config.ts` `source` values. */
export const EMBED_QAPP_SOURCES: readonly string[] = [EMBED_QAPP_ROUTE, `${EMBED_QAPP_ROUTE}/:path*`];

/**
 * Every path except the embed subtree. `(?!embed/q(?:/|$))` is a negative
 * lookahead: the remainder after the leading `/` may not start with
 * `"embed/q"` followed by `/` or end-of-string. Verified against Next's own
 * matcher in `embed-routes.test.ts` — not merely reasoned about, the same
 * reason `edge-cache-headers.test.ts` imports Next's `matchHas` for the
 * `missing` side of a header rule instead of re-implementing it.
 */
export const GENERAL_ANTI_FRAMING_SOURCE = "/((?!embed/q(?:/|$)).*)";
