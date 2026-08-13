#!/usr/bin/env node
// Pins the Quantum Algorithm Zoo's entry list to scripts/zoo-parity/zoo-index.json.
//
// ## Why a pinned snapshot rather than a live fetch
//
// `check-zoo-parity.mjs` runs in lint, and a checker that reaches the network is a
// checker that fails when a third-party site is slow. It is also a checker whose
// denominator moves without a commit: the Zoo is edited, an entry appears, and the
// parity number changes with nobody having decided anything. Pinning makes the
// denominator a reviewable diff — "the Zoo added Double-bracket quantum algorithms"
// shows up in a PR, not in a number that quietly got worse.
//
// This is the same argument ./check-paper-register.mjs's register makes for being
// authored rather than regenerated, one step weaker: here the upstream really is
// the authority, so a regenerate step is right — but the regeneration is a human
// action with a diff, not something a check does behind your back.
//
// Run: node scripts/generate-zoo-index.mjs
//   --url <u>   override the source (default https://quantumalgorithmzoo.org/)
//   --stdout    print the JSON instead of writing it
//
// The parse is deliberately structural (the page's own `Algorithm:` blocks and
// `<dt id=...>` reference list), so a layout change fails loudly rather than
// silently returning fewer entries.
//
// ## The floor did not do that, and here is what it cost
//
// Until 2026-08-13 the entry splitter matched the literal string
// `<b>Algorithm:</b>`, and the only guard was `MIN_ENTRIES = 40`. **The Zoo has
// 74 entries and this script pinned 60**, because 14 of them write the label as
// `<b id="abelian_HSP">Algorithm:</b>` (every entry another entry cross-links to)
// or as `<b>Algorithm: </b>`. Sixty is comfortably above forty, so nothing fired.
//
// The missing 14 were not skipped — a missed label is not a boundary, so each of
// those entries was **absorbed into the preceding entry's description and
// reference list**. The row above read bigger and the denominator read smaller,
// and both errors flatter a coverage gauge. Among the 14: Abelian Hidden
// Subgroup, Non-Abelian Hidden Subgroup, Adiabatic Algorithms (34 references) and
// Machine Learning (56) — four subject areas the parity number could not see.
//
// So the floor is not the guard any more. `assertEveryLabelParsed` is: it counts
// the page's `Algorithm:` labels **without any markup assumption** and fails
// unless the structural parse produced exactly that many entries. A floor asks
// "did we get enough?", which nobody can answer; this asks "did we get all of
// them?", which the page itself answers. MIN_ENTRIES stays as a backstop for the
// case where both counts collapse together.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(root, "scripts/zoo-parity/zoo-index.json");

/**
 * What the Zoo held when this was last run, pinned **exactly** rather than as a
 * floor, and a change in either direction fails.
 *
 * `MIN_ENTRIES = 40` used to be the guard, and 60 parsed clears 40 comfortably —
 * so the fourteen entries this script was silently dropping never tripped it. A
 * floor set far below the real value is a guard that has stopped guarding, and
 * the comment above it claiming the parse "fails loudly" was worse than no
 * comment, because it was read and believed.
 *
 * An exact pin makes the Zoo growing an edit to this line, which is the diff that
 * records it. The floor stays underneath as a backstop for the case where both
 * numbers collapse together — same convention as `DECLARED_SHARED_SOURCES` and
 * `KNOWN_TWINS` elsewhere in this repo.
 */
const DECLARED_ENTRIES = 74;
const DECLARED_ENTRY_REFERENCES = 642;
const MIN_ENTRIES = 40;

/**
 * The entry label in every spelling the page uses: optional attributes on the
 * tag (`<b id="adiabatic">`) and optional whitespace around the colon and inside
 * the element. Written once and used for both the split and the count, so the
 * two can never drift apart.
 */
const ENTRY_LABEL = String.raw`<b(?:\s[^>]*)?>\s*Algorithm\s*:\s*<\/b>`;

