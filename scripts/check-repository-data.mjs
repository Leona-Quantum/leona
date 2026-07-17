#!/usr/bin/env node
// Validates the public repository catalog data (apps/web/lib/public-repository.ts).
// Bundles the TS data module with esbuild (resolved from the workspace), imports
// it, and asserts structural invariants so content batches cannot ship broken
// records. Also prints the slug → verification-tier/methods table so the
// classification derived for legacy entries stays reviewable.
//
// Usage: node scripts/check-repository-data.mjs [--min-entries N] [--quiet]

import { createRequire } from "node:module";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(root, "packages/ts/ui-visual/package.json"));
const esbuild = require("esbuild");

const args = process.argv.slice(2);
const minEntriesFlag = args.indexOf("--min-entries");
const MIN_ENTRIES = minEntriesFlag >= 0 ? Number(args[minEntriesFlag + 1]) : 1;
const QUIET = args.includes("--quiet");
// --entry-file <path>: validate a single batch module (its default/array export)
// in isolation — used by parallel content batches so one broken file doesn't
// block another batch's check. relatedSlugs are then checked against the union
// of the batch itself and the slugs passed via --known (comma-separated).
const entryFileFlag = args.indexOf("--entry-file");
const ENTRY_FILE = entryFileFlag >= 0 ? args[entryFileFlag + 1] : null;
const knownFlag = args.indexOf("--known");
const KNOWN_SLUGS = knownFlag >= 0 ? args[knownFlag + 1].split(",") : [];

const CATEGORIES = new Set(["gates", "algorithms", "operators", "states"]);
const STATUSES = new Set(["verified", "verified_caveats", "community_review"]);
const FRAMEWORKS = new Set(["Qiskit", "PennyLane", "Cirq", "CUDA-Q", "Amazon Braket", "OpenQASM 3.0", "PyQuil"]);
const LANGUAGES = new Set(["python", "typescript", "openqasm", "text"]);
const TONES = new Set(["accent", "ok", "warn", "neutral"]);
const SINGLE_QUBIT_GATES = new Set(["H", "X", "Y", "Z", "S", "T", "RX", "RY", "RZ"]);
const TWO_QUBIT_GATES = new Set(["CX", "CZ", "SWAP"]);
const ROTATION_GATES = new Set(["RX", "RY", "RZ"]);

const outDir = mkdtempSync(join(tmpdir(), "repo-data-"));
const outFile = join(outDir, "public-repository.mjs");
const bundleTarget = ENTRY_FILE ?? "apps/web/lib/public-repository.ts";
try {
  await esbuild.build({
    entryPoints: [join(root, bundleTarget)],
    bundle: true,
    format: "esm",
    platform: "neutral",
    outfile: outFile,
    logLevel: "silent",
  });
} catch (error) {
  console.error(`✖ failed to bundle ${bundleTarget}:`, error.message);
  process.exit(1);
}

const mod = await import(pathToFileURL(outFile).href);
rmSync(outDir, { recursive: true, force: true });

let entries;
let VERIFICATION_METHODS;
let VERIFICATION_TIERS;
let entryVerificationTier;
let getPublicRepositoryVariant;
if (ENTRY_FILE) {
  const arrays = Object.values(mod).filter(Array.isArray);
  if (arrays.length !== 1) {
    console.error(`✖ ${ENTRY_FILE} must export exactly one entries array (found ${arrays.length})`);
    process.exit(1);
  }
  entries = arrays[0];
  // Bundle the verification registry the same way (Node cannot import the .ts directly).
  const vOut = mkdtempSync(join(tmpdir(), "repo-verif-"));
  const vFile = join(vOut, "verification.mjs");
  await esbuild.build({
    entryPoints: [join(root, "apps/web/lib/repository/verification.ts")],
    bundle: true,
    format: "esm",
    platform: "neutral",
    outfile: vFile,
    logLevel: "silent",
  });
  const vMod = await import(pathToFileURL(vFile).href);
  rmSync(vOut, { recursive: true, force: true });
  VERIFICATION_METHODS = vMod.VERIFICATION_METHODS;
  VERIFICATION_TIERS = vMod.VERIFICATION_TIERS;
  entryVerificationTier = (entry) => vMod.strongestTier(entry.verificationMethods ?? []);
  for (const entry of entries) {
    if (!entry.verificationMethods?.length) {
      // Batch files must classify explicitly; derivation only covers legacy data.
      console.error(`✖ ${entry.slug}: batch entries must declare verificationMethods explicitly`);
      process.exit(1);
    }
  }
} else {
  ({ PUBLIC_REPOSITORY_ENTRIES: entries, VERIFICATION_METHODS, VERIFICATION_TIERS, entryVerificationTier, getPublicRepositoryVariant } = mod);
}
const knownMethods = new Set(VERIFICATION_METHODS.map((m) => m.id));
const errors = [];
const warnings = [];
const slugs = new Set();

