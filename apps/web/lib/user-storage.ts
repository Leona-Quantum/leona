/**
 * Browser storage, scoped to the signed-in account.
 *
 * Every per-user list in this app — chat history, chat and artifact folders,
 * the local library mirror, Studio circuits and simulations, pins — lived under
 * a fixed key with no identity attached to it. That is invisible while exactly
 * one person can sign in, and becomes a privacy leak the moment public sign-up
 * returns: the second person to use a browser loads the first person's chat
 * titles and prompts out of localStorage before any API call is made.
 *
 * The fix is a suffix, not a rewrite. `scopedStorage` reads and writes
 * `<key>::<scope>` once a scope is set, and the plain key until then.
 *
 * ## Why "until then" is safe
 *
 * The scope is set by `<StorageScope>` in the authenticated layout, from the
 * WorkOS user id. Until it is set — on public pages, and on the very first
 * render of a browser whose data predates PR 162 — the unscoped keys are read,
 * and the adoption below is what moves that data under an owner.
 *
 * That also solves the migration. Data written before PR 162 sits under the
 * unscoped keys. Adopting it into a synthetic identity would have stranded it
 * the day a real WorkOS account signed in — so instead the legacy data waits,
 * and the first real account to sign in on that browser claims it, which on the
 * owner's machine is the owner.
 *
 * ## The claim is once, and recorded
 *
 * `STORAGE_CLAIM_KEY` records which scope adopted the legacy data. A second
 * account signing in on the same browser finds the claim already made and
 * starts empty, rather than inheriting a stranger's history. There is no way to
 * do better client-side: unscoped data carries no owner, so somebody has to be
 * first.
 */

/**
 * Keys holding one person's own content or their view of it. These get the
 * account suffix.
 */
export const SCOPED_STORAGE_KEYS = [
  "majorana.chat-history.v1",
  "majorana.chat-folders.v1",
  "majorana.deleted-chats.v1",
  "majorana.library.v1",
  "majorana.deleted-artifacts.v1",
  "majorana.library-stars.v1",
  "majorana.artifact-folders.v1",
  "majorana.artifact-folder-assignments.v1",
  "majorana.studio-circuits.v2",
  "majorana.studio-simulations.v1",
  "majorana.workspace-pins.v1",
] as const;

/**
 * Keys that belong to the device rather than the person, and stay global on
 * purpose:
 *
 * - `majorana.theme.v1` is read by a blocking inline script in the root layout
 *   before anything knows who is signed in; scoping it would reintroduce the
 *   flash of the wrong theme it exists to prevent.
 * - `majorana.sidebar-collapsed.v1` is a viewport preference, not content.
 * - `majorana.public-repository-stars.v1` bookmarks the PUBLIC corpus from
 *   pages that render while signed out and are outside the authenticated
 *   layout, so no scope is in effect there. Scoping it would make the same
 *   stars appear or vanish depending on whether the visitor arrived by client
 *   navigation or a fresh page load — worse than leaving it a device
 *   preference. It carries no prompts, titles, or private content.
 */
export const DEVICE_STORAGE_KEYS = [
  "majorana.theme.v1",
  "majorana.sidebar-collapsed.v1",
  "majorana.public-repository-stars.v1",
] as const;

/** Records the scope that adopted the pre-scoping (unscoped) data, once. */
export const STORAGE_CLAIM_KEY = "majorana.storage-claim.v1";

let activeScope: string | null = null;

function storageOrNull(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage ?? null;
  } catch {
    // Safari in private mode and blocked third-party contexts throw on access.
    return null;
  }
}

/**
 * Point storage at an account, adopting any pre-scoping data the first time.
 *
 * Called during render (not in an effect) by an ancestor of every consumer, so
 * it has already run by the time any child's state initializer or effect reads
 * storage. Idempotent: re-running with the same scope does nothing, which is
 * what makes a render-time call safe under StrictMode's double invocation.
 *
 * Pass `null` to mean "no identity in effect" — a public page, or a user the
 * layout could not resolve an id for. Storage then uses the unscoped keys,
 * unchanged.
 */
export function setStorageScope(
  scope: string | null,
  options: { mayAdoptLegacyData?: boolean } = {},
): void {
  if (typeof window === "undefined") return;
  const next = scope?.trim() || null;
  if (next === activeScope) return;
  activeScope = next;
  // A shared workspace never claims the pre-scoping data. It was written by one
  // person before workspaces were plural, so it belongs in the workspace they
  // own; adopting it into a shared one would move their prompts and chat titles
  // into a tenant other people can read. Defaults to true so every existing
  // caller behaves exactly as it did.
  if (next && options.mayAdoptLegacyData !== false) adoptLegacyData(next);
}

export function currentStorageScope(): string | null {
  return activeScope;
}

/** Test seam: forget the scope without running a migration. */
export function resetStorageScopeForTests(): void {
  activeScope = null;
}

export function scopedStorageKey(key: string): string {
  return activeScope ? `${key}::${activeScope}` : key;
}

/**
 * `localStorage` with the account suffix applied. A drop-in for the
 * `window.localStorage` calls these modules used to make directly — same
 * signatures, same "storage is a convenience, never fail the UI" behaviour.
 */
export const scopedStorage = {
  getItem(key: string): string | null {
    const storage = storageOrNull();
    if (!storage) return null;
    try {
      return storage.getItem(scopedStorageKey(key));
    } catch {
      return null;
    }
  },
  /**
   * Returns whether the write landed. Callers like `saveStoredCircuit` report
   * success to the UI from this: swallowing a quota error here and returning
   * void would turn a failed save into a silent one.
   */
  setItem(key: string, value: string): boolean {
    const storage = storageOrNull();
    if (!storage) return false;
    try {
      storage.setItem(scopedStorageKey(key), value);
      return true;
    } catch {
      // Quota exceeded, or storage disabled mid-session.
      return false;
    }
  },
  removeItem(key: string): boolean {
    const storage = storageOrNull();
    if (!storage) return false;
    try {
      storage.removeItem(scopedStorageKey(key));
      return true;
    } catch {
      return false;
    }
  },
  available(): boolean {
    return storageOrNull() !== null;
  },
};

/**
 * Move the pre-scoping values under the first account to sign in, and record
 * that it happened.
 *
 * Moves rather than copies: a copy left behind is exactly the leak this change
 * exists to close. Never overwrites a scoped value that already exists — an
 * account that has been writing scoped data is not a candidate for adoption,
 * whatever is lying around unscoped.
 *
 * The claim is written LAST, on purpose. Writing it first would mean a quota
 * error halfway through permanently stranded whatever had not moved yet: the
 * next load would see the claim and return before touching it. Claiming last
 * makes a failed adoption retry on the next load, and the never-overwrite rule
 * is what makes that retry safe to repeat.
 */
function adoptLegacyData(scope: string): void {
  const storage = storageOrNull();
  if (!storage) return;
  try {
    if (storage.getItem(STORAGE_CLAIM_KEY) !== null) return;
    for (const key of SCOPED_STORAGE_KEYS) {
      const legacy = storage.getItem(key);
      if (legacy === null) continue;
      if (storage.getItem(`${key}::${scope}`) === null) {
        storage.setItem(`${key}::${scope}`, legacy);
      }
      storage.removeItem(key);
    }
    storage.setItem(STORAGE_CLAIM_KEY, scope);
  } catch {
    // A failed adoption leaves the claim unwritten, so the next load retries.
    // It must not take the app down.
  }
}
