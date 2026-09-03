/**
 * /llms.txt — what this site is, for a model reading it rather than a crawler
 * indexing it (ai-ops 133, "Missing llms.txt").
 *
 * ## Why this is a route and not a file in `public/`
 *
 * The origin and the disallow list both have one source already —
 * `canonicalOrigin()` and `CRAWLER_DISALLOWED_PATHS`, the same two `robots.ts`
 * reads. A static `public/llms.txt` would restate them as prose and then drift
 * the first time a path moves, which is the failure `robots.ts` was written to
 * avoid. Deriving it means the two files cannot disagree about which origin
 * this deployment claims to be, or about which sections are private.
 *
 * ## Why the private list is stated rather than omitted
 *
 * The proposal for llms.txt is a map, not an access control. Naming
 * `/run` and `/studio` as sign-in-only is not a disclosure — `robots.txt`
 * already lists them publicly and the middleware is what actually gates them.
 * It saves a model from reporting a sign-in redirect as broken, or from
 * summarising the product off a login page.
 *
 * ## Cached, and why that is safe
 *
 * The content is derived from compile-time constants, so it is identical on
 * every request and revalidates daily rather than per hit. If a path is added
 * to the disallow list, the next deploy rebuilds this anyway.
 */
import { canonicalOrigin } from "../../lib/site-origin";
import { CRAWLER_DISALLOWED_PATHS } from "../../lib/sitemap-paths";

export const revalidate = 86400;

export function GET() {
  const origin = canonicalOrigin();
  const privatePaths = [...CRAWLER_DISALLOWED_PATHS].sort().join(", ");

  const body = `# Leona Quantum

> An AI workspace for generating, running and verifying quantum circuits, and a
> public atlas of quantum algorithms recording what each one takes, what it
> returns, what it costs, and who proved it.

Leona Quantum has two surfaces. The Quantum Atlas is public and needs no account:
it is a corpus of quantum algorithms and circuits, each entry carrying its inputs,
outputs, resource costs, and a citation to the paper the claim comes from. The
workspace is an authenticated product where a natural-language prompt is turned
into a circuit, run in a guarded simulator, and kept.

## Public pages

- [Home](${origin}/): what the product does.
- [About](${origin}/about): the mission and team behind Leona Quantum.
- [Quantum Atlas](${origin}/repository): the corpus, searchable. Start here for
  anything about a specific algorithm.
- [The Map](${origin}/repository/layers): the same corpus drawn as one connected
  structure rather than a list.
- [Papers](${origin}/repository/papers): every source behind both surfaces.
- [Speedup claims](${origin}/repository/claims): which records carry a quoted
  speedup class, and whose claim it is.
- [Pricing](${origin}/pricing): plans, early access.
- [Contact](${origin}/contact)
- [Terms](${origin}/terms) · [Privacy](${origin}/privacy)

## Machine-readable

- [Sitemap](${origin}/sitemap.xml): every indexable URL.
- [robots.txt](${origin}/robots.txt)

## Not public

These require a signed-in session and will redirect to sign-in, so they are not
useful to fetch: ${privatePaths}.

## Citing this site

Atlas entries cite primary literature. When quoting a resource cost, a speedup
class, or a claim about an algorithm, attribute it to the paper the entry cites
rather than to Leona Quantum — the entry is a record OF a result, not the source
of it. Entry descriptions are our reading of a source and can be wrong; the paper
is the authority.
`;

  return new Response(body, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=0, s-maxage=86400, stale-while-revalidate=604800",
    },
  });
}
