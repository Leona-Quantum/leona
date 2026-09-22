"use client";

import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { CommentBody } from "../lib/comment-body";
import {
  COMMENTS_ANCHOR,
  type Comment,
  type CommentPerson,
  type CommentTargetType,
  MAX_COMMENT_CHARS,
  fetchThread,
  insertMention,
  mentionQuery,
  mentionSuggestions,
  mergeComments,
  refusalReason,
  threadsOf,
} from "../lib/comments";
import type { PublicLocale } from "../lib/public-locale";
import { COMMENTS_COPY } from "../lib/workspace-locale";

type Copy = (typeof COMMENTS_COPY)["en"];

/**
 * The thread on one run, notebook or saved circuit (proposal 9, first slice).
 *
 * What it shows is decided by the server: who wrote what, which @-mentions
 * resolved, and whether the reader may post, edit or delete (`can_comment`,
 * `can_edit`, `can_delete`). The panel never works out a role for itself, so a
 * viewer sees the thread and a sentence saying why there is no box to type in,
 * rather than a box that refuses them.
 *
 * Bodies render through `CommentBody` only: plain text, line breaks and
 * http(s) links. Nothing a person types is ever handed to the browser as HTML.
 *
 * `collapsible` is for the run page, which is a conversation that keeps itself
 * scrolled to its newest message: an open panel under it would be what that
 * scroll lands on. Collapsed, it is one line with the count, and it opens by
 * itself when the page is reached through a Mentions link (`#comments`).
 *
 * `initial` exists for the screenshot harness under `/dev/ui`, which renders the
 * real component with fixture data and no control plane behind it. Given an
 * initial state, the panel does not fetch.
 */
