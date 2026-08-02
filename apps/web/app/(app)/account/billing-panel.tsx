"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { PublicLocale } from "../../../lib/public-locale";
import { ACCOUNT_COPY } from "../../../lib/workspace-locale";

type BillingStatus = {
  payments_enabled: boolean;
  stripe_configured: boolean;
  currency: string;
};

/**
 * Transparency-only billing panel. It renders what billing WILL do and what
 * the backend's current state IS — it exposes no payment entry of any kind.
 */
export function BillingPanel({ locale }: { locale: PublicLocale }) {
  const copy = ACCOUNT_COPY[locale];
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/billing/status", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status));
        return (await response.json()) as BillingStatus;
      })
      .then((payload) => {
        if (!cancelled) setStatus(payload);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="mj-artifact-panel" id="billing" aria-labelledby="billing-heading">
      <div className="mj-panel-heading"><h2 id="billing-heading">{copy.billingTitle}</h2></div>
      <p className="mj-panel-help">{copy.billingHelp}</p>
      <dl className="mj-usage-list">
        <div><dt>{copy.billingPayments}</dt><dd>{copy.billingPaymentsDisabled}</dd></div>
        <div>
          <dt>{copy.billingBackend}</dt>
          <dd>
            {failed
              ? copy.billingUnavailable
              : status === null
                ? "…"
                : status.stripe_configured
                  ? copy.billingBackendConfigured
                  : copy.billingBackendUnconfigured}
          </dd>
        </div>
      </dl>
      <div className="mj-panel-heading"><h3>{copy.billingPolicyTitle}</h3></div>
      <p className="mj-panel-help">{copy.billingPolicyHelp}</p>
      <dl className="mj-usage-list">
        <div><dt>{copy.billingPolicyFree}</dt><dd>{copy.billingPolicyFreeValue}</dd></div>
        <div><dt>{copy.billingPolicyDemo}</dt><dd>{copy.billingPolicyDemoValue}</dd></div>
        <div><dt>{copy.billingPolicyCpu}</dt><dd>{copy.billingPolicyCpuValue}</dd></div>
        <div><dt>{copy.billingPolicyHardware}</dt><dd>{copy.billingPolicyHardwareValue}</dd></div>
      </dl>
      <p className="mj-panel-help">
        <a href="/studio">{copy.billingEstimatesLink} →</a>
        {" · "}
        <Link href="/upgrade">{copy.billingUpgradeLink} →</Link>
      </p>
    </section>
  );
}
