#!/usr/bin/env node
/**
 * What blocks each open PR, and which of them will fight each other on merge.
 *
 * `dev` is production and protection is strict, so a merge here is a queue with exactly
 * one server. Whoever holds that queue answers the same two questions per PR, and this
 * board has paid for every wrong answer at least once:
 *
 *   1. **Why is it not mergeable?** Four blockers look identical from `gh pr view` and
 *      none of them announces itself: a DRAFT (no check says so — `gh pr merge` just
 *      refuses); a required check that never dispatched (`gitleaks`/`db` sat blank on
 *      #405 for fifteen minutes, and a job can sit `queued` under a run whose conclusion
 *      is already `success` — #409); unresolved review threads behind a CodeRabbit check
 *      that is itself green (`required_conversation_resolution` blocks on the threads,
 *      not the check); and plain BEHIND, which strict protection turns into a blocker
 *      after every landing.
 *   2. **Whose branch do I break by merging this one?** Lane territory is a claim; the
 *      changed-file list is the fact. Overlap is measured here so merge order is a
 *      decision rather than a hope.
 *
 * Required contexts are read from branch protection rather than hardcoded, so this does
 * not become a second copy of that list that drifts from the first.
 *
 * Usage: node scripts/pr-queue.mjs [--base dev] [--self-test]
 */

import { execFileSync } from "node:child_process";

const GREEN = new Set(["SUCCESS", "NEUTRAL", "SKIPPED"]);
const THREADS_QUERY = `
query($owner:String!, $name:String!, $number:Int!) {
  repository(owner:$owner, name:$name) {
    pullRequest(number:$number) {
      reviewThreads(first:100) { nodes { isResolved comments(first:1) { nodes { author { login } } } } }
    }
  }
}`;

