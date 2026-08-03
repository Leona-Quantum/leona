import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ArtifactProject } from "./artifact-projects.ts";
import type { LibraryArtifact } from "./library-data.ts";
import {
  ALL_PROJECTS,
  UNGROUPED,
  discoveryTabs,
  filterDiscoveryArtifacts,
  projectOf,
  sameFilter,
  searchHaystack,
  surviveProjectChange,
} from "./studio-discovery.ts";

const PROJECTS: ArtifactProject[] = [
  { id: "p-grover", name: "Grover experiments", createdAt: "2026-07-01T00:00:00Z" },
  { id: "p-vqe", name: "VQE", createdAt: "2026-07-02T00:00:00Z" },
  { id: "p-empty", name: "Nothing here yet", createdAt: "2026-07-03T00:00:00Z" },
];

function artifact(over: Partial<LibraryArtifact> & { id: string }): LibraryArtifact {
  return {
    slug: over.id,
    title: "Bell pair",
    family: "Bell",
    framework: "qiskit",
    status: "verified",
    updatedAt: "2026-08-01T00:00:00Z",
    description: "two entangled qubits",
    tags: [],
    verification: "",
    code: "",
    qasm: null,
    resourceRows: [],
    source: "run",
    ...over,
  } as LibraryArtifact;
}

const BELL = artifact({ id: "a1", projectId: "p-grover", title: "Bell pair" });
const SEARCH = artifact({ id: "a2", projectId: "p-grover", title: "Amplitude search" });
const GROUND = artifact({ id: "a3", projectId: "p-vqe", title: "Ground state" });
const LOOSE = artifact({ id: "a4", title: "Scratch circuit" });
const ALL = [BELL, SEARCH, GROUND, LOOSE];

const filter = (over: Partial<Parameters<typeof filterDiscoveryArtifacts>[1]> = {}) =>
  filterDiscoveryArtifacts(ALL, {
    query: "",
    filter: ALL_PROJECTS,
    projects: PROJECTS,
    ...over,
  }).map((item) => item.id);

describe("filterDiscoveryArtifacts", () => {
  it("shows everything under All", () => {
    assert.deepEqual(filter(), ["a1", "a2", "a3", "a4"]);
  });

  it("narrows to one project", () => {
    assert.deepEqual(filter({ filter: { kind: "project", id: "p-grover" } }), ["a1", "a2"]);
    assert.deepEqual(filter({ filter: { kind: "project", id: "p-empty" } }), []);
  });

  it("shows only the unfiled circuits under Ungrouped", () => {
    assert.deepEqual(filter({ filter: UNGROUPED }), ["a4"]);
  });

  it("applies the search and the project together, not either-or", () => {
    // "pair" is in one title only; "bell" would match every fixture's family.
    assert.deepEqual(filter({ query: "pair", filter: { kind: "project", id: "p-grover" } }), ["a1"]);
    assert.deepEqual(
      filter({ query: "pair", filter: { kind: "project", id: "p-vqe" } }),
      [],
      "a match outside the selected project must stay hidden",
    );
  });

  it("finds a project's circuits by the project's own name", () => {
    assert.deepEqual(filter({ query: "grover" }), ["a1", "a2"]);
  });

  it("ignores case and surrounding space, as the old inline filter did", () => {
    assert.deepEqual(filter({ query: "  GROUND  " }), ["a3"]);
  });
});

describe("projectOf", () => {
  // The case with a plausible wrong answer. A stale id is what a browser holds
  // between another device deleting a project and this one reloading; the
  // server has already NULLed the column.
  it("reads a projectId naming no known project as ungrouped", () => {
    const stale = artifact({ id: "a9", projectId: "p-deleted" });
    assert.equal(projectOf(stale, PROJECTS), null);
    assert.deepEqual(
      filterDiscoveryArtifacts([stale], {
        query: "",
        filter: UNGROUPED,
        projects: PROJECTS,
      }).map((item) => item.id),
      ["a9"],
      "it must be reachable from some tab, not from none",
    );
  });

  it("resolves a live id to its project", () => {
    assert.equal(projectOf(BELL, PROJECTS)?.name, "Grover experiments");
  });
});

describe("searchHaystack", () => {
  it("carries the fields the pane displays plus the project name", () => {
    const hay = searchHaystack(artifact({ id: "x", projectId: "p-vqe", tags: ["chemistry"] }), PROJECTS);
    for (const term of ["bell pair", "qiskit", "entangled", "chemistry", "vqe"]) {
      assert.ok(hay.includes(term), `expected the haystack to include ${term}: ${hay}`);
    }
  });

  it("does not invent a name for an ungrouped circuit", () => {
    assert.ok(!searchHaystack(LOOSE, PROJECTS).includes("grover"));
  });
});

describe("discoveryTabs", () => {
  it("renders nothing at all when the workspace has no projects", () => {
    assert.deepEqual(discoveryTabs(ALL, []), [], "a lone All tab is a control that does nothing");
  });

  it("counts each project, and keeps a project nobody has filled yet", () => {
    const tabs = discoveryTabs(ALL, PROJECTS);
    assert.deepEqual(
      tabs.map((tab) => [tab.filter.kind, tab.name, tab.count]),
      [
        ["all", "", 4],
        ["project", "Grover experiments", 2],
        ["project", "VQE", 1],
        ["project", "Nothing here yet", 0],
        ["ungrouped", "", 1],
      ],
    );
  });

  it("drops Ungrouped when every circuit is filed", () => {
    const tabs = discoveryTabs([BELL, GROUND], PROJECTS);
    assert.ok(!tabs.some((tab) => tab.filter.kind === "ungrouped"));
  });

  // Counting the filtered list instead would make the numbers move while
  // somebody types, and read as circuits leaving the project.
  it("counts the whole workspace, not the search results", () => {
    const tabs = discoveryTabs(ALL, PROJECTS);
    assert.equal(tabs[1].count, 2, "the search box must not reach these numbers");
  });
});

describe("surviveProjectChange", () => {
  it("falls back to All when the selected project is deleted", () => {
    const selected = { kind: "project", id: "p-vqe" } as const;
    assert.deepEqual(surviveProjectChange(selected, PROJECTS), selected);
    assert.deepEqual(
      surviveProjectChange(selected, [PROJECTS[0]]),
      ALL_PROJECTS,
      "a deleted project releases its circuits — they must not vanish with it",
    );
  });

  it("leaves the two built-in filters alone", () => {
    assert.deepEqual(surviveProjectChange(UNGROUPED, []), UNGROUPED);
    assert.deepEqual(surviveProjectChange(ALL_PROJECTS, []), ALL_PROJECTS);
  });
});

describe("sameFilter", () => {
  it("distinguishes two projects and matches identical filters", () => {
    assert.equal(sameFilter(ALL_PROJECTS, ALL_PROJECTS), true);
    assert.equal(sameFilter(UNGROUPED, ALL_PROJECTS), false);
    assert.equal(sameFilter({ kind: "project", id: "a" }, { kind: "project", id: "b" }), false);
    assert.equal(sameFilter({ kind: "project", id: "a" }, { kind: "project", id: "a" }), true);
  });
});
