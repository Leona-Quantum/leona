"use client";

import type { DragEvent, FormEvent, ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AppShell, BRAND_NAME, NAV_SURFACES, navSurfaceLabel } from "@majorana/ui";
import {
  ArchiveIcon,
  BrandMark,
  ChevronIcon,
  FolderIcon,
  LibraryIcon,
  MoreIcon,
  PlayIcon,
  PlusIcon,
  SettingsIcon,
  StudioIcon,
  TrashIcon,
} from "./icons";
import {
  CHAT_FOLDERS_EVENT,
  CHAT_HISTORY_EVENT,
  archiveChat,
  assignChatToRemoteFolder,
  assignChatToFolder,
  collapseConversationChats,
  createChatFolder,
  createRemoteChatFolder,
  deleteChat,
  deleteRemoteChatFolder,
  hydrateChatFolders,
  loadChatFolders,
  loadChatHistory,
  renameRemoteChatFolder,
  reorderChatFolders,
  restoreChat,
  updateChat,
  type ChatFolder,
  type ChatStatus,
  type ChatSummary,
} from "../lib/chat-history";
import { accountFirstName, accountInitials } from "../lib/account-identity";
import type { AccountTier } from "../lib/account-tier";
import { fetchArtifactPages } from "../lib/artifact-page";
import { describeNextSlot, isMetered, parseUsage, type UsageSummary } from "../lib/usage-summary";
import { titleFromPrompt } from "../lib/chat-title";
import {
  ARTIFACT_PROJECTS_EVENT,
  assignArtifactToRemoteProject,
  createRemoteArtifactProject,
  deleteRemoteArtifactProject,
  hydrateArtifactProjects,
  loadArtifactProjects,
  renameRemoteArtifactProject,
  reorderArtifactProjects,
  type ArtifactProject,
} from "../lib/artifact-projects";
import { loadSharedProjects, type SharedProject } from "../lib/project-shares";
import { ProjectShareDialog } from "./project-share-dialog";
import { archiveArtifact, artifactFromResource, daysUntilArtifactDeletion, deleteArtifact, isArtifactDeleted, loadLibraryArtifacts, rememberArtifact, restoreArtifact, setArtifactProjectLocally, type LibraryArtifact } from "../lib/library-data";
import { verificationFromResource } from "../lib/verification-record";
import { WORKSPACE_PINS_EVENT, isPinned, setPinned, togglePinned } from "../lib/workspace-pins";
import { ThemeToggle } from "./theme-toggle";
import type { PublicLocale } from "../lib/public-locale";
import { PROJECT_SHARE_COPY, WORKSPACE_COPY } from "../lib/workspace-locale";

// A viewport preference, not content: stays device-global rather than
// per-account (see DEVICE_STORAGE_KEYS in lib/user-storage.ts).
const SIDEBAR_STORAGE_KEY = "majorana.sidebar-collapsed.v1";
// Same reasoning as SIDEBAR_STORAGE_KEY: where a rail section sits is a property
// of this screen, not of the person. Someone who puts recents on top of their
// laptop's narrow rail has not asked for that on their desktop.
// A localStorage key, not a credential. gitleaks' default `generic-api-key`
// rule fires on any high-entropy string assigned to a constant whose name ends
// in KEY — which is what every storage key in this file is called, including
// SIDEBAR_STORAGE_KEY above (that one only escapes because gitleaks scans a
// PR's own commits). The marker has to sit on the flagged line itself.
const RECENTS_POSITION_KEY = "majorana.recents-position.v1"; // gitleaks:allow
type RecentsPosition = "above" | "below";
type WorkspaceSurface = "run" | "studio";
type DeleteTarget =
  | { kind: "chat"; item: ChatSummary }
  | { kind: "artifact"; item: LibraryArtifact };

