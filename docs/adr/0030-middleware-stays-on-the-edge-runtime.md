# ADR-0030: Auth, the locale rewrite and the canonical-host redirect stay in `middleware.ts`, on the edge runtime

**Date:** 2026-08-23 · **Status:** accepted — in force. Revisit only if Next announces removal of the
`middleware` convention, which as of 16.3.1 it explicitly has not.

**Context:** Next 16 prints a build-time deprecation warning on every `next dev` and every build:

```
⚠ The "middleware" file convention is deprecated. Please use "proxy" instead.
  npx @next/codemod@canary middleware-to-proxy .
```

The warning reads like a deadline. It is not one, and the codemod it advertises is not the rename it
appears to be. Two facts from Next's own version-16 upgrade guide settle it:

1. **`proxy.ts` cannot run on the edge.** Its runtime is strictly `nodejs`; the `runtime` option is
   not merely defaulted but unavailable, and setting it throws. The migration is a rename with a
   runtime change welded to it, and no configuration separates the two.
2. **Next names `middleware` as the supported escape hatch**, not a convention on a countdown:
   *"projects requiring the edge runtime should continue using middleware."*

`apps/web/middleware.ts` declares no `runtime`, so it is on the default — edge — today. It is also a
CODEOWNERS blast-radius file that runs on the path of every non-public route: `authkitMiddleware`
with `middlewareAuth.enabled`, `canonicalHostRedirect`, `localeRewriteTarget`, and `countPageview`.

**Decision:** stay on `middleware.ts`. Treat the deprecation warning as noise. Do not run the codemod.

**Why, specifically here — the reason is written down two files away.** `apps/web/next.config.ts`
records that the entire `Vercel-CDN-Cache-Control` design rests on `localeRewrite` running *in
middleware*, so the public pages are served from the CDN rather than rendered per request — and that
keeping them cacheable is precisely what forced `'unsafe-inline'` into `script-src` instead of
nonces. Moving that rewrite into a Node function is therefore not a runtime detail; it is a change to
where the public site is cached, which is load-bearing for both cost and the CSP we already accepted
a weaker form of in exchange.

Migrating would additionally move every authenticated request's gate off the edge network onto a Node
function, changing latency, cold-start behaviour and Vercel cost across the whole authenticated
surface. Nothing about the deprecation warning obliges that trade, and nothing is broken today.

**A comment that becomes wrong if this is ever reversed.** `countPageview` reads
`process.env.LEONA_PAGEVIEW_LOG` by a **static** key, and the comment above it explains why: Next
inlines edge-runtime environment variables only where it can see the key at build time, so a dynamic
lookup would always come back `undefined` and the off switch would silently never turn anything off.
Under the Node runtime that constraint no longer applies. The code stays correct either way — but its
stated reason stops being true, and a stale reason in a comment is the shape that gets quoted back as
current fact. Whoever reverses this ADR must fix that comment in the same change.

**Consequences:**

- The deprecation warning stays in build output. That is accepted noise, not an outstanding task, and
  a future session finding it should read this ADR rather than re-deriving the decision.
- If a future Next major does remove the convention, the migration is not a codemod: it is a measured
  change with p50/p95 numbers on the authenticated surface, a re-examination of the CDN caching
  design in `next.config.ts`, and the `countPageview` comment above.

**Owner ruling:** `EshMis/ai-ops#148` — raised as a decision rather than a chore, and closed with
"close this if all is resolved and settled". This ADR is what makes it settled rather than
rediscovered.
