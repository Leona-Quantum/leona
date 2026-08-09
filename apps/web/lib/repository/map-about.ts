/**
 * `?about=` — which section of the map's information box is open.
 *
 * The map is now the whole page, so everything that used to be written on it
 * lives in one box behind an icon. That box is a popup, which is the shape the
 * owner asked for and the shape `repository-converge-view.tsx:840` argued
 * against — a control that only works after hydration has no address, no
 * crawler sees it, and a reader with JavaScript off cannot reach it (D88.2).
 *
 * That argument is honoured rather than overruled, by making the popup a
 * *parameter* instead of component state. Opening it is a link, closing it is a
 * link, and choosing a section is a link; the server decides what is open from
 * the query string alone. So the box opens with JavaScript off, `curl` returns
 * every word of it, and a reader can send somebody the exact page of it they
 * mean. What the client adds on top — focus trap, Escape, backdrop dismissal —
 * is enhancement over markup that already works without it.
 *
 * The section ids are part of the URL contract: renaming one breaks links that
 * have already been sent, so an unrecognised value opens the first section
 * rather than 404ing or silently doing nothing. Same rule `browse-params.ts` and
 * `?focus=` state, and the same reason — a deep link that half-works is worse
 * than one that lands somewhere sensible.
 */

/** The five sections, in the order the sidebar lists them. */
export const MAP_ABOUT_SECTIONS = [
  "what-this-is",
  "how-to-read-it",
  "how-to-move-around",
  "what-a-line-claims",
  "not-here-yet",
] as const;

export type MapAboutSection = (typeof MAP_ABOUT_SECTIONS)[number];

/** The section the box opens on when a link names one that no longer exists. */
export const MAP_ABOUT_DEFAULT: MapAboutSection = MAP_ABOUT_SECTIONS[0];

function isSection(value: string): value is MapAboutSection {
  return (MAP_ABOUT_SECTIONS as readonly string[]).includes(value);
}

/**
 * What `?about=` says, or `null` for "the box is shut".
 *
 * Absent and empty both mean shut — `?about=` with nothing after it is what a
 * form or a hand-edited URL produces, and treating it as "open on section one"
 * would make the box appear for a reader who asked for nothing. Anything else
 * that is not a known section opens the default, because it is a link somebody
 * sent that has aged past a rename.
 */
export function parseAboutSection(raw: string | string[] | undefined): MapAboutSection | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string" || value === "") return null;
  return isSection(value) ? value : MAP_ABOUT_DEFAULT;
}

/**
 * The same address with the box opened on `section`, or shut when it is null.
 *
 * Written against the string `figureHref` produced rather than against
 * `window.location`, so every link inside the box keeps the reader's `?focus=`,
 * their whole `?open=` set and their `?at=` viewport. Re-serializing through
 * `URLSearchParams` is a round trip and not a re-encoding: `figureHref` builds
 * its query with `URLSearchParams` too, so the output is byte-identical to its
 * input for every parameter this surface emits. The test pins that.
 */
export function withAbout(base: string, section: MapAboutSection | null): string {
  const cut = base.indexOf("?");
  const path = cut === -1 ? base : base.slice(0, cut);
  const params = new URLSearchParams(cut === -1 ? "" : base.slice(cut + 1));
  params.delete("about");
  if (section) params.set("about", section);
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}
