import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

/**
 * The complete list of places this app hands a string to the browser as HTML,
 * and the reason each one is allowed to.
 *
 * ## Why this test exists
 *
 * Aikido flagged `dangerouslySetInnerHTML` in `math-text.tsx` and opened an AI
 * fix for it (PR 668). The fix was wrong on every count — it imported a
 * dependency that was never added so the build failed, it called DOMPurify from
 * a server component where there is no DOM, and its allowlist
 * (`ALLOWED_TAGS: ['span','p']`, `ALLOWED_ATTR: ['class']`) would have deleted
 * KaTeX's entire MathML tree and every `style` attribute it positions glyphs
 * with, scrambling 884 corpus values across two locales to fix an injection
 * that was not there.
 *
 * But the scanner was pointing at a real category. The reason this codebase is
 * safe is not that anything sanitizes — it is that **the untrusted path does
 * not exist**: `react-markdown` without `rehype-raw` drops raw HTML rather than
 * rendering it, so model output, which is the one genuinely attacker-influenced
 * string here, never becomes markup. That is a stronger guarantee than
 * sanitizing, and it is currently held up by nothing but nobody having added
 * `rehype-raw` yet.
 *
 * So this test writes the guarantee down where a tool reads it. Adding a new
 * `dangerouslySetInnerHTML`, or adding `rehype-raw`, now fails here and has to
 * be argued for rather than merged as a convenience.
 */

const webRoot = dirname(dirname(fileURLToPath(import.meta.url)));

/**
 * Every site allowed to write HTML, with what it writes.
 *
 * The test is the ALLOWLIST, not a count: a new entry here is a deliberate act
 * with a reviewer attached, and a new site NOT here fails.
 */
const ALLOWED = new Map<string, string>([
  // Three inline <script> tags carrying our own constant source. They are not
  // HTML being injected — they are code we wrote, deliberately executed before
  // first paint (theme, locale, and the auth hint from ai-ops issue 114). There
  // is no untrusted input and nothing to sanitize; a sanitizer would delete them.
  ["app/layout.tsx", "inline <script>: our own constants, pre-paint"],
  // An inline <style> built from our own locale constant, same reasoning.
  ["app/not-found.tsx", "inline <style>: our own constant"],
  // KaTeX's own output, from corpus prose WE author (see lib/math-text.ts).
  // No visitor can reach this input, and `throwOnError: false` renders an error
  // node rather than doing anything with malformed source.
  ["components/math-text.tsx", "katex.renderToString on authored corpus"],
]);

/**
 * Walk the app for source files, tolerating entries that vanish mid-walk.
 *
 * The try/catch is not defensive padding — it is here because this test failed
 * exactly that way when it was written. `turbo run typecheck lint test` runs the
 * three concurrently, typecheck and lint regenerate `.next`, and a `statSync` on
 * a file that disappears between `readdirSync` and the stat throws ENOENT and
 * takes the whole test process down. Every OTHER suite then reports as failed,
 * which is a spectacularly misleading way for a walk to break.
 *
 * Skipping an unreadable entry is safe for what this test asserts: the risk it
 * guards is a file that EXISTS and writes HTML, and a file being written by a
 * build is never that.
 */
function sourceFiles(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry === "node_modules" || entry.startsWith(".next") || entry === ".git") continue;
    const full = join(dir, entry);
    try {
      if (statSync(full).isDirectory()) sourceFiles(full, out);
      else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
    } catch {
      continue;
    }
  }
  return out;
}

test("every place that writes HTML is on the allowlist, with a reason", () => {
  const found = new Set<string>();
  for (const file of sourceFiles(webRoot)) {
    const source = readFileSync(file, "utf8");
    if (/dangerouslySetInnerHTML|\.innerHTML\s*=/.test(source)) {
      found.add(relative(webRoot, file));
    }
  }

  const unexpected = [...found].filter((f) => !ALLOWED.has(f));
  assert.deepEqual(
    unexpected,
    [],
    `new HTML-writing site(s) with no recorded reason: ${unexpected.join(", ")}. ` +
      "If the input is ours and constant, add it to ALLOWED with the reason. " +
      "If it can carry anything a visitor or a model produced, it needs a different " +
      "design — not a sanitizer bolted on after the fact.",
  );

  // The other direction: an allowlist entry for a file that no longer writes
  // HTML is stale permission, and stale permission is how the next one gets in
  // without being looked at.
  const stale = [...ALLOWED.keys()].filter((f) => !found.has(f));
  assert.deepEqual(stale, [], `allowlist entries no longer needed: ${stale.join(", ")}`);
});

test("markdown is rendered without rehype-raw, so model output cannot become markup", () => {
  // The load-bearing one. `react-markdown` builds a React tree from the AST and
  // DROPS raw HTML unless `rehype-raw` is added. Chat answers come from a model
  // and are therefore the one string here an outsider can influence, via the
  // prompt. Adding `rehype-raw` would silently turn every one of them into
  // markup — and it is exactly the plugin somebody reaches for when a model
  // emits a <br> and it shows up as text.
  const pkg = JSON.parse(readFileSync(join(webRoot, "package.json"), "utf8")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const declared = { ...pkg.dependencies, ...pkg.devDependencies };
  assert.ok(
    !("rehype-raw" in declared),
    "rehype-raw makes raw HTML in markdown render. Model output reaches MarkdownContent, " +
      "so this turns prompt injection into HTML injection. If it is genuinely needed, " +
      "the sanitizer question has to be answered first.",
  );

  const markdown = readFileSync(join(webRoot, "components", "chat-markdown.tsx"), "utf8");
  assert.ok(!/rehype-raw|rehypeRaw/.test(markdown), "chat-markdown.tsx must not use rehype-raw");
  // And it must still be the component doing the rendering, so this test cannot
  // pass by the markdown path having quietly moved somewhere unchecked.
  assert.match(markdown, /ReactMarkdown/);
});
