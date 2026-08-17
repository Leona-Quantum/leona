#!/usr/bin/env node
/**
 * Prove a merge reached production — by content, and only when the probe FAILED first.
 *
 * Every lane in this repo owes a production read-back, and the board records the same
 * three ways of not paying it:
 *
 *   1. **A probe that was already true.** It passes the moment it is written, so it
 *      proves the deploy the way a thermometer left in a drawer proves the weather.
 *      This script refuses to run one: if the whole post-condition already holds
 *      before the deploy, it exits 2 and tells you to tighten it.
 *   2. **Believing a status field.** `cc5f5539` reported "Deployment has completed"
 *      and was demonstrably not what the domain served; `83b8fe6c` reported
 *      "failure: rate limited" and *was*. Neither colour tells you what production is
 *      running. Only bytes off the domain do, so that is all this asserts.
 *   3. **Nobody holding the debt.** The session that merges and the session that pays
 *      are often different, and a pre-measurement dies with the first one's context.
 *      `--state` writes the pre-measurement to disk so the next session can finish the
 *      proof rather than restart it.
 *
 * What it does NOT prove: that a human can see the thing. This reads SSR bytes, which
 * is necessary and not sufficient — a string can ship inside markup that renders
 * invisibly, off-canvas, or behind a closed control. For a visual claim use the
 * ui-visual probes or a browser; for "the data reached the page", this is the cheap
 * instrument.
 *
 * Usage:
 *   node scripts/readback-probe.mjs --url <target> --expect <needle> [...] [options]
 *
 *   --url <u>            target URL on production (required)
 *   --expect <s>         must appear AFTER the deploy; repeatable; `re:<pattern>` for a regex
 *   --min <n>            occurrences required per --expect (default 1)
 *   --absent <s>         must NOT appear after; repeatable; same `re:` prefix
 *   --control-url <u>    an arm that must hold BEFORE and AFTER (regression guard)
 *   --control-expect <s> repeatable, applies to --control-url
 *   --control-absent <s> repeatable, applies to --control-url
 *   --sha <sha>          stop early if the Actions `deploy` run for this SHA fails — see
 *                        "two pipelines" below before you pass it
 *   --timeout <s>        give up after this long (default 900)
 *   --interval <s>       seconds between polls (default 30)
 *   --state <path>       persist/reuse the pre-measurement across sessions
 *   --self-test          check the pure helpers and exit
 *
 * Exit codes: 0 flipped FAIL→PASS with controls intact · 1 timed out, deploy failed,
 * or a control broke after the deploy · 2 the probe was already true (proves nothing)
 * · 3 the control arm was false before the deploy (wrong control, or production is not
 * what you think it is) · 4 usage error, or a URL that could not be reached at all.
 *
 * Every request is cache-busted with a fresh `cb=` and sent no-store, because the
 * domain sits behind a CDN and a cached 200 is the fourth way not to pay a read-back.
 *
 * ## Two pipelines, and `--sha` only watches one of them
 *
 * "Deploy-watch by SHA" names two independent things in this repo:
 *
 *   - `.github/workflows/deploy.yml` (the Actions run called `deploy`) ships the Cloud
 *     Run **api and worker** and runs **DB migrations**. It has no Vercel step.
 *   - The **web app** is deployed by Vercel's own git integration, which reports as a
 *     commit *status context* named `Vercel`, not as an Actions job.
 *
 * So a page can be live while the Actions run is still going — measured on `2f945f76`,
 * where production served the new lane while `deploy` was `in_progress`. Pass `--sha`
 * when what you are proving is deployed by that workflow (`services/`, `packages/py/`,
 * `db/migrations/`); for a page change it is a backend safety net, not a signal about
 * your page, and the content poll remains the only verdict.
 *
 * With `--sha` the Vercel status context is printed beside each poll as an ANNOTATION
 * and never acted on, because it has been measured wrong in both directions: `cc5f5539`
 * said success and served nothing of the kind, `83b8fe6c` said "rate limited" and was
 * what the domain served. Aborting on a red Vercel status would therefore abandon
 * read-backs that were about to pass.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { insideRepoSelfTest, resolveInsideRepo } from "./lib/inside-repo.mjs";

const REGEX_PREFIX = "re:";

/** A needle is literal text unless it opens with `re:`, in which case it is a pattern. */
export function countMatches(body, needle) {
  if (needle.startsWith(REGEX_PREFIX)) {
    const pattern = new RegExp(needle.slice(REGEX_PREFIX.length), "g");
    return (body.match(pattern) ?? []).length;
  }
  let count = 0;
  let at = body.indexOf(needle);
  while (at !== -1) {
    count += 1;
    at = body.indexOf(needle, at + needle.length);
  }
  return count;
}

