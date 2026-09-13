/**
 * The lioness's tail and head as soft rigs over the shard mosaic
 * (`components/lioness-shards.ts`). Pure, no DOM, so `node --test` runs it.
 *
 * Why soft: PR 869 turned the whole tail group rigidly about one pivot inside
 * the rump. Every piece of the tail kept its angle to every other, so the tail
 * swung like a stick on a hinge; the pivot was not on the tail's root edge, so
 * the root tore away from the body; and two thigh pieces (shards 58 and 59)
 * were labelled tail and swung with it. The head had the same rigid turn and
 * split along the neck.
 *
 * The tail here is a chain of segments along its own spine. Each segment's
 * angle follows its parent's through a spring-damper that rings a little, so a
 * swing starts at the root and travels to the tip, later and wider the further
 * out it goes; the tip curls as the flick passes. Idle sway is slow smooth
 * noise, not a sine, and an occasional small twitch. Shards are skinned to the
 * spine by their distance along the tail from the root edge, and every vertex
 * is moved as a function of its own rest position, so pieces that share a
 * corner keep sharing it: nothing cracks. Corners the tail shares with the
 * body never move, so the root stays welded.
 *
 * The head turns about the neck with a weight that is zero where the head meets
 * the body and one across the face, driven by a spring that overshoots slightly
 * and settles, so a tilt reads as a living movement rather than a servo.
 */
import { LIONESS_SHARD_ASPECT, LIONESS_SHARD_GROUPS, LIONESS_SHARDS } from "../components/lioness-shards.ts";

export type LionessCue = "flick" | "tilt" | "nod";

export const TAIL_GROUP = 2;
export const HEAD_GROUP = 1;
/** Segments in the tail chain. */
export const TAIL_SEGMENTS = 7;

const ASPECT = LIONESS_SHARD_ASPECT;
const TAU = Math.PI * 2;
/** Simulation step, seconds: fixed, so the motion is the same at any frame rate. */
const STEP = 1 / 240;
const SPINE_SAMPLES = 24;

// Tail chain. Natural frequency rises a little toward the lighter tip; the
// damping ratio below one is what lets each joint overshoot its parent, and a
// gain just above one widens the swing toward the tip.
// Tuned by a sweep (2026-09-12) for: tip swing about twice the root's, a
// back-swing about a third of the lift, the tip peaking a fifth of a second
// after the root, all still within a second.
const TAIL_OMEGA = Array.from({ length: TAIL_SEGMENTS }, (_, j) => TAU * (4 + 0.6 * j));
const TAIL_ZETA = 0.55;
const TAIL_GAIN = 1.1;
/** A full flick's drive at the root, radians. Positive lifts the tip. */
const FLICK_AMPLITUDE = rad(15);
/** Idle sway drive at the root, radians. */
const IDLE_AMPLITUDE = rad(1.6);
const IDLE_CURL = rad(2);
/** Extra hook at the tip, per radian of flick drive. */
const FLICK_CURL = 0.7;
const CURL_OMEGA = TAU * 2.4;
const CURL_ZETA = 0.34;

// Head: a spring with slight overshoot (damping 0.55 overshoots by about 12%).
const HEAD_OMEGA = TAU * 2.3;
const HEAD_ZETA = 0.55;
const HEAD_LIMIT = rad(10);
const HEAD_PIVOT_X = 0.8;
const HEAD_PIVOT_Y = 0.3;
/** Width of the neck blend, in the figure's own units from the pivot toward the face. */
const HEAD_BLEND = 0.22;

export function rad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** The key two shards share when they share a corner. */
export function vertexKey(x: number, y: number): string {
  return `${x.toFixed(4)},${y.toFixed(4)}`;
}

