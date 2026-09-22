"use client";

import { useEffect, useMemo, useState } from "react";
import { fetchQpuRunHistory, type QpuRunHistoryItem } from "../../../../lib/qpu";
import { appendRunPage, groupRunsByBackend, readRun, type BackendGroup } from "../../../../lib/qpu-run-history";
import type { PublicLocale } from "../../../../lib/public-locale";
import type { CpuSimulationLimits } from "../../../../lib/studio-simulation";
import { WORKSPACE_COPY } from "../../../../lib/workspace-locale";
import { QpuMeasuredVsIdeal } from "../qpu-measured-vs-ideal";

type Copy = (typeof WORKSPACE_COPY)[PublicLocale]["hardwareRuns"];
type StudioCopy = (typeof WORKSPACE_COPY)[PublicLocale]["studio"];

/**
 * Runs per request. Smaller than the API's default because every run carries
 * its program and, once finished, costs a statevector simulation in this tab.
 */
const PAGE_SIZE = 25;

export function HardwareRuns({ locale, limits }: { locale: PublicLocale; limits: CpuSimulationLimits }) {
  const copy = WORKSPACE_COPY[locale].hardwareRuns;
  const studioCopy = WORKSPACE_COPY[locale].studio;
  const [items, setItems] = useState<QpuRunHistoryItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [attempt, setAttempt] = useState(0);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [olderFailed, setOlderFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    fetchQpuRunHistory({ limit: PAGE_SIZE })
      .then((page) => {
        if (cancelled) return;
        setItems(page.items);
        setCursor(page.next_cursor);
        setState("ready");
      })
      .catch(() => {
        if (!cancelled) setState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  function showOlder() {
    if (!cursor || loadingOlder) return;
    setLoadingOlder(true);
    setOlderFailed(false);
    fetchQpuRunHistory({ cursor, limit: PAGE_SIZE })
      .then((page) => {
        setItems((shown) => appendRunPage(shown, page.items));
        setCursor(page.next_cursor);
      })
      .catch(() => setOlderFailed(true))
      .finally(() => setLoadingOlder(false));
  }

  const groups = useMemo(() => groupRunsByBackend(items), [items]);

  return (
    <div className="mj-workspace-page">
      <div className="mj-workspace-scroll">
        <div className="mj-workspace-content">
          <header className="mj-page-header">
            <div>
              <h1 className="mj-page-title">{copy.title}</h1>
              <p className="mj-page-lede">{copy.intro}</p>
            </div>
          </header>

          {state === "loading" ? <p className="mj-qpu-note" role="status">{copy.loading}</p> : null}
          {state === "error" ? (
            <div className="mj-qpu-history-state" role="alert">
              <p className="mj-qpu-note">{copy.loadFailed}</p>
              <button className="mj-secondary-button" type="button" onClick={() => setAttempt((value) => value + 1)}>
                {copy.retry}
              </button>
            </div>
          ) : null}
          {state === "ready" && items.length === 0 ? (
            <div className="mj-qpu-history-state">
              <p className="mj-qpu-note">{copy.empty}</p>
              <a className="mj-secondary-button" href="/studio">{copy.emptyAction}</a>
            </div>
          ) : null}

          {state === "ready" && items.length > 0 ? (
            <div className="mj-qpu-history">
              <p className="mj-qpu-history-guide">{copy.readingGuide}</p>
              {groups.map((group) => (
                <MachineSection
                  key={group.backend ?? "unrecorded"}
                  group={group}
                  copy={copy}
                  studioCopy={studioCopy}
                  limits={limits}
                  locale={locale}
                />
              ))}
              {cursor ? (
                <button className="mj-secondary-button mj-qpu-history-more" type="button" disabled={loadingOlder} onClick={showOlder}>
                  {loadingOlder ? copy.loadingOlder : copy.showOlder}
                </button>
              ) : null}
              {olderFailed ? <p className="mj-qpu-note" role="alert">{copy.olderFailed}</p> : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function MachineSection({
  group,
  copy,
  studioCopy,
  limits,
  locale,
}: {
  group: BackendGroup;
  copy: Copy;
  studioCopy: StudioCopy;
  limits: CpuSimulationLimits;
  locale: PublicLocale;
}) {
  return (
    <section className="mj-qpu-history-machine" aria-label={group.backend ?? copy.unrecordedMachine}>
      <div className="mj-qpu-history-machine-head">
        {/* The provider's own name for the machine, as-is: it is an identifier
            (`ibm_brisbane`), not copy, so it is not translated. */}
        <h2 className={group.backend ? "mj-qpu-history-machine-name" : undefined}>{group.backend ?? copy.unrecordedMachine}</h2>
        <span className="mj-mono-muted">{copy.machineRunCount(group.runs.length)}</span>
      </div>
      {group.backend === null ? <p className="mj-qpu-note">{copy.unrecordedMachineNote}</p> : null}
      <ol className="mj-qpu-history-runs">
        {group.runs.map((item) => (
          <RunCard key={item.id} item={item} copy={copy} studioCopy={studioCopy} limits={limits} locale={locale} />
        ))}
      </ol>
    </section>
  );
}

function RunCard({
  item,
  copy,
  studioCopy,
  limits,
  locale,
}: {
  item: QpuRunHistoryItem;
  copy: Copy;
  studioCopy: StudioCopy;
  limits: CpuSimulationLimits;
  locale: PublicLocale;
}) {
  const reading = useMemo(() => readRun(item, limits), [item, limits]);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const when = item.submitted_at ?? item.created_at;
  const computed = reading.kind === "compared" && reading.comparison.status === "computed" ? reading.comparison : null;

  return (
    <li className="mj-qpu-record mj-qpu-history-run">
      <div className="mj-qpu-history-run-head">
        <strong>{formatWhen(when, locale)}</strong>
        <span>{copy.status(item.status)}</span>
        <span>{`${copy.columnShots}: ${item.shots.toLocaleString(locale === "ja" ? "ja-JP" : "en-US")}`}</span>
        {item.provider_job_id ? <span className="mj-mono-muted">{`${studioCopy.hardwareJobId}: ${item.provider_job_id}`}</span> : null}
      </div>

      {computed ? (
        <dl className="mj-studio-contract">
          <div><dt>{copy.columnDistance}</dt><dd>{computed.tvd.toFixed(3)}</dd></div>
          <div><dt>{copy.columnShotNoise}</dt><dd>{computed.shotNoiseTvd.toFixed(3)}</dd></div>
          <div><dt>{copy.columnFidelity}</dt><dd>{computed.hellingerFidelity.toFixed(3)}</dd></div>
        </dl>
      ) : (
        <p className="mj-qpu-note">{readingSentence(reading, copy, studioCopy)}</p>
      )}
      {item.error ? <p className="mj-qpu-note">{`${studioCopy.hardwareJobError}: ${item.error}`}</p> : null}

      {computed ? (
        // Rendered only once opened: the table inside recomputes the ideal
        // distribution, and a page of closed rows should not run it twice each.
        <details onToggle={(event) => setDetailsOpen((event.currentTarget as HTMLDetailsElement).open)}>
          <summary>{copy.details}</summary>
          {detailsOpen ? (
            <QpuMeasuredVsIdeal
              qasm={item.qasm}
              submittedFingerprint={item.source_fingerprint}
              counts={item.raw_counts}
              limits={limits}
              copy={studioCopy}
            />
          ) : null}
        </details>
      ) : null}
    </li>
  );
}

function readingSentence(reading: ReturnType<typeof readRun>, copy: Copy, studioCopy: StudioCopy): string {
  if (reading.kind === "in_progress") return copy.inProgress;
  if (reading.kind === "ended_without_counts") return copy.endedWithoutCounts;
  if (reading.comparison.status === "computed") return "";
  // Studio's sentence for this code says the circuit was edited after it was
  // sent. Here the comparison is against the run's own stored program, so a
  // mismatch means something else and gets its own words.
  if (reading.comparison.reason === "circuit_changed") return copy.programMismatch;
  return studioCopy.hardwareIdealUnavailable(reading.comparison.reason);
}

function formatWhen(iso: string, locale: PublicLocale): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(locale === "ja" ? "ja-JP" : "en-US", { dateStyle: "medium", timeStyle: "short" });
}
