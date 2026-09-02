/** The filename a downloaded `.ipynb` gets, from the notebook's slug and version seq. */

const FALLBACK_SLUG = "notebook";

/** Same shape `SLUG_RE` in `majorana_contracts/notebooks.py` accepts, so a slug that
 * passed the API is never rewritten here — this only guards a missing/blank one. */
const SAFE_SLUG = /^[a-z0-9][a-z0-9-]{0,79}$/;

export function notebookExportFilename(slug: string | null | undefined, seq: number | null | undefined): string {
  const safeSlug = slug && SAFE_SLUG.test(slug) ? slug : FALLBACK_SLUG;
  const safeSeq = typeof seq === "number" && Number.isFinite(seq) && seq >= 1 ? Math.trunc(seq) : 1;
  return `${safeSlug}-v${safeSeq}.ipynb`;
}
