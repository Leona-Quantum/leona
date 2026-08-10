#!/usr/bin/env node
// Conversion-time harness, not a shipped gate.
//
// Checks that wrapping mathematics in `$…$` changed the *typesetting* and not
// the *claim*: de-TeX the converted string with a fixed inverse table and it
// must reproduce the original character for character, up to whitespace.
//
//   node roundtrip.mjs original.json converted.json
//
// Fails a row when de-TeXing leaves a `\command` the table does not know — that
// is the shape of an invented symbol, and it is the failure this whole exercise
// is guarding against.

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const katex = createRequire("/Users/Eshaan/Developer/majorana/apps/web/package.json")("katex");

// TeX → what the corpus already wrote. Order matters: longest first, so
// `\varepsilon` is not eaten by a prefix.
const INVERSE = [
  // `\\left`/`\\right` MUST precede `\\le`, which is a prefix of both: the table is
  // applied in array order, so `\\left(` de-TeXed to `≤ft(` before this line existed.
  ["\\left", ""],
  ["\\right", ""],
  ["\\varepsilon", "ε"],
  ["\\epsilon", "ε"],
  ["\\mathrm{poly}", "poly"],
  ["\\mathrm{polylog}", "polylog"],
  ["\\operatorname{poly}", "poly"],
  ["\\tilde{O}", "Õ"],
  ["\\widetilde{O}", "Õ"],
  ["\\kappa", "κ"],
  ["\\lambda", "λ"],
  ["\\Lambda", "Λ"],
  ["\\alpha", "α"],
  ["\\beta", "β"],
  ["\\gamma", "γ"],
  ["\\delta", "δ"],
  ["\\Delta", "Δ"],
  ["\\eta", "η"],
  ["\\theta", "θ"],
  ["\\Theta", "Θ"],
  ["\\mu", "µ"],
  ["\\nu", "ν"],
  ["\\pi", "π"],
  ["\\rho", "ρ"],
  ["\\sigma", "σ"],
  ["\\Sigma", "Σ"],
  ["\\tau", "τ"],
  ["\\phi", "φ"],
  ["\\psi", "ψ"],
  ["\\Psi", "Ψ"],
  ["\\omega", "ω"],
  ["\\Omega", "Ω"],
  ["\\dagger", "†"],
  ["\\otimes", "⊗"],
  ["\\langle", "⟨"],
  ["\\rangle", "⟩"],
  ["\\leq", "≤"],
  ["\\le", "≤"],
  ["\\geq", "≥"],
  ["\\ge", "≥"],
  ["\\neq", "≠"],
  ["\\approx", "≈"],
  ["\\sim", "∼"],
  ["\\times", "×"],
  ["\\cdot", "·"],
  ["\\ldots", "…"],
  ["\\dots", "…"],
  ["\\infty", "∞"],
  // Added session 118. `\cos`, `\sin`, `\deg` and `\Phi` are TRUE inverses — KaTeX
  // renders each as exactly the text on the right — so adding them widens what the
  // harness can verify rather than weakening what it rejects. `\Phi` was the one
  // omission that made a correct conversion look like an invented symbol.
  ["\\Phi", "Φ"],
  ["\\cos", "cos"],
  ["\\sin", "sin"],
  ["\\deg", "deg"],
  ["\\log", "log"],
  ["\\ln", "ln"],
  ["\\min", "min"],
  ["\\max", "max"],
  ["\\exp", "exp"],
  ["\\sqrt", "sqrt"],
  ["\\,", " "],
  ["\\;", " "],
  ["\\ ", " "],
  ["\\!", ""],
  ["\\left", ""],
  ["\\right", ""],
];

function deTeX(body) {
  let out = body;
  for (const [tex, plain] of INVERSE) out = out.split(tex).join(plain);
  return out;
}

/** The converted string with its mathematics turned back into what was there. */
function unwrap(converted) {
  let out = "";
  let at = 0;
  while (at < converted.length) {
    if (converted[at] !== "$") {
      out += converted[at];
      at += 1;
      continue;
    }
    const end = converted.indexOf("$", at + 1);
    if (end < 0) return { out: null, reason: "unclosed $" };
    out += deTeX(converted.slice(at + 1, end));
    at = end + 1;
  }
  return { out, reason: null };
}

const squash = (value) => value.replace(/\s+/gu, " ").trim();

const original = JSON.parse(readFileSync(process.argv[2], "utf8"));
const converted = JSON.parse(readFileSync(process.argv[3], "utf8"));

let ok = 0;
const failures = [];
for (const [id, fields] of Object.entries(converted)) {
  for (const [field, value] of Object.entries(fields)) {
    const before = original[id]?.[field];
    if (typeof before !== "string") {
      failures.push(`${id}.${field}: no original to compare against`);
      continue;
    }
    const { out, reason } = unwrap(value);
    if (out === null) {
      failures.push(`${id}.${field}: ${reason}`);
      continue;
    }
    const leftover = out.match(/\\[a-zA-Z]+/gu);
    if (leftover) {
      failures.push(`${id}.${field}: unknown command(s) survived de-TeX — ${[...new Set(leftover)].join(", ")}`);
      continue;
    }
    if (squash(out) !== squash(before)) {
      const a = squash(before);
      const b = squash(out);
      let i = 0;
      while (i < Math.min(a.length, b.length) && a[i] === b[i]) i += 1;
      failures.push(
        `${id}.${field}: the claim changed\n      was: …${a.slice(Math.max(0, i - 40), i + 40)}…\n      got: …${b.slice(Math.max(0, i - 40), i + 40)}…`,
      );
      continue;
    }
    // And it has to compile, which is the shipped gate's job but is cheaper to
    // learn here than in CI.
    let compiles = true;
    for (const match of value.matchAll(/\$([^$]+)\$/gu)) {
      try {
        katex.renderToString(match[1], { throwOnError: true });
      } catch (error) {
        failures.push(`${id}.${field}: $${match[1]}$ — ${error.message.split("\n")[0]}`);
        compiles = false;
      }
    }
    if (compiles) ok += 1;
  }
}

console.log(`round-trip: ${ok} of ${Object.values(converted).reduce((n, f) => n + Object.keys(f).length, 0)} values reproduce their original exactly`);
for (const failure of failures) console.log(`  ✖ ${failure}`);
process.exit(failures.length > 0 ? 1 : 0);
