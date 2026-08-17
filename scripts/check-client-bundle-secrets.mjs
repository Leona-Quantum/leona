#!/usr/bin/env node
/**
 * Nothing secret-shaped may reach the browser.
 *
 * `plans/rebuild/05-security.md` §2 has carried "No secret-shaped strings in client
 * bundle or error responses (CI grep)" as an unticked release gate since adoption, and
 * §1 has listed it as a kept rule from the pre-rebuild baseline. It was never built. The
 * API half is held by construction — `app._problem()` composes every error body from a
 * fixed shape and never echoes an exception — but nothing looked at what Next ships.
 *
 * ## The failure this actually guards
 *
 * Next inlines `process.env.NEXT_PUBLIC_*` into client bundles at build time. That is the
 * documented behaviour and the whole point of the prefix, which is exactly why it is
 * dangerous: naming a secret `NEXT_PUBLIC_STRIPE_SECRET_KEY` publishes it to every visitor
 * with no error, no warning, and no symptom. Vercel's dashboard will happily hold such a
 * variable, and the person who adds it is usually adding it because something "wasn't
 * available on the client".
 *
 * So there are two detectors, and the second matters more than the first:
 *
 * 1. **Credential shapes** — literal tokens in the shipped bytes, matched by their
 *    published prefixes and lengths.
 * 2. **Secret-shaped `NEXT_PUBLIC_` names** — a variable whose *name* says secret,
 *    whatever its value looks like. This fires even when the value is a placeholder, an
 *    empty string, or something no shape rule would recognise.
 *
 * ## Shapes, not entropy — and the reason is written down elsewhere in this repo
 *
 * A full-history gitleaks scan once reported 83 leaks here. All 83 were one rule firing
 * on `component_semantic_key == "optimizer.slsqp.v1"`, and because the gate said
 * "gitleaks full-history clean", that gate was unmeetable and therefore unenforced for as
 * long as those commits existed. A real leak would have arrived as finding 84.
 *
 * Minified JavaScript is the worst possible input for an entropy detector: webpack module
 * ids, content hashes, base64 source maps and CSS class names are all high-entropy and all
 * meaningless. An entropy rule here would produce dozens of findings on the first run,
 * someone would add `--allow` until it was quiet, and the check would be decoration. Every
 * pattern below is a published credential format with a fixed prefix, so a hit is a hit.
 *
 * The cost of that choice is stated rather than hidden: this will not catch a
 * bespoke-format secret — a shared HMAC key, a bare password. Nothing scanning bytes
 * reliably would. The `NEXT_PUBLIC_` name rule is what covers that class, because a
 * bespoke secret still has to arrive through a variable someone named.
 *
 * ## What is scanned
 *
 * - `.next/static` and everything under it — every byte the browser downloads.
 * - `.next/server/app`, the `.html`, `.rsc` and `.body` files — prerendered payloads,
 *   which are also sent to the browser.
 *
 * The `.js` under `.next/server` is deliberately NOT scanned. That is server code, it reads
 * secrets from the environment at runtime by design, and scanning it would report the
 * *correct* handling of a credential as a leak — the fastest possible route to a check
 * nobody believes.
 *
 * ## Usage
 *
 *   node scripts/check-client-bundle-secrets.mjs [--dist apps/web/.next]
 *   node scripts/check-client-bundle-secrets.mjs --self-test
 *
 * `--self-test` plants one known-bad string per rule in a temporary tree and asserts each
 * is caught. It runs in CI immediately before the real scan, so "no findings" is only ever
 * reported by a detector that has just proved it still detects. A clean scan from a broken
 * scanner looks exactly like a clean scan.
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { insideRepoSelfTest, resolveInsideRepo } from "./lib/inside-repo.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Published credential formats. Each entry needs a `sample` that the rule must match:
 * `--self-test` uses it, so a rule cannot be added without demonstrating it fires.
 *
 * The samples are syntactically valid and cryptographically worthless. They still have to
 * look real — a fixture that no scanner would recognise proves nothing — which puts this
 * file in the awkward position of being the one place in the repo where credential-shaped
 * strings belong.
 *
 * **So a sample is never written as one contiguous literal.** Each splits at its prefix
 * and is rejoined at runtime, which keeps the bytes on disk out of every other scanner's
 * jaws while leaving the value identical to the rule that must match it. This is the
 * convention rather than an accident: written flat, the Stripe line was rejected by
 * GitHub's push protection and the Slack line by our own gitleaks rules. Suppressing
 * either in `.gitleaks.toml` would have been the wrong trade — it weakens a real gate to
 * accommodate a test fixture, and an allowlist entry outlives the reason for it.
 */
