"use client";

import { useMemo, useState } from "react";
import { LogChart } from "./atlas-plan-scaling";
import { SourceCite, shortAuthors } from "./atlas-workflow-planner";
import { MathText } from "./math-text";
import {
  blockAudit,
  blockCostAt,
  blockEvidence,
  CHECK_QUBIT_CEILING,
  claimSources,
  evidenceBoundary,
  resolveBlockPlan,
  sizeStanding,
  type BlockAuditSummary,
  type BlockCatalog,
  type BlockEvidence,
  type BlockMethod,
  type EvidenceBoundary,
} from "../lib/notebook-blocks";
import { checkAuthorBadge } from "../lib/notebook-checks";
import type { NotebookCellView } from "../lib/notebook-view";
import type { NOTEBOOK_BLOCK_COPY, NOTEBOOK_CHECK_COPY } from "../lib/workspace-locale";
import type { PublicLocale } from "../lib/public-locale";
import { indexPlannerGraph } from "../lib/workflow-planner/graph.ts";
import { formatPlain } from "../lib/workflow-planner/costs.ts";
import { COST_KIND_LABEL, formatCostValue } from "../lib/workflow-planner/plan-copy.ts";
import { scalingSeries } from "../lib/workflow-planner/scaling.ts";
import { PLANNER_SOURCES } from "../lib/workflow-planner/sources.ts";
import type { Bilingual, CostLine, ParamKey } from "../lib/workflow-planner/types.ts";

type BlockCopy = (typeof NOTEBOOK_BLOCK_COPY)[PublicLocale];
type CheckCopy = (typeof NOTEBOOK_CHECK_COPY)[PublicLocale];

/** Where the notebook page's Atlas slice is: still loading, failed, here, or not offered
 * on this surface at all (the public share page, which a signed-out reader opens). */
export type BlockCatalogState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "unavailable" }
  | { status: "ready"; catalog: BlockCatalog };

function t(text: Bilingual, locale: PublicLocale): string {
  return locale === "ja" ? text.ja : text.en;
}

/**
 * A `role=block` cell (ai-ops 382, Phase B S1; VISION §5.3): one Atlas method, its sourced
 * cost at a problem size the reader moves, and this notebook's own checks as evidence up
 * to the size they ran at. Every number on it is worked out here by the planner from the
 * block's stored inputs (`lib/notebook-blocks.ts`), read from the worker's report, or
 * taken from Leona's formula audit, never stored in the block and never typed in this
 * file. Past the widest passing check the card says whose claim the number is.
 */
