import assert from "node:assert/strict";
import test from "node:test";

import { QAPP_COPY } from "./qapp-copy.ts";
import { executionErrorSentence } from "./qapp-execution-copy.ts";

function keyPaths(value: unknown, prefix = ""): string[] {
  if (typeof value !== "object" || value === null) return [prefix];
  return Object.entries(value).flatMap(([key, child]) => keyPaths(child, prefix ? `${prefix}.${key}` : key));
}

test("both languages carry exactly the same Qapp copy keys", () => {
  assert.deepEqual(keyPaths(QAPP_COPY.ja).sort(), keyPaths(QAPP_COPY.en).sort());
});

test("no Japanese value is a copy of the English one, except the product names", () => {
  const en = QAPP_COPY.en as unknown as Record<string, Record<string, unknown>>;
  const ja = QAPP_COPY.ja as unknown as Record<string, Record<string, unknown>>;
  for (const section of Object.keys(en)) {
    for (const key of Object.keys(en[section])) {
      const a = en[section][key];
      const b = ja[section][key];
      if (typeof a !== "string") continue;
      if (a === "Qapp" || a === "Leona Quantum") continue;
      assert.notEqual(b, a, `${section}.${key} is untranslated`);
    }
  }
});

test("execution error sentences exist in both languages for every code the worker writes", () => {
  for (const code of ["qapp_program_failed", "qapp_result_missing", "qapp_execution_failed", "job_dead_letter"]) {
    const en = executionErrorSentence(code, "en");
    const ja = executionErrorSentence(code, "ja");
    assert.doesNotMatch(en, /_/);
    assert.doesNotMatch(ja, /_/);
    assert.notEqual(ja, en, `${code} is untranslated`);
  }
  assert.equal(executionErrorSentence("qapp_new_code", "ja"), "実行に失敗しました (qapp_new_code)。");
});
