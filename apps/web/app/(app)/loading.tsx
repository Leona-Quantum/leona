// Segment loading state (auth resolve). Quality bar: every async view ships
// loading/empty/error states.
export default function AppLoading() {
  return (
    <main className="mj-loading-screen" aria-busy="true" aria-label="Loading workspace">
      <span className="mj-skeleton mj-skeleton--eyebrow" />
      <span className="mj-skeleton mj-skeleton--title" />
      <span className="mj-skeleton mj-skeleton--copy" />
      <span className="mj-skeleton mj-skeleton--panel" />
    </main>
  );
}
