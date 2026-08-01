/**
 * Which run of a conversation the Run page should be following.
 *
 * The URL names a run. A conversation is a chain of them — one per turn — and
 * every route back into a conversation names its FIRST run: the sidebar row is
 * keyed by the identity turn (`collapseConversationChats`), and so is any
 * bookmark taken before the conversation grew. Following the run in the URL
 * therefore stops following the conversation the moment you leave and come
 * back: that run finished long ago, its event stream replays and closes, and a
 * turn that is still generating renders nothing at all until the page is
 * reloaded *after* it finishes. From the outside that looks exactly like the
 * model having stopped.
 *
 * The rule is "follow the newest turn", with one guard: a conversation payload
 * that was already in flight when a follow-up was submitted does not contain
 * the run that follow-up started, and must not drag the page back onto the
 * previous turn.
 */
export function runToFollow(turnRunIds: readonly string[], current: string): string {
  const newest = turnRunIds.at(-1);
  if (!newest) return current;
  // The payload predates the run being followed — it cannot have an opinion
  // about which run is newest.
  if (!turnRunIds.includes(current)) return current;
  return newest;
}
