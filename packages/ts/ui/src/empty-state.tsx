// Designed empty state: one sentence + one action (spec §3). Every list gets one.
import type { ReactNode } from "react";

export function EmptyState({
  message,
  actionLabel,
  actionHref,
}: {
  message: string;
  actionLabel?: string;
  actionHref?: string;
}): ReactNode {
  return (
    <div className="mj-empty">
      <p>{message}</p>
      {actionLabel && actionHref ? (
        <a className="mj-empty-action" href={actionHref}>
          {actionLabel}
        </a>
      ) : null}
    </div>
  );
}
