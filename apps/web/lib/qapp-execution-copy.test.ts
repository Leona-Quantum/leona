import assert from "node:assert/strict";
import test from "node:test";

import { executionErrorSentence } from "./qapp-execution-copy.ts";

test("every code the worker writes reads as a sentence, not an identifier", () => {
  for (const code of ["qapp_program_failed", "qapp_result_missing", "qapp_execution_failed", "job_dead_letter"]) {
    const sentence = executionErrorSentence(code);
    assert.doesNotMatch(sentence, /_/, `${code} leaked as an identifier: ${sentence}`);
    assert.match(sentence, /\.$/, `${code} is not a sentence: ${sentence}`);
  }
});

test("an unmapped code stays visible so it can be reported, and no code means a plain failure", () => {
  assert.equal(executionErrorSentence("qapp_new_code"), "Execution failed (qapp_new_code).");
  assert.equal(executionErrorSentence(null), "Execution failed.");
  assert.equal(executionErrorSentence(undefined), "Execution failed.");
});
