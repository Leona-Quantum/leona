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

// DERIVED, never restated. This line used to be
// `new Set(["gates", "algorithms", "operators", "states"])` at the top of the
// file — a fourth hand-written copy of a vocabulary whose own declaration
// comment records that two earlier copies had already drifted. The failure mode
// is silent in the worst direction: a copy that is short does not raise "this
// list is stale", it rejects every record in the missing category as
// `unknown category`, and adding `basic-circuits` would have failed 30 records
// that were correct. Derive; do not restate.
const CATEGORIES = new Set(mod.PUBLIC_REPOSITORY_CATEGORY_IDS);
if (CATEGORIES.size === 0) {
  console.error("✖ PUBLIC_REPOSITORY_CATEGORY_IDS came back empty — the bundle did not export the vocabulary");
  process.exit(1);
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
  // A reference record — an operator's representative form, a literature
  // method's ingredient list — has no native source, and claiming `native` on
  // it is what let Save-to-Library file a paragraph of English as an artifact's
  // executable code. It still has to CARRY its text; the requirement is that
  // every entry publishes something, not that everything is a circuit.
  const reference = variants.filter((v) => v.language === "text" && nonEmpty(v.code));
  if (!native.length && !reference.length) fail(slug, "no code variant with code");
  if (native.length && reference.length) {
    fail(slug, "an entry is a runnable circuit or a reference record, never both");
  }
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

// --- The closed topic vocabulary (R2) ---------------------------------------
//
// Skipped for --entry-file runs: a single batch module exports raw entries, and
// `topics` is applied by the barrel that assembles them, so there is nothing
// classified to audit there.
//
// Three properties, and the first is the one that makes the rule table safe to
// extend. A family nobody wrote a rule for produces an entry with no role, and
// a corpus quietly holding unclassified records looks exactly like a working
// one — the same failure `check-workspace-inventory` exists to stop for
// packages. The third catches an override written against a slug that has since
// been renamed, which is invisible in every other way.
if (!ENTRY_FILE) {
  // Cleanup in `finally`: a bundle or import that throws would otherwise leave
  // the temp directory behind, one per failing lint run. Applied to both blocks
  // in this file rather than only the newer one — fixing one copy of a pattern
  // and leaving its twin is how the `barrier`/two-qubit-gate bug survived three
  // sessions (D77.4).
  const topicsOut = mkdtempSync(join(tmpdir(), "repo-topics-"));
  const topicsFile = join(topicsOut, "topics.mjs");
  let topicsMod;
  try {
    await esbuild.build({
      entryPoints: [join(root, "apps/web/lib/repository/topics.ts")],
      bundle: true,
      format: "esm",
      platform: "neutral",
      outfile: topicsFile,
      logLevel: "silent",
    });
    topicsMod = await import(pathToFileURL(topicsFile).href);
  } finally {
    rmSync(topicsOut, { recursive: true, force: true });
  }
  const vocabulary = topicsMod.PUBLIC_REPOSITORY_TOPICS;
  const facetOf = new Map(vocabulary.map((topic) => [topic.id, topic.facet]));

  for (const entry of entries) {
    const topics = entry.topics ?? [];
    const unknown = topics.filter((topic) => !facetOf.has(topic));
    if (unknown.length) fail(entry.slug, `topics outside the vocabulary: ${unknown.join(", ")}`);
    const roles = topics.filter((topic) => facetOf.get(topic) === "role");
    if (roles.length !== 1) {
      fail(
        entry.slug,
        `expected exactly one role topic, got ${roles.length} [${roles.join(", ")}] ` +
          `— add a rule for algorithmFamily "${entry.algorithmFamily}" in lib/repository/topics.ts`,
      );
    }
    if (new Set(topics).size !== topics.length) fail(entry.slug, "topics contains a duplicate");
  }

  for (const slug of Object.keys(topicsMod.TOPIC_OVERRIDES ?? {})) {
    if (!slugs.has(slug)) {
      errors.push(`TOPIC_OVERRIDES names ${slug}, which the corpus does not carry`);
    }
  }

  const counts = new Map();
  let withDomain = 0;
  for (const entry of entries) {
    if ((entry.topics ?? []).some((topic) => facetOf.get(topic) === "domain")) withDomain += 1;
    for (const topic of entry.topics ?? []) counts.set(topic, (counts.get(topic) ?? 0) + 1);
  }

  // A vocabulary member no entry carries is a control offering a filter that
  // returns nothing — the free-tag problem in a new coat. One entry is honest;
  // zero is a promise the corpus cannot keep.
  const empty = vocabulary.filter((topic) => !counts.get(topic.id)).map((topic) => topic.id);
  if (empty.length) errors.push(`vocabulary members no entry carries: ${empty.join(", ")}`);

  // A ceiling, never a floor. A floor would be a target, and the honest number
  // is whatever the corpus supports. What this catches is the opposite failure:
  // rules broadened until everything has a domain, at which point `optimization`
  // tells a visitor the corpus has portfolio content because something matched.
  // See the domain note at the top of lib/repository/topics.ts.
  if (withDomain * 2 >= entries.length) {
    errors.push(
      `${withDomain} of ${entries.length} entries carry a problem domain. If that is right, ` +
        "the sparseness argument in lib/repository/topics.ts is what needs rewriting first.",
    );
  }

  if (!QUIET) {
    console.log("\ntopic → entries");
    for (const topic of vocabulary) {
      console.log(`  ${topic.facet.padEnd(6)} ${String(counts.get(topic.id) ?? 0).padStart(4)}  ${topic.id}`);
    }
    console.log(`\n${withDomain} of ${entries.length} entries carry a problem domain.`);
  }

  // --- What each entry takes and returns, and what fits it ------------------
  //
  // The properties `lib/repository-interface.test.ts` cannot assert, because
  // they are about the corpus rather than about the derivation: every entry
  // resolves to a stance, no `compatible` verdict is produced by a consumer that
  // assumes its input, and — the one that matters most — the connectable set
  // stays a minority of the catalogue.
  //
  // **The last check is a ceiling on a claim, in the same spirit as the domain
  // ceiling above.** 414 ordered pairs connect, over 38 of 283 entries; every
  // one of them is a gate primitive or a state feeding a gate primitive. If a
  // change makes most of the corpus connectable, either the corpus gained real
  // composable stages — in which case this line is the thing to rewrite, on
  // purpose — or the predicate has been loosened until a width match reads as a
  // proof, which is the failure roadmap §6 is about.
  const interfaceOut = mkdtempSync(join(tmpdir(), "repo-interface-"));
  const interfaceFile = join(interfaceOut, "interface.mjs");
  let interfaceMod;
  try {
    await esbuild.build({
      entryPoints: [join(root, "apps/web/lib/repository/interface.ts")],
      bundle: true,
      format: "esm",
      platform: "neutral",
      outfile: interfaceFile,
      logLevel: "silent",
    });
    interfaceMod = await import(pathToFileURL(interfaceFile).href);
  } finally {
    rmSync(interfaceOut, { recursive: true, force: true });
  }

  const interfaces = new Map();
  const stanceCounts = new Map();
  for (const entry of entries) {
    const derived = interfaceMod.deriveInterface({
      slug: entry.slug,
      topics: entry.topics ?? [],
      category: entry.category,
      wireCount: entry.visualization?.wires?.length ?? 0,
      portableCircuit: entry.portableCircuit,
      knownGaps: entry.knownGaps,
    });
    if (!interfaceMod.isInterfaceStance(derived.stance)) {
      fail(entry.slug, `interface stance outside the vocabulary: ${derived.stance}`);
    }
    // A port with no width would compare equal to another one and read as a
    // match between two records that state nothing.
    for (const [side, port] of [["input", derived.input], ["output", derived.output]]) {
      if (port && !(Number.isInteger(port.width) && port.width > 0)) {
        fail(entry.slug, `${side} port has a width of ${port.width}`);
      }
    }
    interfaces.set(entry.slug, derived);
    stanceCounts.set(derived.stance, (stanceCounts.get(derived.stance) ?? 0) + 1);
  }

  // A stance no record derives to is the stance version of the empty-vocabulary
  // error above, and it fails differently — worse, because `interfaceOptions`
  // already hides an uncarried stance, so the control looks correct while the
  // class is simply gone from the site.
  //
  // `declared-hole` is the reason this check exists and the reason it is not
  // vacuous. It is derived from `knownGaps[].role`, which is the only stance
  // input that is NOT free with the record — it has to be authored by somebody
  // who read a source, and it has to survive the browse-list projection. Both
  // are things a corpus repopulation or an allowlist edit can remove silently,
  // and the symptom either way is a record reading "no declared interface"
  // where it used to say which part its paper omits. One record carries it
  // today (`vqe-ssvqe`, a `readout` gap); zero means the distinction §3.6
  // exists to draw is no longer drawn anywhere.
  const uncarried = interfaceMod.INTERFACE_STANCES.filter((stance) => !stanceCounts.get(stance));
  if (uncarried.length) {
    errors.push(
      `interface stances no entry derives to: ${uncarried.join(", ")}. Either author a record ` +
        "that carries it, or remove the member — a stance nothing produces is a distinction the " +
        "site claims and never makes.",
    );
  }

  const verdicts = new Map();
  const connected = new Set();
  const meeting = new Set();
  for (const [producerSlug, producer] of interfaces) {
    for (const [consumerSlug, consumer] of interfaces) {
      if (producerSlug === consumerSlug) continue;
      const verdict = interfaceMod.connects(producer, consumer);
      verdicts.set(verdict, (verdicts.get(verdict) ?? 0) + 1);
      if (verdict === "compatible" || verdict === "unknown") {
        meeting.add(producerSlug);
        meeting.add(consumerSlug);
      }
      if (verdict === "compatible") {
        // The invariant that keeps `compatible` meaning something. Asserted over
        // the real corpus rather than trusted from the predicate, because this
        // is the exact place a loosened rule would show up first and nowhere
        // else: every other symptom of it looks like a bigger graph.
        if (consumer.assumesZeroInput) {
          errors.push(
            `${producerSlug} → ${consumerSlug} is compatible, but the consumer assumes |0…0⟩ on its input`,
          );
        }
        connected.add(producerSlug);
        connected.add(consumerSlug);
      }
    }
  }

  if (connected.size * 2 >= entries.length) {
    errors.push(
      `${connected.size} of ${entries.length} entries appear in a compatible pair. That is most of the ` +
        "corpus, and the connectable set was 38. Either real composable stages arrived — rewrite this " +
        "check and the note in lib/repository/interface.ts — or a width match is being read as a proof.",
    );
  }

  // The same ceiling one verdict wider, and it catches what the one above
  // cannot: a loosening that inflates `unknown` rather than `compatible`.
  //
  // This is not hypothetical. §3.6's declared hole was first modelled as a bare
  // flag — an edge named as missing, matched against anything with a port at
  // the other end — and one authored gap on a single record took this number
  // from 88 to 163, because the 75 entries whose port is the only one of its
  // width in the catalogue all acquired a partner. Every check above stayed
  // green: no `compatible` pair was added, no stance was wrong, and the browse
  // heading simply started saying the catalogue was twice as connected as it
  // is. `unknown` counts as *meeting* everywhere it is read, so it needs a
  // ceiling of its own.
  if (meeting.size * 2 >= entries.length) {
    errors.push(
      `${meeting.size} of ${entries.length} entries meet another entry on compatible or unknown. ` +
        "That was 88, and this number is what the browse heading publishes. `unknown` is the verdict " +
        "a loosened predicate produces first — check what a declared hole or a widened port is being " +
        "matched against before rewriting this line.",
    );
  }

  if (!QUIET) {
    console.log("\ninterface stance → entries");
    for (const stance of interfaceMod.INTERFACE_STANCES) {
      console.log(`  ${String(stanceCounts.get(stance) ?? 0).padStart(4)}  ${stance}`);
    }
    console.log(
      `\nordered pairs: ${[...verdicts].map(([verdict, count]) => `${verdict} ${count}`).join(", ")}` +
        `\n${connected.size} of ${entries.length} entries appear in at least one compatible pair.` +
        `\n${meeting.size} of ${entries.length} meet another entry at all (compatible or unknown).`,
    );
  }
}

const resolvableSlugs = new Set([...slugs, ...KNOWN_SLUGS]);
for (const entry of entries) {
  for (const related of entry.relatedSlugs ?? []) {
    if (related === entry.slug) fail(entry.slug, "relatedSlugs references itself");
    if (!resolvableSlugs.has(related)) fail(entry.slug, `relatedSlugs references unknown slug: ${related}`);
  }
}

// --- Source coverage and declared gaps (roadmap §3.6) --------------------------
//
// Three assertions and a census, and the third assertion is the one that
// matters: a three-valued field whose middle value no record ever takes is a
// field claiming a distinction it does not make.
{
  const coverageOut = mkdtempSync(join(tmpdir(), "repo-coverage-"));
  const coverageFile = join(coverageOut, "coverage.mjs");
  let coverageMod;
  try {
    await esbuild.build({
      entryPoints: [join(root, "apps/web/lib/repository/coverage.ts")],
      bundle: true,
      format: "esm",
      platform: "neutral",
      outfile: coverageFile,
      logLevel: "silent",
    });
    coverageMod = await import(pathToFileURL(coverageFile).href);
  } finally {
    rmSync(coverageOut, { recursive: true, force: true });
  }

  // 1. Every record carries an explicit, complete coverage object.
  //
  // The barrel fills this to all-`unknown`, so a record without it means the
  // default was removed or bypassed — and an absent key is dropped by
  // `canonicalize`, making it permanently indistinguishable from a record that
  // predates the field.
  for (const entry of entries) {
    if (!coverageMod.isSourceCoverage(entry.sourceCoverage)) {
      fail(entry.slug, `sourceCoverage is missing or malformed: ${JSON.stringify(entry.sourceCoverage)}`);
    }
  }

  // 2. Declared gaps are well-formed, bilingual, and actually say something.
  //
  // A gap with a two-word detail is not a declaration; it is the appearance of
  // one, in the field whose whole value is that it can be read and acted on.
  for (const entry of entries) {
    if (entry.knownGaps === undefined) continue;
    if (!coverageMod.isKnownGapList(entry.knownGaps)) {
      fail(entry.slug, "knownGaps is present but malformed");
      continue;
    }
    // The length floors live in ./coverage and are enforced by isKnownGap
    // above, so a too-short detail is already caught as "malformed". What is
    // asserted here instead is the thing a shape check cannot see: a gap that
    // is well-formed and still says nothing useful because it carries no
    // source. §3.6's rule is that an unsourced note is a guess, and the
    // renderer only ever links `citations` — so prose naming a paper with no
    // structured citation shows a reader nothing to click.
    for (const gap of entry.knownGaps) {
      if (!gap.citations?.length) {
        fail(entry.slug, `knownGaps[${gap.role}] carries no citation — an unsourced gap is a guess (§3.6)`);
      }
    }
  }

  // 3. The field is not inert.
  //
  // On the day this shipped exactly one record was informative, and that is a
  // fine place to start. Zero is not: it means every record says "nobody has
  // checked" on every axis, and a field that only ever takes one of its three
  // values is not measuring anything. This fires if the authored records are
  // dropped by a corpus repopulation — which the owner has explicitly reserved
  // the right to do — rather than letting the field quietly go blank.
  const informative = entries.filter((entry) => coverageMod.isInformative(entry.sourceCoverage));
  if (informative.length === 0) {
    errors.push(
      "no entry has any coverage axis other than `unknown`. The field is inert: it claims a " +
        "three-way distinction the corpus never makes. Either author coverage for a record from a " +
        "source somebody has actually read, or remove the field.",
    );
  }

  // 4. A ceiling, never a floor — the same shape as the problem-domain check
  // above, and for the same reason. Coverage is AUTHORED from a source somebody
  // read; it is never derived (§3.6, and the barrel comment says so). If most of
  // the corpus becomes informative, the likeliest cause is not that somebody
  // read 140 papers — it is that a derivation crept in, most likely off
  // `verificationMethods`, which answers a different question and would turn a
  // claim about Leona into a claim about a paper.
  if (informative.length * 2 >= entries.length) {
    errors.push(
      `${informative.length} of ${entries.length} entries carry authored source coverage. If that is ` +
        "genuinely authored, rewrite this check and say so. If it is derived, it is fabricating " +
        "claims about sources — see §3.6 and the barrel comment in lib/public-repository.ts.",
    );
  }

  if (!QUIET) {
    const census = coverageMod.coverageCensus(entries);
    console.log("\nsource coverage census (axis → reported / absent / unknown)");
    for (const [axis, counts] of Object.entries(census)) {
      console.log(
        `  ${axis.padEnd(11)} ${String(counts.reported).padStart(4)} / ${String(counts.absent).padStart(4)} / ${String(counts.unknown).padStart(4)}`,
      );
    }
    const gapped = entries.filter((entry) => (entry.knownGaps?.length ?? 0) > 0);
    const reviewedNone = entries.filter((entry) => entry.knownGaps?.length === 0);
    console.log(
      `\nknown gaps: ${gapped.length} entries declare one or more, ${reviewedNone.length} reviewed and declare none, ` +
        `${entries.length - gapped.length - reviewedNone.length} unreviewed.`,
    );
  }
}

// ---------------------------------------------------------------------------
// The search fallback for `algorithmFamily` (s81).
//
// The `Algorithm family` browse control was removed on a measured claim: the
// free-text box already indexes `algorithmFamily`, so typing a family's name
// still gathers its members. Measured on the 283-entry corpus at the time, no
// family lost one of its own members — 47 of 57 returned the family exactly,
// 10 a benign superset, 0 lossy.
//
// Two things can quietly falsify that later, and neither has any other symptom.
// A field can leave the haystack in `lib/repository/search.ts`, which makes 57
// values unreachable while every test still passes. Or a family can be renamed
// to something its own members' text does not contain — a family called "Misc"
// whose entries never say "misc" is invisible the moment the control is gone.
// So the claim is re-measured here against the real predicate rather than a
// copy of it: a re-implementation would agree with itself forever.
//
// A superset is fine and is not reported. Only a family that cannot gather
// itself is an error.
if (!ENTRY_FILE) {
  const searchOut = mkdtempSync(join(tmpdir(), "repo-search-"));
  const searchFile = join(searchOut, "search.mjs");
  let searchMod;
  try {
    await esbuild.build({
      entryPoints: [join(root, "apps/web/lib/repository/search.ts")],
      bundle: true,
      format: "esm",
      platform: "neutral",
      outfile: searchFile,
      logLevel: "silent",
    });
    searchMod = await import(pathToFileURL(searchFile).href);
  } finally {
    rmSync(searchOut, { recursive: true, force: true });
  }

  const byFamily = new Map();
  for (const entry of entries) {
    const list = byFamily.get(entry.algorithmFamily) ?? [];
    list.push(entry);
    byFamily.set(entry.algorithmFamily, list);
  }

  let exactFamilies = 0;
  for (const [family, members] of byFamily) {
    const hits = new Set(
      entries.filter((e) => searchMod.matchesRepositoryQuery(e, family)).map((e) => e.slug),
    );
    const unreachable = members.filter((m) => !hits.has(m.slug));
    if (unreachable.length) {
      errors.push(
        `family "${family}": searching its name misses ${unreachable.length} of its own ${members.length} ` +
          `members (${unreachable.slice(0, 3).map((m) => m.slug).join(", ")}). The family browse control was ` +
          "removed because search covered it; for this family it no longer does.",
      );
    } else if (hits.size === members.length) {
      exactFamilies += 1;
    }
  }

  if (!QUIET) {
    console.log(
      `\nfamily search fallback: ${byFamily.size} families, ${exactFamilies} resolve exactly, ` +
        `${byFamily.size - exactFamilies} to a superset, 0 lossy`,
    );
  }
}

// --- the folder navigation reaches every record --------------------------------
//
// `apps/web/lib/repository/folder-tree.ts` builds the category → family → topic tree
// the owner picked (EshMis/ai-ops#15). Its rules are unit-tested against fixtures in
// `apps/web/lib/repository-folder-tree.test.ts`; this runs the same function over the
// real corpus, which the test cannot import.
//
// **The failure it exists for is silent.** Two family names that slug to one segment
// produce a folder that renders, counts plausibly, and is missing a family; a record
// with no family or no vocabulary topic is in the browse list's 323 and in no folder
// at all. Both are refusals returned by the builder rather than exceptions, so unless
// something asserts on them nothing ever looks.
if (!ENTRY_FILE) {
  const treeOut = mkdtempSync(join(tmpdir(), "repo-folders-"));
  const treeFile = join(treeOut, "folder-tree.mjs");
  let treeMod;
  try {
    await esbuild.build({
      entryPoints: [join(root, "apps/web/lib/repository/folder-tree.ts")],
      bundle: true,
      format: "esm",
      platform: "neutral",
      outfile: treeFile,
      logLevel: "silent",
    });
    treeMod = await import(pathToFileURL(treeFile).href);
  } finally {
    rmSync(treeOut, { recursive: true, force: true });
  }

  const tree = treeMod.buildFolderTree(entries);
  for (const refusal of tree.refused) {
    errors.push(
      refusal.kind === "slug-collision"
        ? `folder tree: "${refusal.detail[0]}" and "${refusal.detail[1]}" both slug to `
          + `"${refusal.subject}" under ${refusal.category}, so one of them would have no folder. `
          + "Rename one family, or give folder-tree.ts a disambiguation rule."
        : `folder tree: ${refusal.subject} (${refusal.category}) — ${refusal.detail[0]}`,
    );
  }
  // The denominator, and the reason it is asserted rather than only printed: a tree
  // built from an empty list has no refusals either.
  if (tree.placed !== entries.length) {
    errors.push(
      `folder tree: ${tree.placed} of ${entries.length} records are reachable by browsing `
        + `(${tree.unreachable.slice(0, 5).join(", ")}${tree.unreachable.length > 5 ? ", …" : ""})`,
    );
  }
  if (!QUIET) {
    const families = tree.root.reduce((total, node) => total + node.children.length, 0);
    console.log(
      `\nfolder tree: ${tree.placed}/${entries.length} records reachable · ${tree.root.length} categories · `
        + `${families} families · ${tree.root.map((n) => `${n.segment}:${n.children.length}`).join(", ")}`,
    );
  }
}

// `basic-circuits` and the `benchmark-circuit` topic must name the SAME records.
//
// The split shipped for Stage 5 (ai-ops issue 168 §1) is not a new judgement about
// which records are elementary — it surfaces a line the data already drew and
// `map-eligibility.ts` already enforced. `MAP_ELIGIBLE_ROLES` is
// `["algorithm-reference"]`, so a record carrying `benchmark-circuit` is one the
// map refuses to anchor: *"a yardstick — a width-scaled RY-CZ ansatz is not a
// way of solving anything"*. If the two ever name different sets, one of two
// things has gone wrong and both are invisible at a reader: a benchmark filed
// under Algorithms again, or a real method filed as a basic circuit and
// silently dropped out of the map's eligible population.
//
// Checked as a two-way equality rather than as a count, because two sets can
// have the same size and different members.
{
  const filedAsBasic = new Set(
    entries.filter((entry) => entry.category === "basic-circuits").map((entry) => entry.slug),
  );
  const carriesBenchmarkRole = new Set(
    entries.filter((entry) => (entry.topics ?? []).includes("benchmark-circuit")).map((entry) => entry.slug),
  );
  for (const slug of filedAsBasic) {
    if (!carriesBenchmarkRole.has(slug)) {
      errors.push(
        `${slug}: category is basic-circuits but the record does not carry the benchmark-circuit topic. `
          + "The category is the reader-facing half of a line map-eligibility.ts already draws; "
          + "filing a method here removes it from the map's eligible population with nothing else failing.",
      );
    }
  }
  for (const slug of carriesBenchmarkRole) {
    if (!filedAsBasic.has(slug)) {
      errors.push(
        `${slug}: carries the benchmark-circuit topic but is filed under "${entries.find((e) => e.slug === slug)?.category}". `
          + "A benchmark scaffold shown beside Shor is the thing the basic-circuits split exists to stop.",
      );
    }
  }
}

// No record may carry both roles, and every algorithms/basic-circuits record
// must carry one. This is what makes the equality above a PARTITION rather than
// two independently drifting labels — the 178 records that were one category
// before Stage 5 split 148/30 with nothing in both and nothing in neither, and
// a record acquiring both roles would satisfy the check above while being
// eligible and elementary at once.
for (const entry of entries) {
  if (entry.category !== "algorithms" && entry.category !== "basic-circuits") continue;
  const topics = entry.topics ?? [];
  const isReference = topics.includes("algorithm-reference");
  const isBenchmark = topics.includes("benchmark-circuit");
  if (isReference && isBenchmark) {
    errors.push(`${entry.slug}: carries both algorithm-reference and benchmark-circuit; a record is one or the other`);
  }
  if (!isReference && !isBenchmark) {
    errors.push(`${entry.slug}: is filed under ${entry.category} but carries neither algorithm-reference nor benchmark-circuit`);
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
