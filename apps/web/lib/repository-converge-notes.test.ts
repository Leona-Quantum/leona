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

    assert.ok(notes.depthCapped.trim().length > 0, `${locale}: the depth note is empty`);
  }
});

test("a Japanese reader gets Japanese", () => {
  const en = convergeNotes("en");
  const ja = convergeNotes("ja");
  assert.notEqual(ja.depthCapped, en.depthCapped);
  assert.notEqual(ja.droppedOpen(2, 128), en.droppedOpen(2, 128));
  // Kana or kanji, not merely "a different string". Two English variants would
  // pass a `notEqual` and fail a reader, which is the standing rule about
  // rendering `ja` before calling a UI change verified, made failable here.
  for (const text of [ja.depthCapped, ja.droppedOpen(2, 128)]) {
    assert.match(text, /[぀-ヿ一-鿿]/, `not Japanese: ${text}`);
  }
});

test("one thing dropped is not “1 things”", () => {
  // The English note is the only one that inflects, and the singular is the
  // case a reader is most likely to hit: one click past the cap.
  assert.match(convergeNotes("en").droppedOpen(1, 128), /1 more thing than/);
  assert.match(convergeNotes("en").droppedOpen(2, 128), /2 more things than/);
});
