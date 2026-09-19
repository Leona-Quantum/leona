import "./dom-env.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { render } from "@testing-library/react";
import { PlayheadPanel } from "../../app/(app)/studio/studio-playhead.tsx";
import { circuitMoments } from "../../lib/circuit-moments.ts";
import { WORKSPACE_COPY } from "../../lib/workspace-locale.ts";
import type { BuilderStep } from "../../lib/studio-builder.ts";

/**
 * The playhead panel, rendered — which is the only way to catch what this file
 * exists for.
 *
 * `PlayheadPanel` began as Studio's, where exactly one ever existed on a page.
 * It is now also rendered by the library's read-only circuit view and by the
 * dev fixtures page, which draws three of them. Its heading id was a hard-coded
 * string, so all three shared one `id` and every panel's `aria-labelledby`
 * resolved to the FIRST heading in the document: a screen-reader user would
 * have heard the same panel named three times.
 *
 * No unit test could see that — the defect is a property of the rendered
 * document with more than one instance in it, and both halves of that sentence
 * are outside what a pure function test can reach.
 */

const BELL: BuilderStep[] = [
  { id: "h", gate: "H", qubits: [0] },
  { id: "cx", gate: "CX", qubits: [0, 1] },
];

function panel(key: string) {
  const moments = circuitMoments(2, BELL);
  return (
    <PlayheadPanel
      key={key}
      qubitCount={2}
      steps={BELL}
      customGates={[]}
      columns={moments.columns}
      count={moments.count}
      moment={moments.count}
      onMoment={() => {}}
      copy={WORKSPACE_COPY.en.studio}
      locale="en"
    />
  );
}

test("two panels on one page do not share a heading id", () => {
  const { container } = render(
    <div>
      {panel("a")}
      {panel("b")}
    </div>,
  );
  const sections = [...container.querySelectorAll("section.mj-playhead")];
  assert.equal(sections.length, 2, "both panels must render");

  const ids = sections.map((section) => section.getAttribute("aria-labelledby"));
  assert.ok(
    ids.every((id) => typeof id === "string" && id.length > 0),
    "each panel must name its own heading",
  );
  assert.notEqual(ids[0], ids[1], "two panels on one page must not share a heading id");

  // The half that matters to a screen reader: each section's label must resolve
  // to the heading INSIDE it, not merely to a different one.
  for (const section of sections) {
    const id = section.getAttribute("aria-labelledby");
    const heading = id ? container.ownerDocument.getElementById(id) : null;
    assert.ok(heading, `aria-labelledby ${id} resolves to nothing`);
    assert.ok(section.contains(heading), "a panel's label must be its own heading, not another panel's");
  }
});

test("the panel still carries the tour anchor Studio's guided tour resolves", () => {
  // lib/tour/targets.test.ts greps the source for this attribute and, by its own
  // documented design, cannot tell that it is actually emitted. This asserts it
  // on a rendered panel, which is what the tour needs.
  const { container } = render(panel("solo"));
  assert.ok(container.querySelector('[data-tour="studio-playhead"]'), "the tour target must be rendered");
});
