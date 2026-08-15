// Server-side assembly of the `/repository` browse list (ai-ops#105).
//
// ## The problem this module exists to fix
//
// Every visit to `/repository` used to send the whole corpus — all 369
// records, ~2,400 bytes each on `PUBLIC_REPOSITORY_LIST_FIELDS`'s own measured
// floor — to `RepositoryBrowser`, a client component, which then filtered,
// ordered, folded and capped them **in the browser**. The server already
// resolved every filter from the URL (`browse-params.ts`); the client just
// never used that to decide what to SEND, only what to render. A default,
// unfiltered visit paid for 369 records to show 24 of them.
//
// This module is the fix: the whole pipeline — search, category, topic and
// stance filtering, the circuit-only filter, ordering, the ranked/unranked
// split, width-family and curated-cluster folding, and the row cap — moves
// here, runs once per request against the full corpus the server already
// fetched, and returns only what the page is about to draw. `entries` never
// crosses back into `RepositoryBrowser` at all; this is now the one place that
// reads it.
//
// ## What stays corpus-wide, and why that is not a contradiction
//
// The facet rail's counts (`topicGroups`, `stanceOptions`, the domain and
// connectable/meeting numbers) are computed over the FULL corpus, unfiltered —
// this is unchanged from what `repository-browser.tsx` did before, and the
// reason is unchanged too: "a count that moves while a reader is looking at it
// is a hint, not a count" (facet rail comment, `repository-browser.tsx`).
// Bounding what is SENT is about the ROWS, not the counts beside them — a
// facet count is a handful of integers, not a record, and shipping the true
// corpus-wide numbers costs nothing near what shipping 369 records did.
//
// Family and curated-cluster membership (`groupOfSlug`) is likewise derived
// from the full corpus every time, for the reason `families.ts` already
// states: a family's membership is a property of the catalogue, not of the
// current query, and deriving it from a filtered subset would make "8 widths"
// mean "8 widths that match your search". What changes is that only the
// members which SURVIVE the request's filters and land inside the row cap are
// ever serialized — `foldRows` already drops the members a filter removed; the
// row cap now drops the rows the cap removed, at the exact same boundary a
// crawler or a no-JS reader would see.
//
// ## Why this is a plain function and not another `useMemo` chain
//
// Every step below already existed as a `useMemo` body in
// `repository-browser.tsx`, computed from a full `entries` prop on every
// render. Moving it here rather than leaving it there and only trimming the
// prop was the point of ai-ops#105 — the owner's ruling was "server-side
// filtering and pagination, so the browser gets only what it is showing", and
// a client component cannot bound what it is SENT no matter what it does with
// the array once it arrives. A plain function also means the whole pipeline is
// reachable from `node --test` without a render harness, the same argument
// `search.ts` and `topic-filter.ts` already made for the pieces it composes.
import { orderEntries, withCircuitOnly, isProfileOrder } from "./browse-order.ts";
import { capRows, splitCapped, type RowLimit } from "./browse-page.ts";
import type { ResolvedBrowseParams } from "./browse-params.ts";
import type { RepositoryEstimateList, RepositoryEstimateSummary } from "./estimate.ts";
import { profilesBySlug, type RepositoryProfileList } from "./profile.ts";
import {
  deriveWidthFamilies,
  foldRows,
  widthFamilyGroup,
  type FoldedRow,
  type RowGroup,
} from "./families.ts";
import { topicOptions, filterByTopic, type TopicOptionGroup } from "./topic-filter.ts";
import { matchesRepositoryQuery } from "./search.ts";
import {
  connectedCount,
  declaresPort,
  deriveInterface,
  filterByStance,
  interfaceOptions,
  type EntryInterface,
  type InterfaceOption,
} from "./interface.ts";
import { TOPICS_BY_ID } from "./topics.ts";
import type { PublicRepositoryListEntry } from "./types.ts";

export type BrowseRow = FoldedRow<PublicRepositoryListEntry>;

