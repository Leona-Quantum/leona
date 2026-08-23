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
 * Every site allowed to write HTML, with HOW MANY sinks it may contain and why.
 *
 * The count is the point, not decoration. A file-level allowlist would permit
 * every FUTURE sink in an already-allowed file — a second
 * `dangerouslySetInnerHTML` dropped into `app/layout.tsx` would inherit the
 * first one's permission and never be looked at. Raised by CodeRabbit on
 * PR 671, and it was right: that is a guard that does not guard.
 */
const ALLOWED = new Map<string, { sinks: number; reason: string }>([
  // Three inline <script> tags carrying our own constant source. They are not
  // HTML being injected — they are code we wrote, deliberately executed before
  // first paint (theme, locale, and the auth hint from ai-ops issue 114). There
  // is no untrusted input and nothing to sanitize; a sanitizer would delete them.
  //
  // STILL THREE after the JSON-LD block was added for ai-ops 133, and that is
  // the interesting part rather than an oversight. The structured data is
  // rendered as a text child of <script type="application/ld+json">, not
  // through `dangerouslySetInnerHTML`, so it is not a sink at all.
  //
  // That was not a stylistic choice. Measured both ways: with `__html`, a value
  // containing "</script>" is emitted verbatim, closes the tag, and whatever
  // follows becomes real markup — three closing tags in the rendered output.
  // As a text child, React applies script-specific escaping and the value
  // cannot leave the element. So the version that would have needed an entry
  // here is the one that was genuinely less safe, which is worth knowing the
  // next time a "just use dangerouslySetInnerHTML, the input is ours" argument
  // shows up: it is ours until the day it carries a record name.
  //
  // MOVED, not changed: this was `app/layout.tsx` until ai-ops issue 151 split
  // the single root layout into one per top-level segment. The three scripts,
  // the JSON-LD block and every word of the reasoning above now live in the one
  // document component all of those layouts render, so the count is still three
  // and there is still exactly one file to justify — which is the reason the
  // split went through a shared component rather than copying `<html>` into ten
  // places. Ten copies would have been ten entries here, drifting apart.
  ["components/root-document.tsx", { sinks: 3, reason: "inline <script>: our own constants, pre-paint" }],
  // An inline <style> built from our own locale constant, same reasoning.
  //
  // It is also the ONLY inline <style> element this app serves, and the CSP now
  // depends on that: `style-src-elem` names this stylesheet by SHA-256 instead
  // of admitting `'unsafe-inline'`. So a second inline <style> anywhere is not
  // just a new sink to justify here — it is a stylesheet the browser will refuse
  // until its hash is added in lib/content-security-policy.ts. The symptom is a
  // page rendering unstyled rather than an error, which is why it is written
  // down at the count that catches it.
  ["app/not-found.tsx", { sinks: 1, reason: "inline <style>: our own constant, hashed into style-src-elem" }],
  // KaTeX's own output, from corpus prose WE author (see lib/math-text.ts),
  // now passed through DOMPurify on the way out — owner ruling on ai-ops 138:
  // KaTeX is not accepted as its own sanitizer, whatever `trust: false`
  // guarantees. So the reasoning below is no longer what holds this up; it is
  // the second of two independent reasons rather than the only one.
  //
  // No visitor can reach this input, and `throwOnError: false` renders an error
  // node rather than doing anything with malformed source.
  //
  // The sanitizer is in `lib/sanitize-math.ts` and its config is the part that
  // can go wrong — PR 668 added DOMPurify here with an allowlist that would have
  // deleted KaTeX's entire MathML tree and every `style` attribute, which renders
  // a scrambled page rather than an error. `lib/sanitize-math.test.ts` asserts
  // preservation against real formula shapes AND strips a set of payloads as its
  // control, and `scripts/check-math.mjs` extends the preservation assertion over
  // every `$…$` in the corpus, both locales.
  //
  // **It is NOT in the render path right now.** leona 690 wired it in and every
  // MathText-rendering route returned 500 on production while routes without
  // mathematics stayed 200; it was withdrawn to restore service. So for the
  // moment this sink is back to resting on the two reasons above and not on a
  // sanitizer, which is what the reason string says. `math-text.tsx` carries the
  // incident note and the fix forward. Re-landing it does not change this entry's
  // COUNT, which is why that count — not this prose — is what the test asserts.
  [
    "components/math-text.tsx",
    { sinks: 1, reason: "katex.renderToString on authored corpus; sanitizer WITHDRAWN from this path pending the Vercel runtime fix — see math-text.tsx" },
  ],
]);