export function NotebookBlockCard({
  cell,
  cells,
  catalog,
  locale,
  copy,
  checkCopy,
  canAccept = false,
  busy = false,
  onAccept,
}: {
  cell: NotebookCellView;
  /** Every cell of the notebook, for the checks that name this block. */
  cells: readonly NotebookCellView[];
  catalog: BlockCatalogState;
  locale: PublicLocale;
  copy: BlockCopy;
  checkCopy: CheckCopy;
  canAccept?: boolean;
  busy?: boolean;
  onAccept?: (cellId: string) => void;
}) {
  const ref = cell.block;
  const ready = catalog.status === "ready" ? catalog.catalog : null;
  const index = useMemo(() => (ready ? indexPlannerGraph(ready.graph) : null), [ready]);
  const method = useMemo(() => ready?.methods.find((candidate) => candidate.id === ref?.method) ?? null, [ready, ref]);
  const resolved = useMemo(() => (index && ref ? resolveBlockPlan(index, ref) : null), [index, ref]);
  const placed = resolved?.kind === "placed" ? resolved : null;
  // The reader's slider position belongs to the plan it was moved on. Keyed rather than
  // reset in an effect, so a block whose plan changes (a new version, another block in
  // the same slot) opens at its own plan's size, never at an index into a different list.
  const planKey = JSON.stringify([ref?.method ?? null, ref?.plan ?? null, ref?.size_param ?? null]);
  const [chosen, setChosen] = useState<{ planKey: string; index: number } | null>(null);
  const chosenIndex = chosen?.planKey === planKey ? chosen.index : null;
  const sizeIndex = placed ? (chosenIndex ?? placed.planSizeIndex) : 0;
  const size = placed?.sizeParam ? (placed.sizes[sizeIndex] ?? null) : null;
  const cost = useMemo(() => (index && placed ? blockCostAt(index, placed, size) : null), [index, placed, size]);
  const evidence = useMemo(() => blockEvidence(cell.id, cells), [cell.id, cells]);
  const boundary = evidenceBoundary(evidence);
  const audit = ready && ref ? blockAudit(ready.audit, ref.method) : null;
  const papers = useMemo(() => new Map((ready?.papers ?? []).map((paper) => [paper.id, paper])), [ready]);
  if (!ref) return null;

  const badge = checkAuthorBadge(ref);
  const paramName = (key: ParamKey): string => {
    const spec = placed?.problem.params.find((candidate) => candidate.key === key);
    return spec ? t(spec.label, locale) : key;
  };
  const source = claimSourceWords(cost?.report.lines ?? null, method, papers, locale, copy);

  return (
    <div className="mj-notebook-block">
      <div className="mj-notebook-block-head">
        <p className="mj-notebook-block-name">{method?.label ?? ref.method}</p>
        <a className="mj-notebook-block-link" href={`/repository/layers/${encodeURIComponent(ref.method)}`}>
          {copy.atlasLink}
        </a>
      </div>
      <div className="mj-notebook-check-author">
        <span className="mj-notebook-check-author-text">
          {badge.kind === "nala"
            ? badge.citation
              ? checkCopy.authorNalaCiting(badge.citation)
              : checkCopy.authorNalaProposed
            : badge.kind === "source"
              ? checkCopy.authorSource(badge.citation)
              : checkCopy.authorUser}
          {badge.kind === "nala" ? ` · ${badge.accepted ? checkCopy.authorAcceptedByYou : checkCopy.authorNotAccepted}` : ""}
        </span>
        {badge.kind === "nala" && !badge.accepted && canAccept && onAccept ? (
          <button type="button" className="mj-secondary-button" disabled={busy} onClick={() => onAccept(cell.id)}>
            {checkCopy.accept}
          </button>
        ) : null}
      </div>

      {catalog.status === "loading" ? (
        <p className="mj-notebook-block-muted" role="status">
          {copy.loading}
        </p>
      ) : catalog.status === "error" ? (
        <p className="mj-notebook-block-hole" role="alert">
          {copy.loadFailed}
        </p>
      ) : catalog.status === "unavailable" ? (
        <p className="mj-notebook-block-muted">{copy.unavailable}</p>
      ) : placed && cost ? (
        <section className="mj-notebook-block-cost" aria-label={copy.costHeading}>
          <p className="mj-notebook-block-muted">
            {copy.stageOf(placed.stage.capability.label, t(placed.problem.label, locale))}
            {placed.isRoot ? "" : ` ${copy.wholeWorkflow}`}
          </p>
          {placed.sizeParam && placed.sizes.length > 1 ? (
            <label className="mj-notebook-block-size">
              {/* The parameter's own name: "Items to search (N)", never a generic "size". */}
              <span>{paramName(placed.sizeParam)}</span>
              <input
                type="range"
                min={0}
                max={placed.sizes.length - 1}
                step={1}
                value={sizeIndex}
                aria-valuetext={size === null ? undefined : copy.sizeReadout(paramName(placed.sizeParam), formatPlain(size))}
                onChange={(event) => setChosen({ planKey, index: Number(event.target.value) })}
              />
              <output className="mj-notebook-block-size-readout">
                {size === null ? "" : formatPlain(size)}
                {sizeIndex === placed.planSizeIndex ? <span className="mj-plan-note">{copy.planSize}</span> : null}
              </output>
            </label>
          ) : null}
          <p className="mj-notebook-block-muted">
            {cost.width === null ? copy.noWidth : copy.widthAtSize(formatPlain(cost.width))}
          </p>
          <h4 className="mj-notebook-block-subheading">{copy.costHeading}</h4>
          {cost.report.lines.length > 0 ? (
            <div className="mj-plan-table-wrap">
              <table className="mj-plan-table">
                <thead>
                  <tr>
                    {copy.costColumns.map((column) => (
                      <th key={column} scope="col">
                        {column}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {cost.report.lines.map((line) => (
                    <BlockCostRow key={line.id} line={line} locale={locale} copy={copy} papers={papers} paramName={paramName} />
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {cost.report.notes.map((note, i) => (
            <p key={i} className="mj-plan-callout">
              {t(note, locale)}
            </p>
          ))}
          <AssumedLine params={cost.params} paramName={paramName} copy={copy} />
          {placed.sizeParam && placed.sizes.length > 1 ? (
            <BlockScaling placed={placed} params={cost.params} root={cost.root} sizeIndex={sizeIndex} copy={copy} paramName={paramName} />
          ) : null}
        </section>
      ) : (
        <>
          {resolved?.kind === "unplaced" ? (
            <p className="mj-plan-callout">{copy.unplaced(t(resolved.problem.label, locale))}</p>
          ) : resolved?.kind === "invalid" ? (
            <p className="mj-plan-callout">{copy.invalidPlan}</p>
          ) : null}
          <BlockProse method={method} methodId={ref.method} copy={copy} />
        </>
      )}

      <BlockEvidenceSection
        evidence={evidence}
        boundary={boundary}
        width={cost?.width ?? null}
        shown={
          catalog.status === "ready" && placed && cost
            ? "numbers"
            : catalog.status === "ready" && method?.cost
              ? "prose"
              : "none"
        }
        source={source}
        copy={copy}
        checkCopy={checkCopy}
      />

      {audit ? <BlockAuditLine audit={audit} lines={cost?.report.lines ?? []} locale={locale} copy={copy} /> : null}
    </div>
  );
}

/** "Boyer et al. 1998 and Brassard et al. 2002": whose claim the numbers on screen are. */
function claimSourceWords(
  lines: readonly CostLine[] | null,
  method: BlockMethod | null,
  papers: ReadonlyMap<string, { authors: string; year: string }>,
  locale: PublicLocale,
  copy: BlockCopy,
): string {
  if (lines) {
    const names = claimSources(lines)
      .map((key) => papers.get(PLANNER_SOURCES[key].paperId))
      .filter((paper): paper is { authors: string; year: string } => Boolean(paper))
      .map((paper) => `${shortAuthors(paper.authors, locale)} ${paper.year}`);
    const unique = [...new Set(names)];
    if (unique.length > 0) return unique.join(copy.sourceJoin);
  }
  const first = method?.citations[0];
  if (first) return copy.proseSource(`${shortAuthors(first.authors, locale)} ${first.year}`);
  return copy.sourceFallback;
}

function BlockCostRow({
  line,
  locale,
  copy,
  papers,
  paramName,
}: {
  line: CostLine;
  locale: PublicLocale;
  copy: BlockCopy;
  papers: ReadonlyMap<string, { id: string; title: string; authors: string; year: string; url: string }>;
  paramName: (key: ParamKey) => string;
}) {
  return (
    <tr>
      <th scope="row">
        {t(line.label, locale)}
        {line.note ? <span className="mj-plan-note">{t(line.note, locale)}</span> : null}
      </th>
      <td className="mj-plan-value">
        {line.missing?.length ? (
          <span className="mj-plan-muted">{copy.needs(line.missing.map(paramName).join(", "))}</span>
        ) : (
          <>
            {formatCostValue(line)} {line.unit.en === "probability" ? "" : t(line.unit, locale)}
          </>
        )}
      </td>
      <td>
        <code>{line.formula}</code>
      </td>
      <td>
        <span className={`mj-plan-kind mj-plan-kind-${line.kind}`}>{t(COST_KIND_LABEL[line.kind], locale)}</span>
      </td>
      <td>
        <SourceCite source={line.source} papers={papers} locale={locale} />
      </td>
    </tr>
  );
}

function AssumedLine({
  params,
  paramName,
  copy,
}: {
  params: ReturnType<typeof blockCostAt>["params"];
  paramName: (key: ParamKey) => string;
  copy: BlockCopy;
}) {
  const assumed = Object.values(params)
    .filter((value) => value?.origin === "assumed" && value.value !== null)
    .map((value) => `${paramName(value!.key)} = ${formatPlain(value!.value as number)}`);
  if (assumed.length === 0) return null;
  return <p className="mj-notebook-block-muted">{copy.assumed(assumed.join(", "))}</p>;
}

function BlockScaling({
  placed,
  params,
  root,
  sizeIndex,
  copy,
  paramName,
}: {
  placed: Extract<ReturnType<typeof resolveBlockPlan>, { kind: "placed" }>;
  params: ReturnType<typeof blockCostAt>["params"];
  root: ReturnType<typeof blockCostAt>["root"];
  sizeIndex: number;
  copy: BlockCopy;
  paramName: (key: ParamKey) => string;
}) {
  const scaling = useMemo(
    () => (placed.sizeParam ? scalingSeries(placed.problem.id, params, root, placed.sizeParam, placed.sizes) : null),
    [placed, params, root],
  );
  const series = scaling?.series[0];
  if (!scaling || !series || !placed.sizeParam) return null;
  const param = placed.sizeParam;
  return (
    <div className="mj-notebook-block-chart">
      <LogChart
        title={copy.series[series.key]}
        points={series.points.map((point) => ({ x: point.x, y: point.y }))}
        marks={[]}
        current={sizeIndex}
        formatX={(x) => copy.sizeReadout(paramName(param), formatPlain(x))}
        formatY={(y) => formatPlain(y)}
      />
    </div>
  );
}

function BlockProse({ method, methodId, copy }: { method: BlockMethod | null; methodId: string; copy: BlockCopy }) {
  if (!method) {
    return (
      <div className="mj-notebook-block-hole" role="note">
        <p className="mj-notebook-block-subheading">{copy.holeHeading}</p>
        <p>{copy.unknownMethod(methodId)}</p>
      </div>
    );
  }
  if (!method.cost) {
    return (
      <div className="mj-notebook-block-hole" role="note">
        <p className="mj-notebook-block-subheading">{copy.holeHeading}</p>
        {method.costAbsence ? (
          <p>
            {copy.holeReason} <MathText source={method.costAbsence} />
          </p>
        ) : (
          <p>{copy.holeNoReason}</p>
        )}
      </div>
    );
  }
  return (
    <section className="mj-notebook-block-cost" aria-label={copy.proseHeading}>
      <h4 className="mj-notebook-block-subheading">{copy.proseHeading}</h4>
      <p className="mj-notebook-block-muted">{copy.proseIntro}</p>
      <p className="mj-notebook-block-prose">
        <MathText source={method.cost} />
      </p>
      {method.citations.length > 0 ? (
        <div className="mj-notebook-block-citations">
          <span className="mj-notebook-block-muted">{copy.citationsLabel}</span>
          <ul>
            {method.citations.map((citation) => (
              <li key={citation.url}>
                <a href={citation.url} rel="noreferrer" target="_blank">
                  {citation.title}
                </a>{" "}
                <span className="mj-notebook-block-muted">
                  {citation.authors}, {citation.year}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function BlockEvidenceSection({
  evidence,
  boundary,
  width,
  shown,
  source,
  copy,
  checkCopy,
}: {
  evidence: readonly BlockEvidence[];
  boundary: EvidenceBoundary;
  width: number | null;
  /** What the card shows as the cost: the planner's numbers at a size, the source's own
   * words, or nothing (a hole, or the Atlas not loaded). Nothing shown, nothing claimed. */
  shown: "numbers" | "prose" | "none";
  source: string;
  copy: BlockCopy;
  checkCopy: CheckCopy;
}) {
  const standing = sizeStanding(shown === "numbers" ? width : null, boundary);
  return (
    <section className="mj-notebook-block-evidence" aria-label={copy.evidenceHeading}>
      <h4 className="mj-notebook-block-subheading">{copy.evidenceHeading}</h4>
      {evidence.length === 0 ? (
        <p className="mj-notebook-block-muted">{copy.evidenceEmpty}</p>
      ) : (
        <ul className="mj-notebook-block-evidence-list">
          {evidence.map((row) => (
            <li key={row.cellId} data-status={row.status}>
              <span className="mj-notebook-check-chip" data-status={row.status}>
                {row.status === "not_run" ? checkCopy.notRunYet : checkCopy.statusChip[row.status]}
              </span>{" "}
              <span className="mj-notebook-block-evidence-statement">{row.statement}</span>
              {evidenceQualifiers(row, copy).map((words) => (
                <span key={words} className="mj-notebook-block-muted">
                  {" · "}
                  {words}
                </span>
              ))}
            </li>
          ))}
        </ul>
      )}
      {boundary.counted > 0 ? (
        <p className="mj-notebook-block-muted">
          {copy.evidenceCount(boundary.passing, boundary.counted, boundary.widest === null ? null : formatPlain(boundary.widest))}
        </p>
      ) : null}
      {/* With no cost on the card (a hole, or the Atlas not loaded) there is nothing to
          back or to call anyone's claim, so only what the checks themselves reach is said. */}
      {shown === "none" && boundary.widest === null ? null : (
      <p className="mj-notebook-block-boundary" data-standing={standing}>
        {boundarySentence(standing, boundary, copy)}
        {shown === "none" ? null : (
          <>
            {" "}
            {standing === "within"
              ? copy.within
              : standing === "beyond" && width !== null && boundary.widest !== null
                ? copy.beyond(formatPlain(boundary.widest), formatPlain(width), source)
                : standing === "unplaced" && boundary.widest !== null
                  ? shown === "prose"
                    ? copy.proseBeyond(formatPlain(boundary.widest), source)
                    : copy.unplacedStanding(formatPlain(boundary.widest), source)
                  : copy.uncheckedClaim(source)}
          </>
        )}
      </p>
      )}
      {standing === "beyond" ? (
        <p className="mj-notebook-block-muted">
          {copy.ceilings(
            formatPlain(CHECK_QUBIT_CEILING.state),
            formatPlain(CHECK_QUBIT_CEILING.distribution),
            formatPlain(CHECK_QUBIT_CEILING.unitary),
            formatPlain(CHECK_QUBIT_CEILING.energy),
          )}
        </p>
      ) : null}
    </section>
  );
}

/** The first sentence under the evidence: what the linked checks establish, if anything. */
function boundarySentence(standing: ReturnType<typeof sizeStanding>, boundary: EvidenceBoundary, copy: BlockCopy): string {
  if (boundary.widest === null) return copy.noBoundary;
  if (standing === "contradicted") return copy.conflict(boundary.conflicts, formatPlain(boundary.widest));
  return copy.boundary(formatPlain(boundary.widest));
}

/** What to say after a check's statement: the width it was checked at (from the report),
 * and, for an unaccepted Nala proposal, that it is not counted. A check not run yet says
 * so in its chip already. */
function evidenceQualifiers(row: BlockEvidence, copy: BlockCopy): string[] {
  const out: string[] = [];
  if (row.status !== "not_run") {
    if (row.kind === "value") out.push(copy.evidenceValue);
    else if (row.qubits !== null) out.push(copy.evidenceChecked(formatPlain(row.qubits)));
  }
  if (!row.counted) out.push(copy.notCounted);
  return out;
}

function BlockAuditLine({
  audit,
  lines,
  locale,
  copy,
}: {
  audit: BlockAuditSummary;
  lines: readonly CostLine[];
  locale: PublicLocale;
  copy: BlockCopy;
}) {
  const groups = new Map<string, typeof audit.counted>();
  for (const row of audit.counted) groups.set(`${row.block}|${row.costLineId}`, [...(groups.get(`${row.block}|${row.costLineId}`) ?? []), row]);
  return (
    <section className="mj-notebook-block-audit" aria-label={copy.auditHeading}>
      <h4 className="mj-notebook-block-subheading">{copy.auditHeading}</h4>
      <ul>
        {[...groups.values()].map((rows) => {
          const first = rows[0];
          const label = lines.find((line) => line.id === first.costLineId);
          const name = label ? t(label.label, locale) : first.costLineId;
          const sizes = rows.map((row) => formatPlain(row.n)).join(", ");
          const gaps = rows.filter((row) => row.verdict === "gap");
          return (
            <li key={`${first.block}|${first.costLineId}`} data-verdict={gaps.length > 0 ? "gap" : "match"}>
              {gaps.length > 0 ? copy.auditGaps(gaps.length, first.block, name, sizes) : copy.auditMatches(first.block, name, sizes)}
              {gaps.length > 0 ? (
                <details className="mj-notebook-check-disclosure">
                  <summary>{first.costLineId}</summary>
                  <ul>
                    {gaps.map((row) => (
                      <li key={row.n}>
                        n = {formatPlain(row.n)}: {row.explanation}
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
