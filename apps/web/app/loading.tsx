export default function RootLoading() {
  return (
    <main className="mj-loading-screen" aria-busy="true" aria-label="Loading">
      <span className="mj-skeleton mj-skeleton--eyebrow" />
      <span className="mj-skeleton mj-skeleton--title" />
      <span className="mj-skeleton mj-skeleton--copy" />
      <span className="mj-skeleton mj-skeleton--short" />
      <span className="mj-skeleton mj-skeleton--panel" />
    </main>
  );
}
