"use client";

import { useEffect, useRef, useState } from "react";
import { accountInitials } from "../lib/account-identity";
import {
  PRESENCE_HEARTBEAT_INTERVAL_MS,
  fetchViewers,
  sendHeartbeat,
  splitForDisplay,
  viewerName,
  type PresenceTargetType,
  type PresenceViewer,
} from "../lib/presence";
import type { PublicLocale } from "../lib/public-locale";
import { PRESENCE_COPY } from "../lib/workspace-locale";

/**
 * Who else in the workspace is looking at this run, notebook or saved circuit,
 * right now (proposal 9, second slice). A row of small avatars, "you" never
 * among them, updating within `PRESENCE_HEARTBEAT_INTERVAL_MS` of a viewer
 * arriving or leaving.
 *
 * While the tab is visible (Page Visibility API), it heartbeats and re-reads
 * the roster on the same interval; hidden, it does neither, so a backgrounded
 * tab neither claims to be here nor spends a request pretending to be.
 *
 * Renders nothing when nobody else is here — this is meant to be noticed only
 * when it has something to say.
 *
 * `initial` is for the screenshot harness under `/dev/ui`, which renders the
 * real component with fixture data and no control plane behind it. Given an
 * initial list, the bar does not fetch or heartbeat.
 */
export function PresenceBar({
  targetType,
  targetId,
  locale = "en",
  initial,
}: {
  targetType: PresenceTargetType;
  targetId: string;
  locale?: PublicLocale;
  initial?: PresenceViewer[];
}) {
  const copy = PRESENCE_COPY[locale];
  const [viewers, setViewers] = useState<PresenceViewer[]>(initial ?? []);
  const activeRef = useRef(true);

  useEffect(() => {
    if (initial) return;
    activeRef.current = true;
    let timer: ReturnType<typeof setInterval> | null = null;

    async function beatAndRead() {
      try {
        await sendHeartbeat(fetch, targetType, targetId);
      } catch {
        // A missed heartbeat just means this tab drops off others' rosters a
        // little late; nothing here is worth surfacing to this reader.
      }
      try {
        const next = await fetchViewers(fetch, targetType, targetId);
        if (activeRef.current) setViewers(next);
      } catch {
        // Presence is decoration, never a blocking state: keep the last known
        // roster rather than show an error for who else is looking.
      }
    }

    function start() {
      if (timer) return;
      void beatAndRead();
      timer = setInterval(() => void beatAndRead(), PRESENCE_HEARTBEAT_INTERVAL_MS);
    }
    function stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    }
    function onVisibilityChange() {
      if (document.visibilityState === "visible") start();
      else stop();
    }

    document.addEventListener("visibilitychange", onVisibilityChange);
    if (document.visibilityState === "visible") start();

    return () => {
      activeRef.current = false;
      stop();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
    // `initial` is a harness-only prop and never changes after mount.
  }, [targetType, targetId]);

  if (!viewers.length) return null;

  const { shown, overflow } = splitForDisplay(viewers);
  const names = viewers.map(viewerName);

  return (
    <div className="mj-presence" role="group" aria-label={copy.ariaLabel(names)}>
      <ul className="mj-presence-stack">
        {shown.map((viewer) => {
          const name = viewerName(viewer);
          return (
            <li key={viewer.user_id} className="mj-avatar mj-presence-avatar" title={copy.viewing(name)}>
              {accountInitials(name)}
            </li>
          );
        })}
        {overflow.length ? (
          <li
            className="mj-avatar mj-presence-avatar mj-presence-overflow"
            title={copy.andMore(overflow.map(viewerName))}
          >
            +{overflow.length}
          </li>
        ) : null}
      </ul>
    </div>
  );
}
