"use client";

import type { DragEvent, FormEvent, ReactNode } from "react";
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
  createChatFolder,
  createRemoteChatFolder,
  daysUntilArchiveDeletion,
  deleteChat,
  hydrateChatFolders,
  loadChatFolders,
  loadChatHistory,
  restoreChat,
  updateChat,
  type ChatFolder,
  type ChatStatus,
  type ChatSummary,
} from "../lib/chat-history";
import {
  ARTIFACT_FOLDERS_EVENT,
  assignArtifactToFolder,
  createArtifactFolder,
  getArtifactFolderId,
  loadArtifactFolders,
  type ArtifactFolder,
} from "../lib/artifact-folders";
import { archiveArtifact, daysUntilArtifactDeletion, deleteArtifact, getLibraryArtifact, isArtifactDeleted, loadLibraryArtifacts, rememberArtifact, restoreArtifact, type LibraryArtifact } from "../lib/library-data";
import { WORKSPACE_PINS_EVENT, isPinned, setPinned, togglePinned } from "../lib/workspace-pins";
import { ThemeToggle } from "./theme-toggle";
import type { PublicLocale } from "../lib/public-locale";
import { WORKSPACE_COPY } from "../lib/workspace-locale";

const SIDEBAR_STORAGE_KEY = "majorana.sidebar-collapsed.v1";
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
}: {
  children: ReactNode;
  headerRight?: ReactNode;
  demoMode?: boolean;
  locale?: PublicLocale;
  /** Signed-in user's display name for the sidebar footer. Omitted on surfaces
   * with no session (the /dev fixtures page), which fall back to the generic label. */
  accountName?: string;
}) {
  const pathname = usePathname();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [archivedChats, setArchivedChats] = useState<ChatSummary[]>([]);
  const [chatFolders, setChatFolders] = useState<ChatFolder[]>([]);
  const [artifacts, setArtifacts] = useState<LibraryArtifact[]>([]);
  const [archivedArtifacts, setArchivedArtifacts] = useState<LibraryArtifact[]>([]);
  const [artifactFolders, setArtifactFolders] = useState<ArtifactFolder[]>([]);
  const [folderSyncState, setFolderSyncState] = useState<"local" | "synced" | "error">("local");
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    const saved = window.localStorage.getItem(SIDEBAR_STORAGE_KEY);
    setSidebarCollapsed(saved === "true" || (saved === null && window.innerWidth < 720));
  }, []);

  useEffect(() => {
    let active = true;

    async function refreshWorkspace() {
      const localHistory = loadChatHistory({ includeDemo: demoMode, includeArchived: true });
      const localActiveChats = localHistory.filter((chat) => !chat.archivedAt);
      setChatFolders(loadChatFolders());
      setArtifactFolders(loadArtifactFolders());
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

      try {
        const [runsResponse, artifactsResponse] = await Promise.all([
          fetch("/api/runs?limit=50", { cache: "no-store" }),
          fetch("/api/artifacts", { cache: "no-store" }),
        ]);
        const runPayload = runsResponse.ok ? ((await runsResponse.json()) as unknown) : [];
        const artifactPayload = artifactsResponse.ok ? ((await artifactsResponse.json()) as unknown) : [];
        const byId = new Map(Array.isArray(runPayload) ? runPayload.flatMap(chatFromRun).map((chat) => [chat.id, chat]) : []);
        for (const local of loadChatHistory({ includeDemo: false, includeArchived: true })) {
          const remote = byId.get(local.id);
          byId.set(
            local.id,
            remote
              ? { ...local, ...remote, title: local.titleOverride ?? remote.title, folderId: remote.folderId ?? local.folderId }
              : local,
          );
        }
        const mergedChats = [...byId.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        const remoteArtifacts = Array.isArray(artifactPayload) ? artifactPayload.flatMap(toLibraryArtifact).filter((artifact) => !isArtifactDeleted(artifact.id)) : [];
        const storedArtifacts = loadLibraryArtifacts({ includeArchived: true });
        const artifactById = new Map([...remoteArtifacts, ...storedArtifacts].map((artifact) => [artifact.id, artifact]));
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
      setArtifactFolders(loadArtifactFolders());
    };
    window.addEventListener(CHAT_HISTORY_EVENT, refreshWorkspace);
    window.addEventListener(CHAT_FOLDERS_EVENT, refreshFolders);
    window.addEventListener(ARTIFACT_FOLDERS_EVENT, refreshFolders);
    window.addEventListener(WORKSPACE_PINS_EVENT, refreshWorkspace);
    return () => {
      active = false;
      window.removeEventListener(CHAT_HISTORY_EVENT, refreshWorkspace);
      window.removeEventListener(CHAT_FOLDERS_EVENT, refreshFolders);
      window.removeEventListener(ARTIFACT_FOLDERS_EVENT, refreshFolders);
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
          artifactFolders={artifactFolders}
          collapsed={sidebarCollapsed}
          demoMode={demoMode}
          folderSyncState={folderSyncState}
          locale={locale}
          accountName={accountName}
          onArchive={(chat) => {
            archiveChat(chat.id, chat);
            refreshAfterLocalChange();
          }}
          onRestore={(chat) => {
            restoreChat(chat.id);
            refreshAfterLocalChange();
          }}
          onArchiveArtifact={(artifact) => {
            archiveArtifact(artifact.id, artifact);
            refreshAfterLocalChange();
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
    </AppShell>
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
  artifactFolders,
  collapsed,
  demoMode,
  folderSyncState,
  locale,
  accountName,
  onArchive,
  onRestore,
  onArchiveArtifact,
  onRestoreArtifact,
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
  artifactFolders: ArtifactFolder[];
  collapsed: boolean;
  demoMode: boolean;
  folderSyncState: "local" | "synced" | "error";
  locale: PublicLocale;
  accountName?: string;
  onArchive: (chat: ChatSummary) => void;
  onRestore: (chat: ChatSummary) => void;
  onArchiveArtifact: (artifact: LibraryArtifact) => void;
  onRestoreArtifact: (artifact: LibraryArtifact) => void;
  onDeleteChat: (chat: ChatSummary) => void;
  onDeleteArtifact: (artifact: LibraryArtifact) => void;
  onRenameChat: (chat: ChatSummary, name: string) => void;
  onRenameArtifact: (artifact: LibraryArtifact, name: string) => void;
}) {
  const copy = WORKSPACE_COPY[locale].sidebar;
  const [openFolders, setOpenFolders] = useState<Set<string>>(new Set());
  const [dragTarget, setDragTarget] = useState<string | null>(null);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [creatingArtifactFolder, setCreatingArtifactFolder] = useState(false);
  const [artifactFolderName, setArtifactFolderName] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const runHref = demoMode ? "/demo?view=run" : "/run";
  const studioHref = demoMode ? "/demo?view=library" : "/studio";
  // Title and subtitle must never be the same string: before accountName was
  // plumbed through, both rendered copy.personalWorkspace and the footer showed
  // "Personal workspace" twice, stacked.
  const sidebarName = demoMode ? copy.publicPreview : accountName || copy.personalWorkspace;
  const sidebarSubtitle = demoMode
    ? copy.readOnlyData
    : accountName
      ? copy.personalWorkspace
      : null;
  const sidebarInitial = sidebarName.slice(0, 1).toUpperCase();
  const pinnedChats = chats.filter((chat) => isPinned("chat", chat.id));
  const unpinnedChats = chats.filter((chat) => !isPinned("chat", chat.id));
  const pinnedArtifacts = artifacts.filter((artifact) => isPinned("artifact", artifact.id));
  const unpinnedArtifacts = artifacts.filter((artifact) => !isPinned("artifact", artifact.id));
  const standaloneChats = unpinnedChats.filter((chat) => !chat.folderId);
  const standaloneArtifacts = unpinnedArtifacts.filter((artifact) => !getArtifactFolderId(artifact.id));

  useEffect(() => {
    if (!deleteTarget) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDeleteTarget(null);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [deleteTarget]);

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

  function submitArtifactFolder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    createArtifactFolder(artifactFolderName);
    setArtifactFolderName("");
    setCreatingArtifactFolder(false);
  }

  function assignFolder(chatId: string, folderId?: string) {
    assignChatToFolder(chatId, folderId);
    if (!demoMode) void assignChatToRemoteFolder(chatId, folderId).catch(() => undefined);
  }

  function assignArtifact(artifactId: string, folderId?: string) {
    assignArtifactToFolder(artifactId, folderId);
  }

  // HTML5 drag & drop: rows publish their id under a kind-specific type, folder
  // triggers and the standalone lists accept only the matching kind.
  function dropProps(kind: "chat" | "artifact", targetKey: string, folderId?: string) {
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
        <a className={surface === "run" ? "is-active" : ""} href={runHref} aria-current={surface === "run" ? "page" : undefined}>
          <PlayIcon size={15} />
          <span className="mj-sidebar-copy">{copy.run}</span>
        </a>
        <a className={surface === "studio" ? "is-active" : ""} href={studioHref} aria-current={surface === "studio" ? "page" : undefined}>
          <StudioIcon size={15} />
          <span className="mj-sidebar-copy">{copy.studio}</span>
        </a>
      </nav>

      {surface === "run" ? (
        <div className="mj-sidebar-scroll">
          <a className="mj-sidebar-new" href={runHref}>
            <PlusIcon size={16} />
            <span className="mj-sidebar-copy">{copy.newChat}</span>
          </a>
          <a className="mj-sidebar-library-link" href={demoMode ? "/demo?view=library" : "/library"}>
            <LibraryIcon size={16} />
            <span className="mj-sidebar-copy">{copy.library}</span>
          </a>

          {pinnedChats.length ? (
            <>
              <SidebarSectionHeader label={copy.pinned} />
              <nav className="mj-sidebar-chats mj-sidebar-pinned-list" aria-label={copy.pinned}>
                {pinnedChats.map((chat) => <ChatRow key={chat.id} chat={chat} currentPath={currentPath} demoMode={demoMode} locale={locale} onArchive={onArchive} onDelete={(item) => setDeleteTarget({ kind: "chat", item })} onAssignFolder={assignFolder} onRename={onRenameChat} folders={folders} />)}
              </nav>
            </>
          ) : null}

          <SidebarSectionHeader label={copy.projects} status={folderSyncState === "synced" ? copy.synced : folderSyncState === "error" ? copy.localOnly : undefined} actionLabel={copy.createChatFolder} onAction={() => setCreatingFolder(true)} />
          {creatingFolder ? (
            <form className="mj-sidebar-folder-form" onSubmit={submitChatFolder}>
              <input aria-label={copy.folderName} autoFocus maxLength={80} value={folderName} onChange={(event) => setFolderName(event.target.value)} placeholder={copy.folderName} />
              <button type="submit" aria-label={copy.saveFolder} disabled={!folderName.trim()}>✓</button>
              <button type="button" aria-label={copy.cancelFolder} onClick={() => { setCreatingFolder(false); setFolderName(""); }}>×</button>
            </form>
          ) : null}
          <div className="mj-sidebar-folder-list">
            {folders.map((folder) => {
              const folderChats = unpinnedChats.filter((chat) => chat.folderId === folder.id);
              return (
                <div className="mj-sidebar-disclosure" key={folder.id}>
                  <button className="mj-sidebar-folder-trigger" type="button" aria-expanded={openFolders.has(folder.id)} onClick={() => toggleFolder(folder.id)} {...dropProps("chat", `chat-folder-${folder.id}`, folder.id)}>
                    <ChevronIcon className={openFolders.has(folder.id) ? "is-open" : ""} size={14} />
                    <FolderIcon size={15} />
                    <span className="mj-sidebar-copy">{folder.name}</span>
                    <span className="mj-sidebar-folder-count">{folderChats.length}</span>
                  </button>
                  {openFolders.has(folder.id) ? (
                    <div className="mj-sidebar-disclosure-items">
                      {folderChats.length ? folderChats.map((chat) => <ChatRow key={chat.id} chat={chat} currentPath={currentPath} demoMode={demoMode} locale={locale} onArchive={onArchive} onDelete={(item) => setDeleteTarget({ kind: "chat", item })} onAssignFolder={assignFolder} onRename={onRenameChat} folders={folders} />) : <span className="mj-sidebar-empty">{copy.emptyProject}</span>}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>

          <SidebarSectionHeader label={copy.chats} />
          <nav className="mj-sidebar-chats" aria-label={copy.recentChats} {...dropProps("chat", "chat-standalone", undefined)}>
            {standaloneChats.length ? standaloneChats.map((chat) => <ChatRow key={chat.id} chat={chat} currentPath={currentPath} demoMode={demoMode} locale={locale} onArchive={onArchive} onDelete={(item) => setDeleteTarget({ kind: "chat", item })} onAssignFolder={assignFolder} onRename={onRenameChat} folders={folders} />) : <span className="mj-sidebar-empty">{copy.emptyChats}</span>}
          </nav>

          <ArchiveSection chats={archivedChats} currentPath={currentPath} locale={locale} demoMode={demoMode} onRestore={onRestore} onDelete={onDeleteChat} />
        </div>
      ) : (
        <div className="mj-sidebar-scroll">
          <a className="mj-sidebar-new" href={demoMode ? studioHref : "/studio?new=1"}>
            <PlusIcon size={16} />
            <span className="mj-sidebar-copy">{copy.newArtifact}</span>
          </a>
          <a className="mj-sidebar-library-link" href={demoMode ? "/demo?view=library" : "/library"}>
            <LibraryIcon size={16} />
            <span className="mj-sidebar-copy">{copy.library}</span>
          </a>

          {pinnedArtifacts.length ? (
            <>
              <SidebarSectionHeader label={copy.pinned} />
              <nav className="mj-sidebar-chats mj-sidebar-pinned-list" aria-label={copy.pinned}>
                {pinnedArtifacts.map((artifact) => <ArtifactRow key={artifact.id} artifact={artifact} currentPath={currentPath} folders={artifactFolders} onAssignFolder={assignArtifact} onArchive={onArchiveArtifact} onDelete={(item) => setDeleteTarget({ kind: "artifact", item })} onRename={onRenameArtifact} locale={locale} />)}
              </nav>
            </>
          ) : null}

          <SidebarSectionHeader label={copy.projects} actionLabel={copy.createArtifactFolder} onAction={() => setCreatingArtifactFolder(true)} />
          {creatingArtifactFolder ? (
            <form className="mj-sidebar-folder-form" onSubmit={submitArtifactFolder}>
              <input aria-label={copy.folderName} autoFocus maxLength={80} value={artifactFolderName} onChange={(event) => setArtifactFolderName(event.target.value)} placeholder={copy.folderName} />
              <button type="submit" aria-label={copy.saveFolder} disabled={!artifactFolderName.trim()}>✓</button>
              <button type="button" aria-label={copy.cancelFolder} onClick={() => { setCreatingArtifactFolder(false); setArtifactFolderName(""); }}>×</button>
            </form>
          ) : null}
          <div className="mj-sidebar-folder-list">
            {artifactFolders.map((folder) => {
              const folderArtifacts = unpinnedArtifacts.filter((artifact) => getArtifactFolderId(artifact.id) === folder.id);
              return (
                <div className="mj-sidebar-disclosure" key={folder.id}>
                  <button className="mj-sidebar-folder-trigger" type="button" aria-expanded={openFolders.has(folder.id)} onClick={() => toggleFolder(folder.id)} {...dropProps("artifact", `artifact-folder-${folder.id}`, folder.id)}>
                    <ChevronIcon className={openFolders.has(folder.id) ? "is-open" : ""} size={14} />
                    <FolderIcon size={15} />
                    <span className="mj-sidebar-copy">{folder.name}</span>
                    <span className="mj-sidebar-folder-count">{folderArtifacts.length}</span>
                  </button>
                  {openFolders.has(folder.id) ? (
                    <div className="mj-sidebar-disclosure-items">
                      {folderArtifacts.length ? folderArtifacts.map((artifact) => <ArtifactRow key={artifact.id} artifact={artifact} currentPath={currentPath} folders={artifactFolders} onAssignFolder={assignArtifact} onArchive={onArchiveArtifact} onDelete={(item) => setDeleteTarget({ kind: "artifact", item })} onRename={onRenameArtifact} locale={locale} />) : <span className="mj-sidebar-empty">{copy.emptyProject}</span>}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>

          <SidebarSectionHeader label={copy.artifacts} />
          <nav className="mj-sidebar-chats" aria-label={copy.artifacts} {...dropProps("artifact", "artifact-standalone", undefined)}>
            {standaloneArtifacts.length ? standaloneArtifacts.map((artifact) => <ArtifactRow key={artifact.id} artifact={artifact} currentPath={currentPath} folders={artifactFolders} onAssignFolder={assignArtifact} onArchive={onArchiveArtifact} onDelete={(item) => setDeleteTarget({ kind: "artifact", item })} onRename={onRenameArtifact} locale={locale} />) : <span className="mj-sidebar-empty">{copy.emptyArtifacts}</span>}
          </nav>
          <ArtifactArchiveSection artifacts={archivedArtifacts} locale={locale} onRestore={onRestoreArtifact} onDelete={onDeleteArtifact} />
          <a className="mj-sidebar-library-link mj-sidebar-library-link--bottom" href={demoMode ? "/demo?view=library" : "/library"}>
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
              {sidebarSubtitle ? <small>{sidebarSubtitle}</small> : null}
            </span>
          </a>
        ) : (
          <div className="mj-sidebar-user-menu" onMouseLeave={() => setUserMenuOpen(false)}>
            <button className="mj-sidebar-user" type="button" aria-label={copy.accountMenu} aria-expanded={userMenuOpen} onClick={() => setUserMenuOpen((value) => !value)}>
              <span className="mj-avatar">{sidebarInitial}</span>
              <span className="mj-sidebar-user-copy mj-sidebar-copy">
                <strong>{sidebarName}</strong>
                {sidebarSubtitle ? <small>{sidebarSubtitle}</small> : null}
              </span>
              <span className="mj-sidebar-user-caret mj-sidebar-copy">⌄</span>
            </button>
            {userMenuOpen ? (
              <div className="mj-sidebar-user-popover" role="menu">
                <div className="mj-sidebar-user-popover-name">
                  <strong>{sidebarName}</strong>
                  {sidebarSubtitle ? <small>{sidebarSubtitle}</small> : null}
                </div>
                <a role="menuitem" href="/account"><SettingsIcon size={15} />{copy.settings}</a>
                <a role="menuitem" href="/account#usage">{copy.usageLimits}</a>
                <a role="menuitem" className="is-danger" href="/auth/sign-out">{copy.signOut}</a>
              </div>
            ) : null}
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

function ArtifactRow({ artifact, currentPath, folders, onAssignFolder, onArchive, onDelete, onRename, locale }: { artifact: LibraryArtifact; currentPath: string; folders: ArtifactFolder[]; onAssignFolder: (artifactId: string, folderId?: string) => void; onArchive: (artifact: LibraryArtifact) => void; onDelete: (artifact: LibraryArtifact) => void; onRename: (artifact: LibraryArtifact, name: string) => void; locale: PublicLocale }) {
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
          currentFolderId={getArtifactFolderId(artifact.id) ?? undefined}
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
    <div className="mj-delete-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}>
      <section className="mj-delete-dialog" role="dialog" aria-modal="true" aria-labelledby="mj-delete-dialog-title">
        <p className="mj-eyebrow">{target.kind === "chat" ? copy.chats : copy.artifacts}</p>
        <h2 id="mj-delete-dialog-title">{copy.deleteConfirmTitle}</h2>
        <p>{warning}</p>
        <div className="mj-delete-dialog-actions">
          <button className="mj-secondary-button" type="button" onClick={onCancel}>{copy.cancel}</button>
          <button className="mj-danger-button" type="button" onClick={onConfirm}>{copy.delete}</button>
        </div>
      </section>
    </div>
  );
}

function ArchiveSection({ chats, currentPath, locale, demoMode, onRestore, onDelete }: { chats: ChatSummary[]; currentPath: string; locale: PublicLocale; demoMode: boolean; onRestore: (chat: ChatSummary) => void; onDelete: (chat: ChatSummary) => void }) {
  const copy = WORKSPACE_COPY[locale].sidebar;
  return (
    <section className="mj-sidebar-archive" aria-label={copy.archive}>
      <div className="mj-sidebar-section-heading">
        <ArchiveIcon size={15} />
        <span className="mj-sidebar-section-label mj-sidebar-copy">{copy.archive}</span>
        <span className="mj-sidebar-section-status">{chats.length}</span>
      </div>
      {chats.length ? (
        <div className="mj-sidebar-archive-list">
          {chats.map((chat) => (
            <div className="mj-sidebar-archived-row" key={chat.id}>
              <a href={demoMode ? "/demo?view=run" : `/run/${chat.id}`} className="mj-sidebar-chat" title={chat.title}>
                <span className="mj-sidebar-chat-title mj-sidebar-copy">{chat.title}</span>
                <small>{copy.daysLeft(daysUntilArchiveDeletion(chat.archivedAt ?? new Date().toISOString()))}</small>
              </a>
              {!demoMode ? (
                <div className="mj-sidebar-chat-actions">
                  <button className="mj-sidebar-chat-action" type="button" aria-label={copy.restoreChat(chat.title)} title={copy.restoreChat(chat.title)} onClick={() => onRestore(chat)}>↶</button>
                  <button className="mj-sidebar-chat-action mj-sidebar-chat-action--danger" type="button" aria-label={copy.deleteChat(chat.title)} title={copy.deleteChat(chat.title)} onClick={() => onDelete(chat)}><TrashIcon size={14} /></button>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : <span className="mj-sidebar-empty mj-sidebar-copy">{copy.archiveEmpty}</span>}
      <p className="mj-sidebar-archive-note mj-sidebar-copy">{copy.archiveRetention}</p>
    </section>
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
  const status = run.status === "failed"
    ? "failed"
    : run.status === "succeeded" && run.verifier_decision === "pass"
      ? "verified"
      : run.status === "running"
        ? "running"
        : "queued";
  return [{
    id: run.id,
    title: titleFromPrompt(run.task_prompt),
    prompt: run.task_prompt,
    createdAt: typeof run.created_at === "string" ? run.created_at : new Date().toISOString(),
    status,
    framework: typeof run.framework === "string" ? run.framework.toUpperCase() : undefined,
    folderId: typeof run.folder_id === "string" ? run.folder_id : undefined,
  }];
}

function toLibraryArtifact(value: unknown): LibraryArtifact[] {
  if (!value || typeof value !== "object") return [];
  const remote = value as Record<string, unknown>;
  if (typeof remote.id !== "string" || typeof remote.title !== "string") return [];
  const existing = getLibraryArtifact(remote.id);
  const slug = typeof remote.slug === "string" ? remote.slug : remote.id;
  return [{
    id: remote.id,
    slug,
    title: remote.title,
    family: typeof remote.family === "string" ? remote.family : "Simulation",
    framework: typeof remote.framework === "string" ? remote.framework : "Qiskit",
    status: existing?.status ?? (slug.startsWith("public-") ? "verified_caveats" : "verified"),
    updatedAt: typeof remote.updated_at === "string" ? remote.updated_at : new Date().toISOString(),
    description: existing?.description ?? "Saved artifact in the workspace vault.",
    tags: existing?.tags ?? [typeof remote.family === "string" ? remote.family.toLowerCase() : "artifact"],
    verification: existing?.verification ?? "Verification evidence is available after loading the current version.",
    code: existing?.code ?? "",
    qasm: existing?.qasm ?? null,
    currentVersionId: typeof remote.current_version_id === "string" ? remote.current_version_id : existing?.currentVersionId,
    resourceRows: existing?.resourceRows ?? [],
    runId: existing?.runId,
    source: existing?.source ?? (slug.startsWith("public-") ? "public" : "run"),
  }];
}

function titleFromPrompt(prompt: string): string {
  const firstLine = prompt.split(/\r?\n/, 1)[0].trim();
  return firstLine.length > 54 ? `${firstLine.slice(0, 54).trimEnd()}…` : firstLine;
}
