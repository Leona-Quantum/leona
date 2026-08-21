/**
 * `Permissions-Policy` (05-security.md §1 platform+edge).
 *
 * Denies the powerful browser features this product never asks for, so an
 * injected script cannot ask for them either — a prompt that says "leonaqt.com
 * wants to use your camera" carries this origin's name, and the CSP admits
 * `'unsafe-inline'` script by necessity (see `content-security-policy.ts`), so
 * "an injected script" is the threat this actually narrows rather than a
 * hypothetical one.
 *
 * ## An ALLOWLIST by omission, not a blanket `*=()`
 *
 * Every feature in `DENIED` is refused outright. Every feature NOT named keeps
 * whatever the browser's own default for THAT feature is — which is usually
 * `self` but is set per feature, not globally, so this deliberately does not
 * claim to know it.
 *
 * That distinction is the whole reason this is safe to ship near a launch, and
 * it has already earned its keep twice:
 *
 * - `clipboard-write` is absent because four copy-code buttons depend on it
 *   (repository-entry-view, studio-workspace, artifact-detail, live-run). A
 *   blanket denial would have broken all four silently — the write rejects, the
 *   button reports nothing, and no check in this repo clicks one.
 * - `fullscreen` is absent because the Atlas map is the kind of view that grows
 *   a fullscreen control, and denying it pre-emptively would make that a
 *   debugging session rather than a feature.
 *
 * ## Why this is a module rather than a literal in `next.config.ts`
 *
 * Because until the demo video was added, nothing anywhere asserted a single
 * character of this header. It was the one security header in the response with
 * no test, which is how `autoplay` below came to be a live defect nobody had a
 * way to notice. `content-security-policy.ts` is the sibling this now matches.
 */

/**
 * Features refused for every origin, this one included.
 *
 * Sorted, and kept that way: the header is read by a person comparing it
 * against a scanner's output, and an unsorted list makes that a diff by eye.
 */
export const DENIED_FEATURES = [
  "accelerometer",
  // Opts this origin out of Topics/FLoC ad-interest inference. Harmless here,
  // and it stops the browser inferring interests from what a visitor reads on
  // the Atlas.
  "browsing-topics",
  "camera",
  "display-capture",
  "encrypted-media",
  "geolocation",
  "gyroscope",
  "magnetometer",
  "microphone",
  "midi",
  "payment",
  "picture-in-picture",
  "usb",
  "xr-spatial-tracking",
] as const;

/**
 * Features this origin may use, and no other may.
 *
 * ## `autoplay`, and the bug that put it here
 *
 * This header shipped with `autoplay=()`, which denies the feature to
 * EVERYONE — this origin included. That was correct while the site had no
 * media at all. The landing page now carries a muted, looping, inline product
 * demo, and under `autoplay=()` a browser ignores the `autoplay` attribute
 * outright: the reader gets a poster frame and a play button, and the video
 * only ever starts on a click.
 *
 * Measured rather than reasoned about, on leonaqt.com in Chrome:
 *
 * ```
 * document.featurePolicy.allowsFeature('autoplay')          // false
 * document.featurePolicy.allowsFeature('fullscreen')        // true
 * document.featurePolicy.allowsFeature('clipboard-write')   // true
 * document.featurePolicy.allowsFeature('camera')            // false
 * ```
 *
 * The two `true`s are the control: they confirm the reading is of this header's
 * allowlist-by-omission and not of some blanket denial, so the `false` on
 * `autoplay` is this line and nothing else.
 *
 * `(self)` rather than deleting the entry. Deleting it would fall back to the
 * browser's own default for autoplay — which is `self` today in every engine
 * that implements this, but is a default rather than a decision, and would
 * carry no record of having been considered. `(self)` also stays strictly
 * tighter than the default in one respect that matters: any future
 * cross-origin `<iframe>` on this site is refused autoplay explicitly.
 *
 * The security cost is close to nil. Autoplay is an annoyance vector, not a
 * data one, and `media-src` falls through to `default-src 'self'`, so the only
 * media a page here can play at all is media this origin served.
 */
export const SELF_ONLY_FEATURES = ["autoplay"] as const;

/** The header value, built so the two lists cannot drift out of the string. */
export function permissionsPolicy(): string {
  return [
    ...DENIED_FEATURES.map((feature) => `${feature}=()`),
    ...SELF_ONLY_FEATURES.map((feature) => `${feature}=(self)`),
  ].join(", ");
}
