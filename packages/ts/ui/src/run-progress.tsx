import type { ReactNode } from "react";

export type RunProgressState = "waiting" | "active" | "done" | "error" | "stopped";

export interface RunProgressItem {
  id: string;
  title: string;
  detail: string;
  state: RunProgressState;
}

export interface RunProgressView {
  label: string;
  headline: string;
  items: RunProgressItem[];
}

const STATE_LABEL: Record<RunProgressState, string> = {
  waiting: "Queued",
  active: "Running",
  done: "Complete",
  error: "Needs attention",
  stopped: "Stopped",
};

const STATE_MARKER: Record<RunProgressState, string> = {
  waiting: "",
  active: "–",
  done: "✓",
  error: "×",
  stopped: "–",
};

/** Compact, replay-safe projection of a circuit run.
 *
 * The caller owns event reduction; this component only renders five stable
 * product stages. Detailed events stay outside this surface in a disclosure.
 */
export function RunProgress({ progress }: { progress: RunProgressView }): ReactNode {
  const completed = progress.items.filter((item) => item.state === "done").length;
  const active = progress.items.some((item) => item.state === "active");
  const completion = progress.items.length
    ? Math.round((completed / progress.items.length) * 100)
    : 0;

  return (
    <section className="mj-run-progress" aria-label={`${progress.label}. ${progress.headline}`}>
      <header className="mj-run-progress-head">
        <div className="mj-run-progress-heading">
          <span className="mj-run-progress-label">
            {active ? <span className="mj-run-progress-live-dot" aria-hidden="true" /> : null}
            {progress.label}
          </span>
          <strong>{progress.headline}</strong>
        </div>
        <div className="mj-run-progress-meta" aria-label={`${completed} of ${progress.items.length} steps complete`}>
          <span className="mj-run-progress-count">
            {completed} of {progress.items.length}
          </span>
          <span className="mj-run-progress-percent">{completion}%</span>
        </div>
      </header>
      <div className="mj-run-progress-meter" aria-hidden="true">
        <span style={{ width: `${completion}%` }} />
      </div>
      <ol className="mj-run-progress-list">
        {progress.items.map((item, index) => (
          <li
            key={item.id}
            className="mj-run-progress-row"
            data-state={item.state}
            aria-current={item.state === "active" ? "step" : undefined}
          >
            <span className="mj-run-progress-marker" aria-hidden="true">
              {STATE_MARKER[item.state] || String(index + 1).padStart(2, "0")}
            </span>
            <span className="mj-run-progress-copy">
              <span className="mj-run-progress-title">{item.title}</span>
              <span className="mj-run-progress-detail">{item.detail}</span>
            </span>
            <span className="mj-run-progress-state">{STATE_LABEL[item.state]}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
