import "./dom-env.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { render } from "@testing-library/react";
import { LandingBenchmark } from "../../components/landing-benchmark.tsx";
import { HOME_COPY } from "../../lib/public-copy.ts";

// The section's Reveal wrapper reads the reduced-motion query on mount; jsdom has none.
const media = { matches: true, addEventListener() {}, removeEventListener() {} };
Object.defineProperty(window, "matchMedia", { configurable: true, value: () => media });

// The figures were checked against their sources once (PR 806) and carried
// byte-identical since; the two locales must agree on every one of them.
test("the benchmark numbers are the same in both languages", () => {
  const numbers = (locale: "en" | "ja") =>
    HOME_COPY[locale].benchmark.rows.map((row) => row.scores.map((score) => [score.model, score.score]));
  assert.deepEqual(numbers("ja"), numbers("en"));
  for (const row of HOME_COPY.en.benchmark.rows) {
    assert.equal(row.scores.filter((score) => score.featured).length, 1, `${row.name}: exactly one LeonaQ score`);
    for (const score of row.scores) assert.ok(score.score >= 0 && score.score <= 100, `${score.model} is a percentage`);
  }
});

test("every score reaches the reader once as text, with a bar behind it, LeonaQ first in each group", () => {
  const view = render(<LandingBenchmark copy={HOME_COPY.en.benchmark} />);
  const groups = view.container.querySelectorAll(".lq-bench-group");
  assert.equal(groups.length, HOME_COPY.en.benchmark.rows.length);
  HOME_COPY.en.benchmark.rows.forEach((row, index) => {
    const items = Array.from(groups[index]!.querySelectorAll("li"));
    assert.equal(items.length, row.scores.length, `${row.name}: one line per score`);
    assert.ok(items[0]!.hasAttribute("data-featured"), `${row.name}: LeonaQ leads the group`);
    for (const score of row.scores) {
      const line = items.find((item) => item.querySelector(".lq-bench-model")?.textContent === score.model)!;
      assert.ok(line, `${row.name}: ${score.model} has a line`);
      assert.equal(line.querySelector(".lq-bench-value")?.textContent, `${score.score.toFixed(1)}%`);
      assert.equal((line.querySelector(".lq-bench-bar i") as HTMLElement).style.width, `${score.score}%`, `${row.name}: ${score.model}'s bar is its score`);
    }
    const reported = items.slice(1).map((item) => Number.parseFloat(item.querySelector(".lq-bench-value")!.textContent!));
    assert.deepEqual(reported, [...reported].sort((a, b) => b - a), `${row.name}: reported models run highest first`);
  });
  assert.equal(view.container.querySelectorAll(".lq-bench-sources a").length, HOME_COPY.en.benchmark.sources.length);
});
