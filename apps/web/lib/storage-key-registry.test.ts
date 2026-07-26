/**
 * Every browser storage key must be a decision, not an accident.
 *
 * A key added without thinking about identity is how the leak this codebase
 * just fixed got in: `majorana.chat-history.v1` was global, so the second
 * person to sign in on a browser read the first person's prompts. This scans
 * the source for storage-key literals and fails on any that is neither
 * classified per-account nor explicitly device-level.
 *
 * The scan asserts what it found, not just what it failed to find. A guard that
 * silently walks an empty tree passes forever.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { DEVICE_STORAGE_KEYS, SCOPED_STORAGE_KEYS } from "./user-storage.ts";

const WEB_ROOT = fileURLToPath(new URL("..", import.meta.url));
const SEARCH_DIRS = ["app", "components", "lib"];
const SKIP_DIRS = new Set(["node_modules", ".next", "dist"]);

/**
 * `majorana.<name>.v<n>` — the key convention. Events use a colon, not a dot.
 *
 * Matching the shape alone is too loose: the same convention names an export
 * `schema_version` and a legacy cookie, neither of which is browser storage. So
 * a literal counts as a storage key when EITHER it is bound to a `*STORAGE_KEY`
 * constant (the naming convention every one of them follows) OR it appears in a
 * file that touches storage at all. The second rule is what stops a
 * differently-named constant from slipping through.
 */
// Both quote styles: the guard must not depend on a formatting convention it
// does not enforce.
const KEY_LITERAL = /["'](majorana\.[a-z0-9-]+\.v\d+)["']/g;
// No leading \b: in THEME_STORAGE_KEY the underscore is a word character, so a
// boundary never matches before the suffix.
const STORAGE_KEY_DECLARATION = /STORAGE_KEY\s*(?::[^=]+)?=\s*["'](majorana\.[a-z0-9-]+\.v\d+)["']/g;
const TOUCHES_STORAGE = /\blocalStorage\b|\bscopedStorage\b/;

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      found.push(...sourceFiles(path));
      continue;
    }
    if (/\.tsx?$/.test(entry) && !entry.endsWith(".test.ts") && !entry.endsWith(".test.tsx")) {
      found.push(path);
    }
  }
  return found;
}

function declaredKeys(): Map<string, string[]> {
  const byKey = new Map<string, string[]>();
  for (const dir of SEARCH_DIRS) {
    for (const file of sourceFiles(join(WEB_ROOT, dir))) {
      // user-storage.ts is the registry itself; its literals are the answer key.
      if (file.endsWith(join("lib", "user-storage.ts"))) continue;
      const source = readFileSync(file, "utf8");
      const matches = TOUCHES_STORAGE.test(source)
        ? source.matchAll(KEY_LITERAL)
        : source.matchAll(STORAGE_KEY_DECLARATION);
      for (const [, key] of matches) {
        byKey.set(key, [...(byKey.get(key) ?? []), file.slice(WEB_ROOT.length)]);
      }
    }
  }
  return byKey;
}

test("the scan actually reaches the source tree", () => {
  const files = SEARCH_DIRS.flatMap((dir) => sourceFiles(join(WEB_ROOT, dir)));
  assert.ok(files.length > 50, `expected a real source tree, walked ${files.length} files`);
  assert.ok(
    files.some((file) => file.endsWith(join("lib", "chat-history.ts"))),
    "chat-history.ts should be in the walked set",
  );
});

test("every storage key in the source is classified per-account or device-level", () => {
  const declared = declaredKeys();
  // The keys that existed when this guard was written. A new one is fine; it
  // just has to be classified. Losing one silently is not.
  assert.ok(
    declared.size >= 14,
    `expected at least 14 storage keys in the source, found ${declared.size}`,
  );

  const classified = new Set<string>([...SCOPED_STORAGE_KEYS, ...DEVICE_STORAGE_KEYS]);
  const unclassified = [...declared.entries()]
    .filter(([key]) => !classified.has(key))
    .map(([key, files]) => `${key} (${files.join(", ")})`);

  assert.deepEqual(
    unclassified,
    [],
    "add each key to SCOPED_STORAGE_KEYS or DEVICE_STORAGE_KEYS in lib/user-storage.ts",
  );
});

test("every registered per-account key is actually used by some module", () => {
  const declared = declaredKeys();
  const orphans = SCOPED_STORAGE_KEYS.filter((key) => !declared.has(key));
  assert.deepEqual(orphans, [], "a registered key with no call site means a rename went half-done");
});
