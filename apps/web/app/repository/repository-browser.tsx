"use client";

import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  entryVerificationMethods,
  getPublicRepositoryVariant,
  PUBLIC_REPOSITORY_CATEGORIES,
  PUBLIC_REPOSITORY_FRAMEWORKS,
  type PublicRepositoryCategory,
  type PublicRepositoryListEntry,
  type PublicRepositoryFramework,
} from "../../lib/public-repository";
import type { PublicLocale } from "../../lib/public-locale";
import { VerificationTierBadge } from "../../components/repository-verification";
import { StarIcon } from "../../components/icons";
import { loadStarredRepositorySlugs, toggleRepositoryStar } from "../../lib/repository-stars";
import { RepositoryExportAction } from "./repository-export";
import type { RepositoryEstimateList, RepositoryEstimateSummary } from "../../lib/repository/estimate";
import {
  orderEntries,
  withCircuitOnly,
  isProfileOrder,
  type BrowseOrder,
} from "../../lib/repository/browse-order";
import { profilesBySlug, type RepositoryProfileList } from "../../lib/repository/profile";
import { filterByTopic, topicOptionLabel, topicOptions } from "../../lib/repository/topic-filter";
import { roleOf, TOPICS_BY_ID, type TopicId } from "../../lib/repository/topics";