export function Shell({
  children,
  headerRight,
  demoMode = false,
  locale = "en",
  accountName,
  accountTier,
  workspaceName,
}: {
  children: ReactNode;
  headerRight?: ReactNode;
  demoMode?: boolean;
  locale?: PublicLocale;
  /** Signed-in user's display name for the sidebar footer. Omitted on surfaces
   * with no session (the /dev fixtures page), which fall back to the generic label. */
  accountName?: string;
  /** The active workspace's name, ONLY when it is a shared one. Undefined in a
   * personal workspace, which needs no label — everyone is in theirs by default,
   * and naming it would push the plan out of the one line there is. */
  workspaceName?: string;
  /** Resolved on the server — the developer allowlist is a server-only env var.
   * Omitted on sessionless surfaces, which show no plan rather than guessing one. */
  accountTier?: AccountTier;
}) {
  const pathname = usePathname();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [archivedChats, setArchivedChats] = useState<ChatSummary[]>([]);
  const [chatFolders, setChatFolders] = useState<ChatFolder[]>([]);
  const [artifacts, setArtifacts] = useState<LibraryArtifact[]>([]);
  const [archivedArtifacts, setArchivedArtifacts] = useState<LibraryArtifact[]>([]);
  const [artifactProjects, setArtifactProjects] = useState<ArtifactProject[]>([]);
  const [folderSyncState, setFolderSyncState] = useState<"local" | "synced" | "error">("local");
  // Its own state, not a reuse of folderSyncState. The two hydrates are
  // independent calls against different endpoints: sharing one flag makes a
  // failed chat-folder read badge the Projects header "local only" while the
  // projects synced perfectly, and hides a genuinely failed project read behind
  // a folder list that worked.
  const [projectSyncState, setProjectSyncState] = useState<"local" | "synced" | "error">("local");
  const [refreshTick, setRefreshTick] = useState(0);
  const [archiveNotice, setArchiveNotice] = useState<ChatSummary | null>(null);

  useEffect(() => {
    const saved = window.localStorage.getItem(SIDEBAR_STORAGE_KEY);
    setSidebarCollapsed(saved === "true" || (saved === null && window.innerWidth < 720));
  }, []);

  useEffect(() => {
    let active = true;

    async function refreshWorkspace() {
      const localHistory = collapseConversationChats(
        loadChatHistory({ includeDemo: demoMode, includeArchived: true }),
      );
      const localActiveChats = localHistory.filter((chat) => !chat.archivedAt);
      setChatFolders(loadChatFolders());
      setArtifactProjects(loadArtifactProjects());
      setChats(localActiveChats);
      setArchivedChats(localHistory.filter((chat) => Boolean(chat.archivedAt)));
      const localArtifacts = loadLibraryArtifacts({ includeDemo: demoMode, includeArchived: true });
      setArtifacts(localArtifacts.filter((artifact) => !artifact.archivedAt));
      setArchivedArtifacts(localArtifacts.filter((artifact) => Boolean(artifact.archivedAt)));

      if (demoMode) return;

      try {
        const synced = await hydrateChatFolders(localActiveChats);
        if (active) {
          setChatFolders(synced.folders);
          setFolderSyncState("synced");
        }
      } catch {
        if (active) setFolderSyncState("error");
      }

      // Separate try from the folders above: Run's Folders and Studio's
      // Projects are two independent workspace lists, and a control plane that
      // answers one and not the other must not blank the rail that worked.
      try {
        const synced = await hydrateArtifactProjects();
        if (active) {
          setArtifactProjects(synced.projects);
          setProjectSyncState("synced");
        }
      } catch {
        // The mirror set above is what the rail keeps showing, and the header
        // says so rather than presenting one browser's list as the workspace's.
        if (active) setProjectSyncState("error");
      }

      try {
        // Artifacts are paged rather than fetched once: an un-paged read returns
        // the route's default of 50 and looks exactly like a workspace that
        // holds 50. See lib/artifact-page.ts. Runs stay at one page — that list
        // is the recent-chat rail and 50 is the intended ceiling, not an
        // accident of the default.
        const [runsResponse, artifactPages] = await Promise.all([
          fetch("/api/runs?limit=50", { cache: "no-store" }),
          // A failed read falls back to the local mirror, as it did before this
          // was paged. `complete: false` rather than true — nothing reads it
          // here yet, and the first thing that does must not be told the empty
          // list was the whole list.
          fetchArtifactPages((query) => fetch(`/api/artifacts${query}`, { cache: "no-store" })).catch(
            () => ({ rows: [] as unknown[], complete: false }),
          ),
        ]);
        const runPayload = runsResponse.ok ? ((await runsResponse.json()) as unknown) : [];
        const artifactPayload = artifactPages.rows;
        const byId = new Map(Array.isArray(runPayload) ? runPayload.flatMap(chatFromRun).map((chat) => [chat.id, chat]) : []);
        for (const local of loadChatHistory({ includeDemo: false, includeArchived: true })) {
          const remote = byId.get(local.id);
          byId.set(
            local.id,
            remote
              // `remote.title` is re-derived from the run's prompt on every
              // refresh — the run list carries no name — so it must lose to both
              // a rename and the model's own name, or this poll overwrites them.
              ? {
                  ...local,
                  ...remote,
                  title: local.titleOverride ?? local.modelTitle ?? remote.title,
                  folderId: remote.folderId ?? local.folderId,
                }
              : local,
          );
        }
        const mergedChats = collapseConversationChats([...byId.values()]);
        const remoteArtifacts = Array.isArray(artifactPayload) ? artifactPayload.flatMap(artifactFromResource).filter((artifact) => !isArtifactDeleted(artifact.id)) : [];
        const storedArtifacts = loadLibraryArtifacts({ includeArchived: true });
        // The stored copy wins the merge — it carries code, description and
        // archive state the list resource does not. The FILING is the one field
        // where that is wrong: the server owns `project_id`, and letting a stale
        // mirror win would make a project change made on another device
        // invisible here, and an artifact taken OUT of a project stay in it
        // (the mirror still holds the old id, and `??` would never reach the
        // server's absent one). So the server's answer is overlaid explicitly
        // wherever the server knows the artifact at all.
        const remoteProjectIds = new Map(remoteArtifacts.map((artifact) => [artifact.id, artifact.projectId]));
        const artifactById = new Map(
          [...remoteArtifacts, ...storedArtifacts].map((artifact) => [
            artifact.id,
            remoteProjectIds.has(artifact.id) ? { ...artifact, projectId: remoteProjectIds.get(artifact.id) } : artifact,
          ]),
        );
        if (active) {
          setChats(mergedChats.filter((chat) => !chat.archivedAt));
          setArchivedChats(mergedChats.filter((chat) => Boolean(chat.archivedAt)));
          const mergedArtifacts = [...artifactById.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
          setArtifacts(mergedArtifacts.filter((artifact) => !artifact.archivedAt));
          setArchivedArtifacts(mergedArtifacts.filter((artifact) => Boolean(artifact.archivedAt)));
        }
      } catch {
        // The local workspace remains usable while the control plane is unavailable.
      }
    }

    void refreshWorkspace();
    const refreshFolders = () => {
      setChatFolders(loadChatFolders());
      setArtifactProjects(loadArtifactProjects());
    };
    // ARTIFACT_PROJECTS_EVENT goes to the LIGHT handler, and must stay there:
    // `hydrateArtifactProjects` ends in `replaceArtifactProjects`, which emits
    // this event, so binding it to `refreshWorkspace` would hydrate → replace →
    // emit → hydrate without end. CHAT_FOLDERS_EVENT is on the light handler for
    // the same reason. Artifact rows move between sections through the
    // `onAssignArtifactProject`/`onProjectDeleted` callbacks, which update the
    // list the parent holds — not through this listener.
    window.addEventListener(CHAT_HISTORY_EVENT, refreshWorkspace);
    window.addEventListener(CHAT_FOLDERS_EVENT, refreshFolders);
    window.addEventListener(ARTIFACT_PROJECTS_EVENT, refreshFolders);
    window.addEventListener(WORKSPACE_PINS_EVENT, refreshWorkspace);
    return () => {
      active = false;
      window.removeEventListener(CHAT_HISTORY_EVENT, refreshWorkspace);
      window.removeEventListener(CHAT_FOLDERS_EVENT, refreshFolders);
      window.removeEventListener(ARTIFACT_PROJECTS_EVENT, refreshFolders);
      window.removeEventListener(WORKSPACE_PINS_EVENT, refreshWorkspace);
    };
  }, [demoMode, refreshTick]);

  function toggleSidebar() {
    setSidebarCollapsed((current) => {
      const next = !current;
      window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(next));
      return next;
    });
  }

  const copy = WORKSPACE_COPY[locale];
  const activeSurface: WorkspaceSurface = pathname.startsWith("/studio") ? "studio" : "run";
  const activeNavSurface = NAV_SURFACES.find(
    (surface) => pathname === surface.href || pathname.startsWith(`${surface.href}/`),
  );
  const surfaceLabel = pathname.startsWith("/demo")
    ? copy.surfaces.preview
    : pathname.startsWith("/run")
      ? copy.surfaces.brandedRun
      : activeNavSurface
        ? navSurfaceLabel(activeNavSurface, locale)
        : BRAND_NAME;

  function refreshAfterLocalChange() {
    setRefreshTick((value) => value + 1);
  }

  return (
    <AppShell
      currentPath={pathname}
      headerRight={
        <>
          <ThemeToggle locale={locale} />
          {headerRight}
        </>
      }
      sidebar={
        <WorkspaceSidebar
          currentPath={pathname}
          surface={activeSurface}
          chats={chats}
          archivedChats={archivedChats}
          folders={chatFolders}
          artifacts={artifacts}
          archivedArtifacts={archivedArtifacts}
          artifactProjects={artifactProjects}
          collapsed={sidebarCollapsed}
          demoMode={demoMode}
          folderSyncState={folderSyncState}
          projectSyncState={projectSyncState}
          locale={locale}
          accountName={accountName}
          accountTier={accountTier}
          workspaceName={workspaceName}
          onArchive={(chat) => {
            archiveChat(chat.id, chat);
            refreshAfterLocalChange();
            setArchiveNotice(chat);
          }}
          onRestore={(chat) => {
            restoreChat(chat.id);
            refreshAfterLocalChange();
          }}
          onArchiveArtifact={(artifact) => {
            archiveArtifact(artifact.id, artifact);
            refreshAfterLocalChange();
          }}
          /* The row moves from React state, not from a refetch. Bumping
             refreshTick here instead would re-read the artifact list while the
             PATCH is still in flight, and the server's not-yet-updated answer
             overlays `projectId` — so the dragged artifact would snap back to
             the section it came from and only move again once the round trip
             landed. Reconciliation happens after, in the finally. */
          onAssignArtifactProject={async (artifactId, projectId) => {
            const apply = (list: LibraryArtifact[]) =>
              list.map((artifact) => (artifact.id === artifactId ? { ...artifact, projectId } : artifact));
            setArtifacts(apply);
            setArchivedArtifacts(apply);
            setArtifactProjectLocally(artifactId, projectId);
            if (demoMode) return;
            try {
              await assignArtifactToRemoteProject(artifactId, projectId);
            } catch {
              // The mirror keeps the optimistic answer until the refresh below
              // replaces it with whatever the workspace actually holds.
            } finally {
              refreshAfterLocalChange();
            }
          }}
          /* A deleted project's artifacts are ungrouped, here as well as in the
             mirror: the rail renders the ungrouped section from `!projectId`, so
             a row still pointing at a project that no longer exists would be in
             no section at all. */
          onProjectDeleted={(projectId) => {
            const apply = (list: LibraryArtifact[]) =>
              list.map((artifact) => (artifact.projectId === projectId ? { ...artifact, projectId: undefined } : artifact));
            setArtifacts(apply);
            setArchivedArtifacts(apply);
          }}
          onRestoreArtifact={(artifact) => {
            restoreArtifact(artifact.id);
            refreshAfterLocalChange();
          }}
          onDeleteChat={(chat) => {
            setPinned("chat", chat.id, false);
            deleteChat(chat.id);
            refreshAfterLocalChange();
          }}
          onDeleteArtifact={(artifact) => {
            setPinned("artifact", artifact.id, false);
            deleteArtifact(artifact.id);
            refreshAfterLocalChange();
          }}
          onRenameChat={(chat, name) => {
            updateChat(chat.id, { title: name, titleOverride: name });
            refreshAfterLocalChange();
          }}
          onRenameArtifact={(artifact, name) => {
            rememberArtifact({ ...artifact, title: name });
            refreshAfterLocalChange();
          }}
        />
      }
      sidebarCollapsed={sidebarCollapsed}
      onToggleSidebar={toggleSidebar}
      surfaceLabel={surfaceLabel}
      locale={locale}
    >
      {children}
      {archiveNotice ? (
        <ArchiveNotice
          // The key is load-bearing, not decoration: archiving a second chat
          // while the first banner is up must REMOUNT it, so the six seconds
          // start again for the chat now named rather than expiring on the
          // previous one's schedule.
          key={archiveNotice.id}
          chat={archiveNotice}
          locale={locale}
          onUndo={() => {
            restoreChat(archiveNotice.id);
            refreshAfterLocalChange();
            setArchiveNotice(null);
          }}
          onDismiss={() => setArchiveNotice(null)}
        />
      ) : null}
    </AppShell>
  );
}

const ARCHIVE_NOTICE_MS = 6000;

/**
 * The banner the owner asked for: "undo or view archived chat in settings".
 *
 * It exists because the archive list left the sidebar. Archiving used to be
 * self-evidently reversible — the chat was visibly still there, one section
 * down. Now it leaves the rail entirely, so the only moment the person can be
 * told where it went is the moment it happens.
 *
 * `setTimeout`, not a CSS animation end or `requestAnimationFrame`: rAF does not
 * fire in a background tab, and this banner has a real consequence (dismissing
 * the only undo affordance) that must not depend on the tab being watched.
 */
