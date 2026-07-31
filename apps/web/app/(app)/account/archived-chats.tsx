"use client";

import { useEffect, useState } from "react";
import {
  CHAT_HISTORY_EVENT,
  collapseConversationChats,
  daysUntilArchiveDeletion,
  deleteChat,
  loadChatHistory,
  restoreChat,
  type ChatSummary,
} from "../../../lib/chat-history";
import { TrashIcon } from "../../../components/icons";
import { WORKSPACE_COPY } from "../../../lib/workspace-locale";
import type { PublicLocale } from "../../../lib/public-locale";
import { setPinned } from "../../../lib/workspace-pins";

/**
 * Archived chats, in settings.
 *
 * They used to live at the bottom of the Run sidebar, below every folder and
 * every recent chat — a permanently-mounted list of things the person had
 * explicitly said they were done with, in the rail where they work. The owner
 * moved them here; the sidebar now shows a dismissable banner at the moment of
 * archiving instead, which is when the information is actually useful.
 *
 * A client component because the archive is browser storage, not a table: there
 * is no server-side `archived_at` on runs. That also means this list is
 * per-browser, and the 14-day retention is swept lazily by `loadChatHistory`
 * rather than by anything server-side.
 */
export function ArchivedChats({ locale }: { locale: PublicLocale }) {
  const copy = WORKSPACE_COPY[locale].sidebar;
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [ready, setReady] = useState(false);
  // Delete here is PERMANENT and, unlike the sidebar's version, it is the only
  // delete on this surface — there is no archive to fall back to, because this
  // IS the archive. It gets the same confirmation the sidebar always had.
  const [pendingDelete, setPendingDelete] = useState<ChatSummary | null>(null);

  useEffect(() => {
    if (!pendingDelete) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPendingDelete(null);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [pendingDelete]);

  useEffect(() => {
    function refresh() {
      const history = collapseConversationChats(
        loadChatHistory({ includeDemo: false, includeArchived: true }),
      );
      setChats(history.filter((chat) => Boolean(chat.archivedAt)));
      setReady(true);
    }
    refresh();
    window.addEventListener(CHAT_HISTORY_EVENT, refresh);
    return () => window.removeEventListener(CHAT_HISTORY_EVENT, refresh);
  }, []);

  return (
    <section className="mj-artifact-panel" id="archived" aria-labelledby="archived-heading">
      <div className="mj-panel-heading">
        <h2 id="archived-heading">{copy.archive}</h2>
        {/* Rendered only once the effect has run: on the server this list is
            always empty, and a "0" that turns into "6" on hydration reads as a
            bug rather than as a count. */}
        <span className="mj-mono-muted">{ready ? chats.length : ""}</span>
      </div>
      <p className="mj-panel-help">{copy.archiveRetention}</p>
      {chats.length ? (
        <div className="mj-archived-list">
          {chats.map((chat) => (
            <div className="mj-archived-row" key={chat.id}>
              <a href={`/run/${chat.id}`} title={chat.title}>
                <span>{chat.title}</span>
                <small>{copy.daysLeft(daysUntilArchiveDeletion(chat.archivedAt ?? new Date().toISOString()))}</small>
              </a>
              <div className="mj-archived-row-actions">
                <button
                  type="button"
                  aria-label={copy.restoreChat(chat.title)}
                  title={copy.restoreChat(chat.title)}
                  onClick={() => restoreChat(chat.id)}
                >
                  ↶
                </button>
                <button
                  type="button"
                  className="is-danger"
                  aria-label={copy.deleteChat(chat.title)}
                  title={copy.deleteChat(chat.title)}
                  onClick={() => setPendingDelete(chat)}
                >
                  <TrashIcon size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="mj-panel-help">{ready ? copy.archiveEmpty : ""}</p>
      )}
      {pendingDelete ? (
        <div
          className="mj-delete-dialog-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setPendingDelete(null);
          }}
        >
          <section className="mj-delete-dialog" role="dialog" aria-modal="true" aria-labelledby="mj-archived-delete-title">
            <p className="mj-eyebrow">{copy.archive}</p>
            <h2 id="mj-archived-delete-title">{copy.deleteConfirmTitle}</h2>
            <p>{copy.deleteChatWarning(pendingDelete.title)}</p>
            <div className="mj-delete-dialog-actions">
              <button className="mj-secondary-button" type="button" onClick={() => setPendingDelete(null)}>
                {copy.cancel}
              </button>
              <button
                className="mj-danger-button"
                type="button"
                onClick={() => {
                  // Pin first, then the chat: the other order leaves the pin
                  // pointing at something that no longer exists, and the pinned
                  // list renders a row that goes nowhere.
                  setPinned("chat", pendingDelete.id, false);
                  deleteChat(pendingDelete.id);
                  setPendingDelete(null);
                }}
              >
                {copy.delete}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}
