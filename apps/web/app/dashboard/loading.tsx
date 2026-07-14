export default function Loading() {
  return (
    <main className="mj-loading-screen" aria-busy="true" aria-label="Loading account">
      <span className="mj-skeleton mj-skeleton--eyebrow" />
      <span className="mj-skeleton mj-skeleton--title" />
      <span className="mj-skeleton mj-skeleton--panel" />
    </main>
  );
}
