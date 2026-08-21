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

test("the landing demo asks for no feature this header refuses", () => {
  // The connection nothing made before. The demo starts itself with a bare
  // `play()` and no user gesture, which is exactly what the `autoplay` feature
  // governs — so if that feature ever returns to the denied list, the video
  // stops starting and this fails instead of shipping silently.
  const video = readFileSync(join(WEB_ROOT, "components", "landing-demo-video.tsx"), "utf8");
  const asked = new Set<string>();
  if (/\.play\(\)/.test(video) || /\bautoPlay\b/.test(video)) asked.add("autoplay");
  if (/requestPictureInPicture/.test(video)) asked.add("picture-in-picture");
  if (/requestFullscreen/.test(video)) asked.add("fullscreen");

  assert.ok(asked.size > 0, "the demo no longer asks for any feature — this guard is inert");
  for (const feature of asked) {
    assert.equal(
      DENIED_FEATURES.includes(feature as (typeof DENIED_FEATURES)[number]),
      false,
      `the landing demo uses ${feature}, which this header denies outright`,
    );
  }

  // Positive control: the element really is there, and the page really renders
  // it. Without these two a future removal would turn the case above into a
  // statement about nothing without saying so.
  assert.match(video, /<video\b/, "landing-demo-video.tsx no longer renders a video");
  const page = readFileSync(join(WEB_ROOT, "app", "[locale]", "page.tsx"), "utf8");
  assert.match(page, /<LandingDemoVideo\b/, "the landing page no longer renders the demo");
});

test("the demo does not autoplay past a reader who asked for less motion", () => {
  // CSS cannot stop a video, so the reduced-motion rules in globals.css do not
  // reach this and the check has to be on the component. Two halves: it must
  // consult the preference, and the markup must carry no `autoplay` attribute —
  // an attribute would start playback before the preference could be read,
  // which is the flash of motion this exists to prevent.
  const video = readFileSync(join(WEB_ROOT, "components", "landing-demo-video.tsx"), "utf8");
  assert.match(video, /prefers-reduced-motion: reduce/, "the demo no longer consults the preference");
  assert.match(video, /addEventListener\("change"/, "the preference is read once and never re-read");
  // The RENDERED markup only. The doc comment above it names the attribute it
  // is explaining, and a whole-file search reads that as the defect.
  const markup = video.slice(video.indexOf("return ("));
  assert.ok(markup.includes("<video"), "could not locate the rendered markup");
  assert.doesNotMatch(
    markup,
    /\bautoPlay\b/,
    "the markup carries an `autoplay` attribute, which plays before the preference is read",
  );
  assert.doesNotMatch(markup, /\bloop\b/, "`loop` in the markup loops regardless of the preference");
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
