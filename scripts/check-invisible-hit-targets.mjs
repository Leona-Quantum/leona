#!/usr/bin/env node
// Style gate: an overlay that is invisible must not be clickable.
//
// `opacity: 0` does not remove an element from hit testing. An absolutely
// positioned block at zero opacity is still the topmost thing under the pointer
// over its own box, so it takes the clicks meant for whatever it covers — and
// the symptom is not an error but a control that does nothing, or the wrong
// control firing. `.mj-sidebar-folder-actions` sat over the right half of every
// folder and project row in the rail for a release this way.
//
// The rule: a declaration block that sets BOTH `position: absolute|fixed` and
// `opacity: 0` must also set `pointer-events`. It does not have to be `none` —
// a block can legitimately name a different value — but the decision has to
// have been made rather than defaulted to `auto` by omission.
//
// Deliberately narrow. Reveal-on-hover overlays are the shape that produces
// this bug; a zero-opacity element in the normal flow occupies its own space
// and is not covering anything the author did not intend.
//
// Usage: node scripts/check-invisible-hit-targets.mjs   (exit 1 on violations)
import { readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SHEETS = ["packages/ts/ui/styles.css", "apps/web/app/globals.css", "apps/web/app/lab/lab.css"];

const OPACITY_ZERO = /(?:^|;)\s*opacity\s*:\s*0(?:\.0+)?\s*(?:;|$)/m;
const OVERLAID = /(?:^|;)\s*position\s*:\s*(absolute|fixed)\s*(?:;|$)/m;
const POINTER_EVENTS = /(?:^|;)\s*pointer-events\s*:/m;

/** [selector, body] for every declaration block, ignoring at-rule wrappers. */
function blocks(css) {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
    selector: match[1].trim().replaceAll(/\s+/g, " "),
    body: match[2],
    // Line of the block's opening brace, for a message that can be jumped to.
    line: css.slice(0, match.index).split("\n").length,
  }));
}

function violations(css) {
  return blocks(css).filter(
    (block) =>
      OPACITY_ZERO.test(block.body) &&
      OVERLAID.test(block.body) &&
      !POINTER_EVENTS.test(block.body),
  );
}

// Positive control: a scan that finds nothing because the matcher is broken
// passes exactly like a clean stylesheet does. This is the one difference.
const CANARY = `.canary { position: absolute; opacity: 0; right: 0; }`;
if (violations(CANARY).length !== 1) {
  console.error("check-invisible-hit-targets: the matcher does not detect a known violation");
  process.exit(1);
}
if (violations(`.ok { position: absolute; opacity: 0; pointer-events: none; }`).length !== 0) {
  console.error("check-invisible-hit-targets: the matcher flags a correctly written block");
  process.exit(1);
}

const failures = [];
for (const sheet of SHEETS) {
  const path = join(repoRoot, sheet);
  // Fail closed: a renamed stylesheet must not pass as "nothing to scan".
  if (!statSync(path, { throwIfNoEntry: false })?.isFile()) {
    console.error(`check-invisible-hit-targets: stylesheet missing: ${sheet}`);
    process.exit(1);
  }
  for (const block of violations(readFileSync(path, "utf8"))) {
    failures.push(`${sheet}:${block.line}: ${block.selector}`);
  }
}

if (failures.length > 0) {
  console.error("Invisible overlays that still take clicks (add pointer-events):");
  for (const failure of failures) console.error(`  ${failure}`);
  process.exit(1);
}
console.log(`check-invisible-hit-targets: OK (${SHEETS.length} stylesheets)`);
