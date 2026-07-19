"use client";

import { useState } from "react";

/**
 * Interactive superposition → measurement → statistics widget for Leona Quantum.
 * Bias |psi> with the slider, then Measure (or Measure x10); each shot collapses
 * to a single eigenstate and tallies into a histogram that converges on |alpha|^2,
 * |beta|^2. Brand idea made literal: an honest, measured result.
 *
 * All colors come from tokens.css custom properties; drop it on any surface.
 * Requires globals-additions.css for the `lq-sweep` measurement flash.
 */
export function MeasurementLab() {
  const [bias, setBias] = useState(50); // P(up), percent
  const [up, setUp] = useState(0);
  const [down, setDown] = useState(0);
  const [outcome, setOutcome] = useState<null | "up" | "down">(null);
  const [measuring, setMeasuring] = useState(false);

  const total = up + down;
  const maxC = Math.max(up, down, 1);
  const barH = (n: number) => Math.round((n / maxC) * 120);

  function measure() {
    const o = Math.random() * 100 < bias ? "up" : "down";
    setMeasuring(true);
    if (o === "up") setUp((v) => v + 1); else setDown((v) => v + 1);
    window.setTimeout(() => { setOutcome(o); setMeasuring(false); }, 120);
  }
  function measure10() {
    let u = 0, d = 0, last: "up" | "down" = "up";
    for (let i = 0; i < 10; i++) { if (Math.random() * 100 < bias) { u++; last = "up"; } else { d++; last = "down"; } }
    setUp((v) => v + u); setDown((v) => v + d); setOutcome(last);
  }
  function reset() { setUp(0); setDown(0); setOutcome(null); setMeasuring(false); }

  const label = outcome ? (outcome === "up" ? "|↑⟩  measured" : "|↓⟩  measured") : "|ψ⟩ = α|↑⟩ + β|↓⟩";
  const stageSvg = (variant: "up" | "down") => {
    const active = outcome ? outcome === variant : true;
    const dim = outcome && outcome !== variant;
    return {
      position: "absolute" as const,
      overflow: "visible" as const,
      transition: "opacity .55s ease, transform .55s cubic-bezier(.2,.8,.2,1)",
      opacity: outcome ? (active ? 1 : 0) : 0.55,
      transform: dim
        ? `translateY(${variant === "up" ? -14 : 14}px) scale(.85)`
        : `translateY(${variant === "up" ? -4 : 4}px) scale(${outcome ? 1 : 0.94})`,
    };
  };

  const mono = "var(--font-mono, 'JetBrains Mono', monospace)";
  const panel = { background: "var(--bg-1)", border: "1px solid var(--border-0)", borderRadius: "var(--radius-card,10px)" };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1.1fr 0.9fr", gap: 20, color: "var(--text-0)" }}>
      {/* stage + controls */}
      <div style={{ ...panel, padding: 26, display: "flex", flexDirection: "column", gap: 18 }}>
        <div style={{ position: "relative", height: 190, background: "var(--bg-0)", borderRadius: 10, overflow: "hidden", display: "grid", placeItems: "center" }}>
          <svg viewBox="0 0 80 80" width="120" height="120" fill="none" style={stageSvg("up")}>
            <path d="M20 16 V64" stroke="var(--text-0)" strokeWidth="3.6" strokeLinecap="round" /><path d="M50 16 L66 40 L50 64" stroke="var(--text-0)" strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M33 50 L31 40 L35 32 L30 26" stroke="var(--accent)" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" opacity="0.5" />
            <circle cx="31" cy="40" r="1.8" fill="var(--text-0)" /><circle cx="35" cy="32" r="1.7" fill="var(--text-0)" /><circle cx="30" cy="26" r="1.5" fill="var(--text-0)" />
            <circle cx="33" cy="50" r="3.4" fill="var(--accent)" />
          </svg>
          <svg viewBox="0 0 80 80" width="120" height="120" fill="none" style={stageSvg("down")}>
            <path d="M20 16 V64" stroke="var(--text-0)" strokeWidth="3.6" strokeLinecap="round" /><path d="M50 16 L66 40 L50 64" stroke="var(--text-0)" strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M33 30 L31 40 L35 48 L30 54" stroke="var(--accent)" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" opacity="0.5" />
            <circle cx="31" cy="40" r="1.8" fill="var(--text-0)" /><circle cx="35" cy="48" r="1.7" fill="var(--text-0)" /><circle cx="30" cy="54" r="1.5" fill="var(--text-0)" />
            <circle cx="33" cy="30" r="3.4" fill="var(--accent)" />
          </svg>
          {measuring ? <div style={{ position: "absolute", top: 0, bottom: 0, width: "34%", background: "linear-gradient(90deg, transparent, color-mix(in srgb, var(--accent) 55%, transparent), transparent)", animation: "lq-sweep .55s ease both" }} /> : null}
        </div>
        <div style={{ fontFamily: mono, fontSize: 12, color: "var(--text-1)", textAlign: "center" }}>{label}</div>
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", fontFamily: mono, fontSize: 11, color: "var(--text-2)", marginBottom: 6 }}>
            <span>P(↑) = {bias}%</span><span>P(↓) = {100 - bias}%</span>
          </div>
          <input type="range" aria-label="Probability of measuring spin up, in percent" min={0} max={100} value={bias} onChange={(e) => setBias(Number(e.target.value))} style={{ width: "100%", accentColor: "var(--accent)" }} />
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={measure} style={{ flex: 1, fontFamily: mono, fontSize: 12, padding: 10, borderRadius: 6, border: "none", background: "var(--accent)", color: "var(--bg-0)", cursor: "pointer", fontWeight: 500 }}>Measure</button>
          <button onClick={measure10} style={{ flex: 1, fontFamily: mono, fontSize: 12, padding: 10, borderRadius: 6, border: "1px solid var(--accent)", background: "transparent", color: "var(--accent)", cursor: "pointer" }}>Measure ×10</button>
          <button onClick={reset} style={{ fontFamily: mono, fontSize: 12, padding: "10px 12px", borderRadius: 6, border: "1px solid var(--border-0)", background: "transparent", color: "var(--text-0)", cursor: "pointer" }}>Reset</button>
        </div>
      </div>

      {/* histogram */}
      <div style={{ ...panel, padding: 26, display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <span style={{ fontFamily: mono, fontSize: 11, letterSpacing: "0.12em", color: "var(--text-2)" }}>OUTCOME HISTOGRAM</span>
          <span style={{ fontFamily: mono, fontSize: 12, color: "var(--text-1)" }}>N = {total}</span>
        </div>
        <div style={{ flex: 1, display: "flex", alignItems: "flex-end", justifyContent: "center", gap: 34, padding: "22px 0 12px", minHeight: 170 }}>
          {([["up", up, "|↑⟩", "var(--accent)"], ["down", down, "|↓⟩", "var(--text-1)"]] as const).map(([k, n, sym, col]) => (
            <div key={k} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, height: "100%", justifyContent: "flex-end" }}>
              <span style={{ fontFamily: mono, fontSize: 12, color: "var(--text-0)" }}>{n}</span>
              <div style={{ width: 52, borderRadius: "6px 6px 0 0", background: col, height: barH(n), transition: "height .35s ease" }} />
              <span style={{ fontFamily: mono, fontSize: 13, color: "var(--text-1)" }}>{sym}</span>
              <span style={{ fontFamily: mono, fontSize: 11, color: "var(--text-2)" }}>{total ? Math.round((n / total) * 100) + "%" : "—"}</span>
            </div>
          ))}
        </div>
        <div style={{ fontSize: 12.5, color: "var(--text-2)", textAlign: "center", borderTop: "1px solid var(--border-0)", paddingTop: 14 }}>More shots → the tally approaches |α|², |β|².</div>
      </div>
    </div>
  );
}
