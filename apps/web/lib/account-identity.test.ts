import assert from "node:assert/strict";
import test from "node:test";
import { accountFirstName, accountInitials } from "./account-identity.ts";

test("a full name gives first and last initials", () => {
  assert.equal(accountInitials("Eshaan Mistry"), "EM");
  assert.equal(accountFirstName("Eshaan Mistry"), "Eshaan");
});

test("a single name gives one initial, not two letters of the same word", () => {
  assert.equal(accountInitials("Eshaan"), "E");
  assert.equal(accountFirstName("Eshaan"), "Eshaan");
});

test("an email local part reads as a name", () => {
  // accountName() in the app layout falls back to the local part whenever WorkOS
  // leaves firstName/lastName null, so this is the common signed-up-by-email case.
  assert.equal(accountInitials("eshaan.mistry"), "EM");
  assert.equal(accountFirstName("eshaan.mistry"), "eshaan");
  assert.equal(accountInitials("eshaan_mistry"), "EM");
});

test("a hyphenated given name stays one name", () => {
  // Splitting on the hyphen would render "AMS" for a two-part name.
  assert.equal(accountInitials("Anne-Marie Smith"), "AS");
  assert.equal(accountFirstName("Anne-Marie Smith"), "Anne-Marie");
});

test("a middle name does not take the second slot", () => {
  assert.equal(accountInitials("Ada Byron Lovelace"), "AL");
});

test("a name with no spaces gives one glyph and is not rewritten", () => {
  assert.equal(accountInitials("山田太郎"), "山");
  assert.equal(accountFirstName("山田太郎"), "山田太郎");
});

test("an astral first character survives", () => {
  // slice(0, 1) would return half a surrogate pair and render as U+FFFD.
  assert.equal(accountInitials("𠮷田"), "𠮷");
});

test("the name is never title-cased, only the initials", () => {
  assert.equal(accountFirstName("de Vries"), "de");
  assert.equal(accountInitials("de Vries"), "DV");
});

test("an empty name yields empty initials rather than a stray character", () => {
  assert.equal(accountInitials("   "), "");
  assert.equal(accountInitials(""), "");
});

test("surrounding and repeated separators do not produce blank initials", () => {
  assert.equal(accountInitials("  Eshaan   Mistry  "), "EM");
  assert.equal(accountInitials("eshaan..mistry"), "EM");
});
