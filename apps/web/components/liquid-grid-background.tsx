"use client";

import { useEffect, useRef } from "react";

const CELL_SIZE = 16;
const DOT_RADIUS = 1.05;
const RIPPLE_RADIUS = 72;
const HOVER_STRENGTH = 0.45;
const CLICK_STRENGTH = 1;
const DAMPING = 0.95;
const WAVE_HEIGHT = 11;
const MAX_CELLS = 150;
const PAD = 20;
const WAVE_C = Math.SQRT1_2;
const MUR_K = (WAVE_C - 1) / (WAVE_C + 1);
const ABSORB_MAX = 0.6;
const GLOW_BUCKETS = 4;
const GLOW_FULL = 6;
const BASE_DOT_OPACITY = 0.18;
const MAX_GLOW_OPACITY = 0.45;
const GLOW_RADIUS_EXPANSION = 0.3;
const TAU = Math.PI * 2;

type Rgb = [number, number, number];

function parseColor(color: string): Rgb {
  const value = color.trim();
  const rgb = value.match(/rgba?\(\s*(\d+)\s*[, ]\s*(\d+)\s*[, ]\s*(\d+)/);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];

  const hex = value.replace("#", "");
  const expanded = hex.length === 3
    ? hex.split("").map((character) => character + character).join("")
    : hex;
  const number = Number.parseInt(expanded, 16);
  if (!Number.isFinite(number)) return [255, 255, 255];
  return [(number >> 16) & 255, (number >> 8) & 255, number & 255];
}

