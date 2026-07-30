"use client";

import { useEffect, useRef } from "react";

import { LIONESS_ASPECT, LIONESS_BRIGHT_INDEX, LIONESS_POINTS } from "./lioness-points";

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
    // Intrinsic width/height of the target shape, or null to fill the container.
    // Only the lioness has a fixed aspect it must keep to stay recognizable.
    let intrinsicAspect: number | null = null;
    if (target === "lioness") {
      // Exact lioness silhouette sampled from the reference art (Owner Inbox
      // 2026-07-19). Points live in ./lioness-points.ts; here they just converge.
      LIONESS_POINTS.forEach((p) => targets.push([p[0], p[1]]));
      intrinsicAspect = LIONESS_ASPECT;
      isBright = (i) => i === LIONESS_BRIGHT_INDEX;
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

    // Orbiting every point of a 239-point silhouette reads as static noise: the
    // dispersed phase is meant to be a scatter of electrons, and at that density
    // it is a haze. Only `ORBIT_SHARE` of them orbit; the rest fade in as the
    // shape gathers, so the silhouette still lands with its full point count
    // (Owner Inbox 2026-07-31: "many less dots while spinning but still have the
    // same amount of dots when it makes the lion shape"). Chosen by index rather
    // than at random so the orbit is evenly sampled across the figure instead of
    // clumping wherever the silhouette was densely sampled.
    const ORBIT_SHARE = 0.34;
    const orbitStride = Math.max(1, Math.round(1 / ORBIT_SHARE));
    const parts = targets.map((tp, i) => ({
      tp, bright: isBright(i),
      orbits: i % orbitStride === 0,
      a: Math.random() * 7, rad: 0.24 + Math.random() * 0.12,
      sp: 0.5 + Math.random() * 0.6, r: 1.1 + Math.random() * 1.6,
    }));

    function colors() {
      const st = getComputedStyle(canvas!);
      const accent = st.getPropertyValue("--accent").trim() || "olivedrab";
      // The marker point was --text-0, i.e. white on the dark theme: one bright
      // dot in an otherwise green field read as a stray pixel rather than as the
      // eye of the figure (Owner Inbox 2026-07-31). It is the accent now, and it
      // stays distinguishable by radius and opacity instead of by hue.
      return { accent, bright: accent };
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

      // Fit the normalized target box into the container. A shape with a fixed
      // intrinsic aspect (the lioness) is letterboxed so it never stretches;
      // everything else fills the container as before.
      let boxW = W, boxH = H, originX = 0, originY = 0;
      if (intrinsicAspect) {
        const pad = 0.92; // a little breathing room around the figure
        if (W / H > intrinsicAspect) { boxH = H * pad; boxW = boxH * intrinsicAspect; }
        else { boxW = W * pad; boxH = boxW / intrinsicAspect; }
        originX = (W - boxW) / 2;
        originY = (H - boxH) / 2;
      }

      parts.forEach((pt) => {
        if (!reduceMotion) pt.a += 0.009 * pt.sp;
        // A non-orbiting point is invisible while dispersed and fades in over
        // the first third of the convergence, so it arrives before the shape
        // resolves rather than popping in on top of it.
        const presence = pt.orbits ? 1 : Math.min(1, Math.max(0, (conv - 0.05) / 0.3));
        if (presence <= 0) return;
        const ox = cx + Math.cos(pt.a) * pt.rad * scale;
        const oy = cy + Math.sin(pt.a) * pt.rad * scale * 0.62;
        const tx = originX + pt.tp[0] * boxW;
        const ty = originY + pt.tp[1] * boxH;
        const x = ox + (tx - ox) * conv;
        const y = oy + (ty - oy) * conv;
        if (conv < 0.4 && pt.orbits) {
          ctx!.globalAlpha = 0.1 * (1 - conv);
          ctx!.strokeStyle = accent;
          ctx!.beginPath(); ctx!.moveTo(cx, cy); ctx!.lineTo(x, y); ctx!.stroke();
        }
        const baseAlpha = (0.5 + 0.5 * conv) * presence;
        ctx!.globalAlpha = pt.bright ? Math.min(1, baseAlpha + 0.4) : baseAlpha;
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
