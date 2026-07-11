"use client";

// Segment error boundary. Copy rule: what happened + what we did + one action;
// never a bare stack trace outside collapsible details.
export default function AppError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <section style={{ padding: "var(--sp-6)", maxWidth: "720px", margin: "0 auto" }}>
      <h1 style={{ fontSize: "var(--fs-20)", fontWeight: 600 }}>Something went wrong</h1>
      <p style={{ color: "var(--text-1)" }}>
        This page failed to load. Nothing was saved or lost; you can try again.
      </p>
      <button
        type="button"
        onClick={reset}
        style={{
          background: "var(--accent)",
          color: "var(--bg-0)",
          font: "inherit",
          fontWeight: 500,
          border: "none",
          borderRadius: "var(--radius-control)",
          padding: "var(--sp-2) var(--sp-4)",
          cursor: "pointer",
        }}
      >
        Retry
      </button>
      <details style={{ marginTop: "var(--sp-4)", color: "var(--text-2)" }}>
        <summary>Details</summary>
        <pre style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-12)", overflowX: "auto" }}>
          {error.message}
        </pre>
      </details>
    </section>
  );
}
