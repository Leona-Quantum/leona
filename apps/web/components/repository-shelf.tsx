// The Ingredients shelf: the objects this catalogue holds, and how much of the
// map can reach them (ai-ops#41 option B, deliverable 3).
//
// ## The number this exists to publish
//
// > *"operators are useful for certain algorithms like VQE, QSVT, and others"*
// > — owner, ai-ops#14
//
// That sentence is the reason the corpus has 62 operator records and no way to
// tell which of them matter. The count on each row here is that sentence turned
// into a number: **how many of the map's processes consume or produce this
// object.** It is the first honest measurement of which objects are worth
// deepening and which are decoration.
//
// ## And the number it exists to publish honestly
//
// Measured 2026-08-13, over the whole corpus: **28 of 101 object records join a
// state the map names.** All 12 states do. **16 of 62 operators do. None of the
// 27 gates do**, by the owner's own ruling twice over.
//
// A shelf that listed only the 28 would read as a working join. So every record
// is listed, the unjoined ones carry the reason the map cannot reach them, and
// the section headers print both halves of the fraction. `ingredients.ts` holds
// the argument for why an abstention is a statement about the MAP rather than a
// verdict on the record — several of the unreachable ones are among the
// best-sourced things in the catalogue.
//
// ## Shut by default
//
// Three `<details>`, closed. The owner's ai-ops#45 acceptance condition is that
// the browse interface must not get extremely complicated and load times must
// not spike; a hundred-row list unfurled above the search box would breach the
// first on its own. `<details>` needs no JavaScript, so the closed state is what
// a no-JS reader and a crawler get too, and the counts in the summary line are
// the part that is legible without opening anything.
import type { PublicLocale } from "../lib/public-locale";
import type { LayerGraph } from "../lib/repository/layers";
import type { StateVocabulary } from "../lib/repository/states";
import { layerState } from "../lib/repository/states";
import {
  buildShelf,
  type AbstentionReason,
  type IngredientCandidate,
  type ObjectRole,
} from "../lib/repository/ingredients";

interface ShelfCopy {
  heading: string;
  lead: string;
  roles: Record<ObjectRole, string>;
  /** `28 of 101 reach the map` — always with its denominator. */
  reach: (joined: number, total: number) => string;
  processes: (n: number, of: number) => string;
  unreachable: string;
  reasons: Record<AbstentionReason, string>;
  none: string;
}

const COPY: Record<"en" | "ja", ShelfCopy> = {
  en: {
    heading: "Ingredients",
    lead: "The objects this catalogue holds, rather than the procedures. Each row says how many of the map's processes take or return one — which is what makes an object worth deepening.",
    roles: { state: "States", operator: "Operators", "gate-primitive": "Gates" },
    reach: (joined, total) => `${joined} of ${total} are objects the map names`,
    processes: (n, of) => (n === 1 ? `1 of ${of} processes` : `${n} of ${of} processes`),
    unreachable: "Not an object the map names, because:",
    reasons: {
      observable:
        "it is measured. The map names the operator being measured inside a process's contract, as a parameter, and a parameter is not a state",
      "hamiltonian-term":
        "it is a term of a Hamiltonian rather than a Hamiltonian, and nothing hands one to a simulator on its own",
      encoding:
        "it is a mapping between representations — a process, and one the map does not draw",
      "generator-pool":
        "it is the set an ansatz picks generators from, which its process names in prose",
      "objective-transform":
        "it recasts one question as another, and the map draws no process that performs the recast",
      "documents-a-process":
        "it documents a procedure rather than an object; the map's anchor for that is a node, not a state",
      "primitive-by-ruling":
        "it is a gate, and the owner ruled twice that gates stay off the map and keep their own section",
    },
    none: "No record in this section.",
  },
  ja: {
    heading: "材料",
    lead: "このカタログが持つのは手続きだけではありません。ここに並ぶのは対象そのものです。各行には、マップ上の工程のうちいくつがそれを受け取る、あるいは返すかを示しています。対象を掘り下げる価値があるかどうかは、この数で決まります。",
    roles: { state: "状態", operator: "演算子", "gate-primitive": "ゲート" },
    reach: (joined, total) => `${total} 件中 ${joined} 件がマップの名前を持つ対象です`,
    processes: (n, of) => `工程 ${of} 件中 ${n} 件`,
    unreachable: "マップが名前を与えている対象ではありません。理由：",
    reasons: {
      observable:
        "測定される対象だからです。測定される演算子は工程の契約の中でパラメータとして言及されており、パラメータは状態ではありません",
      "hamiltonian-term":
        "ハミルトニアンそのものではなくその項であり、単独でシミュレータに渡されることはないからです",
      encoding: "表現のあいだの写像、すなわち工程であり、しかもマップが描いていない工程だからです",
      "generator-pool": "アンサッツが生成子を選ぶ候補集合であり、工程の側が散文で言及しているからです",
      "objective-transform":
        "ある問いを別の問いへ書き換えるものであり、その書き換えを行う工程をマップは描いていないからです",
      "documents-a-process":
        "対象ではなく手続きを記述しているからです。マップ側の受け皿はノードであって状態ではありません",
      "primitive-by-ruling":
        "ゲートだからです。ゲートはマップに載せず独自の節を持つという裁定が二度示されています",
    },
    none: "この節に項目はありません。",
  },
};

