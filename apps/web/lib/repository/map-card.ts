/**
 * `?card=` — which node's card is open on the map.
 *
 * A strict sibling of `?about=` (`map-about.ts`), and deliberately so: the same
 * argument applies word for word. A card that only exists after hydration has no
 * address, no crawler sees it, and a reader with JavaScript off cannot reach it
 * (D88.2). So the card is a *parameter*: opening it is a link, closing it is a
 * link, and the server decides what is open from the query string alone.
 *
 * Where it is **not** a sibling is the value. `?about=` names one of five fixed
 * sections, so an unrecognised value can fall back to the first one — every
 * possible reader ends up somewhere sensible. `?card=` names a node in the layer
 * graph, and there is no sensible default node: falling back to "the first one"
 * would open a card about something the reader never asked about, which is worse
 * than opening nothing. So an id that does not resolve means **shut**, and the
 * count of dropped ids is returned rather than swallowed — the same shape
 * `resolveOpenIds` uses for `?open=`, and for the same reason.
 */

/** What `?card=` resolved to, and how many values it named that do not exist. */
export interface CardSelection {
  /** The node id whose card is open, or `null` for "no card". */
  id: string | null;
  /**
   * How many supplied values named nothing.
   *
   * Reported rather than dropped in silence. A card that quietly does not open
   * is indistinguishable from a card that opened empty, and the two want
   * different fixes — one is a stale link, the other is a node with no content.
   */
  dropped: number;
}

/**
 * What `?card=` says, against the graph that has to hold it.
 *
 * `exists` is passed in rather than the graph itself so this module stays free
 * of the graph — it is a URL contract, and a URL contract that imports the whole
 * layer graph cannot be tested without one.
 *
 * Only the **first** value is honoured. `?card=` is single-valued by design: two
 * cards open at once is a second map, which is the thing the owner bounded the
 * card against (*"don't go more than like 2-3 layers deep… that would be an
 * unnecessary replacement for the user actually navigating the map itself"*).
 * A second value is counted as dropped rather than ignored, so a link that tries
 * it says so.
 */
export function parseCardId(
  raw: string | string[] | undefined,
  exists: (id: string) => boolean,
): CardSelection {
  const values = (Array.isArray(raw) ? raw : raw === undefined ? [] : [raw]).filter(
    (value) => typeof value === "string" && value !== "",
  );
  if (values.length === 0) return { id: null, dropped: 0 };
  const [first, ...rest] = values;
  const ok = first !== undefined && exists(first);
  return { id: ok ? first! : null, dropped: rest.length + (ok ? 0 : 1) };
}

/**
 * The same address with `id`'s card open, or shut when it is null.
 *
 * Written against the string `figureHref` produced rather than against
 * `window.location`, exactly as `withAbout` is, so every link on a card keeps the
 * reader's `?focus=`, their whole `?open=` set and their `?at=` viewport. A card
 * is a thing you can send somebody, and what you send has to arrive on the same
 * figure at the same place.
 *
 * `?about=` is cleared when a card opens. The two are both overlays on one map
 * and one covers the other; leaving both in the address would make the URL claim
 * a state the page cannot draw, and it is the sort of claim that survives being
 * shared long after anyone remembers which one won.
 *
 * `sel` is the address of the drawn occurrence the link sits on, when the
 * caller knows it. A card id alone cannot say WHERE the click happened — one
 * node is drawn in several places since W15, and `resolveSelection`'s id
 * fallback goes to the first of them, which is how the owner's click on
 * "quantum linear solve" flew the camera to the same-named process elsewhere
 * on the map. With the occurrence in the href, `?sel=` is exact on the server
 * too: the shared link highlights the place that was clicked, JS off or on.
 * Omitted (the card panel's own links, which sit on no drawn occurrence), the
 * client interceptor still derives a selection from the card id as before.
 */
