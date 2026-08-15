import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

/**
 * A `"use client"` module must not import from `lib/public-repository.ts`.
 *
 * That module is a barrel over the corpus: it value-imports all nine
 * `entries-*.ts` files and builds derived indexes from them at module scope. So
 * a client component reaching through it for one helper does not get the
 * helper — it gets **the entire Atlas catalog in the browser bundle**, and no
 * bundler can tree-shake it back out.
 *
 * That is not hypothetical. Two components did exactly this, and the cost,
 * measured against production on 2026-08-15:
 *
 *   /            217 KB of JavaScript
 *   /repository  686 KB, of which ONE chunk was 454 KB — ~1.6 MB unpacked,
 *                almost exactly the combined size of the entry sources
 *
 * shipped so the page could classify rows the server had already rendered.
 *
 * This test exists because nothing else catches it. The mistake type-checks,
 * every other test passes, the page renders correctly, and the only symptom is
 * a number in a bundle nobody is measuring — plus a slow first load on a slow
 * machine, which is exactly the failure the owner reported and could not be
 * reproduced on a fast one (ai-ops issue 109).
 *
 * If you need something from `public-repository.ts` in a client component, take
 * it from the leaf that defines it — `./repository/types`,
 * `./repository/verification`, or `./repository/entry-verification`. If it is
 * genuinely corpus-derived, it belongs on the server: pass it down as props.
 */

const webRoot = dirname(dirname(fileURLToPath(import.meta.url)));

/** Source trees that can contain client components. `lib/` is included: a
 *  `"use client"` module there is bundled the same way one under `app/` is. */
const ROOTS = ["app", "components", "lib"];

const SKIP_DIRS = new Set(["node_modules", ".next", ".next-agent", ".next-agent-b", ".next-prod-agent"]);

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full));
    } else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

