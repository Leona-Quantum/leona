/**
 * Carries a visitor's landing-page prompt through the sign-in round trip into
 * the workspace composer (ai-ops 102, owner ruling: "Carry it through and
 * pre-fill the workspace composer - they land with their own words already in
 * the box and press run (recommended)." Pre-fill only — never auto-submit;
 * that would spend one of the free tier's five weekly runs before the person
 * chose to).
 *
 * ## Why browser storage and not a query parameter
 *
 * The landing page (`app/[locale]/page.tsx`) is `chrome="static"` — prerendered
 * and held on the CDN for 5 minutes (ai-ops#88). Nothing about carrying this
 * text may make that page per-request: the write happens entirely client-side,
 * at the moment a visitor clicks through to sign in, so it costs the cached
 * page nothing. A query parameter would work mechanically but puts
 * user-typed text in a URL — logs, referrers, and (worse, on this project) the
 * CDN cache key itself. Browser storage carries it on the visitor's own side of
 * the round trip instead.
 *
 * ## Why localStorage and not sessionStorage (ai-ops 102)
 *
 * This shipped on `sessionStorage` and that was wrong for the one case it was
 * built for. sessionStorage is scoped to a *browsing context*, not a browser:
 * a brand-new signup gets an email verification link, and clicking a link in a
 * mail client opens a NEW tab — where the sessionStorage the landing page wrote
 * does not exist at all. So the returning-visitor path worked (verified: the
 * value survives the WorkOS round trip in the same tab) and the new-user path,
 * the entire point of the feature, silently lost the prompt. localStorage is
 * shared across tabs of the same origin, so the new tab can read it.
 *
 * What this cannot fix, and nothing on our side can: a visitor who opens the
 * verification email on a *different device*. That is a different browser with
 * different storage, and the prompt is genuinely gone.
 *
 * ## Why a TTL, and why it matters more now
 *
 * sessionStorage used to clear itself when the tab closed. localStorage does
 * not clear at all, so `HANDOFF_TTL_MS` is no longer a refinement on top of a
 * lifetime — it IS the lifetime, and it is the only thing standing between this
 * and a stale prompt resurfacing days later with no connection to what the
 * visitor is doing now. `consumeLandingPromptHandoff` discards anything past
 * the window, on top of deleting the entry unconditionally so it is a true
 * one-shot whether or not it is returned.
 */

// Registered in `DEVICE_STORAGE_KEYS` (lib/user-storage.ts), which is what
// `storage-key-registry.test.ts` requires of any localStorage key. The earlier
// version of this file argued its way OUT of that registry on the grounds that
// sessionStorage cannot outlive a tab; moving to localStorage removes that
// argument, so the key is now classified explicitly rather than exempted.
//
// It is device-level rather than per-account on purpose: it is written by a
// signed-OUT visitor on a prerendered page, where no account scope exists to
// write it under. The residual case is a shared computer where A types, walks
// away, and B signs in within 30 minutes before A's entry is consumed — B's
// composer is pre-filled with A's own typed words. No account data, no
// credential, nothing identity-bearing changes hands, and the one-shot delete
// plus the TTL below bound it. Named here so it reads as considered, not missed.
const HANDOFF_KEY = "majorana.landing-prompt-handoff.v1";

/**
 * Long enough for a real sign-up (email confirmation included), short enough
 * that it never reads as a memory. On localStorage this is load-bearing rather
 * than belt-and-braces — see the module comment.
 */
const HANDOFF_TTL_MS = 30 * 60 * 1000;

/**
 * No `maxLength` exists on the workspace composer's textarea, and
 * `task_prompt` carries no length constraint in the Python contracts either —
 * both were checked, neither exists. This is therefore a defensive cap this
 * change introduces, not a limit it inherited from somewhere else: it exists
 * only to stop a pathological paste from riding through untruncated, and
 * should not be read as a mirrored business rule.
 */
const HANDOFF_MAX_LENGTH = 4000;

interface StoredHandoff {
  text: string;
  ts: number;
}

function handoffStorageOrNull(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage ?? null;
  } catch {
    // Safari private mode and blocked storage contexts throw on access.
    return null;
  }
}

/**
 * Called once, at the moment a visitor clicks through to sign in — not
 * earlier (opening the dialog commits nothing) and not on every keystroke.
 * Overwrites any prior entry outright: a visitor who types, signs in, returns
 * to the landing page and types something different gets the SECOND prompt,
 * never a stale first one alongside it.
 *
 * Blank or whitespace-only input clears any existing entry instead of writing
 * one — carrying nothing is correct here, not carrying an empty composer that
 * then looks broken.
 */
export function writeLandingPromptHandoff(text: string): void {
  const storage = handoffStorageOrNull();
  if (!storage) return;
  const trimmed = text.trim();
  try {
    if (!trimmed) {
      storage.removeItem(HANDOFF_KEY);
      return;
    }
    const payload: StoredHandoff = {
      text: trimmed.slice(0, HANDOFF_MAX_LENGTH),
      ts: Date.now(),
    };
    storage.setItem(HANDOFF_KEY, JSON.stringify(payload));
  } catch {
    // Quota exceeded or storage disabled mid-session — the pre-fill is a
    // convenience, never worth failing the sign-in flow over.
  }
}

/**
 * Reads the carried prompt, if any, and deletes it — a true one-shot. Called
 * once on the workspace's first client render. Returns `null` for: nothing
 * stored, a blank/whitespace entry (should not have been written, but a
 * reader here costs nothing to be defensive about), anything past
 * `HANDOFF_TTL_MS`, or a payload that fails to parse as the expected shape.
 */
export function consumeLandingPromptHandoff(): string | null {
  const storage = handoffStorageOrNull();
  if (!storage) return null;
  try {
    const raw = storage.getItem(HANDOFF_KEY);
    if (raw === null) return null;
    storage.removeItem(HANDOFF_KEY);
    const parsed = JSON.parse(raw) as Partial<StoredHandoff>;
    if (typeof parsed.text !== "string" || typeof parsed.ts !== "number") return null;
    const trimmed = parsed.text.trim();
    if (!trimmed) return null;
    if (Date.now() - parsed.ts > HANDOFF_TTL_MS) return null;
    return trimmed;
  } catch {
    return null;
  }
}