/**
 * The post-condition, measured rather than asserted: every `expect` at or above `min`,
 * every `absent` at zero. Returned whole so the verdict can print the counts that
 * decided it — a bare boolean is how "it passed" becomes unfalsifiable later.
 */
export function evaluate(body, { expect = [], absent = [], min = 1 }) {
  const expected = expect.map((needle) => {
    const count = countMatches(body, needle);
    return { needle, count, ok: count >= min };
  });
  const forbidden = absent.map((needle) => {
    const count = countMatches(body, needle);
    return { needle, count, ok: count === 0 };
  });
  return {
    expected,
    forbidden,
    ok: expected.every((r) => r.ok) && forbidden.every((r) => r.ok),
  };
}

export function parseArgs(argv) {
  const args = {
    url: null,
    expect: [],
    absent: [],
    min: 1,
    controlUrl: null,
    controlExpect: [],
    controlAbsent: [],
    sha: null,
    timeout: 900,
    interval: 30,
    state: null,
    selfTest: false,
  };
  const repeatable = {
    "--expect": "expect",
    "--absent": "absent",
    "--control-expect": "controlExpect",
    "--control-absent": "controlAbsent",
  };
  const single = {
    "--url": "url",
    "--control-url": "controlUrl",
    "--sha": "sha",
    "--state": "state",
  };
  const numeric = { "--min": "min", "--timeout": "timeout", "--interval": "interval" };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === "--self-test") {
      args.selfTest = true;
      continue;
    }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`${flag} needs a value`);
    i += 1;
    if (repeatable[flag]) args[repeatable[flag]].push(value);
    else if (single[flag]) args[single[flag]] = value;
    else if (numeric[flag]) {
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${flag} needs a positive number`);
      args[numeric[flag]] = parsed;
    } else throw new Error(`unknown flag ${flag}`);
  }
  return args;
}

/**
 * Cache-busted, no-store, and the URL it actually fetched is reported, not implied.
 * Throws on a dead host — the poll loop treats that as transient and retries, while the
 * pre-measurement treats it as fatal, because a baseline you could not take is not a
 * baseline you may skip.
 */
async function fetchBody(url) {
  const bust = new URL(url);
  bust.searchParams.set("cb", String(Date.now()));
  const res = await fetch(bust, {
    headers: { "cache-control": "no-cache", pragma: "no-cache" },
    cache: "no-store",
  });
  const body = await res.text();
  return { url: bust.toString(), status: res.status, body };
}

function report(label, result) {
  for (const row of result.expected) {
    console.log(`    ${row.ok ? "hit " : "miss"} ${label} expect ${JSON.stringify(row.needle)} ×${row.count}`);
  }
  for (const row of result.forbidden) {
    console.log(`    ${row.ok ? "gone" : "PRESENT"} ${label} absent ${JSON.stringify(row.needle)} ×${row.count}`);
  }
}

/**
 * The web app's own deploy signal, printed and never acted on. It is here so a stuck
 * read-back can be told apart from a stuck deploy without leaving the terminal — but see
 * the header: this field has been wrong in both directions, so it annotates, it does not
 * decide. Returns null when it cannot be read, which is not evidence of anything either.
 */
function vercelStatusFor(sha) {
  try {
    const out = execFileSync(
      "gh",
      ["api", `repos/{owner}/{repo}/commits/${sha}/status`, "--jq", "[.statuses[] | select(.context==\"Vercel\") | .state] | first // \"none\""],
      { encoding: "utf8" },
    );
    return out.trim() || null;
  } catch {
    return null;
  }
}

/** A deploy that has already failed is not a deploy worth waiting fifteen minutes for. */
function deployFailedFor(sha) {
  try {
    const out = execFileSync(
      "gh",
      ["run", "list", "--limit", "20", "--json", "databaseId,headSha,name,status,conclusion,url"],
      { encoding: "utf8" },
    );
    const failed = JSON.parse(out).find(
      (run) =>
        run.headSha?.startsWith(sha) &&
        run.name === "deploy" &&
        run.status === "completed" &&
        run.conclusion !== "success" &&
        run.conclusion !== "skipped",
    );
    return failed ?? null;
  } catch {
    return null; // gh unavailable is not evidence the deploy failed
  }
}

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * `--state` is the only argument here that reaches the filesystem, and it is the
 * only one in this family that reaches it to WRITE as well as read — `saveState`
 * calls `mkdirSync(..., { recursive: true })` and then `writeFileSync`. An
 * unconfined value therefore creates directories outside the tree rather than
 * merely reading one. Contained once, here, so both callers inherit it.
 *
 * Returns the resolved path, or exits: unlike the pure helpers this file keeps
 * for its self-test, there is nothing sensible to do with a refused state path.
 */
function statePath(path) {
  if (!path) return null;
  const contained = resolveInsideRepo(REPO_ROOT, path);
  if (contained.error) {
    console.error(`--state ${contained.error}`);
    process.exit(4);
  }
  return contained.path;
}

function loadState(path, key) {
  if (!path || !existsSync(path)) return null;
  try {
    const saved = JSON.parse(readFileSync(path, "utf8"));
    return saved.key === key ? saved : null;
  } catch {
    return null;
  }
}

function saveState(path, payload) {
  if (!path) return;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`);
}

