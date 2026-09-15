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
 * 1. A link's `exampleId` "resolves" when `workedExample()` finds it. Not
 *    every link resolves yet — 7 of the 21 examples the map points at are
 *    still being written on a sibling lane (see
 *    `check-worked-example-links.mjs`'s warning), and an unresolved link is
 *    silently skipped here rather than surfaced as a gap; the record's
 *    hero/example section falls back to what stage 1 already draws.
 * 2. The record's hero is replaced only when its FIRST resolvable link has
 *    relation `"instance"` — a worked example that instantiates the record
 *    itself, not a component it merely uses.
 * 3. Every resolvable link with relation `"component"` gets a small
 *    "worked example of a part this method uses" block, wherever it falls —
 *    a first-position `"component"` link (no hero replacement) and, in
 *    principle, a second link after an `"instance"` first link both surface
 *    this way.
 */

export interface ResolvedWorkedExampleComponent {
  readonly link: WorkedExampleLink;
  readonly example: WorkedExample;
}

export interface ResolvedWorkedExamples {
  /** The example that replaces the hero, or null when none applies. */
  readonly hero: WorkedExample | null;
  /** Every resolvable component-relation link, in the record's own order. */
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
  const components = resolved.filter((pair) => pair.link.relation === "component");
  return { hero, components };
}
