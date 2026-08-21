/**
 * Guards the share card against the failure that produced it.
 *
 * `app/opengraph-image.tsx` generates a correct 1200x630 PNG and Next serves it
 * at `/opengraph-image`. That was true and `og:image` still appeared on **no
 * page at all**, because Next merges `openGraph` as a whole object rather than
 * field by field: every public page exports its own through
 * `canonicalMetadata()`, which replaced the inherited file-convention image and
 * took the card with it.
 *
 * The image route returning 200 is therefore not evidence of anything a reader
 * or a crawler sees. What matters is that the page metadata carries it, and
 * that is what these assert.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { canonicalMetadata, OG_IMAGE, SITE_NAME } from "./public-metadata.ts";

test("every public page's metadata carries the share card", () => {
  const meta = canonicalMetadata("/pricing");
  const images = meta.openGraph && "images" in meta.openGraph ? meta.openGraph.images : undefined;

  assert.ok(images, "openGraph.images is missing — og:image will not render on any public page");
  assert.deepEqual(images, [OG_IMAGE]);
});

test("the card is the size the platforms crop to", () => {
  // Facebook, X, LinkedIn and Slack all document 1200x630. A card that is not
  // this ratio is cropped by each of them differently, which is how a wordmark
  // ends up half out of frame on one network and fine on the others.
  assert.equal(OG_IMAGE.width, 1200);
  assert.equal(OG_IMAGE.height, 630);
  assert.equal(OG_IMAGE.url, "/opengraph-image");
});

test("the card url stays relative so it follows the deployment's origin", () => {
  // Resolved against `metadataBase` in app/layout.tsx. Hard-coding a hostname
  // here would let the card disagree with the canonical redirect, and a crawler
  // that finds og:image on a different origin than og:url treats the pair as
  // suspect rather than merely inconsistent.
  assert.ok(
    OG_IMAGE.url.startsWith("/"),
    `OG_IMAGE.url must be relative to metadataBase, got ${OG_IMAGE.url}`,
  );
  assert.ok(!/^https?:/i.test(OG_IMAGE.url), "OG_IMAGE.url must not hard-code an origin");
});

test("the card has alt text", () => {
  // An OG image is content, and the platforms surface this string to screen
  // readers. An empty alt would be an accessibility regression that nothing
  // else in the suite looks at.
  assert.ok(OG_IMAGE.alt.length > 0);
  assert.match(OG_IMAGE.alt, new RegExp(SITE_NAME));
});

test("canonicalMetadata still states the canonical path it is named for", () => {
  // The image was added to this function's return value; this is the control
  // that adding it did not disturb what the function already did.
  const meta = canonicalMetadata("/repository");
  assert.equal(meta.alternates?.canonical, "/repository");
  assert.equal(meta.openGraph?.url, "/repository");
  assert.equal(meta.openGraph?.siteName, SITE_NAME);
});
