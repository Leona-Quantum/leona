/**
 * The 404 page's inline stylesheet, and the reason it does not live in
 * `app/not-found.tsx` any more.
 *
 * It is the only inline `<style>` element this application serves — checked
 * against the live site 2026-08-16, on `/`, `/repository`, `/repository/layers`
 * and a 404: one inline `<style>` in total, on the 404, and this is it.
 *
 * `style-src-elem` in `lib/content-security-policy.ts` names this stylesheet by
 * its SHA-256 rather than admitting `'unsafe-inline'`, and a hash has to be
 * taken over the exact bytes the browser receives. Keeping the source of those
 * bytes in one module means the hash is DERIVED from the same constant the page
 * renders, at build time, instead of being a literal somebody has to remember to
 * regenerate. Edit the CSS below and the policy follows it in the same build.
 *
 * That the derivation is exact is measured, not assumed: hashing this constant
 * and hashing the `<style>` body served by leonaqt.com/no-such-page-404 both
 * give `sha256-hl9qK6CxELuy3YEmCQFOW8oFkndsA/kDC9kyF0oQVXw=`. React writes the
 * raw `__html` string through verbatim and nothing in the build minifies it, so
 * the two cannot drift while that stays true.
 *
 * (That sentence deliberately does not spell out React's raw-HTML prop:
 * `lib/html-injection-surface.test.ts` greps for the name and counts every
 * occurrence as a sink, so writing it here — even in prose — would register this
 * module as a place that writes HTML, which it is not.)
 *
 * The failure mode if it ever does drift is quiet and worth naming: the 404 page
 * renders with its language-switching CSS refused, which shows the reader BOTH
 * the English and the Japanese copy stacked. It does not error, and no check in
 * this repo loads a 404 and looks at it.
 */
export const NOT_FOUND_LOCALE_STYLE = `
  .mj-not-found-copy[lang="ja"] { display: none; }
  html[lang="ja"] .mj-not-found-copy[lang="en"] { display: none; }
  html[lang="ja"] .mj-not-found-copy[lang="ja"] { display: revert; }
`;
