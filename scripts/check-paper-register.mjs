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
// ## The third citation site, added later: `entry.source`
//
// The two loops below covered `entry.literature` and `node.citations` and *not*
// `entry.source` — which is the one field of the three that a production write
// depends on. `source` is the record's own provenance claim, it is the whole of
// what the catalog attestation hashes into `claim_hash`, and a change to
// `source.title` is what makes `AttestedRecord.grant_carries_forward` refuse to
// bind an existing human license grant to a record's new version.
//
// So the field that gates a production write was outside the lint built to keep
// exactly this kind of field right. It cost a real run: correcting nine VQE
// records' `source.title` toward this register (PR #305) made `sync-bootstrap`
// import 283, attest 274 and refuse 9, and the refusal named a re-attestation
// flag that did not yet exist. Had `source` been in here, those titles would
// have been fixed before an attestation existed to invalidate.
//
// Usage: node scripts/check-paper-register.mjs [--quiet]
//
// ## What it does not do
//
// It does not fetch anything. The register is authored data and this compares
// text to text — a gate that reached the network would fail on a bad day and
// pass on a good one, which is the opposite of a gate. Refreshing a row against
// arXiv is a deliberate edit, not a build step.

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
const byId = papers.indexPapers(PAPER_REGISTER);

// Every `entry.source.title` that disagrees with the register **today**, pinned
// to the exact wrong string, with what it should say.
//
// Why a pinned list and not a straight failure: `source` is what the catalog
// attestation hashes. Correcting these twelve titles moves twelve claim hashes,
// which turns twelve attested records into refusals needing a fresh human
// signature — the same event nine VQE records are already mid-way through. That
// is a deliberate, sequenced edit an owner makes with `--re-attest` in hand, not
// a drive-by fix, and least of all one made in the same change that first
// measured them.
//
// It cannot go stale in either direction, which is the only thing that makes a
// list like this safe (same rule `AttestationPolicy` applies to its
// `excluded_identities`): a slug whose title stops matching the pinned wrong
// string fails as a stale line, so fixing a record forces its line out of here
// in the same commit; and a *new* drift is not in the list and fails outright.
//
// Four of the twelve are pure casing. The rest are a real disagreement, and one
// is the exact failure ./papers.ts was written to kill: `cluster-state-1d` cites
// quant-ph/0010033 as "A one-way quantum computer", which is a different, real
// Raussendorf–Briegel paper. The register caught that in `literature` in PR #305
// and could not see it here.
const KNOWN_SOURCE_TITLE_DRIFT = new Map([
  ["hhl-linear-systems", "Quantum algorithm for linear systems of equations"],
  ["surface-code-memory", "The XZZX surface code"],
  [
    "iterative-phase-estimation",
    "Arbitrary accuracy iterative quantum phase estimation algorithm using a single ancilla qubit",
  ],
  ["quantum-walk-line", "Quantum walks on graphs"],
  ["cluster-state-1d", "A one-way quantum computer"],
  ["graph-state-ring", "Multiparty entanglement in graph states"],
  ["magic-t-state", "Universal quantum computation with ideal Clifford gates and noisy ancillas"],
  [
    "heisenberg-xxz-operator",
    "An Introduction to Integrable Techniques for One-Dimensional Quantum Spin Systems",
  ],
  ["parity-operator-measurement", "Quantum Computation and Quantum Information"],
  ["plus-minus-states", "Quantum Computation and Quantum Information"],
  ["noon-state", "A quantum Rosetta stone for interferometry"],
  ["maximally-mixed-state", "Quantum Computation and Quantum Information"],
]);

// A URL that is not an arXiv or DOI address is not a paper: 28 records cite the
// OpenQASM spec and 9 cite vendor documentation. Those are legitimate sources
// and the register has no remit over them. But "the register cannot key on it"
// must not become the way a *typo'd* arXiv link goes quiet, so an address that
// is plainly one of the two schemes and still fails to parse is an error.
const PAPER_SHAPED = /arxiv\.org|(^|\/)doi(\.org)?\//i;

const sourceAudit = { checked: 0, notAPaper: 0, quarantined: new Set() };
for (const entry of corpusMod.PUBLIC_REPOSITORY_ENTRIES) {
  const where = `entry:${entry.slug}`;
  const source = entry.source;
  if (!source || typeof source.url !== "string" || typeof source.title !== "string") {
    errors.push(`${where}: source is missing its title or url`);
    continue;
  }
  const id = papers.paperIdFromUrl(source.url);
  if (id === null) {
    if (PAPER_SHAPED.test(source.url)) {
      errors.push(
        `${where}: source.url ${source.url} is an arxiv.org or doi address the register cannot key on — fix the link`,
      );
    } else {
      sourceAudit.notAPaper += 1;
    }
    continue;
  }
  const paper = byId.get(id);
  if (!paper) {
    errors.push(`${where}: source.url ${source.url} is not in the register — add the row first`);
    continue;
  }
  sourceAudit.checked += 1;
  // Identity, not bytes — the one place this check is deliberately looser than
  // `auditCitations`. `canonicalPaperUrl` lowercases a DOI because that is how
  // `paperIdFromUrl` keys one, while nine records carry the publisher's
  // registered casing (`10.1103/PhysRevLett.70.1895`). Both resolve to the same
  // article and `paperIdFromUrl` has just proved they are the same row, so
  // demanding byte equality would rewrite nine `source` objects — nine moved
  // claim hashes and nine new attestation refusals — to change nothing a reader
  // or a resolver can see. The exception is narrow and checked: any difference
  // beyond case is a different address (an `/abs/` link swapped for a `/pdf/`
  // one, or a pinned `v2`) and still fails.
  if (source.url !== paper.url && source.url.toLowerCase() !== paper.url.toLowerCase()) {
    errors.push(
      `${where}: source.url is ${JSON.stringify(source.url)} — the register says ${JSON.stringify(paper.url)}`,
    );
  }
  if (source.title !== paper.title) {
    if (KNOWN_SOURCE_TITLE_DRIFT.get(entry.slug) === source.title) {
      sourceAudit.quarantined.add(entry.slug);
    } else {
      errors.push(
        `${where}: source.title is ${JSON.stringify(source.title)} — the register says ${JSON.stringify(paper.title)}`,
      );
    }
  }
}
for (const [slug, title] of KNOWN_SOURCE_TITLE_DRIFT) {
  if (sourceAudit.quarantined.has(slug)) continue;
  errors.push(
    `entry:${slug}: no longer records the known-wrong source.title ${JSON.stringify(title)} — if you fixed it, delete its line from KNOWN_SOURCE_TITLE_DRIFT (and re-attest the record)`,
  );
}

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