/**
 * Curated variant groups — the same two clusters that used to live as
 * `VARIANT_GROUPS` in `repository-browser.tsx`, moved here because folding
 * now happens server-side and the client no longer builds `groupOfSlug` at
 * all. See `families.ts`'s header for why these stay hand-picked rather than
 * derived: a curated cluster names two records that are the same algorithm in
 * different FORMS, which no rule can see — only the eight-widths-of-one-thing
 * case is derived, by `deriveWidthFamilies` below.
 */
const VARIANT_GROUPS: RowGroup[] = [
  {
    key: "qft",
    label: "Quantum Fourier transform",
    labelJa: "量子フーリエ変換",
    slugs: ["quantum-fourier-transform", "qft-resource-screen"],
  },
  {
    key: "phase-estimation",
    label: "Phase estimation",
    labelJa: "位相推定",
    slugs: ["quantum-phase-estimation", "iterative-phase-estimation"],
  },
];

const CURATED_SLUG_TO_GROUP = new Map<string, RowGroup>();
for (const group of VARIANT_GROUPS) {
  for (const slug of group.slugs) CURATED_SLUG_TO_GROUP.set(slug, group);
}

/** The facet rail's counts — small, corpus-wide, and independent of the active filters. */
export interface RepositoryBrowseFacets {
  topicGroups: TopicOptionGroup[];
  stanceOptions: InterfaceOption[];
  /** Entries that declare at least one port — 162 of the then-283, measured 2026-07 (see interface.ts). */
  connectableEntries: number;
  /** Entries that meet at least one other entry, on either verdict `connectedCount` counts. */
  meetingEntries: number;
  /** Entries carrying any domain topic at all — a distinct count, not a sum of the options. */
  entriesWithDomain: number;
  /** The corpus size — `entries.length`, unfiltered. What "of N" means throughout the rail. */
  totalEntries: number;
}

/** Everything `RepositoryBrowser` needs to render one request's worth of the Atlas. */
export interface RepositoryBrowseView {
  facets: RepositoryBrowseFacets;
  /** Whether a cost listing was supplied at all — gates the cost orders and the cost chip. */
  canOrderByCost: boolean;
  /** Whether a profile listing was supplied at all — gates the structure orders and circuit-only. */
  canOrderByStructure: boolean;
  /** Whether the request's `order` is one this view can actually apply — see `browse-order.ts`'s refusal rule. */
  orderAvailable: boolean;
  /**
   * How many records survive every filter (search, category, topic, stance,
   * circuit-only), before folding or capping — the number the "N public
   * entries" line states, and the empty-state trigger when it is zero.
   */
  structureFilteredCount: number;
  /**
   * How many of those the active ordering held out for stating no number on
   * the ranked axis — RAW records, before folding, which is what the "Not
   * ranked N" heading counts (a family split across the boundary would
   * otherwise report a folded count that undercounts its own members).
   */
  unrankedCount: number;
  /**
   * How many rows (post-fold) the current view would draw with no cap at
   * all — the number "N entries · M records, sized variants folded" is
   * built from, together with `structureFilteredCount`.
   */
  shownRowCount: number;
  /** How many rows the cap is choosing among — the denominator in "Showing X of Y". */
  cappableRowsLength: number;
  /** The next `?rows=` step, or null when nothing is held back. */
  nextRowLimit: RowLimit | null;
  /** Populated only under `?category=gates` — every matching gate, unfolded and uncapped (master/detail needs them all). */
  gateEntries: PublicRepositoryListEntry[];
  /** Populated only under `?category=algorithms` — grouped by family, folded, uncapped. */
  algorithmGroups: Array<{ familyKey: string; rows: BrowseRow[] }>;
  /** The ranked-list section actually being sent, after folding AND the cap. Empty under gates/algorithms. */
  shownListRows: BrowseRow[];
  /** The held-out tail actually being sent, after folding AND the cap. */
  shownUnrankedRows: BrowseRow[];
  /**
   * The cost listing, narrowed to the assumption set plus only the rows for
   * slugs this response actually sends — see `trimEstimatesToSentSlugs`
   * below for why this is safe and why it is worth doing.
   */
  estimates: RepositoryEstimateList | null;
}

