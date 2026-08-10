import assert from "node:assert/strict";
import test from "node:test";

import { LAYER_GRAPH } from "./repository/layer-graph.ts";
import { mathBodies, mathDelimitersBalanced, mathSegments } from "./math-text.ts";

/** The input, reassembled from the segments — delimiters put back on the maths. */
function rejoin(source: string): string {
  return mathSegments(source)
    .map((segment) => (segment.math ? `$${segment.value}$` : segment.value))
    .join("");
}

test("the splitter prints everything it was given", () => {
  // **The property a reader of a physics claim depends on.** A renderer that
  // drops a clause is worse than one that fails to typeset it: the sentence
  // still reads, and the missing condition is the one nobody notices. Asserted
  // by reassembly rather than by inspecting the segments, so a split that loses
  // a character has nowhere to hide.
  for (const source of [
    "plain prose with no mathematics at all",
    "takes $O(1/\\varepsilon^2)$ samples",
    "$\\kappa$ at the front",
    "at the back, $\\kappa$",
    "two: $a$ and $b$",
    "$$",
    "a lone $ dollar",
    "the norm ||u_in|| and the pipe | both survive",
    "*asterisks* and _underscores_ and `backticks` are not markup here",
  ]) {
    assert.equal(rejoin(source), source, `reassembly lost something in: ${source}`);
  }
  // The escape is the one case where reassembly cannot be the identity — `\$`
  // becomes the character it names — so it is asserted for what it does instead.
  assert.deepEqual(mathSegments("costs \\$5"), [{ math: false, value: "costs $5" }]);
});

test("an unclosed delimiter prints as text instead of eating the sentence", () => {
  // The failure this refuses: a stray `$` turning the rest of a paragraph into
  // one formula, which renders as a red line and reads as a deliberate one. The
  // gate below fails the build on it; this is what the page does with the one
  // that gets past.
  const segments = mathSegments("holds when $\\kappa is small");
  assert.deepEqual(
    segments.map((segment) => segment.math),
    [false, false],
  );
  assert.equal(rejoin("holds when $\\kappa is small"), "holds when $\\kappa is small");
  assert.equal(mathDelimitersBalanced("holds when $\\kappa is small"), false);
  assert.equal(mathDelimitersBalanced("holds when $\\kappa$ is small"), true);
  assert.equal(mathDelimitersBalanced("no mathematics here"), true);
});

test("display mathematics is not silently accepted into a line", () => {
  // `$$…$$` breaks a paragraph in half and every surface reading these fields
  // draws inside a line. Treated as text here and named by the gate, rather
  // than this function guessing which half of the sentence to reflow.
  assert.deepEqual(mathSegments("$$"), [{ math: false, value: "$$" }]);
  assert.deepEqual(mathBodies("a $x$ b"), ["x"]);
  assert.deepEqual(mathBodies("nothing"), []);
});

test("the corpus's own prose is unchanged by the splitter wherever it carries no mathematics", () => {
  // **The claim that makes adding this component to a surface safe.** Routing a
  // field through a renderer must be a no-op on every value that has not been
  // converted yet, or "route now, convert in batches" ships a regression on the
  // untouched majority. Measured over the real corpus, not a fixture: the
  // hazard is the corpus's own pipes, underscores and asterisks, and a fixture
  // would be a set of strings chosen to pass.
  let checked = 0;
  for (const node of LAYER_GRAPH.nodes as unknown as Record<string, unknown>[]) {
    for (const [field, value] of Object.entries(node)) {
      if (typeof value !== "string" || value === "") continue;
      if (value.includes("$")) continue;
      checked += 1;
      const segments = mathSegments(value);
      assert.deepEqual(
        segments,
        [{ math: false, value }],
        `${String(node.id)}.${field} was split despite carrying no mathematics`,
      );
    }
  }
  assert.ok(checked > 100, `only ${checked} values checked — this test measures nothing`);
});
