import type { TourId, TourShowId, TourStep, TourTrack, TourTrackId } from "./types.ts";

/**
 * The five tracks and the twelve Show-me micro-tours (TUTORIAL.md, "The tracks").
 *
 * Built in the owner's order (ai-ops 298, option 1): Around the workspace, First
 * light, Build, then Teach and Read. The words are in `TOURS_COPY`, keyed
 * `track.step`; this file only says where each step points and what finishes it.
 *
 * Every step earns its place (owner, 2026-09-14: "way too many useless steps"). A
 * step either has the reader do the thing that matters or shows something they
 * would not find alone. No step exists only to click a link to the next page — the
 * runtime takes the reader there — and no "Open the tab" step is followed by a
 * second step that explains the tab; the two are one step.
 *
 * `@workspace` in an `on` pattern means any signed-in workspace route, which is
 * where the rail is.
 */

const around: TourTrack = {
  id: "around",
  kind: "track",
  minutes: 2,
  on: "@workspace",
  go: "/run",
  steps: [
    // One step for the whole rail. Visiting each page in turn was five page loads
    // that taught nothing the rail's own labels do not.
    { id: "rail", target: "rail-run", placement: "right" },
    { id: "new-chat", target: "sidebar-new-chat", placement: "right", on: "/run", go: "/run" },
    { id: "search", target: "sidebar-search", placement: "right", on: "/run|/studio", go: "/run" },
    { id: "account", target: "account-menu", placement: "right", expect: { kind: "click", match: "account-menu" } },
    { id: "usage", target: "menu-usage", placement: "right" },
    { id: "settings", target: "menu-settings", placement: "right", expect: { kind: "route", match: "/account" } },
    { id: "tours", target: "settings-tours", placement: "right", on: "/account", go: "/account" },
  ],
};

const firstLight: TourTrack = {
  id: "first-light",
  kind: "track",
  minutes: 4,
  on: "/run",
  go: "/run",
  steps: [
    { id: "hello", placement: "bottom" },
    { id: "starter", target: "run-starter-bell", placement: "top", expect: { kind: "click", match: "run-starter-bell" }, wrongTarget: "run-starter", remembersPrompt: true, nala: { corner: "tr", reaction: "flick" } },
    { id: "run", target: "run-submit", placement: "top", expect: { kind: "route", match: "/run/*" }, needs: "api", checksPrompt: true },
    { id: "watch", target: "run-activity", placement: "right", on: "/run/*", expect: { kind: "wait", match: "run-final-output" }, needs: "api" },
    { id: "answer", target: "run-final-output", placement: "top", on: "/run/*", needs: "api" },
    { id: "saved", target: "run-artifact-link", placement: "top", on: "/run/*", expect: { kind: "route", match: "/studio" }, needs: "api" },
    { id: "visual", target: "studio-tab-visual", placement: "bottom", on: "/studio", go: "/studio?new=1", expect: { kind: "click", match: "studio-tab-visual" } },
    { id: "gates", target: "studio-builder", placement: "top", on: "/studio", go: "/studio?new=1" },
  ],
};