/** A group of shards deformed as one soft body. */
type SoftPart = {
  shards: number[];
  /** For each shard of the whole mosaic, its position in `shards`, or -1. */
  slot: Int32Array;
  /** Per shard in `shards`, per corner: the unique vertex. */
  corners: Int32Array;
  /** Unique vertices as written in the data (normalised). */
  srcX: Float64Array;
  srcY: Float64Array;
  /** Unique vertices in the figure's proportions: x times the aspect. */
  x: Float64Array;
  y: Float64Array;
  /** 1 where a shard outside the part shares the vertex: it never moves. */
  pinned: Uint8Array;
  /** Posed corners per shard in `shards`, normalised, six numbers each. */
  out: Float64Array[];
};

function softPart(group: number): SoftPart {
  const shards: number[] = [];
  const slot = new Int32Array(LIONESS_SHARDS.length).fill(-1);
  LIONESS_SHARD_GROUPS.forEach((g, i) => {
    if (g !== group) return;
    slot[i] = shards.length;
    shards.push(i);
  });
  const index = new Map<string, number>();
  const srcX: number[] = [];
  const srcY: number[] = [];
  const corners = new Int32Array(shards.length * 3);
  shards.forEach((shard, k) => {
    const tri = LIONESS_SHARDS[shard]!;
    for (let c = 0; c < 3; c += 1) {
      const key = vertexKey(tri[c * 2]!, tri[c * 2 + 1]!);
      let v = index.get(key);
      if (v === undefined) {
        v = srcX.length;
        index.set(key, v);
        srcX.push(tri[c * 2]!);
        srcY.push(tri[c * 2 + 1]!);
      }
      corners[k * 3 + c] = v;
    }
  });
  const pinned = new Uint8Array(srcX.length);
  LIONESS_SHARDS.forEach((tri, i) => {
    if (LIONESS_SHARD_GROUPS[i] === group) return;
    for (let c = 0; c < 3; c += 1) {
      const v = index.get(vertexKey(tri[c * 2]!, tri[c * 2 + 1]!));
      if (v !== undefined) pinned[v] = 1;
    }
  });
  return {
    shards,
    slot,
    corners,
    srcX: Float64Array.from(srcX),
    srcY: Float64Array.from(srcY),
    x: Float64Array.from(srcX, (x) => x * ASPECT),
    y: Float64Array.from(srcY),
    pinned,
    out: shards.map((shard) => Float64Array.from(LIONESS_SHARDS[shard]!)),
  };
}

/** The tail's spine and each vertex's place along it. */
type TailSkin = {
  /** Distance along the tail from the root edge, 0 at the root, 1 at the tip. */
  s: Float64Array;
  /** Rest offset of each vertex from its spine point. */
  offX: Float64Array;
  offY: Float64Array;
  spineX: Float64Array;
  spineY: Float64Array;
};

function tailSkin(part: SoftPart): TailSkin {
  const n = part.x.length;
  // Distance along the mesh from the corners welded to the body: it follows the
  // tail round its hook instead of cutting across the gap.
  const dist = new Float64Array(n).fill(Number.POSITIVE_INFINITY);
  for (let v = 0; v < n; v += 1) if (part.pinned[v]) dist[v] = 0;
  const edges: Array<[number, number, number]> = [];
  for (let k = 0; k < part.shards.length; k += 1) {
    for (let c = 0; c < 3; c += 1) {
      const a = part.corners[k * 3 + c]!;
      const b = part.corners[k * 3 + ((c + 1) % 3)]!;
      edges.push([a, b, Math.hypot(part.x[a]! - part.x[b]!, part.y[a]! - part.y[b]!)]);
    }
  }
  for (let pass = 0; pass < n; pass += 1) {
    let changed = false;
    for (const [a, b, len] of edges) {
      if (dist[a]! + len < dist[b]!) {
        dist[b] = dist[a]! + len;
        changed = true;
      }
      if (dist[b]! + len < dist[a]!) {
        dist[a] = dist[b]! + len;
        changed = true;
      }
    }
    if (!changed) break;
  }
  let length = 0;
  for (const d of dist) if (Number.isFinite(d)) length = Math.max(length, d);
  const s = Float64Array.from(dist, (d) => (Number.isFinite(d) && length > 0 ? d / length : 0));

  // The spine: a smoothed centre line through the vertices at each distance.
  const spineX = new Float64Array(SPINE_SAMPLES + 1);
  const spineY = new Float64Array(SPINE_SAMPLES + 1);
  for (let k = 0; k <= SPINE_SAMPLES; k += 1) {
    let sx = 0;
    let sy = 0;
    let sw = 0;
    for (let v = 0; v < n; v += 1) {
      const w = k === 0 ? (part.pinned[v] ? 1 : 0) : Math.exp(-Math.pow((s[v]! - k / SPINE_SAMPLES) / 0.08, 2));
      sx += part.x[v]! * w;
      sy += part.y[v]! * w;
      sw += w;
    }
    spineX[k] = sw > 0 ? sx / sw : k > 0 ? spineX[k - 1]! : 0;
    spineY[k] = sw > 0 ? sy / sw : k > 0 ? spineY[k - 1]! : 0;
  }
  const offX = new Float64Array(n);
  const offY = new Float64Array(n);
  for (let v = 0; v < n; v += 1) {
    const [cx, cy] = alongSpine(spineX, spineY, s[v]!);
    offX[v] = part.x[v]! - cx;
    offY[v] = part.y[v]! - cy;
  }
  return { s, offX, offY, spineX, spineY };
}

