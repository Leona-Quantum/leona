// Designed empty state: one sentence + one action (spec §3). Every list gets one.
import type { ReactNode } from "react";

export function EmptyState({
  message,
  action,
}: {
  message: string;
  /** All-or-nothing: an action always has both a label and a destination. */
  action?: { label: string; href: string };
}): ReactNode {
  return (
    <div className="mj-empty">
      <p>{message}</p>
      {action ? (
        <a className="mj-empty-action" href={action.href}>
          {action.label}
        </a>
      ) : null}
    </div>
  );
}