export function CommentsPanel({
  targetType,
  targetId,
  locale = "en",
  collapsible = false,
  defaultOpen = false,
  initial,
}: {
  targetType: CommentTargetType;
  targetId: string;
  locale?: PublicLocale;
  collapsible?: boolean;
  defaultOpen?: boolean;
  initial?: { items: Comment[]; canComment: boolean; people: CommentPerson[] };
}) {
  const copy = COMMENTS_COPY[locale];
  const headingId = useId();
  const [open, setOpen] = useState(!collapsible || defaultOpen);
  useEffect(() => {
    if (collapsible && window.location.hash === COMMENTS_ANCHOR) setOpen(true);
  }, [collapsible]);
  const [items, setItems] = useState<Comment[]>(initial?.items ?? []);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [canComment, setCanComment] = useState(initial?.canComment ?? false);
  const [people, setPeople] = useState<CommentPerson[]>(initial?.people ?? []);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(initial ? "ready" : "loading");
  const [attempt, setAttempt] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);

  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);

  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyDraft, setReplyDraft] = useState("");
  const [replyError, setReplyError] = useState<string | null>(null);
  const [replying, setReplying] = useState(false);

  const [editing, setEditing] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [editError, setEditError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [itemError, setItemError] = useState<{ id: string; message: string } | null>(null);

  useEffect(() => {
    if (initial) return;
    let active = true;
    setStatus("loading");
    void (async () => {
      try {
        const page = await fetchThread(fetch, targetType, targetId);
        if (!active) return;
        setItems(page.items);
        setNextCursor(page.next_cursor ?? null);
        setCanComment(Boolean(page.can_comment));
        setStatus("ready");
      } catch {
        if (active) setStatus("error");
      }
    })();
    return () => {
      active = false;
    };
    // `initial` is a harness-only prop and never changes after mount.
  }, [targetType, targetId, attempt]);

  // Only someone who can post needs the list of people to mention.
  useEffect(() => {
    if (initial || !canComment) return;
    let active = true;
    void (async () => {
      try {
        const response = await fetch("/api/comments/people", { cache: "no-store" });
        if (!response.ok) return;
        const payload = (await response.json()) as { items?: CommentPerson[] };
        if (active && Array.isArray(payload.items)) setPeople(payload.items);
      } catch {
        // Suggestions are a convenience. Typing a handle in full still works.
      }
    })();
    return () => {
      active = false;
    };
  }, [canComment]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await fetchThread(fetch, targetType, targetId, nextCursor);
      setItems((current) => mergeComments(current, page.items));
      setNextCursor(page.next_cursor ?? null);
    } catch {
      setStatus("error");
    } finally {
      setLoadingMore(false);
    }
  }

  /** Posts, and answers with the sentence to show if it did not work. */
  async function post(body: string, parentId: string | null): Promise<string | null> {
    try {
      const response = await fetch("/api/comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target_type: targetType, target_id: targetId, body, parent_id: parentId }),
      });
      if (response.status === 201) {
        const created = (await response.json()) as Comment;
        setItems((current) => mergeComments(current, [created]));
        return null;
      }
      const reason = await refusalReason(response);
      if (response.status === 429) return copy.rateLimited;
      if (response.status === 403) {
        setCanComment(false);
        return copy.viewerNote;
      }
      if (reason === "parent_deleted") {
        reload();
        return copy.parentDeleted;
      }
      return copy.postFailed;
    } catch {
      return copy.postFailed;
    }
  }

  async function submitTop() {
    const body = draft.trim();
    if (!body || posting || body.length > MAX_COMMENT_CHARS) return;
    setPosting(true);
    setPostError(null);
    const error = await post(body, null);
    setPosting(false);
    if (error) setPostError(error);
    else setDraft("");
  }

  async function submitReply(parentId: string) {
    const body = replyDraft.trim();
    if (!body || replying || body.length > MAX_COMMENT_CHARS) return;
    setReplying(true);
    setReplyError(null);
    const error = await post(body, parentId);
    setReplying(false);
    if (error) {
      setReplyError(error);
    } else {
      setReplyDraft("");
      setReplyTo(null);
    }
  }

  async function saveEdit(comment: Comment) {
    const body = editDraft.trim();
    if (!body || saving || body.length > MAX_COMMENT_CHARS) return;
    setSaving(true);
    setEditError(null);
    try {
      const response = await fetch(`/api/comments/${encodeURIComponent(comment.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      if (response.ok) {
        const updated = (await response.json()) as Comment;
        setItems((current) => mergeComments(current, [updated]));
        setEditing(null);
      } else if ((await refusalReason(response)) === "comment_deleted") {
        setEditing(null);
        setItemError({ id: comment.id, message: copy.commentDeleted });
        reload();
      } else {
        setEditError(copy.editFailed);
      }
    } catch {
      setEditError(copy.editFailed);
    } finally {
      setSaving(false);
    }
  }

  async function remove(comment: Comment) {
    if (deleting) return;
    setDeleting(comment.id);
    setItemError(null);
    try {
      const response = await fetch(`/api/comments/${encodeURIComponent(comment.id)}`, { method: "DELETE" });
      if (response.status === 204) {
        // The server keeps the row in its place and stops serving its words;
        // mirror exactly that rather than re-reading the whole thread.
        setItems((current) =>
          current.map((item) =>
            item.id === comment.id
              ? { ...item, body: "", author: null, mentions: [], deleted_at: new Date().toISOString(), can_edit: false, can_delete: false }
              : item,
          ),
        );
        setConfirmDelete(null);
      } else {
        setItemError({ id: comment.id, message: copy.deleteFailed });
      }
    } catch {
      setItemError({ id: comment.id, message: copy.deleteFailed });
    } finally {
      setDeleting(null);
    }
  }

  const threads = threadsOf(items);
  const live = items.filter((item) => !item.deleted_at).length;

  function renderItem(comment: Comment, isReply: boolean): ReactNode {
    const deleted = Boolean(comment.deleted_at);
    const isEditing = editing === comment.id;
    return (
      <article className="mj-comment" data-deleted={deleted ? "" : undefined} aria-label={authorLabel(comment, copy)}>
        {deleted ? (
          <p className="mj-comment-deleted">{copy.deleted}</p>
        ) : (
          <>
            <header className="mj-comment-meta">
              <strong className="mj-comment-author">{authorLabel(comment, copy)}</strong>
              {comment.author?.display_name && comment.author.handle ? (
                <span className="mj-comment-handle">@{comment.author.handle}</span>
              ) : null}
              <time dateTime={comment.created_at}>{formatWhen(comment.created_at, locale)}</time>
              {comment.edited_at ? <span className="mj-comment-edited">{copy.edited}</span> : null}
            </header>
            {isEditing ? (
              <CommentComposer
                value={editDraft}
                onChange={setEditDraft}
                onSubmit={() => void saveEdit(comment)}
                onCancel={() => {
                  setEditing(null);
                  setEditError(null);
                }}
                busy={saving}
                error={editError}
                people={people}
                placeholder={copy.placeholder}
                submitLabel={copy.save}
                busyLabel={copy.saving}
                copy={copy}
                autoFocus
              />
            ) : (
              <CommentBody body={comment.body} mentionHandles={(comment.mentions ?? []).map((person) => person.handle)} />
            )}
            {!isEditing ? (
              <div className="mj-comment-actions">
                {!isReply && canComment ? (
                  <button
                    type="button"
                    className="mj-comment-action"
                    onClick={() => {
                      setReplyTo(comment.id);
                      setReplyError(null);
                    }}
                  >
                    {copy.reply}
                  </button>
                ) : null}
                {comment.can_edit ? (
                  <button
                    type="button"
                    className="mj-comment-action"
                    onClick={() => {
                      setEditing(comment.id);
                      setEditDraft(comment.body);
                      setEditError(null);
                    }}
                  >
                    {copy.edit}
                  </button>
                ) : null}
                {comment.can_delete ? (
                  confirmDelete === comment.id ? (
                    <span className="mj-comment-confirm" role="group" aria-label={copy.deleteConfirm}>
                      <span>{copy.deleteConfirm} {copy.deleteConfirmHelp}</span>
                      <button type="button" className="mj-comment-action is-danger" disabled={deleting === comment.id} onClick={() => void remove(comment)}>
                        {deleting === comment.id ? copy.deleting : copy.delete}
                      </button>
                      <button type="button" className="mj-comment-action" onClick={() => setConfirmDelete(null)}>
                        {copy.cancel}
                      </button>
                    </span>
                  ) : (
                    <button type="button" className="mj-comment-action" onClick={() => setConfirmDelete(comment.id)}>
                      {copy.delete}
                    </button>
                  )
                ) : null}
              </div>
            ) : null}
          </>
        )}
        {itemError?.id === comment.id ? <p className="mj-comment-error" role="alert">{itemError.message}</p> : null}
      </article>
    );
  }

  const head = (
    <>
      <h2 id={headingId}>{copy.title}</h2>
      {status === "ready" && live ? <span className="mj-mono-muted">{copy.count(live)}</span> : null}
    </>
  );

  const body = (
    <>
      {status === "loading" ? <p className="mj-comments-state" role="status">{copy.loading}</p> : null}
      {status === "error" ? (
        <div className="mj-comments-state" role="alert">
          <p>{copy.loadFailed}</p>
          <button type="button" className="mj-secondary-button" onClick={reload}>{copy.retry}</button>
        </div>
      ) : null}

      {status === "ready" ? (
        <>
          {threads.length ? (
            <ol className="mj-comments-list">
              {threads.map(({ comment, replies }) => (
                <li key={comment.id} className="mj-comments-thread">
                  {renderItem(comment, false)}
                  {replies.length || replyTo === comment.id ? (
                    <ol className="mj-comments-replies">
                      {replies.map((reply) => (
                        <li key={reply.id}>{renderItem(reply, true)}</li>
                      ))}
                      {replyTo === comment.id ? (
                        <li>
                          <CommentComposer
                            value={replyDraft}
                            onChange={setReplyDraft}
                            onSubmit={() => void submitReply(comment.id)}
                            onCancel={() => {
                              setReplyTo(null);
                              setReplyError(null);
                            }}
                            busy={replying}
                            error={replyError}
                            people={people}
                            placeholder={copy.replyPlaceholder}
                            submitLabel={copy.reply}
                            busyLabel={copy.posting}
                            copy={copy}
                            autoFocus
                          />
                        </li>
                      ) : null}
                    </ol>
                  ) : null}
                </li>
              ))}
            </ol>
          ) : (
            <p className="mj-comments-state">{canComment ? copy.emptyWriter : copy.empty}</p>
          )}

          {nextCursor ? (
            <button type="button" className="mj-secondary-button mj-comments-more" disabled={loadingMore} onClick={() => void loadMore()}>
              {copy.showMore}
            </button>
          ) : null}

          {canComment ? (
            <CommentComposer
              value={draft}
              onChange={setDraft}
              onSubmit={() => void submitTop()}
              busy={posting}
              error={postError}
              people={people}
              placeholder={copy.placeholder}
              submitLabel={copy.post}
              busyLabel={copy.posting}
              copy={copy}
              hint={copy.mentionHint}
            />
          ) : (
            <p className="mj-comments-viewer">{copy.viewerNote}</p>
          )}
        </>
      ) : null}
    </>
  );

  if (collapsible) {
    return (
      <details
        className="mj-comments mj-comments--collapsible"
        id={COMMENTS_ANCHOR.slice(1)}
        open={open}
        onToggle={(event) => setOpen(event.currentTarget.open)}
        aria-labelledby={headingId}
      >
        <summary className="mj-comments-head">{head}</summary>
        {open ? body : null}
      </details>
    );
  }
  return (
    <section className="mj-comments" id={COMMENTS_ANCHOR.slice(1)} aria-labelledby={headingId}>
      <div className="mj-comments-head">{head}</div>
      {body}
    </section>
  );
}

function authorLabel(comment: Comment, copy: Copy): string {
  if (comment.deleted_at || !comment.author) return copy.deleted;
  if (comment.author.current_member === false) return copy.formerMember;
  return comment.author.display_name || `@${comment.author.handle}`;
}

function formatWhen(iso: string, locale: PublicLocale): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(locale === "ja" ? "ja-JP" : "en", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

/**
 * A textarea with @-mention suggestions. Arrow keys move through them, Enter or
 * Tab picks one, Escape closes the list; with no list open, Ctrl or Cmd with
 * Enter posts.
 */
export function CommentComposer({
  value,
  onChange,
  onSubmit,
  onCancel,
  busy,
  error,
  people,
  placeholder,
  submitLabel,
  busyLabel,
  copy,
  hint,
  autoFocus = false,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onCancel?: () => void;
  busy: boolean;
  error: string | null;
  people: readonly CommentPerson[];
  placeholder: string;
  submitLabel: string;
  busyLabel: string;
  copy: Copy;
  hint?: string;
  autoFocus?: boolean;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const listId = useId();
  const [caret, setCaret] = useState(value.length);
  const [active, setActive] = useState(0);
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);

  useEffect(() => {
    if (autoFocus) textareaRef.current?.focus();
  }, [autoFocus]);

  const query = mentionQuery(value, caret);
  const suggestions = query && dismissedAt !== query.start ? mentionSuggestions(people, query.query) : [];
  const open = suggestions.length > 0;
  const tooLong = value.trim().length > MAX_COMMENT_CHARS;

  function choose(person: CommentPerson) {
    const next = insertMention(value, caret, person.handle);
    onChange(next.text);
    setCaret(next.caret);
    setActive(0);
    requestAnimationFrame(() => {
      const element = textareaRef.current;
      if (!element) return;
      element.focus();
      element.setSelectionRange(next.caret, next.caret);
    });
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (open) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;
        setActive((index) => (index + step + suggestions.length) % suggestions.length);
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        choose(suggestions[Math.min(active, suggestions.length - 1)]);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setDismissedAt(query?.start ?? null);
        return;
      }
    }
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      onSubmit();
    } else if (event.key === "Escape" && onCancel) {
      onCancel();
    }
  }

  return (
    <form
      className="mj-comment-composer"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <div className="mj-comment-input">
        <textarea
          ref={textareaRef}
          value={value}
          rows={3}
          placeholder={placeholder}
          aria-label={placeholder}
          aria-autocomplete="list"
          aria-controls={open ? listId : undefined}
          aria-activedescendant={open ? `${listId}-${Math.min(active, suggestions.length - 1)}` : undefined}
          aria-invalid={tooLong || undefined}
          onChange={(event) => {
            onChange(event.target.value);
            setCaret(event.target.selectionStart ?? event.target.value.length);
            setActive(0);
            setDismissedAt(null);
          }}
          onSelect={(event) => setCaret(event.currentTarget.selectionStart ?? 0)}
          onKeyDown={onKeyDown}
          disabled={busy}
        />
        {open ? (
          <ul className="mj-comment-suggestions" id={listId} role="listbox" aria-label={copy.suggestionsLabel}>
            {suggestions.map((person, index) => (
              <li
                key={person.user_id}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={index === active}
                onMouseDown={(event) => {
                  // Before the textarea loses focus, so the caret is still where it was.
                  event.preventDefault();
                  choose(person);
                }}
              >
                <span className="mj-comment-suggestion-name">{person.display_name || `@${person.handle}`}</span>
                <span className="mj-comment-handle">@{person.handle}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      {tooLong ? <p className="mj-comment-error" role="alert">{copy.tooLong(MAX_COMMENT_CHARS)}</p> : null}
      {error ? <p className="mj-comment-error" role="alert">{error}</p> : null}
      <div className="mj-comment-composer-actions">
        {hint ? <span className="mj-comment-hint">{hint}</span> : null}
        {onCancel ? (
          <button type="button" className="mj-secondary-button" onClick={onCancel} disabled={busy}>
            {copy.cancel}
          </button>
        ) : null}
        <button type="submit" className="mj-primary-button" disabled={busy || !value.trim() || tooLong}>
          {busy ? busyLabel : submitLabel}
        </button>
      </div>
    </form>
  );
}
