"use client";

import { useEffect, useRef } from "react";

/**
 * Electrons orbit a nucleus, then slowly converge (12s cycle) into the Leona
 * Quantum ket mark, the Leo constellation, or the lioness silhouette, hold, and
 * disperse again. Reads --accent / --text-1 / --border-0 at runtime so it themes
 * automatically, and collapses to a single static frame under
 * prefers-reduced-motion.
 *
 * Use `target="logo"` for loaders / running states, `target="constellation"`
 * for ambient backgrounds, and `target="lioness"` as a foreground showcase
 * (Owner Inbox 2026-07-19). Fills its positioned parent.
 */
export function ElectronField({
  target = "logo",
  className = "",
}: {
  target?: "logo" | "constellation" | "lioness";
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // Target points in normalized [0,1] space.
    const targets: Array<[number, number]> = [];
    let isBright: (i: number) => boolean;
    if (target === "lioness") {
      // Silhouette of a lioness in profile, walking, facing right — tail curling
      // up at the rear-left, head lowered at the front-right. Traced by eye from
      // the owner's reference in normalized [0,1] space (x: left→right). Outline
      // points plus a little interior fill so the shape reads solid; the eye is
      // the single bright point (its "Regulus").
      const body: Array<[number, number]> = [
        // head + face (right)
        [0.95,0.42],[0.90,0.47],[0.86,0.48],[0.90,0.36],[0.85,0.30],[0.87,0.27],
        // nape → back → rump (top line, right→left)
        [0.80,0.33],[0.70,0.29],[0.55,0.29],[0.42,0.29],[0.28,0.28],[0.20,0.30],
        // tail curling up at the rear-left
        [0.16,0.34],[0.10,0.34],[0.06,0.30],[0.05,0.24],[0.09,0.22],
        // hindquarter + thigh
        [0.17,0.46],[0.20,0.56],
        // hind legs (pair)
        [0.24,0.66],[0.23,0.90],[0.34,0.70],[0.35,0.90],
        // belly (rear→front)
        [0.40,0.63],[0.52,0.64],[0.64,0.62],
        // chest + throat
        [0.76,0.56],[0.80,0.50],
        // front legs (pair)
        [0.72,0.66],[0.71,0.90],[0.80,0.68],[0.80,0.90],
        // interior fill
        [0.50,0.45],[0.62,0.45],[0.38,0.45],[0.70,0.42],
      ];
      body.forEach((p) => targets.push(p));
      targets.push([0.86,0.40]); // eye — bright
      isBright = (i) => i === targets.length - 1;
    } else if (target === "constellation") {
      const s: Array<[number, number]> = [[0.18,0.78],[0.2,0.55],[0.27,0.38],[0.24,0.22],[0.14,0.15],[0.07,0.24],[0.52,0.5],[0.56,0.28],[0.82,0.35],[0.6,0.72]];
      const links: Array<[number, number]> = [[0,1],[1,2],[2,3],[3,4],[4,5],[5,2],[1,6],[6,7],[7,8],[8,9],[9,6],[0,6]];
      s.forEach((p) => targets.push([p[0], p[1] * 0.9 + 0.05]));
      links.forEach(([a, b]) => targets.push([(s[a][0] + s[b][0]) / 2, ((s[a][1] + s[b][1]) / 2) * 0.9 + 0.05]));
      isBright = (i) => i === 0; // Regulus
    } else {
      for (let i = 0; i < 12; i++) targets.push([0.29, 0.2 + i * (0.6 / 11)]);
      for (let i = 0; i < 7; i++) targets.push([0.585 + i * (0.2 / 6), 0.2 + i * (0.3 / 6)]);
      for (let i = 0; i < 7; i++) targets.push([0.785 - i * (0.2 / 6), 0.5 + i * (0.3 / 6)]);
      targets.push([0.35,0.525],[0.4,0.425],[0.365,0.3375],[0.29,0.3],[0.24,0.3625],[0.375,0.65],[0.375,0.65]);
      isBright = (i) => i >= targets.length - 2;
    }

    const parts = targets.map((tp, i) => ({
      tp, bright: isBright(i),
      a: Math.random() * 7, rad: 0.24 + Math.random() * 0.12,
      sp: 0.5 + Math.random() * 0.6, r: 1.1 + Math.random() * 1.6,
    }));

    function colors() {
      const st = getComputedStyle(canvas!);
      const accent = st.getPropertyValue("--accent").trim() || "olivedrab";
      return { accent, bright: st.getPropertyValue("--text-0").trim() || "honeydew" };
    }

    let frame = 0;
    let raf = 0;
    const ease = (x: number) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2);

    function resize() {
      const parent = canvas!.parentElement;
      if (!parent) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas!.width = parent.clientWidth * dpr;
      canvas!.height = parent.clientHeight * dpr;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function draw() {
      const parent = canvas!.parentElement;
      if (!parent) return;
      const W = parent.clientWidth, H = parent.clientHeight, cx = W * 0.5, cy = H * 0.5;
      const { accent, bright } = colors();
      const t = reduceMotion ? 8 : (frame / 60) % 12;
      let conv: number;
      if (t < 5) conv = 0; else if (t < 7) conv = ease((t - 5) / 2); else if (t < 10) conv = 1; else conv = 1 - ease((t - 10) / 2);
      if (reduceMotion) conv = 1;

      ctx!.clearRect(0, 0, W, H);
      const scale = Math.min(W, H);
      ctx!.globalAlpha = 0.7 * (1 - conv) + 0.12;
      ctx!.fillStyle = accent;
      ctx!.beginPath(); ctx!.arc(cx, cy, 5 + 3 * (1 - conv), 0, Math.PI * 2); ctx!.fill();
      ctx!.globalAlpha = 1;

      parts.forEach((pt) => {
        if (!reduceMotion) pt.a += 0.009 * pt.sp;
        const ox = cx + Math.cos(pt.a) * pt.rad * scale;
        const oy = cy + Math.sin(pt.a) * pt.rad * scale * 0.62;
        const x = ox + (pt.tp[0] * W - ox) * conv;
        const y = oy + (pt.tp[1] * H - oy) * conv;
        if (conv < 0.4) {
          ctx!.globalAlpha = 0.1 * (1 - conv);
          ctx!.strokeStyle = accent;
          ctx!.beginPath(); ctx!.moveTo(cx, cy); ctx!.lineTo(x, y); ctx!.stroke();
        }
        ctx!.globalAlpha = 0.5 + 0.5 * conv;
        ctx!.fillStyle = pt.bright ? bright : accent;
        ctx!.beginPath(); ctx!.arc(x, y, pt.bright ? pt.r + 1.1 : pt.r, 0, Math.PI * 2); ctx!.fill();
      });
      ctx!.globalAlpha = 1;
    }

    function tick() { frame += 1; draw(); raf = window.requestAnimationFrame(tick); }

    resize();
    draw();
    const ro = new ResizeObserver(() => { resize(); draw(); });
    if (canvas.parentElement) ro.observe(canvas.parentElement);
    if (!reduceMotion) raf = window.requestAnimationFrame(tick);

    return () => { window.cancelAnimationFrame(raf); ro.disconnect(); };
  }, [target]);

  return <canvas ref={canvasRef} className={className} aria-hidden="true" style={{ width: "100%", height: "100%", display: "block" }} />;
}