const build: TourTrack = {
  id: "build",
  kind: "track",
  minutes: 6,
  on: "/run",
  go: "/run",
  steps: [
    { id: "mode", target: "run-mode", placement: "top", expect: { kind: "value", match: "^execute$" }, fill: "execute", wrongTarget: "run-framework" },
    { id: "prompt", target: "run-prompt", placement: "top", expect: { kind: "value", match: "^(?:\\s*\\S){12}" } },
    { id: "run", target: "run-submit", placement: "top", expect: { kind: "route", match: "/run/*" }, needs: "api", checksPrompt: true },
    { id: "plan", target: "run-activity", placement: "right", on: "/run/*", expect: { kind: "wait", match: "run-final-output" }, needs: "api" },
    { id: "result", target: "run-final-output", placement: "top", on: "/run/*", needs: "api" },
    { id: "studio", target: "run-artifact-link", placement: "top", on: "/run/*", expect: { kind: "route", match: "/studio" }, needs: "api" },
    { id: "code", target: "studio-tab-code", placement: "bottom", on: "/studio", go: "/studio?new=1", expect: { kind: "click", match: "studio-tab-code" } },
    { id: "convert", target: "studio-framework", placement: "bottom", on: "/studio", go: "/studio?new=1", expect: { kind: "value", match: "^cirq$" }, fill: "cirq" },
    // The visual builder, playhead and split view are one Show-me away (show-visual),
    // and the chooser lists it; the track stays on the path from prompt to a saved version.
    { id: "simulation", target: "studio-tab-simulation", placement: "bottom", on: "/studio", go: "/studio?new=1", expect: { kind: "click", match: "studio-tab-simulation" } },
    { id: "summary", target: "studio-tab-summary", placement: "bottom", on: "/studio", go: "/studio?new=1", expect: { kind: "click", match: "studio-tab-summary" } },
    { id: "save", target: "studio-verify-save", placement: "bottom", on: "/studio", go: "/studio?new=1" },
  ],
};

const teach: TourTrack = {
  id: "teach",
  kind: "track",
  minutes: 5,
  on: "/notebooks",
  go: "/notebooks",
  steps: [
    { id: "brief", target: "notebooks-brief", placement: "bottom", expect: { kind: "value", match: "^(?:\\s*\\S){3}" } },
    { id: "options", target: "notebooks-options", placement: "top", expect: { kind: "click", match: "notebooks-options" } },
    { id: "fields", target: "notebooks-fields", placement: "top" },
    { id: "create", target: "notebooks-create", placement: "top", expect: { kind: "route", match: "/notebooks/*" }, needs: "api" },
    { id: "courses", target: "notebooks-courses", placement: "bottom", expect: { kind: "route", match: "/notebooks/courses" } },
    { id: "course", target: "courses-composer", placement: "bottom", on: "/notebooks/courses", go: "/notebooks/courses" },
    { id: "qapps", target: "rail-qapps", placement: "right", on: "@workspace" },
  ],
};

const read: TourTrack = {
  id: "read",
  kind: "track",
  minutes: 3,
  on: "/repository",
  go: "/repository",
  steps: [
    { id: "search", target: "atlas-search", placement: "bottom", expect: { kind: "value", match: "^(?:\\s*\\S){2}" } },
    { id: "filters", target: "atlas-filters", placement: "bottom" },
    { id: "entry", target: "atlas-entry-link", placement: "top", expect: { kind: "route", match: "/repository/*" } },
    { id: "source", target: "atlas-entry-source", placement: "left", on: "/repository/*" },
    { id: "map", target: "atlas-entry-map", placement: "top", on: "/repository/*" },
  ],
};

const show = (id: TourShowId, on: string, go: string, steps: TourStep[]): TourTrack => ({
  id,
  kind: "show",
  minutes: 1,
  on,
  go,
  steps,
});