/** Every slug a folded row puts on the page, single or group. */
function collectRowSlugs(row: BrowseRow, into: Set<string>): void {
  if (row.kind === "single") {
    into.add(row.entry.slug);
    return;
  }
  for (const member of row.members) into.add(member.slug);
}

/**
 * Trim an estimate listing to the rows a response is actually sending.
 *
 * `estimates` arrives sized for the WHOLE corpus (one row per published
 * entry, ~100 bytes each) because ordering needs it — a cost sort has to see
 * every candidate to decide who is unranked, and that happens above, over the
 * full `structureFiltered` set. By the time this runs the page has already
 * decided which rows it is drawing, so there is no more reason to carry the
 * other ~340 rows across the wire: `costBySlug.get()` on the client only ever
 * looks up a slug that is actually on the page. The assumption set is kept
 * whole regardless of how many rows survive — it is one small object and the
 * "Costed under" note needs it even when every row is unranked.
 */
function trimEstimatesToSentSlugs(
  estimates: RepositoryEstimateList | null,
  sentSlugs: ReadonlySet<string>,
): RepositoryEstimateList | null {
  if (!estimates) return null;
  return {
    assumptions: estimates.assumptions,
    estimates: estimates.estimates.filter((row) => sentSlugs.has(row.slug)),
  };
}

/**
 * Run the whole `/repository` pipeline once, over the full corpus, for one
 * resolved set of URL params.
 *
 * `entries` is the FULL corpus (~369 records today) exactly as
 * `getRepositoryListEntries()` returns it. Nothing in the return value embeds
 * it wholesale — every `PublicRepositoryListEntry` reachable from the result
 * is one this specific request is about to render, which is the entire point.
 */
