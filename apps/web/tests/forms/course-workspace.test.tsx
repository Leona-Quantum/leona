import "./dom-env.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { render } from "@testing-library/react";
import { CourseModuleCard } from "../../app/(app)/notebooks/courses/[courseId]/course-workspace.tsx";
import type { CourseModule } from "../../lib/course-types.ts";
import { WORKSPACE_COPY } from "../../lib/workspace-locale.ts";

const copy = WORKSPACE_COPY.en.courses;
const notebooksCopy = WORKSPACE_COPY.en.notebooks;

const bellState: CourseModule = {
  id: "m-bell",
  seq: 1,
  slug: "bell-state",
  title: "The Bell state",
  topic: "Entanglement",
  key_concepts: ["superposition", "entanglement"],
  objectives: ["Build a Bell pair", "Explain why it can't be simulated classically"],
  deliverable: "A notebook that builds and measures a Bell pair.",
  kind: "lesson",
  duration_minutes: 25,
  prerequisites: [],
  brief: "",
  notebook_id: null,
  status: "planned",
  notebook_version_seq: null,
};

const teleportation: CourseModule = {
  id: "m-teleport",
  seq: 2,
  slug: "teleportation",
  title: "Quantum teleportation",
  topic: "Protocols",
  key_concepts: [],
  objectives: [],
  deliverable: "",
  kind: "lab",
  duration_minutes: null,
  prerequisites: ["bell-state", "no-such-module"],
  brief: "",
  notebook_id: "nb-123",
  status: "ready",
  notebook_version_seq: 1,
};

function noop() {}

test("a planned module renders its topic, concepts, objectives, duration and a Generate action", () => {
  const view = render(
    <CourseModuleCard
      module={bellState}
      modules={[bellState, teleportation]}
      locale="en"
      runId={null}
      generating={false}
      reordering={false}
      canMoveUp={false}
      canMoveDown={true}
      onGenerate={noop}
      onMoveUp={noop}
      onMoveDown={noop}
      onRunTerminal={noop}
    />,
  );

  assert.ok(view.getByText(copy.moduleSeqLabel(1)));
  assert.ok(view.getByText(notebooksCopy.kindOption.lesson));
  assert.ok(view.getByText(copy.moduleStatusPill.planned));
  assert.ok(view.getByText("The Bell state"));
  assert.match(view.getByText(/Entanglement/).textContent ?? "", /Entanglement/);
  assert.ok(view.getByText("superposition"));
  assert.ok(view.getByText("entanglement"));
  assert.ok(view.getByText("Build a Bell pair"));
  assert.ok(view.getByText(copy.durationLabel(25)));

  // No notebook yet and status is "planned": the generate action is offered,
  // never a dead "Open notebook" link.
  assert.ok(view.getByRole("button", { name: copy.generateModule }));
  assert.equal(view.queryByRole("link", { name: copy.openNotebook }), null);
});

test("prerequisites resolve to a link for a real slug and plain text for a stale one", () => {
  const view = render(
    <CourseModuleCard
      module={teleportation}
      modules={[bellState, teleportation]}
      locale="en"
      runId={null}
      generating={false}
      reordering={false}
      canMoveUp={true}
      canMoveDown={false}
      onGenerate={noop}
      onMoveUp={noop}
      onMoveDown={noop}
      onRunTerminal={noop}
    />,
  );

  // "bell-state" resolves to the earlier module and renders as a link to its card.
  const link = view.getByRole("link", { name: "The Bell state" }) as HTMLAnchorElement;
  assert.equal(link.getAttribute("href"), "#course-module-bell-state");

  // A stale slug with no module in this course renders as plain text, not a dead link.
  assert.ok(view.getByText(copy.prerequisiteUnresolved("no-such-module")));

  // This module already has a notebook: "Open notebook" links to it, and no
  // Generate button is offered for an already-generated module.
  const openLink = view.getByRole("link", { name: copy.openNotebook }) as HTMLAnchorElement;
  assert.equal(openLink.getAttribute("href"), "/notebooks/nb-123");
  assert.equal(view.queryByRole("button", { name: copy.generateModule }), null);
});

test("a module with no duration set shows the fallback copy, not a blank or a literal null", () => {
  const view = render(
    <CourseModuleCard
      module={teleportation}
      modules={[bellState, teleportation]}
      locale="en"
      runId={null}
      generating={false}
      reordering={false}
      canMoveUp={false}
      canMoveDown={false}
      onGenerate={noop}
      onMoveUp={noop}
      onMoveDown={noop}
      onRunTerminal={noop}
    />,
  );
  assert.ok(view.getByText(copy.durationUnknown));
});