function selfTest() {
  const checks = [];
  const push = (name, ok) => checks.push({ name, ok });

  push("literal count", countMatches("a-b-a-b-a", "a") === 3);
  push("overlap-free count", countMatches("aaaa", "aa") === 2);
  push("regex count", countMatches('<i class="x"> <i class="x">', 're:class="x"') === 2);
  push("absent is zero", countMatches("nothing here", "missing") === 0);

  const body = "lane:0.3.3 lane:0.3.3 host";
  push("expect met", evaluate(body, { expect: ["lane:0.3.3"], min: 2 }).ok === true);
  push("expect unmet at min", evaluate(body, { expect: ["lane:0.3.3"], min: 3 }).ok === false);
  push("absent violated", evaluate(body, { expect: [], absent: ["host"] }).ok === false);
  push("absent satisfied", evaluate(body, { expect: [], absent: ["ghost"] }).ok === true);
  push(
    "conjunction needs both",
    evaluate(body, { expect: ["lane:0.3.3"], absent: ["host"] }).ok === false,
  );

  const parsed = parseArgs(["--url", "u", "--expect", "a", "--expect", "b", "--min", "2"]);
  push("repeatable flags accumulate", parsed.expect.length === 2 && parsed.min === 2);
  let threw = false;
  try {
    parseArgs(["--url"]);
  } catch {
    threw = true;
  }
  push("missing value rejected", threw);

  for (const check of checks) console.log(`  ${check.ok ? "ok  " : "FAIL"} ${check.name}`);
  const failures = checks.filter((c) => !c.ok).length;
  console.log(`self-test: ${checks.length - failures}/${checks.length} passed`);
  // Same shared containment rule as the two check scripts. `--state` is the one
  // argument in this family that WRITES, so this is the copy that matters most.
  const pathFailures = insideRepoSelfTest(REPO_ROOT);
  for (const line of pathFailures) console.error(`  - ${line}`);
  return failures === 0 && pathFailures.length === 0 ? 0 : 1;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main(argv) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (error) {
    console.error(`usage error: ${error.message}`);
    return 4;
  }
  if (args.selfTest) return selfTest();
  if (!args.url || args.expect.length + args.absent.length === 0) {
    console.error("usage error: --url and at least one --expect/--absent are required");
    return 4;
  }

  const target = { expect: args.expect, absent: args.absent, min: args.min };
  const control = { expect: args.controlExpect, absent: args.controlAbsent, min: 1 };
  const key = JSON.stringify({ url: args.url, target, controlUrl: args.controlUrl, control });

  console.log(`READ-BACK PROBE  ${new Date().toISOString()}`);
  console.log(`  target : ${args.url}`);
  if (args.controlUrl) console.log(`  control: ${args.controlUrl}`);

  const saved = loadState(statePath(args.state), key);
  let pre;
  if (saved) {
    pre = saved.pre;
    console.log(`\nPRE-DEPLOY (reused from ${args.state}, taken ${saved.takenAt}):`);
  } else {
    let fetched;
    try {
      fetched = await fetchBody(args.url);
    } catch (error) {
      console.error(`\ncannot reach the target: ${error.message}. No baseline, no read-back.`);
      return 4;
    }
    pre = { at: new Date().toISOString(), status: fetched.status, result: evaluate(fetched.body, target) };
    console.log(`\nPRE-DEPLOY (HTTP ${fetched.status}, ${fetched.url}):`);
  }
  report("target", pre.result);

  if (pre.result.ok) {
    console.log(
      "\nVERDICT: ALREADY TRUE — this probe cannot prove anything about the deploy.\n" +
        "  Production satisfies the whole post-condition before it landed, so a PASS after\n" +
        "  the deploy would be matching on nothing. Tighten it: assert a string this change\n" +
        "  introduces, or an address that only exists under the new shape.",
    );
    return 2;
  }

  let preControl = null;
  if (args.controlUrl) {
    let fetched;
    try {
      fetched = await fetchBody(args.controlUrl);
    } catch (error) {
      console.error(`\ncannot reach the control: ${error.message}. No control, no read-back.`);
      return 4;
    }
    preControl = evaluate(fetched.body, control);
    console.log(`\nCONTROL BEFORE (HTTP ${fetched.status}):`);
    report("control", preControl);
    if (!preControl.ok) {
      console.log(
        "\nVERDICT: CONTROL FALSE BEFORE THE DEPLOY — stop. Either the control arm is wrong,\n" +
          "  or production is not the build you think it is. A read-back measured against an\n" +
          "  unknown baseline is not a read-back.",
      );
      return 3;
    }
  }

  saveState(statePath(args.state), { key, takenAt: pre.at, pre, preControl });

  console.log(`\nPOLLING production every ${args.interval}s for up to ${args.timeout}s …`);
  const deadline = Date.now() + args.timeout * 1000;
  let post = null;
  while (Date.now() < deadline) {
    await sleep(args.interval * 1000);
    if (args.sha) {
      const failed = deployFailedFor(args.sha);
      if (failed) {
        console.log(`\nVERDICT: DEPLOY FAILED for ${args.sha} — ${failed.conclusion}, ${failed.url}`);
        return 1;
      }
    }
    let fetched;
    try {
      fetched = await fetchBody(args.url);
    } catch (error) {
      console.log(`  … fetch failed (${error.message}); retrying`);
      continue;
    }
    const result = evaluate(fetched.body, target);
    const hits = result.expected.map((r) => r.count).concat(result.forbidden.map((r) => r.count));
    const vercel = args.sha ? vercelStatusFor(args.sha) : null;
    const note = vercel ? `  [Vercel status: ${vercel} — annotation, not a verdict]` : "";
    console.log(
      `  … ${new Date().toISOString().slice(11, 19)} HTTP ${fetched.status} counts=[${hits}]${note}`,
    );
    if (result.ok) {
      post = { at: new Date().toISOString(), result };
      break;
    }
  }

  if (!post) {
    console.log(
      `\nVERDICT: NOT SERVED within ${args.timeout}s. The post-condition never held, so the\n` +
        "  read-back is UNPAID — say exactly that on the board rather than 'merged and deployed'.",
    );
    return 1;
  }

  console.log(`\nPOST-DEPLOY (${post.at}):`);
  report("target", post.result);

  if (args.controlUrl) {
    let fetched;
    try {
      fetched = await fetchBody(args.controlUrl);
    } catch (error) {
      console.error(`\ncannot re-check the control after the flip: ${error.message}.`);
      return 4;
    }
    const postControl = evaluate(fetched.body, control);
    console.log(`\nCONTROL AFTER (HTTP ${fetched.status}):`);
    report("control", postControl);
    if (!postControl.ok) {
      console.log("\nVERDICT: REGRESSION — the target flipped but the control arm broke with it.");
      return 1;
    }
  }

  const elapsed = Math.round((Date.parse(post.at) - Date.parse(pre.at)) / 1000);
  console.log(
    `\nVERDICT: PAID — the post-condition was FALSE at ${pre.at} and TRUE at ${post.at}` +
      ` (${elapsed}s), controls intact. That difference is the proof; the counts above are the evidence.`,
  );
  return 0;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
