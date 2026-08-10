import type { ReactNode } from "react";
import type { UserInfo } from "@workos-inc/authkit-nextjs";
import { redirect } from "next/navigation";
import { InviteNotice } from "../../components/invite-notice";
import { Shell } from "../../components/shell";
import { StorageScope } from "../../components/storage-scope";
import { hasCompleteProfileName } from "../../lib/account-profile";
import { resolveAccountTier } from "../../lib/account-tier";
import { getActiveWorkspace } from "../../lib/active-workspace-server";
import { getMajoranaAuth } from "../../lib/auth";
import { getPublicLocale } from "../../lib/public-locale-server";
import { scopeMayAdoptLegacyData, storageScopeId } from "../../lib/storage-scope-id";

// Authed surface shell (Run / Library / Account). Middleware already gates these
// routes; withAuth here only supplies the header identity.
//
// `modal` is a parallel route slot (`@modal`). It renders ALONGSIDE `children`
// rather than instead of it, which is what lets settings open over a Run
// without unmounting it — the screen underneath keeps its scroll position, its
// in-flight stream and its component state, and closing the modal reveals it
// untouched. On every route the slot does not match it renders
// @modal/default.tsx, which is nothing at all.
export default async function AppLayout({ children, modal }: { children: ReactNode; modal: ReactNode }) {
  const [auth, locale, workspace] = await Promise.all([
    getMajoranaAuth({ ensureSignedIn: true }),
    getPublicLocale(),
    // In parallel with the session read, so the cost of knowing which workspace
    // this is one round trip rather than one added to another.
    getActiveWorkspace(),
  ]);

  // An account has a first and last name before it opens (Owner Inbox
  // 2026-07-27). WorkOS leaves both null for email-only sign-ups, so this is the
  // only place it can be required. Gating in the LAYOUT rather than the
  // middleware is deliberate: the middleware would have to decode the session on
  // every asset request to learn the same thing, and /api routes must keep
  // answering — /api/account/profile is how the name gets set.
  if (!hasCompleteProfileName(auth.user)) redirect("/welcome");

  const scopeId = storageScopeId(auth.user.id, workspace);
  return (
    <>
      {/*
        The Atlas opts into cross-document View Transitions from the shared UI
        stylesheet. That at-rule is document-wide and cannot be scoped with a
        selector, so authenticated workspace navigations would otherwise enter
        the same lifecycle. Besides adding motion that was never approved for
        the workspace, a streamed Next.js navigation can abort that transition
        while hydration is replacing controls, leaving actions temporarily
        non-actionable. The arriving and departing app documents both carry this
        later override; the public Atlas keeps its own opt-in unchanged.
      */}
      <style>{"@view-transition { navigation: none; }"}</style>
      {/*
        The tier is resolved here rather than in the Shell because the developer
        allowlist lives in a server-only environment variable: reading it in a
        client component would silently resolve every account to "free".
      */}
      <StorageScope scopeId={scopeId} mayAdoptLegacyData={scopeMayAdoptLegacyData(workspace)}>
      {/*
        Keyed by the scope so a change of account OR of workspace remounts rather
        than reuses. Shell's workspace load effect depends on demoMode and a
        refresh tick, not on who is signed in — without the key, a re-render that
        swapped the identity would leave the previous account's chats on screen,
        read from storage under the old key. The workspace is now part of that
        key for the same reason.
      */}
      <Shell
        key={scopeId ?? "unscoped"}
        locale={locale}
        accountName={accountName(auth.user)}
        accountTier={resolveAccountTier(auth.user.email)}
        workspaceName={workspace && !workspace.isPersonal ? workspace.name : undefined}
      >
        {/*
          Above the page, on every authenticated surface, because there is no
          single place an invited person is guaranteed to visit — and it renders
          nothing at all until its own fetch finds something, which is almost
          always. Inside Shell rather than around it so it sits in the content
          column instead of over the sidebar.
        */}
        <InviteNotice locale={locale} />
        {children}
        {/*
          Inside the Shell, not around it, for two reasons. The settings panels
          read chats and archived chats out of storage keyed by the StorageScope
          above — outside it they would read another account's data, or none.
          And the dialog is `position: fixed`, so sitting in the content column
          costs it nothing: it still covers the sidebar. (The sidebar's own
          confirm dialogs already depend on that being true.)
        */}
        {modal}
      </Shell>
      </StorageScope>
    </>
  );
}

// WorkOS leaves firstName/lastName null for email-only signups, so fall back to
// the local part of the address rather than rendering an empty name.
function accountName(user: UserInfo["user"]): string | undefined {
  const full = [user.firstName, user.lastName].filter(Boolean).join(" ").trim();
  return full || user.email?.split("@")[0] || undefined;
}
