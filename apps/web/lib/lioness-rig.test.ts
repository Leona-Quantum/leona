import assert from "node:assert/strict";
import test from "node:test";
import { LIONESS_SHARD_GROUPS, LIONESS_SHARDS } from "../components/lioness-shards.ts";
import { createLionessRig, HEAD_GROUP, rad, TAIL_GROUP, TAIL_SEGMENTS, vertexKey } from "./lioness-rig.ts";

type Tri = readonly number[];
const cornersOf = (tri: Tri) => [0, 1, 2].map((c) => vertexKey(tri[c * 2]!, tri[c * 2 + 1]!));
const edgesOf = (tri: Tri) => {
  const v = cornersOf(tri);
  return [0, 1, 2].map((c) => [v[c]!, v[(c + 1) % 3]!].sort().join("|"));
};
const shardsOf = (group: number) => LIONESS_SHARDS.map((_, i) => i).filter((i) => LIONESS_SHARD_GROUPS[i] === group);
const still = { awake: 0, headTarget: 0 };

test("the tail is one strip of pieces, welded to the body along a single edge", () => {
  const tail = shardsOf(TAIL_GROUP);
  const seen = new Set([tail[0]!]);
  const stack = [tail[0]!];
  while (stack.length) {
    const edges = new Set(edgesOf(LIONESS_SHARDS[stack.pop()!]!));
    for (const b of tail) {
      if (seen.has(b) || !edgesOf(LIONESS_SHARDS[b]!).some((e) => edges.has(e))) continue;
      seen.add(b);
      stack.push(b);
    }
  }
  assert.equal(seen.size, tail.length, "every tail piece shares an edge with the rest of the tail");
  // PR 869 had shards 58 and 59, at the top of the far hind thigh, in the tail
  // group: they swung with every flick and tore off the leg.
  assert.ok(!tail.includes(58) && !tail.includes(59));
  const tailCorners = new Set(tail.flatMap((i) => cornersOf(LIONESS_SHARDS[i]!)));
  const shared = new Set<string>();
  LIONESS_SHARDS.forEach((tri, i) => {
    if (LIONESS_SHARD_GROUPS[i] === TAIL_GROUP) return;
    for (const corner of cornersOf(tri)) {
      if (!tailCorners.has(corner)) continue;
      shared.add(corner);
      assert.equal(LIONESS_SHARD_GROUPS[i], 0, `shard ${i} (group ${LIONESS_SHARD_GROUPS[i]}) touches the tail`);
    }
  });
  assert.equal(shared.size, 2, "the tail meets the body at the two corners of its root edge and nowhere else");
});

test("only tail and head pieces move, a shared corner never splits, and the welds hold", () => {
  const rig = createLionessRig();
  rig.step(0, still);
  rig.flick(1);
  rig.cue("tilt");
  const rigged = new Set([...shardsOf(TAIL_GROUP), ...shardsOf(HEAD_GROUP)]);
  let tailMove = 0;
  let headMove = 0;
  for (let frame = 0; frame < 90; frame += 1) {
    rig.step(1 / 60, { awake: 1, headTarget: rad(4) });
    const posedAt = new Map<string, readonly [number, number]>();
    LIONESS_SHARDS.forEach((tri, i) => {
      const posed = rig.corners(i);
      if (!rigged.has(i)) {
        assert.equal(posed, null, `shard ${i} is not rigged`);
        return;
      }
      for (let c = 0; c < 3; c += 1) {
        const key = vertexKey(tri[c * 2]!, tri[c * 2 + 1]!);
        const p = [posed![c * 2]!, posed![c * 2 + 1]!] as const;
        const earlier = posedAt.get(key);
        if (earlier) assert.deepEqual(p, earlier, `corner ${key} splits between pieces`);
        else posedAt.set(key, p);
        const moved = Math.hypot(p[0] - tri[c * 2]!, p[1] - tri[c * 2 + 1]!);
        if (LIONESS_SHARD_GROUPS[i] === TAIL_GROUP) tailMove = Math.max(tailMove, moved);
        else headMove = Math.max(headMove, moved);
      }
    });
    LIONESS_SHARDS.forEach((tri, i) => {
      if (rigged.has(i)) return;
      for (let c = 0; c < 3; c += 1) {
        const p = posedAt.get(vertexKey(tri[c * 2]!, tri[c * 2 + 1]!));
        if (p) assert.deepEqual(p, [tri[c * 2]!, tri[c * 2 + 1]!], `shard ${i}'s corner was pulled off the body`);
      }
    });
  }
  // A rig that never moved would pass every check above.
  assert.ok(tailMove > 0.02, `tail moved ${tailMove}`);
  assert.ok(headMove > 0.005, `head moved ${headMove}`);
});

