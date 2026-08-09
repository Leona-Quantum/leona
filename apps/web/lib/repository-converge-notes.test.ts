// The two sentences the canvas owes a reader about its own caps.
//
// They were duplicated across two components and only one component ever
// printed them, so this file checks the thing duplication actually breaks: that
// the sentence carries the numbers it is about, and that the Japanese one is a
// translation rather than the English one pasted into the `ja` slot.
import assert from "node:assert/strict";
import test from "node:test";

import { convergeNotes } from "./repository/converge-notes.ts";
import { CONVERGE_OPEN_MAX } from "./repository/converge-layout.ts";
import type { PublicLocale } from "./public-locale.ts";

const LOCALES: PublicLocale[] = ["en", "ja"];

test("the cap notes say both numbers, in both locales", () => {
  for (const locale of LOCALES) {
    const notes = convergeNotes(locale);

    // Both numbers, and looked for as *values* rather than as an interpolation
    // that happened to run. `${max}` is the half a translator drops — the
    // sentence still reads, and it stops being checkable against the picture.
    const dropped = notes.droppedOpen(7, CONVERGE_OPEN_MAX);
    assert.match(dropped, /(?<!\d)7(?!\d)/, `${locale}: the note does not say how many were dropped`);
    assert.ok(
      dropped.includes(String(CONVERGE_OPEN_MAX)),
      `${locale}: the note does not say how many are drawn (${CONVERGE_OPEN_MAX})`,
    );

    // The same demand of the second note, which used to carry no number at all
    // and said only that *something* went deeper.
    assert.match(
      notes.cappedInside(33),
      /(?<!\d)33(?!\d)/,
      `${locale}: the note does not say how many lines it is about`,
    );
  }
});

test("a Japanese reader gets Japanese", () => {
  const en = convergeNotes("en");
  const ja = convergeNotes("ja");
  assert.notEqual(ja.cappedInside(3), en.cappedInside(3));
  assert.notEqual(ja.droppedOpen(2, 128), en.droppedOpen(2, 128));
  // Kana or kanji, not merely "a different string". Two English variants would
  // pass a `notEqual` and fail a reader, which is the standing rule about
  // rendering `ja` before calling a UI change verified, made failable here.
  for (const text of [ja.cappedInside(3), ja.droppedOpen(2, 128)]) {
    assert.match(text, /[぀-ヿ一-鿿]/, `not Japanese: ${text}`);
  }
});

test("one thing dropped is not “1 things”", () => {
  // The English notes are the only ones that inflect, and the singular is the
  // case a reader is most likely to hit: one click past the cap, one line at
  // the ceiling.
  const en = convergeNotes("en");
  assert.match(en.droppedOpen(1, 128), /1 more thing than/);
  assert.match(en.droppedOpen(2, 128), /2 more things than/);
  assert.match(en.cappedInside(1), /1 line here has more/);
  assert.match(en.cappedInside(6), /6 lines here have more/);
});