function isClientModule(source: string): boolean {
  // The directive must be the first statement; a mention inside a comment or a
  // string elsewhere in the file does not make the module a client module.
  const head = source.slice(0, 200);
  return /^\s*(\/\*[\s\S]*?\*\/\s*)?["']use client["']/.test(head);
}

function isBarrel(specifier: string): boolean {
  return /(^|\/)public-repository$/.test(specifier.replace(/\.(ts|tsx|js)$/, ""));
}

/**
 * Does this module pull the barrel in at RUNTIME?
 *
 * Only `import type …` and `{ type X }` are erased. Everything else emits a
 * require of the module, whatever the clause looks like — which is the whole
 * point, because it is the module's evaluation that costs 1.6 MB, not the
 * binding you took from it.
 *
 * The first version of this checked only `{ … }` clauses. Sourcery caught that
 * on the PR: a namespace import (`import * as repo from …`), a default import,
 * or a bare side-effect import (`import "…"`) would all have sailed past a
 * guard whose entire job is to stop them. A test that reports success on the
 * bug it exists to catch is worse than no test, so the forms are enumerated
 * here rather than pattern-matched loosely.
 */
function valueImportsPublicRepository(source: string): boolean {
  // Bare side-effect import: no clause at all, and it still evaluates the module.
  for (const [, specifier] of source.matchAll(/^\s*import\s+["']([^"']+)["']/gm)) {
    if (isBarrel(specifier)) return true;
  }
  // Re-export: `export … from "…"` evaluates the module exactly as an import does.
  for (const [, specifier] of source.matchAll(/^\s*export\s+(?!type\s)[\s\S]*?from\s+["']([^"']+)["']/gm)) {
    if (isBarrel(specifier)) return true;
  }
  for (const match of source.matchAll(/^\s*import\s+(type\s+)?([\s\S]*?)\s*from\s+["']([^"']+)["']/gm)) {
    const [, typeOnly, clause, specifier] = match;
    if (!isBarrel(specifier)) continue;
    if (typeOnly) continue; // `import type { … } from` — erased entirely.
    const braceStart = clause.indexOf("{");
    // Default (`import X from`) or namespace (`import * as X from`), alone or
    // alongside a named clause: any of these emits a runtime require.
    const beforeBraces = (braceStart === -1 ? clause : clause.slice(0, braceStart)).trim();
    if (beforeBraces.replace(/,$/, "").trim()) return true;
    if (braceStart === -1) return true;
    // Named-only: erased only if EVERY specifier is inline-type.
    const named = clause.slice(braceStart + 1, clause.lastIndexOf("}"));
    const hasValue = named
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .some((s) => !s.startsWith("type "));
    if (hasValue) return true;
  }
  return false;
}

test("no client component value-imports the corpus barrel", () => {
  const offenders: string[] = [];
  for (const root of ROOTS) {
    for (const file of sourceFiles(join(webRoot, root))) {
      const source = readFileSync(file, "utf8");
      if (!isClientModule(source)) continue;
      if (valueImportsPublicRepository(source)) offenders.push(relative(webRoot, file));
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `These "use client" modules value-import lib/public-repository, which ships the whole Atlas catalog to the browser:\n  ${offenders.join("\n  ")}\n` +
      "Import from the leaf instead (./repository/types, ./repository/verification, ./repository/entry-verification), or pass the data down as props from the server.",
  );
});

test("the detector catches every import form that evaluates the barrel", () => {
  // A guard that has never been seen to fail has not been shown to work — and
  // this one shipped with a hole in it (named clauses only) that a reviewer
  // found, not the suite. These are the forms that hole let through.
  const leaks = [
    'import repo from "../lib/public-repository";',
    'import * as repo from "../lib/public-repository";',
    'import "../lib/public-repository";',
    'import repo, { PUBLIC_REPOSITORY_CATEGORIES } from "../lib/public-repository";',
    'import { entryVerificationMethods } from "../lib/public-repository";',
    'import { type A, entryVerificationMethods } from "../lib/public-repository";',
    'export { entryVerificationMethods } from "../lib/public-repository";',
    'export * from "../lib/public-repository";',
    'import { PUBLIC_REPOSITORY_CATEGORIES } from "../../lib/public-repository.ts";',
  ];
  for (const line of leaks) {
    assert.ok(valueImportsPublicRepository(line), `should be flagged as a runtime import: ${line}`);
  }

  const erased = [
    'import type { PublicRepositoryEntry } from "../lib/public-repository";',
    'import { type PublicRepositoryEntry, type PublicRepositoryFramework } from "../lib/public-repository";',
    'export type { PublicRepositoryEntry } from "../lib/public-repository";',
    // A different module whose name merely ends similarly must not be flagged.
    'import { loadStarredRepositorySlugs } from "../lib/repository-stars";',
    'import { entryVerificationMethods } from "../lib/repository/entry-verification";',
  ];
  for (const line of erased) {
    assert.ok(!valueImportsPublicRepository(line), `should NOT be flagged: ${line}`);
  }
});

test("the barrel really is the expensive thing this guards", () => {
  // If public-repository ever stops importing the entry files, the rule above
  // becomes cargo cult and should be deleted rather than left to confuse. This
  // asserts the premise still holds.
  const barrel = readFileSync(join(webRoot, "lib", "public-repository.ts"), "utf8");
  const entryImports = [...barrel.matchAll(/from\s+["']\.\/repository\/entries-[a-z0-9-]+["']/g)];
  assert.ok(
    entryImports.length >= 5,
    `lib/public-repository.ts imports ${entryImports.length} entries-* modules; if that is now zero, delete this test file and the leaf split it protects.`,
  );
});

test("the leaf modules the client uses do not reach the corpus themselves", () => {
  // The split is only worth anything if the leaves stayed leaves.
  for (const leaf of ["types.ts", "verification.ts", "entry-verification.ts"]) {
    const source = readFileSync(join(webRoot, "lib", "repository", leaf), "utf8");
    assert.ok(
      !/from\s+["'][^"']*entries-/.test(source),
      `lib/repository/${leaf} now imports an entries-* module — the client bundle is carrying the catalog again.`,
    );
    assert.ok(
      !/^import\s+\{[^}]*\}\s+from\s+["']\.\.\/public-repository["']/m.test(source),
      `lib/repository/${leaf} now imports the barrel, which defeats the split.`,
    );
  }
});
