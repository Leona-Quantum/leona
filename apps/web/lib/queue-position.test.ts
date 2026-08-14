import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  QUEUE_POLL_INTERVAL_MS,
  isWaitingForWorker,
  queuePositionLabel,
} from "./queue-position.ts";

test("a position is stated as a count, in both languages", () => {
  assert.equal(queuePositionLabel(0, "en"), "Next in the queue");
  assert.equal(queuePositionLabel(1, "en"), "1 run ahead of yours");
  assert.equal(queuePositionLabel(3, "en"), "3 runs ahead of yours");
  assert.equal(queuePositionLabel(19, "en"), "19 runs ahead of yours");
  assert.equal(queuePositionLabel(0, "ja"), "次に実行されます");
  assert.equal(queuePositionLabel(1, "ja"), "他1件の実行を待っています");
  assert.equal(queuePositionLabel(3, "ja"), "他3件の実行を待っています");
});

test("zero is a position, not an absence", () => {
  // The bug a falsy check produces: the run one step from starting is the one
  // the user is watching hardest, and `if (position)` goes silent exactly then.
  assert.notEqual(queuePositionLabel(0, "en"), null);
  assert.equal(isWaitingForWorker("queued"), true);
});

test("no position means no claim, rather than a stale one", () => {
  // `null` arrives two ways and both mean the same thing: the API says the run
  // is not waiting, or the client has lost the ability to refresh. Neither is a
  // number we are willing to leave on screen.
  for (const absent of [null, undefined]) {
    assert.equal(queuePositionLabel(absent, "en"), null);
    assert.equal(queuePositionLabel(absent, "ja"), null);
  }
  // And nothing malformed is rendered as if it were a count.
  for (const junk of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(queuePositionLabel(junk, "en"), null, String(junk));
  }
});

test("polling stops the moment the run is no longer waiting", () => {
  assert.equal(isWaitingForWorker("queued"), true);
  for (const status of ["running", "succeeded", "failed", "cancelled"]) {
    assert.equal(isWaitingForWorker(status), false, status);
  }
  for (const absent of [null, undefined, "", "QUEUED"]) {
    assert.equal(isWaitingForWorker(absent), false, String(absent));
  }
});

test("the statuses this polls on are statuses the API can actually send", () => {
  // A poll keyed on a status string the control plane never emits would simply
  // never run, and nothing else would notice. RunStatus is generated from the
  // Python contract, so this ties the client's vocabulary to the server's.
  const web = fileURLToPath(new URL("../", import.meta.url));
  const enums = readFileSync(
    join(web, "..", "..", "packages", "ts", "contracts-gen", "src", "enums.ts"),
    "utf8",
  );
  const match = enums.match(/RUN_STATUS_VALUES = \[([^\]]+)\]/);
  assert.ok(match, "RUN_STATUS_VALUES disappeared from the generated enums");
  const values = [...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  assert.ok(values.includes("queued"), `generated statuses are ${values.join(", ")}`);
  for (const status of values) {
    // Exactly one generated status is a waiting one; the rest must stop the poll.
    assert.equal(isWaitingForWorker(status), status === "queued", status);
  }
});

test("the interval is slow enough to leave open and fast enough to look live", () => {
  assert.ok(QUEUE_POLL_INTERVAL_MS >= 2_000, "polling this fast is a load source");
  assert.ok(QUEUE_POLL_INTERVAL_MS <= 15_000, "a count this stale reads as frozen");
});

/**
 * The wiring, read rather than executed.
 *
 * `live-run.tsx` is a client component whose queue poll is a `fetch` in an
 * effect, so the bare node runner cannot exercise it. These assert the two
 * properties that would otherwise decay silently: that the poll exists at all,
 * and that a failed poll clears the number instead of freezing it.
 */
test("the run view polls for a position and drops it when the poll fails", () => {
  const source = readFileSync(
    fileURLToPath(new URL("../app/(app)/run/[taskId]/live-run.tsx", import.meta.url)),
    "utf8",
  );
  assert.match(source, /queuePositionLabel|setQueuePosition/, "the run view no longer shows a position");
  assert.match(source, /QUEUE_POLL_INTERVAL_MS/, "the queue poll lost its interval");
  assert.match(
    source,
    /setQueuePosition\(null\)/,
    "a failed or finished poll must clear the position, not leave a stale one on screen",
  );
});

test("no estimate is offered anywhere in the queue surface", () => {
  // The refusal, asserted.
  //
  // Note for whoever reads this next: the duration IS measured now (2026-08-14,
  // production: execute runs 19.7s p50 / 28.1s p95 over 217 runs in 7 days), so
  // "we cannot" is no longer the reason and must not be repeated. The reason is
  // that a median is not a promise — see `queue-position.ts`. Showing a number a
  // user plans around is the owner's call, and until he makes it this test is
  // what stops an estimate arriving by increment.
  const web = fileURLToPath(new URL("../", import.meta.url));
  for (const rel of ["lib/queue-position.ts", "app/(app)/run/[taskId]/live-run.tsx"]) {
    const source = readFileSync(join(web, rel), "utf8");
    const rendered = source
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("*") && !line.trimStart().startsWith("//"))
      .join("\n");
    for (const pattern of [
      /estimated[ _-]?(wait|time)/i,
      /\bETA\b/,
      /minutes? (remaining|left)/i,
      /約\d+分/,
    ]) {
      assert.doesNotMatch(rendered, pattern, `${rel} offers a time estimate`);
    }
  }
});