function alongSpine(xs: Float64Array, ys: Float64Array, s: number): [number, number] {
  const f = Math.min(1, Math.max(0, s)) * SPINE_SAMPLES;
  const k = Math.min(SPINE_SAMPLES - 1, Math.floor(f));
  const t = f - k;
  return [xs[k]! + (xs[k + 1]! - xs[k]!) * t, ys[k]! + (ys[k + 1]! - ys[k]!) * t];
}

const smooth01 = (t: number) => {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
};
const gauss = (u: number, centre: number, width: number) => Math.exp(-Math.pow((u - centre) / width, 2));

/** A flick's drive over time since it began: a small dip (the anticipation), then the lift. */
function flickPulse(u: number): number {
  if (u < 0 || u > 0.7) return 0;
  return -0.2 * gauss(u, 0.045, 0.03) + gauss(u, 0.2, 0.08);
}

/** Head cue drive over time since the cue, radians (negative lifts the head). */
function headCuePulse(cue: LionessCue, u: number): number {
  if (u < 0) return 0;
  if (cue === "tilt") return -rad(7) * smooth01(u / 0.18) * (1 - smooth01((u - 0.7) / 0.25));
  if (cue === "nod") return rad(7) * gauss(u, 0.14, 0.075) + rad(4.5) * gauss(u, 0.48, 0.075);
  return 0;
}

