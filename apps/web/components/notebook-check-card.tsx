"use client";

import { useState } from "react";
import { checkAuthorBadge, type CheckTeeth } from "../lib/notebook-checks";
import type { NotebookCellView } from "../lib/notebook-view";
import type { NOTEBOOK_CHECK_COPY } from "../lib/workspace-locale";
import type { PublicLocale } from "../lib/public-locale";

type NotebookCheckCopy = (typeof NOTEBOOK_CHECK_COPY)[PublicLocale];

/**
 * A `role=check` cell (ai-ops 382, DESIGN.md §1). Renders `cell.checkProperty` (the
 * statement, its author, what it compares against) joined with `cell.checkVerdict` (what
 * the worker found last time this version ran) — see `notebookCellViews` in
 * `lib/notebook-view.ts` for that join. Replaces `NotebookCodeView` entirely for a check
 * cell: `cell.source` is only the readable comment the property renders to (DESIGN.md
 * §1.1), not something a reader benefits from seeing as code.
 *
 * Renders nothing when the cell carries no property — the contract guarantees every
 * `role=check` cell has one (`Cell._property_exactly_on_check_cells`), so this is a
 * defensive `null`, not a state a well-formed notebook can reach.
 */
export function NotebookCheckCard({
  cell,
  copy,
  canAccept = false,
  busy = false,
  onAccept,
}: {
  cell: NotebookCellView;
  copy: NotebookCheckCopy;
  /** Whether the viewer can edit this notebook — the same gate the page's other
   * per-cell actions use. Without it, the Accept button never renders, even on an
   * unaccepted Nala check. */
  canAccept?: boolean;
  busy?: boolean;
  onAccept?: (cellId: string) => void;
}) {
  const property = cell.checkProperty;
  if (!property) return null;
  const verdict = cell.checkVerdict;
  const badge = checkAuthorBadge(property);
  // The kind alone decides the basis: a `value` check never touches a circuit at all,
  // and every other kind's subject IS one — true before the check has ever run, which
  // is why this reads `property.kind` rather than waiting on `verdict.basis`.
  const basis: "circuit" | "value" = property.kind === "value" ? "value" : "circuit";

  return (
    <div className="mj-notebook-check">
      <p className="mj-notebook-check-statement">{property.statement || cell.source}</p>
      <p className="mj-notebook-check-basis">{copy.basisLabel[basis]}</p>

      <div className="mj-notebook-check-author">
        <span className="mj-notebook-check-author-text">
          {badge.kind === "nala"
            ? badge.citation
              ? copy.authorNalaCiting(badge.citation)
              : copy.authorNalaProposed
            : badge.kind === "source"
              ? copy.authorSource(badge.citation)
              : copy.authorUser}
          {badge.kind === "nala" ? ` · ${badge.accepted ? copy.authorAcceptedByYou : copy.authorNotAccepted}` : ""}
        </span>
        {badge.kind === "nala" && !badge.accepted && canAccept && onAccept ? (
          <button type="button" className="mj-secondary-button" disabled={busy} onClick={() => onAccept(cell.id)}>
            {copy.accept}
          </button>
        ) : null}
      </div>

      {verdict ? (
        <div className="mj-notebook-check-verdict" data-status={verdict.status}>
          <span className="mj-notebook-check-chip" data-status={verdict.status}>
            {copy.statusChip[verdict.status]}
          </span>
          {verdict.checked_against ? <p className="mj-notebook-check-checked-against">{copy.checkedAgainst(verdict.checked_against)}</p> : null}
          {verdict.measure ? <p className="mj-notebook-check-measure mj-mono-muted">{verdict.measure}</p> : null}
          {/* Shown on a fail OR an inconclusive — it names the likely mistake or the
              reason the check could not judge either way, and both deserve to be
              prominent (DESIGN.md §1.5). */}
          {verdict.status !== "pass" && verdict.detail ? (
            <p className="mj-notebook-check-detail" role="alert">
              {verdict.detail}
            </p>
          ) : null}
        </div>
      ) : (
        <p className="mj-notebook-check-not-run">{copy.notRunYet}</p>
      )}

      {/* Teeth only when the verdict IS a pass — a fail or inconclusive check was never
          mutation-tested this run (DESIGN.md §2: mutation testing runs on a check that
          passes), and showing nothing here is the honest reflection of that. */}
      {verdict?.status === "pass" && verdict.teeth ? <NotebookCheckTeeth teeth={verdict.teeth} copy={copy} /> : null}

      {verdict?.subject_qasm || verdict?.subject_fingerprint ? (
        <details className="mj-notebook-check-disclosure">
          <summary>{copy.qasmDisclosureLabel}</summary>
          {verdict.subject_qasm ? <NotebookCheckQasm qasm={verdict.subject_qasm} copy={copy} /> : null}
          {verdict.subject_fingerprint ? (
            <p className="mj-notebook-check-fingerprint">
              {copy.fingerprintLabel}: <code className="mj-mono-muted">{verdict.subject_fingerprint}</code>
            </p>
          ) : null}
        </details>
      ) : null}
    </div>
  );
}

function NotebookCheckQasm({ qasm, copy }: { qasm: string; copy: NotebookCheckCopy }) {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");

  async function copyQasm() {
    try {
      await navigator.clipboard.writeText(qasm);
      setStatus("copied");
    } catch {
      setStatus("failed");
    }
    window.setTimeout(() => setStatus("idle"), 2000);
  }

  return (
    <>
      <pre className="mj-code-body mj-notebook-check-qasm">{qasm}</pre>
      <button type="button" className="mj-secondary-button" onClick={copyQasm}>
        {status === "copied" ? copy.qasmCopied : copy.qasmCopy}
      </button>
      {status === "failed" ? <p role="alert">{copy.qasmCopyFailed}</p> : null}
    </>
  );
}

function NotebookCheckTeeth({ teeth, copy }: { teeth: CheckTeeth; copy: NotebookCheckCopy }) {
  if (teeth.status === "not_measured") {
    return (
      <p className="mj-notebook-check-teeth" title={copy.teethTooltip}>
        {copy.teethNotMeasured(teeth.reason)}
      </p>
    );
  }
  const survivors = teeth.survivors ?? [];
  const noTeeth = teeth.caught === 0 && teeth.mutants > 0;
  return (
    <div className="mj-notebook-check-teeth" data-measured="true">
      <p className="mj-notebook-check-teeth-caught" title={copy.teethTooltip}>
        {copy.teethCaught(teeth.caught, teeth.mutants)}
      </p>
      {noTeeth ? (
        <p className="mj-notebook-check-teeth-warning" role="alert">
          {copy.teethNoTeethWarning}
        </p>
      ) : null}
      {survivors.length > 0 ? (
        <details className="mj-notebook-check-disclosure">
          <summary>{copy.teethSurvivorsLabel(survivors.length)}</summary>
          <ul className="mj-notebook-check-survivors">
            {survivors.map((survivor, index) => (
              <li key={index}>{survivor}</li>
            ))}
          </ul>
        </details>
      ) : null}
      {teeth.equivalent > 0 ? (
        <p className="mj-notebook-check-teeth-equivalent">{copy.teethEquivalentLeftOut(teeth.equivalent)}</p>
      ) : null}
    </div>
  );
}