export const CREDENTIAL_RULES = [
  {
    id: "stripe-secret-key",
    // Also matches WorkOS, which uses the same sk_test_/sk_live_ convention.
    pattern: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}/g,
    sample: `sk_live_${"0123456789ABCDEFabcdef0123"}`,
  },
  {
    id: "github-token",
    pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{22,})/g,
    sample: `ghp_${"A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8"}`,
  },
  {
    id: "anthropic-api-key",
    pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}/g,
    sample: `sk-ant-${"api03-0123456789abcdefABCDEF_-0123456789"}`,
  },
  {
    id: "openai-api-key",
    pattern: /\bsk-(?:proj-)?[A-Za-z0-9]{32,}/g,
    sample: `sk-proj-${"0123456789abcdefABCDEF0123456789abcdef"}`,
  },
  {
    id: "aws-access-key-id",
    pattern: /\bAKIA[0-9A-Z]{16}\b/g,
    sample: "AKIAIOSFODNN7EXAMPLE",
  },
  {
    id: "google-api-key",
    pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g,
    // Exactly 35 characters after the prefix; the first draft had 36 and the
    // self-test refused it, which is the whole reason samples are mandatory.
    sample: `AIza${"SyA0123456789abcdefghijklmnopqrstuv"}`,
  },
  {
    id: "slack-token",
    pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}/g,
    sample: `xox${"b-0123456789-0123456789-abcdefABCDEF"}`,
  },
  {
    id: "private-key-block",
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/g,
    sample: `-----BEGIN RSA ${"PRIVATE KEY"}-----`,
  },
  {
    id: "database-url-with-password",
    // A connection string carrying credentials. `[^:@/\s]+` on both sides keeps this off
    // `postgres://localhost/db` and off URLs whose userinfo is a bare username.
    pattern: /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp):\/\/[^:@/\s]+:[^@/\s]+@/g,
    sample: `postgresql://app_rw:${"hunter2"}@db.example.com:5432/majorana`,
  },
];

/**
 * `NEXT_PUBLIC_` variables whose names say "secret". Next inlines these, so the name is
 * enough — the value need not look like anything.
 */
export const SECRET_SHAPED_NAME = /\bNEXT_PUBLIC_[A-Z0-9_]*(?:SECRET|PRIVATE|PASSWORD|PASSWD|CREDENTIAL|_TOKEN|_KEY)[A-Z0-9_]*\b/g;

/**
 * Names that are legitimately public despite matching the rule above.
 *
 * A publishable Stripe key or a public site key genuinely belongs in the bundle. Each
 * entry needs a written reason, because an allowlist nobody has to justify is how a check
 * becomes decoration — the same way `--allow` flags accumulate on an entropy scanner.
 * Empty today: this app ships exactly one `NEXT_PUBLIC_` variable, `NEXT_PUBLIC_API_URL`,
 * and it does not match.
 */
export const PUBLIC_NAME_ALLOWLIST = new Map([
  // ["NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", "publishable by design; Stripe's client SDK requires it"],
]);

const SCAN_STATIC = "static";
const SCAN_PRERENDER_EXTS = new Set([".html", ".rsc", ".body"]);

function walk(dir, keep, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const info = statSync(full);
    if (info.isDirectory()) walk(full, keep, out);
    else if (keep(full)) out.push(full);
  }
  return out;
}

/** Every file in a Next build output that the browser receives. */
export function browserFiles(dist) {
  const files = walk(join(dist, SCAN_STATIC), () => true);
  walk(join(dist, "server", "app"), (path) =>
    SCAN_PRERENDER_EXTS.has(path.slice(path.lastIndexOf("."))),
  ).forEach((path) => files.push(path));
  return files;
}

/**
 * Findings for one file's contents. Pure, so `--self-test` exercises the same code path
 * the real scan does rather than a parallel implementation of it.
 */
export function scanText(text, label) {
  const findings = [];
  for (const rule of CREDENTIAL_RULES) {
    for (const match of text.matchAll(rule.pattern)) {
      findings.push({ file: label, rule: rule.id, evidence: redact(match[0]) });
    }
  }
  for (const match of text.matchAll(SECRET_SHAPED_NAME)) {
    const name = match[0];
    if (PUBLIC_NAME_ALLOWLIST.has(name)) continue;
    findings.push({ file: label, rule: "secret-shaped-public-var", evidence: name });
  }
  return findings;
}

/** Enough to identify the hit, never enough to use it. */
function redact(value) {
  return value.length <= 12 ? `${value.slice(0, 4)}…` : `${value.slice(0, 8)}…(${value.length} chars)`;
}

