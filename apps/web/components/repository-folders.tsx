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
    // The second scheme's own sentence. Reusing the first one would describe the
    // wrong three levels on a page that draws the other three — the kind of
    // wrong claim a reader has no way to catch, because both pages look right.
    ledeMethod:
      "Browse down through the catalogue by technique: which kind of algorithm it is, then what kind of record the catalogue holds for it, then which family.",
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
    // The two schemes, named by what a reader is choosing between rather than by
    // their internals. The owner's own words for option 2 were "the kind of
    // algorithm", and that is the label.
    schemeLabel: "Arrange by",
    schemeCategory: "Kind of record",
    schemeMethod: "Kind of algorithm",
    // Printed only under the second scheme, and always as a fraction.
    coverage: (placed: number, total: number) =>
      `This arrangement reaches ${placed} of ${total} records. The rest carry no technique in the catalogue's vocabulary — most of them are gates, which have none by design.`,
  },
  ja: {
    title: "フォルダ",
    lede: "カタログを上から順にたどれます。記録の種別、次にファミリー、その中の主題トピックへ。",
    ledeMethod:
      "カタログを手法からたどれます。アルゴリズムの種類、次にその手法についてカタログが持つ記録の種別、そしてファミリーへ。",
    backToAtlas: "← 量子アトラス",
    root: "フォルダ",
    holds: (n: number) => `${n} 件`,
    inside: "この中",
    records: "ここにある記録",
    overlap: "1 件の記録が複数のトピックを持つため、内訳の合計はこのフォルダの件数を上回ります。",
    empty: "ここにはフォルダがありません。読み込みの失敗ではなく、カタログ側の空白です。",
    noRecords: "この階層には記録がありません。",
    schemeLabel: "並べ方",
    schemeCategory: "記録の種別",
    schemeMethod: "アルゴリズムの種類",
    coverage: (placed: number, total: number) =>
      `この並べ方が到達するのは ${total} 件中 ${placed} 件です。残りはカタログの語彙で手法が付いていない記録で、その多くは設計上手法を持たないゲートです。`,
  },
} as const;

/**
 * Which of the two trees the reader is walking.
 *
 * `"category"` is the scheme the owner picked in ai-ops#15 and is the default in
 * every sense that matters: it is what a bare `/repository/folders` serves, it
 * is what an unrecognised value falls back to, and no link to it carries a
 * parameter. The second scheme (ai-ops#45 option 2) is opt-in and says so in
 * the address.
 */
export type FolderScheme = "category" | "method";

export function parseFolderScheme(raw: string | string[] | undefined): FolderScheme {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value === "method" ? "method" : "category";
}

/**
 * `/repository/folders/a/b/c` for a trail. Built once, here, so no caller
 * concatenates.
 *
 * **The scheme rides on every link or it rides on none.** A switcher that set a
 * scheme and then handed the reader child links back to the other tree would
 * lose the choice on the first click — and it would do so silently, because both
 * trees render through this same view and the page would look like it worked.
 */
export function folderHref(segments: readonly string[], scheme: FolderScheme = "category"): string {
  const path =
    segments.length === 0
      ? "/repository/folders"
      : `/repository/folders/${segments.map(encodeURIComponent).join("/")}`;
  return scheme === "method" ? `${path}?scheme=method` : path;
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
  scheme: FolderScheme = "category",
): Array<{ key: string; text: string; href: string | null }> {
  const rows = [
    {
      key: "root",
      text: rootLabel,
      href: trail.length === 0 ? null : folderHref([], scheme),
    },
  ];
  for (const [index, node] of trail.entries()) {
    rows.push({
      key: node.segment,
      text: label(node),
      href:
        index === trail.length - 1
          ? null
          : folderHref(trail.slice(0, index + 1).map((crumb) => crumb.segment), scheme),
    });
  }
  return rows;
}

export function FolderView({
  location,
  locale,
  scheme = "category",
  unplaced = 0,
  placed = 0,
}: {
  location: FolderLocation;
  locale: PublicLocale;
  scheme?: FolderScheme;
  /**
   * Records this scheme cannot place, and records it can.
   *
   * **Both, or neither.** ai-ops#45 option 2 was pitched to the owner as
   * "already recorded on most records", and it is — 263 of 346. A tree that
   * printed neither number would let the reader take a walk over three quarters
   * of the catalogue for a walk over all of it, which is the misreading option 1
   * was rejected for at a larger scale. The first scheme places everything and
   * passes zero, so the line does not draw there.
   */
  unplaced?: number;
  placed?: number;
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
        {crumbs(trail, copy.root, label, scheme).map((crumb) => (
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

      {/* **Two links, and the current one is not a link.** ai-ops#45's first
          acceptance condition is that the interface must not get extremely
          complicated; a switcher is one row of two words and no control that
          did less would let a reader reach the second tree at all. It sits at
          the root only — offering "arrange by" halfway down a trail would have
          to either drop the reader at the other tree's root or claim a
          corresponding address exists in it, and neither is true. */}
      {trail.length === 0 ? (
        <p className="mj-folders-scheme">
          <span className="mj-layers-item-kind">{copy.schemeLabel}</span>{" "}
          {scheme === "category" ? (
            <span aria-current="true">{copy.schemeCategory}</span>
          ) : (
            <a href={folderHref([], "category")}>{copy.schemeCategory}</a>
          )}
          {" · "}
          {scheme === "method" ? (
            <span aria-current="true">{copy.schemeMethod}</span>
          ) : (
            <a href={folderHref([], "method")}>{copy.schemeMethod}</a>
          )}
        </p>
      ) : null}

      {/* The fraction, wherever the reader is in the second tree. Not only at
          the root: a reader who deep-linked into `variational` never saw the
          root and is the one most likely to read the tree as the whole
          catalogue. */}
      {scheme === "method" && unplaced > 0 ? (
        <p className="mj-folders-coverage">{copy.coverage(placed, placed + unplaced)}</p>
      ) : null}

      {/* The lede belongs to the root and to nowhere else. Repeating "browse down
          through the catalogue" on every folder is a sentence that stops being read by
          the second one, and it would sit where a folder's own description should be —
          which topics have and categories and families do not. Silence is the honest
          state for those, not the root's sentence borrowed. */}
      <header className="mj-layers-node-head">
        <h1>{here ? label(here) : copy.title}</h1>
        {here ? null : <p>{scheme === "method" ? copy.ledeMethod : copy.lede}</p>}
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
        {/* **Scheme-specific, because it is a claim about arithmetic and it is
            only true in one of the two trees.** In the first scheme this depth
            lists topics, a record carries several, and the children genuinely
            sum to more than the parent. In the second it lists families, which
            partition their category — the children add up exactly, and printing
            the note there would tell a reader the numbers do not add up while
            they are looking at numbers that do. The second scheme's
            non-partition is at its ROOT, where a record under three techniques
            is counted three times, and that is what the coverage line above
            covers. */}
        {scheme === "category" && location.level === "family" && location.children.length > 0 ? (
          <p className="mj-layers-empty">{copy.overlap}</p>
        ) : null}
        <ul className="mj-papers-list">
          {location.children.map((child) => (
            <li key={child.segment}>
              <a
                className="mj-papers-list-title"
                href={folderHref([...trail.map((crumb) => crumb.segment), child.segment], scheme)}
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