function ArchiveNotice({ chat, locale, onUndo, onDismiss }: { chat: ChatSummary; locale: PublicLocale; onUndo: () => void; onDismiss: () => void }) {
  const copy = WORKSPACE_COPY[locale].sidebar;
  // `onDismiss` is a fresh closure on every parent render, so depending on it
  // directly restarted the six seconds each time anything else in the shell
  // re-rendered — a busy workspace would have kept the banner up indefinitely.
  // The ref keeps the callback current without making it a dependency; the
  // effect then runs exactly once per mount, and the caller's `key` is what
  // makes a second archive a new mount.
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;
  useEffect(() => {
    const timer = window.setTimeout(() => dismissRef.current(), ARCHIVE_NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div className="mj-archive-notice" role="status" aria-live="polite">
      <span>{copy.chatArchived(chat.title)}</span>
      <button type="button" className="mj-archive-notice-action" onClick={onUndo}>{copy.undo}</button>
      {/* A <Link>, not an <a>: settings is an intercepted route now, and only
          a client-side navigation opens it as a modal. As a plain anchor this
          banner would throw away the Run the person is in the middle of, which
          is the exact thing the modal exists to stop. */}
      <Link className="mj-archive-notice-action" href="/account#archived">{copy.archivedInSettings}</Link>
      <button type="button" className="mj-archive-notice-close" aria-label={copy.cancel} onClick={onDismiss}>×</button>
    </div>
  );
}

function WorkspaceSidebar({
  currentPath,
  surface,
  chats,
  archivedChats,
  folders,
  artifacts,
  archivedArtifacts,
  artifactProjects,
  collapsed,
  demoMode,
  folderSyncState,
  projectSyncState,
  locale,
  accountName,
  accountTier,
  workspaceName,
  onArchive,
  onRestore,
  onArchiveArtifact,
  onRestoreArtifact,
  onAssignArtifactProject,
  onProjectDeleted,
  onDeleteChat,
  onDeleteArtifact,
  onRenameChat,
  onRenameArtifact,
}: {
  currentPath: string;
  surface: WorkspaceSurface;
  chats: ChatSummary[];
  archivedChats: ChatSummary[];
  folders: ChatFolder[];
  artifacts: LibraryArtifact[];
  archivedArtifacts: LibraryArtifact[];
  artifactProjects: ArtifactProject[];
  collapsed: boolean;
  demoMode: boolean;
  folderSyncState: "local" | "synced" | "error";
  projectSyncState: "local" | "synced" | "error";
  locale: PublicLocale;
  accountName?: string;
  workspaceName?: string;
  onArchive: (chat: ChatSummary) => void;
  onRestore: (chat: ChatSummary) => void;
  onArchiveArtifact: (artifact: LibraryArtifact) => void;
  onRestoreArtifact: (artifact: LibraryArtifact) => void;
  onAssignArtifactProject: (artifactId: string, projectId?: string) => void;
  onProjectDeleted: (projectId: string) => void;
  onDeleteChat: (chat: ChatSummary) => void;
  onDeleteArtifact: (artifact: LibraryArtifact) => void;
  onRenameChat: (chat: ChatSummary, name: string) => void;
  onRenameArtifact: (artifact: LibraryArtifact, name: string) => void;
  accountTier?: AccountTier;
}) {
  const copy = WORKSPACE_COPY[locale].sidebar;
  const [openFolders, setOpenFolders] = useState<Set<string>>(new Set());
  const [dragTarget, setDragTarget] = useState<string | null>(null);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement | null>(null);
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const usageReadAt = useRef(0);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [creatingProject, setCreatingProject] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [folderDeleteTarget, setFolderDeleteTarget] = useState<ChatFolder | null>(null);
  const [projectDeleteTarget, setProjectDeleteTarget] = useState<ArtifactProject | null>(null);
  const [shareTarget, setShareTarget] = useState<ArtifactProject | null>(null);
  // Projects OTHER workspaces have granted to this person. Never merged into
  // `artifactProjects` and never written to the localStorage mirror: that
  // mirror is keyed by this workspace's storage scope, and these rows belong
  // to a workspace this browser has no scope for.
  const [sharedProjects, setSharedProjects] = useState<SharedProject[]>([]);
  const [folderError, setFolderError] = useState<string | null>(null);
  const [draggingFolder, setDraggingFolder] = useState<string | null>(null);
  const [folderDragOver, setFolderDragOver] = useState<string | null>(null);
  // Fetched on mount and never mirrored. Its own effect rather than a branch of
  // the projects hydration for the reason that hydration already gives: two
  // independent lists, and a control plane that answers one and not the other
  // must not blank the one that worked.
  useEffect(() => {
    if (demoMode) return undefined;
    let active = true;
    void loadSharedProjects()
      .then((rows) => {
        if (active) setSharedProjects(rows);
      })
      .catch(() => {
        // Nothing shown rather than an error row. "Shared with me" is empty for
        // almost everybody, and an outage must not manufacture a section that
        // says something went wrong with a feature they do not use.
        if (active) setSharedProjects([]);
      });
    return () => {
      active = false;
    };
  }, [demoMode]);

  const [recentsPosition, setRecentsPosition] = useState<RecentsPosition>("below");
  const [recentsOpen, setRecentsOpen] = useState(true);

  // A layout preference for this rail on this screen, like the collapse state
  // beside it — device-global rather than per-account (DEVICE_STORAGE_KEYS in
  // lib/user-storage.ts). Read in an effect, not in the initial state, so the
  // server and the first client render agree.
  useEffect(() => {
    const saved = window.localStorage.getItem(RECENTS_POSITION_KEY);
    if (saved === "above" || saved === "below") setRecentsPosition(saved);
  }, []);

  function moveRecents(next: RecentsPosition) {
    setRecentsPosition(next);
    window.localStorage.setItem(RECENTS_POSITION_KEY, next);
  }

  async function moveFolder(from: number, to: number) {
    if (from === to || from < 0 || to < 0 || to >= folders.length) return;
    const next = [...folders];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    try {
      await reorderChatFolders(next);
    } catch {
      // reorderChatFolders restores the previous order in the mirror before it
      // rethrows, so the rail re-renders back to what the server still holds
      // rather than showing an arrangement that was refused.
      setFolderError(copy.folderOrderFailed);
    }
  }

  async function renameFolder(folderId: string, name: string) {
    try {
      await renameRemoteChatFolder(folderId, name);
    } catch {
      setFolderError(copy.folderRenameFailed);
    }
  }

  async function removeFolder(folder: ChatFolder) {
    setFolderDeleteTarget(null);
    try {
      await deleteRemoteChatFolder(folder.id);
    } catch {
      setFolderError(copy.folderDeleteFailed);
    }
  }
  const runHref = demoMode ? "/demo?view=run" : "/run";
  const studioHref = demoMode ? "/demo?view=library" : "/studio";
  // Title and subtitle must never be the same string: before accountName was
  // plumbed through, both rendered copy.personalWorkspace and the footer showed
  // "Personal workspace" twice, stacked.
  const sidebarName = demoMode ? copy.publicPreview : accountName || copy.personalWorkspace;
  // "first name · account type" per the owner, now on ONE line (2026-07-27
  // inbox). The plan is the useful half — it is what decides run allowances —
  // so it wins the second slot over the old "Personal workspace", which said
  // nothing a signed-in person did not know. Falls back to that label only
  // where there is no session to resolve a tier from (the /dev fixtures page),
  // rather than guessing a plan.
  //
  // Demo carries no tier suffix: the name already reads "Public preview", and
  // "Public preview · Preview" is the same word twice. Stacked it was merely
  // redundant; on one line it would look like a bug.
  const sidebarTier = demoMode ? null : accountTier;
  // A shared workspace takes the line back off the plan.
  //
  // Which tenant you are in outranks which plan you are on the moment it can be
  // somebody else's: a person who switched and forgot would otherwise run and
  // save into a colleague's workspace with nothing on screen saying so. It is
  // named only when it is shared, because "you are in your own workspace" is
  // what everybody's default already is and says nothing.
  const sharedWorkspaceName = demoMode ? null : workspaceName?.trim() || null;
  const sidebarSubtitle = sharedWorkspaceName
    ? sharedWorkspaceName
    : sidebarTier
      ? copy.tierLabel[sidebarTier]
      : !demoMode && accountName
        ? copy.personalWorkspace
        : null;
  const sidebarGreeting = demoMode ? sidebarName : accountFirstName(sidebarName);
  // An empty string is possible only for a name that is all separators; the
  // circle keeps its shape either way, so no placeholder glyph is invented.
  const sidebarInitial = accountInitials(sidebarName);
  const pinnedChats = chats.filter((chat) => isPinned("chat", chat.id));
  const unpinnedChats = chats.filter((chat) => !isPinned("chat", chat.id));
  const pinnedArtifacts = artifacts.filter((artifact) => isPinned("artifact", artifact.id));
  const unpinnedArtifacts = artifacts.filter((artifact) => !isPinned("artifact", artifact.id));
  const standaloneChats = unpinnedChats.filter((chat) => !chat.folderId);
  const standaloneArtifacts = unpinnedArtifacts.filter((artifact) => !artifact.projectId);

  // The account drawer used to close on mouseleave of its container, and the
  // panel was offset from the trigger by a gap — so the pointer crossed dead
  // space on the way up and the menu vanished under it. That is the owner's
  // "sometimes hard to catch". Dismissal is now deliberate: click elsewhere, or
  // press Escape. `pointerdown` rather than `click` so a drag that starts
  // outside still dismisses, and it fires before any link navigates.
  useEffect(() => {
    if (!userMenuOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (userMenuRef.current?.contains(event.target as Node)) return;
      setUserMenuOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setUserMenuOpen(false);
      userMenuRef.current?.querySelector<HTMLButtonElement>(".mj-sidebar-user")?.focus();
    };
    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [userMenuOpen]);

  // The allowance numbers, read when the drawer opens rather than on every page
  // load. Nobody needs them until they look, and this is one round trip to the
  // control plane per look — re-read after thirty seconds because the thing
  // most likely to have happened in between is the user spending a run.
  //
  // Every failure path here ends in the menu showing exactly what it showed
  // before this existed: the link, and no numbers. A stale or invented count
  // beside the words "usage & limits" is worse than none.
  useEffect(() => {
    if (!userMenuOpen || demoMode) return;
    if (usage && Date.now() - usageReadAt.current < 30_000) return;
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/usage", { cache: "no-store" });
        if (!response.ok) return;
        const summary = parseUsage(await response.json());
        if (cancelled || !summary) return;
        usageReadAt.current = Date.now();
        setUsage(summary);
      } catch {
        // Offline, signed out mid-session, or the control plane is down. The
        // drawer is not the place to report any of those.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userMenuOpen, demoMode, usage]);

  const usageLine = usage
    ? !isMetered(usage)
      ? copy.usageRunsUnlimited
      : usage.runs.exhausted
        ? copy.usageRunsNone
        : copy.usageRunsLeft(usage.runs.remaining ?? 0, usage.runs.limit ?? 0)
    : null;
  const nextSlot =
    usage && isMetered(usage) && usage.runs.nextSlotAt
      ? describeNextSlot(usage.runs.nextSlotAt, locale)
      : null;
  const nextSlotLine = nextSlot
    ? nextSlot.relative
      ? copy.usageNextSlotWhen(nextSlot.text)
      : copy.usageNextSlotOn(nextSlot.text)
    : null;

  function toggleFolder(id: string) {
    setOpenFolders((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function submitChatFolder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = folderName.trim();
    if (!name) return;
    try {
      if (!demoMode) await createRemoteChatFolder(name);
      else createChatFolder(name);
    } catch {
      createChatFolder(name);
    }
    setFolderName("");
    setCreatingFolder(false);
  }

  async function submitProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = projectName.trim();
    if (!name) return;
    try {
      await createRemoteArtifactProject(name);
      // Cleared only on success. Resetting before the await means a refused
      // create leaves an error banner and an empty box, so the person has to
      // remember and retype the name they just lost.
      setProjectName("");
      setCreatingProject(false);
    } catch {
      setFolderError(copy.projectCreateFailed);
    }
  }

  async function moveProject(from: number, to: number) {
    if (from === to || from < 0 || to < 0 || to >= artifactProjects.length) return;
    const next = [...artifactProjects];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    try {
      await reorderArtifactProjects(next);
    } catch {
      // reorderArtifactProjects restores the previous order in the mirror before
      // it rethrows, so the rail re-renders back to what the server still holds
      // rather than showing an arrangement that was refused.
      setFolderError(copy.projectOrderFailed);
    }
  }

  async function renameProject(projectId: string, name: string) {
    try {
      await renameRemoteArtifactProject(projectId, name);
    } catch {
      setFolderError(copy.projectRenameFailed);
    }
  }

  async function removeProject(project: ArtifactProject) {
    setProjectDeleteTarget(null);
    try {
      await deleteRemoteArtifactProject(project.id);
      // The artifacts survive, ungrouped. Told to the parent because it owns the
      // artifact list; the mirror is already updated by the call above.
      onProjectDeleted(project.id);
    } catch {
      setFolderError(copy.projectDeleteFailed);
    }
  }

  function assignFolder(chatId: string, folderId?: string) {
    assignChatToFolder(chatId, folderId);
    if (!demoMode) void assignChatToRemoteFolder(chatId, folderId).catch(() => undefined);
  }

  function assignArtifact(artifactId: string, projectId?: string) {
    onAssignArtifactProject(artifactId, projectId);
  }

  // HTML5 drag & drop: rows publish their id under a kind-specific type, folder
  // triggers and the standalone lists accept only the matching kind.
  function dropProps(kind: "chat" | "artifact", targetKey: string, folderId?: string): ChatDropProps {
    const mime = kind === "chat" ? "application/x-mj-chat" : "application/x-mj-artifact";
    return {
      onDragOver: (event: DragEvent<HTMLElement>) => {
        if (!event.dataTransfer.types.includes(mime)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        setDragTarget(targetKey);
      },
      onDragLeave: () => setDragTarget((current) => (current === targetKey ? null : current)),
      onDrop: (event: DragEvent<HTMLElement>) => {
        const id = event.dataTransfer.getData(mime);
        setDragTarget(null);
        if (!id) return;
        event.preventDefault();
        if (kind === "chat") assignFolder(id, folderId);
        else assignArtifact(id, folderId);
      },
      "data-drag-over": dragTarget === targetKey || undefined,
    };
  }

  return (
    <div className="mj-sidebar-inner">
      <div className="mj-sidebar-brand-row">
        <a href="/" className="mj-sidebar-brand" aria-label={BRAND_NAME}>
          <BrandMark size={20} />
          <span className="mj-sidebar-copy">{BRAND_NAME}</span>
        </a>
        <button className="mj-sidebar-more" type="button" aria-label={copy.workspaceOptions} title={copy.workspaceOptions}>
          <MoreIcon size={16} />
        </button>
      </div>

      <nav className="mj-sidebar-surface-switch" aria-label={copy.surfaceSwitch}>
        <a className={surface === "run" ? "is-active" : ""} href={runHref} aria-current={surface === "run" ? "page" : undefined} aria-label={copy.run} title={copy.run}>
          <PlayIcon size={15} />
          <span className="mj-sidebar-copy">{copy.run}</span>
        </a>
        <a className={surface === "studio" ? "is-active" : ""} href={studioHref} aria-current={surface === "studio" ? "page" : undefined} aria-label={copy.studio} title={copy.studio}>
          <StudioIcon size={15} />
          <span className="mj-sidebar-copy">{copy.studio}</span>
        </a>
      </nav>

      {surface === "run" ? (
        <div className="mj-sidebar-scroll">
          <a className="mj-sidebar-new" href={runHref} aria-label={copy.newChat} title={copy.newChat}>
            <PlusIcon size={16} />
            <span className="mj-sidebar-copy">{copy.newChat}</span>
          </a>

          {pinnedChats.length ? (
            <>
              <SidebarSectionHeader label={copy.pinned} />
              <nav className="mj-sidebar-chats mj-sidebar-pinned-list" aria-label={copy.pinned}>
                {pinnedChats.map((chat) => <ChatRow key={chat.id} chat={chat} currentPath={currentPath} demoMode={demoMode} locale={locale} onArchive={onArchive} onDelete={(item) => setDeleteTarget({ kind: "chat", item })} onAssignFolder={assignFolder} onRename={onRenameChat} folders={folders} />)}
              </nav>
            </>
          ) : null}

          {/* Two sections whose ORDER is the user's, per the owner's inbox:
              "can also put the 'Recent Chats' either above or below all the
              folders". Rendered from one array so the two orders cannot drift
              into two different pieces of markup. */}
          {(recentsPosition === "above" ? ["recents", "folders"] : ["folders", "recents"]).map((section) =>
            section === "folders" ? (
              <section key="folders" className="mj-sidebar-group" aria-label={copy.runFolders}>
                <SidebarSectionHeader
                  label={copy.runFolders}
                  status={folderSyncState === "error" ? copy.localOnly : undefined}
                  actionLabel={copy.createChatFolder}
                  onAction={() => setCreatingFolder(true)}
                />
                {creatingFolder ? (
                  <form className="mj-sidebar-folder-form" onSubmit={submitChatFolder}>
                    <input aria-label={copy.folderName} autoFocus maxLength={80} value={folderName} onChange={(event) => setFolderName(event.target.value)} placeholder={copy.folderName} />
                    <button type="submit" aria-label={copy.saveFolder} disabled={!folderName.trim()}>✓</button>
                    <button type="button" aria-label={copy.cancelFolder} onClick={() => { setCreatingFolder(false); setFolderName(""); }}>×</button>
                  </form>
                ) : null}
                <div className="mj-sidebar-folder-list">
                  {folders.map((folder, index) => (
                    <FolderRow
                      key={folder.id}
                      folder={folder}
                      index={index}
                      total={folders.length}
                      chats={unpinnedChats.filter((chat) => chat.folderId === folder.id)}
                      open={openFolders.has(folder.id)}
                      onToggle={() => toggleFolder(folder.id)}
                      currentPath={currentPath}
                      demoMode={demoMode}
                      locale={locale}
                      folders={folders}
                      dragOverKey={folderDragOver}
                      onArchive={onArchive}
                      onDeleteChat={(item) => setDeleteTarget({ kind: "chat", item })}
                      onAssignFolder={assignFolder}
                      onRenameChat={onRenameChat}
                      onRenameFolder={(name) => void renameFolder(folder.id, name)}
                      onDeleteFolder={() => setFolderDeleteTarget(folder)}
                      onMove={(delta) => void moveFolder(index, index + delta)}
                      onDragStartFolder={() => setDraggingFolder(folder.id)}
                      onDragEndFolder={() => { setDraggingFolder(null); setFolderDragOver(null); }}
                      onFolderDragOver={() => setFolderDragOver(folder.id)}
                      onDropFolder={() => {
                        const from = folders.findIndex((item) => item.id === draggingFolder);
                        setFolderDragOver(null);
                        setDraggingFolder(null);
                        if (from >= 0 && from !== index) void moveFolder(from, index);
                      }}
                      chatDropProps={dropProps("chat", `chat-folder-${folder.id}`, folder.id)}
                    />
                  ))}
                  {folders.length === 0 ? <span className="mj-sidebar-empty mj-sidebar-copy">{copy.emptyProject}</span> : null}
                </div>
              </section>
            ) : (
              <section key="recents" className="mj-sidebar-group" aria-label={copy.recentChats}>
                <div className="mj-sidebar-section-heading">
                  <button
                    className="mj-sidebar-recents-toggle"
                    type="button"
                    aria-expanded={recentsOpen}
                    aria-label={recentsOpen ? copy.collapseRecents : copy.expandRecents}
                    onClick={() => setRecentsOpen((value) => !value)}
                  >
                    <span className="mj-sidebar-section-label mj-sidebar-copy">{copy.recentChats}</span>
                    <ChevronIcon className={recentsOpen ? "is-open" : ""} size={13} />
                  </button>
                  <button
                    className="mj-sidebar-folder-add"
                    type="button"
                    aria-label={recentsPosition === "above" ? copy.recentsBelow : copy.recentsAbove}
                    title={recentsPosition === "above" ? copy.recentsBelow : copy.recentsAbove}
                    onClick={() => moveRecents(recentsPosition === "above" ? "below" : "above")}
                  >
                    {recentsPosition === "above" ? "↓" : "↑"}
                  </button>
                </div>
                {recentsOpen ? (
                  <nav className="mj-sidebar-chats" aria-label={copy.recentChats} {...dropProps("chat", "chat-standalone", undefined)}>
                    {standaloneChats.length ? standaloneChats.map((chat) => <ChatRow key={chat.id} chat={chat} currentPath={currentPath} demoMode={demoMode} locale={locale} onArchive={onArchive} onDelete={(item) => setDeleteTarget({ kind: "chat", item })} onAssignFolder={assignFolder} onRename={onRenameChat} folders={folders} />) : <span className="mj-sidebar-empty mj-sidebar-copy">{copy.emptyChats}</span>}
                  </nav>
                ) : null}
              </section>
            ),
          )}
        </div>
      ) : (
        <div className="mj-sidebar-scroll">
          <a className="mj-sidebar-new" href={demoMode ? studioHref : "/studio?new=1"} aria-label={copy.newArtifact} title={copy.newArtifact}>
            <PlusIcon size={16} />
            <span className="mj-sidebar-copy">{copy.newArtifact}</span>
          </a>
          <a className="mj-sidebar-library-link" href={demoMode ? "/demo?view=library" : "/library"} aria-label={copy.library} title={copy.library}>
            <LibraryIcon size={16} />
            <span className="mj-sidebar-copy">{copy.library}</span>
          </a>

          {pinnedArtifacts.length ? (
            <>
              <SidebarSectionHeader label={copy.pinned} />
              <nav className="mj-sidebar-chats mj-sidebar-pinned-list" aria-label={copy.pinned}>
                {pinnedArtifacts.map((artifact) => <ArtifactRow key={artifact.id} artifact={artifact} currentPath={currentPath} folders={artifactProjects} onAssignFolder={assignArtifact} onArchive={onArchiveArtifact} onDelete={(item) => setDeleteTarget({ kind: "artifact", item })} onRename={onRenameArtifact} locale={locale} />)}
              </nav>
            </>
          ) : null}

          {/* No create action in the public preview. Projects are workspace
              rows and the demo has no workspace to write to, so offering the
              button there is a form that accepts a name and produces nothing. */}
          <SidebarSectionHeader
            label={copy.projects}
            status={projectSyncState === "error" ? copy.localOnly : undefined}
            actionLabel={demoMode ? undefined : copy.createProject}
            onAction={demoMode ? undefined : () => setCreatingProject(true)}
          />
          {creatingProject ? (
            <form className="mj-sidebar-folder-form" onSubmit={submitProject}>
              <input aria-label={copy.projectName} autoFocus maxLength={80} value={projectName} onChange={(event) => setProjectName(event.target.value)} placeholder={copy.projectName} />
              <button type="submit" aria-label={copy.saveFolder} disabled={!projectName.trim()}>✓</button>
              <button type="button" aria-label={copy.cancelFolder} onClick={() => { setCreatingProject(false); setProjectName(""); }}>×</button>
            </form>
          ) : null}
          <div className="mj-sidebar-folder-list">
            {artifactProjects.map((project, index) => (
              <ProjectRow
                key={project.id}
                project={project}
                index={index}
                total={artifactProjects.length}
                artifacts={unpinnedArtifacts.filter((artifact) => artifact.projectId === project.id)}
                projects={artifactProjects}
                open={openFolders.has(project.id)}
                onToggle={() => toggleFolder(project.id)}
                currentPath={currentPath}
                demoMode={demoMode}
                locale={locale}
                onArchiveArtifact={onArchiveArtifact}
                onDeleteArtifact={(item) => setDeleteTarget({ kind: "artifact", item })}
                onRenameArtifact={onRenameArtifact}
                onAssignProject={assignArtifact}
                onRenameProject={(name) => void renameProject(project.id, name)}
                onDeleteProject={() => setProjectDeleteTarget(project)}
                onShareProject={() => setShareTarget(project)}
                onMove={(delta) => void moveProject(index, index + delta)}
                dropProps={dropProps("artifact", `artifact-project-${project.id}`, project.id)}
              />
            ))}
            {artifactProjects.length === 0 ? <span className="mj-sidebar-empty mj-sidebar-copy">{copy.emptyProjects}</span> : null}
          </div>

          {/* Only when there is something in it. A permanently-empty section
              in everybody's sidebar teaches people to skip that part of the
              rail, which is where the notice will one day be. */}
          {sharedProjects.length ? (
            <>
              <SidebarSectionHeader label={PROJECT_SHARE_COPY[locale].sharedWithMe} />
              <div className="mj-sidebar-folder-list">
                {sharedProjects.map((shared) => (
                  <a
                    key={shared.id}
                    className="mj-sidebar-shared-project"
                    href={`/shared/${encodeURIComponent(shared.id)}`}
                    title={PROJECT_SHARE_COPY[locale].fromWorkspace(shared.ownerWorkspaceName)}
                  >
                    <span className="mj-sidebar-copy">{shared.name}</span>
                    <small className="mj-sidebar-copy">
                      {PROJECT_SHARE_COPY[locale].fromWorkspace(shared.ownerWorkspaceName)}
                    </small>
                    <span className="mj-sidebar-folder-count">{shared.artifactCount}</span>
                  </a>
                ))}
              </div>
            </>
          ) : null}

          <SidebarSectionHeader label={copy.artifacts} />
          <nav className="mj-sidebar-chats" aria-label={copy.artifacts} {...dropProps("artifact", "artifact-standalone", undefined)}>
            {standaloneArtifacts.length ? standaloneArtifacts.map((artifact) => <ArtifactRow key={artifact.id} artifact={artifact} currentPath={currentPath} folders={artifactProjects} onAssignFolder={assignArtifact} onArchive={onArchiveArtifact} onDelete={(item) => setDeleteTarget({ kind: "artifact", item })} onRename={onRenameArtifact} locale={locale} />) : <span className="mj-sidebar-empty mj-sidebar-copy">{copy.emptyArtifacts}</span>}
          </nav>
          <ArtifactArchiveSection artifacts={archivedArtifacts} locale={locale} onRestore={onRestoreArtifact} onDelete={onDeleteArtifact} />
          <a className="mj-sidebar-library-link mj-sidebar-library-link--bottom" href={demoMode ? "/demo?view=library" : "/library"} aria-label={copy.viewLibrary} title={copy.viewLibrary}>
            <LibraryIcon size={16} />
            <span className="mj-sidebar-copy">{copy.viewLibrary}</span>
          </a>
        </div>
      )}

      <div className="mj-sidebar-footer">
        {demoMode ? (
          <a className="mj-sidebar-user" href={runHref}>
            <span className="mj-avatar">{sidebarInitial}</span>
            <span className="mj-sidebar-user-copy mj-sidebar-copy">
              <strong>{sidebarName}</strong>
            </span>
          </a>
        ) : (
          <div className="mj-sidebar-user-menu" ref={userMenuRef} data-open={userMenuOpen}>
            {/* The drawer stays mounted so it can animate open AND shut; `inert`
                keeps its links out of the tab order and off the accessibility
                tree while it is closed, which `display: none` would have done
                for free but at the cost of the motion the owner asked for. */}
            <div className="mj-sidebar-user-drawer" role="menu" aria-hidden={!userMenuOpen} inert={!userMenuOpen}>
              <div className="mj-sidebar-user-drawer-panel">
                <div className="mj-sidebar-user-drawer-items">
                  {/* Both of these are <Link>, and that is the whole feature.
                      /account is an intercepted route: Next.js turns it into
                      the centred modal ONLY for client-side navigations, so a
                      plain <a> here would quietly keep the old behaviour — a
                      document load onto the full page, discarding whatever Run
                      or Studio session was open. Nothing would look broken,
                      which is why it is worth saying twice and why
                      lib/account-entry-points.test.ts enforces it.

                      The drawer is deliberately NOT closed on the way out. It
                      stays open, and not inert, behind the dialog — which is
                      what lets the modal hand focus back to the exact item that
                      opened it. */}
                  <Link role="menuitem" href="/account"><SettingsIcon size={15} />{copy.settings}</Link>
                  <Link role="menuitem" className="mj-sidebar-usage" href="/account#usage">
                    <span>{copy.usageLimits}</span>
                    {usageLine ? (
                      <span className="mj-sidebar-usage-detail" data-spent={usage?.runs.exhausted ? "" : undefined}>
                        {usageLine}
                        {nextSlotLine ? <small>{nextSlotLine}</small> : null}
                      </span>
                    ) : null}
                  </Link>
                  {/* Stays an anchor. /auth/sign-out is a route handler that
                      clears the session and redirects; there is no page for a
                      client-side navigation to render. */}
                  <a role="menuitem" className="is-danger" href="/auth/sign-out">{copy.signOut}</a>
                </div>
              </div>
            </div>
            {/* `data-modal-return-focus`: where a modal sends focus when it
                cannot send it back to whatever opened it. The settings dialog
                normally returns to the drawer item that was clicked, but a
                click on that dialog's backdrop counts as a click outside the
                drawer and dismisses it — putting that item inside an `inert`
                subtree, where .focus() silently does nothing. This button is
                the drawer's own toggle, and the same place Escape already
                returns focus to, so it is the honest next-best answer. */}
            <button className="mj-sidebar-user" type="button" data-modal-return-focus="" aria-label={copy.accountMenu} aria-expanded={userMenuOpen} onClick={() => setUserMenuOpen((value) => !value)}>
              <span className="mj-avatar">{sidebarInitial}</span>
              <span className="mj-sidebar-user-copy mj-sidebar-copy">
                <strong>{sidebarGreeting}</strong>
                {sidebarSubtitle ? <small>{sidebarSubtitle}</small> : null}
              </span>
              <span className="mj-sidebar-user-caret mj-sidebar-copy">⌄</span>
            </button>
          </div>
        )}
      </div>
      {deleteTarget ? (
        <DeleteConfirmationDialog
          target={deleteTarget}
          locale={locale}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => {
            if (deleteTarget.kind === "chat") onDeleteChat(deleteTarget.item);
            else onDeleteArtifact(deleteTarget.item);
            setDeleteTarget(null);
          }}
        />
      ) : null}
      {folderDeleteTarget ? (
        <ConfirmDialog
          eyebrow={copy.runFolders}
          title={copy.deleteFolderTitle}
          body={copy.deleteFolderWarning(folderDeleteTarget.name)}
          cancelLabel={copy.cancel}
          confirmLabel={copy.delete}
          onCancel={() => setFolderDeleteTarget(null)}
          onConfirm={() => void removeFolder(folderDeleteTarget)}
        />
      ) : null}
      {shareTarget ? (
        <ProjectShareDialog
          projectId={shareTarget.id}
          projectName={shareTarget.name}
          locale={locale}
          onClose={() => setShareTarget(null)}
        />
      ) : null}
      {projectDeleteTarget ? (
        <ConfirmDialog
          eyebrow={copy.projects}
          title={copy.deleteProjectTitle}
          body={copy.deleteProjectWarning(projectDeleteTarget.name)}
          cancelLabel={copy.cancel}
          confirmLabel={copy.delete}
          onCancel={() => setProjectDeleteTarget(null)}
          onConfirm={() => void removeProject(projectDeleteTarget)}
        />
      ) : null}
      {folderError ? (
        <p className="mj-sidebar-error mj-sidebar-copy" role="status">
          {folderError}
          <button type="button" onClick={() => setFolderError(null)} aria-label={copy.cancel}>×</button>
        </p>
      ) : null}
    </div>
  );
}

const FOLDER_MIME = "application/x-mj-folder";

/** What `dropProps` returns. Named so FolderRow can forward it without casts. */
type ChatDropProps = {
  onDragOver: (event: DragEvent<HTMLElement>) => void;
  onDragLeave: () => void;
  onDrop: (event: DragEvent<HTMLElement>) => void;
  "data-drag-over"?: true;
};

function FolderRow({
  folder,
  index,
  total,
  chats,
  open,
  onToggle,
  currentPath,
  demoMode,
  locale,
  folders,
  dragOverKey,
  onArchive,
  onDeleteChat,
  onAssignFolder,
  onRenameChat,
  onRenameFolder,
  onDeleteFolder,
  onMove,
  onDragStartFolder,
  onDragEndFolder,
  onFolderDragOver,
  onDropFolder,
  chatDropProps,
}: {
  folder: ChatFolder;
  index: number;
  total: number;
  chats: ChatSummary[];
  open: boolean;
  onToggle: () => void;
  currentPath: string;
  demoMode: boolean;
  locale: PublicLocale;
  folders: ChatFolder[];
  dragOverKey: string | null;
  onArchive: (chat: ChatSummary) => void;
  onDeleteChat: (chat: ChatSummary) => void;
  onAssignFolder: (chatId: string, folderId?: string) => void;
  onRenameChat: (chat: ChatSummary, name: string) => void;
  onRenameFolder: (name: string) => void;
  onDeleteFolder: () => void;
  onMove: (delta: number) => void;
  onDragStartFolder: () => void;
  onDragEndFolder: () => void;
  onFolderDragOver: () => void;
  onDropFolder: () => void;
  chatDropProps: ChatDropProps;
}) {
  const copy = WORKSPACE_COPY[locale].sidebar;
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(folder.name);

  return (
    <div
      className="mj-sidebar-disclosure"
      data-folder-drop={dragOverKey === folder.id || undefined}
      // Restores the chat-into-folder highlight. The old markup put
      // `dropProps` straight on `.mj-sidebar-folder-trigger`, which is what
      // `[data-drag-over]` styled; splitting the row into a wrapper moved the
      // attribute off the element the rule targets, so the folder stopped
      // lighting up when a chat was dragged over it.
      data-chat-drop={chatDropProps["data-drag-over"] || undefined}
      draggable={!demoMode && !renaming}
      onDragStart={(event) => {
        event.dataTransfer.setData(FOLDER_MIME, folder.id);
        event.dataTransfer.effectAllowed = "move";
        onDragStartFolder();
      }}
      onDragEnd={onDragEndFolder}
      onDragOver={(event) => {
        // Two drag kinds land on this row and they mean different things: a
        // FOLDER dropped here reorders, a CHAT dropped here files. Reading the
        // MIME rather than a component-level "am I dragging" flag is what keeps
        // them apart — a chat dragged over a folder must never reorder it.
        if (event.dataTransfer.types.includes(FOLDER_MIME)) {
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          onFolderDragOver();
          return;
        }
        chatDropProps.onDragOver(event);
      }}
      onDragLeave={chatDropProps.onDragLeave}
      onDrop={(event) => {
        if (event.dataTransfer.types.includes(FOLDER_MIME)) {
          event.preventDefault();
          onDropFolder();
          return;
        }
        chatDropProps.onDrop(event);
      }}
    >
      {renaming ? (
        <form
          className="mj-sidebar-folder-form"
          onSubmit={(event) => {
            event.preventDefault();
            const next = name.trim();
            if (next && next !== folder.name) onRenameFolder(next);
            setRenaming(false);
          }}
        >
          <input
            aria-label={copy.renameFolder(folder.name)}
            autoFocus
            maxLength={80}
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Escape") return;
              event.preventDefault();
              setName(folder.name);
              setRenaming(false);
            }}
          />
          <button type="submit" aria-label={copy.saveFolder} disabled={!name.trim()}>✓</button>
          <button type="button" aria-label={copy.cancelFolder} onClick={() => { setName(folder.name); setRenaming(false); }}>×</button>
        </form>
      ) : (
        <div className="mj-sidebar-folder-row">
          <button
            className="mj-sidebar-folder-trigger"
            type="button"
            aria-expanded={open}
            onClick={onToggle}
          >
            {/* The icon IS the disclosure state, as in the reference the owner
                sent — an open folder when expanded, a closed one when not. A
                separate chevron beside it would say the same thing twice in a
                rail this narrow. */}
            <FolderIcon size={15} open={open} />
            <span className="mj-sidebar-copy">{folder.name}</span>
          </button>
          {!demoMode ? (
            <div className="mj-sidebar-folder-actions">
              {/* Drag is the primary gesture; these are the keyboard and
                  touch route to the same thing. A reorder that only works
                  with a mouse is a reorder half the people cannot do. */}
              <button
                className="mj-sidebar-chat-action"
                type="button"
                aria-label={copy.folderMoveUp(folder.name)}
                title={copy.folderMoveUp(folder.name)}
                disabled={index === 0}
                onClick={() => onMove(-1)}
              >↑</button>
              <button
                className="mj-sidebar-chat-action"
                type="button"
                aria-label={copy.folderMoveDown(folder.name)}
                title={copy.folderMoveDown(folder.name)}
                disabled={index === total - 1}
                onClick={() => onMove(1)}
              >↓</button>
              <button
                className="mj-sidebar-chat-action"
                type="button"
                aria-label={copy.renameFolder(folder.name)}
                title={copy.renameFolder(folder.name)}
                onClick={() => { setName(folder.name); setRenaming(true); }}
              >✎</button>
              <button
                className="mj-sidebar-chat-action mj-sidebar-chat-action--danger"
                type="button"
                aria-label={copy.deleteFolder(folder.name)}
                title={copy.deleteFolder(folder.name)}
                onClick={onDeleteFolder}
              ><TrashIcon size={13} /></button>
            </div>
          ) : null}
        </div>
      )}
      {open ? (
        <div className="mj-sidebar-disclosure-items">
          {chats.length
            ? chats.map((chat) => (
                <ChatRow
                  key={chat.id}
                  chat={chat}
                  currentPath={currentPath}
                  demoMode={demoMode}
                  locale={locale}
                  onArchive={onArchive}
                  onDelete={onDeleteChat}
                  onAssignFolder={onAssignFolder}
                  onRename={onRenameChat}
                  folders={folders}
                />
              ))
            : <span className="mj-sidebar-empty mj-sidebar-copy">{copy.emptyProject}</span>}
        </div>
      ) : null}
    </div>
  );
}

function SidebarSectionHeader({ label, status, actionLabel, onAction }: { label: string; status?: string; actionLabel?: string; onAction?: () => void }) {
  return (
    <div className="mj-sidebar-section-heading">
      <span className="mj-sidebar-section-label mj-sidebar-copy">{label}</span>
      <span className="mj-sidebar-section-status mj-sidebar-copy">{status}</span>
      {onAction ? <button className="mj-sidebar-folder-add" type="button" aria-label={actionLabel} title={actionLabel} onClick={onAction}>+</button> : null}
    </div>
  );
}

function ChatRow({ chat, currentPath, demoMode, locale, folders, onArchive, onDelete, onAssignFolder, onRename }: { chat: ChatSummary; currentPath: string; demoMode: boolean; locale: PublicLocale; folders: ChatFolder[]; onArchive: (chat: ChatSummary) => void; onDelete: (chat: ChatSummary) => void; onAssignFolder: (chatId: string, folderId?: string) => void; onRename: (chat: ChatSummary, name: string) => void }) {
  return (
    <div
      className="mj-sidebar-chat-row"
      draggable={!demoMode}
      onDragStart={(event) => {
        event.dataTransfer.setData("application/x-mj-chat", chat.id);
        event.dataTransfer.effectAllowed = "move";
      }}
    >
      <a className={`mj-sidebar-chat${currentPath === `/run/${chat.id}` ? " is-active" : ""}`} href={demoMode ? "/demo?view=run" : `/run/${chat.id}`} title={collapsedTitle(chat.title)}>
        <span className="mj-sidebar-chat-title mj-sidebar-copy">{chat.title}</span>
        <span className="mj-sidebar-chat-time mj-sidebar-copy">{formatRelativeDate(chat.createdAt, locale)}</span>
      </a>
      {!demoMode ? (
        <div className="mj-sidebar-chat-actions">
          <ItemOverflowMenu
            kind="chat"
            title={chat.title}
            pinned={isPinned("chat", chat.id)}
            locale={locale}
            folders={folders}
            currentFolderId={chat.folderId}
            onAssignFolder={(folderId) => onAssignFolder(chat.id, folderId)}
            onRename={(name) => onRename(chat, name)}
            onTogglePin={() => togglePinned("chat", chat.id)}
            onArchive={() => onArchive(chat)}
            onDelete={() => onDelete(chat)}
          />
        </div>
      ) : null}
    </div>
  );
}

/**
 * One Studio project in the rail: a disclosure holding its artifacts, plus the
 * four things a project can have done to it.
 *
 * Deliberately NOT a reuse of `FolderRow`. That component is typed for chats and
 * carries the folder-to-folder drag reorder; projects reorder with the ↑/↓
 * buttons only, so sharing one component would mean a `kind` prop threaded
 * through every branch of both behaviours. The two sections are different words
 * for different things — the owner's distinction — and this keeps them able to
 * diverge without a merge conflict in the middle of a drag handler.
 */
function ProjectRow({
  project,
  index,
  total,
  artifacts,
  projects,
  open,
  onToggle,
  currentPath,
  demoMode,
  locale,
  onArchiveArtifact,
  onDeleteArtifact,
  onRenameArtifact,
  onAssignProject,
  onRenameProject,
  onDeleteProject,
  onShareProject,
  onMove,
  dropProps,
}: {
  project: ArtifactProject;
  index: number;
  total: number;
  artifacts: LibraryArtifact[];
  projects: ArtifactProject[];
  open: boolean;
  onToggle: () => void;
  currentPath: string;
  demoMode: boolean;
  locale: PublicLocale;
  onArchiveArtifact: (artifact: LibraryArtifact) => void;
  onDeleteArtifact: (artifact: LibraryArtifact) => void;
  onRenameArtifact: (artifact: LibraryArtifact, name: string) => void;
  onAssignProject: (artifactId: string, projectId?: string) => void;
  onRenameProject: (name: string) => void;
  onDeleteProject: () => void;
  onShareProject: () => void;
  onMove: (delta: number) => void;
  dropProps: ChatDropProps;
}) {
  const copy = WORKSPACE_COPY[locale].sidebar;
  const shareCopy = PROJECT_SHARE_COPY[locale];
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(project.name);

  return (
    <div className="mj-sidebar-disclosure" data-chat-drop={dropProps["data-drag-over"] || undefined} {...dropProps}>
      {renaming ? (
        <form
          className="mj-sidebar-folder-form"
          onSubmit={(event) => {
            event.preventDefault();
            const next = name.trim();
            setRenaming(false);
            if (next && next !== project.name) onRenameProject(next);
          }}
        >
          <input
            aria-label={copy.renameProject(project.name)}
            autoFocus
            maxLength={80}
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Escape") return;
              event.preventDefault();
              setName(project.name);
              setRenaming(false);
            }}
          />
          <button type="submit" aria-label={copy.saveFolder} disabled={!name.trim()}>✓</button>
          <button type="button" aria-label={copy.cancelFolder} onClick={() => { setName(project.name); setRenaming(false); }}>×</button>
        </form>
      ) : (
        <div className="mj-sidebar-folder-row">
          <button className="mj-sidebar-folder-trigger" type="button" aria-expanded={open} onClick={onToggle}>
            <FolderIcon size={15} open={open} />
            <span className="mj-sidebar-copy">{project.name}</span>
            <span className="mj-sidebar-folder-count">{artifacts.length}</span>
          </button>
          {!demoMode ? (
            <div className="mj-sidebar-folder-actions">
              {/* No drag-to-reorder here, so these buttons are the ONLY way to
                  arrange projects rather than a keyboard alternative to a
                  gesture. They are not optional. */}
              <button
                className="mj-sidebar-chat-action"
                type="button"
                aria-label={copy.projectMoveUp(project.name)}
                title={copy.projectMoveUp(project.name)}
                disabled={index === 0}
                onClick={() => onMove(-1)}
              >↑</button>
              <button
                className="mj-sidebar-chat-action"
                type="button"
                aria-label={copy.projectMoveDown(project.name)}
                title={copy.projectMoveDown(project.name)}
                disabled={index === total - 1}
                onClick={() => onMove(1)}
              >↓</button>
              <button
                className="mj-sidebar-chat-action"
                type="button"
                aria-label={copy.renameProject(project.name)}
                title={copy.renameProject(project.name)}
                onClick={() => { setName(project.name); setRenaming(true); }}
              >✎</button>
              <button
                className="mj-sidebar-chat-action"
                type="button"
                aria-label={shareCopy.shareProject(project.name)}
                title={shareCopy.shareProject(project.name)}
                onClick={onShareProject}
              >⤴</button>
              <button
                className="mj-sidebar-chat-action mj-sidebar-chat-action--danger"
                type="button"
                aria-label={copy.deleteProject(project.name)}
                title={copy.deleteProject(project.name)}
                onClick={onDeleteProject}
              ><TrashIcon size={13} /></button>
            </div>
          ) : null}
        </div>
      )}
      {open ? (
        <div className="mj-sidebar-disclosure-items">
          {artifacts.length ? (
            artifacts.map((artifact) => (
              <ArtifactRow
                key={artifact.id}
                artifact={artifact}
                currentPath={currentPath}
                folders={projects}
                onAssignFolder={onAssignProject}
                onArchive={onArchiveArtifact}
                onDelete={onDeleteArtifact}
                onRename={onRenameArtifact}
                locale={locale}
              />
            ))
          ) : (
            <span className="mj-sidebar-empty mj-sidebar-copy">{copy.emptyProject}</span>
          )}
        </div>
      ) : null}
    </div>
  );
}

function ArtifactRow({ artifact, currentPath, folders, onAssignFolder, onArchive, onDelete, onRename, locale }: { artifact: LibraryArtifact; currentPath: string; folders: ArtifactProject[]; onAssignFolder: (artifactId: string, folderId?: string) => void; onArchive: (artifact: LibraryArtifact) => void; onDelete: (artifact: LibraryArtifact) => void; onRename: (artifact: LibraryArtifact, name: string) => void; locale: PublicLocale }) {
  const href = `/studio?artifact=${encodeURIComponent(artifact.id)}`;
  return (
    <div
      className="mj-sidebar-artifact-row"
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData("application/x-mj-artifact", artifact.id);
        event.dataTransfer.effectAllowed = "move";
      }}
    >
      <a className={`mj-sidebar-chat${currentPath === href ? " is-active" : ""}`} href={href} title={artifact.title}>
        <span className="mj-sidebar-chat-title mj-sidebar-copy">{artifact.title}</span>
      </a>
      <div className="mj-sidebar-artifact-actions">
        <ItemOverflowMenu
          kind="artifact"
          title={artifact.title}
          pinned={isPinned("artifact", artifact.id)}
          locale={locale}
          folders={folders}
          currentFolderId={artifact.projectId}
          onAssignFolder={(folderId) => onAssignFolder(artifact.id, folderId)}
          onRename={(name) => onRename(artifact, name)}
          onTogglePin={() => togglePinned("artifact", artifact.id)}
          onArchive={() => onArchive(artifact)}
          onDelete={() => onDelete(artifact)}
        />
      </div>
    </div>
  );
}