export function buildRepositoryBrowseView(
  entries: readonly PublicRepositoryListEntry[],
  estimates: RepositoryEstimateList | null,
  profiles: RepositoryProfileList | null,
  params: ResolvedBrowseParams,
  locale: "en" | "ja",
): RepositoryBrowseView {
  const { topic, stance, category, query, order, circuitOnly, rows } = params;

  // -------------------------------------------------------------------------
  // Facets and per-entry interfaces: corpus-wide, computed once, independent
  // of every filter above. See the module header for why counting the whole
  // corpus here is not the thing ai-ops#105 was about.
  // -------------------------------------------------------------------------
  const topicGroups = topicOptions(entries, locale);
  const interfaces = new Map<string, EntryInterface>();
  for (const entry of entries) {
    interfaces.set(
      entry.slug,
      deriveInterface({
        slug: entry.slug,
        topics: entry.topics ?? [],
        category: entry.category,
        wireCount: entry.visualization?.wires?.length ?? 0,
        portableCircuit: entry.portableCircuit,
        knownGaps: entry.knownGaps,
      }),
    );
  }
  const stanceOptionsList = interfaceOptions(interfaces);
  const connectableEntries = [...interfaces.values()].filter(declaresPort).length;
  const meetingEntries = connectedCount(interfaces);
  const entriesWithDomain = entries.filter((entry) =>
    (entry.topics ?? []).some((id) => TOPICS_BY_ID.get(id)?.facet === "domain"),
  ).length;

  // Width families and curated clusters, over the whole corpus — see the
  // module header and `families.ts` for why this must not be derived from a
  // filtered subset.
  const { families } = deriveWidthFamilies(entries, (entry) => interfaces.get(entry.slug)?.stance);
  const groupIndex = new Map<string, RowGroup>();
  for (const family of families) {
    const group = widthFamilyGroup(family, locale);
    for (const slug of group.slugs) groupIndex.set(slug, group);
  }
  for (const [slug, group] of CURATED_SLUG_TO_GROUP) groupIndex.set(slug, group);
  const groupOfSlug = (slug: string): RowGroup | undefined => groupIndex.get(slug);

  // -------------------------------------------------------------------------
  // Cost and profile lookups. Both listings arrive sized for the whole corpus
  // (ordering needs every candidate); `estimates` is narrowed to what is sent
  // at the very end, once that set is known.
  // -------------------------------------------------------------------------
  const costBySlug = new Map<string, RepositoryEstimateSummary>();
  for (const row of estimates?.estimates ?? []) costBySlug.set(row.slug, row);
  const canOrderByCost = costBySlug.size > 0;

  const profileBySlug = profilesBySlug(profiles);
  const canOrderByStructure = profileBySlug.size > 0;

  // -------------------------------------------------------------------------
  // The filters. Same predicates `repository-browser.tsx` used to run in the
  // browser, run here instead, against the same shared functions
  // (`matchesRepositoryQuery`, `filterByTopic`, `filterByStance`,
  // `withCircuitOnly`) so the semantics cannot drift between the two call
  // sites — there is only one call site now.
  // -------------------------------------------------------------------------
  const matched = entries.filter((entry) => {
    const matchesCategory = category === "all" || entry.category === category;
    return matchesRepositoryQuery(entry, query) && matchesCategory;
  });
  const filteredEntries = filterByStance(filterByTopic(matched, topic), interfaces, stance);

  const structureFiltered =
    circuitOnly && canOrderByStructure
      ? withCircuitOnly(filteredEntries, (entry) => profileBySlug.get(entry.slug))
      : filteredEntries;

  const orderAvailable = isProfileOrder(order) ? canOrderByStructure : canOrderByCost;
  const { ordered, unranked } = orderEntries(structureFiltered, orderAvailable ? order : "catalog", {
    costOf: (entry) => costBySlug.get(entry.slug),
    profileOf: (entry) => profileBySlug.get(entry.slug),
    keyOf: (entry) => entry.slug,
  });

  const gateEntries = category === "gates" ? ordered : [];

  const algorithmGroups = (() => {
    if (category !== "algorithms") return [];
    const byFamily = new Map<string, PublicRepositoryListEntry[]>();
    for (const entry of ordered) {
      const list = byFamily.get(entry.algorithmFamily) ?? [];
      list.push(entry);
      byFamily.set(entry.algorithmFamily, list);
    }
    return Array.from(byFamily.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([familyKey, groupEntries]) => ({ familyKey, rows: foldRows(groupEntries, groupOfSlug) }));
  })();

  const listRows = category === "gates" || category === "algorithms" ? [] : foldRows(ordered, groupOfSlug);
  const unrankedRows = foldRows(unranked, groupOfSlug);

  const shownRowCount =
    (category === "gates"
      ? gateEntries.length
      : category === "algorithms"
        ? algorithmGroups.reduce((total, group) => total + group.rows.length, 0)
        : listRows.length) + unrankedRows.length;

  // The ranked list and the held-out tail are ONE sequence for the cap, on the
  // same terms `browse-page.ts` documents — see `splitCapped`'s comment there.
  const cappableRows =
    category === "gates" || category === "algorithms" ? unrankedRows : [...listRows, ...unrankedRows];
  const cappedList = capRows(cappableRows, rows);
  const { first: shownListRows, second: shownUnrankedRows } = splitCapped(cappedList.shown, listRows.length);

  // Every slug this response is about to draw a card for — gates and
  // algorithm rows are never capped (see `browse-page.ts`'s header on why),
  // so they contribute in full; the ranked/unranked sections contribute only
  // their post-cap slice.
  const sentSlugs = new Set<string>();
  for (const entry of gateEntries) sentSlugs.add(entry.slug);
  for (const group of algorithmGroups) for (const row of group.rows) collectRowSlugs(row, sentSlugs);
  for (const row of shownListRows) collectRowSlugs(row, sentSlugs);
  for (const row of shownUnrankedRows) collectRowSlugs(row, sentSlugs);

  return {
    facets: {
      topicGroups,
      stanceOptions: stanceOptionsList,
      connectableEntries,
      meetingEntries,
      entriesWithDomain,
      totalEntries: entries.length,
    },
    canOrderByCost,
    canOrderByStructure,
    orderAvailable,
    structureFilteredCount: structureFiltered.length,
    unrankedCount: unranked.length,
    shownRowCount,
    cappableRowsLength: cappableRows.length,
    nextRowLimit: cappedList.next,
    gateEntries,
    algorithmGroups,
    shownListRows,
    shownUnrankedRows,
    estimates: trimEstimatesToSentSlugs(estimates, sentSlugs),
  };
}
