import assert from "node:assert/strict";
import test from "node:test";

import { figureHref } from "./repository/converge-layout.ts";
import {
  MAP_ABOUT_DEFAULT,
  MAP_ABOUT_SECTIONS,
  parseAboutSection,
  withAbout,
} from "./repository/map-about.ts";

test("an absent ?about= leaves the information box shut", () => {
  assert.equal(parseAboutSection(undefined), null);
});

test("an empty ?about= leaves the information box shut", () => {
  // `?about=` with nothing after it is what a hand-edited URL produces, and it
  // must not open a box the reader did not ask for.
  assert.equal(parseAboutSection(""), null);
});

test("each section id names itself", () => {
  for (const section of MAP_ABOUT_SECTIONS) {
    assert.equal(parseAboutSection(section), section);
  }
});

test("a section id that no longer exists opens the first section", () => {
  // The ids are in links that have already been sent. A rename must land the
  // reader somewhere rather than doing nothing at all.
  assert.equal(parseAboutSection("legend"), MAP_ABOUT_DEFAULT);
});

test("a repeated ?about= takes the first value", () => {
  assert.equal(parseAboutSection(["how-to-read-it", "not-here-yet"]), "how-to-read-it");
});

test("opening the box on a bare figure adds the only parameter", () => {
  assert.equal(
    withAbout("/repository/layers", "what-this-is"),
    "/repository/layers?about=what-this-is",
  );
});

test("shutting the box removes the parameter and nothing else", () => {
  assert.equal(
    withAbout("/repository/layers?focus=quantum-linear-solve&about=not-here-yet", null),
    "/repository/layers?focus=quantum-linear-solve",
  );
});

test("shutting the box on a figure with no other parameter leaves a bare path", () => {
  assert.equal(withAbout("/repository/layers?about=what-this-is", null), "/repository/layers");
});

test("switching section replaces rather than appends", () => {
  assert.equal(
    withAbout("/repository/layers?about=what-this-is", "not-here-yet"),
    "/repository/layers?about=not-here-yet",
  );
});

test("the reader's focus, every open line and their viewport survive a round trip", () => {
  // The specific bug this pins: a box that opens by re-serializing the query
  // would drop the repeated `?open=` values, and the reader would find every
  // line they had opened shut again the moment they asked what a line means.
  const base = figureHref(
    "observable-estimation",
    ["observable-estimation:0.0", "observable-estimation:0.1"],
    "0,0,1.5",
  );
  const opened = withAbout(base, "how-to-move-around");
  assert.equal(withAbout(opened, null), base);
  assert.equal(opened, `${base}&about=how-to-move-around`);
});

test("a viewport keeps the encoding figureHref gave it", () => {
  // `figureHref` writes its query with URLSearchParams, so a round trip through
  // URLSearchParams here has to be byte-identical — otherwise `?at=0%2C0%2C0.5`
  // becomes `?at=0,0,0.5` on one surface and the two spellings of one viewport
  // start producing two cache entries and two different-looking shared links.
  const base = figureHref(null, [], "0,0,0.5");
  assert.equal(base, "/repository/layers?at=0%2C0%2C0.5");
  assert.equal(withAbout(base, null), base);
});