const args = process.argv.slice(2);
const argValue = (flag) => {
  const at = args.indexOf(flag);
  return at === -1 ? null : args[at + 1];
};
const SOURCE = argValue("--url") ?? "https://quantumalgorithmzoo.org/";

const strip = (html) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&rsquo;/g, "'")
    .replace(/&ldquo;|&rdquo;/g, '"')
    .replace(/\s+/g, " ")
    .trim();

const response = await fetch(SOURCE);
if (!response.ok) {
  console.error(`✖ ${SOURCE} returned HTTP ${response.status}`);
  process.exit(1);
}
const html = await response.text();

const sections = [...html.matchAll(/<h2 id="([^"]+)">(.*?)<\/h2>/gs)].map((match) => ({
  at: match.index ?? 0,
  id: match[1],
  title: strip(match[2]),
}));
const sectionAt = (position) => {
  let current = null;
  for (const section of sections) {
    if (section.at <= position) current = section;
    else break;
  }
  return current;
};

const references = new Map();
for (const match of html.matchAll(/<dt id="([^"]+)">(\d+)<\/dt>\s*<dd>(.*?)<\/dd>/gs)) {
  const urls = [...match[3].matchAll(/href="([^"]+)"/g)].map((href) => href[1]);
  references.set(match[1], {
    number: Number(match[2]),
    text: strip(match[3]).slice(0, 400),
    links: urls.filter((url) => url.includes("arxiv.org") || url.includes("doi.org")).slice(0, 3),
  });
}

const labelled = [...html.matchAll(new RegExp(ENTRY_LABEL, "gis"))];

/**
 * Anchor ids that name an **entry**, not a bibliography row.
 *
 * Ten entries carry `<b id="adiabatic">Algorithm:</b>` so other entries can link
 * to them, and those links land in a description's `href="#…"` list looking
 * exactly like a citation. They are not papers, and a coverage denominator that
 * counts them asks this repository to hold a record for a cross-reference.
 * Deriving the set from the labels is what keeps it correct when the Zoo adds an
 * eleventh — a hand-written list here would rot the way the split did.
 */
const entryAnchors = new Set(
  labelled.map((label) => (/\bid="([^"]+)"/.exec(label[0]) ?? [])[1]).filter(Boolean),
);

const refKind = (key) => {
  if (references.has(key)) return "paper";
  if (entryAnchors.has(key)) return "zoo-entry";
  // Cited by an entry, and the page has no anchor of that name at all. Upstream's
  // defect, recorded rather than dropped: a citation silently discarded here is
  // indistinguishable from one nobody has read.
  return "unresolved";
};

