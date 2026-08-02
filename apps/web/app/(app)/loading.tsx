import { LOADING_COPY } from "../../lib/public-copy";
import { getPublicLocale } from "../../lib/public-locale-server";

// Segment loading state (auth resolve). Quality bar: every async view ships
// loading/empty/error states.
//
// The skeleton is shaped like the surface that replaces it. It used to be the
// generic marketing one — a 1200px-wide column with a 48px title block and one
// 220px panel — while every route under this layout resolves to an 840px
// workspace column with a 28px heading, a search field and a list of rows. So
// the placeholder and the page it stood in for disagreed about the column
// width, the heading size and the number of blocks, and the swap between them
// moved everything on screen. Same primitives, same tokens, workspace geometry.
export default async function AppLoading() {
  const copy = LOADING_COPY[await getPublicLocale()];
  return (
    <main className="mj-loading-screen mj-loading-screen--workspace" aria-busy="true" aria-label={copy.workspace}>
      <span className="sr-only" role="status" aria-live="polite">{copy.status}</span>
      <span className="mj-skeleton mj-skeleton--eyebrow" />
      <span className="mj-skeleton mj-skeleton--workspace-title" />
      <span className="mj-skeleton mj-skeleton--workspace-search" />
      <span className="mj-skeleton mj-skeleton--workspace-row" />
      <span className="mj-skeleton mj-skeleton--workspace-row" />
      <span className="mj-skeleton mj-skeleton--workspace-row" />
    </main>
  );
}