function fail(slug, message) {
  errors.push(`${slug}: ${message}`);
}

const nonEmpty = (value) => typeof value === "string" && value.trim().length > 0;
const validRotationParameter = (value) => {
  const normalized = typeof value === "string" ? value.trim().replaceAll(/\s+/g, "") : "";
  if (!/^(?:(?:\d+(?:\.\d+)?\*)?pi(?:\/\d+(?:\.\d+)?)?|\d+(?:\.\d+)?)$/.test(normalized)) return false;
  const denominator = /\/(\d+(?:\.\d+)?)$/.exec(normalized);
  return !denominator || Number(denominator[1]) !== 0;
};

for (const entry of entries) {
  const slug = entry.slug ?? "<missing slug>";
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) fail(slug, "slug is not kebab-case");
  if (slugs.has(slug)) fail(slug, "duplicate slug");
  slugs.add(slug);

  for (const field of [
    "title", "titleJa", "description", "descriptionJa", "introduction", "introductionJa",
    "explanation", "explanationJa", "verification", "exportStatus", "provenance", "updatedAt",
    "categoryLabel", "categoryLabelJa", "algorithmFamily",
  ]) {
    if (!nonEmpty(entry[field])) fail(slug, `missing/empty field: ${field}`);
  }
  if (!CATEGORIES.has(entry.category)) fail(slug, `unknown category: ${entry.category}`);
  if (!STATUSES.has(entry.status)) fail(slug, `unknown status: ${entry.status}`);
  if (!FRAMEWORKS.has(entry.framework)) fail(slug, `unknown framework: ${entry.framework}`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.updatedAt ?? "")) fail(slug, `updatedAt is not YYYY-MM-DD: ${entry.updatedAt}`);
  if (!nonEmpty(entry.verificationDetails?.method)) fail(slug, "missing verificationDetails.method");
  if (!nonEmpty(entry.verificationDetails?.result)) fail(slug, "missing verificationDetails.result");

  const methods = entry.verificationMethods ?? [];
  if (!methods.length) fail(slug, "no verificationMethods after derivation");
  for (const id of methods) if (!knownMethods.has(id)) fail(slug, `unknown verification method: ${id}`);

  if (!Array.isArray(entry.tags) || !entry.tags.length) fail(slug, "no tags");
  if (!Array.isArray(entry.resources) || !entry.resources.length) fail(slug, "no resources");

  const wires = entry.visualization?.wires ?? [];
  if (!wires.length) fail(slug, "visualization has no wires");
  for (const op of entry.visualization?.operations ?? []) {
    if (!TONES.has(op.tone)) fail(slug, `operation ${op.label} has unknown tone ${op.tone}`);
    for (const q of op.qubits) {
      if (!Number.isInteger(q) || q < 0 || q >= wires.length) {
        fail(slug, `operation ${op.label} references qubit ${q} outside wires[0..${wires.length - 1}]`);
      }
    }
  }
  for (const outcome of entry.visualization?.outcomes ?? []) {
    if (typeof outcome.probability !== "number" || outcome.probability < 0 || outcome.probability > 1) {
      fail(slug, `outcome ${outcome.label} probability out of [0,1]: ${outcome.probability}`);
    }
  }

  const variants = entry.codeVariants ?? [];
  const native = variants.filter((v) => v.status === "native" && nonEmpty(v.code));
  if (!native.length) fail(slug, "no native code variant with code");
  for (const variant of variants) {
    if (!FRAMEWORKS.has(variant.framework)) fail(slug, `variant has unknown framework ${variant.framework}`);
    if (!LANGUAGES.has(variant.language)) fail(slug, `variant has unknown language ${variant.language}`);
    if (variant.status === "native" && !nonEmpty(variant.filename)) fail(slug, "native variant missing filename");
  }

  if (entry.portableCircuit) {
    const portable = entry.portableCircuit;
    if (!Number.isInteger(portable.qubitCount) || portable.qubitCount < 1) fail(slug, "portableCircuit has invalid qubitCount");
    for (const [index, step] of (portable.steps ?? []).entries()) {
      if (!["H", "X", "Y", "Z", "S", "T", "RX", "RY", "RZ", "CX", "CZ", "SWAP"].includes(step.gate)) {
        fail(slug, `portableCircuit step ${index} has unsupported gate ${step.gate}`);
      }
      if (!Array.isArray(step.qubits)) {
        fail(slug, `portableCircuit step ${index} has invalid qubits`);
        continue;
      }
      if (SINGLE_QUBIT_GATES.has(step.gate) && step.qubits.length !== 1) {
        fail(slug, `portableCircuit step ${index} gate ${step.gate} requires one qubit`);
      }
      if (TWO_QUBIT_GATES.has(step.gate) && (step.qubits.length !== 2 || step.qubits[0] === step.qubits[1])) {
        fail(slug, `portableCircuit step ${index} gate ${step.gate} requires two distinct qubits`);
      }
      if (ROTATION_GATES.has(step.gate) && !validRotationParameter(step.param)) {
        fail(slug, `portableCircuit step ${index} gate ${step.gate} has invalid rotation parameter`);
      }
      for (const qubit of step.qubits) {
        if (!Number.isInteger(qubit) || qubit < 0 || qubit >= portable.qubitCount) {
          fail(slug, `portableCircuit step ${index} references qubit ${qubit} outside width ${portable.qubitCount}`);
        }
      }
    }
    if (!ENTRY_FILE && getPublicRepositoryVariant) {
      for (const framework of FRAMEWORKS) {
        const generated = getPublicRepositoryVariant(entry, framework);
        if (generated.status === "unsupported" || !nonEmpty(generated.code)) {
          fail(slug, `portableCircuit did not generate ${framework} source`);
        }
      }
    }
  }
  const seenVariantFrameworks = new Set();
  for (const variant of variants) {
    if (seenVariantFrameworks.has(variant.framework)) fail(slug, `duplicate code variant for ${variant.framework}`);
    seenVariantFrameworks.add(variant.framework);
  }

  for (const citation of entry.literature ?? []) {
    if (!nonEmpty(citation.title) || !nonEmpty(citation.url)) fail(slug, "literature citation missing title/url");
    if (!/^https:\/\//.test(citation.url)) fail(slug, `literature url is not https: ${citation.url}`);
  }
  if (!/^https:\/\//.test(entry.source?.url ?? "")) fail(slug, `source url is not https: ${entry.source?.url}`);

  const longForm = entry.explanationMd ?? entry.explanation ?? "";
  if (longForm.length < 300) warnings.push(`${slug}: long-form explanation is short (${longForm.length} chars)`);
}

const resolvableSlugs = new Set([...slugs, ...KNOWN_SLUGS]);
for (const entry of entries) {
  for (const related of entry.relatedSlugs ?? []) {
    if (related === entry.slug) fail(entry.slug, "relatedSlugs references itself");
    if (!resolvableSlugs.has(related)) fail(entry.slug, `relatedSlugs references unknown slug: ${related}`);
  }
}

if (entries.length < MIN_ENTRIES) {
  errors.push(`catalog has ${entries.length} entries, below required minimum ${MIN_ENTRIES}`);
}

if (!QUIET) {
  const byCategory = {};
  for (const entry of entries) byCategory[entry.category] = (byCategory[entry.category] ?? 0) + 1;
  console.log(`entries: ${entries.length}  (${Object.entries(byCategory).map(([k, v]) => `${k}:${v}`).join(", ")})`);
  console.log("\nslug → tier · methods");
  for (const entry of [...entries].sort((a, b) => a.slug.localeCompare(b.slug))) {
    const tier = entryVerificationTier(entry);
    const tierInfo = VERIFICATION_TIERS.find((t) => t.tier === tier);
    console.log(`  T${tier} ${tierInfo?.glyph ?? "?"}  ${entry.slug}: ${(entry.verificationMethods ?? []).join(", ")}`);
  }
}

if (warnings.length && !QUIET) {
  console.log(`\n${warnings.length} warnings (long-form explanation < 300 chars):`);
  for (const warning of warnings) console.log(`  ⚠ ${warning}`);
}

if (errors.length) {
  console.error(`\n✖ ${errors.length} errors:`);
  for (const error of errors) console.error(`  ${error}`);
  process.exit(1);
}
console.log(`\n✓ repository data valid (${entries.length} entries)`);
