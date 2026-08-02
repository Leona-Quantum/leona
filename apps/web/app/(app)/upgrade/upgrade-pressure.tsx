"use client";

import { useEffect, useState } from "react";
import type { PublicLocale } from "../../../lib/public-locale";
import { UPGRADE_COPY } from "../../../lib/public-copy";
import { parseUsage, type UsageSummary } from "../../../lib/usage-summary";

/**
 * The one live number on /upgrade: how close this week actually is.
 *
 * Renders NOTHING when the fetch fails, when the payload does not parse, or
 * when there is nothing to warn about. That is the same rule the account page's
 * meter follows, and for the same reason: a page that shows a plan ladder is
 * still a complete page, and a confident wrong sentence about somebody's usage
 * is worse than no sentence.
 *
 * The threshold that decides which sentence applies is the server's — this
 * reads `pressure`, it does not compare `used` against `limit` itself.
 */
export function UpgradePressure({ locale }: { locale: PublicLocale }) {
  const copy = UPGRADE_COPY[locale];
  const [usage, setUsage] = useState<UsageSummary | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/usage", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status));
        return parseUsage(await response.json());
      })
      .then((parsed) => {
        if (!cancelled) setUsage(parsed);
      })
      .catch(() => {
        if (!cancelled) setUsage(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // `tokens` is null against an API that predates the token meter — the same
  // absence the account page tolerates. Nothing to warn about, so nothing shown.
  const tokens = usage?.tokens;
  if (!tokens) return null;
  const line =
    tokens.exhausted || tokens.pressure === "exhausted"
      ? copy.usageExhausted
      : tokens.pressure === "critical"
        ? copy.usageCritical
        : tokens.pressure === "approaching"
          ? copy.usageApproaching
          : null;
  if (!line) return null;

  return (
    <section className="mj-artifact-panel" aria-live="polite">
      <div className="mj-panel-heading">
        <h2>{copy.usageTitle}</h2>
      </div>
      <p className="mj-panel-help" data-pressure={tokens.exhausted ? "exhausted" : tokens.pressure}>
        {line}
      </p>
    </section>
  );
}
