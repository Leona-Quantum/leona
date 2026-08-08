#!/usr/bin/env node
// Style gate: the closed list of permitted animations must be true.
//
// The list existed in three places and all three disagreed —
// `docs/ui/components.md` named five, `packages/ts/ui/AGENTS.md` named five
// *different* ones, and the header comment of `packages/ts/ui/styles.css` named
// four. The stylesheet was running eleven `@keyframes`, four of which appeared on
// no list at all, and two of those ran through `prefers-reduced-motion: reduce`
// untouched. Nothing failed, because nothing was checking: a rule written in
// three prose paragraphs is a comment about a rule.
//
// So there is one table now, `docs/ui/components.md § Permitted animations`,
// and this reconciles it against the CSS **in both directions**:
//
//   - a `@keyframes` the table does not name  → a new animation nobody approved
//   - a row naming a `@keyframes` that does not exist → a list gone stale
//   - an `animation:` naming a `@keyframes` that does not exist → silently dead
//   - a row saying "off" whose selectors are not actually turned off under
//     `prefers-reduced-motion: reduce`
//
// The last one is the reason this is a script and not a review checklist. The
// reduced-motion answer is not visible at the `@keyframes` — it is somewhere else
// in an 11,000-line file, attached to a selector, possibly inside a comma group.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SPEC = "docs/ui/components.md";
// The product surface, and only it. `apps/web/app/globals.css` is the public
// marketing site and carries 22 `@keyframes` of its own (hero draw, orbits,
// twinkle, the cat) under a different motion budget — `docs/ui/components.md` is
// the *components* spec and has never governed it. Naming the omission here so
// it stays a decision: if the marketing site should be governed too, it needs its
// own table, not 22 rows in this one.
const STYLESHEETS = ["packages/ts/ui/styles.css"];
const START = "<!-- permitted-animations:start -->";
const END = "<!-- permitted-animations:end -->";

const quiet = process.argv.includes("--quiet");
const failures = [];

// ---------------------------------------------------------------------------
// The table
// ---------------------------------------------------------------------------

const spec = readFileSync(resolve(repoRoot, SPEC), "utf8");
const from = spec.indexOf(START);
const to = spec.indexOf(END);
if (from < 0 || to < 0 || to < from) {
  console.error(`check-permitted-animations: ${SPEC} has no ${START} … ${END} block.`);
  console.error("  The table is the spec of record; without the markers there is nothing to check.");
  process.exit(1);
}

