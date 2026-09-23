#!/usr/bin/env node
//
// Drives `scripts/web-build-needed.sh` against a throwaway git repository
// and asserts what it decides. The script decides whether a push to `dev`
// rebuilds and redeploys the website, and until a checker existed nothing
// anywhere ran it.
//
// The property that matters more than any individual case: **it fails open.**
// Every way of not knowing the change set - no base SHA, the all-zeros base a
// new branch push reports, an unreadable diff, a path nobody listed - has to
// BUILD. A wasted build costs cents; a skipped build that was needed ships a
// stale site.
//
// Run: node scripts/check-web-build-needed.mjs
//
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "web-build-needed.sh",
);

/** A git repo with one commit per supplied file set, returned newest-last. */
function makeRepo(commits) {
  const dir = mkdtempSync(path.join(tmpdir(), "vib-"));
  const git = (...a) =>
    execFileSync("git", a, {
      cwd: dir,
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "t",
        GIT_AUTHOR_EMAIL: "t@e",
        GIT_COMMITTER_NAME: "t",
        GIT_COMMITTER_EMAIL: "t@e",
      },
    }).trim();
  git("init", "-q", "-b", "main");
  const shas = [];
  for (const files of commits) {
    for (const [f, body] of Object.entries(files)) {
      const full = path.join(dir, f);
      mkdirSync(path.dirname(full), { recursive: true });
      writeFileSync(full, body);
    }
    git("add", "-A");
    git("commit", "-q", "-m", "c", "--allow-empty");
    shas.push(git("rev-parse", "HEAD"));
  }
  return { dir, shas };
}

/** Run the script inside `dir` with `env`; returns "BUILD" or "SKIP". */
function decide(dir, env) {
  const r = spawnSync("bash", [SCRIPT], {
    cwd: dir,
    encoding: "utf8",
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      ...env,
    },
  });
  if (r.status === 1) return "BUILD";
  if (r.status === 0) return "SKIP";
  throw new Error(
    `unexpected exit ${r.status}: ${r.stdout || ""}${r.stderr || ""}`,
  );
}

const WEB = { "apps/web/app/page.tsx": "x" };
const DOCS = { "docs/a.md": "x" };
const CONTRACTS = { "packages/py/contracts/openapi.json": "{}" };
const PY_ONLY = { "services/api/main.py": "x" };

const cases = [
  // [name, base files, head files, env, expected]
  ["web changed", WEB, { "apps/web/app/page.tsx": "y" }, {}, "BUILD"],
  ["docs only", DOCS, { "docs/a.md": "y" }, {}, "SKIP"],
  ["python only", PY_ONLY, { "services/api/main.py": "y" }, {}, "SKIP"],
  ["contracts changed", CONTRACTS, { "packages/py/contracts/openapi.json": '{"a":1}' }, {}, "BUILD"],
  ["no base sha fails open", WEB, { "apps/web/app/page.tsx": "y" }, { __NOBASE: "1" }, "BUILD"],
  ["no base sha fails open even for docs", DOCS, { "docs/a.md": "y" }, { __NOBASE: "1" }, "BUILD"],
  ["all-zeros base (new branch) fails open", DOCS, { "docs/a.md": "y" }, { __ZEROBASE: "1" }, "BUILD"],
  ["unlisted top-level path builds", DOCS, { "somewhere-new/x.txt": "y" }, {}, "BUILD"],
  ["notebooks package builds (not on the list)", DOCS, { "packages/py/notebooks/x.py": "y" }, {}, "BUILD"],
  ["mcp package skips (apps/web never imports it)", DOCS, { "packages/py/mcp/src/x.py": "y" }, {}, "SKIP"],
  ["mcp package plus a web change builds", DOCS, { "packages/py/mcp/src/x.py": "y", "apps/web/app/page.tsx": "y" }, {}, "BUILD"],
  ["client package skips (apps/web never imports it)", DOCS, { "packages/py/client/src/x.py": "y" }, {}, "SKIP"],
  ["client package plus a web change builds", DOCS, { "packages/py/client/src/x.py": "y", "apps/web/app/page.tsx": "y" }, {}, "BUILD"],
];

let failed = 0;
for (const [name, baseFiles, headFiles, env, expected] of cases) {
  const { dir, shas } = makeRepo([baseFiles, headFiles]);
  const full = { ...env, WEB_BUILD_HEAD: shas[1] };
  if (env.__ZEROBASE) full.WEB_BUILD_BASE = "0000000000000000000000000000000000000000";
  else if (!env.__NOBASE) full.WEB_BUILD_BASE = shas[0];
  delete full.__NOBASE;
  delete full.__ZEROBASE;
  let got;
  try {
    got = decide(dir, full);
  } catch (e) {
    got = `ERROR(${e.message})`;
  }
  rmSync(dir, { recursive: true, force: true });
  const ok = got === expected;
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${name.padEnd(42)} expected ${expected}, got ${got}`);
}

console.log(`\n${cases.length - failed}/${cases.length} passed`);
if (failed) {
  console.error(`${failed} case(s) failed`);
  process.exit(1);
}
