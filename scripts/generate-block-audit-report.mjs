#!/usr/bin/env node
// Regenerates (or --check) docs/atlas/block-audit.md from
// apps/web/lib/workflow-planner/block-audit.ts — the build-time audit that
// counts the gates Leona's own Studio blocks build at small sizes and
// compares them with the workflow planner's paper-sourced cost formulas. See
// that file's module comment, block-audit-report.ts (the renderer), and
// apps/web/lib/workflow-planner-block-audit.test.ts (which asserts the
// committed file below is current).
//
// Usage:
//   node scripts/generate-block-audit-report.mjs [--check] [--stdout]
//
// --check regenerates in-memory and compares against the committed file,
// exiting non-zero on drift (for CI). --stdout prints instead of writing.
//
// Node's native TypeScript loader (`--experimental-strip-types`) imports
// block-audit.ts's module tree directly — the same way apps/web's own test
// runner does (`workflow-planner.test.ts` and its siblings, on the `test`
// script in apps/web/package.json) — no esbuild bundling needed, unlike the
// corpus-barrel generators (see check-worked-example-links.mjs's comment)
// that resolve extensionless specifiers node's loader cannot follow. This
// script re-execs itself with that flag if it is not already active, so it
// runs the same way regardless of how it is invoked (bare `node
// scripts/generate-block-audit-report.mjs`, as the rest of this directory's
// scripts are).

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const RELAUNCH_ENV = "BLOCK_AUDIT_REPORT_RELAUNCHED";

if (!process.execArgv.includes("--experimental-strip-types") && !process.env[RELAUNCH_ENV]) {
  const result = spawnSync(process.execPath, ["--experimental-strip-types", fileURLToPath(import.meta.url), ...process.argv.slice(2)], {
    stdio: "inherit",
    env: { ...process.env, [RELAUNCH_ENV]: "1" },
  });
  process.exit(result.status ?? 1);
}

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(root, "docs/atlas/block-audit.md");
const CHECK = process.argv.includes("--check");
const STDOUT = process.argv.includes("--stdout");

async function main() {
  const auditModuleUrl = pathToFileURL(join(root, "apps/web/lib/workflow-planner/block-audit.ts")).href;
  const reportModuleUrl = pathToFileURL(join(root, "apps/web/lib/workflow-planner/block-audit-report.ts")).href;
  const auditModule = await import(auditModuleUrl);
  const { renderReport } = await import(reportModuleUrl);

  const rows = auditModule.auditBlocks();
  const coverage = auditModule.stageCoverage(rows);
  const summary = auditModule.summarize(rows);
  const content = renderReport(rows, coverage, summary);

  if (STDOUT) {
    process.stdout.write(content);
    return;
  }
  if (CHECK) {
    let committed;
    try {
      committed = readFileSync(OUT, "utf8");
    } catch {
      console.error(`generate-block-audit-report: ${OUT} does not exist. Run without --check to create it.`);
      process.exit(1);
    }
    if (committed !== content) {
      console.error(`generate-block-audit-report: ${OUT} is stale. Run \`node scripts/generate-block-audit-report.mjs\` to regenerate.`);
      process.exit(1);
    }
    console.log("generate-block-audit-report: docs/atlas/block-audit.md is current.");
    return;
  }
  writeFileSync(OUT, content);
  console.log(`generate-block-audit-report: wrote ${OUT}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
