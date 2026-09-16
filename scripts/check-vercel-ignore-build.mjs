#!/usr/bin/env node
//
// Drives `scripts/vercel-ignore-build.sh` against a throwaway git repository
// and asserts what it decides. The script is the thing standing between this
// project and the largest single line on the Vercel bill, and until this file
// existed nothing anywhere ran it.
//
// Two properties matter more than any individual case:
//
//   * **It fails open.** Every way of not knowing the change set - no base
//     SHA, an unreadable diff, a path nobody listed - has to BUILD. A wasted
//     build costs cents; a skipped build that was needed ships a stale site.
//   * **Production never skips for a reason that is about previews.** The
//     preview rule is a positive test for the exact string `preview`, so an
//     absent or unexpected `VERCEL_ENV` lands in the path rules untouched.
//
// Run: node scripts/check-vercel-ignore-build.mjs
//
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "vercel-ignore-build.sh",
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
  ["preview, web changed, no opt-in", WEB, { ...WEB, "apps/web/app/page.tsx": "y" }, { VERCEL_ENV: "preview" }, "SKIP"],
  ["preview, project opt-in", WEB, { "apps/web/app/page.tsx": "y" }, { VERCEL_ENV: "preview", LEONA_VERCEL_PREVIEWS: "1" }, "BUILD"],
  ["preview, [preview] in message", WEB, { "apps/web/app/page.tsx": "y" }, { VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_MESSAGE: "fix: thing [preview]" }, "BUILD"],
  ["preview, [PREVIEW] uppercase", WEB, { "apps/web/app/page.tsx": "y" }, { VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_MESSAGE: "fix [PREVIEW]" }, "BUILD"],
  ["preview, opt-in but only docs changed", DOCS, { "docs/a.md": "y" }, { VERCEL_ENV: "preview", LEONA_VERCEL_PREVIEWS: "1" }, "SKIP"],
  ["preview, no base sha", WEB, { "apps/web/app/page.tsx": "y" }, { VERCEL_ENV: "preview", __NOBASE: "1" }, "SKIP"],

  ["production, web changed", WEB, { "apps/web/app/page.tsx": "y" }, { VERCEL_ENV: "production" }, "BUILD"],
  ["production, docs only", DOCS, { "docs/a.md": "y" }, { VERCEL_ENV: "production" }, "SKIP"],
  ["production, python only", PY_ONLY, { "services/api/main.py": "y" }, { VERCEL_ENV: "production" }, "SKIP"],
  ["production, contracts changed", CONTRACTS, { "packages/py/contracts/openapi.json": '{"a":1}' }, { VERCEL_ENV: "production" }, "BUILD"],
  ["production, no base sha fails open", WEB, { "apps/web/app/page.tsx": "y" }, { VERCEL_ENV: "production", __NOBASE: "1" }, "BUILD"],

  // VERCEL_ENV absent or unrecognised must behave exactly as before this rule
  // existed: the path rules decide, and nothing skips for a preview reason.
  ["VERCEL_ENV unset, web changed", WEB, { "apps/web/app/page.tsx": "y" }, {}, "BUILD"],
  ["VERCEL_ENV unset, docs only", DOCS, { "docs/a.md": "y" }, {}, "SKIP"],
  ["VERCEL_ENV=Preview (wrong case) builds", WEB, { "apps/web/app/page.tsx": "y" }, { VERCEL_ENV: "Preview" }, "BUILD"],
];

let failed = 0;
for (const [name, baseFiles, headFiles, env, expected] of cases) {
  const { dir, shas } = makeRepo([baseFiles, headFiles]);
  const full = { ...env, VERCEL_GIT_COMMIT_SHA: shas[1] };
  if (!env.__NOBASE) full.VERCEL_GIT_PREVIOUS_SHA = shas[0];
  delete full.__NOBASE;
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
