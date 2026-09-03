"use client";

import type { components } from "@majorana/contracts-gen";
import type { NotebookDiffCell, NotebookVersionDiff } from "../lib/notebook-diff";
import type { PublicLocale } from "../lib/public-locale";
import { WORKSPACE_COPY } from "../lib/workspace-locale";

type NotebookSpec = components["schemas"]["NotebookSpec"];
type Cell = components["schemas"]["Cell"];

/**
 * Renders what `lib/notebook-diff.ts` computed: the header fields that
 * changed, then every cell in `diff.cells`'s order. Only `status: "changed"`
 * carries a pre-computed line diff — for every other status this looks the
 * cell's own content up in `older`/`newer` by id, the same join
 * `notebookCellViews` (`lib/notebook-view.ts`) does for a run's results.
 * An unchanged or moved cell collapses to one line; a changed cell shows
 * its +/- gutters; an added/removed cell shows its whole source with a
 * uniform +/- treatment, since there is nothing on the other side to diff
 * it against.
 */
export function NotebookDiffView({
  diff,
  older,
  newer,
  locale = "en",
}: {
  diff: NotebookVersionDiff;
  older: NotebookSpec;
  newer: NotebookSpec;
  locale?: PublicLocale;
}) {
  const copy = WORKSPACE_COPY[locale].notebooks;
  const olderById = new Map((older.cells ?? []).map((cell) => [cell.id, cell]));
  const newerById = new Map((newer.cells ?? []).map((cell) => [cell.id, cell]));

  return (
    <div className="mj-notebook-diff-view">
      {diff.header.length > 0 ? (
        <table className="mj-notebook-diff-header">
          <tbody>
            {diff.header.map((field) => (
              <tr key={field.field}>
                <th scope="row">{copy.diffHeaderField[field.field]}</th>
                <td className="mj-notebook-diff-line mj-notebook-diff-line--remove">{field.before || "—"}</td>
                <td className="mj-notebook-diff-line mj-notebook-diff-line--add">{field.after || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      <div className="mj-notebook-diff-cells">
        {diff.cells.map((entry) => (
          <DiffCellCard key={entry.id} entry={entry} older={olderById.get(entry.id)} newer={newerById.get(entry.id)} copy={copy} />
        ))}
      </div>
    </div>
  );
}

type NotebookCopy = (typeof WORKSPACE_COPY)[PublicLocale]["notebooks"];

function DiffCellCard({
  entry,
  older,
  newer,
  copy,
}: {
  entry: NotebookDiffCell;
  older: Cell | undefined;
  newer: Cell | undefined;
  copy: NotebookCopy;
}) {
  const cell = newer ?? older;
  const label = cell?.role ? `${entry.id} · ${cell.role}` : entry.id;

  if (entry.status === "unchanged" || entry.status === "moved") {
    return (
      <div className="mj-notebook-diff-cell mj-notebook-diff-cell--collapsed" data-status={entry.status}>
        <span className="mj-mono-muted">{label}</span>
        <span className="mj-notebook-diff-status">{copy.diffStatus[entry.status]}</span>
      </div>
    );
  }

  if (entry.status === "changed") {
    return (
      <article className="mj-notebook-diff-cell" data-status="changed">
        <div className="mj-notebook-diff-cell-head">
          <span className="mj-mono-muted">{label}</span>
          <span className="mj-notebook-diff-status">{copy.diffStatus.changed}</span>
        </div>
        <pre className="mj-notebook-diff-lines">
          {(entry.lines ?? []).map((line, index) => (
            <div key={index} className={`mj-notebook-diff-line mj-notebook-diff-line--${lineClass(line.kind)}`}>
              <span className="mj-notebook-diff-gutter">{line.kind}</span>
              {line.text}
            </div>
          ))}
        </pre>
      </article>
    );
  }

  // added / removed: the whole cell's source, shown uniformly on one side.
  const source = (entry.status === "added" ? newer : older)?.source ?? "";
  const lineKind = entry.status === "added" ? "+" : "-";
  return (
    <article className="mj-notebook-diff-cell" data-status={entry.status}>
      <div className="mj-notebook-diff-cell-head">
        <span className="mj-mono-muted">{label}</span>
        <span className="mj-notebook-diff-status">{copy.diffStatus[entry.status]}</span>
      </div>
      <pre className="mj-notebook-diff-lines">
        {source.split("\n").map((text, index) => (
          <div key={index} className={`mj-notebook-diff-line mj-notebook-diff-line--${lineClass(lineKind)}`}>
            <span className="mj-notebook-diff-gutter">{lineKind}</span>
            {text}
          </div>
        ))}
      </pre>
    </article>
  );
}

function lineClass(kind: "+" | "-" | " "): "add" | "remove" | "context" {
  if (kind === "+") return "add";
  if (kind === "-") return "remove";
  return "context";
}