/** Smooth value noise in [-1, 1] over time, one control value every `period` seconds. */
function valueNoise(seed: number, period: number) {
  const at = (i: number) => {
    let h = Math.imul(i ^ seed, 0x27d4eb2d);
    h ^= h >>> 15;
    h = Math.imul(h, 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
    return ((h >>> 0) / 4294967296) * 2 - 1;
  };
  return (time: number) => {
    const p = time / period;
    const i = Math.floor(p);
    const f = p - i;
    const u = f * f * f * (f * (f * 6 - 15) + 10);
    const a = at(i);
    return a + (at(i + 1) - a) * u;
  };
}

export type LionessRigInput = {
  /** 0 to 1: how much idle life to show (0 while assembling, ramps to 1 after). */
  awake: number;
  /** The pointer's pull on the head, radians; negative lifts it. */
  headTarget: number;
};

export type LionessRig = {
  /** Flick the tail now. 1 is a full flick. */
  flick(strength?: number): void;
  /** Play a cue once. */
  cue(cue: LionessCue): void;
  /** Advance the rig by `dt` seconds and pose it. */
  step(dt: number, input: LionessRigInput): void;
  /** A shard's three corners as posed (normalised, six numbers), or null when the rig never moves it. */
  corners(shard: number): Float64Array | null;
  /** Absolute angle of each tail segment, root first, radians. */
  tailAngles(): Float64Array;
  headAngle(): number;
  /** Seconds simulated so far. */
  time(): number;
};

export function createLionessRig(seed = 0x5eed1e0a): LionessRig {
  const tail = softPart(TAIL_GROUP);
  const head = softPart(HEAD_GROUP);
  const skin = tailSkin(tail);
  const headWeight = Float64Array.from(head.srcX, (x, v) =>
    head.pinned[v] ? 0 : smooth01(((x - HEAD_PIVOT_X) * ASPECT) / HEAD_BLEND),
  );

  let state = seed >>> 0 || 1;
  const random = () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const swayA = valueNoise(seed ^ 0x1234567, 1.7);
  const swayB = valueNoise(seed ^ 0x7654321, 0.63);
  const curlNoise = valueNoise(seed ^ 0x0badf00d, 2.3);

  const phi = new Float64Array(TAIL_SEGMENTS);
  const vel = new Float64Array(TAIL_SEGMENTS);
  let curl = 0;
  let curlVel = 0;
  let headAngle = 0;
  let headVel = 0;
  let clock = 0;
  let carry = 0;
  let nextTwitch = 8 + random() * 5;
  const flicks: Array<{ at: number; strength: number }> = [];
  const headCues: Array<{ at: number; cue: LionessCue }> = [];

  const spineDefX = new Float64Array(SPINE_SAMPLES + 1);
  const spineDefY = new Float64Array(SPINE_SAMPLES + 1);
  const tailX = new Float64Array(tail.x.length);
  const tailY = new Float64Array(tail.x.length);
  const headX = new Float64Array(head.x.length);
  const headY = new Float64Array(head.x.length);

  function flick(strength = 1) {
    flicks.push({ at: clock, strength });
  }

  function angleAt(s: number): number {
    const n = TAIL_SEGMENTS;
    const first = 0.5 / n;
    let base: number;
    if (s <= first) base = phi[0]! * (s / first);
    else if (s >= 1 - first) base = phi[n - 1]!;
    else {
      const j = Math.min(n - 2, Math.floor(s * n - 0.5));
      const t = (s - (j + 0.5) / n) * n;
      base = phi[j]! + (phi[j + 1]! - phi[j]!) * t;
    }
    const hook = Math.min(1, Math.max(0, (s - 0.55) / 0.45));
    return base + curl * hook * hook;
  }

  function simulate(h: number, input: LionessRigInput) {
    const awake = Math.min(1, Math.max(0, input.awake));
    if (awake >= 1 && clock >= nextTwitch) {
      flick(0.22 + random() * 0.16);
      nextTwitch = clock + 7 + random() * 6;
    } else if (awake < 1) {
      nextTwitch = Math.max(nextTwitch, clock + 4);
    }
    let flickDrive = 0;
    for (let i = flicks.length - 1; i >= 0; i -= 1) {
      const u = clock - flicks[i]!.at;
      if (u > 0.7) flicks.splice(i, 1);
      else flickDrive += FLICK_AMPLITUDE * flicks[i]!.strength * flickPulse(u);
    }
    const sway = IDLE_AMPLITUDE * awake * ((swayA(clock) + 0.35 * swayB(clock)) / 1.35);
    const drive = flickDrive + sway;
    for (let j = 0; j < TAIL_SEGMENTS; j += 1) {
      const w = TAIL_OMEGA[j]!;
      const target = j === 0 ? drive : TAIL_GAIN * phi[j - 1]!;
      const acc = w * w * (target - phi[j]!) - 2 * TAIL_ZETA * w * vel[j]!;
      vel[j] = vel[j]! + acc * h;
      phi[j] = phi[j]! + vel[j]! * h;
    }
    const curlTarget = FLICK_CURL * flickDrive + IDLE_CURL * awake * curlNoise(clock);
    const curlAcc = CURL_OMEGA * CURL_OMEGA * (curlTarget - curl) - 2 * CURL_ZETA * CURL_OMEGA * curlVel;
    curlVel += curlAcc * h;
    curl += curlVel * h;

    let cueDrive = 0;
    for (let i = headCues.length - 1; i >= 0; i -= 1) {
      const u = clock - headCues[i]!.at;
      if (u > 1.2) headCues.splice(i, 1);
      else cueDrive += headCuePulse(headCues[i]!.cue, u);
    }
    const headTarget = Math.min(HEAD_LIMIT, Math.max(-HEAD_LIMIT, input.headTarget + cueDrive));
    const headAcc = HEAD_OMEGA * HEAD_OMEGA * (headTarget - headAngle) - 2 * HEAD_ZETA * HEAD_OMEGA * headVel;
    headVel += headAcc * h;
    headAngle += headVel * h;
    clock += h;
  }

  function pose() {
    // The spine, bent segment by segment from the root.
    spineDefX[0] = skin.spineX[0]!;
    spineDefY[0] = skin.spineY[0]!;
    for (let k = 0; k < SPINE_SAMPLES; k += 1) {
      const a = angleAt((k + 0.5) / SPINE_SAMPLES);
      const ex = skin.spineX[k + 1]! - skin.spineX[k]!;
      const ey = skin.spineY[k + 1]! - skin.spineY[k]!;
      spineDefX[k + 1] = spineDefX[k]! + ex * Math.cos(a) - ey * Math.sin(a);
      spineDefY[k + 1] = spineDefY[k]! + ex * Math.sin(a) + ey * Math.cos(a);
    }
    for (let v = 0; v < tail.x.length; v += 1) {
      if (tail.pinned[v]) {
        tailX[v] = tail.srcX[v]!;
        tailY[v] = tail.srcY[v]!;
        continue;
      }
      const s = skin.s[v]!;
      const [cx, cy] = alongSpine(spineDefX, spineDefY, s);
      const a = angleAt(s);
      const cos = Math.cos(a);
      const sin = Math.sin(a);
      const ox = skin.offX[v]!;
      const oy = skin.offY[v]!;
      tailX[v] = (cx + ox * cos - oy * sin) / ASPECT;
      tailY[v] = cy + ox * sin + oy * cos;
    }
    const px = HEAD_PIVOT_X * ASPECT;
    for (let v = 0; v < head.x.length; v += 1) {
      const w = headWeight[v]!;
      if (w === 0) {
        headX[v] = head.srcX[v]!;
        headY[v] = head.srcY[v]!;
        continue;
      }
      const a = headAngle * w;
      const cos = Math.cos(a);
      const sin = Math.sin(a);
      const dx = head.x[v]! - px;
      const dy = head.y[v]! - HEAD_PIVOT_Y;
      headX[v] = (px + dx * cos - dy * sin) / ASPECT;
      headY[v] = HEAD_PIVOT_Y + dx * sin + dy * cos;
    }
    writeCorners(tail, tailX, tailY);
    writeCorners(head, headX, headY);
  }

  return {
    flick,
    cue(cue) {
      if (cue === "flick") flick(1);
      else headCues.push({ at: clock, cue });
    },
    step(dt, input) {
      carry += Math.min(0.1, Math.max(0, dt));
      while (carry >= STEP) {
        simulate(STEP, input);
        carry -= STEP;
      }
      pose();
    },
    corners(shard) {
      const t = tail.slot[shard]!;
      if (t >= 0) return tail.out[t]!;
      const h = head.slot[shard]!;
      if (h >= 0) return head.out[h]!;
      return null;
    },
    tailAngles: () => Float64Array.from(phi),
    headAngle: () => headAngle,
    time: () => clock,
  };
}

function writeCorners(part: SoftPart, xs: Float64Array, ys: Float64Array) {
  for (let k = 0; k < part.shards.length; k += 1) {
    const out = part.out[k]!;
    for (let c = 0; c < 3; c += 1) {
      const v = part.corners[k * 3 + c]!;
      out[c * 2] = xs[v]!;
      out[c * 2 + 1] = ys[v]!;
    }
  }
}
