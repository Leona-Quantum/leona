import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * `next.config.ts` cannot be imported by this runner — its own imports are
 * extensionless, same reason `edge-cache-headers.test.ts` reads it as text
 * instead. `embed-routes.test.ts` and `content-security-policy.test.ts` prove
 * the two building blocks (the path pattern, the CSP string) are individually
 * correct; this is the third leg — that `next.config.ts` actually wires them
 * together the way the other two assume, rather than, say, defining its own
 * duplicate `X-Frame-Options: DENY` entry that the pattern exclusion never
 * touches.
 */
const NEXT_CONFIG = readFileSync(fileURLToPath(new URL("../next.config.ts", import.meta.url)), "utf8");

/** One `{ source: ..., headers: [...] }` object, captured by its own `source` value. */
function headerEntry(source: string): string {
  const pattern = new RegExp(
    `source:\\s*${source.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")},[\\s\\S]*?headers:\\s*\\[([\\s\\S]*?)\\n\\s*\\],`,
  );
  const match = NEXT_CONFIG.match(pattern);
  assert.ok(match, `no headers() entry found with source: ${source}`);
  return match[1];
}

test("X-Frame-Options is set exactly once in the whole file, on the general (non-embed) source", () => {
  const matches = [...NEXT_CONFIG.matchAll(/key:\s*"X-Frame-Options"/g)];
  assert.equal(matches.length, 1, "X-Frame-Options must be set in exactly one headers() entry");

  // The one entry that sets it must be scoped by GENERAL_ANTI_FRAMING_SOURCE,
  // not a bare "/(.*)" catch-all — a plain catch-all would also reach the
  // embed route (see embed-routes.test.ts's mutation check for that regression).
  const generalBlock = headerEntry("GENERAL_ANTI_FRAMING_SOURCE");
  assert.match(generalBlock, /key: "X-Frame-Options", value: "DENY"/);
  assert.match(generalBlock, /key: "Content-Security-Policy", value: csp/);
});

test("the embed route's own headers() entry sets a relaxed CSP and nothing else", () => {
  const embedBlockStart = NEXT_CONFIG.indexOf("...EMBED_QAPP_SOURCES.map((source) => ({");
  assert.ok(embedBlockStart > -1, "expected an EMBED_QAPP_SOURCES.map(...) headers() entry");
  const embedBlockEnd = NEXT_CONFIG.indexOf("})),", embedBlockStart);
  const embedBlock = NEXT_CONFIG.slice(embedBlockStart, embedBlockEnd);
  assert.match(embedBlock, /key: "Content-Security-Policy", value: embedCsp/);
  assert.doesNotMatch(embedBlock, /X-Frame-Options/);
});

test("the embed CSP is built from the same contentSecurityPolicy() call as the default, only frameAncestors differs", () => {
  const start = NEXT_CONFIG.indexOf("const embedCsp = contentSecurityPolicy({");
  const embedCspBlock = NEXT_CONFIG.slice(start, NEXT_CONFIG.indexOf("});", start));
  assert.match(embedCspBlock, /frameAncestors:\s*"https:"/);
  assert.match(embedCspBlock, /controlPlane:\s*CONTROL_PLANE/);
  assert.match(embedCspBlock, /errorReporting:\s*errorReportingOrigin/);
});

test("the general pattern and the embed sources come from lib/embed-routes.ts, not a restated literal", () => {
  assert.match(
    NEXT_CONFIG,
    /import \{ EMBED_QAPP_SOURCES, GENERAL_ANTI_FRAMING_SOURCE \} from "\.\/lib\/embed-routes"/,
  );
  // A literal "(?!embed" anywhere else in this file would be a second,
  // divergence-prone copy of the pattern embed-routes.ts already exports.
  assert.equal((NEXT_CONFIG.match(/\(\?!embed/g) ?? []).length, 0);
});

test("the embed route is also covered by edgeCacheRules, so it can be served from the CDN", () => {
  assert.match(NEXT_CONFIG, /EMBED_QAPP_SOURCES\.flatMap\(\(source\) => edgeCacheRules\(source, 300\)\)/);
});