const shows: TourTrack[] = [
  show("show-cirq", "/studio", "/studio?new=1", [
    { id: "code", copyKey: "build.code", target: "studio-tab-code", placement: "bottom", expect: { kind: "click", match: "studio-tab-code" } },
    { id: "convert", copyKey: "build.convert", target: "studio-framework", placement: "bottom", expect: { kind: "value", match: "^cirq$" }, fill: "cirq" },
  ]),
  show("show-visual", "/studio", "/studio?new=1", [
    { id: "visual", copyKey: "build.visual", target: "studio-tab-visual", placement: "bottom", expect: { kind: "click", match: "studio-tab-visual" } },
    { id: "playhead", copyKey: "build.playhead", target: "studio-playhead", placement: "top" },
    { id: "split", copyKey: "build.split", target: "studio-split", placement: "bottom", expect: { kind: "click", match: "studio-split" } },
  ]),
  show("show-simulate", "/studio", "/studio?new=1", [
    { id: "simulation", copyKey: "build.simulation", target: "studio-tab-simulation", placement: "bottom", expect: { kind: "click", match: "studio-tab-simulation" } },
  ]),
  show("show-export", "/studio", "/studio?new=1", [
    { id: "summary", copyKey: "build.summary", target: "studio-tab-summary", placement: "bottom", expect: { kind: "click", match: "studio-tab-summary" } },
    { id: "export", copyKey: "build.export", target: "studio-download-export", placement: "bottom", needs: "api" },
  ]),
  show("show-mode", "/run", "/run", [
    { id: "mode", target: "run-mode", placement: "top" },
  ]),
  show("show-framework", "/run", "/run", [
    { id: "framework", copyKey: "build.framework", target: "run-framework", placement: "top" },
  ]),
  show("show-attach", "/run", "/run", [
    { id: "attach", target: "run-attach", placement: "top" },
  ]),
  show("show-usage", "@workspace", "/run", [
    { id: "account", copyKey: "around.account", target: "account-menu", placement: "right", expect: { kind: "click", match: "account-menu" } },
    { id: "usage", copyKey: "around.usage", target: "menu-usage", placement: "right" },
  ]),
  show("show-theme", "@workspace", "/run", [
    { id: "account", copyKey: "around.account", target: "account-menu", placement: "right", expect: { kind: "click", match: "account-menu" } },
    { id: "settings", copyKey: "around.settings", target: "menu-settings", placement: "right", expect: { kind: "route", match: "/account" } },
    { id: "preferences", copyKey: "around.preferences", target: "settings-preferences", placement: "right", on: "/account", go: "/account" },
  ]),
  show("show-lesson", "@workspace", "/notebooks", [
    { id: "brief", copyKey: "teach.brief", target: "notebooks-brief", placement: "bottom", on: "/notebooks", expect: { kind: "value", match: "^(?:\\s*\\S){3}" } },
    { id: "options", copyKey: "teach.options", target: "notebooks-options", placement: "top", on: "/notebooks", expect: { kind: "click", match: "notebooks-options" } },
    { id: "create", copyKey: "teach.create", target: "notebooks-create", placement: "top", on: "/notebooks", expect: { kind: "route", match: "/notebooks/*" }, needs: "api" },
  ]),
  show("show-qapp", "/qapps", "/qapps", [
    { id: "make", copyKey: "teach.make", target: "qapps-create-run", placement: "bottom" },
  ]),
  show("show-atlas", "/repository", "/repository", [
    { id: "search", copyKey: "read.search", target: "atlas-search", placement: "bottom", expect: { kind: "value", match: "^(?:\\s*\\S){2}" } },
    { id: "filters", copyKey: "read.filters", target: "atlas-filters", placement: "bottom" },
  ]),
];

export const TOUR_TRACKS: readonly TourTrack[] = [around, firstLight, build, teach, read];
export const TOUR_SHOWS: readonly TourTrack[] = shows;
export const ALL_TOURS: readonly TourTrack[] = [...TOUR_TRACKS, ...TOUR_SHOWS];

const BY_ID = new Map<string, TourTrack>(ALL_TOURS.map((tour) => [tour.id, tour]));

export function tourById(id: string): TourTrack | null {
  return BY_ID.get(id) ?? null;
}

export function isTourId(id: string): id is TourId {
  return BY_ID.has(id);
}

export function isTrackId(id: string): id is TourTrackId {
  return BY_ID.get(id)?.kind === "track";
}

/** The copy key a step's words live under. */
export function stepCopyKey(tour: TourTrack, step: TourStep): string {
  return step.copyKey ?? `${tour.id}.${step.id}`;
}

export function stepRoute(tour: TourTrack, step: TourStep): string {
  return step.on ?? tour.on;
}

export function stepGo(tour: TourTrack, step: TourStep): string {
  return step.go ?? tour.go;
}