function gh(args) {
  return execFileSync("gh", args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
}

/**
 * `gh api repos/{owner}/{repo}/…` makes gh resolve the placeholder itself, and on this
 * machine that took 4m36s for one call while the same call with the repo spelled out
 * returned instantly. So the repo is resolved once, locally, from the remote.
 */
export function repoFromRemote(url) {
  const match = url.trim().match(/[:/]([^/:]+)\/([^/]+?)(?:\.git)?$/);
  return match ? `${match[1]}/${match[2]}` : null;
}

const REPO =
  repoFromRemote(execFileSync("git", ["remote", "get-url", "origin"], { encoding: "utf8" })) ??
  "EshMis/majorana";

/** CODEOWNERS is the only list of blast-radius paths; a second copy here would drift. */
export function codeownerPaths(text) {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => line.split(/\s+/)[0].replace(/^\//, ""))
    .filter(Boolean);
}

/**
 * Every reason this PR cannot merge right now, in the order they bite. Pure: it takes
 * the facts and returns strings, so `--self-test` can drive every branch without a
 * network. An empty list means READY — and "BLOCKED with nothing found" deliberately
 * returns an UNKNOWN line rather than READY, because a steward who acts on a wrong
 * READY discovers it by a failed merge.
 */
export function blockersFor({ isDraft, mergeStateStatus, checks, required, threads, owned, hasAck }) {
  // `threads === null` means the count could not be read. That is not zero, and
  // printing READY on it would be the convenient answer rather than the true one.
  const blockers = [];
  const missing = required.filter((name) => !(name in checks));
  const running = Object.entries(checks)
    .filter(([, state]) => state === "IN_PROGRESS" || state === "QUEUED" || state === "PENDING")
    .map(([name]) => name);
  const failing = Object.entries(checks)
    .filter(([, state]) => !GREEN.has(state) && !["IN_PROGRESS", "QUEUED", "PENDING"].includes(state))
    .map(([name, state]) => `${name}:${state}`);

  if (isDraft) blockers.push("DRAFT — no check reports this; `gh pr ready` first");
  if (missing.length)
    blockers.push(`required check never dispatched: ${missing.join(",")} — re-dispatch, do not wait`);
  if (failing.length) blockers.push(`failing: ${failing.join(",")}`);
  if (threads === null)
    blockers.push("review-thread count UNREADABLE — check by hand; a thread blocks even when the reviewer's check is green");
  else if (threads > 0)
    blockers.push(`${threads} unresolved review thread(s) — blocks even when the reviewer's check is green`);
  if (owned.length && !hasAck)
    blockers.push(
      `CODEOWNERS path (${owned.join(", ")}) with no "Blast-radius:" line in the BODY — ` +
        "editing the body does not clear it; the line must be there before a fresh push",
    );
  if (mergeStateStatus === "BEHIND") blockers.push("BEHIND — strict protection; `gh pr update-branch`");
  if (mergeStateStatus === "DIRTY") blockers.push("DIRTY — real conflict, the author resolves it");
  if (running.length) blockers.push(`still running: ${running.join(",")}`);
  if (!blockers.length && mergeStateStatus === "BLOCKED")
    blockers.push("BLOCKED for a reason not found here — report UNKNOWN, not READY: check reviewDecision by hand");
  return blockers;
}

/** Pairs of PRs whose changed files intersect: the merge-order decision, measured. */
export function overlaps(touched) {
  const numbers = Object.keys(touched).map(Number).sort((a, b) => a - b);
  const found = [];
  for (let i = 0; i < numbers.length; i += 1) {
    for (let j = i + 1; j < numbers.length; j += 1) {
      const shared = touched[numbers[i]].filter((path) => touched[numbers[j]].includes(path));
      if (shared.length) found.push({ a: numbers[i], b: numbers[j], shared });
    }
  }
  return found;
}

function selfTest() {
  const base = {
    isDraft: false,
    mergeStateStatus: "CLEAN",
    checks: { ts: "SUCCESS", py: "SUCCESS" },
    required: ["ts", "py"],
    threads: 0,
    owned: [],
    hasAck: false,
  };
  const checks = [];
  const push = (name, ok) => checks.push({ name, ok });
  const first = (args) => blockersFor({ ...base, ...args })[0] ?? "";

  push("green and clean is READY", blockersFor(base).length === 0);
  push("draft is caught first", first({ isDraft: true }).startsWith("DRAFT"));
  push("missing required is named", first({ checks: { ts: "SUCCESS" } }).includes("never dispatched"));
  push("queued counts as running, not missing", first({ checks: { ts: "SUCCESS", py: "QUEUED" } }).startsWith("still running"));
  push("failure is named", first({ checks: { ts: "FAILURE", py: "SUCCESS" } }).includes("ts:FAILURE"));
  push("threads block", first({ threads: 3 }).includes("3 unresolved"));
  push("unreadable thread count is a blocker, not zero", first({ threads: null }).includes("UNREADABLE"));
  push("codeowners without ack blocks", first({ owned: ["db/migrations/"] }).includes("Blast-radius"));
  push("codeowners with ack does not", blockersFor({ ...base, owned: ["db/migrations/"], hasAck: true }).length === 0);
  push("behind is a blocker", first({ mergeStateStatus: "BEHIND" }).startsWith("BEHIND"));
  push("dirty is a blocker", first({ mergeStateStatus: "DIRTY" }).startsWith("DIRTY"));
  push(
    "unexplained BLOCKED reports UNKNOWN, never READY",
    first({ mergeStateStatus: "BLOCKED" }).includes("UNKNOWN"),
  );
  push("skipped and neutral are green", blockersFor({ ...base, checks: { ts: "SKIPPED", py: "NEUTRAL" } }).length === 0);

  push("remote url parses to owner/name", repoFromRemote("git@github.com:EshMis/majorana.git") === "EshMis/majorana");
  push("https remote parses too", repoFromRemote("https://github.com/EshMis/majorana") === "EshMis/majorana");
  push(
    "codeowner paths parse",
    JSON.stringify(codeownerPaths("# c\n/db/migrations/    @EshMis\n\n/apps/web/middleware.ts @EshMis")) ===
      JSON.stringify(["db/migrations/", "apps/web/middleware.ts"]),
  );
  const found = overlaps({ 1: ["a.ts", "b.ts"], 2: ["b.ts"], 3: ["c.ts"] });
  push("overlap found once, with the shared file", found.length === 1 && found[0].shared[0] === "b.ts");

  for (const check of checks) console.log(`  ${check.ok ? "ok  " : "FAIL"} ${check.name}`);
  const failed = checks.filter((c) => !c.ok).length;
  console.log(`self-test: ${checks.length - failed}/${checks.length} passed`);
  return failed === 0 ? 0 : 1;
}

function unresolvedThreads(number) {
  try {
    const out = gh([
      "api", "graphql", "-f", `query=${THREADS_QUERY}`,
      "-F", `owner=${REPO.split("/")[0]}`, "-F", `name=${REPO.split("/")[1]}`, "-F", `number=${number}`,
    ]);
    const nodes = JSON.parse(out).data.repository.pullRequest.reviewThreads.nodes;
    return nodes.filter((thread) => !thread.isResolved).length;
  } catch {
    return null; // a count we could not read is not zero, and blockersFor says so
  }
}

function main(argv) {
  if (argv.includes("--self-test")) return selfTest();
  const base = argv.includes("--base") ? argv[argv.indexOf("--base") + 1] : "dev";

  const required = JSON.parse(
    gh(["api", `repos/${REPO}/branches/${base}/protection`, "--jq", ".required_status_checks.contexts"]),
  );
  const encoded = gh(["api", `repos/${REPO}/contents/.github/CODEOWNERS`, "--jq", ".content"]).replace(/\s/g, "");
  const owners = codeownerPaths(encoded ? Buffer.from(encoded, "base64").toString("utf8") : "");

  const prs = JSON.parse(
    gh(["pr", "list", "--base", base, "--limit", "40", "--json",
      "number,title,isDraft,mergeStateStatus,headRefName,statusCheckRollup,files,body,author"]),
  );
  if (!prs.length) {
    console.log(`queue EMPTY — no open PRs into ${base}`);
    return 0;
  }

  const touched = {};
  for (const pr of prs.sort((a, b) => a.number - b.number)) {
    const checks = {};
    for (const check of pr.statusCheckRollup ?? []) {
      const name = check.name ?? check.context;
      if (name) checks[name] = check.conclusion || check.status || check.state || "PENDING";
    }
    const files = (pr.files ?? []).map((file) => file.path);
    touched[pr.number] = files;
    const owned = owners.filter((path) => files.some((file) => file === path || file.startsWith(path)));
    const blockers = blockersFor({
      isDraft: pr.isDraft,
      mergeStateStatus: pr.mergeStateStatus,
      checks,
      required,
      threads: unresolvedThreads(pr.number),
      owned,
      hasAck: /^\s*Blast-radius:\s*\S/im.test(pr.body ?? ""),
    });
    console.log(`\n#${pr.number} [${pr.mergeStateStatus}] ${pr.headRefName} · ${files.length} file(s)`);
    console.log(`   ${pr.title.slice(0, 88)}`);
    if (blockers.length) blockers.forEach((b) => console.log(`   BLOCKER  ${b}`));
    else console.log("   READY — announce on the board, then merge");
  }

  console.log("\n=== file overlap (merge-order decisions) ===");
  const found = overlaps(touched);
  if (!found.length) {
    console.log("  none — these PRs cannot conflict with each other (each can still go BEHIND)");
  }
  for (const { a, b, shared } of found) {
    console.log(`  #${a} ∩ #${b}: ${shared.length} file(s) — ${shared.slice(0, 4).join(", ")}`);
    console.log("      merge one, update-branch the other, re-check. Never edit their file for them.");
  }
  return 0;
}

process.exit(main(process.argv.slice(2)));
