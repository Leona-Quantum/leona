"use client";

import { useEffect, useRef, useState } from "react";
import { refusalSentence } from "../../../../../lib/api-error";
import { gradebookMemberName } from "../../../../../lib/course-gradebook";
import type { CourseCohortList, GradebookRow } from "../../../../../lib/course-types";
import type { PublicLocale } from "../../../../../lib/public-locale";
import { WORKSPACE_COPY } from "../../../../../lib/workspace-locale";

/**
 * Cohorts: named sections within a course (ai-ops 349 proposal 8).
 *
 * Visibility comes entirely from the response's own `visibility` field —
 * `all_cohorts` (the creator: every cohort, with its roster and the controls
 * to manage it) or `own_cohort` (anyone else: at most one cohort, their own,
 * with no roster and no controls) — the same way `CourseGradebookView` reads
 * `book.visibility` rather than being told who is asking.
 *
 * The roster to assign FROM is `members`, the course page's already-loaded
 * gradebook rows — not a second "list workspace members" fetch. That is why
 * this component is only rendered once the gradebook itself has something to
 * show (`courseHasGradableNotebook`, in `course-workspace.tsx`): before that
 * there is no roster to assign into a cohort from anyway.
 */
export function CourseCohorts({
  courseId,
  locale,
  members,
}: {
  courseId: string;
  locale: PublicLocale;
  /** The gradebook's own rows — every current member, for the creator's
   * assignment control. `undefined` while the gradebook has not loaded yet. */
  members: GradebookRow[] | undefined;
}) {
  const copy = WORKSPACE_COPY[locale].courses;
  const [list, setList] = useState<CourseCohortList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [busyCohortId, setBusyCohortId] = useState<string | null>(null);
  const [renameDrafts, setRenameDrafts] = useState<Record<string, string>>({});
  const [assignError, setAssignError] = useState<string | null>(null);
  const loadSeq = useRef(0);

  function load() {
    const seq = ++loadSeq.current;
    setLoading(true);
    setError(null);
    fetch(`/api/courses/${encodeURIComponent(courseId)}/cohorts`, { cache: "no-store" })
      .then(async (response) => {
        const payload = (await response.json()) as unknown;
        if (!response.ok) throw new Error(refusalSentence(payload) ?? copy.cohortsEmpty);
        if (seq === loadSeq.current) setList(payload as CourseCohortList);
      })
      .catch((cause) => {
        if (seq === loadSeq.current) {
          setError(cause instanceof Error ? cause.message : copy.cohortsEmpty);
        }
      })
      .finally(() => {
        if (seq === loadSeq.current) setLoading(false);
      });
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps -- courseId change is a hard reset
  useEffect(() => {
    setList(null);
    load();
    return () => {
      loadSeq.current += 1;
    };
  }, [courseId]);

  async function createCohort(event: React.FormEvent) {
    event.preventDefault();
    if (!newName.trim() || creating) return;
    setCreating(true);
    setCreateError(null);
    try {
      const response = await fetch(`/api/courses/${encodeURIComponent(courseId)}/cohorts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim() }),
      });
      const payload = (await response.json()) as unknown;
      if (!response.ok) throw new Error(refusalSentence(payload) ?? copy.createCohortFailed);
      setNewName("");
      load();
    } catch (cause) {
      setCreateError(cause instanceof Error ? cause.message : copy.createCohortFailed);
    } finally {
      setCreating(false);
    }
  }

  async function renameCohort(cohortId: string) {
    const name = (renameDrafts[cohortId] ?? "").trim();
    if (!name) return;
    setBusyCohortId(cohortId);
    try {
      const response = await fetch(
        `/api/courses/${encodeURIComponent(courseId)}/cohorts/${encodeURIComponent(cohortId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name }),
        },
      );
      const payload = (await response.json()) as unknown;
      if (!response.ok) throw new Error(refusalSentence(payload) ?? copy.renameCohortFailed);
      load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : copy.renameCohortFailed);
    } finally {
      setBusyCohortId(null);
    }
  }

  async function deleteCohort(cohortId: string, name: string) {
    if (!window.confirm(copy.deleteCohortConfirmWarning(name))) return;
    setBusyCohortId(cohortId);
    try {
      const response = await fetch(
        `/api/courses/${encodeURIComponent(courseId)}/cohorts/${encodeURIComponent(cohortId)}`,
        { method: "DELETE" },
      );
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(refusalSentence(payload) ?? copy.deleteCohortFailed);
      }
      load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : copy.deleteCohortFailed);
    } finally {
      setBusyCohortId(null);
    }
  }

  async function assignMember(userId: string, cohortId: string | null) {
    setAssignError(null);
    try {
      const response = await fetch(
        `/api/courses/${encodeURIComponent(courseId)}/members/${encodeURIComponent(userId)}/cohort`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cohort_id: cohortId }),
        },
      );
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(refusalSentence(payload) ?? copy.assignCohortFailed);
      }
      load();
    } catch (cause) {
      setAssignError(cause instanceof Error ? cause.message : copy.assignCohortFailed);
    }
  }

  if (loading && !list) {
    return <p className="mj-notebook-chat-empty" role="status">{copy.cohortsLede}</p>;
  }
  if (error) {
    return (
      <div className="mj-notebooks-retry" role="alert">
        <p>{error}</p>
        <button type="button" className="mj-secondary-button" onClick={load}>
          {locale === "ja" ? "再試行" : "Retry"}
        </button>
      </div>
    );
  }
  if (!list) return null;

  const everyone = list.visibility === "all_cohorts";
  const items = list.items ?? [];

  if (!everyone) {
    const [own] = items;
    return (
      <section className="mj-course-cohorts" aria-labelledby="course-cohorts-title">
        <h2 id="course-cohorts-title">{copy.cohortsLabel}</h2>
        <p>{own ? copy.yourCohortLabel(own.name) : copy.noCohortAssigned}</p>
      </section>
    );
  }

  const memberCohort = new Map<string, { id: string; name: string }>();
  for (const cohort of items) {
    for (const member of cohort.members ?? []) memberCohort.set(member.user_id, cohort);
  }

  return (
    <section className="mj-course-cohorts" aria-labelledby="course-cohorts-title">
      <div className="mj-course-cohorts-head">
        <h2 id="course-cohorts-title">{copy.cohortsLabel}</h2>
        <p className="mj-course-gradebook-lede">{copy.cohortsLede}</p>
      </div>

      {items.length === 0 ? <p className="mj-notebook-chat-empty">{copy.cohortsEmpty}</p> : null}

      <ul className="mj-course-cohorts-list">
        {items.map((cohort) => (
          <li key={cohort.id} className="mj-course-cohort-row">
            <input
              aria-label={copy.renameCohort}
              value={renameDrafts[cohort.id] ?? cohort.name}
              disabled={busyCohortId === cohort.id}
              onChange={(event) =>
                setRenameDrafts((drafts) => ({ ...drafts, [cohort.id]: event.target.value }))
              }
              onBlur={() => {
                if ((renameDrafts[cohort.id] ?? cohort.name) !== cohort.name) void renameCohort(cohort.id);
              }}
            />
            <span className="mj-mono-muted">{copy.cohortMemberCount(cohort.member_count)}</span>
            <button
              type="button"
              className="mj-secondary-button"
              disabled={busyCohortId === cohort.id}
              onClick={() => void deleteCohort(cohort.id, cohort.name)}
            >
              {busyCohortId === cohort.id ? copy.deletingCohort : copy.deleteCohort}
            </button>
          </li>
        ))}
      </ul>

      <form className="mj-course-cohort-create" onSubmit={createCohort}>
        <label>
          <span className="sr-only">{copy.newCohort}</span>
          <input
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            placeholder={copy.cohortNamePlaceholder}
            disabled={creating}
          />
        </label>
        <button className="mj-secondary-button" type="submit" disabled={creating || !newName.trim()}>
          {creating ? copy.creatingCohort : copy.createCohort}
        </button>
      </form>
      {createError ? <p role="alert" className="mj-notebook-workspace-error">{createError}</p> : null}

      {members && members.length > 0 ? (
        <div className="mj-course-cohort-assign">
          <h3>{copy.assignCohortLabel}</h3>
          {assignError ? <p role="alert" className="mj-notebook-workspace-error">{assignError}</p> : null}
          <table className="mj-course-gradebook-table">
            <thead>
              <tr>
                <th scope="col">{copy.gradebookMemberColumn}</th>
                <th scope="col">{copy.assignCohortLabel}</th>
              </tr>
            </thead>
            <tbody>
              {members.map((member) => (
                <tr key={member.user_id}>
                  <th scope="row">{gradebookMemberName(member)}</th>
                  <td>
                    <select
                      aria-label={copy.assignCohortLabel}
                      value={memberCohort.get(member.user_id)?.id ?? ""}
                      onChange={(event) => void assignMember(member.user_id, event.target.value || null)}
                    >
                      <option value="">{copy.noCohort}</option>
                      {items.map((cohort) => (
                        <option key={cohort.id} value={cohort.id}>
                          {cohort.name}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
