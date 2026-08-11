#!/usr/bin/env node
// Pins the Classiq library's publication list to scripts/classiq-parity/classiq-index.json.
//
// The sibling of `generate-zoo-index.mjs`, and pinned for the same two reasons: a
// lint-time checker must not depend on a third-party host being up, and a
// denominator that moves without a commit is a number nobody decided. See that
// file's header for the full argument.
//
// ## What counts as one Classiq entry
//
// **A directory, not a file.** The library publishes each demo as a folder holding
// `x.qmod`, `x.ipynb`, `x.metadata.json` and `x.synthesis_options.json` together —
// measured 2026-08-03 over a depth-1 clone (Projects/Majorana/plans/
// classiq-library-study.md). Counting files would multiply every entry by four and
// counting notebooks alone would drop the qmod-only ones, so the unit is the
// directory that contains either.
//
// Only `algorithms/` and `applications/` are counted. `tutorials/` is pedagogy for
// the Qmod language and `functions/` is the library's own building blocks; neither
// is a catalog entry in the sense "does our repository carry this algorithm", and
// including them would inflate the denominator with things nothing could cover.
// That exclusion is a judgement, so it is stated here and recorded in the snapshot
// under `excludedTops` rather than left implicit in a filter.
//
// Run: node scripts/generate-classiq-index.mjs
//   --stdout   print the JSON instead of writing it
//   --repo <owner/name>   override the source repository
//
// Uses GITHUB_TOKEN / GH_TOKEN if either is set — unauthenticated GitHub API is
// rate-limited to 60 requests an hour, and this script makes two.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(root, "scripts/classiq-parity/classiq-index.json");
const COUNTED_TOPS = ["algorithms", "applications"];
const EXCLUDED_TOPS = ["tutorials", "functions"];
const MIN_ENTRIES = 60;

const args = process.argv.slice(2);
const argValue = (flag) => {
  const at = args.indexOf(flag);
  return at === -1 ? null : args[at + 1];
};
const REPO = argValue("--repo") ?? "Classiq/classiq-library";

const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? null;
async function api(path) {
  const response = await fetch(`https://api.github.com/repos/${REPO}${path}`, {
    headers: {
      accept: "application/vnd.github+json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!response.ok) {
    console.error(
      `✖ GET ${path} returned HTTP ${response.status}`
      + (response.status === 403 ? " — unauthenticated GitHub API is 60/hour; set GITHUB_TOKEN" : ""),
    );
    process.exit(1);
  }
  return response.json();
}

// Resolve the branch to a commit first, then read the tree AT that commit: a
// snapshot that says "main" names nothing a year from now, and this file's whole
// job is to be a fixed denominator.
const head = await api("/commits/HEAD");
const tree = await api(`/git/trees/${head.sha}?recursive=1`);
if (tree.truncated) {
  console.error("✖ GitHub truncated the tree listing — the entry list would be silently short");
  process.exit(1);
}

const byDirectory = new Map();
for (const node of tree.tree) {
  if (node.type !== "blob") continue;
  const parts = node.path.split("/");
  if (!COUNTED_TOPS.includes(parts[0]) || parts.length < 2) continue;
  if (!node.path.endsWith(".qmod") && !node.path.endsWith(".ipynb")) continue;
  const directory = parts.slice(0, -1).join("/");
  if (!byDirectory.has(directory)) {
    byDirectory.set(directory, {
      path: directory,
      category: parts[0],
      // The path between the category and the entry — "finance", "chemistry",
      // "quantum_linear_solvers". Classiq's own shelving, kept because it is the
      // axis a reader asks coverage questions along.
      group: parts.length > 2 ? parts.slice(1, -1).join("/") : null,
      name: parts[parts.length - 2],
      files: [],
    });
  }
  byDirectory.get(directory).files.push(parts[parts.length - 1]);
}

const entries = [...byDirectory.values()].sort((a, b) => a.path.localeCompare(b.path));
for (const entry of entries) entry.files.sort();

if (entries.length < MIN_ENTRIES) {
  console.error(
    `✖ parsed ${entries.length} publication directories from ${REPO} — below the floor`
    + ` (${MIN_ENTRIES}). The repository's layout probably changed; fix the walk rather than`
    + " lowering the floor, or the parity denominator silently shrinks.",
  );
  process.exit(1);
}

const snapshot = {
  source: `https://github.com/${REPO}`,
  commit: head.sha,
  commitDate: head.commit?.committer?.date ?? null,
  fetchedAt: new Date().toISOString().slice(0, 10),
  countedTops: COUNTED_TOPS,
  excludedTops: EXCLUDED_TOPS,
  entryCount: entries.length,
  byCategory: Object.fromEntries(
    COUNTED_TOPS.map((top) => [top, entries.filter((entry) => entry.category === top).length]),
  ),
  entries,
};

if (args.includes("--stdout")) {
  console.log(JSON.stringify(snapshot, null, 1));
} else {
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(snapshot, null, 1)}\n`);
  console.log(
    `✓ wrote ${OUT} — ${entries.length} publication directories at ${head.sha.slice(0, 8)}`,
  );
}
