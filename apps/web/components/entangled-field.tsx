"use client";

import { useEffect, useRef } from "react";

/**
 * The home cover's light: two qubits and the field between them (owner, 2026-09-12:
 * "be creative and new", pointing at the luminous-light-on-black look of
 * originkit.dev). An original drawing; nothing here is taken from that library.
 *
 * What is drawn is geometry, not a texture. For two points p and q in the plane,
 * w(z) = log((z - p) / (z - q)) is holomorphic away from them. Its imaginary part,
 * the angle p-z-q, is constant along the circles through both points: the field
 * lines. Its real part, the log of the distance ratio, is constant on the circles
 * that ring each point: the equipotentials. Together they are bipolar coordinates.
 * The shader draws a few dozen field lines as thin fibres, sends a pulse along
 * each from the moss qubit to the plum one, and lets faint rings breathe out of
 * each qubit.
 *
 * Because w is holomorphic, |grad Im w| = |grad Re w| = |1/(z - p) - 1/(z - q)|,
 * so every line is antialiased from an exact gradient. No derivative extension is
 * needed, and WebGL 1 is enough.
 *
 * Manners: one full-screen triangle and one fragment shader, no dependency. It
 * mounts on an idle callback after first paint and fades in. It pauses when the
 * cover is off-screen or the tab is hidden, draws one still frame under
 * prefers-reduced-motion, and caps devicePixelRatio at 2. With no WebGL the
 * canvas stays empty and the CSS glow under it is the cover. Colours come from
 * the theme tokens, so no colour literal lives in this file.
 */

type Rgb = [number, number, number];

const VERTEX = `
attribute vec2 aPosition;
void main() { gl_Position = vec4(aPosition, 0.0, 1.0); }
`;

const FRAGMENT = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform float uTime;
uniform float uScale;
uniform vec2 uP;
uniform vec2 uQ;
uniform vec2 uPool;
uniform vec2 uPoolRadius;
uniform vec3 uMoss;
uniform vec3 uPlum;
uniform vec3 uGlow;

const float TAU = 6.28318531;
const float LINES = 20.0;

float hash(float n) { return fract(sin(n * 91.345 + 7.13) * 43758.5453); }

