import type { ReactNode } from "react";
import { RootDocument, rootMetadata } from "../../../components/root-document";

export const metadata = rootMetadata;

/**
 * The view-only Qapp embed (ai-ops 355, owner ruling: "Any website may embed
 * a published Qapp"). Mirrors `app/q/layout.tsx` in shape, with one
 * deliberate difference: it does NOT call `getPublicLocale()`.
 *
 * `getPublicLocale()` reads the locale cookie via Next's `cookies` function
 * (spelled without a call here on purpose — `scripts/check-static-routes.mjs`
 * greps route files for that literal text to find personalized routes, and a
 * comment merely mentioning it by name once made this route look like it
 * called it), which is a Dynamic API — the whole reason `/q/[slug]` cannot be
 * cached at the edge
 * (see next.config.ts's comment on `edgeCacheRules("/q", 300)`). This page
 * has the opposite goal: it must read no per-visitor state at all, so a
 * third-party page embedding it in an <iframe> gets a page that is safe to
 * cache and carries nothing tied to whoever is viewing it. `lang="en"` is a
 * fixed constant for the same reason the signed-in app and `/auth`, `/dev`,
 * `/lab` all pass "en" here — see `RootDocument`'s own docstring.
 *
 * `/embed/q/[slug]/page.tsx` still supports a `?locale=ja` query parameter for
 * the Qapp's own embed copy (reading `searchParams` already opts the page out
 * of static prerendering the same way the control-plane fetch does, so it
 * costs nothing this layout doesn't already accept) — that is a page-level
 * choice and does not touch `<html lang>`, which stays "en" here.
 */
export default function EmbedQappLayout({ children }: { children: ReactNode }) {
  return <RootDocument lang="en">{children}</RootDocument>;
}
