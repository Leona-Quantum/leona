"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { qappCopy } from "../../../../lib/qapp-copy";
import type { QappVersionPage as VersionPage, QappVersionSummary as VersionSummary } from "../../../../lib/qapp-management";
import type { PublicLocale } from "../../../../lib/public-locale";
import { refusalSentence } from "../../../../lib/api-error";

/**
 * A Qapp's version history, and the control that makes an earlier (or later)
 * one live again. Its own page rather than a section of the workspace page on
 * purpose: `qapp-workspace.tsx`'s existing tests pin an exact set of fetches
 * on mount, so this data loads only when a creator actually navigates here.
 */
export function QappVersions({ qappId, locale = "en" }: { qappId: string; locale?: PublicLocale }) {
  const copy = qappCopy(locale).workspace;
  const [page, setPage] = useState<VersionPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [pending, setPending] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setError(null);
    fetch(`/api/qapps/${encodeURIComponent(qappId)}/versions`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json() as unknown;
        if (!response.ok) throw new Error(refusalSentence(payload) ?? copy.versionsLoadFailed);
        return payload as VersionPage;
      })
      .then((value) => { if (active) setPage(value); })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : copy.versionsLoadFailed); });
    return () => { active = false; controller.abort(); };
  }, [qappId, reload, copy.versionsLoadFailed]);

  async function rollBackTo(version: VersionSummary) {
    if (pending) return;
    setPending(version.id);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(
        `/api/qapps/${encodeURIComponent(qappId)}/versions/${encodeURIComponent(version.id)}/rollback`,
        { method: "POST" },
      );
      const payload = await response.json() as { demoted_to_private?: boolean } | { title?: string };
      if (!response.ok) throw new Error(("title" in payload && payload.title) || copy.rollBackFailed);
      const demoted = "demoted_to_private" in payload && payload.demoted_to_private === true;
      setNotice(demoted ? copy.versionDemotedNotice(version.seq) : copy.versionRolledBackNotice(version.seq));
      setReload((value) => value + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : copy.rollBackFailed);
    } finally {
      setPending(null);
    }
  }

  return (
    <section className="qapp-versions-page">
      <Link className="leona-workspace-back" href={`/qapps/${encodeURIComponent(qappId)}`}>{copy.all}</Link>
      <h1>{copy.versionsHeading}</h1>
      {error ? <p role="alert" className="qapp-private-error">{error}</p> : null}
      {notice ? <p role="status" className="leona-workspace-feedback">{notice}</p> : null}
      {!page && !error ? <p role="status">{copy.loading}</p> : null}
      {page ? (
        <ul className="qapp-version-list">
          {page.versions.map((version) => {
            const isCurrent = version.id === page.current_version_id;
            return (
              <li key={version.id} className="qapp-version-row">
                <div>
                  <strong>{copy.versionSeq(version.seq)}</strong>{" "}
                  {isCurrent ? <span className="qapp-version-current">{copy.versionCurrent}</span> : null}
                  <time dateTime={version.created_at}> {version.created_at}</time>
                </div>
                {!isCurrent ? (
                  <button
                    className="mj-secondary-button"
                    type="button"
                    disabled={pending !== null}
                    onClick={() => void rollBackTo(version)}
                  >
                    {pending === version.id ? copy.rollingBack : copy.rollBackAction}
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