const COPY = {
  en: {
    search: "Search the Atlas",
    placeholder: "Search algorithms, frameworks, or tags",
    family: "Algorithm family",
    framework: "Framework",
    allFamilies: "All families",
    allFrameworks: "All frameworks",
    topic: "Topic",
    allTopics: "All topics",
    facet_role: "What it is",
    facet_method: "Technique",
    facet_domain: "Problem domain",
    facetDomainCount: "{n} of {total} entries",
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
    starNote: "Atlas stars stay in this public list. Saving an entry to your workspace starts an unstarred private copy.",
    emptyTitle: "No entries match those filters.",
    emptyBody: "Try a broader search or return to the full reference set.",
    clear: "Clear filters",
    sort: "Order by",
    sortDefault: "Catalog order",
    sortCost: "Fault-tolerant cost",
    sortCostDesc: "Fault-tolerant cost (largest first)",
    costLabel: "physical qubits",
    costSpanTitle:
      "Smallest machine that can run it, to the fastest useful one. The difference is magic-state factories. Ranked on the high end.",
    costUnknown: "cost not stated",
    costNoCircuit: "no circuit",
    costNone: "no magic states",
    unrankedTitle: "Not ranked",
    unrankedBody:
      "These entries carry no stated cost, so they are listed after the ranked ones rather than sorted among them. An unknown cost is not a low cost.",
    sortQubits: "Qubits",
    sortQubitsDesc: "Qubits (widest first)",
    sortDepth: "Circuit depth",
    sortDepthDesc: "Circuit depth (deepest first)",
    sortTwoQubit: "Two-qubit gates",
    sortTwoQubitDesc: "Two-qubit gates (most first)",
    circuitOnly: "Only entries with a circuit",
    circuitOnlyHint:
      "163 of the published entries are literature and operator records that pin no gate sequence, so they have no measurable structure.",
    structureUnrankedBody:
      "These entries carry no published gate sequence, so there is nothing to measure. They are listed after the ranked ones rather than sorted among them: an unmeasured circuit is not a small one.",
    depthLabel: "depth",
    twoQubitLabel: "2Q",
    costUnder: "Costed under",
    costUnderNote:
      "Every figure in this list was computed under one assumption set. Numbers from a different set — a different synthesis precision, or different hardware — are a different claim and are not ordered against these.",
  },
  ja: {
    search: "Atlasを検索",
    placeholder: "アルゴリズム、フレームワーク、タグを検索",
    family: "アルゴリズムの分類",
    framework: "フレームワーク",
    allFamilies: "すべての分類",
    allFrameworks: "すべてのフレームワーク",
    topic: "トピック",
    allTopics: "すべてのトピック",
    facet_role: "種別",
    facet_method: "手法",
    facet_domain: "問題領域",
    facetDomainCount: "{total}件中{n}件",
    entry: "件",
    entries: "件",
    view: "詳細",
    gateExpand: "基本ゲートに展開",
    gateCollapse: "元のゲート表示に戻す",
    gateAtomic: "基本ゲート",
    gateDecomposition: "分解",
    gateListLabel: "ゲート",
    gateDetailHint: "ゲートを選ぶと回路と分解が表示されます。",
    variants: "別の構成",
    variantOf: "構成違い",
    star: "スターを付ける",
    unstar: "スターを外す",
    starNote: "スターはAtlasの一覧に保存されます。ワークスペースに追加したコピーには引き継がれません。",
    emptyTitle: "条件に一致するエントリがありません。",
    emptyBody: "検索条件を減らすか、条件をすべて解除してください。",
    clear: "条件をクリア",
    sort: "並び順",
    sortDefault: "カタログ順",
    sortCost: "誤り耐性計算のコスト",
    sortCostDesc: "誤り耐性計算のコスト（大きい順）",
    costLabel: "物理量子ビット",
    costSpanTitle:
      "この回路が動作しうる最小構成のマシンから、有効な最速のマシンまで。差はマジックステート工場によるものです。並び替えは上限値で行います。",
    costUnknown: "コスト未提示",
    costNoCircuit: "回路なし",
    costNone: "マジックステート不要",
    unrankedTitle: "順位付けの対象外",
    unrankedBody:
      "これらの項目にはコストが提示されていないため、順位付けされた項目の後にまとめて表示しています。コストが不明であることは、コストが低いことではありません。",
    sortQubits: "量子ビット数",
    sortQubitsDesc: "量子ビット数（多い順）",
    sortDepth: "回路の深さ",
    sortDepthDesc: "回路の深さ（深い順）",
    sortTwoQubit: "2量子ビットゲート数",
    sortTwoQubitDesc: "2量子ビットゲート数（多い順）",
    circuitOnly: "回路があるエントリのみ",
    circuitOnlyHint:
      "公開エントリのうち163件は、ゲート列を持たない文献・演算子の記録です。構造を測定する対象がありません。",
    structureUnrankedBody:
      "これらの項目にはゲート列が公開されていないため、測定できる構造がありません。順位付けされた項目の後にまとめて表示しています。測定されていないことは、小さいことではありません。",
    depthLabel: "深さ",
    twoQubitLabel: "2Q",
    costUnder: "前提条件",
    costUnderNote:
      "この一覧の数値はすべて同一の前提条件のもとで計算されています。前提条件（合成精度やハードウェア）が異なる数値は別の主張であり、これらと並べて順位付けすることはできません。",
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
  "Entangled state": "量子もつれ状態",
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
  | { kind: "single"; entry: PublicRepositoryListEntry }
  | { kind: "group"; group: (typeof VARIANT_GROUPS)[number]; members: PublicRepositoryListEntry[] };

/**
 * Collapse curated variant clusters into a single row, preserving order by each
 * cluster's first appearance. A cluster with only one surviving member (after
 * filtering) renders as a plain entry — no pointless toggle.
 */
function foldVariants(entries: PublicRepositoryListEntry[]): FoldedRow[] {
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
      .filter((candidate): candidate is PublicRepositoryListEntry => Boolean(candidate));
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
  estimates,
  profiles,
  initialTopic = "",
}: {
  entries: PublicRepositoryListEntry[];
  locale: PublicLocale;
  isSignedIn: boolean;
  signInHref: string | null;
  legend?: ReactNode;
  /**
   * Every entry's fault-tolerant cost under ONE assumption set, or null.
   *
   * The set arrives on the container rather than per row, and that is what
   * makes ordering by cost defensible: every row here is comparable with every
   * other by construction, and there is nothing inside the object to compare
   * across. Null when the catalog API is off — the cost column and the ordering
   * option then simply do not appear, because there is no second implementation
   * of the estimator on this side to fall back to.
   */
  estimates?: RepositoryEstimateList | null;
  /**
   * Every entry's derived circuit structure (R1), or null when the catalog API
   * is off — in which case the structure orderings and the circuit-only filter
   * do not appear at all, rather than appearing and ranking nothing.
   */
  profiles?: RepositoryProfileList | null;
  /** Resolved from `?topic=` by the server component; "" when absent or unknown. */
  initialTopic?: TopicId | "";
}) {
  const copy = COPY[locale];
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<"all" | PublicRepositoryCategory>("all");
  const [family, setFamily] = useState<string>("");
  const [framework, setFramework] = useState<"" | PublicRepositoryFramework>("");
  // Seeded from ?topic= by the server component, never read from `window` here:
  // this page does not hydrate in either browser surface, so an effect that set
  // it would leave the entry pages' topic chips linking to a filter that never
  // applies. Seeding the initial state means the server's own HTML is filtered.
  const [topic, setTopic] = useState<TopicId | "">(initialTopic);
  const [order, setOrder] = useState<BrowseOrder>("catalog");
  const [circuitOnly, setCircuitOnly] = useState(false);
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
  // Counted over the whole corpus rather than over what the other filters have
  // left, so the control does not renumber itself as a reader narrows — a count
  // that moves while you are reading it is not a count, it is a hint.
  const topicGroups = useMemo(() => topicOptions(entries, locale === "ja" ? "ja" : "en"), [entries, locale]);
  /**
   * How many entries carry ANY domain — a distinct count, not the sum of the
   * per-topic ones: HHL is both `finance` and `linear-algebra`, so adding the
   * options up would overstate the coverage the group heading is there to
   * qualify. Computed rather than written into the copy, because a number typed
   * into a translated string is a third copy of a fact and drifts silently.
   */
  const entriesWithDomain = useMemo(
    () =>
      entries.filter((entry) =>
        (entry.topics ?? []).some((id) => TOPICS_BY_ID.get(id)?.facet === "domain"),
      ).length,
    [entries],
  );
  const filteredEntries = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const matched = entries.filter((entry) => {
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
      const variant = framework ? getPublicRepositoryVariant(entry, framework) : null;
      const matchesFramework = !framework || variant?.status === "native" || variant?.status === "conversion";
      return matchesQuery && matchesCategory && matchesFamily && matchesFramework;
    });
    // Applied through the shared helper rather than as another clause here: the
    // browse <select> does not hydrate in either browser surface, so the rule
    // has to live where a unit test can reach it (lib/repository/topic-filter).
    return filterByTopic(matched, topic);
  }, [category, entries, family, framework, query, topic]);

  /** slug -> its cost row, when the API supplied a listing. */
  const costBySlug = useMemo(() => {
    const index = new Map<string, RepositoryEstimateSummary>();
    for (const row of estimates?.estimates ?? []) index.set(row.slug, row);
    return index;
  }, [estimates]);

  const canOrderByCost = costBySlug.size > 0;

  /** slug -> its derived circuit structure, when the API supplied a listing. */
  const profileBySlug = useMemo(() => profilesBySlug(profiles ?? null), [profiles]);
  const canOrderByStructure = profileBySlug.size > 0;

  /**
   * Entries after the circuit-only filter, which is separate from the text and
   * category filters above because it reads a *derived* property rather than an
   * authored one — it needs the profile listing to exist at all.
   */
  const structureFiltered = useMemo(
    () =>
      circuitOnly && canOrderByStructure
        ? withCircuitOnly(filteredEntries, (entry) => profileBySlug.get(entry.slug))
        : filteredEntries,
    [canOrderByStructure, circuitOnly, filteredEntries, profileBySlug],
  );

  /**
   * Filtered entries in the requested order, with the unrankable ones held out.
   *
   * The rule and its reasoning live in lib/repository/browse-order, where they
   * are unit-tested — the interesting half of this is a *refusal*, and a refusal
   * buried in a component body is one nobody exercises.
   */
  const orderAvailable = isProfileOrder(order) ? canOrderByStructure : canOrderByCost;
  const { ordered, unranked } = useMemo(
    () =>
      orderEntries(structureFiltered, orderAvailable ? order : "catalog", {
        costOf: (entry) => costBySlug.get(entry.slug),
        profileOf: (entry) => profileBySlug.get(entry.slug),
        keyOf: (entry) => entry.slug,
      }),
    [costBySlug, orderAvailable, order, profileBySlug, structureFiltered],
  );

  const gateEntries = useMemo(
    () => (category === "gates" ? ordered : []),
    [category, ordered],
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
    setCircuitOnly(false);
  }

  function toggleGateExpansion(slug: string) {
    setExpandedGates((current) => {
      const next = new Set(current);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  }

  function activeMember(row: Extract<FoldedRow, { kind: "group" }>): PublicRepositoryListEntry {
    const chosen = variantActive[row.group.key];
    return row.members.find((member) => member.slug === chosen) ?? row.members[0];
  }

  /**
   * One card's cost, in as few characters as a card can carry.
   *
   * Renders nothing at all for an entry with no circuit: 163 of the 283
   * published records are literature and operator entries, and a "no circuit"
   * chip on every one of them would be noise that says nothing. A *refusal* is
   * different and does get a chip — there the circuit exists and its cost is
   * genuinely unknown, which is information.
   *
   * **A span where there is one**, for the reason the detail panel gives at
   * length: the ranked figure is this circuit on the fastest useful machine,
   * which is also the largest, and on 56 of the 120 priced entries the smallest
   * machine that runs it is up to 95× smaller. The card is where a visitor meets
   * the number first, so it is where reading it as *the* cost starts.
   *
   * **The ordering is untouched** — the list still ranks on the same figure it
   * ranked on before, the high end. A card that displayed one number and sorted
   * on another would be worse than either.
   */
  function renderCostChip(slug: string) {
    const row = costBySlug.get(slug);
    if (!row || row.basis === "no_circuit") return null;
    if (row.basis === "refused") {
      return <span className="mj-repo-card-cost mj-repo-card-cost--unknown">{copy.costUnknown}</span>;
    }
    if (row.totalPhysicalQubits === null) return null;
    const tag = locale === "ja" ? "ja-JP" : "en-US";
    const high = row.totalPhysicalQubits.toLocaleString(tag);
    const value =
      row.smallestMachineQubits === null
        ? high
        : `${row.smallestMachineQubits.toLocaleString(tag)}–${high}`;
    return (
      <span
        className={`mj-repo-card-cost mj-repo-card-cost--${row.basis}`}
        title={row.smallestMachineQubits === null ? undefined : copy.costSpanTitle}
      >
        {value} {copy.costLabel}
        {row.basis === "estimated" ? " ≈" : null}
      </span>
    );
  }

  function renderRepoCard(entry: PublicRepositoryListEntry, extraHead?: ReactNode) {
    const title = locale === "ja" ? entry.titleJa : entry.title;
    const description = locale === "ja" ? entry.descriptionJa : entry.description;
    const qubits = entry.resources.find((resource) => resource.label === "Qubits")?.value;
    const roleId = roleOf(entry.topics ?? []);
    const role = roleId ? TOPICS_BY_ID.get(roleId) : undefined;
    return (
      <article className="mj-repo-card">
        {extraHead}
        <div className="mj-repo-card-top">
          <VerificationTierBadge methods={entryVerificationMethods(entry)} locale={locale} />
          <span>{locale === "ja" ? entry.categoryLabelJa : entry.categoryLabel}</span>
          {/* The role, beside the family, because it is what stops a domain
              filter from over-promising: the ten entries under "Optimization"
              are mostly width-scaled MaxCut ring benchmarks, and this is where
              a reader sees that without opening one. The category above says
              "Algorithms" for all of them; the role distinguishes the 112
              benchmark circuits from the 70 algorithm references. */}
          {role ? <span className="mj-repo-card-role">{locale === "ja" ? role.labelJa : role.label}</span> : null}
          <span>{familyLabel(entry.algorithmFamily, locale)}</span>
          {qubits ? <span className="mj-repo-card-qubits">{qubits} q</span> : null}
          {renderCostChip(entry.slug)}
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
    //
    // These are anchors rather than buttons on purpose. Folding a group emits ONE
    // card, so only the active member got a real /repository/<slug> link — the
    // inactive sibling had no crawlable entry point anywhere on the site (this is
    // why the corpus looked like "281 of 283": 283 records, two folded pairs, 281
    // rows — working as designed, but two slugs were unreachable by link). Giving
    // every member an href restores that without changing the curated UX: a plain
    // left-click still swaps in place, while crawlers, middle-click, and no-JS
    // visitors follow the href to the record's own page.
    const switcher = (
      <div className="mj-repo-variant-switch" role="group" aria-label={locale === "ja" ? row.group.labelJa : row.group.label}>
        <span className="mj-repo-variant-label">{copy.variants}</span>
        {row.members.map((member) => (
          <a
            key={member.slug}
            href={`/repository/${member.slug}`}
            className={member.slug === active.slug ? "is-active" : ""}
            aria-current={member.slug === active.slug ? "true" : undefined}
            onClick={(event) => {
              // Let the browser handle modified clicks (new tab, download, etc.).
              if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
              event.preventDefault();
              setVariantActive((current) => ({ ...current, [row.group.key]: member.slug }));
            }}
          >
            {locale === "ja" ? member.titleJa : member.title}
          </a>
        ))}
      </div>
    );
    return <Fragment key={row.group.key}>{renderRepoCard(active, switcher)}</Fragment>;
  }

  // Algorithm view: group the filtered entries by family, then fold variants
  // inside each group.
  const algorithmGroups = useMemo(() => {
    if (category !== "algorithms") return [];
    const byFamily = new Map<string, PublicRepositoryListEntry[]>();
    for (const entry of ordered) {
      const list = byFamily.get(entry.algorithmFamily) ?? [];
      list.push(entry);
      byFamily.set(entry.algorithmFamily, list);
    }
    return Array.from(byFamily.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([familyKey, groupEntries]) => ({ familyKey, rows: foldVariants(groupEntries) }));
    // `ordered`, not `filteredEntries`: the body reads the former, and since R1
    // it is no longer a pure function of the latter — a structure sort or the
    // circuit-only filter would otherwise leave this grouping showing the
    // previous ordering.
  }, [category, ordered]);

  const listRows = useMemo(
    () => (category === "gates" || category === "algorithms" ? [] : foldVariants(ordered)),
    [category, ordered],
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
        {/* One control for three facets, grouped, because the alternative is
            three more selects beside four existing ones. Every option carries
            its count: "Optimization (10)" cannot be read as a promise the way a
            bare "Optimization" can, and on this corpus that matters — those ten
            are eight width-scaled MaxCut ring benchmarks. */}
        <label>
          <span>{copy.topic}</span>
          <select value={topic} onChange={(event) => setTopic(event.target.value as TopicId | "")}>
            <option value="">{copy.allTopics}</option>
            {topicGroups.map((group) => (
              <optgroup
                key={group.facet}
                label={
                  group.facet === "domain"
                    ? `${copy.facet_domain} — ${copy.facetDomainCount.replace("{n}", String(entriesWithDomain)).replace("{total}", String(entries.length))}`
                    : copy[`facet_${group.facet}`]
                }
              >
                {group.options.map((option) => (
                  <option key={option.id} value={option.id}>{topicOptionLabel(option)}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        {canOrderByCost || canOrderByStructure ? (
          <label>
            <span>{copy.sort}</span>
            <select value={order} onChange={(event) => setOrder(event.target.value as BrowseOrder)}>
              <option value="catalog">{copy.sortDefault}</option>
              {canOrderByCost ? (
                <>
                  <option value="cost-asc">{copy.sortCost}</option>
                  <option value="cost-desc">{copy.sortCostDesc}</option>
                </>
              ) : null}
              {/* Offered only when the listing exists. An ordering option that
                  ranks nothing is worse than an absent one: it looks like the
                  corpus has no structure rather than like the API is off. */}
              {canOrderByStructure ? (
                <>
                  <option value="qubits-asc">{copy.sortQubits}</option>
                  <option value="qubits-desc">{copy.sortQubitsDesc}</option>
                  <option value="depth-asc">{copy.sortDepth}</option>
                  <option value="depth-desc">{copy.sortDepthDesc}</option>
                  <option value="two-qubit-asc">{copy.sortTwoQubit}</option>
                  <option value="two-qubit-desc">{copy.sortTwoQubitDesc}</option>
                </>
              ) : null}
            </select>
          </label>
        ) : null}
        {canOrderByStructure ? (
          <label className="mj-repository-circuit-only" title={copy.circuitOnlyHint}>
            <input
              type="checkbox"
              checked={circuitOnly}
              onChange={(event) => setCircuitOnly(event.target.checked)}
            />
            <span>{copy.circuitOnly}</span>
          </label>
        ) : null}
      </div>

      {/* The assumption set is stated wherever the ordering it justifies is
          offered — not tucked into a detail page. An ordered list whose basis
          for ordering is somewhere else is the failure mode this whole feature
          exists to avoid. */}
      {canOrderByCost && order !== "catalog" && !isProfileOrder(order) && estimates ? (
        <p className="mj-repository-cost-basis">
          <span>{copy.costUnder}</span> <code>{estimates.assumptions.identity}</code>
          <span className="mj-repository-cost-basis-note">{copy.costUnderNote}</span>
        </p>
      ) : null}

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
        {locale === "ja" ? `${structureFiltered.length}${copy.entries}` : `${structureFiltered.length} public ${structureFiltered.length === 1 ? copy.entry : copy.entries}`}
      </p>
      <p className="mj-repository-star-note">{copy.starNote}</p>

      {!structureFiltered.length ? (
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

      {/* Entries the ordering had to leave out, kept visible and kept out of
          the ranking. An unknown cost is not a low cost, and a list that
          silently dropped these would read as though the catalog were smaller
          than it is. */}
      {unranked.length ? (
        <section className="mj-repository-unranked">
          <h3>{copy.unrankedTitle} <span>{unranked.length}</span></h3>
          <p>{isProfileOrder(order) ? copy.structureUnrankedBody : copy.unrankedBody}</p>
          <div className="mj-repo-list">{unranked.map((entry) => <Fragment key={entry.slug}>{renderRepoCard(entry)}</Fragment>)}</div>
        </section>
      ) : null}
    </div>
  );
}
