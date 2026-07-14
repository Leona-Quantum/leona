import { LOADING_COPY } from "../lib/public-copy";
import { getPublicLocale } from "../lib/public-locale-server";

export default async function RootLoading() {
  const copy = LOADING_COPY[await getPublicLocale()];
  return (
    <main className="mj-loading-screen" aria-busy="true" aria-label={copy.root}>
      <span className="sr-only" role="status" aria-live="polite">{copy.status}</span>
      <span className="mj-skeleton mj-skeleton--eyebrow" />
      <span className="mj-skeleton mj-skeleton--title" />
      <span className="mj-skeleton mj-skeleton--copy" />
      <span className="mj-skeleton mj-skeleton--short" />
      <span className="mj-skeleton mj-skeleton--panel" />
    </main>
  );
}
