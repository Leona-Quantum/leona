import assert from "node:assert/strict";
import test from "node:test";
import { WORKSPACE_COPY } from "./workspace-locale.ts";

const LOCALES = ["en", "ja"] as const;

/**
 * The composer types these one character at a time (55ms each), so a long
 * prompt is time the reader spends watching an animation rather than reading a
 * suggestion. These ceilings are what "short" means; they are deliberately
 * different per locale because a Japanese character carries far more of the
 * sentence than a Latin one.
 */
const MAX_TYPED_LENGTH = { en: 64, ja: 34 } as const;

for (const locale of LOCALES) {
  const { examples, morePrompts } = WORKSPACE_COPY[locale].run;

  test(`${locale}: every composer suggestion is short enough to type out`, () => {
    for (const example of examples) {
      assert.ok(
        example.prompt.length <= MAX_TYPED_LENGTH[locale],
        `${locale} "${example.title}" is ${example.prompt.length} characters, `
          + `over the ${MAX_TYPED_LENGTH[locale]} the composer types comfortably: ${example.prompt}`,
      );
    }
  });

  test(`${locale}: most composer suggestions assume no prior knowledge`, () => {
    // The point of the strip is that somebody who has never written a circuit
    // sees a problem they recognise. A set where every entry says QAOA or VQE
    // teaches the opposite, so this asserts the *ratio* rather than banning the
    // vocabulary — the Bell state belongs here, four of its neighbours do not.
    //
    // "Bell state" and "ground-state energy" are on this list even though
    // neither is a *method*. The first version of this test only listed
    // algorithms, so both read as plain language and the ratio passed a
    // mutation that should have broken it. The question the test is asking is
    // whether a reader needs to know the term already, not what category it
    // belongs to.
    const jargon = new RegExp(
      [
        "grover|qaoa|vqe|qubo|qft|qae|qubit|quantum",
        "bell|ghz|hadamard|entangl|superposition|amplitude|ansatz|ground.state|h₂|circuit",
        "量子|回路|ビット|ベル|基底状態|分子|振幅|重ね合わせ",
      ].join("|"),
      "i",
    );
    const plain = examples.filter((example) => !jargon.test(example.prompt));
    assert.ok(
      plain.length >= Math.ceil(examples.length / 2),
      `${locale}: only ${plain.length} of ${examples.length} suggestions avoid quantum jargon`,
    );
  });

  test(`${locale}: the popout lists each prompt once`, () => {
    // The popout renders [...examples, ...morePrompts] and keys on title, so a
    // repeat is both a duplicate React key and the same prompt printed twice.
    const all = [...examples, ...morePrompts];
    assert.equal(new Set(all.map((entry) => entry.title)).size, all.length, "duplicate title");
    assert.equal(new Set(all.map((entry) => entry.prompt)).size, all.length, "duplicate prompt");
  });

  test(`${locale}: no suggestion is blank`, () => {
    // ghostFrame() filters empty suggestions out, so a blank one would vanish
    // from the composer's rotation while still occupying a row in the popout.
    for (const entry of [...examples, ...morePrompts]) {
      assert.ok(entry.prompt.trim().length > 0, `${locale} "${entry.title}" has an empty prompt`);
      assert.ok(entry.title.trim().length > 0, `${locale} has an entry with an empty title`);
    }
  });
}

test("both locales offer the same number of prompts", () => {
  // A locale that quietly carries fewer prompts is invisible: the composer just
  // rotates through a shorter list and the popout is shorter, with no error.
  assert.equal(
    WORKSPACE_COPY.en.run.examples.length,
    WORKSPACE_COPY.ja.run.examples.length,
    "example count differs between locales",
  );
  assert.equal(
    WORKSPACE_COPY.en.run.morePrompts.length,
    WORKSPACE_COPY.ja.run.morePrompts.length,
    "morePrompts count differs between locales",
  );
});
