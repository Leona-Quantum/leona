"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { QPU_RUN_POLL_MS, fetchQpuRun, fetchQpuRunHistory, type QpuRunHistoryItem } from "../../../../lib/qpu";
import type { IdealComparison } from "../../../../lib/qpu-ideal";
import {
  appendRunPage,
  applyRunUpdates,
  compareRunJob,
  groupRunsByBackend,
  nextMacrotask,
  readRun,
  unfinishedRunIds,
  workThroughComparisons,
  type BackendGroup,
  type RunReading,
} from "../../../../lib/qpu-run-history";
import type { PublicLocale } from "../../../../lib/public-locale";
import { simulator } from "../../../../lib/simulator-client";
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

/** A comparison whose job threw in the simulator: the kernel refusing the
 * stored program, which is what `unparsable` already tells the reader. */
const COULD_NOT_COMPARE: IdealComparison = { status: "unavailable", reason: "unparsable" };

/** A comparison the simulator stopped at its time budget. Recorded like any
 * other answer, so the page moves on to the next run and never asks again. */
const TIMED_OUT: IdealComparison = { status: "unavailable", reason: "timed_out" };

export function HardwareRuns({ locale, limits }: { locale: PublicLocale; limits: CpuSimulationLimits }) {
  const copy = WORKSPACE_COPY[locale].hardwareRuns;
  const studioCopy = WORKSPACE_COPY[locale].studio;
  const [items, setItems] = useState<readonly QpuRunHistoryItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [attempt, setAttempt] = useState(0);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [olderFailed, setOlderFailed] = useState(false);
  const [comparisons, setComparisons] = useState<ReadonlyMap<string, IdealComparison>>(() => new Map());
  // The worker asks "already worked out?" at the moment each task runs, which
  // is later than the render that started it, so it reads through a ref rather
  // than through a closure over one render's map.
  const comparisonsRef = useRef(comparisons);
  useEffect(() => {
    comparisonsRef.current = comparisons;
  }, [comparisons]);

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

  // Comparisons, worked out one at a time in the order the page shows them, so
  // the top of the page fills in first. Each is a statevector simulation of up
  // to a second or more at the tier ceiling, so each runs in the simulator
  // worker (lib/simulator-client.ts) and the page keeps answering input while
  // "Working out…" shows. Restarted when the list changes (a refresh, an older
  // page), which re-plans without redoing finished work: the restart asks for
  // the same run again and picks up the job already running for it.
  const consumer = `hardware-runs:${useId()}`;
  useEffect(() => {
    const order = groups.flatMap((group) => group.runs);
    const stop = workThroughComparisons({
      order,
      isCached: (id) => comparisonsRef.current.has(id),
      compute: (item) =>
        simulator.run(consumer, compareRunJob(item, limits)).then((outcome) => {
          if (outcome.status === "done") return outcome.result;
          if (outcome.status === "failed") return COULD_NOT_COMPARE;
          if (outcome.status === "timed_out") return TIMED_OUT;
          return null;
        }),
      onResult: (id, comparison) => {
        // Written to the ref at once as well as to state, so a restarted worker
        // that runs before this render commits still sees it as done.
        const next = new Map(comparisonsRef.current);
        next.set(id, comparison);
        comparisonsRef.current = next;
        setComparisons(next);
      },
      schedule: nextMacrotask,
    });
    return () => {
      stop();
      simulator.cancel(consumer);
    };
  }, [groups, limits, consumer]);

  // A queued or running job changes on the provider's schedule, so while the
  // page lists one it re-reads those runs at Studio's cadence, and stops as
  // soon as none are left. Keyed on the ids rather than on `items`, so an
  // answer that changes nothing does not restart the timer.
  const unfinishedKey = unfinishedRunIds(items).join(",");
  useEffect(() => {
    if (!unfinishedKey) return;
    const ids = unfinishedKey.split(",");
    let cancelled = false;
    let inFlight = false;
    let timer: number | undefined;

    const refresh = () => {
      if (cancelled || inFlight || document.hidden) return;
      inFlight = true;
      Promise.allSettled(ids.map((id) => fetchQpuRun(id)))
        .then((results) => {
          if (cancelled) return;
          const records = results.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
          setItems((shown) => applyRunUpdates(shown, records));
        })
        .finally(() => {
          inFlight = false;
        });
    };
    const start = () => {
      if (timer === undefined) timer = window.setInterval(refresh, QPU_RUN_POLL_MS);
    };
    const stop = () => {
      if (timer !== undefined) window.clearInterval(timer);
      timer = undefined;
    };
    // A hidden tab asks nothing. Coming back reads at once, since the reader
    // is looking at a list that may be minutes old.
    const onVisibility = () => {
      if (document.hidden) {
        stop();
      } else {
        refresh();
        start();
      }
    };

    if (!document.hidden) start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [unfinishedKey]);

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
                  comparisons={comparisons}
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
  comparisons,
  copy,
  studioCopy,
  limits,
  locale,
}: {
  group: BackendGroup;
  comparisons: ReadonlyMap<string, IdealComparison>;
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
          <RunCard
            key={item.id}
            item={item}
            reading={readRun(item, comparisons)}
            copy={copy}
            studioCopy={studioCopy}
            limits={limits}
            locale={locale}
          />
        ))}
      </ol>
    </section>
  );
}

function RunCard({
  item,
  reading,
  copy,
  studioCopy,
  limits,
  locale,
}: {
  item: QpuRunHistoryItem;
  reading: RunReading;
  copy: Copy;
  studioCopy: StudioCopy;
  limits: CpuSimulationLimits;
  locale: PublicLocale;
}) {
  const when = item.submitted_at ?? item.created_at;
  const comparison = reading.kind === "compared" ? reading.comparison : null;
  const computed = comparison?.status === "computed" ? comparison : null;

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
        <p className="mj-qpu-note" role={reading.kind === "working_out" ? "status" : undefined}>
          {readingSentence(reading, copy, studioCopy)}
        </p>
      )}
      {item.error ? <p className="mj-qpu-note">{`${studioCopy.hardwareJobError}: ${item.error}`}</p> : null}

      {computed ? (
        // The comparison already worked out off the render path is handed
        // over, so opening this costs no second simulation.
        <details>
          <summary>{copy.details}</summary>
          <QpuMeasuredVsIdeal
            qasm={item.qasm}
            submittedFingerprint={item.source_fingerprint}
            counts={item.raw_counts}
            limits={limits}
            copy={studioCopy}
            workingOut={copy.workingOut}
            comparison={computed}
          />
        </details>
      ) : null}
    </li>
  );
}

function readingSentence(reading: RunReading, copy: Copy, studioCopy: StudioCopy): string {
  if (reading.kind === "in_progress") return copy.inProgress;
  if (reading.kind === "ended_without_counts") return copy.endedWithoutCounts;
  if (reading.kind === "working_out") return copy.workingOut;
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
