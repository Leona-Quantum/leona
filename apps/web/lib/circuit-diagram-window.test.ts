import assert from "node:assert/strict";
import test from "node:test";

import {
  CIRCUIT_COLUMN_WIDTH,
  CIRCUIT_ROW_HEIGHT,
  circuitDiagramWindow,
} from "./circuit-diagram-window.ts";

test("diagram window renders only a bounded visible slice of a large circuit", () => {
  const visible = circuitDiagramWindow(10_000, 20_000, {
    left: 8_000 * CIRCUIT_COLUMN_WIDTH,
    top: 4_000 * CIRCUIT_ROW_HEIGHT,
    width: 800,
    height: 600,
  });

  assert.ok(visible.qubitStart <= 4_000);
  assert.ok(visible.qubitEnd > 4_000);
  assert.ok(visible.qubitEnd - visible.qubitStart < 20);
  assert.ok(visible.stepStart <= 8_000);
  assert.ok(visible.stepEnd > 8_000);
  assert.ok(visible.stepEnd - visible.stepStart < 25);
});

test("diagram window clamps overscan at circuit boundaries", () => {
  assert.deepEqual(
    circuitDiagramWindow(3, 2, { left: 0, top: 0, width: 10_000, height: 10_000 }),
    { qubitStart: 0, qubitEnd: 3, stepStart: 0, stepEnd: 2 },
  );
});
