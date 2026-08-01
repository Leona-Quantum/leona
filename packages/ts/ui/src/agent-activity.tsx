"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

export type AgentActivityState = "active" | "done" | "warn" | "error";

export type AgentActivityIcon =
  | "plan"
  | "code"
  | "check"
  | "run"
  | "verify"
  | "compile"
  | "finalize";

export interface AgentActivityItem<TDetail = unknown> {
  id: string;
  icon: AgentActivityIcon;
  label: string;
  title: string;
  state: AgentActivityState;
  status: string;
  meta?: string;
  defaultOpen?: boolean;
  detail: TDetail;
}

export interface AgentActivityView<TDetail = unknown> {
  label: string;
  headline: string;
  items: AgentActivityItem<TDetail>[];
}

const STATE_GLYPH: Record<AgentActivityState, string> = {
  active: "–",
  done: "✓",
  warn: "–",
  error: "×",
};

function ActivityIcon({ kind }: { kind: AgentActivityIcon }): ReactNode {
  const common = {
    "aria-hidden": true,
    className: "mj-agent-activity-kind-icon",
    fill: "none",
    height: 18,
    stroke: "currentColor",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    strokeWidth: 1.35,
    viewBox: "0 0 18 18",
    width: 18,
  };

  if (kind === "plan") {
    return (
      <svg {...common}>
        <path d="M5 3.5h8v11H5zM7 6.5h4M7 9h4M7 11.5h2.5" />
        <path d="M7 2.5h4v2H7z" />
      </svg>
    );
  }
  if (kind === "code") {
    return (
      <svg {...common}>
        <path d="m6.5 5-4 4 4 4M11.5 5l4 4-4 4M10 3.5 8 14.5" />
      </svg>
    );
  }
  if (kind === "check") {
    return (
      <svg {...common}>
        <path d="M5 2.75h6l3 3v9.5H5zM11 2.75v3h3" />
        <path d="m7 10 1.4 1.4L12 7.8" />
      </svg>
    );
  }
  if (kind === "run") {
    return (
      <svg {...common}>
        <path d="m6.5 4.5 7 4.5-7 4.5z" />
      </svg>
    );
  }
  if (kind === "verify") {
    return (
      <svg {...common}>
        <path d="M7 2.75h4M7.75 2.75v3.2L4.2 12a2 2 0 0 0 1.75 3h6.1a2 2 0 0 0 1.75-3l-3.55-6.05v-3.2" />
        <path d="M6.25 11h5.5" />
      </svg>
    );
  }
  if (kind === "compile") {
    return (
      <svg {...common}>
        <path d="m9 2.75 5.25 3v6.5L9 15.25l-5.25-3v-6.5z" />
        <path d="m3.75 5.75 5.25 3 5.25-3M9 8.75v6.5" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M4 3.5h10v11H4zM6.5 6.5h5M6.5 9h5" />
      <path d="m7 12 1.25 1.25L11.5 10" />
    </svg>
  );
}

function ActivityDisclosure<TDetail>({
  item,
  renderDetail,
}: {
  item: AgentActivityItem<TDetail>;
  renderDetail: (item: AgentActivityItem<TDetail>) => ReactNode;
}): ReactNode {
  const automaticOpen = item.defaultOpen
    ?? (item.state === "active" || item.state === "error");
  const [open, setOpen] = useState(automaticOpen);
  const touched = useRef(false);

  useEffect(() => {
    if (!touched.current) setOpen(automaticOpen);
  }, [automaticOpen]);

  return (
    <details
      className="mj-agent-activity-item"
      data-state={item.state}
      open={open}
      onToggle={(event) => {
        if (event.currentTarget.open === open) return;
        touched.current = true;
        setOpen(event.currentTarget.open);
      }}
    >
      <summary aria-current={item.state === "active" ? "step" : undefined}>
        <span className="mj-agent-activity-chevron" aria-hidden="true">›</span>
        <ActivityIcon kind={item.icon} />
        <span className="mj-agent-activity-copy">
          <strong>{item.label}</strong>
          <span>{item.title}</span>
        </span>
        <span className="mj-agent-activity-meta">
          {item.meta ? <small>{item.meta}</small> : null}
          <span data-state={item.state}>
            <span aria-hidden="true">{STATE_GLYPH[item.state]}</span>
            {item.status}
          </span>
        </span>
      </summary>
      <div className="mj-agent-activity-body">{renderDetail(item)}</div>
    </details>
  );
}

/**
 * Calm, replay-safe rendering of an agent run.
 *
 * Event reduction and detail content stay with the caller. This component owns
 * only the stable visual grammar: one semantic operation per disclosure,
 * current/errors open by default, and completed work reduced to one row.
 */
export function AgentActivity<TDetail>({
  activity,
  renderDetail,
}: {
  activity: AgentActivityView<TDetail>;
  renderDetail: (item: AgentActivityItem<TDetail>) => ReactNode;
}): ReactNode {
  const active = activity.items.some((item) => item.state === "active");
  const resolved = activity.items.filter((item) => item.state !== "active").length;
  const warnings = activity.items.filter((item) => item.state === "warn").length;
  const errors = activity.items.filter((item) => item.state === "error").length;
  const summary = active
    ? `${resolved}/${activity.items.length} resolved`
    : errors
      ? `${errors} issue${errors === 1 ? "" : "s"}`
      : warnings
        ? `${warnings} limitation${warnings === 1 ? "" : "s"}`
        : `${activity.items.length} steps`;

  return (
    <section
      className="mj-agent-activity"
      aria-label={`${activity.label}. ${activity.headline}`}
      aria-busy={active}
    >
      <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {activity.label}. {activity.headline}. {summary}.
      </span>
      <header className="mj-agent-activity-head">
        <div>
          <span className="mj-agent-activity-label">
            {active ? <span className="mj-agent-activity-live-dot" aria-hidden="true" /> : null}
            {activity.label}
          </span>
          <strong>{activity.headline}</strong>
        </div>
        <span className="mj-agent-activity-count">
          {summary}
        </span>
      </header>

      <div className="mj-agent-activity-list">
        {activity.items.map((item) => (
          <ActivityDisclosure item={item} key={item.id} renderDetail={renderDetail} />
        ))}
      </div>
    </section>
  );
}
