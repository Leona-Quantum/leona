"use client";

import { Fragment, useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  entryVerificationMethods,
  PUBLIC_REPOSITORY_CATEGORIES,
  type PublicRepositoryCategory,
  type PublicRepositoryListEntry,
} from "../../lib/public-repository";
import type { PublicLocale } from "../../lib/public-locale";
import { VerificationTierBadge } from "../../components/repository-verification";
import { StarIcon } from "../../components/icons";
import { loadStarredRepositorySlugs, toggleRepositoryStar } from "../../lib/repository-stars";
import { RepositoryExportAction } from "./repository-export";
import type { RepositoryEstimateSummary } from "../../lib/repository/estimate";
import { isProfileOrder, PROFILE_ORDERS, type BrowseOrder } from "../../lib/repository/browse-order";
import { DEFAULT_ROW_LIMIT, type RowLimit } from "../../lib/repository/browse-page";
import type { ResolvedBrowseParams } from "../../lib/repository/browse-params";
import type { RepositoryBrowseView, BrowseRow } from "../../lib/repository/browse-view";
import { PIPELINE_STANCES, type InterfaceStance } from "../../lib/repository/interface";
import { roleOf, TOPICS_BY_ID, type TopicId } from "../../lib/repository/topics";

const COPY = {
  en: {
    search: "Search the Atlas",
    placeholder: "Search algorithms, frameworks, or tags",
    topic: "Topic",
    allTopics: "All topics",
    stance: "Takes / returns",
    allStances: "Any interface",
    stanceGroupPipeline: "In a pipeline",
    stanceGroupNot: "Not a pipeline stage",
    stanceConnectable: "{n} of {total} declare ports · {met} meet another entry",
    stance_source: "Prepares a state",
    stance_transform: "Register in, register out",
    stance_program: "Whole program, measured",
    // Reads as a contribution rather than a defect, because §3.6 says it is
    // one: the record names which part its source does not state, with a
    // citation. "Missing" or "Incomplete" would file it with `undeclared`,
    // which is the one distinction the field exists to make.
    "stance_declared-hole": "Declared hole, sourced",
    stance_observable: "Observable",
    stance_undeclared: "No declared interface",
    facet_role: "What it is",
    facet_method: "Technique",
    facet_domain: "Problem domain",
    facetDomainCount: "{n} of {total} entries",
    entry: "entry",
    entries: "entries",
    // Shown only when folding actually removed a row, so the ordinary case
    // stays the short sentence it was.
    countFolded: "{rows} entries · {records} records, sized variants folded",
    countFoldedTitle:
      "Sized and curated variants of the same circuit are folded into one entry. Every variant is still its own page, and the widths are listed on the card.",
    // The cap, stated as two numbers rather than as "more below". A reader who
    // cannot see how much is held back cannot tell a short list from a filtered
    // one, and those mean opposite things about the catalogue.
    showingOf: "Showing {shown} of {total}",
    showMore: "Show more",
    showAll: "Show all {total}",
    // The rail. Its summary has to say two things at once — that there is more
    // behind it, and whether anything behind it is currently doing something —
    // because a collapsed control that is silently filtering the page is the
    // one failure a disclosure can introduce that a dropdown cannot.
    refine: "Refine",
    refineActive: "{n} active",
    refineNone: "Topic · interface · order",
    activeFilters: "Filtering by",
    removeFilter: "Remove",
    clearAll: "Clear all",
    view: "View",
    gateExpand: "Expand into basic gates",
    gateCollapse: "Collapse to single gate",
    gateAtomic: "Basic gate",
    gateDecomposition: "Decomposition",
    gateListLabel: "Gates",
    gateDetailHint: "Select a gate to see its circuit and decomposition.",
    variants: "Variants",
    variantOf: "variants",
    widths: "Widths",
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
    // `circuitOnlyHint` was here and is deleted. It was the one place on any
    // public Atlas surface where a number was **typed** into a translated
    // sentence rather than counted — "163 of the published entries" — correct
    // only for as long as the then-283 minus 120 stayed 163, with nothing
    // failing when it drifted. That is exactly the failure the counting rule
    // exists to prevent.
    //
    // It is deleted rather than rewritten because **nothing rendered it**: the
    // key had no reader. `copy.circuitOnly` (the toggle's own label) is used at
    // :1127 and :1374; this hint was used nowhere, so it was a stale fact with
    // no surface, which is the worst of both. The claim it made — that a record
    // with no gate sequence has nothing to measure — is still made where a
    // reader meets it, in `structureUnrankedBody` below, rendered at :1625.
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
    topic: "トピック",
    allTopics: "すべてのトピック",
    stance: "入力 / 出力",
    allStances: "すべてのインターフェース",
    stanceGroupPipeline: "パイプラインの段",
    stanceGroupNot: "段ではないもの",
    // NOT 「うち」. That word scopes {met} inside {n}, and since §3.6 the two
    // counts are drawn from different sets: {n} is `declaresPort` (ports only)
    // while {met} is `connectedCount`, which counts declared holes too — and a
    // hole is on the graph without declaring a port. The English joins the
    // clauses with a middle dot and asserts no such containment; this now
    // matches. Second time this locale has claimed a relationship the data does
    // not have (the first was the unknown-verdict caption in 92dc87cb), so the
    // rule is in NEXT.md: render `ja` before calling a UI change verified.
    stanceConnectable: "{total}件中{n}件がポートを宣言・{met}件が他と接続",
    stance_source: "状態を準備",
    stance_transform: "レジスタ入力・レジスタ出力",
    stance_program: "測定まで含む完結したプログラム",
    "stance_declared-hole": "欠落を出典付きで明示",
    stance_observable: "オブザーバブル",
    stance_undeclared: "インターフェース未宣言",
    facet_role: "種別",
    facet_method: "手法",
    facet_domain: "問題領域",
    facetDomainCount: "{total}件中{n}件",
    entry: "件",
    entries: "件",
    countFolded: "{rows}件 · レコード{records}件（サイズ違いのバリアントを統合）",
    countFoldedTitle:
      "同じ回路のサイズ違い・厳選されたバリアントは1件にまとめています。各バリアントは個別のページとして残り、対応する量子ビット数はカードに表示されます。",
    showingOf: "{total}件中{shown}件を表示",
    showMore: "さらに表示",
    showAll: "全{total}件を表示",
    refine: "絞り込み",
    refineActive: "{n}件適用中",
    refineNone: "トピック・入出力・並び順",
    activeFilters: "適用中の条件",
    removeFilter: "解除",
    clearAll: "すべて解除",
    view: "詳細",
    gateExpand: "基本ゲートに展開",
    gateCollapse: "元のゲート表示に戻す",
    gateAtomic: "基本ゲート",
    gateDecomposition: "分解",
    gateListLabel: "ゲート",
    gateDetailHint: "ゲートを選ぶと回路と分解が表示されます。",
    variants: "別の構成",
    variantOf: "構成違い",
    widths: "量子ビット数",
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
    // `circuitOnlyHint` deleted with its English twin — see the note there.
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
 * Which copy key names each order.
 *
 * The nine orders and their labels used to be paired only by the JSX writing
 * them out one `<option>` at a time. The rail needs the same pairing in two
 * more places — an option in the list and a chip when it is active — so a third
 * hand-written copy is exactly the drift this codebase keeps finding. Typed as
 * a total `Record<BrowseOrder, …>`, so an order added without a label is a
 * compile error rather than a blank chip.
 */
const ORDER_COPY_KEY = {
  catalog: "sortDefault",
  "cost-asc": "sortCost",
  "cost-desc": "sortCostDesc",
  "qubits-asc": "sortQubits",
  "qubits-desc": "sortQubitsDesc",
  "depth-asc": "sortDepth",
  "depth-desc": "sortDepthDesc",
  "two-qubit-asc": "sortTwoQubit",
  "two-qubit-desc": "sortTwoQubitDesc",
} as const satisfies Record<BrowseOrder, keyof (typeof COPY)["en"]>;

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

/**
 * How long to hold a keystroke before the search box turns into a request
 * (ai-ops 105). Every other control on this rail navigates on the click that
 * changes it, because a click is already the reader saying "now" — but typing
 * is a sequence of them, and firing a server round trip per keystroke would
 * turn "grover" into six requests for one search. 300ms is short enough that
 * a reader who stops to read the results never notices the wait, and long
 * enough that ordinary typing speed does not queue a request per letter.
 */
const SEARCH_DEBOUNCE_MS = 300;

export function RepositoryBrowser({
  locale,
  legend,
  params,
  view,
}: {
  locale: PublicLocale;
  legend?: ReactNode;
  /**
   * The resolved `?topic=`/`?fits=`/`?category=`/`?gate=`/`?q=`/`?order=`
   * `?circuit=`/`?rows=` — the server's read of the URL, and since ai-ops 105
   * the only source of truth for every filter except the search box's own
   * buffered keystrokes (see `query` state below). A control that used to
   * call `setState` now builds the href this same shape would resolve to and
   * navigates there — see `navigate()`.
   */
  params: ResolvedBrowseParams;
  /**
   * The server's answer for THIS set of params: already filtered, ordered,
   * folded and capped, plus the corpus-wide facet counts — built once per
   * request by `buildRepositoryBrowseView` (`lib/repository/browse-view.ts`).
   * Nothing in this component re-derives any of that; it only renders it.
   */
  view: RepositoryBrowseView;
}) {
  const copy = COPY[locale];
  const router = useRouter();
  // Every filter now costs a real request where it used to cost nothing — a
  // re-slice of an array already in memory. `isPending` is what stops that
  // from reading as broken rather than as a wait: `aria-busy` below dims the
  // list a click or a debounced keystroke just asked the server to replace,
  // so a slow network shows a page that is visibly working rather than a
  // page that looks like the click did nothing.
  const [isPending, startTransition] = useTransition();

  /**
   * Every control that used to call `setState` now calls this instead.
   *
   * `replace`, not `push` — the same choice `syncUrl`'s `history.replaceState`
   * made before ai-ops 105, and for the reason stated at the search box: a
   * search is not twelve history entries, and neither is a chain of "show
   * more" presses. `{ scroll: false }` keeps the reader's scroll position
   * across a filter change, which is what let "show more" grow the list in
   * place rather than jumping the page — the one piece of the old client-only
   * behaviour worth preserving deliberately rather than as an accident of
   * local state.
   *
   * Wrapped in `startTransition` so React treats the resulting render as
   * interruptible and low-priority: the input stays responsive to the very
   * next keystroke instead of queuing behind the render this navigation
   * produces, and `isPending` becomes available for the busy state above.
   */
  function navigate(href: string) {
    startTransition(() => {
      router.replace(href, { scroll: false });
    });
  }

  // Sign-in state, resolved client-side rather than passed as a prop from the
  // server component — the same move `AuthStatus` makes for the header, and
  // for the same reason. `/repository` used to call `getMajoranaAuth()` on the
  // server to decide what every "Add to Studio" button offers, which reaches a
  // Dynamic API and made the whole route uncacheable; see
  // `lib/routed-paths.ts` for the caching side of this and `AuthStatus` for the
  // header's version of the same fix.
  //
  // One fetch here, not one per rendered card — every `RepositoryExportAction`
  // instance reads this same state rather than each calling
  // `/api/auth/session` itself. Starts in the signed-out state the server
  // already rendered, so hydration has nothing to reconcile, then corrects
  // itself once mounted if the visitor turns out to be signed in — an export
  // button that was already open when the real answer lands stays open; only
  // its enabled behaviour (export vs. sign-in prompt) changes under it.
  const [session, setSession] = useState<{ signedIn: boolean; signInHref: string | null } | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/session", { credentials: "include" })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { signedIn: boolean; signInHref: string | null } | null) => {
        if (!cancelled && data) setSession(data);
      })
      .catch(() => {
        // Left in the default signed-out state — the same thing the server
        // rendered, so a network hiccup here is silent, not broken.
      });
    return () => {
      cancelled = true;
    };
  }, []);
  const isSignedIn = session?.signedIn ?? false;
  const signInHref = session?.signInHref ?? "/auth/sign-in";

  /**
   * The search box's own buffered text (ai-ops 105).
   *
   * Every other filter on this page is read straight off `params` — there is
   * no local copy to go stale, because every change to it is a navigation and
   * a navigation is what produces a new `params`. Typing is the one exception:
   * the box has to show every keystroke immediately, and debouncing the
   * NAVIGATION (not the state update) is what keeps typing "grover" from
   * firing six requests while still letting the box feel instant. Synced back
   * to `params.query` on every render where it changed — a chip or the clear-
   * all link can change the query without this box ever being touched, and
   * this is what keeps the box from showing stale text after that happens.
   */
  const [query, setQuery] = useState(params.query);
  useEffect(() => {
    setQuery(params.query);
  }, [params.query]);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    },
    [],
  );

  const [starredSlugs, setStarredSlugs] = useState<Set<string>>(new Set());
  // Gate whose circuit is currently showing its basic-gate decomposition.
  const [expandedGates, setExpandedGates] = useState<Set<string>>(new Set());
  // Gate master/detail: the gate shown in the right-hand pane.
  //
  // Local state, not a navigation, and deliberately still: `view.gateEntries`
  // arrives whole and unpaginated whenever `?category=gates` is active (see
  // `browse-view.ts` — the gates view is exempt from the row cap for exactly
  // this reason), so every gate's full record is already on the page and
  // switching among them needs nothing from the network. Seeded from
  // `?gate=` so the gates section is deep-linkable at the gate as well as at
  // the section; the effect below keeps it valid as `view.gateEntries`
  // changes under it (a category switch, a filter that drops the selection).
  const [selectedGate, setSelectedGate] = useState<string | null>(params.gate);
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

  /**
   * slug -> its cost row, for the rows THIS response actually sent.
   *
   * `view.estimates` already carries only the slugs on the page — see
   * `trimEstimatesToSentSlugs` in `browse-view.ts` — so this index is small by
   * construction rather than by a second filter here.
   */
  const costBySlug = useMemo(() => {
    const index = new Map<string, RepositoryEstimateSummary>();
    for (const row of view.estimates?.estimates ?? []) index.set(row.slug, row);
    return index;
  }, [view.estimates]);

  // Keep the selected gate valid as the server's answer changes under it: a
  // category switch, a filter that drops the previously-selected gate out of
  // `view.gateEntries`, or the very first render. Default to the first entry,
  // and reset if the current selection is no longer among them.
  useEffect(() => {
    if (params.category !== "gates") return;
    if (!view.gateEntries.length) {
      setSelectedGate(null);
      return;
    }
    setSelectedGate((current) =>
      current && view.gateEntries.some((entry) => entry.slug === current) ? current : view.gateEntries[0].slug,
    );
  }, [params.category, view.gateEntries]);

  /**
   * Reset every filter and navigate to the plain result.
   *
   * Shared by the empty state's "Clear filters" button and the facet rail's
   * "Clear all" link, which is a small behavioural clarification over the two
   * separate implementations this replaces: one used to leave `order` alone
   * and the other used to leave `category` alone, an asymmetry that was an
   * artifact of mixing local `setState` with a manually-synced URL rather
   * than a decision anybody made. Under real navigation there is one obvious
   * meaning for "clear everything", and this is it.
   */
  function resetAllFilters() {
    setQuery("");
    navigate(browseHref({ category: "all", topic: "", stance: "", query: "", order: "catalog", circuitOnly: false }));
  }

  function toggleGateExpansion(slug: string) {
    setExpandedGates((current) => {
      const next = new Set(current);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  }

  /**
   * Which member's card a folded row shows.
   *
   * A reader's own pick always wins. Absent one it depends on whether the list
   * is *ranked*, and the two cases are genuinely different:
   *
   * **Under a ranking** the row opens on the member that placed it — the first
   * of its members in the current order, which under "deepest first" is the
   * deepest and under "shallowest first" the shallowest. Showing `members[0]`
   * there would rank a row by its 16-qubit circuit and then describe its
   * 2-qubit one, the defect `renderCostChip` already refuses to commit for
   * cost: displaying one number while sorting on another is worse than either.
   *
   * **When nothing earned the position** the canonical member is the better
   * default — the smallest width for a family, the primary slug for a curated
   * cluster, which is `members[0]` in both. It matters because catalog order is
   * not width order: the corpus lists `-12q` before `-16q` before `-2q`, so
   * deferring to placement there would open every benchmark on its 12-qubit
   * member for no reason a reader could see, and would silently change which
   * record the two curated clusters have opened on since they shipped.
   *
   * `ranked` is passed in rather than read off `order` here, because the
   * "Not ranked" section is the case that gets it wrong: those are precisely
   * the entries the ordering *excluded*, so their `placedBy` is not a ranking
   * result even when a ranking is active. Every call site states its own
   * answer; there is no default to be silently wrong.
   */
  function activeMember(
    row: Extract<BrowseRow, { kind: "group" }>,
    ranked: boolean,
  ): PublicRepositoryListEntry {
    const chosen = variantActive[row.group.key];
    const picked = row.members.find((member) => member.slug === chosen);
    if (picked) return picked;
    if (!ranked) return row.members[0];
    return row.members.find((member) => member.slug === row.placedBy) ?? row.members[0];
  }

  /** Whether the list currently ranks on a number at all. */
  const listIsRanked = (view.orderAvailable ? params.order : "catalog") !== "catalog";

  /**
   * One card's cost, in as few characters as a card can carry.
   *
   * Renders nothing at all for an entry with no circuit: most published records
   * are literature and operator entries (163 of the then-283, measured
   * 2026-07), and a "no circuit"
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

  function renderRow(row: BrowseRow, ranked: boolean) {
    if (row.kind === "single") return <Fragment key={row.entry.slug}>{renderRepoCard(row.entry)}</Fragment>;
    const active = activeMember(row, ranked);
    // A small variant switcher sits above the active member's card; picking a
    // pill swaps which sibling record the card shows.
    //
    // These are anchors rather than buttons on purpose. Folding a group emits ONE
    // card, so only the active member got a real /repository/<slug> link — the
    // inactive sibling had no crawlable entry point anywhere on the site (this is
    // why the corpus looked like "281 of the then-283" — the then-283 records,
    // two folded pairs, 281 rows, measured 2026-07 — working as designed, but
    // two slugs were unreachable by link). Giving
    // every member an href restores that without changing the curated UX: a plain
    // left-click still swaps in place, while crawlers, middle-click, and no-JS
    // visitors follow the href to the record's own page.
    const switcher = (
      <div className="mj-repo-variant-switch" role="group" aria-label={locale === "ja" ? row.group.labelJa : row.group.label}>
        {/* "Widths" for a width family, "Variants" for a curated cluster. The
            pills below read "2 q … 16 q" in the first case, and the switcher
            labelled "Variants" over a row of bare widths reads as though the
            eight were eight different circuits — which is the belief R2.6
            exists to correct. */}
        <span className="mj-repo-variant-label">
          {row.group.memberLabels ? copy.widths : copy.variants}
        </span>
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
            {row.group.memberLabels?.[member.slug] ?? (locale === "ja" ? member.titleJa : member.title)}
          </a>
        ))}
      </div>
    );
    return <Fragment key={row.group.key}>{renderRepoCard(active, switcher)}</Fragment>;
  }

  // Fall back to the first gate so the detail pane is populated on the very
  // first render (before the selection effect runs / without JS), and keep the
  // sidebar highlight in sync with whatever is actually shown.
  const selectedGateEntry = view.gateEntries.find((entry) => entry.slug === selectedGate) ?? view.gateEntries[0] ?? null;
  const activeGateSlug = selectedGateEntry?.slug ?? null;

  /**
   * The URL of this view, with `overrides` applied.
   *
   * Every filter has a param, so this can build the *whole* address rather
   * than a link that quietly drops the reader's search on the way to a longer
   * list. Built from `params` (the server's resolved read of the current URL)
   * plus the search box's own buffered text — using `params.query` here
   * instead would drop whatever the reader just typed for every OTHER
   * control's href until the debounced navigation caught up.
   *
   * Defaults are omitted, so the common address stays `/repository` rather than
   * `/repository?q=&order=catalog&circuit=0&rows=24` — one canonical URL for
   * the default view, which is what a crawler and a share link both want.
   */
  function browseHref(overrides: {
    category?: "all" | PublicRepositoryCategory;
    topic?: TopicId | "";
    stance?: InterfaceStance | "";
    query?: string;
    order?: BrowseOrder;
    circuitOnly?: boolean;
    rows?: RowLimit;
    gate?: string | null;
  } = {}): string {
    const next = {
      category: params.category,
      topic: params.topic,
      stance: params.stance,
      query,
      order: params.order,
      circuitOnly: params.circuitOnly,
      rows: params.rows,
      gate: selectedGate,
      ...overrides,
    };
    const urlParams = new URLSearchParams();
    if (next.category !== "all") urlParams.set("category", next.category);
    if (next.topic) urlParams.set("topic", next.topic);
    if (next.stance) urlParams.set("fits", next.stance);
    if (next.query) urlParams.set("q", next.query);
    if (next.order !== "catalog") urlParams.set("order", next.order);
    if (next.circuitOnly) urlParams.set("circuit", "1");
    if (next.rows !== DEFAULT_ROW_LIMIT) urlParams.set("rows", String(next.rows));
    // Only where it means something. `?gate=` selects within the gates view and
    // is inert everywhere else, so carrying it onto an algorithms link would
    // put a param in the URL that the page cannot act on.
    if (next.category === "gates" && next.gate) urlParams.set("gate", next.gate);
    const search = urlParams.toString();
    return search ? `/repository?${search}` : "/repository";
  }

  // ---------------------------------------------------------------------------
  // The facet rail (s91) — OWNER_TODO §4b, "one facet rail instead of three
  // dropdowns; counts and current state without a page of chrome".
  //
  // What it replaces: `Topic`, `Takes / returns` and `Order by` as three
  // `<select>`s, plus a `circuit only` checkbox, standing permanently across
  // the top of the page. The owner's words were "terribly hard to navigate and
  // not minimalist enough from the get-go", and the controls were the part of
  // that complaint this page could actually answer.
  //
  // **Three properties a `<select>` could not have, and they are the argument:**
  //
  // 1. **Every option is a URL.** A `<select>` option is not addressable, not
  //    crawlable, and does not exist for a reader without JS. Forty topics were
  //    reachable only by hydrating and clicking. As links they are forty
  //    addresses — the same correction §0.5.1 made for `?category=` and s91
  //    made for `?q=`/`?order=`.
  // 2. **Current state survives collapse.** A closed dropdown showing
  //    "Optimization" is one glance; a rail that is closed still shows its
  //    active filters as chips, each with the URL that removes it. This is the
  //    one hazard a disclosure introduces that a dropdown does not — a
  //    collapsed control silently filtering the page — and the chips are the
  //    answer to it, not decoration.
  // 3. **The whole vocabulary is legible at once.** A `<select>` shows one
  //    option; opening the rail shows every option with its count, grouped, so
  //    a reader can see that "Optimization" is 10 of 176 before spending a
  //    click on it.
  //
  // **Counts stay global** — over the whole corpus, not over what the other
  // filters have left. That was decided deliberately before this rail existed
  // ("a count that moves while you are reading it is not a count, it is a
  // hint") and this change does not reverse it — see `view.facets` and
  // `browse-view.ts`'s header for where that now happens (server-side, over
  // the full corpus, every request). The tension is real and is worth the
  // owner's steer rather than a quiet flip: co-filtered counts would predict
  // the click, and stable counts describe the catalogue. Raised in OWNER_TODO
  // rather than settled here.
  // ---------------------------------------------------------------------------

  /**
   * The filters currently narrowing the list, each with the URL that drops it.
   *
   * Every entry here is just a chip and an href now — before ai-ops 105 each
   * one also carried a client `setState` call the href's navigation had to
   * agree with, and the two had to be kept in sync by hand. A real navigation
   * makes that agreement structural: the href IS the whole next state.
   */
  const activeFilters: Array<{ key: string; label: string; href: string }> = [];
  if (params.topic) {
    const option = TOPICS_BY_ID.get(params.topic);
    activeFilters.push({
      key: `topic:${params.topic}`,
      label: option ? (locale === "ja" ? option.labelJa : option.label) : params.topic,
      href: browseHref({ topic: "" }),
    });
  }
  if (params.stance) {
    activeFilters.push({
      key: `stance:${params.stance}`,
      label: copy[`stance_${params.stance}`],
      href: browseHref({ stance: "" }),
    });
  }
  // Only when the ordering is actually applied. An `?order=` the data cannot
  // supply is downgraded to `catalog` further up, and a chip claiming a sort
  // that is not in effect is worse than no chip.
  if (params.order !== "catalog" && view.orderAvailable) {
    activeFilters.push({
      key: `order:${params.order}`,
      label: copy[ORDER_COPY_KEY[params.order]],
      href: browseHref({ order: "catalog" }),
    });
  }
  if (params.circuitOnly && view.canOrderByStructure) {
    activeFilters.push({
      key: "circuit",
      label: copy.circuitOnly,
      href: browseHref({ circuitOnly: false }),
    });
  }

  /**
   * One option in the rail: a link, unless it is the one already chosen.
   *
   * The current option renders as a `<span>` rather than a link to itself. A
   * link whose destination is the page you are on is a control that looks
   * operable and does nothing, and `aria-current` on an anchor still leaves it
   * in the tab order as a dead stop.
   */
  function facetOption(args: {
    key: string;
    label: string;
    count?: number;
    active: boolean;
    href: string;
  }) {
    const body = (
      <>
        <span className="mj-facet-option-label">{args.label}</span>
        {args.count !== undefined ? (
          <span className="mj-facet-option-count">{args.count}</span>
        ) : null}
      </>
    );
    if (args.active) {
      return (
        <span className="mj-facet-option is-active" key={args.key} aria-current="true">
          {body}
        </span>
      );
    }
    return (
      <a
        className="mj-facet-option"
        key={args.key}
        href={args.href}
        onClick={(event) => {
          // Modified clicks keep their meaning: the href is a real destination.
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) {
            return;
          }
          event.preventDefault();
          navigate(args.href);
        }}
      >
        {body}
      </a>
    );
  }

  function FacetRail() {
    return (
      <div className="mj-facet-rail">
        {/* Always visible, open or closed. See property 2 above. */}
        {activeFilters.length ? (
          <div className="mj-facet-active" aria-label={copy.activeFilters}>
            <span className="mj-facet-active-label">{copy.activeFilters}</span>
            {activeFilters.map((filter) => (
              <a
                className="mj-facet-chip"
                key={filter.key}
                href={filter.href}
                title={`${copy.removeFilter}: ${filter.label}`}
                onClick={(event) => {
                  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) {
                    return;
                  }
                  event.preventDefault();
                  navigate(filter.href);
                }}
              >
                <span>{filter.label}</span>
                <span aria-hidden="true">×</span>
              </a>
            ))}
            <a
              className="mj-text-link mj-facet-clear"
              href={browseHref({ category: "all", topic: "", stance: "", query: "", order: "catalog", circuitOnly: false })}
              onClick={(event) => {
                if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) {
                  return;
                }
                event.preventDefault();
                resetAllFilters();
              }}
            >
              {copy.clearAll}
            </a>
          </div>
        ) : null}

        {/* A native <details>, so opening the rail needs no JavaScript and no
            state. Its open-ness is deliberately NOT a URL param: the params on
            this route address the *data* a reader is looking at, and whether a
            control panel happens to be unfolded is not that. The chips above
            carry the part of this that is data. */}
        <details className="mj-facet-disclosure">
          <summary>
            <span className="mj-facet-summary-label">{copy.refine}</span>
            <span className="mj-facet-summary-state">
              {activeFilters.length
                ? copy.refineActive.replace("{n}", String(activeFilters.length))
                : copy.refineNone}
            </span>
          </summary>
          <div className="mj-facet-groups">
            {/* Topic, by facet. The domain heading carries how much of the
                corpus is domain-tagged at all, because a domain list read
                without that number looks like a taxonomy of the catalogue
                rather than of a slice of it. */}
            {view.facets.topicGroups.map((group, groupIndex) => (
              <section className="mj-facet-group" key={group.facet}>
                <h4>
                  {copy[`facet_${group.facet}`]}
                  {group.facet === "domain" ? (
                    <span className="mj-facet-group-note">
                      {copy.facetDomainCount
                        .replace("{n}", String(view.facets.entriesWithDomain))
                        .replace("{total}", String(view.facets.totalEntries))}
                    </span>
                  ) : null}
                </h4>
                <div className="mj-facet-options">
                  {/* Once, in the first group — not once per facet. The three
                      facets are three views of ONE selection, so three "All
                      topics" rows would read as three separate filters to
                      clear, and clearing any one of them clears all three. */}
                  {groupIndex === 0
                    ? facetOption({
                        key: "topic-all",
                        label: copy.allTopics,
                        active: params.topic === "",
                        href: browseHref({ topic: "" }),
                      })
                    : null}
                  {group.options.map((option) =>
                    facetOption({
                      key: option.id,
                      // `option.label` rather than `topicOptionLabel`, which
                      // bakes the count into the string for a `<select>` that
                      // can only hold text. The rail has a slot for the number,
                      // so putting it in the label too would print it twice.
                      label: option.label,
                      count: option.count,
                      active: params.topic === option.id,
                      href: browseHref({ topic: option.id }),
                    }),
                  )}
                </div>
              </section>
            ))}

            {/* Takes / returns. Two groups, and the second is the complement of
                the first rather than a second list — a stance in neither would
                vanish from the control entirely, which is invisible. */}
            {(["pipeline", "not"] as const).map((group) => {
              const inGroup = view.facets.stanceOptions.filter(
                (option) => PIPELINE_STANCES.has(option.stance) === (group === "pipeline"),
              );
              if (inGroup.length === 0) return null;
              return (
                <section className="mj-facet-group" key={`stance-${group}`}>
                  <h4>
                    {group === "pipeline" ? copy.stanceGroupPipeline : copy.stanceGroupNot}
                    {group === "pipeline" ? (
                      <span className="mj-facet-group-note">
                        {copy.stanceConnectable
                          .replace("{n}", String(view.facets.connectableEntries))
                          .replace("{total}", String(view.facets.totalEntries))
                          .replace("{met}", String(view.facets.meetingEntries))}
                      </span>
                    ) : null}
                  </h4>
                  <div className="mj-facet-options">
                    {group === "pipeline"
                      ? facetOption({
                          key: "stance-any",
                          label: copy.allStances,
                          active: params.stance === "",
                          href: browseHref({ stance: "" }),
                        })
                      : null}
                    {inGroup.map((option) =>
                      facetOption({
                        key: option.stance,
                        label: copy[`stance_${option.stance}`],
                        count: option.count,
                        active: params.stance === option.stance,
                        href: browseHref({ stance: option.stance }),
                      }),
                    )}
                  </div>
                </section>
              );
            })}

            {/* Order, and the circuit-only filter beside it because both read
                the derived listings and both disappear together when the
                catalog API is off. An ordering option that ranks nothing is
                worse than an absent one: it looks like the corpus has no
                structure rather than like the API is off. */}
            {view.canOrderByCost || view.canOrderByStructure ? (
              <section className="mj-facet-group" key="order">
                <h4>{copy.sort}</h4>
                <div className="mj-facet-options">
                  {facetOption({
                    key: "catalog",
                    label: copy.sortDefault,
                    active: params.order === "catalog",
                    href: browseHref({ order: "catalog" }),
                  })}
                  {(view.canOrderByCost ? (["cost-asc", "cost-desc"] as const) : []).map((value) =>
                    facetOption({
                      key: value,
                      label: copy[ORDER_COPY_KEY[value]],
                      active: params.order === value,
                      href: browseHref({ order: value }),
                    }),
                  )}
                  {(view.canOrderByStructure ? PROFILE_ORDERS : []).map((value) =>
                    facetOption({
                      key: value,
                      label: copy[ORDER_COPY_KEY[value]],
                      active: params.order === value,
                      href: browseHref({ order: value }),
                    }),
                  )}
                  {view.canOrderByStructure
                    ? facetOption({
                        key: "circuit-only",
                        label: copy.circuitOnly,
                        active: params.circuitOnly,
                        href: browseHref({ circuitOnly: !params.circuitOnly }),
                      })
                    : null}
                </div>
              </section>
            ) : null}
          </div>
        </details>
      </div>
    );
  }

  return (
    <div className="mj-repository-browser" aria-busy={isPending || undefined}>
      <div className="mj-repository-controls">
        <label>
          <span>{copy.search}</span>
          {/* The address follows the box, on a short delay rather than every
              keystroke (see `SEARCH_DEBOUNCE_MS`) — since ai-ops 105 this is a
              real request, not a client-side re-filter of an array already in
              memory. A reader who types "grover", finds what they wanted and
              copies the URL gets the filtered Atlas, because `?q=` is written
              on the way out as well as read on the way in. `replace`, so a
              search is not twelve history entries and Back still leaves the
              page. */}
          <input
            value={query}
            onChange={(event) => {
              const next = event.target.value;
              setQuery(next);
              if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
              searchDebounceRef.current = setTimeout(() => {
                navigate(browseHref({ query: next }));
              }, SEARCH_DEBOUNCE_MS);
            }}
            placeholder={copy.placeholder}
            type="search"
          />
        </label>
        {/* The `Algorithm family` and `Framework` selects stood here until s81.
            Both were removed rather than restyled, and both removals were
            measured against the corpus first (roadmap §0.3):

            `algorithmFamily` was 57 free-text values, **33 of them worn by
            exactly one entry** — a search box implemented as a dropdown.
            (Measured at s81 over the then-283 entries; the shape is what decided
            it, and the corpus has grown since without anyone re-counting.)
            `role` + `method` now cover it by rule, as supersets: 49
            of the 57 families share a single role+method signature. The 8 that
            scatter, and the 12 signatures that cover more than one family, are
            why the fallback matters — and the fallback is exact. The search
            input above already indexes `algorithmFamily`, and typing a family's
            name **never misses one of its own members** (0 of 57 lossy; 47
            return the family exactly, 10 a benign superset). Nothing became
            unreachable. The value is still on every card, and the algorithm
            view still groups by it.

            `framework` looked like a filter and was not one. Its eight options
            produce **five distinct result sets** — CUDA-Q, Amazon Braket,
            PyQuil and Qmod selected the identical 153 entries — and even the most
            selective option kept **more than two thirds of the catalogue** (191 of
            the then-283 at s81). A control that removes a third of the rows at its
            most aggressive setting is not a filter. It asks "can I export this
            to Cirq", which is a question about an entry already found; the
            entry page's export section answers it per record. `entry.framework`
            stays in the search haystack, so the placeholder still holds. */}
        {/* Everything that was three <select>s and a checkbox (s91). Every
            option still carries its count: "Optimization (10)" cannot be read
            as a promise the way a bare "Optimization" can, and on this corpus
            that matters — those ten are eight width-scaled MaxCut ring
            benchmarks. */}
        <FacetRail />
      </div>

      {/* The assumption set is stated wherever the ordering it justifies is
          offered — not tucked into a detail page. An ordered list whose basis
          for ordering is somewhere else is the failure mode this whole feature
          exists to avoid. */}
      {view.canOrderByCost && params.order !== "catalog" && !isProfileOrder(params.order) && view.estimates ? (
        <p className="mj-repository-cost-basis">
          <span>{copy.costUnder}</span> <code>{view.estimates.assumptions.identity}</code>
          <span className="mj-repository-cost-basis-note">{copy.costUnderNote}</span>
        </p>
      ) : null}

      {/* Anchors that also behave as buttons, and both halves are load-bearing.
          The `href` is what makes each category a **section** rather than a
          view: it is a URL to link, share, bookmark and crawl, and it is the
          only way a reader without JS reaches the gates sidebar at all — before
          this the whole surface lived behind an onClick. Since ai-ops 105 the
          hydrated click also has to reach the server — switching categories
          used to be a free client-side reslice of an array that already held
          everything, and now `view.gateEntries` / `view.algorithmGroups` /
          `view.shownListRows` only carry the ACTIVE category's rows, so there
          is no longer a "the rest of it" already sitting in memory to switch
          to. */}
      <nav className="mj-repository-category-nav" aria-label={locale === "ja" ? "カテゴリ" : "Categories"}>
        {PUBLIC_REPOSITORY_CATEGORIES.map((option) => (
          <a
            className={params.category === option.value ? "is-active" : ""}
            key={option.value}
            href={option.value === "all" ? "/repository" : `/repository?category=${option.value}`}
            aria-current={params.category === option.value ? "page" : undefined}
            title={locale === "ja" ? option.labelJa : option.label}
            onClick={(event) => {
              // Leave modified clicks alone — a middle-click or ⌘-click means
              // "open this somewhere else", and it now has somewhere to go.
              if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) {
                return;
              }
              event.preventDefault();
              navigate(browseHref({ category: option.value }));
            }}
          >
            {locale === "ja" ? option.labelJa : option.label}
          </a>
        ))}
      </nav>

      {legend}

      {/* Two numbers only when they differ. On a filtered view that folded
          nothing — a single width, or a category with no families in it — the
          second clause would be "176 entries · 176 records", which is noise
          that teaches a reader the two can disagree at exactly the moment they
          do not. */}
      <p
        className="mj-repository-result-count"
        aria-live="polite"
        title={view.shownRowCount !== view.structureFilteredCount ? copy.countFoldedTitle : undefined}
      >
        {view.shownRowCount !== view.structureFilteredCount
          ? copy.countFolded
              .replace("{rows}", String(view.shownRowCount))
              .replace("{records}", String(view.structureFilteredCount))
          : locale === "ja"
            ? `${view.structureFilteredCount}${copy.entries}`
            : `${view.structureFilteredCount} public ${view.structureFilteredCount === 1 ? copy.entry : copy.entries}`}
      </p>
      <p className="mj-repository-star-note">{copy.starNote}</p>

      {!view.structureFilteredCount ? (
        <div className="mj-repository-empty">
          <h3>{copy.emptyTitle}</h3>
          <p>{copy.emptyBody}</p>
          <button type="button" onClick={resetAllFilters}>{copy.clear}</button>
        </div>
      ) : params.category === "gates" ? (
        // Master/detail: a thin sidebar of every gate, the selected one opened
        // in the large pane on the right (Owner Inbox 2026-07-19).
        <div className="mj-gate-master">
          <nav className="mj-gate-sidebar" aria-label={copy.gateListLabel}>
            {/* Links, on the same terms as the category strip above and for a
                sharper version of the same reason. As buttons, 28 of the 29
                gates existed only after a click: no crawler saw them, no reader
                without JS could open one, and there was no way to send somebody
                a particular gate. The href is the exact view the click produces,
                so the two paths cannot drift into showing different things.
                Unlike the category strip, this click stays purely local — see
                the `selectedGate` state comment above for why every gate's
                record is already on the page. */}
            {view.gateEntries.map((entry) => (
              <a
                key={entry.slug}
                href={`/repository?category=gates&gate=${encodeURIComponent(entry.slug)}`}
                className={entry.slug === activeGateSlug ? "is-active" : ""}
                aria-current={entry.slug === activeGateSlug ? "true" : undefined}
                onClick={(event) => {
                  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) {
                    return;
                  }
                  event.preventDefault();
                  setSelectedGate(entry.slug);
                }}
              >
                <span>{locale === "ja" ? entry.titleJa : entry.title}</span>
                <span className="mj-gate-sidebar-family">{familyLabel(entry.algorithmFamily, locale)}</span>
              </a>
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
      ) : params.category === "algorithms" ? (
        // Algorithms grouped into clickable disclosure groups by family.
        <div className="mj-repo-groups">
          {view.algorithmGroups.map((group, index) => (
            <details className="mj-repo-group" key={group.familyKey} open={index === 0}>
              <summary>
                <span>{familyLabel(group.familyKey, locale)}</span>
                <span className="mj-repo-group-count">{group.rows.length}</span>
              </summary>
              <div className="mj-repo-list">{group.rows.map((row) => renderRow(row, listIsRanked))}</div>
            </details>
          ))}
        </div>
      ) : (
        <div className="mj-repo-list">{view.shownListRows.map((row) => renderRow(row, listIsRanked))}</div>
      )}

      {/* Entries the ordering had to leave out, kept visible and kept out of
          the ranking. An unknown cost is not a low cost, and a list that
          silently dropped these would read as though the catalog were smaller
          than it is. */}
      {/* The heading counts the entries the ORDERING held back, not the ones on
          screen. Those are different questions and the section exists to answer
          the first: "an unknown cost is not a low cost" is a statement about the
          ranking, true whether or not the cap has reached this far down. How
          many are rendered is the control below's job, and it counts both
          sections together. */}
      {view.unrankedCount && view.shownUnrankedRows.length ? (
        <section className="mj-repository-unranked">
          <h3>{copy.unrankedTitle} <span>{view.unrankedCount}</span></h3>
          <p>{isProfileOrder(params.order) ? copy.structureUnrankedBody : copy.unrankedBody}</p>
          <div className="mj-repo-list">{view.shownUnrankedRows.map((row) => renderRow(row, false))}</div>
        </section>
      ) : null}

      {/* The rest of the page, and its address.

          **Below everything the cap governs**, which is why it sits down here
          rather than between the two lists: a "show more" printed above a
          section that the cap is also cutting reads as though the section
          under it were complete.

          Two links, not one. "Show more" walks the doubling chain for a reader
          who is browsing; "show everything" is for the reader who knew from the
          first screen that they wanted the lot, and without it the cap would
          cost them three clicks it never used to.

          Real `<a href>`s. A reader with JS off follows them and the server
          renders the longer page; a hydrated click is intercepted and
          navigates — since ai-ops 105 this is a real request rather than a
          re-slice of an array already in memory, because the earlier rows
          beyond the cap were never sent in the first place. `{ scroll: false }`
          on `navigate()` is what keeps this from losing the reader's scroll
          position, which is the one piece of the old "grows in place" feel
          worth preserving on purpose. */}
      {view.nextRowLimit !== null ? (
        <div className="mj-repo-more">
          <p className="mj-repo-more-count">
            {copy.showingOf
              .replace("{shown}", String(view.shownListRows.length + view.shownUnrankedRows.length))
              .replace("{total}", String(view.cappableRowsLength))}
          </p>
          <div className="mj-repo-more-actions">
            <a
              className="mj-repo-more-link"
              href={browseHref({ rows: view.nextRowLimit })}
              onClick={(event) => {
                if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) {
                  return;
                }
                event.preventDefault();
                navigate(browseHref({ rows: view.nextRowLimit as RowLimit }));
              }}
            >
              {copy.showMore}
            </a>
            {/* Only when it says something the other link does not — when the
                next step already is everything, two controls with one
                destination is chrome, and chrome is the complaint. */}
            {view.nextRowLimit !== "all" ? (
              <a
                className="mj-text-link"
                href={browseHref({ rows: "all" })}
                onClick={(event) => {
                  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) {
                    return;
                  }
                  event.preventDefault();
                  navigate(browseHref({ rows: "all" }));
                }}
              >
                {copy.showAll.replace("{total}", String(view.cappableRowsLength))}
              </a>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
