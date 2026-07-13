"use client";

// Client wrapper so AppShell gets the live pathname for aria-current.
import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { AppShell, BRAND_NAME, NAV_SURFACES } from "@majorana/ui";
import {
  BrandMark,
  LibraryIcon,
  MoreIcon,
  PlayIcon,
  PlusIcon,
  SettingsIcon,
} from "./icons";
import {
  CHAT_HISTORY_EVENT,
  loadChatHistory,
  type ChatStatus,
  type ChatSummary,
} from "../lib/chat-history";

const SIDEBAR_STORAGE_KEY = "majorana.sidebar-collapsed.v1";

export function Shell({
  children,
  headerRight,
  demoMode = false,
}: {
  children: ReactNode;
  headerRight?: ReactNode;
  demoMode?: boolean;
}) {
  const pathname = usePathname();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [chats, setChats] = useState<ChatSummary[]>([]);

  useEffect(() => {
    const saved = window.localStorage.getItem(SIDEBAR_STORAGE_KEY);
    setSidebarCollapsed(saved === "true" || (saved === null && window.innerWidth < 720));
    const refresh = () => setChats(loadChatHistory());
    refresh();
    window.addEventListener(CHAT_HISTORY_EVENT, refresh);
    return () => window.removeEventListener(CHAT_HISTORY_EVENT, refresh);
  }, []);

  function toggleSidebar() {
    setSidebarCollapsed((current) => {
      const next = !current;
      window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(next));
      return next;
    });
  }

  const surfaceLabel = pathname.startsWith("/library")
    ? "Quepo Studio"
    : pathname.startsWith("/demo")
      ? "Public preview"
    : pathname.startsWith("/account")
      ? "Account"
      : "Nameko Run";

  return (
    <AppShell
      currentPath={pathname}
      headerRight={headerRight}
      sidebar={<WorkspaceSidebar currentPath={pathname} chats={chats} collapsed={sidebarCollapsed} demoMode={demoMode} />}
      sidebarCollapsed={sidebarCollapsed}
      onToggleSidebar={toggleSidebar}
      surfaceLabel={surfaceLabel}
    >
      {children}
    </AppShell>
  );
}

function WorkspaceSidebar({
  currentPath,
  chats,
  collapsed,
  demoMode,
}: {
  currentPath: string;
  chats: ChatSummary[];
  collapsed: boolean;
  demoMode: boolean;
}) {
  const demoHref = (view: "run" | "library") => `/demo?view=${view}`;
  const runHref = demoMode ? demoHref("run") : "/run";
  const libraryHref = demoMode ? demoHref("library") : "/library";

  return (
    <div className="mj-sidebar-inner">
      <div className="mj-sidebar-brand-row">
        <a href="/" className="mj-sidebar-brand" aria-label={BRAND_NAME}>
          <BrandMark size={20} />
          <span className="mj-sidebar-copy">{BRAND_NAME}</span>
        </a>
        <button className="mj-sidebar-more" type="button" aria-label="Workspace options">
          <MoreIcon size={16} />
        </button>
      </div>

      <a className="mj-sidebar-new" href={runHref}>
        <PlusIcon size={16} />
        <span className="mj-sidebar-copy">New chat</span>
      </a>

      <div className="mj-sidebar-scroll">
        <div className="mj-sidebar-section-label">
          <span className="mj-sidebar-copy">Recent</span>
        </div>
        <nav className="mj-sidebar-chats" aria-label="Recent chats">
          {chats.map((chat) => (
            <a
              className={`mj-sidebar-chat${currentPath === `/run/${chat.id}` ? " is-active" : ""}`}
              href={`/run/${chat.id}`}
              key={chat.id}
              title={collapsed ? chat.title : undefined}
            >
              <span className={`mj-chat-status mj-chat-status--${chat.status}`} aria-hidden="true">
                {statusGlyph(chat.status)}
              </span>
              <span className="mj-sidebar-chat-title mj-sidebar-copy">{chat.title}</span>
              <span className="mj-sidebar-chat-time mj-sidebar-copy">{formatRelativeDate(chat.createdAt)}</span>
            </a>
          ))}
        </nav>
        <a className="mj-sidebar-view-all" href={libraryHref}>
          <span className="mj-sidebar-copy">View all</span>
          <span aria-hidden="true">→</span>
        </a>

        <nav className="mj-sidebar-nav" aria-label="Workspace">
          {NAV_SURFACES.filter((surface) => surface.href !== "/account").map((surface) => {
            const active = currentPath === surface.href || currentPath.startsWith(`${surface.href}/`);
            return (
              <a
                className={`mj-sidebar-nav-item${active || (demoMode && currentPath === "/demo") ? " is-active" : ""}`}
                href={demoMode ? (surface.href === "/library" ? libraryHref : runHref) : surface.href}
                key={surface.href}
              >
                {surface.href === "/run" ? <PlayIcon size={16} /> : <LibraryIcon size={16} />}
                <span className="mj-sidebar-copy">{surface.href === "/library" ? "Library" : surface.label}</span>
              </a>
            );
          })}
        </nav>
      </div>

      <div className="mj-sidebar-footer">
        <a className="mj-sidebar-nav-item" href={demoMode ? runHref : "/account"}>
          <SettingsIcon size={16} />
          <span className="mj-sidebar-copy">Settings</span>
        </a>
        <a className="mj-sidebar-user" href={demoMode ? runHref : "/account"}>
          <span className="mj-avatar">L</span>
          <span className="mj-sidebar-user-copy mj-sidebar-copy">
            <strong>{demoMode ? "Public preview" : "Local developer"}</strong>
            <small>{demoMode ? "Read-only fixture data" : "Personal workspace"}</small>
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

function formatRelativeDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "";
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  if (sameDay) return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const days = Math.max(1, Math.round((now.valueOf() - date.valueOf()) / 86_400_000));
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}
