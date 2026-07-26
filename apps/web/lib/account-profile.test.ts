import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_PROFILE_NAME_LENGTH,
  hasCompleteProfileName,
  isValidProfileName,
  normalizeProfileName,
} from "./account-profile.ts";

test("normalizing collapses padding without rewriting the name", () => {
  assert.equal(normalizeProfileName("  Anne   Marie  "), "Anne Marie");
  assert.equal(normalizeProfileName("\tvan der\nBerg "), "van der Berg");
  // Case is left exactly as typed — this is the same rule account-identity.ts
  // follows, and the reason "de Vries" does not become "De Vries".
  assert.equal(normalizeProfileName("de Vries"), "de Vries");
});

test("names people actually have are accepted", () => {
  for (const name of [
    "Eshaan",
    "Mistry",
    "Anne-Marie",
    "O'Neill",
    "van der Berg",
    "de la Cruz",
    "李",
    "山田",
    "Ægir",
    "Björk",
    "Nguyễn",
    "محمد",
    "Παπαδόπουλος",
    "X Æ A-12",
  ]) {
    assert.equal(isValidProfileName(name), true, name);
  }
});

test("things that are not names are rejected", () => {
  for (const value of ["", "   ", "\t\n", "123", "...", "-", "  -  "]) {
    assert.equal(isValidProfileName(value), false, JSON.stringify(value));
  }
});

test("control characters are rejected even when wrapped in a real name", () => {
  assert.equal(isValidProfileName("Esh\u0000aan"), false);
  assert.equal(isValidProfileName("Eshaan\u001B"), false);
  assert.equal(isValidProfileName("Esh\u0085aan"), false);
});

test("the length limit measures the name, not the padding", () => {
  const atLimit = "a".repeat(MAX_PROFILE_NAME_LENGTH);
  assert.equal(isValidProfileName(atLimit), true);
  assert.equal(isValidProfileName(`   ${atLimit}   `), true);
  assert.equal(isValidProfileName(`${atLimit}a`), false);
});

test("the gate needs both halves, and holds them to the same standard as the form", () => {
  assert.equal(hasCompleteProfileName({ firstName: "Eshaan", lastName: "Mistry" }), true);
  assert.equal(hasCompleteProfileName({ firstName: "Eshaan", lastName: null }), false);
  assert.equal(hasCompleteProfileName({ firstName: null, lastName: "Mistry" }), false);
  assert.equal(hasCompleteProfileName({}), false);
  // A provider that hands back a single space must not walk past a gate the
  // form itself would reject.
  assert.equal(hasCompleteProfileName({ firstName: "Eshaan", lastName: " " }), false);
});

test("the lock and local-dev identities already satisfy the gate", () => {
  // Both are synthetic and have no WorkOS user to update, so a gate they failed
  // would strand the operator on a page that cannot save.
  assert.equal(hasCompleteProfileName({ firstName: "Leona", lastName: "Quantum" }), true);
  assert.equal(hasCompleteProfileName({ firstName: "Local", lastName: "developer" }), true);
});
