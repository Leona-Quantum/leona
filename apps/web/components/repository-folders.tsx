// The repository's folder navigation, rendered.
//
// The tree itself and every rule about it live in `lib/repository/folder-tree.ts`;
// this file is markup over a resolved `FolderLocation` and holds no logic that could
// disagree with the checker. Its classes are the Layers surface's — a new stylesheet
// for a list of links would be a second set of tokens to keep in step with the first.
//
// ## The two things a reader has to be told, and why they are on the page
//
// **A topic count does not add up to its family's.** A record carries a `role` topic,
// usually a `method` and sometimes a `domain`, so it appears under several topic
// folders. The children of a family therefore sum to more than the family holds. That
// is a fact about a facet, not a miscount, and a reader who notices it and is told
// nothing concludes the numbers are wrong. One sentence, at the level where it first
// becomes visible.
//
// **A family name has no Japanese.** `algorithmFamily` is authored once, in English, on
// each record. The browse list already renders it untranslated; inventing a Japanese
// name here would give a family two names and neither would be the one in the data.
// Category and topic labels *are* localised, because those vocabularies carry both.
import type { PublicLocale } from "../lib/public-locale";
import type { FolderLocation, FolderNode, FolderRecord } from "../lib/repository/folder-tree";

const COPY = {
  en: {
    title: "Folders",
    lede: "Browse down through the catalogue: what kind of record it is, then which family, then the subject topics inside it.",
    backToAtlas: "← The Quantum Atlas",
    root: "Folders",
    holds: (n: number) => `${n} record${n === 1 ? "" : "s"}`,
    inside: "Inside",
    records: "Records here",
    // Only shown at the family level and below, where the arithmetic is visible.
    overlap:
      "A record carries more than one topic, so these add up to more than the folder holds.",
    empty: "No folders here. That is a gap in the catalogue, not a page that failed to load.",
    noRecords: "No records at this address.",
  },
  ja: {
    title: "フォルダ",
    lede: "カタログを上から順にたどれます。記録の種別、次にファミリー、その中の主題トピックへ。",
    backToAtlas: "← 量子アトラス",
    root: "フォルダ",
    holds: (n: number) => `${n} 件`,
    inside: "この中",
    records: "ここにある記録",
    overlap: "1 件の記録が複数のトピックを持つため、内訳の合計はこのフォルダの件数を上回ります。",
    empty: "ここにはフォルダがありません。読み込みの失敗ではなく、カタログ側の空白です。",
    noRecords: "この階層には記録がありません。",
  },
} as const;

/** `/repository/folders/a/b/c` for a trail. Built once, here, so no caller concatenates. */
export function folderHref(segments: readonly string[]): string {
  return segments.length === 0
    ? "/repository/folders"
    : `/repository/folders/${segments.map(encodeURIComponent).join("/")}`;
}

/**
 * The trail as links, root first, with the last one not a link.
 *
 * Separated out because a breadcrumb built inline is where the off-by-one lives: the
 * href for a crumb is the path of everything *before* it, and the current page must
 * not be a link to itself.
 */
function crumbs(
  trail: readonly FolderNode[],
  rootLabel: string,
  label: (node: FolderNode) => string,
): Array<{ key: string; text: string; href: string | null }> {
  const rows = [
    {
      key: "root",
      text: rootLabel,
      href: trail.length === 0 ? null : folderHref([]),
    },
  ];
  for (const [index, node] of trail.entries()) {
    rows.push({
      key: node.segment,
      text: label(node),
      href:
        index === trail.length - 1
          ? null
          : folderHref(trail.slice(0, index + 1).map((crumb) => crumb.segment)),
    });
  }
  return rows;
}

export function FolderView({
  location,
  locale,
}: {
  location: FolderLocation;
  locale: PublicLocale;
}) {
  const copy = COPY[locale === "ja" ? "ja" : "en"];
  const isJapanese = locale === "ja";
  const trail = location.trail;
  const here = trail[trail.length - 1];
  const label = (node: FolderNode) => (isJapanese ? node.labelJa : node.label);
  const note = (node: FolderNode) => (isJapanese ? node.noteJa : node.note);

  return (
    <article className="mj-layers-index">
      {/* Every ancestor is a real link, not a rendered string. A breadcrumb whose
          middle segments are text is a trail a reader can read and cannot walk. */}
      <nav className="mj-layers-breadcrumb" aria-label={copy.title}>
        <a href="/repository">{copy.backToAtlas}</a>
        {crumbs(trail, copy.root, label).map((crumb) => (
          <span key={crumb.key}>
            {" · "}
            {crumb.href === null ? (
              <span aria-current="page">{crumb.text}</span>
            ) : (
              <a href={crumb.href}>{crumb.text}</a>
            )}
          </span>
        ))}
      </nav>

      {/* The lede belongs to the root and to nowhere else. Repeating "browse down
          through the catalogue" on every folder is a sentence that stops being read by
          the second one, and it would sit where a folder's own description should be —
          which topics have and categories and families do not. Silence is the honest
          state for those, not the root's sentence borrowed. */}
      <header className="mj-layers-node-head">
        <h1>{here ? label(here) : copy.title}</h1>
        {here ? null : <p>{copy.lede}</p>}
        {here && note(here) ? <p>{note(here)}</p> : null}
        {here ? <p className="mj-layers-count">{copy.holds(here.records)}</p> : null}
      </header>

      <section aria-labelledby="folder-children-heading">
        <h2 id="folder-children-heading" className="mj-layers-node-section-head">
          {copy.inside}
        </h2>
        {/* An empty list says what the emptiness means, because "nothing here" and
            "the page failed" render identically otherwise. Same rule the papers index
            follows. */}
        {location.children.length === 0 ? <p className="mj-layers-empty">{copy.empty}</p> : null}
        {location.level === "family" && location.children.length > 0 ? (
          <p className="mj-layers-empty">{copy.overlap}</p>
        ) : null}
        <ul className="mj-papers-list">
          {location.children.map((child) => (
            <li key={child.segment}>
              <a
                className="mj-papers-list-title"
                href={folderHref([...trail.map((crumb) => crumb.segment), child.segment])}
              >
                {label(child)}
              </a>
              <p className="mj-layers-count">{copy.holds(child.records)}</p>
              {note(child) ? <p className="mj-papers-list-meta">{note(child)}</p> : null}
            </li>
          ))}
        </ul>
      </section>

      {/* A category holds hundreds of records and its own list would bury the
          navigation. From the family down the largest holding is fifty, so the list
          IS the page and there is nothing to page through. */}
      {location.level === "family" || location.level === "topic" ? (
        <section aria-labelledby="folder-records-heading">
          <h2 id="folder-records-heading" className="mj-layers-node-section-head">
            {copy.records}
          </h2>
          {location.records.length === 0 ? (
            <p className="mj-layers-empty">{copy.noRecords}</p>
          ) : null}
          <ul className="mj-papers-list">
            {location.records.map((entry: FolderRecord) => (
              <li key={entry.slug}>
                <a className="mj-papers-list-title" href={`/repository/${entry.slug}`}>
                  {isJapanese ? entry.titleJa : entry.title}
                </a>
                <p className="mj-papers-list-meta">{entry.algorithmFamily}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </article>
  );
}
