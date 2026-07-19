"use client";

import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  entryVerificationMethods,
  getPublicRepositoryVariant,
  PUBLIC_REPOSITORY_CATEGORIES,
  PUBLIC_REPOSITORY_FRAMEWORKS,
  type PublicRepositoryCategory,
  type PublicRepositoryEntry,
  type PublicRepositoryFramework,
} from "../../lib/public-repository";
import type { PublicLocale } from "../../lib/public-locale";
import { VerificationTierBadge } from "../../components/repository-verification";
import { StarIcon } from "../../components/icons";
import { loadStarredRepositorySlugs, toggleRepositoryStar } from "../../lib/repository-stars";
import { RepositoryExportAction } from "./repository-export";

const COPY = {
  en: {
    search: "Search the repository",
    placeholder: "Search algorithms, frameworks, or tags",
    family: "Algorithm family",
    framework: "Framework",
    allFamilies: "All families",
    allFrameworks: "All frameworks",
    entry: "entry",
    entries: "entries",
    view: "View",
    gateExpand: "Expand into basic gates",
    gateCollapse: "Collapse to single gate",
    gateAtomic: "Basic gate",
    gateDecomposition: "Decomposition",
    gateListLabel: "Gates",
    gateDetailHint: "Select a gate to see its circuit and decomposition.",
    variants: "Variants",
    variantOf: "variants",
    star: "Star",
    unstar: "Unstar",
    starNote: "Repository stars stay in this public list. Saving an entry to Library starts an unstarred private copy.",
    emptyTitle: "No entries match those filters.",
    emptyBody: "Try a broader search or return to the full reference set.",
    clear: "Clear filters",
  },
  ja: {
    search: "リポジトリを検索",
    placeholder: "アルゴリズム、フレームワーク、タグを検索",
    family: "アルゴリズム系統",
    framework: "フレームワーク",
    allFamilies: "すべての系統",
    allFrameworks: "すべてのフレームワーク",
    entry: "件",
    entries: "件",
    view: "詳細",
    gateExpand: "基本ゲートに展開",
    gateCollapse: "1ゲート表示に戻す",
    gateAtomic: "基本ゲート",
    gateDecomposition: "分解",
    gateListLabel: "ゲート",
    gateDetailHint: "ゲートを選ぶと回路と分解が表示されます。",
    variants: "バリアント",
    variantOf: "バリアント",
    star: "スターを付ける",
    unstar: "スターを外す",
    starNote: "公開リポジトリのスターはこの一覧に保存されます。Libraryに保存すると、非公開コピーは未スターで始まります。",
    emptyTitle: "条件に一致するエントリがありません。",
    emptyBody: "検索範囲を広げるか、すべての参照セットに戻してください。",
    clear: "条件をクリア",
  },
} as const;

const FAMILY_LABELS_JA: Record<string, string> = {
  "Single-qubit gate": "単一量子ビットゲート",
  "Pauli operator": "パウリ演算子",
  "Controlled gate": "制御ゲート",
  "Two-qubit gate": "2量子ビットゲート",
  "Quantum query algorithm": "量子クエリアルゴリズム",
  "Bell / entanglement": "ベル / エンタングルメント",
  "GHZ / entanglement": "GHZ / エンタングルメント",
  QAOA: "QAOA",
  "Amplitude amplification": "振幅増幅",
  "Hidden-period / factoring": "隠れ周期 / 因数分解",
  "Amplitude estimation": "振幅推定",
  "Variational quantum algorithm": "変分量子アルゴリズム",
  "Eigenvalue estimation": "固有値推定",
  "Quantum linear algebra": "量子線形代数",
  "Quantum machine learning": "量子機械学習",
  "Entanglement and communication": "エンタングルメントと通信",
  "Quantum error correction": "量子誤り訂正",
  "Quantum Fourier transform": "量子フーリエ変換",
  "Hamiltonian simulation": "ハミルトニアンシミュレーション",
  "Hamiltonian / observable": "ハミルトニアン / 観測量",
  "Rotation gate": "回転ゲート",
  "Phase gate": "位相ゲート",
  "Multi-qubit gate": "多量子ビットゲート",
  "Entangled state": "エンタングル状態",
  "Encoded state": "符号化状態",
  "Sampling / benchmarking": "サンプリング / ベンチマーク",
  "Error mitigation": "誤り緩和",
  "Optimization / annealing": "最適化 / アニーリング",
};

