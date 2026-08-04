#!/usr/bin/env node
/**
 * A change to a blast-radius path has to be an acknowledged act, not an accident.
 *
 * ## The finding this exists because of
 *
 * `AGENTS.md` hard rule 1 says: "Blast-radius files (see `.github/CODEOWNERS`) —
 * migrations, contracts, sandbox, workflows, auth: never merged on subagent/Codex
 * authority; orchestrator/owner reviews." `plans/rebuild/05-security.md` §2 carries
 * "blast-radius CODEOWNERS active" as a release-gate box.
 *
 * Checked against the GitHub API on 2026-08-05: **CODEOWNERS has never been in force.**
 * GitHub only consults it when `required_pull_request_reviews.require_code_owner_reviews`
 * is true, and the protection objects on `dev` and on `prod` contain no
 * `required_pull_request_reviews` block at all. Everything else on those branches is
 * genuinely on — `enforce_admins`, six required checks, `strict`, conversation
 * resolution, no force-push, no deletion — which is precisely why nobody noticed: the
 * branch looks thoroughly protected, and this one file was decorative.
 *
 * ## Why the obvious fix is not available
 *
 * Turning on `require_code_owner_reviews` would block every blast-radius PR forever.
 * The sole code owner is the sole author, and GitHub refuses self-approval, so the rule
 * would be unsatisfiable by the only person who could satisfy it. This repository has
 * already learned what an unmeetable gate does: `snyk` became a required check that
 * could not pass, so it was removed from branch protection and the dependency gate
 * disappeared entirely for several sessions; and "gitleaks full-history clean" sat
 * unmeetable — and therefore unenforced — behind 83 false positives.
 *
 * So this check enforces the part that is actually enforceable by the person doing the
 * work: a blast-radius change must be *named as one* in the pull request body. That does
 * not manufacture a second reviewer. What it does is remove the failure mode that
 * matters here — a migration, a contract, a sandbox invariant or an auth path changing
 * as incidental fallout of a PR about something else, in a repo where most commits are
 * written by an agent. Making it deliberate is the enforceable half, and it lands in the
 * permanent PR record where a later reader can see the decision was taken.
 *
 * ## Paths come from CODEOWNERS, never from a list in here
 *
 * A second copy of "which paths are blast-radius" would drift from the first, and the
 * drifted copy would read as current — the same reasoning as
 * `check-workspace-inventory.mjs`. CODEOWNERS is the single source; adding a line to it
 * arms this check with no other edit.
 *
 * ## Usage
 *
 *   node scripts/check-blast-radius.mjs --base origin/dev --body "$PR_BODY"
 *   node scripts/check-blast-radius.mjs --self-test
 *
 * Acknowledge with a line in the PR body:
 *
 *   Blast-radius: adds the client-bundle secret scan to the security workflow
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CODEOWNERS = resolve(ROOT, ".github/CODEOWNERS");

/** `Blast-radius: <reason>` — the reason is required; a bare marker acknowledges nothing. */
export const ACK = /^\s*Blast-radius:\s*(\S.*)$/im;

/**
 * Owned path patterns, in CODEOWNERS order.
 *
 * Only the two forms this file actually uses are supported — a leading-slash directory
 * prefix and a leading-slash file path. A glob form would be silently mis-parsed, so it
 * raises instead: a pattern this cannot read is a pattern that would stop protecting
 * whatever it names.
 */
export function ownedPatterns(text) {
  const patterns = [];
  for (const raw of text.split("\n")) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const [pattern] = line.split(/\s+/);
    if (!pattern.startsWith("/")) {
      throw new Error(
        `check-blast-radius cannot read CODEOWNERS pattern "${pattern}": only rooted ` +
          `paths beginning with "/" are supported. Extend this parser rather than ` +
          `leaving the pattern unenforced.`,
      );
    }
    patterns.push(pattern.slice(1));
  }
  return patterns;
}

