#!/usr/bin/env node
// Read a region's authored content back off a running deployment, by CONTENT.
//
// Usage:
//   node scripts/probe-region-readback.mjs
//   BASE=http://localhost:3000 SLOTS=ground-state-energy node scripts/probe-region-readback.mjs
//
// ## Why this is a script and not a paragraph in a PR body
//
// Every content PR in this repository owes a production read-back, and until now
// each one was a hand-written `curl | grep` for a phrase the author typed from
// memory. That fails in one direction only and it fails silently: the phrase you
// remember writing is not always the phrase you wrote, so the probe reports the
// page as broken when the page is fine, and the next reader learns to distrust
// probes. This board has recorded that exact false negative three times.
//
// So the phrase is never typed here. It is **extracted from the authored source
// at run time**, which makes the probe impossible to disagree with the corpus
// and makes it re-runnable after any later edit.
//
// ## What it checks
//
// For every method of the named slots, in **both locales**: each authored hop
// note, the worked-run prose, and every implementation label must appear in the
// HTML the deployment serves for that method\'s card. Cache-busted per run.
//
// ## The control arm, which runs on every invocation
//
// A probe that has never been seen to fail is not a measurement. Each request
// also looks for a **mutated** copy of one real phrase — one word replaced with
// a nonsense token — and the run fails if the page appears to contain it. That
// catches the two ways this instrument could lie: a page that echoes the query,
// and a comparison that has stopped comparing.
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const root = process.env.WT ?? "/Users/Eshaan/Developer/majorana-wt-b4-2fac2aaf";
const base = process.env.BASE ?? "https://leonaqt.com";
const require = createRequire(join(root, "packages/ts/ui-visual/package.json"));
const esbuild = require("esbuild");

async function bundle(rel, label) {
  const outDir = mkdtempSync(join(tmpdir(), "probe-"));
  const outFile = join(outDir, `${label}.mjs`);
  await esbuild.build({ entryPoints: [join(root, rel)], bundle: true, format: "esm", platform: "neutral", outfile: outFile, logLevel: "silent" });
  const mod = await import(pathToFileURL(outFile).href);
  rmSync(outDir, { recursive: true, force: true });
  return mod;
}

const { LAYER_GRAPH } = await bundle("apps/web/lib/repository/layer-graph.ts", "g");
const layers = await bundle("apps/web/lib/repository/layers.ts", "l");
const { STATE_VOCABULARY } = await bundle("apps/web/lib/repository/state-vocabulary.ts", "s");

const SLOTS = (process.env.SLOTS ?? "linear-ode-solve,hamiltonian-recasting,time-discretization,quantum-linear-solve").split(",");
const region = layers.regionClosure(LAYER_GRAPH, STATE_VOCABULARY, SLOTS, new Map());
const byId = new Map(LAYER_GRAPH.nodes.map((n) => [n.id, n]));

/**
 * The longest CONTIGUOUS plain-text run of an authored string.
 *
 * Contiguous is the whole point and the first version got it wrong: replacing
 * every `$…$` with a space and then taking the longest sentence yields a string
 * with the maths punched out of its middle, which appears nowhere in a page that
 * renders the maths as KaTeX markup. That reports a false negative about a page
 * that is fine — the exact class of error this board keeps recording.
 *
 * Candidates carrying a character HTML escapes (`'`, `"`, `&`, `<`) are dropped
 * rather than escaped here, because there is always a longer clean run.
 */
function phrase(source) {
  const runs = source
    .split(/\$[^$]*\$|\[\[[a-z]+:|\]\]/)
    .flatMap((part) => part.split(/[.,;:—()]/))
    .map((s) => s.trim())
    .filter((s) => s.length > 20 && !/[\\{}'"&<>]/.test(s) && !/\s\s/.test(s));
  return runs.sort((a, b) => b.length - a.length)[0] ?? null;
}

const stamp = Date.now();
let checks = 0;
let served = 0;
const misses = [];
// Per field, because one total hides which KIND of content is unverified — and
// the first version of this probe was verifying one lane's fields and silently
// reporting nothing about four others.
const byField = new Map();

for (const locale of ["en", "ja"]) {
  for (const id of region.methods) {
    const node = byId.get(id);
    const wanted = [];
    for (const [key, hop] of Object.entries(node.hops ?? {})) {
      const p = phrase(locale === "ja" ? hop.theoryJa : hop.theory);
      if (p) wanted.push([`hops[${key}]`, p]);
    }
    // The other four fields a reader opens a card for. Added 2026-08-12 after the
    // first version covered only what THIS lane happened to author: hop notes,
    // worked runs and implementation labels. Every other lane in the batch fills
    // `cost`, `conditions` and `pseudocode`, and none of those was being read
    // back — so a shared instrument was verifying one lane's work and quietly
    // reporting nothing about the rest.
    //
    // `pseudocode` is deliberately NOT localised (its identifiers are the
    // record's own symbols), so it is checked once rather than per locale — the
    // same block is expected on both pages, which is itself the assertion.
    for (const [field, value] of [
      ["cost", locale === "ja" ? node.costJa : node.cost],
      ["conditions", locale === "ja" ? node.conditionsJa : node.conditions],
      ["example.text", locale === "ja" ? node.example?.textJa : node.example?.text],
      ["example.pseudocode", node.example?.pseudocode],
    ]) {
      if (!value) continue;
      const p = phrase(value);
      if (p) wanted.push([field, p]);
    }
    for (const impl of node.implementations ?? []) {
      wanted.push([`implementations[${impl.id}]`, locale === "ja" ? impl.labelJa : impl.label]);
    }
    if (wanted.length === 0) continue;
    const url = `${base}/repository/layers?card=${id}&cb=${stamp}${locale}`;
    const res = await fetch(url, locale === "ja" ? { headers: { Cookie: "leona.locale.v2=ja" } } : undefined);
    const html = await res.text();
    const bad = wanted.filter(([, p]) => !html.includes(p));
    // The control arm: one real phrase with a word replaced by a token no page
    // can contain. Found means the comparison is not comparing.
    const decoy = wanted[0][1].replace(/\S+/, "zzqqxx");
    if (html.includes(decoy)) {
      console.error(`  \u2716 ${locale} ${id}: the page appears to contain a MUTATED phrase — the probe is not comparing`);
      process.exitCode = 1;
    }
    checks += wanted.length;
    served += wanted.length - bad.length;
    for (const [field] of wanted) {
      const row = byField.get(field.replace(/\[.*\]/, "[]")) ?? { checked: 0, served: 0 };
      row.checked += 1;
      byField.set(field.replace(/\[.*\]/, "[]"), row);
    }
    for (const [field] of wanted.filter(([w]) => !bad.some(([b]) => b === w))) {
      byField.get(field.replace(/\[.*\]/, "[]")).served += 1;
    }
    if (bad.length > 0) misses.push({ locale, id, bad: bad.map(([w, p]) => `${w}: ${p.slice(0, 60)}…`) });
    console.log(`${locale} ${id.padEnd(32)} ${wanted.length - bad.length}/${wanted.length}${bad.length ? "  MISSING" : ""}`);
  }
}

console.log(`\n${served}/${checks} authored fragments served by ${base}, both locales`);
for (const [field, row] of [...byField.entries()].sort()) {
  console.log(`  ${field.padEnd(24)} ${row.served}/${row.checked}`);
}
for (const m of misses) {
  console.log(`  ✖ ${m.locale} ${m.id}`);
  for (const b of m.bad) console.log(`      ${b}`);
}
process.exit(misses.length === 0 && process.exitCode !== 1 ? 0 : 1);
