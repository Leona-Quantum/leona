#!/usr/bin/env node
// Validates the record ↔ map-state join (apps/web/lib/repository/ingredients.ts)
// against the real corpus and the real layer graph.
//
// ## Why this is a lint script and not only a unit test
//
// Same reason `check-layer-graph.mjs` gives, and the same mechanism: the rules
// that matter here are about the *corpus*, and `public-repository.ts` reaches
// its entry modules with extensionless specifiers that `node --test` cannot
// resolve. esbuild has no such problem. So the split is: the unit test pins the
// rules that are internal to the module, this pins the ones that need the 346
// records, and **both call the same `validateIngredientJoin`** — the rules live
// in one place and cannot drift.
//
// ## What it refuses
//
// An object record that no rule claims; a record two rules claim; a join to a
// state that does not exist; **a join to a state no process consumes or
// produces**; and a rule that matches nothing. The fourth is the one this file
// exists for: a link that claims the map documents an object it does not is the
// worst thing the shelf can publish, and it is invisible to every other check.
//
// Usage: node scripts/check-ingredients.mjs [--quiet] [--audit] [--unjoined]
//
// `--audit` prints, per rule, exactly which records it claimed. That is how the
// editorial calls in the table were reviewed in the first place, and it is the
// only way to see that a tag rule has quietly started matching a record it was
// never meant to. `--unjoined` prints the abstentions grouped by reason — the
// worklist for extending the map's vocabulary, which is the honest output of
// this lane.

import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(root, "packages/ts/ui-visual/package.json"));
const esbuild = require("esbuild");

const QUIET = process.argv.includes("--quiet");
const AUDIT = process.argv.includes("--audit");
const UNJOINED = process.argv.includes("--unjoined");

async function bundle(relativePath, label) {
  const outDir = mkdtempSync(join(tmpdir(), "ingredients-"));
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

const repository = await bundle("apps/web/lib/public-repository.ts", "repository");
const ingredients = await bundle("apps/web/lib/repository/ingredients.ts", "ingredients");
const graphModule = await bundle("apps/web/lib/repository/layer-graph.ts", "graph");
const vocabularyModule = await bundle("apps/web/lib/repository/state-vocabulary.ts", "vocabulary");

const entries = repository.PUBLIC_REPOSITORY_ENTRIES;
const graph = graphModule.LAYER_GRAPH;
const vocabulary = vocabularyModule.STATE_VOCABULARY;

if (!Array.isArray(entries) || entries.length === 0) {
  console.error("✖ the published corpus is empty — nothing to join");
  process.exit(1);
}

// The projection the join reads, and nothing else. Spelling it out here rather
// than passing whole records keeps the checker honest about which fields a rule
// is allowed to see: a rule that started reading `description` would fail here
// rather than work by accident.
const candidates = entries.map((entry) => ({
  slug: entry.slug,
  title: entry.title,
  category: entry.category,
  algorithmFamily: entry.algorithmFamily,
  tags: entry.tags ?? [],
}));

const errors = ingredients.validateIngredientJoin(candidates, graph, vocabulary);
if (errors.length > 0) {
  console.error(`✖ check-ingredients: ${errors.length} problem(s)`);
  for (const error of errors) console.error(`  · ${error}`);
  process.exit(1);
}

const shelf = ingredients.buildShelf(candidates, graph, vocabulary);

if (AUDIT) {
  console.log("-- join rules, and what each one claimed --");
  for (const rule of ingredients.INGREDIENT_JOIN_RULES) {
    const claimed = candidates.filter((candidate) =>
      ingredients.joinRulesFor(candidate).includes(rule),
    );
    const key = rule.family ?? (rule.slugAny ? `slug ${rule.slugAny.join("|")}` : `tags`);
    console.log(`  ${rule.state} ← ${key} (${claimed.length})`);
    for (const candidate of claimed) console.log(`      ${candidate.slug}`);
  }
  console.log("\n-- abstention rules, and what each one claimed --");
  for (const rule of ingredients.INGREDIENT_ABSTAIN_RULES) {
    const claimed = candidates.filter((candidate) =>
      ingredients.abstainRulesFor(candidate).includes(rule),
    );
    const key = rule.family ?? (rule.slugAny ? `slug ${rule.slugAny.join("|")}` : `tags`);
    console.log(`  ${rule.reason} ← ${key} (${claimed.length})`);
    for (const candidate of claimed) console.log(`      ${candidate.slug}`);
  }
}

if (UNJOINED) {
  console.log("-- what the map cannot reach, by reason --");
  const byReason = new Map();
  for (const section of shelf.sections) {
    for (const entry of section.entries) {
      if (entry.join.kind !== "abstained") continue;
      const bucket = byReason.get(entry.join.reason) ?? [];
      bucket.push(entry.slug);
      byReason.set(entry.join.reason, bucket);
    }
  }
  for (const [reason, slugs] of [...byReason].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${reason}: ${slugs.length}`);
    for (const slug of slugs) console.log(`      ${slug}`);
  }
}

if (!QUIET || AUDIT || UNJOINED) {
  const parts = shelf.sections.map(
    (section) => `${section.role} ${section.joined}/${section.entries.length}`,
  );
  console.log(
    `check-ingredients: ${shelf.joined}/${shelf.recordDenominator} object records join a map state ` +
      `(${parts.join(" · ")}) · ${shelf.processDenominator} processes carry a contract`,
  );
}
