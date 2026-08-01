/**
 * Which bucket of browser storage a page's data belongs to.
 *
 * Pure so the rule is testable without a layout, a session, or a DOM.
 *
 * ## Why a workspace can change the key
 *
 * The sidebar renders the UNION of localStorage and the API. That is deliberate
 * — the app stays usable while the control plane is unreachable — but it means
 * the local half is never removed by a response that omits it. Keyed by account
 * alone, switching into a shared workspace would show the personal workspace's
 * chat titles and saved artifacts beside the shared workspace's, and no amount of
 * refreshing would clear them.
 *
 * ## Why personal keeps the account-only key
 *
 * Every account that exists today is in its personal workspace, under
 * `u:<id>`. Qualifying that key too would strand all of it and require a
 * migration whose only job is to undo a rename. So personal is the unqualified
 * key, exactly as before, and a shared workspace gets a suffix. Nothing to
 * migrate, and a shared workspace correctly starts with an empty local mirror.
 */
export function storageScopeId(
  userId: string | null | undefined,
  workspace?: { id: string; isPersonal: boolean } | null,
): string | null {
  if (!userId) return null;
  const account = `u:${userId}`;
  // No workspace resolved (a control-plane outage) reads as personal: the keys
  // the account has always used, rather than an empty sidebar during an outage.
  if (!workspace || workspace.isPersonal) return account;
  return `${account}|w:${workspace.id}`;
}

/**
 * Whether a scope may adopt the pre-scoping (unscoped) localStorage data.
 *
 * Only a personal scope may. Legacy data was written by one person before
 * workspaces were plural, so it belongs in the workspace they own; adopting it
 * into a shared one would move their private history into a tenant other people
 * can read.
 *
 * In practice a new account is always personal on first sign-in — the active
 * pointer starts NULL — so this guards a path that is hard to reach rather than
 * one that is likely. It is here because "hard to reach" is not "unreachable",
 * and the consequence is somebody else reading your prompts.
 */
export function scopeMayAdoptLegacyData(
  workspace?: { id: string; isPersonal: boolean } | null,
): boolean {
  return !workspace || workspace.isPersonal;
}
