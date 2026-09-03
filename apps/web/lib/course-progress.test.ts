import assert from "node:assert/strict";
import test from "node:test";

import {
  courseModuleStatusPill,
  courseProgress,
  mapModuleRunIds,
  resolveGenerateTargets,
  resolvePrerequisiteLinks,
} from "./course-progress.ts";
import type { CourseModule } from "./course-types.ts";

function makeModule(overrides: Partial<CourseModule>): CourseModule {
  return {
    id: "m1",
    seq: 1,
    slug: "intro",
    title: "Intro",
    topic: "",
    key_concepts: [],
    objectives: [],
    deliverable: "",
    kind: "lesson",
    duration_minutes: null,
    prerequisites: [],
    brief: "",
    notebook_id: null,
    status: "planned",
    notebook_version_seq: null,
    ...overrides,
  };
}

test("courseProgress derives ready/total/percent, clamped to sane bounds", () => {
  assert.deepEqual(courseProgress({ ready_count: 2, module_count: 8 }), { ready: 2, total: 8, percent: 25 });
});

test("courseProgress with zero modules reads 0%, never NaN or Infinity", () => {
  assert.deepEqual(courseProgress({ ready_count: 0, module_count: 0 }), { ready: 0, total: 0, percent: 0 });
});

test("courseProgress clamps a ready_count that overshoots module_count (stale read mid-update)", () => {
  const result = courseProgress({ ready_count: 9, module_count: 8 });
  assert.equal(result.ready, 8);
  assert.equal(result.percent, 100);
});

test("courseModuleStatusPill maps running to generating and passes the rest through", () => {
  assert.equal(courseModuleStatusPill("running"), "generating");
  assert.equal(courseModuleStatusPill("planned"), "planned");
  assert.equal(courseModuleStatusPill("queued"), "queued");
  assert.equal(courseModuleStatusPill("ready"), "ready");
  assert.equal(courseModuleStatusPill("failed"), "failed");
});

test("resolveGenerateTargets(null) returns every module with no notebook yet, in seq order", () => {
  const modules = [
    makeModule({ id: "b", seq: 2, notebook_id: null }),
    makeModule({ id: "a", seq: 1, notebook_id: "nb-1" }),
    makeModule({ id: "c", seq: 3, notebook_id: null }),
  ];
  const targets = resolveGenerateTargets(modules, null);
  assert.deepEqual(targets.map((module) => module.id), ["b", "c"]);
});

test("resolveGenerateTargets(ids) returns exactly those modules, still in the course's own seq order", () => {
  const modules = [
    makeModule({ id: "a", seq: 1 }),
    makeModule({ id: "b", seq: 2 }),
    makeModule({ id: "c", seq: 3 }),
  ];
  // Ids passed out of seq order — the result must not just echo the request order.
  const targets = resolveGenerateTargets(modules, ["c", "a"]);
  assert.deepEqual(targets.map((module) => module.id), ["a", "c"]);
});

test("mapModuleRunIds zips targets to run ids by position", () => {
  const targets = [makeModule({ id: "a" }), makeModule({ id: "b" })];
  assert.deepEqual(mapModuleRunIds(targets, ["run-a", "run-b"]), { a: "run-a", b: "run-b" });
});

test("mapModuleRunIds drops the extra entries on a length mismatch rather than throwing", () => {
  const targets = [makeModule({ id: "a" }), makeModule({ id: "b" })];
  assert.deepEqual(mapModuleRunIds(targets, ["run-a"]), { a: "run-a" });
  assert.deepEqual(mapModuleRunIds(targets, ["run-a", "run-b", "run-c"]), { a: "run-a", b: "run-b" });
});

test("resolvePrerequisiteLinks resolves a slug to its module", () => {
  const modules = [
    makeModule({ id: "a", slug: "bell-state", title: "Bell state" }),
    makeModule({ id: "b", slug: "teleportation", title: "Teleportation", prerequisites: ["bell-state"] }),
  ];
  const links = resolvePrerequisiteLinks(modules, modules[1]);
  assert.equal(links.length, 1);
  assert.equal(links[0].slug, "bell-state");
  assert.equal(links[0].module?.id, "a");
});

test("resolvePrerequisiteLinks leaves a stale slug unresolved (module: null) instead of guessing", () => {
  const modules = [makeModule({ id: "a", slug: "bell-state" })];
  const target = makeModule({ id: "b", prerequisites: ["a-slug-nobody-has"] });
  const links = resolvePrerequisiteLinks(modules, target);
  assert.equal(links.length, 1);
  assert.equal(links[0].module, null);
});
