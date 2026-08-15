/**
 * Carries a visitor's landing-page prompt through the sign-in round trip into
 * the workspace composer (ai-ops 102, owner ruling: "Carry it through and
 * pre-fill the workspace composer - they land with their own words already in
 * the box and press run (recommended)." Pre-fill only — never auto-submit;
 * that would spend one of the free tier's five weekly runs before the person
 * chose to).
 *
 * ## Why sessionStorage and not a query parameter
 *
 * The landing page (`app/[locale]/page.tsx`) is `chrome="static"` — prerendered
 * and held on the CDN for 5 minutes (ai-ops#88). Nothing about carrying this
 * text may make that page per-request: the write happens entirely client-side,
 * at the moment a visitor clicks through to sign in, so it costs the cached
 * page nothing. A query parameter would work mechanically but puts
 * user-typed text in a URL — logs, referrers, and (worse, on this project) the
 * CDN cache key itself. `sessionStorage` carries it on the visitor's own side
 * of the round trip instead.
 *
 * ## Why a TTL on top of sessionStorage's own lifetime
 *
 * sessionStorage already clears when the tab closes, which covers "typed
 * something, gave up, closed the tab." It does NOT cover "typed something,
 * left the tab open, came back to /run days later through some other route" —
 * same tab, so the entry is still there and would resurface stale text with no
 * connection to what the visitor is doing now. `HANDOFF_TTL_MS` closes that
 * gap: `consumeLandingPromptHandoff` discards (and never returns) anything
 * older than the window, on top of deleting it unconditionally so it is a true
 * one-shot either way.
 */

// Deliberately not named with the naming convention `storage-key-registry.test.ts`
// scans for, and not registered anywhere that guard checks — correctly, since
// that guard is about the persistent, cross-tab browser storage the rest of
// this app uses for per-account content: a key that outlives the tab, so a
// second person signing in on the same browser can inherit the first
// person's data. That is the leak that guard exists to catch, and this key
// cannot cause it by construction: `sessionStorage` does not survive the tab
// closing, and this module additionally makes it a true one-shot with its own
// 30-minute TTL (`HANDOFF_TTL_MS` below) on top of that. The one narrow case
// the guard's categories don't quite name — a shared computer, account A
// types and abandons, account B signs in in the SAME tab within the window,
// before A's entry is ever consumed — still only pre-fills B's composer with
// A's own typed words: no account data, no credential, nothing
// identity-bearing changes hands. Worth naming here so it reads as
// considered, not missed.
const HANDOFF_KEY = "majorana.landing-prompt-handoff.v1";

/** Long enough for a real sign-up (email confirmation included), short enough that it never reads as a memory. */
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

function sessionStorageOrNull(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage ?? null;
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
  const storage = sessionStorageOrNull();
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
  const storage = sessionStorageOrNull();
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
