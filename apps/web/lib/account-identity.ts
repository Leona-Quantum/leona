/**
 * How a person is addressed in the sidebar footer.
 *
 * The owner asked for "initials on name in a circle, then first name · account
 * type". Both halves are derived from one display string, and that string is not
 * guaranteed to be a name at all: `accountName()` in the app layout falls back to
 * the local part of the email address when WorkOS leaves firstName/lastName null,
 * which is the common case for email-only signups. So "eshaan.mistry" has to read
 * as well as "Eshaan Mistry".
 *
 * Nothing here title-cases or otherwise rewrites the name. Capitalising a name
 * you did not parse is how "de Vries" becomes "De Vries"; only the initials are
 * upper-cased, because an initial is a typographic device rather than the name.
 */

/**
 * Word boundaries inside a display name.
 *
 * Whitespace, dots and underscores split, because email local parts use all
 * three. Hyphens deliberately do NOT: "Anne-Marie" is one given name, and
 * splitting it would render "AMS" for "Anne-Marie Smith".
 */
const NAME_SEPARATOR = /[\s._]+/;

function tokens(name: string): string[] {
  return name.trim().split(NAME_SEPARATOR).filter(Boolean);
}

/**
 * First code point of a token, upper-cased.
 *
 * `Array.from` rather than `slice(0, 1)`: a name beginning with an astral
 * character (an emoji, or a less common CJK ideograph) is stored as a surrogate
 * pair, and slicing by UTF-16 unit returns half of one and renders as U+FFFD.
 */
function leadingGlyph(token: string): string {
  return (Array.from(token)[0] ?? "").toUpperCase();
}

/**
 * At most two initials: first and last token.
 *
 * A single token yields a single initial rather than two letters of the same
 * word — "Eshaan" is "E", not "ES". Scripts that do not use spaces (Japanese,
 * Chinese) are one token by construction and correctly give one glyph.
 *
 * Returns "" for an empty or separator-only name; the caller decides what an
 * anonymous avatar looks like.
 */
export function accountInitials(name: string): string {
  const parts = tokens(name);
  if (parts.length === 0) return "";
  if (parts.length === 1) return leadingGlyph(parts[0]);
  return leadingGlyph(parts[0]) + leadingGlyph(parts[parts.length - 1]);
}

/**
 * The name to greet someone by. Falls back to the whole trimmed string so a
 * display name that does not tokenise still renders something.
 */
export function accountFirstName(name: string): string {
  return tokens(name)[0] ?? name.trim();
}
