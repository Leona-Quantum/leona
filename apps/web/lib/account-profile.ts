/**
 * Every account carries a real first and last name (Owner Inbox 2026-07-27).
 *
 * WorkOS leaves `firstName`/`lastName` null for email-only sign-ups, and social
 * providers are inconsistent about surnames — GitHub in particular often has
 * neither. So the identity provider cannot be relied on to enforce this; the app
 * has to. `hasCompleteProfileName` is the gate the authenticated layout applies,
 * and anyone failing it is sent to /welcome before they see the workspace.
 *
 * ## What is deliberately NOT validated
 *
 * Nothing here title-cases, reorders, or otherwise rewrites what someone typed,
 * for the same reason `account-identity.ts` does not: capitalising a name you
 * did not parse is how "de Vries" becomes "De Vries". Digits, apostrophes,
 * hyphens and every script are accepted. The only rejections are the ones that
 * mean "this is not a name at all": empty, too long, control characters, or no
 * letter in any script.
 */

/** Long enough for a full legal name in any script; short enough to render. */
export const MAX_PROFILE_NAME_LENGTH = 60;

/** C0 and C1 control characters. Not names, and they break line layout. */
const CONTROL_CHARACTERS = /[\x00-\x1f\x7f-\u009f]/u;

/** At least one letter, in any script — rejects "123" and "...". */
const HAS_LETTER = /\p{L}/u;

/**
 * Collapse internal whitespace and trim. Applied before both validation and
 * storage so "  Anne   Marie " and "Anne Marie" are the same name, and so the
 * length limit measures the name rather than the padding.
 */
export function normalizeProfileName(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

export function isValidProfileName(value: string): boolean {
  const normalized = normalizeProfileName(value);
  if (!normalized || normalized.length > MAX_PROFILE_NAME_LENGTH) return false;
  if (CONTROL_CHARACTERS.test(normalized)) return false;
  return HAS_LETTER.test(normalized);
}

/**
 * Whether an identity already satisfies the requirement.
 *
 * Uses the same validation as the form rather than a bare null check: an
 * account whose provider handed us a single space for a surname must not walk
 * past a gate the form itself would reject.
 */
export function hasCompleteProfileName(user: {
  firstName?: string | null;
  lastName?: string | null;
}): boolean {
  return isValidProfileName(user.firstName ?? "") && isValidProfileName(user.lastName ?? "");
}
