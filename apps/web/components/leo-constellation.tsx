"use client";

import { useEffect, useRef } from "react";

/**
 * The Leo constellation (Leona = lioness) drawn as a field of quantum states:
 * each star is a node with a slow phase orbit, connected by the constellation's
 * stick figure. The field drifts gently and follows the cursor with a subtle
 * parallax. Everything reads its colors from the design tokens at runtime, and
 * prefers-reduced-motion collapses the whole thing to a single static frame.
 *
 * Star chart: the classic Leo asterism (Regulus, Denebola, Algieba, Zosma,
 * Chertan, Adhafera, Ras Elased, Eta/Mu Leonis) in normalized [0,1] space,
 * x mirrored so the lioness faces the copy.
 */
const LEO_STARS: Array<{ x: number; y: number; r: number; name?: string }> = [
  { x: 0.18, y: 0.78, r: 2.6, name: "Regulus" },
  { x: 0.2, y: 0.55, r: 1.7, name: "Eta" },
  { x: 0.27, y: 0.38, r: 2.1, name: "Algieba" },
  { x: 0.24, y: 0.22, r: 1.6, name: "Adhafera" },
  { x: 0.14, y: 0.15, r: 1.5, name: "Ras Elased Australis" },
  { x: 0.07, y: 0.24, r: 1.4, name: "Ras Elased Borealis" },
  { x: 0.52, y: 0.5, r: 1.6, name: "Chertan" },
  { x: 0.56, y: 0.28, r: 1.8, name: "Zosma" },
  { x: 0.82, y: 0.35, r: 2.2, name: "Denebola" },
  { x: 0.6, y: 0.72, r: 1.5, name: "Iota" },
];

const LEO_LINKS: Array<[number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 2],
  [1, 6], [6, 7], [7, 8], [8, 9], [9, 6], [0, 6],
];

export function LeoConstellation({ className = "" }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let frame = 0;
    let raf = 0;
    const pointer = { x: 0.5, y: 0.5, targetX: 0.5, targetY: 0.5 };

    function colors() {
      const styles = getComputedStyle(canvas!);
      return {
        star: styles.getPropertyValue("--text-1").trim() || "#a29c93",
        accent: styles.getPropertyValue("--accent").trim() || "#7ba05b",
        line: styles.getPropertyValue("--border-0").trim() || "#332f2b",
      };
    }

    function resize() {
      const parent = canvas!.parentElement;
      if (!parent) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas!.width = parent.clientWidth * dpr;
      canvas!.height = parent.clientHeight * dpr;
      context!.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function draw() {
      const parent = canvas!.parentElement;
      if (!parent) return;
      const width = parent.clientWidth;
      const height = parent.clientHeight;
      const { star, accent, line } = colors();
      const t = frame / 60;

      pointer.x += (pointer.targetX - pointer.x) * 0.04;
      pointer.y += (pointer.targetY - pointer.y) * 0.04;
      const parallaxX = (pointer.x - 0.5) * 14;
      const parallaxY = (pointer.y - 0.5) * 10;

      context!.clearRect(0, 0, width, height);

      const points = LEO_STARS.map((s, i) => {
        const drift = reduceMotion ? 0 : Math.sin(t * 0.4 + i * 1.7) * 2.5;
        return {
          x: s.x * width + parallaxX + drift,
          y: s.y * height + parallaxY + Math.cos(t * 0.3 + i * 2.1) * (reduceMotion ? 0 : 2),
          r: s.r,
        };
      });

      context!.strokeStyle = line;
      context!.lineWidth = 1;
      context!.globalAlpha = 0.9;
      for (const [a, b] of LEO_LINKS) {
        context!.beginPath();
        context!.moveTo(points[a].x, points[a].y);
        context!.lineTo(points[b].x, points[b].y);
        context!.stroke();
      }

      points.forEach((p, i) => {
        context!.globalAlpha = 1;
        context!.fillStyle = i === 0 ? accent : star;
        context!.beginPath();
        context!.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        context!.fill();

        // phase orbit: each star is a little quantum state precessing
        if (!reduceMotion) {
          const phase = t * (0.5 + (i % 3) * 0.25) + i;
          const orbitR = p.r + 6;
          context!.globalAlpha = 0.55;
          context!.strokeStyle = i === 0 ? accent : line;
          context!.beginPath();
          context!.arc(p.x, p.y, orbitR, 0, Math.PI * 2);
          context!.stroke();
          context!.fillStyle = accent;
          context!.beginPath();
          context!.arc(p.x + Math.cos(phase) * orbitR, p.y + Math.sin(phase) * orbitR, 1.3, 0, Math.PI * 2);
          context!.fill();
        }
      });
      context!.globalAlpha = 1;
    }

    function tick() {
      frame += 1;
      draw();
      raf = window.requestAnimationFrame(tick);
    }

    function onPointerMove(event: PointerEvent) {
      const rect = canvas!.getBoundingClientRect();
      pointer.targetX = (event.clientX - rect.left) / Math.max(rect.width, 1);
      pointer.targetY = (event.clientY - rect.top) / Math.max(rect.height, 1);
    }

    resize();
    draw();
    const resizeObserver = new ResizeObserver(() => {
      resize();
      draw();
    });
    if (canvas.parentElement) resizeObserver.observe(canvas.parentElement);

    if (!reduceMotion) {
      raf = window.requestAnimationFrame(tick);
      window.addEventListener("pointermove", onPointerMove, { passive: true });
    }

    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onPointerMove);
      resizeObserver.disconnect();
    };
  }, []);

  return <canvas ref={canvasRef} className={className} aria-hidden="true" />;
}
