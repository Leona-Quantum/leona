/**
 * Studio's discovery pane: which saved circuits it shows, and under which tab.
 *
 * PR 207 put Projects on the workspace and wired the left sidebar to them. The
 * Studio page's own list was left as it was — one flat list of everything, and
 * a search that could not see a project at all. So the grouping a person made
 * existed in the rail beside the list and nowhere in the list, and the only way
 * to look at one project's work was to expand it in the sidebar and open its
 * circuits one at a time.
 *
 * The filtering lives here rather than inline in `studio-workspace.tsx` for one
 * practical reason: that component is nine hundred lines with no test file, and
 * every rule below has a plausible wrong version that renders perfectly.
 */

import type { ArtifactProject } from "./artifact-projects.ts";
import type { LibraryArtifact } from "./library-data.ts";

/** `all` is every circuit; `ungrouped` is the ones filed under no project. */
export type ProjectFilter = { kind: "all" } | { kind: "ungrouped" } | { kind: "project"; id: string };

export const ALL_PROJECTS: ProjectFilter = { kind: "all" };
export const UNGROUPED: ProjectFilter = { kind: "ungrouped" };

export type DiscoveryTab = {
  filter: ProjectFilter;
  /** Project name, or "" for the two built-in tabs — the caller supplies copy. */
  name: string;
  count: number;
};

/**
 * The project an artifact is shown under, or null for ungrouped.
 *
 * A `projectId` naming a project the browser does not know about resolves to
 * **ungrouped**, not to a fourth state. That is not defensive coding, it is the
 * server's own answer arriving late: `delete_project` NULLs its artifacts'
 * `project_id` before dropping the row, so an id with no project behind it is a
 * local mirror that has not caught up with a deletion. Leaving such a circuit
 * out of every tab would make it unreachable from this pane until a reload —
 * disappearing work, over an assignment that is already gone.
 */
export function projectOf(
  artifact: LibraryArtifact,
  projects: readonly ArtifactProject[],
): ArtifactProject | null {
  if (!artifact.projectId) return null;
  return projects.find((project) => project.id === artifact.projectId) ?? null;
}

export function matchesFilter(
  artifact: LibraryArtifact,
  filter: ProjectFilter,
  projects: readonly ArtifactProject[],
): boolean {
  if (filter.kind === "all") return true;
  const project = projectOf(artifact, projects);
  if (filter.kind === "ungrouped") return project === null;
  return project?.id === filter.id;
}

/**
 * Everything the search box compares against, lowercased.
 *
 * The project name is in here so that typing a project's name finds its
 * circuits from the "All" tab — the name is how people refer to a body of work
 * out loud, and it was the one label about a circuit the search could not see.
 */
export function searchHaystack(
  artifact: LibraryArtifact,
  projects: readonly ArtifactProject[],
): string {
  const project = projectOf(artifact, projects);
  return [
    artifact.title,
    artifact.family,
    artifact.framework,
    artifact.description,
    ...artifact.tags,
    project?.name ?? "",
  ]
    .join(" ")
    .toLowerCase();
}

export function filterDiscoveryArtifacts(
  artifacts: readonly LibraryArtifact[],
  {
    query,
    filter,
    projects,
  }: { query: string; filter: ProjectFilter; projects: readonly ArtifactProject[] },
): LibraryArtifact[] {
  const normalized = query.trim().toLowerCase();
  return artifacts.filter(
    (artifact) =>
      matchesFilter(artifact, filter, projects) &&
      (!normalized || searchHaystack(artifact, projects).includes(normalized)),
  );
}

/**
 * The tab row: All, then every project in the sidebar's order, then Ungrouped.
 *
 * Two rules worth stating, because both have a reasonable-looking opposite:
 *
 * * **Counts ignore the search box.** A tab is a scope to look inside, not a
 *   result count — recounting on every keystroke makes the row of numbers move
 *   while somebody is typing, and a project whose count fell to zero would read
 *   as having lost its circuits rather than as not matching four letters.
 * * **Every project gets a tab, including the empty ones.** A project a person
 *   made and has not filled yet is exactly the one they are about to file
 *   something into, and a tab row that hides it says the project is gone.
 *   `Ungrouped` is the exception and appears only when something is in it,
 *   because nobody created it.
 */
export function discoveryTabs(
  artifacts: readonly LibraryArtifact[],
  projects: readonly ArtifactProject[],
): DiscoveryTab[] {
  if (!projects.length) return [];
  const ungrouped = artifacts.filter((artifact) => projectOf(artifact, projects) === null).length;
  const tabs: DiscoveryTab[] = [
    { filter: ALL_PROJECTS, name: "", count: artifacts.length },
    ...projects.map((project) => ({
      filter: { kind: "project" as const, id: project.id },
      name: project.name,
      count: artifacts.filter((artifact) => artifact.projectId === project.id).length,
    })),
  ];
  if (ungrouped) tabs.push({ filter: UNGROUPED, name: "", count: ungrouped });
  return tabs;
}

export function sameFilter(a: ProjectFilter, b: ProjectFilter): boolean {
  if (a.kind !== b.kind) return false;
  return a.kind !== "project" || b.kind !== "project" || a.id === b.id;
}

/**
 * The filter to hold after the project list changes underneath it.
 *
 * Deleting the project you are looking at — from the sidebar, or from another
 * device — otherwise leaves the pane pinned to an id nothing matches, i.e. an
 * empty list with a selected tab that is no longer in the row. Falling back to
 * All is the only option that shows the circuits, which are still there: a
 * deleted project releases its artifacts rather than taking them.
 */
export function surviveProjectChange(
  filter: ProjectFilter,
  projects: readonly ArtifactProject[],
): ProjectFilter {
  if (filter.kind !== "project") return filter;
  return projects.some((project) => project.id === filter.id) ? filter : ALL_PROJECTS;
}
