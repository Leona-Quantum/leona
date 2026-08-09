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
 */
export function withCard(base: string, id: string | null): string {
  const cut = base.indexOf("?");
  const path = cut === -1 ? base : base.slice(0, cut);
  const params = new URLSearchParams(cut === -1 ? "" : base.slice(cut + 1));
  params.delete("card");
  if (id !== null) {
    params.delete("about");
    params.set("card", id);
  }
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}