function familyLabel(family: string, locale: PublicLocale): string {
  return locale === "ja" ? FAMILY_LABELS_JA[family] ?? family : family;
}

/**
 * Curated variant groups (Owner Inbox 2026-07-19: "qubit# variants should be
 * folded into one entry, option to toggle between variants"). Folding happens
 * purely in the UI — the underlying records are unchanged — so it is safe and
 * reversible. Each group lists the same algorithm at different sizes/forms; the
 * first slug is the canonical primary. Only hand-picked, genuinely-equivalent
 * clusters are folded, never a fuzzy title match.
 */
const VARIANT_GROUPS: Array<{ key: string; label: string; labelJa: string; slugs: string[] }> = [
  {
    key: "qft",
    label: "Quantum Fourier transform",
    labelJa: "量子フーリエ変換",
    slugs: ["quantum-fourier-transform", "qft-resource-screen"],
  },
  {
    key: "phase-estimation",
    label: "Phase estimation",
    labelJa: "位相推定",
    slugs: ["quantum-phase-estimation", "iterative-phase-estimation"],
  },
];

const SLUG_TO_GROUP = new Map<string, (typeof VARIANT_GROUPS)[number]>();
for (const group of VARIANT_GROUPS) {
  for (const slug of group.slugs) SLUG_TO_GROUP.set(slug, group);
}

type FoldedRow =
  | { kind: "single"; entry: PublicRepositoryEntry }
  | { kind: "group"; group: (typeof VARIANT_GROUPS)[number]; members: PublicRepositoryEntry[] };

/**
 * Collapse curated variant clusters into a single row, preserving order by each
 * cluster's first appearance. A cluster with only one surviving member (after
 * filtering) renders as a plain entry — no pointless toggle.
 */
function foldVariants(entries: PublicRepositoryEntry[]): FoldedRow[] {
  const rows: FoldedRow[] = [];
  const emitted = new Set<string>();
  for (const entry of entries) {
    const group = SLUG_TO_GROUP.get(entry.slug);
    if (!group) {
      rows.push({ kind: "single", entry });
      continue;
    }
    if (emitted.has(group.key)) continue;
    emitted.add(group.key);
    const members = group.slugs
      .map((slug) => entries.find((candidate) => candidate.slug === slug))
      .filter((candidate): candidate is PublicRepositoryEntry => Boolean(candidate));
    if (members.length <= 1) rows.push({ kind: "single", entry: members[0] ?? entry });
    else rows.push({ kind: "group", group, members });
  }
  return rows;
}

/**
 * Compact moment-aligned circuit for the gates grid — the same layout scheme
 * as the detail page's CircuitDiagram, reusing the shared mj-repo-circuit
 * styles with a --mini density modifier.
 */
