#!/usr/bin/env node
// Gate on the mathematics in the corpus, and the census of how much of it has
// been written as mathematics yet.
//
// ## What it fails on
//
// 1. **A `$…$` that does not compile.** `\varepsilon` and `\varepilon` are one
//    character apart, only one is a symbol, and the difference is invisible in a
//    diff *and on the page*: KaTeX renders an undefined control sequence as red
//    text, which a reader takes for emphasis. Compiled here with
//    `throwOnError: true`, which is the opposite of what the page does on
//    purpose — the page must not go down for a typo, so this must not let one
//    through.
// 2. **An unclosed `$`.** One stray delimiter turns the rest of a paragraph into
//    a formula.
// 3. **`$$` display maths.** Every surface reading these fields draws inside a
//    line; display maths breaks the paragraph in half.
// 4. **A conversion done in one locale only.** This is the rule W7 states as a
//    data problem: every field carrying mathematics has a `…Ja` sibling carrying
//    the same mathematics, so an `en`-only pass is a half-fix by construction,
//    and the half that is missing is the half nobody on this team reads while
//    working. Converted on one side and not the other fails.
//
// ## What it prints rather than fails on
//
// The **census**: populated values per field and how many carry mathematics.
// That number starts near zero and is supposed to. Printed with its denominator
// so "0 of 42" reads as *unconverted* rather than as *done* — an absence with no
// denominator beside it is the shape that gets read as a pass.
//
// Usage: node scripts/check-math.mjs [--quiet]

import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(root, "packages/ts/ui-visual/package.json"));
const esbuild = require("esbuild");
const katex = createRequire(join(root, "apps/web/package.json"))("katex");

const QUIET = process.argv.includes("--quiet");

async function bundle(relativePath, label) {
  const outDir = mkdtempSync(join(tmpdir(), "check-math-"));
  const outFile = join(outDir, `${label}.mjs`);
  try {
    await esbuild.build({
      entryPoints: [join(root, relativePath)],
      bundle: true,
      format: "esm",
      platform: "neutral",
      outfile: outFile,
      logLevel: "silent",
    });
  } catch (error) {
    console.error(`✖ failed to bundle ${relativePath}:`, error.message);
    process.exit(1);
  }
  const mod = await import(pathToFileURL(outFile).href);
  rmSync(outDir, { recursive: true, force: true });
  return mod;
}

const { LAYER_GRAPH } = await bundle("apps/web/lib/repository/layer-graph.ts", "layer-graph");
const { mathBodies, mathDelimitersBalanced } = await bundle(
  "apps/web/lib/math-text.ts",
  "math-text",
);
const { parseTheory } = await bundle("apps/web/lib/repository/theory-marks.ts", "theory-marks");

// The fields a reader sees as prose, paired with their locale sibling. The pair
// is the unit the locale rule is checked over: `null` means the field has no
// sibling and stands alone.
const PAIRS = [
  ["cost", "costJa"],
  ["conditions", "conditionsJa"],
  ["contested", "contestedJa"],
  ["whyALayer", "whyALayerJa"],
  ["summary", "summaryJa"],
];

const failures = [];
const unrecognized = [];
const census = new Map();

function note(field, value) {
  const row = census.get(field) ?? { populated: 0, withMath: 0 };
  row.populated += 1;
  if (value.includes("$")) row.withMath += 1;
  census.set(field, row);
}

/** Every string a node carries under `field`, wherever it is nested. */
function check(where, value) {
  if (!mathDelimitersBalanced(value)) {
    failures.push(`${where}: an unclosed $ — the rest of the value would typeset as one formula`);
    return;
  }
  if (value.includes("$$")) {
    failures.push(`${where}: $$ display mathematics, which cannot be drawn inside a line`);
  }
  for (const body of mathBodies(value)) {
    // **A `%` inside `$…$` is a TeX comment, and it deletes the rest of the
    // formula.** `$p_th = 0.57%$` renders as `p_th=0.57` — the percentage sign
    // and the closing delimiter are both swallowed, silently, and the sentence
    // still reads. This is the one strict warning that is a content loss rather
    // than a typographic one, so it fails rather than joining the worklist. The
    // fix is to leave the sign outside the mathematics: `$p_th = 0.57$%`.
    if (body.includes("%")) {
      failures.push(
        `${where}: a % inside $…$ is a TeX comment — it deletes the rest of the formula, including the closing $`,
      );
      continue;
    }
    try {
      katex.renderToString(body, { throwOnError: true, displayMode: false });
    } catch (error) {
      failures.push(`${where}: $${body}$ does not compile — ${error.message.split("\n")[0]}`);
      continue;
    }
    // **Compiles is not the same as written in TeX.** A conversion that wraps a
    // Unicode symbol KaTeX has no command for — `U†`, `Π̃`, `∈` — renders, and
    // renders *correctly*, so nothing above notices. But it is Unicode inside
    // maths rather than mathematics, and `U†` is the case that matters: the
    // adjoint is `U^\dagger`, a superscript, and the flat dagger the corpus
    // inherited is a typographic compromise no source made.
    //
    // Counted rather than failed, because turning `U†` into `U^\dagger` is a
    // re-authoring with the paper in hand, not a transcription — and a gate that
    // demands one before the other would block the transcription that is safe.
    // The count is the worklist.
    //
    // Every strict code, not only `unknownSymbol`. `Ĥ` reports as
    // `unicodeTextInMathMode` and `‖` additionally has no metrics in KaTeX's
    // fonts, so its width is a fallback guess — it draws, at a width nobody
    // chose. `\\hat{H}` and `\\lVert…\\rVert` are the commands for both, and
    // neither substitution round-trips, so both are worklist and not a failure.
    const warned = [];
    katex.renderToString(body, {
      throwOnError: true,
      strict: (code, message) => {
        warned.push(`${message.split("\n")[0]} [${code}]`);
        return "ignore";
      },
    });
    for (const one of warned) unrecognized.push(`${where}: ${one}`);
  }
}