/**
 * Every way a string becomes markup, counted per occurrence rather than per file.
 *
 * The bracket forms are not hypothetical pedantry — `el["innerHTML"] = html` is
 * what a minifier, a codemod, or anyone working around a typed property writes,
 * and dot-notation-only matching would wave it straight through. `outerHTML`,
 * `insertAdjacentHTML` and `document.write` are here for the same reason: they
 * are the neighbours somebody reaches for when `innerHTML` is the thing being
 * watched. Raised by CodeRabbit on PR 671.
 */
const SINK =
  /dangerouslySetInnerHTML|(?:\.|\[\s*["'`])(?:inner|outer)HTML(?:["'`]\s*\])?\s*=|insertAdjacentHTML|document\s*\.\s*write/g;

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
  const vanished = (error: unknown) => (error as NodeJS.ErrnoException)?.code === "ENOENT";

  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch (error) {
    // ENOENT only. Swallowing EACCES or an I/O error here would silently drop a
    // whole subtree from the scan and still report green — a guard that fails
    // open, quietly, which is worse than no guard because it is trusted.
    if (vanished(error)) return out;
    throw error;
  }
  for (const entry of entries) {
    if (entry === "node_modules" || entry.startsWith(".next") || entry === ".git") continue;
    const full = join(dir, entry);
    try {
      if (statSync(full).isDirectory()) sourceFiles(full, out);
      // All four extensions, not just TypeScript: a sink in a .js or .jsx file
      // would otherwise walk straight past this control (CodeRabbit, PR 671).
      else if (/\.[jt]sx?$/.test(entry) && !/\.test\.[jt]sx?$/.test(entry)) out.push(full);
    } catch (error) {
      if (vanished(error)) continue;
      throw error;
    }
  }
  return out;
}

test("every place that writes HTML is on the allowlist, with a reason", () => {
  const found = new Map<string, number>();
  for (const file of sourceFiles(webRoot)) {
    let source: string;
    try {
      source = readFileSync(file, "utf8");
    } catch (error) {
      // ENOENT only — the file vanished between the walk and the read, which a
      // concurrent build does. Anything else (a permission error, an unreadable
      // mount) would SILENTLY drop a file from the scan, so it is rethrown:
      // losing coverage without saying so is the one outcome a guard must not
      // have. Raised by CodeRabbit on PR 671.
      if ((error as NodeJS.ErrnoException)?.code === "ENOENT") continue;
      throw error;
    }
    const count = source.match(SINK)?.length ?? 0;
    if (count > 0) found.set(relative(webRoot, file), count);
  }

  const unexpected = [...found.keys()].filter((f) => !ALLOWED.has(f));
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

  // And the counts. This is what stops a new sink inheriting an existing file's
  // permission.
  for (const [file, { sinks }] of ALLOWED) {
    assert.equal(
      found.get(file),
      sinks,
      `${file} now has ${found.get(file)} HTML-writing site(s), not ${sinks}. ` +
        "Every one needs its own reason — update the count here only after " +
        "checking what the new one writes and where that string comes from.",
    );
  }
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

  // **`urlTransform` is the second default this file leans on, and it was
  // unguarded.** `react-markdown` sanitizes link and image URLs with
  // `defaultUrlTransform`, which admits only http, https, irc, ircs, mailto and
  // xmpp — that is what stops a model emitting `[click](javascript:…)` from
  // becoming a working script link. Overriding the prop replaces that check
  // wholesale, and the failure would be invisible: markdown still renders, links
  // still look like links.
  //
  // It matters more than it looks because of the CSP. `script-src` carries
  // `'unsafe-inline'` and cannot stop carrying it — see the measurement in
  // lib/content-security-policy.ts — and `javascript:` URLs are governed by
  // `script-src`, so with `'unsafe-inline'` present such a link WOULD execute.
  // The reasoning recorded there for leaving that directive open depends on this
  // assertion holding, which is the reason it is an assertion and not a sentence.
  // Raised by CodeRabbit on PR 691.
  assert.ok(
    !/urlTransform/.test(markdown),
    "chat-markdown.tsx overrides urlTransform, which replaces react-markdown's URL " +
      "protocol allowlist. Model output reaches this renderer, so that turns a prompt " +
      "into a javascript: link — and script-src carries 'unsafe-inline', so it would run. " +
      "If a protocol genuinely needs adding, use createUrlTransform to EXTEND the " +
      "allowlist rather than replacing the function, and say so here.",
  );
});