/**
 * `records` is the same listing the browser already has, so the shelf costs no
 * extra request — only the classification, which is a rule table over fields
 * already in memory. That is deliberate: ai-ops#45's second acceptance
 * condition is about load time, and a section that fetched its own data would
 * have spent the budget before the browse scheme it sits above got to.
 */
export function IngredientShelf({
  records,
  graph,
  vocabulary,
  locale,
}: {
  records: readonly {
    slug: string;
    title: string;
    titleJa?: string;
    category: string;
    algorithmFamily: string;
    tags?: readonly string[];
  }[];
  graph: LayerGraph;
  vocabulary: StateVocabulary;
  locale: PublicLocale;
}) {
  const isJa = locale === "ja";
  const copy = COPY[isJa ? "ja" : "en"];
  const candidates: IngredientCandidate[] = records.map((record) => ({
    slug: record.slug,
    title: isJa ? (record.titleJa ?? record.title) : record.title,
    category: record.category,
    algorithmFamily: record.algorithmFamily,
    tags: record.tags ?? [],
  }));
  const shelf = buildShelf(candidates, graph, vocabulary);

  return (
    <section className="mj-shelf" aria-labelledby="ingredient-shelf">
      <h2 id="ingredient-shelf">{copy.heading}</h2>
      <p className="mj-shelf-lead">{copy.lead}</p>
      {shelf.sections.map((section) => (
        <details key={section.role} className="mj-shelf-section">
          <summary>
            <span className="mj-shelf-role">{copy.roles[section.role]}</span>{" "}
            {/* Both halves, always. A section headed "Operators (16)" would be
                read as sixteen operators rather than as sixteen of sixty-two,
                and the difference is the entire finding. */}
            <span className="mj-shelf-count">
              {copy.reach(section.joined, section.entries.length)}
            </span>
          </summary>
          {section.entries.length === 0 ? (
            <p>{copy.none}</p>
          ) : (
            <ul className="mj-shelf-list">
              {section.entries.map((entry) => {
                const state =
                  entry.join.kind === "joined" ? layerState(vocabulary, entry.join.state) : null;
                return (
                  <li key={entry.slug} className="mj-shelf-row" data-join={entry.join.kind}>
                    <a href={`/repository/${entry.slug}`}>{entry.title}</a>
                    {entry.join.kind === "joined" && state ? (
                      <>
                        {" "}
                        <span className="mj-shelf-processes">
                          {copy.processes(entry.processes.length, shelf.processDenominator)}
                        </span>{" "}
                        <a className="mj-shelf-state" href={`/repository/layers/${state.id}`}>
                          {isJa ? state.labelJa : state.label}
                        </a>
                      </>
                    ) : entry.join.kind === "abstained" ? (
                      <p className="mj-shelf-reason">
                        {copy.unreachable} {copy.reasons[entry.join.reason]}
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </details>
      ))}
    </section>
  );
}
