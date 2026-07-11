// Segment loading state (auth resolve). Quality bar: every async view ships
// loading/empty/error states.
export default function AppLoading() {
  return (
    <p role="status" style={{ color: "var(--text-2)", padding: "var(--sp-6)" }}>
      Loading…
    </p>
  );
}
