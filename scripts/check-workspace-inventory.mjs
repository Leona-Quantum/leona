#!/usr/bin/env node
/**
 * The `packages/*` lines in the root AGENTS.md name the real packages. Nothing else says so.
 *
 * That file is the first thing an agent reads, and its Layout section is a prose
 * inventory maintained by hand. On 2026-08-04 it listed `packages/py/*` as "agent,
 * contracts, verification, baselines, openqasm, sandbox, llm": `frameworks` and `qpu`
 * were missing (both real, both tracked, `frameworks` is the whole Lane B surface an
 * onboarding agent is pointed at), and `baselines` did not exist at all. `packages/ts/*`
 * omitted `ui-visual`. Nothing failed. A stale inventory has no symptom — it reads as
 * current, and the cost lands on whoever trusts it.
 *
 * So the doc is checked against the filesystem rather than against a second list here.
 * A hardcoded expectation would be a third copy of the same fact and would drift too:
 * the only durable version of "which packages exist" is the directory tree.
 *
 * Membership is `pyproject.toml` / `package.json` presence, matching what uv and pnpm
 * actually resolve as workspace members. That deliberately excludes `packages/py/ir/`,
 * which is stale bytecode with no sources, no manifest, and no importer — listing it
 * would document a package that is not one.
 *
 * Usage: node scripts/check-workspace-inventory.mjs [--self-test]
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Workspace members on disk: a directory is a package when it has a manifest. */
export function actualPackages(root, group, manifest) {
  const base = join(root, "packages", group);
  if (!existsSync(base)) return [];
  return readdirSync(base, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(base, entry.name, manifest)))
    .map((entry) => entry.name)
    .sort();
}

/**
 * Names claimed by the `- \`packages/<group>/*\` — ...` bullet, which may wrap over
 * several lines and annotates entries in parentheses. Read bare identifiers only, so
 * "ui (vendored components)" contributes `ui` and not `vendored` or `components`.
 */
export function claimedPackages(agentsMd, group) {
  // Line-based on purpose. The obvious regex — a lazy `[\s\S]*?` up to the next
  // bullet — silently reads only the first line, because `$` under the `m` flag
  // matches at every line ending. It then reports the wrapped-off names as
  // undocumented packages, which is a confidently wrong failure rather than a
  // visible one.
  const lines = agentsMd.split("\n");
  const start = lines.findIndex((line) => line.startsWith(`- \`packages/${group}/*\``));
  if (start === -1) return null;

  const body = [lines[start]];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim() === "" || /^\s*- /.test(line)) break;
    body.push(line);
  }

  return [
    ...new Set(
      body
        .join("\n")
        .replace(/^- `[^`]*`\s*—/, "")
        .replace(/\([^)]*\)/g, "")
        .split(/[,\n]/)
        .map((entry) => entry.trim().replace(/^`|`$/g, ""))
        .filter((entry) => /^[a-z][a-z0-9-]*$/.test(entry)),
    ),
  ].sort();
}

export function compare(claimed, actual) {
  return {
    undocumented: actual.filter((name) => !claimed.includes(name)),
    phantom: claimed.filter((name) => !actual.includes(name)),
  };
}

const GROUPS = [
  { group: "py", manifest: "pyproject.toml" },
  { group: "ts", manifest: "package.json" },
];

function main() {
  const path = join(ROOT, "AGENTS.md");
  const agentsMd = readFileSync(path, "utf8");
  const problems = [];

  for (const { group, manifest } of GROUPS) {
    const actual = actualPackages(ROOT, group, manifest);
    const claimed = claimedPackages(agentsMd, group);
    if (claimed === null) {
      problems.push(`AGENTS.md has no \`packages/${group}/*\` bullet in its Layout section.`);
      continue;
    }
    const { undocumented, phantom } = compare(claimed, actual);
    for (const name of undocumented) {
      problems.push(`packages/${group}/${name} exists (has ${manifest}) but AGENTS.md omits it.`);
    }
    for (const name of phantom) {
      problems.push(`AGENTS.md lists packages/${group}/${name}, which has no ${manifest}.`);
    }
  }

  if (problems.length) {
    console.error("check-workspace-inventory: root AGENTS.md disagrees with the tree\n");
    for (const problem of problems) console.error(`  ${problem}`);
    console.error("\nUpdate the Layout section in AGENTS.md to match.");
    return 1;
  }
  console.error("check-workspace-inventory: AGENTS.md matches the workspace");
  return 0;
}

function selfTest() {
  const doc = [
    "## Layout",
    "",
    "- `apps/web` — Next.js App Router UI (Vercel)",
    "- `packages/py/*` — agent, contracts, frameworks, llm, openqasm, qpu, sandbox,",
    "  verification",
    "- `packages/ts/*` — ui (vendored components), ui-visual (render/diff harness),",
    "  contracts-gen (GENERATED — never hand-edit)",
    "- `db/migrations` — Alembic",
    "",
  ].join("\n");

  const cases = [
    [
      "reads a wrapped bullet and strips parenthetical annotations",
      () =>
        JSON.stringify(claimedPackages(doc, "ts")) ===
        JSON.stringify(["contracts-gen", "ui", "ui-visual"]),
    ],
    [
      "reads every name across a wrapped py bullet, and stops at the next bullet",
      () =>
        JSON.stringify(claimedPackages(doc, "py")) ===
        JSON.stringify([
          "agent",
          "contracts",
          "frameworks",
          "llm",
          "openqasm",
          "qpu",
          "sandbox",
          "verification",
        ]),
    ],
    [
      "a package present on disk but missing from the doc is undocumented",
      () => compare(["a"], ["a", "b"]).undocumented.join() === "b",
    ],
    [
      "a name in the doc with no manifest on disk is a phantom",
      () => compare(["a", "baselines"], ["a"]).phantom.join() === "baselines",
    ],
    ["a missing bullet is reported rather than read as empty", () => claimedPackages(doc, "rs") === null],
    [
      "the real tree is non-empty, so a passing run is not a vacuous one",
      () => actualPackages(ROOT, "py", "pyproject.toml").length > 0,
    ],
  ];

  let failed = 0;
  for (const [name, run] of cases) {
    const ok = run();
    if (!ok) failed += 1;
    console.error(`${ok ? "ok" : "FAIL"} — ${name}`);
  }
  return failed === 0 ? 0 : 1;
}

process.exit(process.argv.includes("--self-test") ? selfTest() : main());
