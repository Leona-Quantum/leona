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

/**
 * `node: true` keeps npm dependencies EXTERNAL and targets node instead of
 * bundling everything for a neutral platform. `lib/sanitize-math.ts` imports
 * `isomorphic-dompurify`, which reaches jsdom and therefore node builtins — a
 * neutral-platform bundle of it fails to resolve `node:fs` and friends. Marking
 * packages external also means the module under test imports the SAME dependency
 * the app does, rather than a copy inlined at a different version.
 */
async function bundle(relativePath, label, { node = false } = {}) {
  // An external import resolves from where the OUTPUT sits, so a node-mode
  // bundle has to land inside the workspace or `isomorphic-dompurify` is
  // unresolvable from /var/folders. Removed in the `finally`-equivalent below
  // either way.
  const outDir = node
    ? mkdtempSync(join(root, "apps", "web", ".check-math-"))
    : mkdtempSync(join(tmpdir(), "check-math-"));
  const outFile = join(outDir, `${label}.mjs`);
  try {
    await esbuild.build({
      entryPoints: [join(root, relativePath)],
      bundle: true,
      format: "esm",
      ...(node ? { platform: "node", packages: "external" } : { platform: "neutral" }),
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
// The real sanitizer the page uses, not a copy of its config. See the
// preservation check in `check()`.
const { sanitizeMathHtml } = await bundle("apps/web/lib/sanitize-math.ts", "sanitize-math", {
  node: true,
});

// The fields a reader sees as prose, paired with their locale sibling. The pair
// is the unit the locale rule is checked over: `null` means the field has no
// sibling and stands alone.
const PAIRS = [
  ["cost", "costJa"],
  ["conditions", "conditionsJa"],
  ["contested", "contestedJa"],
  ["whyALayer", "whyALayerJa"],
  ["summary", "summaryJa"],
  // s121 (W17): a folded refinement's note on what would earn it a drawn path.
  ["potentialPath", "potentialPathJa"],
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
    // **`\%` is not a comment and must not be reported as one.** The rule was
    // `body.includes("%")`, which is right about the failure and wrong about the
    // escape: `\%` is TeX's literal percent sign, KaTeX renders it, and nothing
    // is deleted. That over-reach was invisible while this sweep looked only at
    // the top-level prose fields — the corpus happened to carry no escaped
    // percent there — and fired the moment the sweep reached `implementations`,
    // on `surface-code`'s correctly-escaped `$0.143\%$`. A gate that fails on
    // correct work teaches its next reader to delete the gate.
    //
    // Odd number of preceding backslashes = escaped. `\\%` is a line break
    // followed by a comment and is still the failure.
    const commented = [...body.matchAll(/%/g)].some((match) => {
      let slashes = 0;
      for (let at = match.index - 1; at >= 0 && body[at] === "\\"; at -= 1) slashes += 1;
      return slashes % 2 === 0;
    });
    if (commented) {
      failures.push(
        `${where}: a % inside $…$ is a TeX comment — it deletes the rest of the formula, including the closing $. Write \\% for a literal percent sign.`,
      );
      continue;
    }
    // **`\\varepsilon` is not `\varepsilon`, and it COMPILES**, which is why this
    // needs its own arm rather than being left to KaTeX. Inside `$…$`, `\\` is a
    // line break: `$\\varepsilon$` renders a newline and then the letters
    // "varepsilon" as upright text. It throws nothing, the page draws, and the
    // formula is wrong.
    //
    // Found 2026-08-12 by an authoring pass whose source strings came back
    // escaped for a TypeScript literal *and then* escaped again by the writer —
    // 2,132 sites in one commit, of which KaTeX rejected exactly **one** (a
    // `pmatrix` whose `\\begin` stopped being a command). The other 2,131 would
    // have shipped.
    //
    // A line break inside inline mathematics is meaningless anyway, so this
    // cannot fire on correct content: there is no reason to write `\\` before a
    // letter in a `$…$`. Row separators inside a `pmatrix` are `\\` followed by
    // a space or a brace and are left alone.
    const overEscaped = body.match(/(?<!\\)\\\\(?!\\)[a-zA-Z]+/g);
    if (overEscaped) {
      failures.push(
        `${where}: ${overEscaped[0]} — a doubled backslash before a command. Inside $…$ that is a line break and the command becomes upright text; it compiles and renders wrong. Write ${overEscaped[0].slice(1)}.`,
      );
      continue;
    }
    try {
      katex.renderToString(body, { throwOnError: true, displayMode: false });
    } catch (error) {
      failures.push(`${where}: $${body}$ does not compile — ${error.message.split("\n")[0]}`);
      continue;
    }
    // **The sanitizer must not eat correct output.** `components/math-text.tsx`
    // passes KaTeX's render through `lib/sanitize-math.ts` (owner ruling, ai-ops
    // 138), and the failure mode of a sanitizer is not an error — it is a page
    // that still renders with glyphs moved or the MathML tree gone. PR 668
    // proposed exactly that: an allowlist of `span`/`p` and `class`, which would
    // have scrambled every value below while every test stayed green.
    //
    // So the preservation assertion runs HERE, over the real corpus, because this
    // is the walk that already visits every `$…$` in both locales. Rendered with
    // the page's options, not this gate's, or it would check something the reader
    // never sees.
    //
    // Compared by structure rather than by bytes: DOMPurify reserializes through
    // a DOM, so a self-closing `<path … />` legitimately comes back as
    // `<path …></path>`.
    const rendered = katex.renderToString(body, {
      throwOnError: false,
      displayMode: false,
      output: "htmlAndMathml",
    });
    const sanitized = sanitizeMathHtml(rendered);
    // Normalized exactly as lib/sanitize-math.test.ts normalizes, and for the
    // same two reasons: the XML parser adds an inert xmlns to the root element,
    // and reserializing resolves character references, so `&#x27;` becomes a
    // literal apostrophe. The corpus is full of primes (P', \\varepsilon'), and
    // counting either as a loss would make this gate cry wolf on every one.
    const decode = (text) =>
      text
        .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
        .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, String.fromCharCode(34))
        .replace(/&apos;/g, String.fromCharCode(39))
        .replace(/&amp;/g, "&");
    const shape = (html) => ({
      tags: (html.match(/<[a-zA-Z][a-zA-Z0-9:-]*/g) ?? []).join(","),
      attrs: (html.match(/\s[a-zA-Z][a-zA-Z0-9-]*\s*=/g) ?? [])
        .filter((one) => !/^\s*xmlns\s*=/.test(one))
        .join(","),
      text: decode(html.replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim(),
    });
    const before = shape(rendered);
    const after = shape(sanitized);
    for (const part of ["tags", "attrs", "text"]) {
      if (before[part] !== after[part]) {
        failures.push(
          `${where}: $${body}$ renders correctly but the sanitizer in lib/sanitize-math.ts changes its ${part}. ` +
            `A sanitizer that eats KaTeX output produces a scrambled page, not an error — see PR 668. ` +
            `Widen the config there (ADD_TAGS / ADD_ATTR), do not silence this.`,
        );
        break;
      }
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
  // `example.text` and every implementation sub-section, for the reason the hop
  // block below states and this one proves twice over: **a field-name sweep
  // stops at the top level of a node**, and both of these are a level down.
  //
  // Neither was scanned until 2026-08-12, which was invisible while both were
  // empty across all 63 methods — the first `example.text` and the first
  // `implementations` entry in the graph were authored in the same commit as
  // this sweep, and they carry KaTeX densely. A worked run naming a matrix
  // family, a step size and an error budget is as full of `$…$` as any hop, and
  // an unbalanced one there renders exactly as badly.
  const nested = [];
  const example = node.example ?? {};
  nested.push([`example`, ["text", example.text], ["textJa", example.textJa]]);
  for (const implementation of node.implementations ?? []) {
    for (const field of ["about", "methods", "data", "code", "results"]) {
      nested.push([
        `implementations[${implementation.id}]`,
        [field, implementation[field]],
        [`${field}Ja`, implementation[`${field}Ja`]],
      ]);
    }
  }
  for (const [owner, [en, enValue], [ja, jaValue]] of nested) {
    const values = [
      [en, enValue],
      [ja, jaValue],
    ].filter(([, value]) => typeof value === "string" && value.trim() !== "");
    for (const [field, value] of values) {
      note(`${owner.replace(/\[.*\]/, "")}.${field}`, value);
      check(`${node.id}.${owner}.${field}`, value);
    }
    // The same locale rule the top-level pairs get: one locale typesetting a
    // formula and the other printing it as text is two different pages, not a
    // styling difference.
    if (values.length === 2 && values[0][1].includes("$") !== values[1][1].includes("$")) {
      failures.push(
        `${node.id}.${owner}.${en}: mathematics was written as mathematics in one locale and left as plain text in the other`,
      );
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
