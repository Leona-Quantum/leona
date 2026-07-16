/**
 * Decorative animated quantum circuit for the public landing page: three
 * wires, a handful of gates, and phase pulses that travel the wires while
 * each gate lights as a pulse passes. Pure SVG + CSS (globals.css); honors
 * prefers-reduced-motion by collapsing to the static frame. aria-hidden —
 * it illustrates, the surrounding sections explain.
 */
const WIRES = [35, 70, 105];

export function CircuitBand() {
  return (
    <div className="mj-qband" aria-hidden="true">
      <svg viewBox="0 0 760 140" preserveAspectRatio="xMidYMid meet" fill="none">
        {WIRES.map((y) => (
          <line key={y} className="mj-qband-wire" x1="20" y1={y} x2="740" y2={y} />
        ))}

        <g className="mj-qband-gate" style={{ animationDelay: "0.65s" }}>
          <rect x="96" y={WIRES[0] - 14} width="28" height="28" rx="5" />
          <text x="110" y={WIRES[0] + 4}>H</text>
        </g>

        <g className="mj-qband-gate" style={{ animationDelay: "1.7s" }}>
          <line className="mj-qband-bridge" x1="250" y1={WIRES[0]} x2="250" y2={WIRES[1]} />
          <circle className="mj-qband-control" cx="250" cy={WIRES[0]} r="4" />
          <circle className="mj-qband-target" cx="250" cy={WIRES[1]} r="9" />
          <path d={`M250 ${WIRES[1] - 9}v18M241 ${WIRES[1]}h18`} />
        </g>

        <g className="mj-qband-gate" style={{ animationDelay: "2.75s" }}>
          <rect x="372" y={WIRES[1] - 14} width="36" height="28" rx="5" />
          <text x="390" y={WIRES[1] + 4}>Rz</text>
        </g>

        <g className="mj-qband-gate" style={{ animationDelay: "3.8s" }}>
          <line className="mj-qband-bridge" x1="530" y1={WIRES[1]} x2="530" y2={WIRES[2]} />
          <circle className="mj-qband-control" cx="530" cy={WIRES[1]} r="4" />
          <circle className="mj-qband-target" cx="530" cy={WIRES[2]} r="9" />
          <path d={`M530 ${WIRES[2] - 9}v18M521 ${WIRES[2]}h18`} />
        </g>

        <g className="mj-qband-gate" style={{ animationDelay: "4.7s" }}>
          <rect x="632" y={WIRES[2] - 14} width="36" height="28" rx="5" />
          <path d={`M640 ${WIRES[2] + 6}a10 10 0 0 1 20 0`} />
          <line x1="650" y1={WIRES[2] + 6} x2="658" y2={WIRES[2] - 6} />
        </g>

        {WIRES.map((y, index) => (
          <circle
            key={`pulse-${y}`}
            className="mj-qband-pulse"
            style={{ animationDelay: `${index * 0.9}s` }}
            cx="0"
            cy={y}
            r="3"
          />
        ))}
      </svg>
    </div>
  );
}
