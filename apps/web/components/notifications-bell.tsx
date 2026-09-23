"use client";

import { useEffect, useRef, useState } from "react";

import "./notifications-bell.css";
import {
  type Notification,
  fetchNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  mergeNotifications,
  notificationHref,
  withAllRead,
  withRead,
} from "../lib/notifications";
import type { PublicLocale } from "../lib/public-locale";
import { WORKSPACE_COPY } from "../lib/workspace-locale";
import { BellIcon } from "./icons";

//: How often the badge refreshes while mounted, closed or open. Matches the
//: order of magnitude `shell.tsx`'s account drawer uses for its own numbers
//: (there, 30s, but only while that drawer is open); a bell's whole job is to
//: notice something without being opened, so this polls whether or not it is.
const POLL_MS = 60_000;
//: How stale the list may be before opening the drawer re-reads it, rather
//: than trusting a poll that already ran seconds ago.
const STALE_MS = 15_000;

function timeAgo(iso: string, locale: PublicLocale): string {
  const copy = WORKSPACE_COPY[locale].sidebar;
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return copy.notificationsJustNow;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return copy.notificationsAgo(minutes, "minute");
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return copy.notificationsAgo(hours, "hour");
  return copy.notificationsAgo(Math.floor(hours / 24), "day");
}

/**
 * The signed-in header's bell: an unread count, a list, mark-read (ai-ops
 * 349, option 2, "Job-finished notifications" and @-mentions).
 *
 * Self-contained on purpose, the way `TourHelpButton` and `ThemeToggle` sit
 * beside it in `AppShell`'s `headerRight`: this owns its own fetch, its own
 * open state and its own dismissal, so `shell.tsx` — already large — gains
 * one line rather than a new slice of its own state.
 */
export function NotificationsBell({
  locale = "en",
  demoMode = false,
}: {
  locale?: PublicLocale;
  demoMode?: boolean;
}) {
  const copy = WORKSPACE_COPY[locale].sidebar;
  const [items, setItems] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const readAt = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);

  async function refresh() {
    try {
      const list = await fetchNotifications(fetch);
      readAt.current = Date.now();
      setItems((current) => mergeNotifications(current, list.items));
      setUnreadCount(list.unread_count);
      setLoadedOnce(true);
    } catch {
      // Offline, signed out mid-session, or the control plane is down. The
      // bell is not the place to report any of those — it simply shows
      // whatever it last knew, same as the account drawer's usage numbers.
    }
  }

  // Polls while mounted, open or closed: a bell exists to be noticed without
  // being opened, unlike the account drawer's numbers, which nobody sees
  // until they click.
  useEffect(() => {
    if (demoMode) return;
    void refresh();
    const timer = window.setInterval(() => void refresh(), POLL_MS);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demoMode]);

  // Opening re-reads if the last read is more than STALE_MS old, the same
  // "do not trust a poll that might be seconds stale, but do not re-fetch on
  // every click either" rule the account drawer applies to `usage`.
  useEffect(() => {
    if (!open || demoMode) return;
    if (Date.now() - readAt.current < STALE_MS) return;
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, demoMode]);

  // Dismissal: click elsewhere, or Escape — the same deliberate rule
  // `shell.tsx`'s account drawer uses, for the reason its own comment gives:
  // a menu that closes on mouseleave has a dead zone the pointer can lose.
  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (containerRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      containerRef.current?.querySelector<HTMLButtonElement>(".mj-notif-bell")?.focus();
    };
    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  if (demoMode) return null;

  async function handleMarkRead(notification: Notification) {
    if (notification.read_at) return;
    const now = new Date().toISOString();
    setItems((current) => withRead(current, notification.id, now));
    setUnreadCount((count) => Math.max(0, count - 1));
    try {
      await markNotificationRead(fetch, notification.id);
    } catch {
      // The optimistic mark stands; the next poll reconciles it either way.
    }
  }

  async function handleMarkAllRead() {
    const now = new Date().toISOString();
    setItems((current) => withAllRead(current, now));
    setUnreadCount(0);
    try {
      await markAllNotificationsRead(fetch);
    } catch {
      // Same reasoning as a single mark: optimistic now, reconciled by the
      // next poll if the request did not actually make it.
    }
  }

  return (
    <div className="mj-notif-menu" data-open={open} ref={containerRef}>
      <button
        type="button"
        className="mj-notif-bell"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={unreadCount > 0 ? copy.notificationsUnread(unreadCount) : copy.notifications}
        title={copy.notifications}
        onClick={() => setOpen((value) => !value)}
      >
        <BellIcon size={16} />
        {unreadCount > 0 ? (
          <span className="mj-notif-badge" aria-hidden="true">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        ) : null}
      </button>
      <div className="mj-notif-drawer" role="menu" aria-label={copy.notifications}>
        <div className="mj-notif-drawer-panel">
          <div className="mj-notif-drawer-items">
            <div className="mj-notif-header">
              <span>{copy.notifications}</span>
              {unreadCount > 0 ? (
                <button type="button" className="mj-notif-mark-all" onClick={() => void handleMarkAllRead()}>
                  {copy.notificationsMarkAllRead}
                </button>
              ) : null}
            </div>
            {loadedOnce && items.length === 0 ? (
              <p className="mj-notif-empty">{copy.notificationsEmpty}</p>
            ) : (
              <ul className="mj-notif-list">
                {items.map((item) => {
                  const href = notificationHref(item);
                  const unread = !item.read_at;
                  const body = (
                    <>
                      <span className="mj-notif-summary">{item.summary}</span>
                      <span className="mj-notif-time">{timeAgo(item.created_at, locale)}</span>
                    </>
                  );
                  return (
                    <li key={item.id} className="mj-notif-item" data-unread={unread}>
                      {href ? (
                        <a
                          href={href}
                          role="menuitem"
                          onClick={() => void handleMarkRead(item)}
                        >
                          {body}
                        </a>
                      ) : (
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => void handleMarkRead(item)}
                        >
                          {body}
                        </button>
                      )}
                      {unread ? (
                        <button
                          type="button"
                          className="mj-notif-item-mark"
                          aria-label={copy.notificationsMarkRead}
                          title={copy.notificationsMarkRead}
                          onClick={() => void handleMarkRead(item)}
                        >
                          •
                        </button>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