export function scanDist(dist) {
  const files = browserFiles(dist);
  const findings = [];
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    findings.push(...scanText(text, relative(ROOT, file)));
  }
  return { files: files.length, findings };
}

/**
 * Prove the detector detects, then let the real scan speak.
 *
 * Every rule's own `sample` is planted in a throwaway build tree — one in a static chunk,
 * one in a prerendered document — and each must be found. A rule that stops matching, a
 * glob that stops covering `static/`, or an allowlist that grows to swallow everything all
 * fail here rather than passing quietly.
 */
export function selfTest() {
  const dir = mkdtempSync(join(tmpdir(), "bundle-secret-selftest-"));
  const failures = [];
  try {
    const staticDir = join(dir, SCAN_STATIC, "chunks");
    const appDir = join(dir, "server", "app");
    for (const target of [staticDir, appDir]) {
      mkdirSync(target, { recursive: true });
    }
    const planted = CREDENTIAL_RULES.map((rule) => rule.sample).join("\n");
    writeFileSync(join(staticDir, "main-abc123.js"), `console.log("${planted}");`);
    writeFileSync(
      join(appDir, "page.html"),
      `<script>window.__E={k:process.env.NEXT_PUBLIC_ADMIN_SECRET_KEY}</script>`,
    );

    const { findings } = scanDist(dir);
    const hit = new Set(findings.map((f) => f.rule));
    for (const rule of CREDENTIAL_RULES) {
      if (!hit.has(rule.id)) failures.push(`rule ${rule.id} did not match its own sample`);
    }
    if (!hit.has("secret-shaped-public-var")) {
      failures.push("secret-shaped NEXT_PUBLIC_ name was not caught in a prerendered document");
    }

    // ...and the other half: ordinary build output must stay quiet, or the check is a
    // wall of noise on its first real run and gets switched off.
    const clean = scanText(
      `const u=process.env.NEXT_PUBLIC_API_URL;const h="a3f9c2e1b8d7";` +
        `export const id="9f8e7d6c5b4a3210";//# sourceMappingURL=main.js.map`,
      "clean.js",
    );
    if (clean.length) {
      failures.push(`ordinary bundle text produced ${clean.length} false positive(s)`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  // The shared containment rule, folded into the self-test this script already
  // runs in CI. Kept here rather than in a test file of its own because nothing
  // in this repo discovers `scripts/*.mjs` tests — a self-test that no step
  // invokes is the mechanism nobody armed.
  failures.push(...insideRepoSelfTest(ROOT));

  return failures;
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--self-test")) {
    const failures = selfTest();
    if (failures.length) {
      console.error("client-bundle secret scanner is broken:");
      for (const line of failures) console.error(`  - ${line}`);
      process.exit(1);
    }
    console.log(
      `client-bundle secret scanner self-test passed (${CREDENTIAL_RULES.length} credential rules + the NEXT_PUBLIC_ name rule)`,
    );
    return;
  }

  const distFlag = argv.indexOf("--dist");
  // Contained before it is used. `resolve(ROOT, value)` reads like it confines
  // the result and does not — `../` resolves cleanly elsewhere and an absolute
  // value discards ROOT outright. Same shape #681 fixed in
  // check-paper-register.mjs; see scripts/lib/inside-repo.mjs for why this is a
  // tidy pass rather than an incident.
  const requested = distFlag === -1 ? "apps/web/.next" : argv[distFlag + 1];
  const contained = resolveInsideRepo(ROOT, requested);
  if (contained.error) {
    console.error(`--dist ${contained.error}`);
    process.exit(1);
  }
  const dist = contained.path;
  if (!existsSync(dist)) {
    console.error(
      `no build output at ${dist}. Run \`pnpm --filter @majorana/web build\` first — this check ` +
        `must not pass by finding nothing to look at.`,
    );
    process.exit(1);
  }

  const { files, findings } = scanDist(dist);
  if (!files) {
    console.error(`${dist} contains no browser-served files; refusing to report it clean.`);
    process.exit(1);
  }
  if (findings.length) {
    console.error(`secret-shaped strings reached the client bundle (${findings.length}):`);
    for (const f of findings) console.error(`  ${f.rule}  ${f.file}  ${f.evidence}`);
    console.error(
      "\nIf this is a genuinely public value, add it to PUBLIC_NAME_ALLOWLIST with a reason.",
    );
    process.exit(1);
  }
  console.log(`no secret-shaped strings in ${files} browser-served files under ${relative(ROOT, dist)}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
