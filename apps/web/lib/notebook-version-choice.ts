/**
 * Which version the notebook page opens on when the reader has not picked one.
 *
 * The current (ready) version when there is one. Otherwise the newest version, when that
 * version FAILED: a failed build usually still carries every cell it wrote, and the
 * reader needs to see them, with the cell that raised marked, to decide what to ask Nala.
 * Before 2026-09-23 the page chose `current_version_seq` alone, so a notebook whose only
 * build had failed chose nothing and said "Your notebook is being prepared." for good,
 * over a build that had 36 cells in it (the production notebook of 2026-09-24 01:07Z).
 *
 * A first build still queued or running also has no current version; that case keeps
 * returning `null`, because what the reader should see then is the progress rail, not
 * an empty version.
 */
export function defaultVersionSeq(input: {
  currentSeq: number | null | undefined;
  versions: ReadonlyArray<{ seq: number; status: string }>;
}): number | null {
  if (input.currentSeq !== null && input.currentSeq !== undefined) return input.currentSeq;
  let newest: { seq: number; status: string } | null = null;
  for (const version of input.versions) {
    if (newest === null || version.seq > newest.seq) newest = version;
  }
  return newest !== null && newest.status === "failed" ? newest.seq : null;
}
