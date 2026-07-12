// S2 Run home — stub: shell + composer placeholder. The real composer (mode switch,
// example prompts, quota meter) lands with the S2 build; the pipeline view (S3/S4)
// consumes the RunEvent stream once the BFF glue exists. Spec: docs/ui/screens.md.
export const metadata = { title: "Run — Majorana" };

export default function RunHome() {
  return (
    <section style={{ maxWidth: "720px", margin: "0 auto" }}>
      <h1 style={{ fontSize: "var(--fs-20)", fontWeight: 600 }}>Run</h1>
      <p style={{ color: "var(--text-1)" }}>
        Describe the circuit or problem to plan, generate, screen, compile, and verify it.
      </p>
      <textarea
        disabled
        rows={4}
        placeholder="Describe the circuit or problem… (composer lands with S2)"
        aria-label="Task prompt (not yet available)"
        style={{
          width: "100%",
          background: "var(--bg-1)",
          border: "1px solid var(--border-0)",
          borderRadius: "var(--radius-control)",
          color: "var(--text-2)",
          fontFamily: "var(--font-mono)",
          fontSize: "var(--fs-13)",
          padding: "var(--sp-3)",
        }}
      />
      <p style={{ color: "var(--text-2)", fontSize: "var(--fs-12)" }}>
        Run submission is not wired to the pipeline yet — this build ships the shell,
        tokens, and pipeline-rail components (see /dev/ui for their states).
      </p>
    </section>
  );
}
