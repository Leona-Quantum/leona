"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CommentBody } from "../lib/comment-body";
import { type Comment, fetchMentions, mergeComments, targetHref } from "../lib/comments";
import type { PublicLocale } from "../lib/public-locale";
import { COMMENTS_COPY } from "../lib/workspace-locale";

/**
 * "Mentions": comments in the active workspace that name the signed-in person,
 * newest first (`GET /v1/comments/mentions`).
 *
 * Lives in Settings as a pane (`/account#mentions`), reached from the account
 * menu, because that is where the other things that are about the person
 * rather than about one page already are. It is scoped to the workspace the
 * person is in, like everything else: switching workspaces shows that
 * workspace's mentions.
 *
 * `initial` is for the screenshot harness under `/dev/ui`; given it, the list
 * does not fetch.
 */
export function MentionsList({ locale = "en", initial }: { locale?: PublicLocale; initial?: Comment[] }) {
  const copy = COMMENTS_COPY[locale];
  const [items, setItems] = useState<Comment[]>(initial ?? []);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(initial ? "ready" : "loading");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (initial) return;
    let active = true;
    setStatus("loading");
    void (async () => {
      try {
        const page = await fetchMentions(fetch);
        if (!active) return;
        setItems(page.items);
        setNextCursor(page.next_cursor ?? null);
        setStatus("ready");
      } catch {
        if (active) setStatus("error");
      }
    })();
    return () => {
      active = false;
    };
    // `initial` is a harness-only prop and never changes after mount.
  }, [attempt]);

  async function loadMore() {
    if (!nextCursor) return;
    try {
      const page = await fetchMentions(fetch, nextCursor);
      // Newest first here, so the merged list is re-sorted the other way.
      setItems((current) => mergeComments(current, page.items).reverse());
      setNextCursor(page.next_cursor ?? null);
    } catch {
      setStatus("error");
    }
  }

  return (
    <section className="mj-artifact-panel mj-mentions" aria-labelledby="mentions-heading">
      <div className="mj-panel-heading">
        <h2 id="mentions-heading">{copy.mentionsTitle}</h2>
      </div>
      <p className="mj-mentions-lede">{copy.mentionsLede}</p>
      {status === "loading" ? <p className="mj-comments-state" role="status">{copy.loading}</p> : null}
      {status === "error" ? (
        <div className="mj-comments-state" role="alert">
          <p>{copy.mentionsFailed}</p>
          <button type="button" className="mj-secondary-button" onClick={() => setAttempt((n) => n + 1)}>
            {copy.retry}
          </button>
        </div>
      ) : null}
      {status === "ready" && !items.length ? <p className="mj-comments-state">{copy.mentionsEmpty}</p> : null}
      {status === "ready" && items.length ? (
        <ol className="mj-mentions-list">
          {items.map((item) => {
            const author = item.author?.current_member === false
              ? copy.formerMember
              : item.author?.display_name || (item.author ? `@${item.author.handle}` : copy.formerMember);
            return (
              <li key={item.id} className="mj-mention-item">
                <p className="mj-mention-line">
                  <strong>{copy.mentionedYou(author, item.target_type)}</strong>
                  <time dateTime={item.created_at}>{formatWhen(item.created_at, locale)}</time>
                </p>
                <CommentBody body={item.body} mentionHandles={(item.mentions ?? []).map((person) => person.handle)} />
                <Link className="mj-mention-open" href={targetHref(item.target_type, item.target_id)} prefetch={false}>
                  {copy.openTarget(item.target_type)}
                </Link>
              </li>
            );
          })}
        </ol>
      ) : null}
      {status === "ready" && nextCursor ? (
        <button type="button" className="mj-secondary-button mj-comments-more" onClick={() => void loadMore()}>
          {copy.showMore}
        </button>
      ) : null}
    </section>
  );
}

function formatWhen(iso: string, locale: PublicLocale): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(locale === "ja" ? "ja-JP" : "en", { dateStyle: "medium", timeStyle: "short" }).format(date);
}
