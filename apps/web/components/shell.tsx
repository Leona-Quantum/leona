"use client";

// Client wrapper so AppShell gets the live pathname for aria-current.
import type { FormEvent, ReactNode } from "react";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AppShell, BRAND_NAME, NAV_SURFACES, navSurfaceLabel } from "@majorana/ui";
import {
  BrandMark,
  LibraryIcon,
  MoreIcon,
  PlayIcon,
  PlusIcon,
  SettingsIcon,
  StudioIcon,
} from "./icons";
import {
  CHAT_HISTORY_EVENT,
  CHAT_FOLDERS_EVENT,
  assignChatToRemoteFolder,
  assignChatToFolder,
  createChatFolder,
  createRemoteChatFolder,
  hydrateChatFolders,
  loadChatFolders,
  loadChatHistory,
  type ChatFolder,
  type ChatStatus,
  type ChatSummary,
} from "../lib/chat-history";
import { ThemeToggle } from "./theme-toggle";
import type { PublicLocale } from "../lib/public-locale";
import { WORKSPACE_COPY } from "../lib/workspace-locale";

const SIDEBAR_STORAGE_KEY = "majorana.sidebar-collapsed.v1";

export function Shell({
  children,
  headerRight,
  demoMode = false,
  userEmail,
  locale = "en",
}: {
  children: ReactNode;
  headerRight?: ReactNode;
  demoMode?: boolean;
  userEmail?: string;
  locale?: PublicLocale;
}) {
  const pathname = usePathname();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [folders, setFolders] = useState<ChatFolder[]>([]);
  const [folderSyncState, setFolderSyncState] = useState<"local" | "synced" | "error">("local");
  const folderSyncAttempted = useRef(false);

  useEffect(() => {
    const saved = window.localStorage.getItem(SIDEBAR_STORAGE_KEY);
    setSidebarCollapsed(saved === "true" || (saved === null && window.innerWidth < 720));
    folderSyncAttempted.current = demoMode;
    let active = true;
    setFolders(loadChatFolders());
    async function refresh() {
      const local = loadChatHistory({ includeDemo: demoMode });
      if (demoMode) {
        setChats(local);
        return;
      }
      let localFolderIdMap: Record<string, string> = {};
      if (!folderSyncAttempted.current) {
        folderSyncAttempted.current = true;
        try {
          const synced = await hydrateChatFolders(local);
          localFolderIdMap = synced.localIdMap;
          if (active) {
            setFolders(synced.folders);
            setFolderSyncState("synced");
          }
        } catch {
          if (active) setFolderSyncState("error");
        }
      }
      try {
        const response = await fetch("/api/runs?limit=20", { cache: "no-store" });
        const payload = (await response.json()) as unknown;
        const remote = Array.isArray(payload) ? payload.flatMap(chatFromRun) : [];
        const byId = new Map(remote.map((chat) => [chat.id, chat]));
        for (const chat of local) {
          const remoteChat = byId.get(chat.id);
          const localChat = chat.folderId
            ? { ...chat, folderId: localFolderIdMap[chat.folderId] ?? chat.folderId }
            : chat;
          byId.set(chat.id, remoteChat ? { ...localChat, ...remoteChat, folderId: remoteChat.folderId ?? localChat.folderId } : localChat);
        }
        if (active) setChats([...byId.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
      } catch {
        if (active) setChats(local);
      }
    }
    void refresh();
    window.addEventListener(CHAT_HISTORY_EVENT, refresh);
    const refreshFolders = () => setFolders(loadChatFolders());
    window.addEventListener(CHAT_FOLDERS_EVENT, refreshFolders);
    return () => {
      active = false;
      window.removeEventListener(CHAT_HISTORY_EVENT, refresh);
      window.removeEventListener(CHAT_FOLDERS_EVENT, refreshFolders);
    };
  }, [demoMode]);

  function toggleSidebar() {
    setSidebarCollapsed((current) => {
      const next = !current;
      window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(next));
      return next;
    });
  }

  const copy = WORKSPACE_COPY[locale];
  const activeSurface = NAV_SURFACES.find(
    (surface) => pathname === surface.href || pathname.startsWith(`${surface.href}/`),
  );
  const surfaceLabel = pathname.startsWith("/demo")
    ? copy.surfaces.preview
    : pathname.startsWith("/run")
      ? copy.surfaces.brandedRun
      : activeSurface
        ? navSurfaceLabel(activeSurface, locale)
        : BRAND_NAME;

  return (
    <AppShell
      currentPath={pathname}
      headerRight={
        <>
          <ThemeToggle />
          {headerRight}
        </>
      }
      sidebar={<WorkspaceSidebar currentPath={pathname} chats={chats} folders={folders} collapsed={sidebarCollapsed} demoMode={demoMode} userEmail={userEmail} folderSyncState={folderSyncState} locale={locale} />}
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
  chats,
  folders,
  collapsed,
  demoMode,
  userEmail,
  folderSyncState,
  locale,
}: {
  currentPath: string;
  chats: ChatSummary[];
  folders: ChatFolder[];
  collapsed: boolean;
  demoMode: boolean;
  userEmail?: string;
  folderSyncState: "local" | "synced" | "error";
  locale: PublicLocale;
}) {
  const copy = WORKSPACE_COPY[locale].sidebar;
  const demoHref = (view: "run" | "library") => `/demo?view=${view}`;
  const runHref = demoMode ? demoHref("run") : "/run";
  const libraryHref = demoMode ? demoHref("library") : "/library";
  const studioHref = demoMode ? libraryHref : "/studio";
  const sidebarName = demoMode ? copy.publicPreview : userEmail ?? copy.localDeveloper;
  const sidebarInitial = sidebarName.slice(0, 1).toUpperCase();
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [folderName, setFolderName] = useState("");
  const visibleChats = activeFolderId ? chats.filter((chat) => chat.folderId === activeFolderId) : chats;

  async function submitFolder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const created = demoMode ? null : await createRemoteChatFolder(folderName);
      if (created) setActiveFolderId(created.id);
      else {
        const next = createChatFolder(folderName);
        const local = next[next.length - 1];
        if (local) setActiveFolderId(local.id);
      }
    } catch {
      const next = createChatFolder(folderName);
      const local = next[next.length - 1];
      if (local) setActiveFolderId(local.id);
    }
    setFolderName("");
    setCreatingFolder(false);
  }

  function assignFolder(chatId: string, folderId?: string) {
    assignChatToFolder(chatId, folderId);
    void assignChatToRemoteFolder(chatId, folderId).catch(() => undefined);
  }

  return (
    <div className="mj-sidebar-inner">
      <div className="mj-sidebar-brand-row">
        <a href="/" className="mj-sidebar-brand" aria-label={BRAND_NAME}>
          <BrandMark size={20} />
          <span className="mj-sidebar-copy">{BRAND_NAME}</span>
        </a>
        <button className="mj-sidebar-more" type="button" aria-label={copy.workspaceOptions}>
          <MoreIcon size={16} />
        </button>
      </div>

      <a className="mj-sidebar-new" href={runHref}>
        <PlusIcon size={16} />
        <span className="mj-sidebar-copy">{copy.newChat}</span>
      </a>

      <div className="mj-sidebar-scroll">
        <div className="mj-sidebar-section-label">
          <span className="mj-sidebar-copy">{copy.recent}</span>
        </div>
        <nav className="mj-sidebar-chats" aria-label={copy.recentChats}>
          {visibleChats.map((chat) => (
            <div className="mj-sidebar-chat-row" key={chat.id}>
              <a
                className={`mj-sidebar-chat${currentPath === `/run/${chat.id}` ? " is-active" : ""}`}
                href={demoMode ? runHref : `/run/${chat.id}`}
                title={collapsed ? chat.title : undefined}
              >
                <span className={`mj-chat-status mj-chat-status--${chat.status}`} aria-hidden="true">
                  {statusGlyph(chat.status)}
                </span>
                <span className="mj-sidebar-chat-title mj-sidebar-copy">{chat.title}</span>
                <span className="mj-sidebar-chat-time mj-sidebar-copy">{formatRelativeDate(chat.createdAt, locale)}</span>
              </a>
              {!collapsed && !demoMode && folders.length > 0 ? (
                <select
                  aria-label={copy.moveToFolder(chat.title)}
                  className="mj-sidebar-chat-folder"
                  value={chat.folderId ?? ""}
                  onChange={(event) => assignFolder(chat.id, event.target.value || undefined)}
                >
                  <option value="">{copy.noFolder}</option>
                  {folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
                </select>
              ) : null}
            </div>
          ))}
        </nav>
        {!demoMode ? (
          <section className="mj-sidebar-folders" aria-label={copy.chatFolders}>
            <div className="mj-sidebar-section-label mj-sidebar-folder-heading">
              <span className="mj-sidebar-copy">{copy.folders}</span>
              <span className="mj-sidebar-copy" aria-live="polite">
                {folderSyncState === "synced" ? copy.synced : folderSyncState === "error" ? copy.localOnly : ""}
              </span>
              <button className="mj-sidebar-folder-add" type="button" aria-label={copy.createChatFolder} onClick={() => setCreatingFolder(true)}>+</button>
            </div>
            {creatingFolder ? (
              <form className="mj-sidebar-folder-form" onSubmit={submitFolder}>
                <input aria-label={copy.folderName} autoFocus maxLength={80} value={folderName} onChange={(event) => setFolderName(event.target.value)} placeholder={copy.folderName} />
                <button type="submit" aria-label={copy.saveFolder} disabled={!folderName.trim()}>✓</button>
                <button type="button" aria-label={copy.cancelFolder} onClick={() => { setCreatingFolder(false); setFolderName(""); }}>×</button>
              </form>
            ) : null}
            <button className={`mj-sidebar-folder${activeFolderId === null ? " is-active" : ""}`} type="button" onClick={() => setActiveFolderId(null)}>
              <span aria-hidden="true">◌</span><span className="mj-sidebar-copy">{copy.allChats}</span><span className="mj-sidebar-folder-count">{chats.length}</span>
            </button>
            {folders.map((folder) => (
              <button className={`mj-sidebar-folder${activeFolderId === folder.id ? " is-active" : ""}`} key={folder.id} type="button" onClick={() => setActiveFolderId(folder.id)}>
                <span aria-hidden="true">▱</span><span className="mj-sidebar-copy">{folder.name}</span><span className="mj-sidebar-folder-count">{chats.filter((chat) => chat.folderId === folder.id).length}</span>
              </button>
            ))}
          </section>
        ) : null}
        <a className="mj-sidebar-view-all" href={libraryHref}>
          <span className="mj-sidebar-copy">{copy.viewAll}</span>
          <span aria-hidden="true">→</span>
        </a>

        <nav className="mj-sidebar-nav" aria-label={copy.workspaceNav}>
          {NAV_SURFACES.filter((surface) => surface.href !== "/account").map((surface) => {
            const active = currentPath === surface.href || currentPath.startsWith(`${surface.href}/`);
            return (
              <a
                className={`mj-sidebar-nav-item${active || (demoMode && currentPath === "/demo") ? " is-active" : ""}`}
                href={demoMode ? (surface.href === "/library" ? libraryHref : studioHref) : surface.href}
                key={surface.href}
              >
                {surface.href === "/run" ? <PlayIcon size={16} /> : surface.href === "/library" ? <LibraryIcon size={16} /> : <StudioIcon size={16} />}
                <span className="mj-sidebar-copy">{navSurfaceLabel(surface, locale)}</span>
              </a>
            );
          })}
        </nav>
      </div>

      <div className="mj-sidebar-footer">
        <a className="mj-sidebar-nav-item" href={demoMode ? runHref : "/account"}>
          <SettingsIcon size={16} />
          <span className="mj-sidebar-copy">{copy.settings}</span>
        </a>
        <a className="mj-sidebar-user" href={demoMode ? runHref : "/account"}>
          <span className="mj-avatar">{sidebarInitial}</span>
          <span className="mj-sidebar-user-copy mj-sidebar-copy">
            <strong>{sidebarName}</strong>
            <small>{demoMode ? copy.readOnlyData : copy.personalWorkspace}</small>
          </span>
          <span className="mj-sidebar-user-caret mj-sidebar-copy">⌄</span>
        </a>
      </div>
    </div>
  );
}

function statusGlyph(status: ChatStatus): string {
  if (status === "verified") return "✓";
  if (status === "failed") return "×";
  if (status === "running") return "–";
  return "·";
}

function formatRelativeDate(value: string, locale: PublicLocale = "en"): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "";
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  if (sameDay) {
    return date.toLocaleTimeString(locale === "ja" ? "ja-JP" : "en-US", { hour: "numeric", minute: "2-digit" });
  }
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

function titleFromPrompt(prompt: string): string {
  const firstLine = prompt.split(/\r?\n/, 1)[0].trim();
  return firstLine.length > 54 ? `${firstLine.slice(0, 54).trimEnd()}…` : firstLine;
}