function rgba([red, green, blue]: Rgb, alpha: number) {
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function readPalette() {
  const styles = getComputedStyle(document.documentElement);
  const background = styles.getPropertyValue("--bg-0").trim() || "rgb(0, 0, 0)";
  const foreground = parseColor(
    styles.getPropertyValue("--text-0").trim() || "rgb(255, 255, 255)",
  );

  return {
    background,
    line: rgba(foreground, BASE_DOT_OPACITY),
    glow: foreground,
  };
}

export function LiquidGridBackground() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvasNode = canvasRef.current;
    if (!canvasNode) return;
    const contextNode = canvasNode.getContext("2d");
    if (!contextNode) return;
    const canvas: HTMLCanvasElement = canvasNode;
    const context: CanvasRenderingContext2D = contextNode;

    const ripple = {
      current: new Float32Array(0),
      previous: new Float32Array(0),
      width: 0,
      height: 0,
      rippleWidth: 0,
      rippleHeight: 0,
      gridWidth: 0,
      gridHeight: 0,
      live: false,
    };

    let palette = readPalette();
    let reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let frame = 0;
    let bounds = canvas.getBoundingClientRect();
    let queuedPoint: { x: number; y: number } | null = null;
    let lastCollide: boolean | null = null;

    function resize() {
      const deviceScale = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.max(1, canvas.clientWidth);
      const height = Math.max(1, canvas.clientHeight);
      const pixelWidth = Math.round(width * deviceScale);
      const pixelHeight = Math.round(height * deviceScale);

      if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
      }
      context.setTransform(deviceScale, 0, 0, deviceScale, 0, 0);

      if (ripple.width === width && ripple.height === height) return false;

      ripple.width = width;
      ripple.height = height;
      const scale = Math.min(1 / 3, MAX_CELLS / Math.max(width, height));
      ripple.rippleWidth = Math.max(4, Math.floor(width * scale));
      ripple.rippleHeight = Math.max(4, Math.floor(height * scale));
      ripple.gridWidth = ripple.rippleWidth + PAD * 2;
      ripple.gridHeight = ripple.rippleHeight + PAD * 2;
      ripple.current = new Float32Array(ripple.gridWidth * ripple.gridHeight);
      ripple.previous = new Float32Array(ripple.gridWidth * ripple.gridHeight);
      ripple.live = false;
      return true;
    }

    function addDrop(
      centerX: number,
      centerY: number,
      radius: number,
      strength: number,
      collide: boolean,
    ) {
      const {
        width,
        height,
        rippleWidth,
        rippleHeight,
        gridWidth,
        gridHeight,
        current,
      } = ripple;
      if (!width || !gridWidth) return;

      const gridX = (centerX / width) * rippleWidth + PAD;
      const gridY = (centerY / height) * rippleHeight + PAD;
      const gridRadius = Math.max(1, radius * (rippleWidth / width));
      const lowX = collide ? PAD + 1 : 1;
      const lowY = collide ? PAD + 1 : 1;
      const highX = collide ? PAD + rippleWidth - 2 : gridWidth - 2;
      const highY = collide ? PAD + rippleHeight - 2 : gridHeight - 2;

      for (
        let y = Math.max(lowY, Math.floor(gridY - gridRadius));
        y <= Math.min(highY, Math.ceil(gridY + gridRadius));
        y += 1
      ) {
        for (
          let x = Math.max(lowX, Math.floor(gridX - gridRadius));
          x <= Math.min(highX, Math.ceil(gridX + gridRadius));
          x += 1
        ) {
          const distance = Math.hypot(x - gridX, y - gridY);
          if (distance < gridRadius) {
            current[y * gridWidth + x] += (1 - distance / gridRadius) ** 2 * strength;
          }
        }
      }
      ripple.live = true;
    }

    function openEdges() {
      const { gridWidth, gridHeight, current, previous } = ripple;
      const bottomRow = gridHeight - 1;
      const rightColumn = gridWidth - 1;

      for (let x = 0; x < gridWidth; x += 1) {
        const top = x;
        const bottom = bottomRow * gridWidth + x;
        current[top] = previous[gridWidth + x]
          + MUR_K * (current[gridWidth + x] - previous[top]);
        current[bottom] = previous[(bottomRow - 1) * gridWidth + x]
          + MUR_K * (current[(bottomRow - 1) * gridWidth + x] - previous[bottom]);
      }

      for (let y = 0; y < gridHeight; y += 1) {
        const left = y * gridWidth;
        const right = left + rightColumn;
        current[left] = previous[left + 1]
          + MUR_K * (current[left + 1] - previous[left]);
        current[right] = previous[right - 1]
          + MUR_K * (current[right - 1] - previous[right]);
      }

      for (let y = 0; y < gridHeight; y += 1) {
        const distanceY = Math.min(y, bottomRow - y);
        for (let x = 0; x < gridWidth; x += 1) {
          const distance = Math.min(distanceY, x, rightColumn - x);
          if (distance >= PAD) continue;
          const edge = 1 - distance / PAD;
          const absorption = 1 - ABSORB_MAX * edge * edge;
          const index = y * gridWidth + x;
          current[index] *= absorption;
          previous[index] *= absorption;
        }
      }
    }

    function updateRipple(collide: boolean) {
      const {
        gridWidth,
        gridHeight,
        rippleWidth,
        rippleHeight,
        current,
        previous,
      } = ripple;

      if (lastCollide !== null && lastCollide !== collide) {
        current.fill(0);
        previous.fill(0);
        lastCollide = collide;
        ripple.live = false;
        return;
      }
      lastCollide = collide;

      const startX = collide ? PAD + 1 : 1;
      const startY = collide ? PAD + 1 : 1;
      const endX = collide ? PAD + rippleWidth - 1 : gridWidth - 1;
      const endY = collide ? PAD + rippleHeight - 1 : gridHeight - 1;
      let energy = 0;
      let samples = 0;

      for (let y = startY; y < endY; y += 1) {
        for (let x = startX; x < endX; x += 1) {
          const index = y * gridWidth + x;
          const value = (
            (
              current[(y - 1) * gridWidth + x]
              + current[(y + 1) * gridWidth + x]
              + current[y * gridWidth + x - 1]
              + current[y * gridWidth + x + 1]
            ) * 0.5
            - previous[index]
          ) * DAMPING;
          previous[index] = value;
          energy += value * value;
          samples += 1;
        }
      }

      ripple.current = previous;
      ripple.previous = current;
      if (!collide) openEdges();

      if (energy < samples * 2e-6) {
        ripple.live = false;
        ripple.current.fill(0);
        ripple.previous.fill(0);
      }
    }

    function sample(canvasX: number, canvasY: number) {
      const {
        width,
        height,
        rippleWidth,
        rippleHeight,
        gridWidth,
        gridHeight,
        current,
      } = ripple;
      if (!rippleWidth || !width || !height) return 0;

      const gridX = (canvasX / width) * rippleWidth + PAD;
      const gridY = (canvasY / height) * rippleHeight + PAD;
      const x = Math.floor(gridX);
      const y = Math.floor(gridY);
      if (x < 0 || x >= gridWidth - 1 || y < 0 || y >= gridHeight - 1) return 0;

      const fractionX = gridX - x;
      const fractionY = gridY - y;
      return (
        current[y * gridWidth + x] * (1 - fractionX) * (1 - fractionY)
        + current[y * gridWidth + x + 1] * fractionX * (1 - fractionY)
        + current[(y + 1) * gridWidth + x] * (1 - fractionX) * fractionY
        + current[(y + 1) * gridWidth + x + 1] * fractionX * fractionY
      );
    }

    function drawFrame() {
      const { width, height } = ripple;
      if (!width || !height) return;

      context.clearRect(0, 0, width, height);
      context.fillStyle = palette.background;
      context.fillRect(0, 0, width, height);

      const base = new Path2D();
      const glow = Array.from({ length: GLOW_BUCKETS }, () => new Path2D());
      const rows = Math.ceil(height / CELL_SIZE);
      const columns = Math.ceil(width / CELL_SIZE);
      const offsetY = (height - rows * CELL_SIZE) / 2;
      const offsetX = (width - columns * CELL_SIZE) / 2;

      for (let row = 0; row <= rows; row += 1) {
        const baseY = offsetY + row * CELL_SIZE;
        for (let column = 0; column <= columns; column += 1) {
          const centerX = offsetX + column * CELL_SIZE;
          const displacement = sample(centerX, baseY) * WAVE_HEIGHT;
          const centerY = baseY + displacement;
          base.moveTo(centerX + DOT_RADIUS, centerY);
          base.arc(centerX, centerY, DOT_RADIUS, 0, TAU);

          const glowAmount = Math.min(1, Math.abs(displacement) / GLOW_FULL);
          if (glowAmount < 0.06) continue;
          const bucket = Math.min(
            GLOW_BUCKETS - 1,
            Math.floor(glowAmount * GLOW_BUCKETS),
          );
          const litRadius = DOT_RADIUS * (1 + glowAmount * GLOW_RADIUS_EXPANSION);
          glow[bucket].moveTo(centerX + litRadius, centerY);
          glow[bucket].arc(centerX, centerY, litRadius, 0, TAU);
        }
      }

      context.fillStyle = palette.line;
      context.fill(base);
      for (let index = 0; index < GLOW_BUCKETS; index += 1) {
        const alpha = ((index + 1) / GLOW_BUCKETS) * MAX_GLOW_OPACITY;
        context.fillStyle = rgba(palette.glow, alpha);
        context.fill(glow[index]);
      }
    }

    function toLocal(clientX: number, clientY: number) {
      if (
        clientX < bounds.left
        || clientX > bounds.right
        || clientY < bounds.top
        || clientY > bounds.bottom
      ) return null;

      return { x: clientX - bounds.left, y: clientY - bounds.top };
    }

    function requestTick() {
      if (!frame && !reduceMotion) frame = window.requestAnimationFrame(tick);
    }

    function tick() {
      frame = 0;
      bounds = canvas.getBoundingClientRect();
      if (queuedPoint) {
        addDrop(
          queuedPoint.x,
          queuedPoint.y,
          RIPPLE_RADIUS,
          HOVER_STRENGTH,
          true,
        );
        queuedPoint = null;
      }

      if (ripple.live) {
        updateRipple(true);
        drawFrame();
      }
      if (ripple.live || queuedPoint) requestTick();
    }

    function onPointerMove(event: PointerEvent) {
      if (reduceMotion) return;
      queuedPoint = toLocal(event.clientX, event.clientY);
      if (queuedPoint) requestTick();
    }

    function onClick(event: MouseEvent) {
      if (reduceMotion) return;
      const point = toLocal(event.clientX, event.clientY);
      if (!point) return;
      addDrop(point.x, point.y, RIPPLE_RADIUS * 1.6, CLICK_STRENGTH, true);
      requestTick();
    }

    const resizeObserver = new ResizeObserver(() => {
      bounds = canvas.getBoundingClientRect();
      if (resize()) drawFrame();
    });
    const themeObserver = new MutationObserver(() => {
      palette = readPalette();
      drawFrame();
    });
    const motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onMotionPreferenceChange = (event: MediaQueryListEvent) => {
      reduceMotion = event.matches;
      queuedPoint = null;
      if (frame) window.cancelAnimationFrame(frame);
      frame = 0;
      ripple.live = false;
      ripple.current.fill(0);
      ripple.previous.fill(0);
      drawFrame();
    };

    resize();
    drawFrame();
    resizeObserver.observe(canvas);
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    motionPreference.addEventListener("change", onMotionPreferenceChange);
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("click", onClick, { passive: true });

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      themeObserver.disconnect();
      motionPreference.removeEventListener("change", onMotionPreferenceChange);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("click", onClick);
    };
  }, []);

  return <canvas aria-hidden="true" className="lq-liquid-grid-background" ref={canvasRef} />;
}
