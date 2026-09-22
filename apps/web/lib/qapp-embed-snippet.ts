/**
 * The `<iframe>` snippet a creator copies from their Qapp's workspace page
 * (ai-ops 355, item 5 — the optional creator-side affordance). A pure string
 * builder so the exact markup is one place, tested once, rather than built
 * inline in `qapp-workspace.tsx` where a future edit could quietly drop an
 * attribute the security write-up promised (`sandbox` is deliberately NOT one
 * of them — see below).
 *
 * `origin` is the caller's own `window.location.origin`, not a hardcoded
 * domain: a locally-run copy of this app, or a future second environment,
 * should hand out a snippet pointing at itself.
 */
export function qappEmbedSnippet(origin: string, slug: string): string {
  const src = `${origin}/embed/q/${encodeURIComponent(slug)}`;
  // No `sandbox` attribute. Unlike `QappRuntime`'s inner `srcDoc` iframe
  // (`components/qapp-runtime.tsx`, `sandbox="allow-scripts"`, which holds a
  // GENERATED, less-trusted document), this iframe's `src` is a page from
  // this codebase's own origin, serving no per-visitor state and containing
  // no form, no run button, and no code that executes for the visitor — see
  // `app/embed/q/[slug]/page.tsx`'s own docstring. Sandboxing it would mainly
  // cost the page its own styling (a sandboxed frame with no `allow-same-
  // origin` cannot always resolve its own stylesheet reliably across
  // browsers) for a control this page has no dangerous capability for
  // `sandbox` to restrict.
  return `<iframe src="${src}" style="width:100%;height:480px;border:0" loading="lazy" title="Qapp"></iframe>`;
}
