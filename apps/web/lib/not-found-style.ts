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
 * give `sha256-1SpxNHCaVb3/mA8ghPVixDEtdss1k/cptw3ioCotrHg=`. React writes the
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

 *
 * ## It keys on the SHELL now, and it did not before
 *
 * These three rules used to name `.mj-not-found-copy` — the 404's own headline
 * and paragraph — and the page rendered exactly one set of site chrome, in
 * English, around whichever copy survived. Read as a visitor with the locale
 * cookie set to `ja` on 2026-08-27: the heading was
 * 「このページは存在しません。」 and every
 * word around it was English — the nav, the footer, and the language control,
 * which showed **EN** as the selected language to a reader whose setting is
 * Japanese. That last one is not an untranslated string; it is the control
 * telling the reader the opposite of what is true.
 *
 * `PublicSite` already stamps `lang` on the `<main>` it renders, so keying on
 * the shell rather than on the copy needs no new attribute and no wrapper: the
 * page renders the whole shell twice, once per locale, and these rules hide one.
 * The mechanism is unchanged and so is the reason it has to be CSS — the global
 * 404 is served from the CDN to every unmatched URL at once (`x-vercel-cache:
 * HIT`, same body for two different paths, measured), so no server render can
 * know who is reading it.
 *
 * ## Two rules, not three, and the third one was a hazard
 *
 * The earlier form hid `[lang="ja"]` unconditionally and then un-hid it with
 * `display: revert` under `html[lang="ja"]`. That works and it is brittle in a
 * way nothing would report: `revert` discards the AUTHOR value, so the day
 * `.mj-public-site` gains a `display` — a flex or grid shell is an ordinary
 * thing to add — the Japanese 404 would silently lay out as a plain block while
 * the English one did not, and only a Japanese reader would ever see it. Hiding
 * each side under a selector that excludes the other never has to un-hide
 * anything, so no author value is ever thrown away.
 *
 * Both rules fail SAFE. `<html lang>` is `en` in the served bytes and only the
 * pre-paint script in `components/root-document.tsx` makes it `ja`, so a reader
 * with the script blocked, with cookies off, or with no cookie at all gets the
 * English shell — which is the fallback the server would have chosen anyway.
 */
export const NOT_FOUND_LOCALE_STYLE = `
  html:not([lang="ja"]) .mj-not-found-site[lang="ja"] { display: none; }
  html[lang="ja"] .mj-not-found-site[lang="en"] { display: none; }
`;
