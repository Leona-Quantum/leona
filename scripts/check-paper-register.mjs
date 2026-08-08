#!/usr/bin/env node
// One register, both sides: every citation in the Atlas and on the map must name
// a registered paper and repeat its metadata exactly.
//
// ## Why this is its own script rather than two rules in two scripts
//
// The failure it catches is a *cross-side* one and neither existing script could
// see it. `validateLayerGraph` already refused two citations of one URL
// disagreeing **within the graph**; nothing checked the corpus at all, and
// nothing compared the two. So HHL was 2009 in the Atlas and 2008 on the map,
// Trotter error had two titles, and Nielsen & Chuang was cited 38 times under
// two URLs, three titles, two author formats and two year strings — all of it
// green.
//
// Measured before the register existed: **438 citation objects, 143 distinct
// papers, 11 of them disagreeing with themselves, and 14 recording a title that
// belongs to a different paper.**
//
// ## What it does not do
//
// It does not fetch anything. The register is authored data and this compares
// text to text — a gate that reached the network would fail on a bad day and
// pass on a good one, which is the opposite of a gate. Refreshing a row against
// arXiv is a deliberate edit, not a build step.
//
// Usage: node scripts/check-paper-register.mjs [--quiet]

import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(root, "packages/ts/ui-visual/package.json"));
const esbuild = require("esbuild");

const QUIET = process.argv.includes("--quiet");

async function bundle(relativePath, label) {
  const outDir = mkdtempSync(join(tmpdir(), "papers-"));
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

const papers = await bundle("apps/web/lib/repository/papers.ts", "papers");
const registerMod = await bundle("apps/web/lib/repository/paper-register.ts", "paper-register");
const corpusMod = await bundle("apps/web/lib/public-repository.ts", "public-repository");
const graphMod = await bundle("apps/web/lib/repository/layer-graph.ts", "layer-graph");

const { PAPER_REGISTER } = registerMod;
const errors = [...papers.validatePaperRegister(PAPER_REGISTER)];

const citations = [];
for (const entry of corpusMod.PUBLIC_REPOSITORY_ENTRIES) {
  for (const citation of entry.literature ?? []) {
    citations.push({ where: `entry:${entry.slug}`, ...citation });
  }
}
for (const node of graphMod.LAYER_GRAPH.nodes) {
  for (const citation of node.citations ?? []) {
    citations.push({ where: `node:${node.id}`, ...citation });
  }
}

const audit = papers.auditCitations(citations, PAPER_REGISTER);

for (const citation of audit.unparseable) {
  errors.push(
    `${citation.where}: ${citation.url} is neither an arxiv.org nor a doi address — the register cannot key on it`,
  );
}
for (const citation of audit.unregistered) {
  errors.push(
    `${citation.where}: ${citation.url} is not in the register — add the row first, then cite it`,
  );
}
for (const { citation, field, expected } of audit.drifted) {
  errors.push(
    `${citation.where}: ${citation.url} has ${field} ${JSON.stringify(citation[field])} — the register says ${JSON.stringify(expected)}`,
  );
}

if (errors.length > 0) {
  console.error(`✖ paper register invalid (${errors.length} ${errors.length === 1 ? "error" : "errors"})`);
  for (const error of errors.slice(0, 40)) console.error(`  - ${error}`);
  if (errors.length > 40) console.error(`  … and ${errors.length - 40} more`);
  process.exit(1);
}

// Printed whether or not `--quiet`, and never failed: a preprint registered
// beside its journal DOI is legitimate, and refusing it would block a pair a
// reader wants both halves of. See `paperRegisterWarnings`.
const warnings = papers.paperRegisterWarnings(PAPER_REGISTER);
for (const warning of warnings) console.log(`  ⚠ ${warning}`);

if (!QUIET) {
  const arxiv = PAPER_REGISTER.papers.filter((paper) => paper.id.startsWith("arxiv:")).length;
  console.log("paper register");
  console.log(
    `  ${PAPER_REGISTER.papers.length} papers — ${arxiv} on arXiv, ${PAPER_REGISTER.papers.length - arxiv} by DOI`,
  );
  console.log(`  ${citations.length} citations resolve, 0 drift`);
  // The two numbers the owner's "papers as traces" rests on. A paper cited from
  // both sides is one the Atlas and the map already agree about; the rest are
  // two bibliographies of one field that have never been joined.
  console.log(
    `  ${audit.shared.length} papers are cited from both an Atlas record and a map node`,
  );
  // Reported, never failed. A registered paper nothing cites is the normal state
  // of an ingestion queue: read, recorded, not yet placed. See ./papers.ts.
  if (audit.uncited.length > 0) {
    console.log(`  ${audit.uncited.length} registered papers nothing cites yet`);
  }
  // What is NOT known about these papers, said out loud. `reports` is where the
  // theory/simulation/hardware distinction lives, and it is empty.
  const read = PAPER_REGISTER.papers.filter((paper) => paper.reports !== undefined).length;
  console.log(
    `  ${read} of ${PAPER_REGISTER.papers.length} papers record what they report on the theory/simulation/hardware axes`,
  );
}

console.log(`✓ paper register valid (${PAPER_REGISTER.papers.length} papers, ${citations.length} citations)`);
