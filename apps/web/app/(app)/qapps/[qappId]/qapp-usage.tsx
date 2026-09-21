"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { qappCopy } from "../../../../lib/qapp-copy";
import type { QappVersionUsage } from "../../../../lib/qapp-management";
import type { PublicLocale } from "../../../../lib/public-locale";
import { refusalSentence } from "../../../../lib/api-error";

/**
 * Executions per version, last run, and run outcomes — for the creator only,
 * built entirely from `qapp_executions` this Qapp already has. No new
 * tracking of viewers or anonymous traffic. Its own page for the same reason
 * `qapp-versions.tsx` is: `qapp-workspace.tsx`'s tests pin its fetches, so
 * this loads on demand rather than on the workspace page's mount.
 */
export function QappUsage({ qappId, locale = "en" }: { qappId: string; locale?: PublicLocale }) {
  const copy = qappCopy(locale).workspace;
  const [rows, setRows] = useState<QappVersionUsage[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setError(null);
    fetch(`/api/qapps/${encodeURIComponent(qappId)}/usage`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json() as unknown;
        if (!response.ok) throw new Error(refusalSentence(payload) ?? copy.usageLoadFailed);
        return payload as QappVersionUsage[];
      })
      .then((value) => { if (active) setRows(value); })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : copy.usageLoadFailed); });
    return () => { active = false; controller.abort(); };
  }, [qappId, copy.usageLoadFailed]);

  return (
    <section className="qapp-usage-page">
      <Link className="leona-workspace-back" href={`/qapps/${encodeURIComponent(qappId)}`}>{copy.all}</Link>
      <h1>{copy.usageHeading}</h1>
      {error ? <p role="alert" className="qapp-private-error">{error}</p> : null}
      {!rows && !error ? <p role="status">{copy.loading}</p> : null}
      {rows && rows.length === 0 ? <p role="status">{copy.usageEmpty}</p> : null}
      {rows && rows.length > 0 ? (
        <table className="qapp-usage-table">
          <thead>
            <tr>
              <th scope="col">{copy.usageTotal}</th>
              <th scope="col">{copy.usageSucceeded}</th>
              <th scope="col">{copy.usageFailed}</th>
              <th scope="col">{copy.usageLastRun}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.qapp_version_id}>
                <td>{row.total}</td>
                <td>{row.succeeded}</td>
                <td>{row.failed}</td>
                <td>
                  {row.last_execution_at ? (
                    <time dateTime={row.last_execution_at}>{row.last_execution_at}</time>
                  ) : (
                    copy.usageNoRun
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </section>
  );
}