// Also printed under `--quiet`, and by name. This is a standing defect count on
// the field the catalog attestation hashes, and a number that only appears in
// the verbose branch is a number CI never shows.
if (sourceAudit.quarantined.size > 0) {
  console.log(
    `  ⚠ ${sourceAudit.quarantined.size} records still record a source.title the register disagrees with, held in KNOWN_SOURCE_TITLE_DRIFT:`,
  );
  for (const slug of KNOWN_SOURCE_TITLE_DRIFT.keys()) {
    if (sourceAudit.quarantined.has(slug)) console.log(`      ${slug}`);
  }
  console.log("    Fixing one moves its attestation claim hash — pair it with --re-attest.");
}

if (!QUIET) {
  const arxiv = PAPER_REGISTER.papers.filter((paper) => paper.id.startsWith("arxiv:")).length;
  console.log("paper register");
  console.log(
    `  ${PAPER_REGISTER.papers.length} papers — ${arxiv} on arXiv, ${PAPER_REGISTER.papers.length - arxiv} by DOI`,
  );
  console.log(`  ${citations.length} citations resolve, 0 drift`);
  // The third site, counted separately from `citations` on purpose: an
  // `entry.source` is a record's own provenance claim rather than a citation it
  // makes, it carries no `authors`/`year` to compare, and it is the only one of
  // the three whose text a production write hashes. Folding it into the 438
  // would hide both the different check and the different denominator.
  console.log(
    `  ${sourceAudit.checked} of ${corpusMod.PUBLIC_REPOSITORY_ENTRIES.length} records name a registered paper as their own source (${sourceAudit.notAPaper} cite a spec or vendor doc, which the register does not key)`,
  );
  // The two numbers the owner's "papers as traces" rests on. A paper cited from
  // both sides is one the Atlas and the map already agree about; the rest are
  // two bibliographies of one field that have never been joined.
  // All three, because the pair is the measurement the ingestion plan is aimed
  // at and the third is the only one that was ever written down by hand — where
  // it went wrong by one (68 for 67) within a day. The three must satisfy
  // node + entry − shared = the register size, and a reader can check that here.
  console.log(
    `  ${audit.citedByNode.length} papers are cited by the map, ${audit.citedByEntry.length} by an Atlas record, ${audit.shared.length} by both`,
  );
  // Reported, never failed. A registered paper nothing cites is the normal state
  // of an ingestion queue: read, recorded, not yet placed. See ./papers.ts.
  if (audit.uncited.length > 0) {
    console.log(`  ${audit.uncited.length} registered papers nothing cites yet`);
  }
  // What is NOT known about these papers, said out loud. `reports` is where the
  // theory/simulation/hardware distinction lives, and the three axes were
  // filled by three different rules — so they are printed as three lines. One
  // "82 of 143 read" would let `simulation`, which is open on most rows, ride
  // on `hardware`, which is decided on all of them.
  const census = papers.reportsCensus(PAPER_REGISTER);
  const bases = Object.entries(census.byBasis)
    .filter(([, count]) => count > 0)
    .map(([basis, count]) => `${count} from the ${basis}`)
    .join(", ");
  console.log(
    `  ${census.read} of ${census.papers} papers record what they report${bases ? ` — ${bases}` : ""}`,
  );
  // The denominator that actually governs the pass. `reports` is filled on the
  // map-cited papers first because they are the ones a process page shows, so
  // "82 of 143" understates the coverage of the set being worked and would
  // read as stalled when it is finished. Both numbers, neither alone.
  const mapCitedRead = audit.citedByNode.filter((id) => byId.get(id)?.reports).length;
  console.log(
    `    of the ${audit.citedByNode.length} papers a map node cites: ${mapCitedRead} read, ${audit.citedByNode.length - mapCitedRead} not`,
  );
  for (const [axis, counts] of Object.entries(census.byAxis)) {
    console.log(
      `    ${axis.padEnd(10)} ${counts.reported} reported · ${counts.absent} absent · ${counts.unknown} unknown`,
    );
  }
}

console.log(`✓ paper register valid (${PAPER_REGISTER.papers.length} papers, ${citations.length} citations)`);
