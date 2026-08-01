/**
 * Reading the WHOLE artifact list, rather than the first page of it.
 *
 * `GET /v1/artifacts` has always been paginated — `cursor` plus a `limit` the
 * route clamps to 100 — and every caller in the web app has always fetched it
 * with neither. That returns the route's default of 50 rows as a bare JSON
 * array, which is indistinguishable from "this workspace has 50 artifacts".
 * So a workspace with 200 kept artifacts showed 50 in the sidebar and in
 * Studio, with no error, no indicator, and no way for the reader to tell.
 *
 * It has not bitten the free tier because that plan caps kept artifacts at 25.
 * It bites developer and unlimited accounts — which is to say the people who
 * built the thing and the people they demo it to.
 *
 * The API needed no change. Artifact ids are UUIDv7, so they sort by creation
 * time, and the repository orders `id DESC` and filters `id < cursor`: the last
 * row of a page is exactly the cursor for the next one.
 *
 * WHAT `complete` IS FOR. A page loop needs a stop, and a stop that is silent is
 * the bug this file exists to fix wearing a different hat. `complete: false`
 * means "there may be more that we did not fetch" — the ceiling was hit, or the
 * cursor stopped advancing (which means the server ignored it and we were
 * re-reading one page). Callers must not render a partial list as a whole one.
 */

/** The route's own ceiling: `min(max(limit, 1), 100)`. Asking for more is silently clamped. */
export const ARTIFACT_PAGE_SIZE = 100;

/**
 * 50 pages — 5,000 artifacts — before we stop and say so.
 *
 * Not a guess about how many artifacts anyone has: it is a bound on how long a
 * sidebar mount may spend before it renders something. At 5,000 the honest
 * answer is that this list needs a different design, not a higher ceiling.
 */
export const ARTIFACT_PAGE_CEILING = 50;

export type ArtifactPages = {
  rows: unknown[];
  /** False when the list may be missing rows. Never render a false as a whole list. */
  complete: boolean;
};

type ReadPage = (query: string) => Promise<Response>;

function idOf(row: unknown): string | null {
  if (typeof row !== "object" || row === null) return null;
  const id = (row as { id?: unknown }).id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

/**
 * Walk every page of the artifact list.
 *
 * `read` receives the query string (`"?limit=100&cursor=…"`) so the caller owns
 * the URL and its own fetch options — this file does not know whether it is
 * talking to the BFF proxy or somewhere else.
 *
 * Throws on a non-OK response or a payload that is not an array, which is the
 * existing behaviour of every call site: they catch and fall back to the local
 * mirror. A partial read is NOT an error, though — it comes back as
 * `complete: false` with whatever rows were reached.
 */
export async function fetchArtifactPages(
  read: ReadPage,
  options: { pageSize?: number; maxPages?: number } = {},
): Promise<ArtifactPages> {
  const pageSize = options.pageSize ?? ARTIFACT_PAGE_SIZE;
  const maxPages = options.maxPages ?? ARTIFACT_PAGE_CEILING;
  const rows: unknown[] = [];
  let cursor: string | null = null;

  for (let page = 0; page < maxPages; page += 1) {
    const query = cursor
      ? `?limit=${pageSize}&cursor=${encodeURIComponent(cursor)}`
      : `?limit=${pageSize}`;
    const response = await read(query);
    if (!response.ok) throw new Error(`Artifact API unavailable (${response.status})`);
    const payload = (await response.json()) as unknown;
    if (!Array.isArray(payload)) throw new Error("Artifact list was not an array");

    rows.push(...payload);
    // A short page is the end of the list. A full page might be the end too —
    // one extra request settles it, which is cheaper than being wrong.
    if (payload.length < pageSize) return { rows, complete: true };

    const next = idOf(payload[payload.length - 1]);
    // No id to page from, or the cursor did not move: the server is not
    // honouring it and the next request would re-read this page forever. Stop,
    // and do NOT claim the list is whole — we know it is not.
    if (next === null || next === cursor) return { rows, complete: false };
    cursor = next;
  }

  return { rows, complete: false };
}