const entries = labelled.map((label, at) => {
  const from = (label.index ?? 0) + label[0].length;
  const until = at + 1 < labelled.length ? (labelled[at + 1].index ?? html.length) : html.length;
  // A section heading ends the last entry before it; the next entry starts at its
  // own label, so only the trailing edge needs trimming.
  const whole = html.slice(from, until);
  const heading = whole.search(/<h2\s/);
  const block = heading === -1 ? whole : whole.slice(0, heading);

  const name = strip((block.match(/^(.*?)<br>/s) ?? [])[1] ?? "");
  const speedup = strip((block.match(/<b(?:\s[^>]*)?>\s*Speedup\s*:\s*<\/b>(.*?)<br>/s) ?? [])[1] ?? "");
  const description = (block.match(/<b(?:\s[^>]*)?>\s*Description\s*:\s*<\/b>(.*)/s) ?? [])[1] ?? "";
  const refKeys = [...new Set([...description.matchAll(/href="#([^"]+)"/g)].map((r) => r[1]))];
  const section = sectionAt(label.index ?? 0);
  return {
    name,
    section: section?.title ?? null,
    sectionId: section?.id ?? null,
    speedup,
    // `citation`, not `key`: gitleaks' generic-api-key rule fires on a quoted
    // value sitting next to an identifier containing "key", and these values
    // ("Biasse_Song16", "Reichardt2010") are shaped exactly like a token. The
    // repo's .gitleaks.toml explains why suppressing a false positive there is a
    // last resort — renaming a field in data this script owns is the cheaper fix,
    // and it reads better anyway.
    //
    // **Not truncated.** This read `refKeys.slice(0, 8)` until 2026-08-13, which
    // is why two coverage declarations shipped saying a subject heading "lists 8
    // references": Quantum Cryptanalysis lists 23 and Polynomial Quantum Speedups
    // for CSP lists 43. A capped list is a denominator nobody chose, and it caps
    // hardest on exactly the entries broad enough to need the count.
    refs: refKeys.map((key) => ({ citation: key, kind: refKind(key), ...(references.get(key) ?? {}) })),
  };
});

/**
 * Every `Algorithm:` label on the page produced an entry.
 *
 * The count on the right makes **no markup assumption at all** — it is the bare
 * string in the stripped text. That is the point: the structural parse can only
 * be checked by something that does not share its structure. If the Zoo ever puts
 * the words "Algorithm:" in running prose this fires as a false positive, and a
 * false positive here is a human reading the page for five minutes, where the
 * false negative it replaces cost fourteen entries for an unknown number of
 * sessions.
 */
function assertEveryLabelParsed() {
  const inText = (strip(html).match(/Algorithm\s*:/g) ?? []).length;
  if (entries.length === inText) return;
  console.error(
    `✖ parsed ${entries.length} entries but the page's text contains ${inText} "Algorithm:" labels.`
    + " Some entries are being absorbed into their predecessor rather than split, which shrinks the"
    + " parity denominator and inflates the reference list of the entry above each one."
    + " Fix ENTRY_LABEL to match the spelling this parse missed — do not relax this check.",
  );
  process.exit(1);
}
assertEveryLabelParsed();

const unnamed = entries.filter((entry) => entry.name === "" || entry.speedup === "");
if (unnamed.length > 0) {
  console.error(
    `✖ ${unnamed.length} parsed entries have no name or no speedup — the block layout changed:`
    + ` ${unnamed.map((entry) => entry.name || "(unnamed)").join(", ")}`,
  );
  process.exit(1);
}

const citedReferences = entries.reduce((total, entry) => total + entry.refs.length, 0);
for (const [what, saw, pinned] of [
  ["entries", entries.length, DECLARED_ENTRIES],
  ["entry references", citedReferences, DECLARED_ENTRY_REFERENCES],
]) {
  if (saw === pinned) continue;
  console.error(
    `✖ parsed ${saw} ${what}, pinned at ${pinned}. If the Zoo really changed, update the pin in the`
    + " same commit as the snapshot so the diff says so — that is the whole point of the pin. If it did"
    + " not, the parse is dropping or duplicating something, and the count moving is the only symptom"
    + " you get. Do not relax this to a floor: a floor is what let fourteen entries go missing.",
  );
  process.exit(1);
}

if (entries.length < MIN_ENTRIES || references.size === 0) {
  console.error(
    `✖ parsed ${entries.length} entries and ${references.size} references from ${SOURCE} —`
    + ` below the floor (${MIN_ENTRIES} entries, 1 reference). The page's markup probably changed;`
    + " fix the parse rather than lowering the floor, or the parity denominator silently shrinks.",
  );
  process.exit(1);
}

const snapshot = {
  source: SOURCE,
  fetchedAt: new Date().toISOString().slice(0, 10),
  pageBytes: html.length,
  entryCount: entries.length,
  referenceCount: references.size,
  sections: sections.slice(0, 6).map((section) => section.title),
  entries,
};

if (args.includes("--stdout")) {
  console.log(JSON.stringify(snapshot, null, 1));
} else {
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(snapshot, null, 1)}\n`);
  console.log(`✓ wrote ${OUT} — ${entries.length} entries, ${references.size} references`);
}