function ItemOverflowMenu({ kind, title, pinned, locale, folders, currentFolderId, onAssignFolder, onRename, onTogglePin, onArchive, onDelete }: { kind: "chat" | "artifact"; title: string; pinned: boolean; locale: PublicLocale; folders: Array<{ id: string; name: string }>; currentFolderId?: string; onAssignFolder: (folderId?: string) => void; onRename: (name: string) => void; onTogglePin: () => void; onArchive: () => void; onDelete: () => void }) {
  const copy = WORKSPACE_COPY[locale].sidebar;
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(title);
  const [placement, setPlacement] = useState<{ left: number; top?: number; bottom?: number }>({ left: 0, top: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const pinAria = kind === "chat" ? (pinned ? copy.unpinChat(title) : copy.pinChat(title)) : (pinned ? copy.unpinArtifact(title) : copy.pinArtifact(title));
  const archiveAria = kind === "chat" ? copy.archiveChat(title) : copy.archiveArtifact(title);
  const deleteAria = kind === "chat" ? copy.deleteChat(title) : copy.deleteArtifact(title);
  const currentFolder = folders.find((folder) => folder.id === currentFolderId);

  const closeTimer = useRef<number | null>(null);
  const renamingRef = useRef(false);
  renamingRef.current = renaming;

  useEffect(() => () => {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
  }, []);

  function cancelScheduledClose() {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }

  function close() {
    cancelScheduledClose();
    setOpen(false);
    setRenaming(false);
  }

  // Hover-driven with a short grace period: the popover sits just past the
  // sidebar's right edge, aligned with its row, and the timer keeps it alive
  // while the pointer crosses from the trigger to the menu.
  function scheduleClose() {
    cancelScheduledClose();
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = null;
      // An in-progress rename keeps the menu open; Escape or submit ends it.
      if (renamingRef.current) return;
      setOpen(false);
    }, 240);
  }

  function openMenu() {
    cancelScheduledClose();
    if (open) return;
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) {
      const rail = triggerRef.current?.closest(".mj-sidebar-inner")?.getBoundingClientRect();
      const left = Math.min((rail?.right ?? rect.right) + 4, window.innerWidth - 208);
      if (rect.top > window.innerHeight - 300) setPlacement({ left, bottom: Math.max(8, window.innerHeight - rect.bottom) });
      else setPlacement({ left, top: rect.top });
    }
    setOpen(true);
    setRenaming(false);
    setName(title);
  }

  function toggleOpen() {
    if (open) close();
    else openMenu();
  }

  function submitRename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = name.trim();
    if (next && next !== title) onRename(next);
    close();
  }

  return (
    // The popover is hover-scoped per the owner request: hovering the trigger
    // opens it, leaving the menu area dismisses it after a short grace period,
    // and click still toggles for keyboard and touch.
    <div className="mj-sidebar-item-menu" onMouseEnter={openMenu} onMouseLeave={scheduleClose}>
      <button ref={triggerRef} className="mj-sidebar-menu-trigger" type="button" aria-label={`${title} options`} aria-expanded={open} title={`${title} options`} onClick={(event) => { event.preventDefault(); event.stopPropagation(); toggleOpen(); }}>
        <MoreIcon size={15} />
      </button>
      {open ? (
        <div
          className="mj-sidebar-item-menu-popover"
          role="menu"
          style={placement}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            close();
            triggerRef.current?.focus();
          }}
        >
          {renaming ? (
            <form className="mj-sidebar-rename-form" onSubmit={submitRename}>
              <input
                aria-label={copy.rename(title)}
                autoFocus
                maxLength={80}
                value={name}
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.preventDefault();
                    close();
                  } else if (event.key === "Enter") {
                    event.preventDefault();
                    event.currentTarget.form?.requestSubmit();
                  }
                }}
                placeholder={copy.renamePlaceholder}
              />
            </form>
          ) : (
            <>
              <button type="button" role="menuitem" aria-label={copy.rename(title)} onClick={() => setRenaming(true)}>{copy.menuRename}</button>
              <button type="button" role="menuitem" aria-label={pinAria} onClick={() => { onTogglePin(); close(); }}>{pinned ? copy.menuUnpin : copy.menuPin}</button>
              <button type="button" role="menuitem" aria-label={archiveAria} onClick={() => { onArchive(); close(); }}>{copy.menuArchive}</button>
              <div className="mj-sidebar-menu-folder">
                <span>{copy.projectLabel}</span>
                <select aria-label={copy.moveToFolder(title)} value={currentFolderId ?? ""} onChange={(event) => { onAssignFolder(event.target.value || undefined); close(); }}>
                  <option value="">{copy.noFolder}</option>
                  {folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
                </select>
                {currentFolder ? <small>{currentFolder.name}</small> : null}
              </div>
              <button className="is-danger" type="button" role="menuitem" aria-label={deleteAria} onClick={() => { onDelete(); close(); }}>{copy.menuDelete}</button>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

function DeleteConfirmationDialog({ target, locale, onCancel, onConfirm }: { target: DeleteTarget; locale: PublicLocale; onCancel: () => void; onConfirm: () => void }) {
  const copy = WORKSPACE_COPY[locale].sidebar;
  const title = target.item.title;
  const warning = target.kind === "chat" ? copy.deleteChatWarning(title) : copy.deleteArtifactWarning(title);
  return (
    <ConfirmDialog
      eyebrow={target.kind === "chat" ? copy.chats : copy.artifacts}
      title={copy.deleteConfirmTitle}
      body={warning}
      cancelLabel={copy.cancel}
      confirmLabel={copy.delete}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
}

/**
 * The one destructive-confirmation shape. Chats, artifacts and folders share it.
 *
 * Escape lives HERE rather than in the caller. It used to be an effect beside
 * `deleteTarget` in the sidebar, which meant the folder dialog — a second piece
 * of state — silently had no keyboard dismissal at all. A modal that can only be
 * closed with a pointer is a modal somebody gets stuck in.
 */
function ConfirmDialog({ eyebrow, title, body, cancelLabel, confirmLabel, onCancel, onConfirm }: { eyebrow: string; title: string; body: string; cancelLabel: string; confirmLabel: string; onCancel: () => void; onConfirm: () => void }) {
  const cancelRef = useRef(onCancel);
  cancelRef.current = onCancel;
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") cancelRef.current();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <div className="mj-delete-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}>
      <section className="mj-delete-dialog" role="dialog" aria-modal="true" aria-labelledby="mj-delete-dialog-title">
        <p className="mj-eyebrow">{eyebrow}</p>
        <h2 id="mj-delete-dialog-title">{title}</h2>
        <p>{body}</p>
        <div className="mj-delete-dialog-actions">
          <button className="mj-secondary-button" type="button" onClick={onCancel}>{cancelLabel}</button>
          <button className="mj-danger-button" type="button" onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </section>
    </div>
  );
}

function ArtifactArchiveSection({ artifacts, locale, onRestore, onDelete }: { artifacts: LibraryArtifact[]; locale: PublicLocale; onRestore: (artifact: LibraryArtifact) => void; onDelete: (artifact: LibraryArtifact) => void }) {
  const copy = WORKSPACE_COPY[locale].sidebar;
  return (
    <section className="mj-sidebar-archive mj-sidebar-artifact-archive" aria-label={copy.archiveArtifacts}>
      <div className="mj-sidebar-section-heading">
        <ArchiveIcon size={15} />
        <span className="mj-sidebar-section-label mj-sidebar-copy">{copy.archiveArtifacts}</span>
        <span className="mj-sidebar-section-status">{artifacts.length}</span>
      </div>
      {artifacts.length ? (
        <div className="mj-sidebar-archive-list">
          {artifacts.map((artifact) => (
            <div className="mj-sidebar-archived-row" key={artifact.id}>
              <a href={`/studio?artifact=${encodeURIComponent(artifact.id)}`} className="mj-sidebar-chat" title={artifact.title}>
                <span className="mj-sidebar-chat-title mj-sidebar-copy">{artifact.title}</span>
                <small>{copy.daysLeft(daysUntilArtifactDeletion(artifact.archivedAt ?? new Date().toISOString()))}</small>
              </a>
              <div className="mj-sidebar-chat-actions">
                <button className="mj-sidebar-chat-action" type="button" aria-label={`Restore ${artifact.title}`} title={`Restore ${artifact.title}`} onClick={() => onRestore(artifact)}>↶</button>
                <button className="mj-sidebar-chat-action mj-sidebar-chat-action--danger" type="button" aria-label={`Delete ${artifact.title}`} title={`Delete ${artifact.title}`} onClick={() => onDelete(artifact)}><TrashIcon size={14} /></button>
              </div>
            </div>
          ))}
        </div>
      ) : <span className="mj-sidebar-empty mj-sidebar-copy">{copy.archiveEmpty}</span>}
      <p className="mj-sidebar-archive-note mj-sidebar-copy">{copy.archiveRetention}</p>
    </section>
  );
}

function collapsedTitle(title: string): string {
  return title;
}

function formatRelativeDate(value: string, locale: PublicLocale = "en"): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "";
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  if (sameDay) return date.toLocaleTimeString(locale === "ja" ? "ja-JP" : "en-US", { hour: "numeric", minute: "2-digit" });
  const days = Math.max(1, Math.round((now.valueOf() - date.valueOf()) / 86_400_000));
  const copy = WORKSPACE_COPY[locale].sidebar;
  if (days === 1) return copy.yesterday;
  if (days < 7) return copy.daysAgo(days);
  return date.toLocaleDateString(locale === "ja" ? "ja-JP" : "en-US", { month: "short", day: "numeric" });
}

function chatFromRun(value: unknown): ChatSummary[] {
  if (!value || typeof value !== "object") return [];
  const run = value as Record<string, unknown>;
  if (typeof run.id !== "string" || typeof run.task_prompt !== "string") return [];
  const summary = verificationFromResource(run);
  const status = run.status === "failed"
    ? "failed"
    : run.status === "succeeded" && summary?.decision === "pass" && summary.evidence_strength === "physical"
      ? "verified"
      : run.status === "running"
        ? "running"
        : run.status === "succeeded"
          ? "draft"
          : "queued";
  return [{
    id: run.id,
    title: titleFromPrompt(run.task_prompt),
    prompt: run.task_prompt,
    createdAt: typeof run.created_at === "string" ? run.created_at : new Date().toISOString(),
    status,
    conversationId: typeof run.conversation_id === "string" ? run.conversation_id : undefined,
    framework: typeof run.framework === "string" ? run.framework.toUpperCase() : undefined,
    folderId: typeof run.folder_id === "string" ? run.folder_id : undefined,
  }];
}