/** Changed files that fall under an owned pattern. */
export function matches(changed, patterns) {
  const hits = [];
  for (const file of changed) {
    for (const pattern of patterns) {
      const owned = pattern.endsWith("/") ? file.startsWith(pattern) : file === pattern;
      if (owned) {
        hits.push({ file, pattern });
        break;
      }
    }
  }
  return hits;
}

export function isAcknowledged(body) {
  return ACK.test(body ?? "");
}

function changedFiles(base) {
  const out = execFileSync("git", ["diff", "--name-only", `${base}...HEAD`], {
    cwd: ROOT,
    encoding: "utf8",
  });
  return out.split("\n").map((line) => line.trim()).filter(Boolean);
}

/**
 * Prove the matcher matches before believing a "nothing to declare" result.
 *
 * The dangerous failure is silent: a parser change that yields zero patterns, or a
 * prefix rule that stops matching, reports every PR clean. So each CODEOWNERS pattern
 * must demonstrably catch a file under it, and an ordinary path must demonstrably not.
 */
export function selfTest() {
  const failures = [];
  const patterns = ownedPatterns(readFileSync(CODEOWNERS, "utf8"));
  if (!patterns.length) failures.push("CODEOWNERS yielded no patterns");

  for (const pattern of patterns) {
    const probe = pattern.endsWith("/") ? `${pattern}deep/file.py` : pattern;
    if (!matches([probe], patterns).length) {
      failures.push(`pattern ${pattern} did not match ${probe}`);
    }
  }
  for (const innocuous of ["README.md", "apps/web/app/page.tsx", "packages/py/estimation/x.py"]) {
    if (matches([innocuous], patterns).length) {
      failures.push(`${innocuous} was wrongly treated as blast-radius`);
    }
  }
  // `apps/web/middleware.ts` is owned; a sibling file is not. An accidental
  // prefix match here would make most of the web app blast-radius and the check noise.
  if (matches(["apps/web/middleware.test.ts"], patterns).length) {
    failures.push("an exact-path owner matched a longer sibling path");
  }
  if (!isAcknowledged("body text\nBlast-radius: touches the sandbox image\nmore")) {
    failures.push("a valid acknowledgement was not recognised");
  }
  for (const bad of ["", "Blast-radius:", "Blast-radius:   ", "no marker here"]) {
    if (isAcknowledged(bad)) failures.push(`"${bad}" was accepted as an acknowledgement`);
  }
  return failures;
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--self-test")) {
    const failures = selfTest();
    if (failures.length) {
      console.error("blast-radius checker is broken:");
      for (const line of failures) console.error(`  - ${line}`);
      process.exit(1);
    }
    console.log("blast-radius checker self-test passed");
    return;
  }

  if (!existsSync(CODEOWNERS)) {
    console.error(
      ".github/CODEOWNERS is missing. It is the source of truth for this check and for " +
        "AGENTS.md hard rule 1; restore it rather than removing this gate.",
    );
    process.exit(1);
  }
  const baseFlag = argv.indexOf("--base");
  const base = baseFlag === -1 ? "origin/dev" : argv[baseFlag + 1];
  const bodyFlag = argv.indexOf("--body");
  const body = bodyFlag === -1 ? (process.env.PR_BODY ?? "") : argv[bodyFlag + 1];

  const patterns = ownedPatterns(readFileSync(CODEOWNERS, "utf8"));
  const hits = matches(changedFiles(base), patterns);
  if (!hits.length) {
    console.log("no blast-radius paths touched");
    return;
  }
  if (isAcknowledged(body)) {
    console.log(`blast-radius change acknowledged in the PR body (${hits.length} file(s)):`);
    for (const hit of hits) console.log(`  ${hit.file}  [${hit.pattern}]`);
    return;
  }
  console.error(`this PR changes ${hits.length} blast-radius file(s):`);
  for (const hit of hits) console.error(`  ${hit.file}  [${hit.pattern}]`);
  console.error(
    "\nAGENTS.md hard rule 1: these are never merged on subagent/Codex authority.\n" +
      "Add a line to the PR body naming the change, then re-run:\n\n" +
      "  Blast-radius: <what changes and why it is safe>\n",
  );
  process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