/** @type {Map<string, {where: string, reduced: string}>} */
const permitted = new Map();
for (const line of spec.slice(from + START.length, to).split("\n")) {
  const row = line.trim();
  if (!row.startsWith("|")) continue;
  const cells = row.split("|").slice(1, -1).map((cell) => cell.trim());
  if (cells.length < 4) continue;
  const name = cells[0].replace(/`/g, "").trim();
  if (name === "keyframes" || /^-+$/.test(name)) continue;
  if (permitted.has(name)) failures.push(`${SPEC}: '${name}' has two rows`);
  permitted.set(name, { where: cells[1], reduced: cells[3].toLowerCase() });
}
if (permitted.size === 0) {
  console.error(`check-permitted-animations: the table in ${SPEC} parsed to zero rows.`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// The CSS
// ---------------------------------------------------------------------------

/**
 * Flatten a stylesheet into `[selector, body]`, carrying enclosing at-rules on
 * the selector so a rule nested in `@media (prefers-reduced-motion: reduce)` can
 * be told from the same selector outside one. `@keyframes` bodies are dropped:
 * their percentage steps are not rules and their `animation` mentions are not uses.
 */
function flatten(text, prefix = "") {
  const out = [];
  let index = 0;
  while (index < text.length) {
    const brace = text.indexOf("{", index);
    if (brace < 0) break;
    const selector = text.slice(index, brace).replace(/\/\*[\s\S]*?\*\//g, "").trim();
    let depth = 1;
    let cursor = brace + 1;
    while (depth > 0 && cursor < text.length) {
      if (text[cursor] === "{") depth += 1;
      else if (text[cursor] === "}") depth -= 1;
      cursor += 1;
    }
    const body = text.slice(brace + 1, cursor - 1);
    if (/^@(media|supports|layer|container)/.test(selector)) {
      out.push(...flatten(body, `${prefix}${selector} `));
    } else if (!selector.startsWith("@keyframes")) {
      out.push([prefix + selector, body]);
    }
    index = cursor;
  }
  return out;
}

/** Whitespace-collapsed, so a selector written across two lines still compares equal. */
function normalise(selector) {
  return selector.replace(/\s+/g, " ").trim();
}

const declared = new Map(); // keyframes name -> "file:line"
const used = new Map(); // keyframes name -> [{selector, reduced}]
const silenced = new Set(); // selectors that reduced motion sets to `animation: none`
const unknownReferences = []; // `animation: mj-…` naming no @keyframes — silently dead
const sheets = [];

for (const relativePath of STYLESHEETS) {
  let text;
  try {
    text = readFileSync(resolve(repoRoot, relativePath), "utf8");
  } catch {
    continue; // an optional stylesheet that does not exist is not a failure
  }
  sheets.push([relativePath, text]);
  for (const [lineNo, line] of text.split("\n").entries()) {
    const match = line.match(/^\s*@keyframes\s+([\w-]+)/);
    if (!match) continue;
    if (declared.has(match[1])) failures.push(`${match[1]} is declared twice`);
    declared.set(match[1], `${relativePath}:${lineNo + 1}`);
  }
}

// Uses are collected only after every sheet's declarations are known: a
// stylesheet may run a keyframes declared in another one, and a first pass that
// tested `declared.has` file by file would report that as dead.
for (const [, text] of sheets) {
  for (const [selector, body] of flatten(text)) {
    const declaration = body.match(/(?:^|[;{\s])animation(?:-name)?\s*:\s*([^;}]+)/);
    if (!declaration) continue;
    const reduced = /prefers-reduced-motion\s*:\s*reduce/.test(selector);
    // The other shape of the same guarantee: an animation declared *inside*
    // `no-preference` never runs for a reader who asked for less motion, so it
    // needs no `reduce` rule turning it off. Missing this reads as a real gap and
    // is not one — `.mj-archive-notice` is written that way on purpose.
    const onlyWhenMotionIsWelcome = /prefers-reduced-motion\s*:\s*no-preference/.test(selector);
    const value = declaration[1].trim();
    // `animation: none` is the *disabling* form. It is how reduced motion turns
    // one off, so it is a silence rather than a use.
    if (/(^|[\s,])none([\s,]|$)/.test(value)) {
      if (reduced) {
        for (const part of selector.split(/\)\s/).pop().split(",")) silenced.add(normalise(part));
      }
      continue;
    }
    for (const [name] of value.matchAll(/[\w-]+/g)) {
      if (!declared.has(name)) {
        // Only `mj-`-prefixed words: the rest of an `animation` shorthand is
        // durations, easings and keywords, and flagging those would make the
        // check unusable. Every keyframes in this package is `mj-`-named, so a
        // `mj-` word with no declaration is a typo — and a typo here is silent,
        // which is the whole reason to look. This branch was unreachable in the
        // first draft (an unknown name was skipped before it could be reported)
        // and only a mutation found that.
        if (/^mj-/.test(name)) {
          unknownReferences.push({ name, selector });
        }
        continue;
      }
      used.set(name, [
        ...(used.get(name) ?? []),
        { selector, reduced: reduced || onlyWhenMotionIsWelcome },
      ]);
    }
  }
}

// ---------------------------------------------------------------------------
// Reconcile
// ---------------------------------------------------------------------------

for (const [name, where] of declared) {
  if (!permitted.has(name)) {
    failures.push(
      `${where}: @keyframes ${name} is not on the list. Add a row to ${SPEC} § Permitted animations, or delete the animation.`,
    );
  }
}
for (const name of permitted.keys()) {
  if (!declared.has(name)) {
    failures.push(`${SPEC}: the table names '${name}', which no stylesheet declares.`);
  }
}
for (const { name, selector } of unknownReferences) {
  failures.push(
    `\`${normalise(selector).slice(0, 60)}\` runs '${name}', which no @keyframes declares — the declaration is dropped and nothing animates.`,
  );
}
for (const [name, sites] of used) {
  const row = permitted.get(name);
  if (!row) continue; // already reported above
  if (!row.reduced.startsWith("off")) continue;
  for (const site of sites) {
    if (site.reduced) continue;
    const selectors = site.selector.split(",").map(normalise);
    if (selectors.some((selector) => silenced.has(selector))) continue;
    failures.push(
      `${name} runs on \`${site.selector.trim().slice(0, 70)}\` and the table says "off" under reduced motion, but no @media (prefers-reduced-motion: reduce) rule turns that selector off.`,
    );
  }
}

if (failures.length > 0) {
  console.error("Permitted-animation list and stylesheets disagree:");
  for (const failure of failures) console.error(`  ${failure}`);
  process.exit(1);
}
if (!quiet) {
  console.log(
    `check-permitted-animations: OK (${permitted.size} permitted, ${declared.size} declared, ${used.size} used)`,
  );
}
