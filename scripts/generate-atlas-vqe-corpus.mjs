#!/usr/bin/env node
// Generate (or --check) the static Atlas VQE corpus bundle the public
// /repository page's VQE section reads (ADR-0027).
//
// Source of truth is docs/atlas/corpus/{papers,repositories,comparisons}/*.json
// (Phase 2, ADR-0026 machine-validated corpus). This script never edits those
// files; it only projects them into one deterministic, committed JSON bundle
// apps/web can `import` statically (Next.js bundles a static JSON import
// correctly for both `next dev` and a Vercel build; a raw runtime `fs.readFile`
// reaching outside apps/web would not survive Vercel's output file tracing
// without extra config this repo does not have yet).
//
// The bundle carries no wall-clock timestamp or git SHA: both would make
// --check spuriously fail on every rerun regardless of content, defeating the
// point of a content-drift check. It is a pure function of the corpus files.
//
// Usage:
//   node scripts/generate-atlas-vqe-corpus.mjs [--out <path>]
//   node scripts/generate-atlas-vqe-corpus.mjs --check [--out <path>]

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const CORPUS_ROOT = join(root, "docs/atlas/corpus");
const DEFAULT_OUT = join(root, "apps/web/lib/atlas-vqe/corpus-data.generated.json");

const args = process.argv.slice(2);
const CHECK = args.includes("--check");
function flag(name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
}
const OUT = flag("--out") ?? DEFAULT_OUT;

function readJsonDir(dirName, idField) {
  const dir = join(CORPUS_ROOT, dirName);
  const files = readdirSync(dir).filter((name) => name.endsWith(".json"));
  const records = files.map((name) => JSON.parse(readFileSync(join(dir, name), "utf8")));
  records.sort((a, b) => String(a[idField]).localeCompare(String(b[idField])));
  return records;
}

function buildBundle() {
  return {
    schema_version: "0.2.0",
    papers: readJsonDir("papers", "paper_id"),
    repositories: readJsonDir("repositories", "repo_id"),
    comparisons: readJsonDir("comparisons", "comparison_id"),
  };
}

function serialize(bundle) {
  return `${JSON.stringify(bundle, null, 2)}\n`;
}

function main() {
  const bundle = buildBundle();
  const serialized = serialize(bundle);

  if (CHECK) {
    let existing;
    try {
      existing = readFileSync(OUT, "utf8");
    } catch {
      console.error(`atlas-vqe-corpus: ${OUT} does not exist -- run without --check to generate it`);
      process.exit(1);
    }
    if (existing !== serialized) {
      console.error(`atlas-vqe-corpus: ${OUT} is stale -- run 'node scripts/generate-atlas-vqe-corpus.mjs'`);
      process.exit(1);
    }
    console.log(
      `atlas-vqe-corpus: OK (${bundle.papers.length} papers, ${bundle.repositories.length} repositories, ${bundle.comparisons.length} comparisons)`
    );
    return;
  }

  writeFileSync(OUT, serialized);
  console.log(
    `atlas-vqe-corpus: wrote ${OUT} (${bundle.papers.length} papers, ${bundle.repositories.length} repositories, ${bundle.comparisons.length} comparisons)`
  );
}

main();
