#!/usr/bin/env node
// Every corpus record's `source.kind` must be one the committed attestation
// policy covers — checked at merge time, not at deploy time.
//
// ## The failure this exists to stop, and why the existing guard is not enough
//
// `AttestationPolicy` is already fail-closed in both directions: a record it
// neither includes nor explicitly excludes raises `policy covers neither
// inclusion nor exclusion for: …` and the run stops. That is the right last line
// of defence and the wrong only one, because of *where* it fires.
//
// It fires inside `sync-bootstrap`, which runs on the **deploy**, after merge and
// after review, against the production database, from inside a deployment
// boundary nobody can reach from a laptop. And it does not fail one record — the
// whole run stops, so **no** record publishes. One record authored with an
// unconsidered `source.kind` therefore takes the entire corpus off the browse
// listing until someone with production access notices and reverts.
//
// Measured 2026-08-13: all 347 records were `curated_reference`, and the policy
// covers exactly `curated_reference` and `verified_run`. So the blast radius of a
// third value was the whole corpus, and nothing before this file could see it.
//
// This check turns that into a red check on the one PR that caused it.
//
// ## Why it reads the policy file instead of naming the two kinds
//
// A hardcoded pair is a second copy of the rule, and the copy is wrong the day
// the policy changes — which is exactly the drift the policy's own fail-closed
// design exists to prevent. So the allowed set is read from
// `attestation-policy.json` at run time. If the policy gains a kind, this check
// gains it in the same commit and nobody has to remember.
//
// Usage: node scripts/check-attestation-coverage.mjs [--quiet]

import { createRequire } from "node:module";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(root, "packages/ts/ui-visual/package.json"));
const esbuild = require("esbuild");

const QUIET = process.argv.includes("--quiet");
const POLICY = "services/api/catalog_bootstrap/attestation-policy.json";

async function bundle(relativePath, label) {
  const outDir = mkdtempSync(join(tmpdir(), "attest-"));
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

let policy;
try {
  policy = JSON.parse(readFileSync(join(root, POLICY), "utf8"));
} catch (error) {
  console.error(`✖ cannot read ${POLICY}: ${error.message}`);
  process.exit(1);
}

// Fail loudly rather than defaulting. A policy that has lost its
// `include_source_kinds` must not silently permit everything, which is what an
// `?? []` or an `?? ALL` would do here.
const included = policy.include_source_kinds;
if (!Array.isArray(included) || included.length === 0 ||
    !included.every((k) => typeof k === "string" && k.length > 0)) {
  console.error(`✖ ${POLICY}: include_source_kinds must be a non-empty list of strings`);
  process.exit(1);
}
const allowed = new Set(included);
const excluded = new Set(Object.keys(policy.excluded_identities ?? {}));

const corpusMod = await bundle("apps/web/lib/public-repository.ts", "public-repository");
const entries = corpusMod.PUBLIC_REPOSITORY_ENTRIES;

const errors = [];
const byKind = new Map();
let checked = 0;
for (const entry of entries) {
  const kind = entry.source?.kind;
  // An excluded identity is a deliberate, committed decision that this record is
  // outside the grant. The policy does not judge its kind, so neither does this.
  if (excluded.has(entry.slug)) continue;
  checked += 1;
  byKind.set(kind, (byKind.get(kind) ?? 0) + 1);
  if (typeof kind !== "string" || !allowed.has(kind)) {
    errors.push(
      `entry:${entry.slug}: source.kind ${JSON.stringify(kind)} is not covered by ${POLICY} ` +
        `(it lists ${[...allowed].map((k) => JSON.stringify(k)).join(", ")}). ` +
        `This does NOT fail one record at deploy time — AttestationPolicy stops the whole ` +
        `sync-bootstrap run, so NO record publishes and the entire corpus leaves the browse ` +
        `listing. Use a covered kind, or extend the policy deliberately and re-attest.`,
    );
  }
}

if (!QUIET) {
  console.log("attestation policy coverage");
  console.log(`  ${checked} records checked against ${POLICY}`);
  console.log(`  policy covers: ${[...allowed].join(", ")}`);
  if (excluded.size > 0) console.log(`  explicitly excluded: ${excluded.size}`);
  for (const [kind, n] of [...byKind].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${kind}: ${n}`);
  }
}

if (errors.length > 0) {
  console.error("✖ attestation policy coverage");
  for (const line of errors) console.error(`  - ${line}`);
  process.exit(1);
}
console.log(`✓ every record's source.kind is covered by the attestation policy (${checked} records)`);