test("a flick travels from the root to the tip: later, wider, not as one stick, and it settles", () => {
  const rig = createLionessRig();
  rig.step(0, still);
  rig.flick(1);
  const last = TAIL_SEGMENTS - 1;
  let root = { angle: 0, at: 0 };
  let tip = { angle: 0, at: 0, rootThen: 0 };
  let backSwing = 0;
  let settledAfter = 0;
  for (let frame = 1; frame <= 240; frame += 1) {
    rig.step(1 / 60, still);
    const angles = rig.tailAngles();
    const t = frame / 60;
    if (angles[0]! > root.angle) root = { angle: angles[0]!, at: t };
    if (angles[last]! > tip.angle) tip = { angle: angles[last]!, at: t, rootThen: angles[0]! };
    backSwing = Math.min(backSwing, angles[last]!);
    if (angles.some((a) => Math.abs(a) > rad(0.3))) settledAfter = t;
  }
  assert.ok(tip.at - root.at >= 0.08, `tip peaks ${(tip.at - root.at).toFixed(3)} s after the root`);
  assert.ok(tip.angle / root.angle >= 1.4 && tip.angle / root.angle <= 3, `tip/root ${(tip.angle / root.angle).toFixed(2)}`);
  assert.ok(Math.abs(tip.angle - tip.rootThen) > 0.5 * tip.angle, "the root has moved on by the time the tip peaks");
  assert.ok(-backSwing > 0.05 * tip.angle && -backSwing < 0.6 * tip.angle, `back-swing ${(-backSwing / tip.angle).toFixed(2)} of the lift`);
  assert.ok(settledAfter < 2, `settles after ${settledAfter.toFixed(2)} s`);
});

test("idle sway is subtle and has no fixed beat", () => {
  const rig = createLionessRig();
  let largest = 0;
  let lastSign = 0;
  let lastCrossing = -1;
  const gaps: number[] = [];
  for (let frame = 1; frame <= 60 * 40; frame += 1) {
    rig.step(1 / 60, { awake: 1, headTarget: 0 });
    const root = rig.tailAngles()[0]!;
    largest = Math.max(largest, Math.abs(rig.tailAngles()[TAIL_SEGMENTS - 1]!));
    const sign = Math.sign(root);
    if (sign !== 0 && lastSign !== 0 && sign !== lastSign) {
      if (lastCrossing >= 0) gaps.push(frame / 60 - lastCrossing);
      lastCrossing = frame / 60;
    }
    if (sign !== 0) lastSign = sign;
  }
  assert.ok(largest > rad(0.5) && largest < rad(14), `largest tip angle ${(largest * 180) / Math.PI} deg`);
  assert.ok(gaps.length >= 8, `${gaps.length} crossings`);
  const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  const sd = Math.sqrt(gaps.reduce((a, b) => a + (b - mean) ** 2, 0) / gaps.length);
  assert.ok(sd / mean > 0.2, `crossing gaps vary by ${(sd / mean).toFixed(2)} of their mean`);
});

test("with nothing asked of it the rig holds the rest pose", () => {
  const rig = createLionessRig();
  for (let frame = 0; frame < 120; frame += 1) rig.step(1 / 60, still);
  for (const i of [...shardsOf(TAIL_GROUP), ...shardsOf(HEAD_GROUP)]) {
    const posed = rig.corners(i)!;
    LIONESS_SHARDS[i]!.forEach((value, k) => assert.ok(Math.abs(posed[k]! - value) < 1e-12, `shard ${i} drifted`));
  }
});

test("the head turns on a spring that overshoots a little and settles", () => {
  const rig = createLionessRig();
  let peak = 0;
  for (let frame = 1; frame <= 120; frame += 1) {
    rig.step(1 / 60, { awake: 0, headTarget: rad(5) });
    peak = Math.max(peak, rig.headAngle());
  }
  assert.ok(peak > rad(5.1) && peak < rad(6.25), `peak ${(peak * 180) / Math.PI} deg for a 5 deg pull`);
  assert.ok(Math.abs(rig.headAngle() - rad(5)) < rad(0.05));
});

test("each cue plays once and she comes back to rest", () => {
  for (const [cue, reached] of [
    ["tilt", (rig: ReturnType<typeof createLionessRig>) => -rig.headAngle()],
    ["nod", (rig: ReturnType<typeof createLionessRig>) => rig.headAngle()],
    ["flick", (rig: ReturnType<typeof createLionessRig>) => rig.tailAngles()[TAIL_SEGMENTS - 1]!],
  ] as const) {
    const rig = createLionessRig();
    rig.step(0, still);
    rig.cue(cue);
    let most = 0;
    for (let frame = 1; frame <= 60 * 3; frame += 1) {
      rig.step(1 / 60, still);
      most = Math.max(most, reached(rig));
    }
    assert.ok(most > rad(3), `${cue} reached ${(most * 180) / Math.PI} deg`);
    assert.ok(Math.abs(rig.headAngle()) < rad(0.1), `${cue}: head back at rest`);
    assert.ok(rig.tailAngles().every((a) => Math.abs(a) < rad(0.1)), `${cue}: tail back at rest`);
  }
});
