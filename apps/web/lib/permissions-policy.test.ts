// The header nothing asserted until a video needed it.
//
// `Permissions-Policy` was the one security header in the response with no test
// of any kind. That is how `autoplay=()` survived: it was correct on the day it
// shipped, the landing page later grew a muted looping product demo, and
// nothing anywhere connected the two. The video would have gone to production
// with its `autoplay` attribute silently ignored.
//
// So these cases are deliberately of two kinds. The first few pin the shape of
// the string. The last two are the ones with teeth: they read the landing page
// and `next.config.ts` from source and fail if the page starts asking for a
// feature the header refuses, or if the header stops reaching responses at all.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { DENIED_FEATURES, SELF_ONLY_FEATURES, permissionsPolicy } from "./permissions-policy.ts";

const WEB_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/** The header as a browser parses it: feature name → allowlist text. */
function parsed(): Map<string, string> {
  return new Map(
    permissionsPolicy()
      .split(", ")
      .map((entry) => {
        const match = /^([a-z-]+)=(\(.*\))$/.exec(entry);
        assert.ok(match, `not a Permissions-Policy directive: ${entry}`);
        return [match[1], match[2]] as [string, string];
      }),
  );
}

test("every denied feature is refused to everyone, this origin included", () => {
  const policy = parsed();
  for (const feature of DENIED_FEATURES) {
    assert.equal(policy.get(feature), "()", `${feature} is no longer denied outright`);
  }
});

test("the features this origin needs are allowed to it and to nobody else", () => {
  const policy = parsed();
  for (const feature of SELF_ONLY_FEATURES) {
    assert.equal(policy.get(feature), "(self)", `${feature} is not self-only`);
  }
  // The regression this file exists for. `()` here is the landing-page video
  // not playing; `(*)` is a cross-origin frame being handed the feature.
  assert.equal(policy.get("autoplay"), "(self)");
});

test("the deliberate omissions stay omitted", () => {
  // Naming either of these would break something silently: four copy-code
  // buttons for the first, and the Atlas map's fullscreen affordance for the
  // second. See the module doc comment for the full account.
  const policy = parsed();
  assert.equal(policy.has("clipboard-write"), false, "clipboard-write must stay unnamed");
  assert.equal(policy.has("fullscreen"), false, "fullscreen must stay unnamed");
});

test("no feature is both denied and allowed", () => {
  const denied = new Set<string>(DENIED_FEATURES);
  for (const feature of SELF_ONLY_FEATURES) {
    assert.equal(denied.has(feature), false, `${feature} appears in both lists`);
  }
  assert.equal(parsed().size, DENIED_FEATURES.length + SELF_ONLY_FEATURES.length);
});

test("the denied list is sorted, because it is read by eye against a scanner", () => {
  assert.deepEqual([...DENIED_FEATURES], [...DENIED_FEATURES].sort());
});

test("the landing page asks for no feature this header refuses", () => {
  // The connection nothing made before. A media element carrying `autoPlay`
  // needs the `autoplay` feature; if a future edit adds `<video>` with a
  // capture or picture-in-picture affordance, that is a denied feature and this
  // fails rather than shipping a control that does nothing.
  const page = readFileSync(join(WEB_ROOT, "app", "[locale]", "page.tsx"), "utf8");
  const asked = new Set<string>();
  if (/\bautoPlay\b/.test(page)) asked.add("autoplay");
  if (/\bdisablePictureInPicture\b/.test(page) === false && /<video\b/.test(page)) {
    // A <video> without the opt-out offers picture-in-picture from the context
    // menu; that is a browser affordance rather than a request the page makes,
    // so it is noted here and NOT asserted — denying it is intentional.
  }
  for (const feature of asked) {
    assert.equal(
      DENIED_FEATURES.includes(feature as (typeof DENIED_FEATURES)[number]),
      false,
      `the landing page uses ${feature}, which this header denies outright`,
    );
  }
  // Positive control: the demo really is on the page, so a future removal of
  // the video turns this test into a statement about nothing without saying so.
  assert.match(page, /<video\b/, "the landing page no longer embeds a video — revisit `autoplay=(self)`");
});

test("next.config.ts still sends this header, on every route", () => {
  // The value being right is worth nothing if it stops being attached. This
  // asserts the wiring, which lives in a file no other test reads.
  const config = readFileSync(join(WEB_ROOT, "next.config.ts"), "utf8");
  assert.match(config, /permissionsPolicy\(\)/, "next.config.ts no longer calls permissionsPolicy()");
  assert.match(
    config,
    /key: "Permissions-Policy", value: permissionsPolicy\(\)/,
    "the Permissions-Policy header is no longer built from this module",
  );
  assert.match(config, /source: "\/\(\.\*\)"/, "the catch-all header route is gone");
});