export function withCard(base: string, id: string | null, sel?: string | null): string {
  const cut = base.indexOf("?");
  const path = cut === -1 ? base : base.slice(0, cut);
  const params = new URLSearchParams(cut === -1 ? "" : base.slice(cut + 1));
  params.delete("card");
  // A new card starts at its own first section. Carrying `?sec=` across would
  // land a reader who opened a method from a process card on a section id the
  // method does not have — which resolves to the first one anyway, but by
  // falling back rather than by intent, and the URL would go on naming a section
  // the page is not showing.
  params.delete(SECTION_PARAM);
  // **This clause IS the owner's reset rule**, in his own words: *"i don't want
  // the issues of having to track process within process within process
  // visualization and take memory, hence the reset with every card."* A label
  // clicked inside the truncated map is a `withCard` link, so the new card
  // arrives with `inner` and `iopen` gone — step (4) of his walk falls out of
  // this deletion rather than being enforced anywhere. It also runs on close
  // (`id === null`), because *"go to the actual map itself"* is the address
  // minus `card`, `inner` and `iopen` — which is the `closeHref` the panel
  // already renders.
  params.delete(INNER_PARAM);
  params.delete(IOPEN_PARAM);
  if (id !== null) {
    params.delete("about");
    params.set("card", id);
    // Replace, never inherit: a `sel` riding in from `base` names whatever was
    // selected when the base was built, not the occurrence this link sits on.
    params.delete("sel");
    if (sel != null) params.set("sel", sel);
  }
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

/**
 * `?inner=` — the truncated map inside the open card, and `?iopen=` — what the
 * reader has opened inside *it*.
 *
 * The owner's ask, session 113: *"Opening processes further when within their
 * card should be possible. it stays in the card, but disconnects from the rest
 * of the graph, so the user can click around in there."* This file's opening
 * paragraph is the argument for both being parameters and it applies unchanged:
 * a truncated map that only exists after hydration has no address, no crawler
 * sees it, and a reader with JavaScript off cannot reach it. It also makes step
 * (3) of his walk — the deepest state in the product — a link somebody can send.
 *
 * `?inner=` is single-valued **by the same argument `?card=` is single-valued**:
 * two nested truncated maps is the process-within-process tracking the owner
 * ruled out. `?iopen=` is a set with `?open=`'s exact grammar (addresses, plus
 * bare node ids for old links) under a different key, because the two sets
 * describe two different figures and one key would open lanes on both at once.
 */
export const INNER_PARAM = "inner";
export const IOPEN_PARAM = "iopen";

/**
 * What `?inner=` says, against the slots the layout can actually draw.
 *
 * The same resolution as `parseCardId`, deliberately down to the returned shape:
 * only the first value is honoured, an id naming nothing means **shut**, and
 * every discarded value is counted rather than swallowed. What differs is only
 * the predicate — `drawable` is `drawableSlots` membership, not `cardExists`,
 * because the value names a figure to draw and not a card to open. A card id
 * that draws no figure (`own:<methodId>`, a method id) must resolve to shut
 * here, or the URL claims a truncated map the page cannot lay out.
 */
export function parseInnerId(
  raw: string | string[] | undefined,
  drawable: (id: string) => boolean,
): CardSelection {
  return parseCardId(raw, drawable);
}

/**
 * The same address with the truncated map of `id` open inside the card, or shut
 * when it is null.
 *
 * `?iopen=` is cleared in **both** directions, which is where this differs from
 * a naive sibling of `withCard`. Opening a different `inner` with the old map's
 * expansions still in the address would claim lanes open on a figure that never
 * drew them; closing the truncated map with them left behind would make
 * reopening it resume a session the reader deliberately left. The set means
 * nothing except against the one figure `?inner=` names, so it lives and dies
 * with it.
 *
 * `?card=` is kept, and must be: the truncated map is *inside* the card, not a
 * neighbour of it. `?sec=` is kept too — the reader who expands the map from
 * the Theory section and comes back should land on Theory, not on the first
 * section — and `withCard` still strips both the moment a different card opens.
 */
export function withInner(base: string, id: string | null): string {
  const cut = base.indexOf("?");
  const path = cut === -1 ? base : base.slice(0, cut);
  const params = new URLSearchParams(cut === -1 ? "" : base.slice(cut + 1));
  params.delete(INNER_PARAM);
  params.delete(IOPEN_PARAM);
  if (id !== null) params.set(INNER_PARAM, id);
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

/**
 * The same address with exactly `open` expanded inside the truncated map.
 *
 * The serializer for `?iopen=` — the whole set, replaced, never appended to —
 * so one address cannot accumulate two generations of expansions. It writes
 * onto the *outer* address rather than minting a fresh one the way `figureHref`
 * does, because every link inside the panel has to keep the reader's `?focus=`,
 * their whole outer `?open=` set, their `?at=` viewport, the `?card=` they are
 * inside and the `?inner=` they are looking at. A toggle that rebuilt the
 * address from the truncated figure's own parameters would cost the reader all
 * five at once, silently, on the first click.
 */
export function withIopen(base: string, open: Iterable<string>): string {
  const cut = base.indexOf("?");
  const path = cut === -1 ? base : base.slice(0, cut);
  const params = new URLSearchParams(cut === -1 ? "" : base.slice(cut + 1));
  params.delete(IOPEN_PARAM);
  for (const value of open) params.append(IOPEN_PARAM, value);
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

/**
 * `?sec=` — which of the open card's sections is showing.
 *
 * ## Why the section is a parameter and not a `useState`
 *
 * The owner asked for the card's sections to be *"horizontally clickable, not a
 * scroll"*. Ten stacked disclosures in one scrolling column became a row of
 * names with one section under it — and the moment only one section is drawn,
 * *which one* is a piece of what the page is showing, so it belongs where
 * everything else about this page already lives.
 *
 * This file's opening paragraph is the argument, and it applies unchanged: a
 * card that only exists after hydration has no address, no crawler sees it, and
 * a reader with JavaScript off cannot reach it. A section behind `useState`
 * would be exactly that one level down. It also makes *"the Theory of backward
 * Euler"* a link somebody can send, on a repository whose whole purpose is being
 * cited.
 *
 * **And the markup keeps all ten sections regardless.** The panel renders every
 * section and hides the nine that are not showing, the way `map-info-popup.tsx`
 * does with its five: `curl` and a crawler get every word whatever `?sec=` says,
 * and switching section is a paint rather than a fetch for a reader who already
 * has the page.
 *
 * ## Unlike `?card=`, an unrecognised value is not "shut"
 *
 * `?card=` names a node and there is no sensible default node, so a bad id means
 * no card. A section is one of a *fixed, small list* the card itself supplies,
 * so every possible value has somewhere sensible to land: the first section. A
 * bad `?sec=` on a good `?card=` must not blank the card.
 */
export const SECTION_PARAM = "sec";

/**
 * Which section `?sec=` names, or `null` for "the card's own first".
 *
 * `sections` is passed in rather than derived here for the reason `exists` is on
 * `parseCardId`: the list depends on the card's kind, and a URL contract that
 * imports the card model cannot be tested without one.
 */
export function parseCardSection<T extends string>(
  raw: string | string[] | undefined,
  sections: readonly T[],
): T | null {
  const first = Array.isArray(raw) ? raw[0] : raw;
  if (typeof first !== "string" || first === "") return null;
  return sections.find((section) => section === first) ?? null;
}

/** The same address showing `section` of the card that is already open. */
export function withCardSection(base: string, section: string): string {
  const cut = base.indexOf("?");
  const path = cut === -1 ? base : base.slice(0, cut);
  const params = new URLSearchParams(cut === -1 ? "" : base.slice(cut + 1));
  params.set(SECTION_PARAM, section);
  return `${path}?${params.toString()}`;
}