for (const node of LAYER_GRAPH.nodes) {
  for (const [en, ja] of PAIRS) {
    const values = [
      [en, node[en]],
      [ja, node[ja]],
    ].filter(([, value]) => typeof value === "string" && value.trim() !== "");
    for (const [field, value] of values) {
      note(field, value);
      check(`${node.id}.${field}`, value);
    }
    // The locale rule. Only asked when both are populated: a field present in
    // one locale only is a different defect and `check-layer-graph.mjs` already
    // owns it, and asking here too would report one fault as two.
    if (values.length === 2) {
      const [[, enValue], [, jaValue]] = values;
      if (enValue.includes("$") !== jaValue.includes("$")) {
        failures.push(
          `${node.id}.${en}: mathematics was written as mathematics in ${
            enValue.includes("$") ? "en" : "ja"
          } and left as plain text in the other — the two say the same thing and must say it the same way`,
        );
      }
    }
  }
  // Hops carry the densest mathematics in the corpus and are nested a level
  // down, which is exactly where a field-name sweep stops looking.
  for (const [key, hop] of Object.entries(node.hops ?? {})) {
    const values = [
      ["theory", hop.theory],
      ["theoryJa", hop.theoryJa],
    ].filter(([, value]) => typeof value === "string" && value.trim() !== "");
    for (const [field, value] of values) {
      note(`hops.${field}`, value);
      check(`${node.id}.hops[${key}].${field}`, value);
      // **And again after the marks are split off, which is what the page
      // actually renders.** `theory` is authored with `[[approximation:…]]`
      // clauses and drawn as a run of spans, one `MathText` each. A `$…$` that
      // opened outside a clause and closed inside it balances over the whole
      // string and is unbalanced in both halves — so the value passes the check
      // above and the card draws a red formula and a stray dollar. This is the
      // only field with an inner structure, and it is the one carrying the
      // densest mathematics.
      for (const span of parseTheory(value)) {
        if (!mathDelimitersBalanced(span.text)) {
          failures.push(
            `${node.id}.hops[${key}].${field}: a $…$ crosses a [[mark:…]] boundary — balanced in the field, unbalanced in the span the card draws`,
          );
        }
      }
    }
    if (values.length === 2 && values[0][1].includes("$") !== values[1][1].includes("$")) {
      failures.push(
        `${node.id}.hops[${key}].theory: converted in one locale only`,
      );
    }
  }
}

if (failures.length > 0) {
  console.error("Mathematics in the corpus does not compile, or was converted in one locale only:");
  for (const failure of failures) console.error(`  ✖ ${failure}`);
  process.exit(1);
}

if (!QUIET) {
  console.log("check-math: the conversion census, printed with its denominator");
  for (const [field, row] of [...census].sort((a, b) => a[0].localeCompare(b[0]))) {
    const share = row.populated === 0 ? 0 : Math.round((row.withMath / row.populated) * 100);
    console.log(
      `  ${field.padEnd(16)} ${String(row.withMath).padStart(3)} of ${String(row.populated).padStart(3)} carry mathematics (${share}%)`,
    );
  }
}
if (unrecognized.length > 0) {
  console.log(
    `check-math: ${unrecognized.length} Unicode symbol(s) sit inside $…$ with no TeX command behind them — they render, and they are the next batch:`,
  );
  for (const one of [...new Set(unrecognized)].slice(0, 20)) console.log(`  · ${one}`);
}
const totals = [...census.values()].reduce(
  (sum, row) => ({ populated: sum.populated + row.populated, withMath: sum.withMath + row.withMath }),
  { populated: 0, withMath: 0 },
);
console.log(
  `check-math: OK (${totals.withMath} of ${totals.populated} populated values carry compiling mathematics; every $…$ compiles, both locales agree)`,
);
