/**
 * ai-ops 372. Proves every `{token}` in the `/benchmarks` prose actually gets
 * filled from `lib/benchmarks/qiskit-humaneval.ts` (the data file) and from
 * a real run's own computed facts — never left as a literal placeholder, and
 * never a hand-typed number that could drift from the data file it is
 * supposed to be quoting.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { BENCHMARKS_COPY, BENCHMARKS_HARNESS_URL } from "./benchmarks-copy.ts";
import { QISKIT_HUMANEVAL_CEILING, QISKIT_HUMANEVAL_CONTROLS, QISKIT_HUMANEVAL_RUNS } from "./benchmarks/qiskit-humaneval.ts";
import {
  completedRunFacts,
  firstAndLatestCompletedFacts,
  formatTemplate,
  headlineFacts,
} from "./benchmarks/qiskit-humaneval-view.ts";
import type { PublicLocale } from "./public-locale.ts";

/** Any character from a Japanese script — hiragana, katakana, or a CJK ideograph. */
const JAPANESE_CHARACTER = /[぀-ヿ一-龯]/;

const CEILING_VARS = {
  totalTasks: QISKIT_HUMANEVAL_CEILING.totalTasks,
  gradableTasks: QISKIT_HUMANEVAL_CEILING.gradableTasks,
  blockedTasks: QISKIT_HUMANEVAL_CEILING.blockedTasks,
  blockedNeedsIbmCloud: QISKIT_HUMANEVAL_CEILING.blockedNeedsIbmCloud,
  blockedNeedsFileWrite: QISKIT_HUMANEVAL_CEILING.blockedNeedsFileWrite,
};

function assertNoLeftoverTokens(filled: string, label: string) {
  assert.doesNotMatch(filled, /\{[a-zA-Z]+\}/, `${label} left an unfilled {token}: "${filled}"`);
}

const LOCALES: PublicLocale[] = ["en", "ja"];

