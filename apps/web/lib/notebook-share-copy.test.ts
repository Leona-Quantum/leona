import assert from "node:assert/strict";
import test from "node:test";

import { NOTEBOOK_SHARE_COPY } from "./notebook-share-copy.ts";

function keyPaths(value: unknown, prefix = ""): string[] {
  if (typeof value === "function") return [prefix];
  if (typeof value !== "object" || value === null) return [prefix];
  return Object.entries(value).flatMap(([key, child]) =>
    keyPaths(child, prefix ? `${prefix}.${key}` : key),
  );
}

test("both languages carry exactly the same notebook-share copy keys", () => {
  assert.deepEqual(
    keyPaths(NOTEBOOK_SHARE_COPY.ja).sort(),
    keyPaths(NOTEBOOK_SHARE_COPY.en).sort(),
  );
});

test("no Japanese value is a copy of the English one, except the product name", () => {
  const en = NOTEBOOK_SHARE_COPY.en as unknown as Record<string, Record<string, unknown>>;
  const ja = NOTEBOOK_SHARE_COPY.ja as unknown as Record<string, Record<string, unknown>>;
  for (const section of Object.keys(en)) {
    for (const key of Object.keys(en[section])) {
      const a = en[section][key];
      const b = ja[section][key];
      if (typeof a !== "string") continue;
      if (a === "Leona Quantum") continue;
      assert.notEqual(b, a, `${section}.${key} is untranslated`);
    }
  }
});

test("the Japanese function-valued entries render with real interpolated text, not a template literal", () => {
  const ja = NOTEBOOK_SHARE_COPY.ja;
  assert.equal(ja.dialog.tail("Ab3d"), "末尾: Ab3d");
  assert.equal(ja.dialog.createdAt("1月1日"), "作成: 1月1日");
});