function MiniCircuit({
  wires,
  operations,
  label,
}: {
  wires: string[];
  operations: Array<{ label: string; qubits: number[]; tone: "accent" | "ok" | "warn" | "neutral" }>;
  label: string;
}) {
  return (
    <div className="mj-repo-circuit mj-repo-circuit--mini" role="img" aria-label={label}>
      {wires.map((wire, wireIndex) => (
        <div className="mj-repo-circuit-row" key={wire}>
          <span className="mj-repo-circuit-wire">{wire}</span>
          <div className="mj-repo-circuit-track">
            {operations.map((operation, opIndex) => {
              const involved = operation.qubits.includes(wireIndex);
              const spanMin = Math.min(...operation.qubits);
              const spanMax = Math.max(...operation.qubits);
              const insideSpan = wireIndex > spanMin && wireIndex < spanMax;
              return (
                <span
                  className="mj-repo-circuit-cell"
                  data-connector={!involved && insideSpan ? "true" : undefined}
                  key={`${operation.label}-${opIndex}`}
                >
                  {involved ? (
                    <span className="mj-repo-circuit-op" data-tone={operation.tone}>{operation.label}</span>
                  ) : null}
                </span>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

export function RepositoryBrowser({
  entries,
  locale,
  isSignedIn,
  signInHref,
  legend,
}: {
  entries: PublicRepositoryEntry[];
  locale: PublicLocale;
  isSignedIn: boolean;
  signInHref: string | null;
  legend?: ReactNode;
}) {
  const copy = COPY[locale];
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<"all" | PublicRepositoryCategory>("all");
  const [family, setFamily] = useState<string>("");
  const [framework, setFramework] = useState<"" | PublicRepositoryFramework>("");
  const [starredSlugs, setStarredSlugs] = useState<Set<string>>(new Set());
  // Gate whose circuit is currently showing its basic-gate decomposition.
  const [expandedGates, setExpandedGates] = useState<Set<string>>(new Set());
  // Gate master/detail: the gate shown in the right-hand pane.
  const [selectedGate, setSelectedGate] = useState<string | null>(null);
  // Variant folding: the active member slug per variant group.
  const [variantActive, setVariantActive] = useState<Record<string, string>>({});

  useEffect(() => {
    setStarredSlugs(loadStarredRepositorySlugs());
    const handleRepositoryStarChange = () => setStarredSlugs(loadStarredRepositorySlugs());
    window.addEventListener("majorana:repository-stars", handleRepositoryStarChange);
    return () => window.removeEventListener("majorana:repository-stars", handleRepositoryStarChange);
  }, []);

  function handleStar(slug: string) {
    const starred = toggleRepositoryStar(slug);
    setStarredSlugs((current) => {
      const next = new Set(current);
      if (starred) next.add(slug);
      else next.delete(slug);
      return next;
    });
  }

  const families = useMemo(() => Array.from(new Set(entries.map((entry) => entry.algorithmFamily))).sort(), [entries]);
  const filteredEntries = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return entries.filter((entry) => {
      const matchesQuery = !normalizedQuery || [
        entry.title,
        entry.titleJa,
        entry.algorithmFamily,
        entry.framework,
        entry.description,
        entry.descriptionJa,
        entry.provenance,
        ...entry.tags,
      ].join(" ").toLowerCase().includes(normalizedQuery);
      const matchesCategory = category === "all" || entry.category === category;
      const matchesFamily = !family || entry.algorithmFamily === family;
      const matchesFramework = !framework || getPublicRepositoryVariant(entry, framework).status !== "unsupported";
      return matchesQuery && matchesCategory && matchesFamily && matchesFramework;
    });
  }, [category, entries, family, framework, query]);

  const gateEntries = useMemo(
    () => (category === "gates" ? filteredEntries : []),
    [category, filteredEntries],
  );

  // Keep the selected gate valid as filters change: default to the first, and
  // reset if the current selection drops out of the filtered set.
  useEffect(() => {
    if (category !== "gates") return;
    if (!gateEntries.length) {
      setSelectedGate(null);
      return;
    }
    setSelectedGate((current) =>
      current && gateEntries.some((entry) => entry.slug === current) ? current : gateEntries[0].slug,
    );
  }, [category, gateEntries]);

  function clearFilters() {
    setQuery("");
    setCategory("all");
    setFamily("");
    setFramework("");
  }

  function toggleGateExpansion(slug: string) {
    setExpandedGates((current) => {
      const next = new Set(current);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  }

  function activeMember(row: Extract<FoldedRow, { kind: "group" }>): PublicRepositoryEntry {
    const chosen = variantActive[row.group.key];
    return row.members.find((member) => member.slug === chosen) ?? row.members[0];
  }

  function renderRepoCard(entry: PublicRepositoryEntry, extraHead?: ReactNode) {
    const title = locale === "ja" ? entry.titleJa : entry.title;
    const description = locale === "ja" ? entry.descriptionJa : entry.description;
    const qubits = entry.resources.find((resource) => resource.label === "Qubits")?.value;
    return (
      <article className="mj-repo-card">
        {extraHead}
        <div className="mj-repo-card-top">
          <VerificationTierBadge methods={entryVerificationMethods(entry)} locale={locale} />
          <span>{locale === "ja" ? entry.categoryLabelJa : entry.categoryLabel}</span>
          <span>{familyLabel(entry.algorithmFamily, locale)}</span>
          {qubits ? <span className="mj-repo-card-qubits">{qubits} q</span> : null}
          <time dateTime={entry.updatedAt}>{entry.updatedAt}</time>
        </div>
        <h3><a href={`/repository/${entry.slug}`}>{title}</a></h3>
        <p>{description}</p>
        <div className="mj-repo-card-foot">
          <div className="mj-repository-tags" aria-label={locale === "ja" ? "タグ" : "Tags"}>
            {entry.tags.slice(0, 3).map((tag) => <span key={tag}>{tag}</span>)}
          </div>
          <div className="mj-repo-card-links">
            <button className={`mj-star-toggle${starredSlugs.has(entry.slug) ? " is-starred" : ""}`} type="button" aria-pressed={starredSlugs.has(entry.slug)} title={starredSlugs.has(entry.slug) ? copy.unstar : copy.star} onClick={() => handleStar(entry.slug)}>
              <StarIcon size={14} filled={starredSlugs.has(entry.slug)} />
              {starredSlugs.has(entry.slug) ? copy.unstar : copy.star}
            </button>
            <RepositoryExportAction slug={entry.slug} title={title} isSignedIn={isSignedIn} signInHref={signInHref} locale={locale} />
            <a className="mj-text-link" href={`/repository/${entry.slug}`}>{copy.view} ↗</a>
          </div>
        </div>
      </article>
    );
  }

  function renderRow(row: FoldedRow) {
    if (row.kind === "single") return <Fragment key={row.entry.slug}>{renderRepoCard(row.entry)}</Fragment>;
    const active = activeMember(row);
    // A small variant switcher sits above the active member's card; picking a
    // pill swaps which sibling record the card shows.
    const switcher = (
      <div className="mj-repo-variant-switch" role="group" aria-label={locale === "ja" ? row.group.labelJa : row.group.label}>
        <span className="mj-repo-variant-label">{copy.variants}</span>
        {row.members.map((member) => (
          <button
            key={member.slug}
            type="button"
            className={member.slug === active.slug ? "is-active" : ""}
            aria-pressed={member.slug === active.slug}
            onClick={() => setVariantActive((current) => ({ ...current, [row.group.key]: member.slug }))}
          >
            {locale === "ja" ? member.titleJa : member.title}
          </button>
        ))}
      </div>
    );
    return <Fragment key={row.group.key}>{renderRepoCard(active, switcher)}</Fragment>;
  }

  // Algorithm view: group the filtered entries by family, then fold variants
  // inside each group.
  const algorithmGroups = useMemo(() => {
    if (category !== "algorithms") return [];
    const byFamily = new Map<string, PublicRepositoryEntry[]>();
    for (const entry of filteredEntries) {
      const list = byFamily.get(entry.algorithmFamily) ?? [];
      list.push(entry);
      byFamily.set(entry.algorithmFamily, list);
    }
    return Array.from(byFamily.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([familyKey, groupEntries]) => ({ familyKey, rows: foldVariants(groupEntries) }));
  }, [category, filteredEntries]);

  const listRows = useMemo(
    () => (category === "gates" || category === "algorithms" ? [] : foldVariants(filteredEntries)),
    [category, filteredEntries],
  );

  // Fall back to the first gate so the detail pane is populated on the very
  // first render (before the selection effect runs / without JS), and keep the
  // sidebar highlight in sync with whatever is actually shown.
  const selectedGateEntry = gateEntries.find((entry) => entry.slug === selectedGate) ?? gateEntries[0] ?? null;
  const activeGateSlug = selectedGateEntry?.slug ?? null;

  return (
    <div className="mj-repository-browser">
      <div className="mj-repository-controls">
        <label>
          <span>{copy.search}</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={copy.placeholder}
            type="search"
          />
        </label>
        <label>
          <span>{copy.family}</span>
          <select value={family} onChange={(event) => setFamily(event.target.value)}>
            <option value="">{copy.allFamilies}</option>
            {families.map((option) => <option key={option} value={option}>{familyLabel(option, locale)}</option>)}
          </select>
        </label>
        <label>
          <span>{copy.framework}</span>
          <select value={framework} onChange={(event) => setFramework(event.target.value as "" | PublicRepositoryFramework)}>
            <option value="">{copy.allFrameworks}</option>
            {PUBLIC_REPOSITORY_FRAMEWORKS.map((option) => <option key={option}>{option}</option>)}
          </select>
        </label>
      </div>

      <div className="mj-repository-category-nav" aria-label={locale === "ja" ? "カテゴリ" : "Categories"}>
        {PUBLIC_REPOSITORY_CATEGORIES.map((option) => (
          <button
            className={category === option.value ? "is-active" : ""}
            key={option.value}
            type="button"
            aria-pressed={category === option.value}
            title={locale === "ja" ? option.labelJa : option.label}
            onClick={() => setCategory(option.value)}
          >
            {locale === "ja" ? option.labelJa : option.label}
          </button>
        ))}
      </div>

      {legend}

      <p className="mj-repository-result-count" aria-live="polite">
        {locale === "ja" ? `${filteredEntries.length}${copy.entries}` : `${filteredEntries.length} public ${filteredEntries.length === 1 ? copy.entry : copy.entries}`}
      </p>
      <p className="mj-repository-star-note">{copy.starNote}</p>

      {!filteredEntries.length ? (
        <div className="mj-repository-empty">
          <h3>{copy.emptyTitle}</h3>
          <p>{copy.emptyBody}</p>
          <button type="button" onClick={clearFilters}>{copy.clear}</button>
        </div>
      ) : category === "gates" ? (
        // Master/detail: a thin sidebar of every gate, the selected one opened
        // in the large pane on the right (Owner Inbox 2026-07-19).
        <div className="mj-gate-master">
          <nav className="mj-gate-sidebar" aria-label={copy.gateListLabel}>
            {gateEntries.map((entry) => (
              <button
                key={entry.slug}
                type="button"
                className={entry.slug === activeGateSlug ? "is-active" : ""}
                aria-current={entry.slug === activeGateSlug}
                onClick={() => setSelectedGate(entry.slug)}
              >
                <span>{locale === "ja" ? entry.titleJa : entry.title}</span>
                <span className="mj-gate-sidebar-family">{familyLabel(entry.algorithmFamily, locale)}</span>
              </button>
            ))}
          </nav>
          <div className="mj-gate-detail">
            {selectedGateEntry ? (() => {
              const entry = selectedGateEntry;
              const title = locale === "ja" ? entry.titleJa : entry.title;
              const expanded = expandedGates.has(entry.slug) && Boolean(entry.decomposition);
              const circuit = expanded && entry.decomposition
                ? { wires: entry.decomposition.wires, operations: entry.decomposition.operations }
                : { wires: entry.visualization.wires, operations: entry.visualization.operations };
              return (
                <article className="mj-gate-detail-card">
                  <div className="mj-gate-card-head">
                    <h3><a href={`/repository/${entry.slug}`}>{title}</a></h3>
                    <VerificationTierBadge methods={entryVerificationMethods(entry)} locale={locale} />
                  </div>
                  <p className="mj-gate-card-family">{familyLabel(entry.algorithmFamily, locale)}</p>
                  <p className="mj-gate-detail-desc">{locale === "ja" ? entry.descriptionJa : entry.description}</p>
                  <MiniCircuit wires={circuit.wires} operations={circuit.operations} label={title} />
                  {expanded && entry.decomposition ? (
                    <p className="mj-gate-card-decomp">
                      <span>{copy.gateDecomposition}:</span>{" "}
                      {locale === "ja" ? entry.decomposition.summaryJa : entry.decomposition.summary}
                    </p>
                  ) : null}
                  <div className="mj-gate-card-foot">
                    {entry.decomposition ? (
                      <button
                        className="mj-gate-toggle"
                        type="button"
                        aria-pressed={expanded}
                        onClick={() => toggleGateExpansion(entry.slug)}
                      >
                        {expanded ? copy.gateCollapse : copy.gateExpand}
                      </button>
                    ) : (
                      <span className="mj-gate-atomic">{copy.gateAtomic}</span>
                    )}
                    <div className="mj-repo-card-links">
                      <button className={`mj-star-toggle${starredSlugs.has(entry.slug) ? " is-starred" : ""}`} type="button" aria-pressed={starredSlugs.has(entry.slug)} title={starredSlugs.has(entry.slug) ? copy.unstar : copy.star} onClick={() => handleStar(entry.slug)}>
                        <StarIcon size={14} filled={starredSlugs.has(entry.slug)} />
                        {starredSlugs.has(entry.slug) ? copy.unstar : copy.star}
                      </button>
                      <a className="mj-text-link" href={`/repository/${entry.slug}`}>{copy.view} ↗</a>
                    </div>
                  </div>
                </article>
              );
            })() : (
              <p className="mj-gate-detail-hint">{copy.gateDetailHint}</p>
            )}
          </div>
        </div>
      ) : category === "algorithms" ? (
        // Algorithms grouped into clickable disclosure groups by family.
        <div className="mj-repo-groups">
          {algorithmGroups.map((group, index) => (
            <details className="mj-repo-group" key={group.familyKey} open={index === 0}>
              <summary>
                <span>{familyLabel(group.familyKey, locale)}</span>
                <span className="mj-repo-group-count">{group.rows.length}</span>
              </summary>
              <div className="mj-repo-list">{group.rows.map((row) => renderRow(row))}</div>
            </details>
          ))}
        </div>
      ) : (
        <div className="mj-repo-list">{listRows.map((row) => renderRow(row))}</div>
      )}
    </div>
  );
}
