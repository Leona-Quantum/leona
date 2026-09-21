#!/usr/bin/env node
// No URL in the web app may be resolved against the incoming request's own URL.
//
// ## The failure this exists for
//
// On 2026-09-20 leonaqt.com moved from Vercel to Cloud Run, and everyone who
// signed in landed on `https://0.0.0.0:8080/run`. A self-hosted Next server builds
// `request.url` from the address it LISTENS on, not from the `Host` header, so
// `new URL("/run", request.url)` names the container. Vercel had been rewriting it.
// Nothing caught it: every automated check follows sign-in only as far as WorkOS,
// whose URL is absolute, and the leg that comes back needs a real account.
//
// A rule in a comment would not have caught it either. The sign-in route carried a
// paragraph explaining why resolving against `request.url` was the CORRECT choice.
//
// ## What it checks
//
//   1. `new URL(x, request.url)` / `new URL(x, request.nextUrl…)` — the two-argument
//      form, with the request as the base. `new URL(request.url)` alone (reading a
//      query string) is fine and is not matched. Use `redirectBase(request.url)`
//      from apps/web/lib/site-origin.ts.
//   2. AuthKit's `handleAuth({...})` without `baseURL` — it resolves its own redirect
//      against the request when that option is absent.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WEB = join(ROOT, "apps", "web");

// The base argument starts with the request. Whitespace and newlines are allowed
// between the comma and the base; the first argument may not contain a parenthesis
// closing the call early, which keeps `new URL(request.url).search, request.url` out.
const REQUEST_AS_BASE = /new URL\(\s*[^;]*?,\s*(?:request|req)\.(?:url|nextUrl)\b/g;
const HANDLE_AUTH_CALL = /\bhandleAuth\s*\(/g;

/**
 * The text of a call's arguments, from just after its `(` to the matching `)`.
 * Counted, not pattern-matched: the first version required the closing brace on a
 * line of its own, so a compact `handleAuth({ returnPathname: "/run" })` — the
 * shape this rule exists to refuse — passed. (Sourcery, PR 932.) Comments are
 * already blanked by the caller; string contents are not, which is safe here
 * because an unbalanced parenthesis inside a string can only make the slice
 * longer, and a longer slice can only find a `baseURL` that is really there.
 */
function callArguments(code, openIndex) {
  let depth = 0;
  for (let i = openIndex; i < code.length; i += 1) {
    if (code[i] === "(") depth += 1;
    else if (code[i] === ")") {
      depth -= 1;
      if (depth === 0) return code.slice(openIndex + 1, i);
    }
  }
  return code.slice(openIndex + 1);
}

/** Findings for one source text: `{ line, what }[]`. */
export function scan(source) {
  const findings = [];
  const code = source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (comment) => comment.replace(/[^\n]/g, " "));
  const lineOf = (index) => code.slice(0, index).split("\n").length;
  for (const match of code.matchAll(REQUEST_AS_BASE)) {
    // `redirectBase(request.url)` contains `request.url` but not as the base itself.
    const upToBase = match[0];
    if (/redirectBase\(\s*$/.test(code.slice(0, match.index + upToBase.length - upToBase.match(/(?:request|req)\.(?:url|nextUrl)$/)[0].length))) continue;
    findings.push({ line: lineOf(match.index), what: "a URL resolved against the request's own URL — use redirectBase(request.url)" });
  }
  for (const match of code.matchAll(HANDLE_AUTH_CALL)) {
    // `import { handleAuth } from …` has no call parenthesis and is not matched.
    const args = callArguments(code, match.index + match[0].length - 1);
    if (!/\bbaseURL\s*:/.test(args)) {
      findings.push({ line: lineOf(match.index), what: "handleAuth() without baseURL — AuthKit then redirects to the request's own origin" });
    }
  }
  return findings;
}

function selfTest() {
  const cases = [
    ["a relative redirect against request.url", 'return NextResponse.redirect(new URL("/", request.url));', 1],
    ["the same across lines, as the sign-in route wrote it", 'NextResponse.redirect(\n  new URL(path(a, b), request.url),\n  303,\n);', 1],
    ["against nextUrl", 'new URL(target, request.nextUrl.origin)', 1],
    ["through redirectBase", 'new URL("/", redirectBase(request.url))', 0],
    ["reading a query string", "const q = new URL(request.url).searchParams;", 0],
    ["two statements on one line", "const a = new URL(request.url); const b = foo(x, request.url);", 0],
    ["only in a comment", '// new URL(target, request.url) was the bug\nconst x = 1;', 0],
    ["handleAuth without baseURL", 'export const GET = handleAuth({\n  returnPathname: "/run",\n});', 1],
    ["handleAuth with baseURL", 'export const GET = handleAuth({\n  returnPathname: "/run",\n  baseURL: siteOrigin() ?? undefined,\n});', 0],
    ["handleAuth on one line, without baseURL", 'export const GET = handleAuth({ returnPathname: "/run" });', 1],
    ["handleAuth with no arguments at all", "export const GET = handleAuth();", 1],
    ["handleAuth on one line, with baseURL", 'export const GET = handleAuth({ returnPathname: "/run", baseURL: origin() });', 0],
    ["handleAuth with a nested call before baseURL", 'handleAuth({ onSuccess: async () => { (await cookies()).set(A, B, opts()); }, baseURL: x });', 0],
    ["importing handleAuth is not calling it", 'import { handleAuth } from "@workos-inc/authkit-nextjs";', 0],
  ];
  const failures = cases.filter(([, source, want]) => scan(source).length !== want);
  if (failures.length) {
    for (const [name, source, want] of failures) {
      console.error(`check-request-relative-redirects: SELF-TEST FAILED — ${name}: wanted ${want}, got ${scan(source).length}`);
    }
    process.exit(1);
  }
  console.log(`check-request-relative-redirects: self-test ok (${cases.length} cases, both verdicts exercised)`);
}

function sources(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next" || name.startsWith(".form-test")) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sources(path, out);
    else if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(name) && !/\.test\.[cm]?[jt]sx?$/.test(name)) out.push(path);
  }
  return out;
}

if (process.argv.includes("--self-test")) {
  selfTest();
} else {
  // The whole web app, not a list of directories somebody has to remember to extend:
  // `sources` skips node_modules, build output and test bundles, and test files.
  const files = sources(WEB).filter((file) => !relative(WEB, file).startsWith(`tests${"/"}`));
  let count = 0;
  for (const file of files) {
    for (const { line, what } of scan(readFileSync(file, "utf8"))) {
      console.error(`${relative(ROOT, file)}:${line}: ${what}`);
      count += 1;
    }
  }
  if (count) {
    console.error(`\ncheck-request-relative-redirects: ${count} finding(s). On Cloud Run the request's own origin is the container's listen address (0.0.0.0:8080); see apps/web/lib/site-origin.ts redirectBase().`);
    process.exit(1);
  }
  console.log(`check-request-relative-redirects: ok (${files.length} files)`);
}