for (const locale of LOCALES) {
  test(`${locale}: the ceiling title/body fill from QISKIT_HUMANEVAL_CEILING and contain its real numbers`, () => {
    const copy = BENCHMARKS_COPY[locale];
    const title = formatTemplate(copy.ceiling.titleTemplate, CEILING_VARS);
    const body = formatTemplate(copy.ceiling.bodyTemplate, CEILING_VARS);
    assertNoLeftoverTokens(title, `${locale} ceiling title`);
    assertNoLeftoverTokens(body, `${locale} ceiling body`);
    assert.ok(title.includes(String(QISKIT_HUMANEVAL_CEILING.gradableTasks)));
    assert.ok(title.includes(String(QISKIT_HUMANEVAL_CEILING.totalTasks)));
    assert.ok(body.includes(String(QISKIT_HUMANEVAL_CEILING.blockedTasks)));
    assert.ok(body.includes(String(QISKIT_HUMANEVAL_CEILING.blockedNeedsIbmCloud)));
    assert.ok(body.includes(String(QISKIT_HUMANEVAL_CEILING.blockedNeedsFileWrite)));
  });

  test(`${locale}: the controls body fills from QISKIT_HUMANEVAL_CONTROLS and the ceiling`, () => {
    const copy = BENCHMARKS_COPY[locale];
    const body = formatTemplate(copy.controls.bodyTemplate, {
      ...CEILING_VARS,
      stubCanonicalPassed: QISKIT_HUMANEVAL_CONTROLS.stubCanonical.passed,
      stubCanonicalTotal: QISKIT_HUMANEVAL_CONTROLS.stubCanonical.total,
      stubGarbagePassed: QISKIT_HUMANEVAL_CONTROLS.stubGarbage.passed,
    });
    assertNoLeftoverTokens(body, `${locale} controls body`);
    assert.ok(body.includes(String(QISKIT_HUMANEVAL_CONTROLS.stubCanonical.passed)));
    assert.ok(body.includes(String(QISKIT_HUMANEVAL_CONTROLS.stubGarbage.passed)));
  });

  test(`${locale}: the history table's "of gradable" column header fills from the ceiling`, () => {
    const copy = BENCHMARKS_COPY[locale];
    const header = formatTemplate(copy.history.columns.ofGradableTemplate, CEILING_VARS);
    assertNoLeftoverTokens(header, `${locale} history column header`);
    assert.ok(header.includes(String(QISKIT_HUMANEVAL_CEILING.gradableTasks)));
  });

  test(`${locale}: every "what this score does not show" item fills cleanly`, () => {
    const copy = BENCHMARKS_COPY[locale];
    assert.ok(copy.limits.items.length > 0);
    for (const item of copy.limits.items) {
      const filled = formatTemplate(item, CEILING_VARS);
      assertNoLeftoverTokens(filled, `${locale} limits item`);
    }
  });

  test(`${locale}: the headline templates fill from the latest completed run's own computed facts`, () => {
    const copy = BENCHMARKS_COPY[locale];
    const facts = headlineFacts(QISKIT_HUMANEVAL_RUNS);
    assert.ok(facts, "a completed run must exist in the shipped data for this test to mean anything");
    const score = formatTemplate(copy.headline.scoreTemplate, { passed: facts.passed, total: facts.total, pct: facts.passRatePct });
    const gradable = formatTemplate(copy.headline.gradableTemplate, {
      passedOfGradable: facts.passedOfGradable,
      gradable: facts.gradable,
      pct: facts.gradableRatePct,
    });
    assertNoLeftoverTokens(score, `${locale} headline score`);
    assertNoLeftoverTokens(gradable, `${locale} headline gradable line`);
    assert.ok(score.includes(String(facts.passed)));
    assert.ok(score.includes(String(facts.total)));
    assert.ok(gradable.includes(String(facts.passedOfGradable)));
    assert.ok(gradable.includes(String(facts.gradable)));
  });

  test(`${locale}: the pending headline copy names no number at all`, () => {
    const copy = BENCHMARKS_COPY[locale];
    assert.doesNotMatch(copy.headline.pendingTitle, /\d/, "the pending title must not carry a digit");
    // pendingBodyTemplate carries only {date}, which is a calendar date, not a
    // score — a fixed test date, since both shipped runs are complete now and
    // neither run's own `date` is standing in for "whenever a future run is
    // still pending".
    const filled = formatTemplate(copy.headline.pendingBodyTemplate, { date: "2099-01-01" });
    assertNoLeftoverTokens(filled, `${locale} pending headline body`);
  });

  test(`${locale}: the history "what changed" line fills from both runs' real facts and the ceiling`, () => {
    const copy = BENCHMARKS_COPY[locale];
    const comparison = firstAndLatestCompletedFacts(QISKIT_HUMANEVAL_RUNS);
    assert.ok(comparison, "both shipped runs are complete, so a comparison must exist");
    const filled = formatTemplate(copy.history.changeTemplate, {
      ...CEILING_VARS,
      firstPassed: comparison.first.passed,
      firstTotal: comparison.first.total,
      firstPct: comparison.first.passRatePct,
      firstOfGradable: comparison.first.passedOfGradable,
      latestPassed: comparison.latest.passed,
      latestTotal: comparison.latest.total,
      latestPct: comparison.latest.passRatePct,
      latestOfGradable: comparison.latest.passedOfGradable,
    });
    assertNoLeftoverTokens(filled, `${locale} history change line`);
    assert.ok(filled.includes(String(comparison.first.passed)), "must quote the first run's real pass count");
    assert.ok(filled.includes(String(comparison.latest.passed)), "must quote the latest run's real pass count");
    assert.ok(filled.includes("68"), "the first run's 68 passes must appear literally");
    assert.ok(filled.includes("85"), "the second run's 85 passes must appear literally");
  });
}

test("both completed runs' facts, used above, still match each README's published figures", () => {
  const first = completedRunFacts(QISKIT_HUMANEVAL_RUNS[0]);
  assert.ok(first);
  assert.equal(first.passed, 68);
  assert.equal(first.total, 151);
  assert.equal(first.passedOfGradable, 64);
  assert.equal(first.gradable, 106);

  const second = completedRunFacts(QISKIT_HUMANEVAL_RUNS[1]);
  assert.ok(second);
  assert.equal(second.passed, 85);
  assert.equal(second.total, 151);
  assert.equal(second.passedOfGradable, 75);
  assert.equal(second.gradable, 106);
});

test("japanese copy actually reads as Japanese, not a copy-pasted English fallback", () => {
  const ja = BENCHMARKS_COPY.ja;
  for (const text of [
    ja.hero.body,
    ja.what.body,
    ja.how.body,
    ja.ceiling.bodyTemplate,
    ja.controls.bodyTemplate,
    ja.history.body,
    ja.history.changeTemplate,
    ja.history.notesTitle,
    ...ja.limits.items,
    ja.source.body,
  ]) {
    assert.ok(JAPANESE_CHARACTER.test(text), `expected Japanese text, got: "${text}"`);
  }
});

test("the harness link points at the public repository's actual public_benchmarks directory", () => {
  assert.equal(
    BENCHMARKS_HARNESS_URL,
    "https://github.com/Leona-Quantum/leona/tree/dev/evals/harness/src/majorana_evals/public_benchmarks",
  );
});