void main() {
  vec2 z = gl_FragCoord.xy;
  vec2 a = z - uP;
  vec2 b = z - uQ;
  float ra2 = max(dot(a, a), 0.001);
  float rb2 = max(dot(b, b), 0.001);
  float re = 0.5 * log(ra2 / rb2);
  float im = atan(a.y, a.x) - atan(b.y, b.x);
  float grad = length(vec2(a.x, -a.y) / ra2 - vec2(b.x, -b.y) / rb2) + 1e-7;
  float lineWidth = 0.6 * uScale;

  // Field lines: level sets of im, LINES to a turn. Where they crowd into a
  // qubit they fade rather than saturate.
  float u = im / TAU * LINES;
  float k = floor(u + 0.5);
  float spacing = TAU / LINES / grad;
  float d = abs(u - k) * spacing;
  float core = exp(-0.5 * d * d / (lineWidth * lineWidth));
  float halo = exp(-d / (5.0 * uScale));
  float crowd = smoothstep(6.0 * uScale, 30.0 * uScale, spacing);
  // mod() so the one line lying on the branch cut keeps a single seed.
  float seed = hash(mod(k, LINES));
  float phase = re * 1.15 - uTime * (0.45 + 0.35 * seed) + seed * TAU;
  float pulse = pow(0.5 + 0.5 * cos(phase), 12.0);
  float fibre = (core * 0.75 + halo * 0.12) * crowd * (0.07 + 0.05 * seed + 0.9 * pulse);

  // Equipotential rings moving outward from each qubit, faint, only near them.
  float rv = abs(re) * 2.2 + uTime * 0.08;
  float rd = abs(fract(rv + 0.5) - 0.5) / (2.2 * grad);
  float near = smoothstep(0.25, 1.1, abs(re)) * (1.0 - smoothstep(1.6, 3.6, abs(re)));
  float ring = exp(-0.5 * rd * rd / (lineWidth * lineWidth)) * near * crowd * 0.09;

  float side = smoothstep(-1.6, 1.6, re);
  vec3 lineColor = mix(uMoss, uPlum, side);
  vec3 col = lineColor * (fibre + ring);
  col += mix(lineColor, uGlow, 0.7) * pulse * core * crowd * 0.35;

  // The qubits: a hot centre and a wide bloom.
  float da = sqrt(ra2) / uScale;
  float db = sqrt(rb2) / uScale;
  col += uMoss * (exp(-da / 7.0) * 1.1 + exp(-da / 70.0) * 0.16);
  col += uGlow * exp(-db / 7.0) * 1.1 + uPlum * exp(-db / 70.0) * 0.22;
  col += vec3(0.9) * (exp(-da / 2.2) + exp(-db / 2.2));

  // A quiet pool behind the copy so the heading stays easy to read.
  float pool = smoothstep(0.5, 1.15, length((z - uPool) / uPoolRadius));
  col *= mix(0.08, 1.0, pool);

  col += (hash(dot(z, vec2(0.0671, 0.1583)) + uTime) - 0.5) / 255.0;
  col = clamp(col, 0.0, 1.0);
  gl_FragColor = vec4(col, max(max(col.r, col.g), col.b));
}
`;

const STILL_TIME = 7.5;
const MAX_STEP = 0.05;

function parseColor(value: string, fallback: Rgb): Rgb {
  const text = value.trim();
  const rgb = text.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/);
  if (rgb) return [Number(rgb[1]) / 255, Number(rgb[2]) / 255, Number(rgb[3]) / 255];
  const digits = text.startsWith("#") ? text.slice(1) : "";
  const full = digits.length === 3 ? digits.split("").map((c) => c + c).join("") : digits;
  const number = full.length === 6 ? Number.parseInt(full, 16) : Number.NaN;
  if (!Number.isFinite(number)) return fallback;
  return [((number >> 16) & 255) / 255, ((number >> 8) & 255) / 255, (number & 255) / 255];
}

function compile(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

export function EntangledField() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvasNode = canvasRef.current;
    if (!canvasNode) return;
    const canvas: HTMLCanvasElement = canvasNode;
    let disposed = false;
    let teardown: (() => void) | null = null;

    function init() {
      if (disposed) return;
      const context = canvas.getContext("webgl", {
        alpha: true,
        antialias: false,
        depth: false,
        stencil: false,
        premultipliedAlpha: true,
        preserveDrawingBuffer: false,
        powerPreference: "low-power",
      });
      if (!context) return;
      const gl: WebGLRenderingContext = context;
      const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX);
      const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT);
      const program = gl.createProgram();
      if (!vertex || !fragment || !program) return;
      gl.attachShader(program, vertex);
      gl.attachShader(program, fragment);
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return;
      gl.useProgram(program);

      const buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      const position = gl.getAttribLocation(program, "aPosition");
      gl.enableVertexAttribArray(position);
      gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

      const uniform = (name: string) => gl.getUniformLocation(program, name);
      const u = {
        time: uniform("uTime"),
        scale: uniform("uScale"),
        p: uniform("uP"),
        q: uniform("uQ"),
        pool: uniform("uPool"),
        poolRadius: uniform("uPoolRadius"),
        moss: uniform("uMoss"),
        plum: uniform("uPlum"),
        glow: uniform("uGlow"),
      };

      let scale = 1;
      let width = 1;
      let height = 1;
      let elapsed = 0;
      let last = 0;
      let frame = 0;
      let running = false;
      let inView = true;
      let lost = false;
      const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
      let reduce = motion.matches;

      function readColours() {
        const styles = getComputedStyle(document.documentElement);
        gl.uniform3fv(u.moss, parseColor(styles.getPropertyValue("--accent"), [0.48, 0.63, 0.36]));
        gl.uniform3fv(u.plum, parseColor(styles.getPropertyValue("--accent-2"), [0.55, 0.52, 0.87]));
        gl.uniform3fv(u.glow, parseColor(styles.getPropertyValue("--accent-2-glow"), [0.72, 0.7, 1]));
      }

      function resize() {
        scale = Math.min(window.devicePixelRatio || 1, 2);
        width = Math.max(1, Math.round(canvas.clientWidth * scale));
        height = Math.max(1, Math.round(canvas.clientHeight * scale));
        if (canvas.width !== width || canvas.height !== height) {
          canvas.width = width;
          canvas.height = height;
        }
        gl.viewport(0, 0, width, height);
        gl.uniform1f(u.scale, scale);
        const narrow = canvas.clientWidth < 640;
        gl.uniform2f(u.pool, width * 0.5, height * (narrow ? 0.55 : 0.5));
        gl.uniform2f(u.poolRadius, Math.min(width * (narrow ? 0.66 : 0.38), 520 * scale), height * (narrow ? 0.46 : 0.42));
      }

      function draw(time: number) {
        if (lost) return;
        const narrow = canvas.clientWidth < 640;
        const x = narrow ? 0.06 : 0.15;
        const y = narrow ? 0.18 : 0.44;
        // gl_FragCoord runs bottom-up, so y is measured from the bottom edge.
        gl.uniform2f(u.p, width * (x + 0.012 * Math.sin(time * 0.21)), height * (y + 0.05 * Math.sin(time * 0.17 + 1.1)));
        gl.uniform2f(u.q, width * (1 - x + 0.012 * Math.sin(time * 0.19 + 2.3)), height * (y + 0.05 * Math.cos(time * 0.23)));
        gl.uniform1f(u.time, time);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }

      function tick(now: number) {
        frame = 0;
        if (!running) return;
        elapsed += last ? Math.min(MAX_STEP, (now - last) / 1000) : 0;
        last = now;
        draw(elapsed);
        frame = window.requestAnimationFrame(tick);
      }

      function start() {
        if (running || reduce || lost || !inView || document.hidden) return;
        running = true;
        last = 0;
        frame = window.requestAnimationFrame(tick);
      }

      function stop() {
        running = false;
        if (frame) window.cancelAnimationFrame(frame);
        frame = 0;
      }

      function still() {
        draw(reduce ? STILL_TIME : elapsed);
      }

      const resizeObserver = new ResizeObserver(() => {
        resize();
        if (!running) still();
      });
      const viewObserver = new IntersectionObserver(([entry]) => {
        inView = entry?.isIntersecting ?? false;
        if (inView) start();
        else stop();
      });
      const themeObserver = new MutationObserver(() => {
        readColours();
        if (!running) still();
      });
      const onVisibility = () => {
        if (document.hidden) stop();
        else start();
      };
      const onMotion = (event: MediaQueryListEvent) => {
        reduce = event.matches;
        if (reduce) {
          stop();
          still();
        } else start();
      };
      const onLost = () => {
        lost = true;
        stop();
        delete canvas.dataset.lit;
      };

      resize();
      readColours();
      still();
      canvas.dataset.lit = "true";
      start();
      resizeObserver.observe(canvas);
      viewObserver.observe(canvas);
      themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-accent"] });
      document.addEventListener("visibilitychange", onVisibility);
      motion.addEventListener("change", onMotion);
      canvas.addEventListener("webglcontextlost", onLost);

      teardown = () => {
        stop();
        resizeObserver.disconnect();
        viewObserver.disconnect();
        themeObserver.disconnect();
        document.removeEventListener("visibilitychange", onVisibility);
        motion.removeEventListener("change", onMotion);
        canvas.removeEventListener("webglcontextlost", onLost);
        gl.getExtension("WEBGL_lose_context")?.loseContext();
      };
    }

    // A plain boolean rather than `in window`: the lib types declare the method, so an
    // `in` check narrows `window` to `never` on the fallback branch, which is the one
    // Safari takes.
    const hasIdle = typeof window.requestIdleCallback === "function";
    const idle = hasIdle
      ? window.requestIdleCallback(init, { timeout: 1500 })
      : window.setTimeout(init, 400);

    return () => {
      disposed = true;
      if (hasIdle) window.cancelIdleCallback(idle);
      else window.clearTimeout(idle);
      teardown?.();
    };
  }, []);

  return <canvas aria-hidden="true" className="lq-entangled-field" ref={canvasRef} />;
}
