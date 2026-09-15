import { workedExampleLinks, type WorkedExampleLink } from "./worked-example-links.ts";
import { workedExample, type WorkedExample } from "../worked-examples.ts";

/**
 * Turns a record's raw worked-example links (stage 1) into what the record
 * page actually draws (stage 2) — server-only.
 *
 * **Import this only from a Server Component.** `worked-examples.ts` carries
 * all 14 (soon 21) examples' full step lists and bilingual prose; a client
 * module that imports it ships every example to every visitor of every
 * record page, not just the one this record resolves to. `page.tsx` calls
 * this and passes down only the single resolved `WorkedExample` (or none) as
 * a serializable prop — the same pattern the estimate/profile/connections
 * panels already use, and for the same reason.
 *
 * Resolution rule, in order:
 * 1. A link's `exampleId` "resolves" when `workedExample()` finds it. Every
 *    link in the committed map resolves now (all 21 examples landed,
 *    2026-09-15, and `check-worked-example-links.mjs` makes an unresolved id
 *    a hard error) — the skip below is defensive, not load-bearing.
 * 2. The record's hero is replaced only when its FIRST resolvable link has
 *    relation `"instance"` — a worked example that instantiates the record
 *    itself, not one it merely uses or is used by.
 * 3. Every resolvable link with relation `"component"` or `"used-in"` gets a
 *    small note, wherever it falls — a first-position such link (no hero
 *    replacement) and, in principle, a second link after an `"instance"`
 *    first link both surface this way. `component` and `used-in` are
 *    opposite directions (this record uses the example / the example uses
 *    this record) and get different wording in the UI (atlas-worked-example.tsx),
 *    but both are "not the hero, still worth a link" — this function keeps
 *    them in one list and lets the relation on each pair decide the wording.
 */

export interface ResolvedWorkedExampleComponent {
  readonly link: WorkedExampleLink;
  readonly example: WorkedExample;
}

export interface ResolvedWorkedExamples {
  /** The example that replaces the hero, or null when none applies. */
  readonly hero: WorkedExample | null;
  /** Every resolvable component- or used-in-relation link, in the record's own order. */
  readonly components: readonly ResolvedWorkedExampleComponent[];
}

const NONE: ResolvedWorkedExamples = { hero: null, components: [] };

export function resolveWorkedExamples(slug: string): ResolvedWorkedExamples {
  const links = workedExampleLinks(slug);
  if (links.length === 0) return NONE;
  const resolved: ResolvedWorkedExampleComponent[] = [];
  for (const link of links) {
    const example = workedExample(link.exampleId);
    if (example) resolved.push({ link, example });
  }
  if (resolved.length === 0) return NONE;
  const first = resolved[0];
  const hero = first.link.relation === "instance" ? first.example : null;
  const components = resolved.filter((pair) => pair.link.relation === "component" || pair.link.relation === "used-in");
  return { hero, components };
}
