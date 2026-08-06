// The "How this connects" panel on a /repository entry.
//
// A server component, on the same terms as the profile panel beside it: it takes
// an already-derived interface and its already-computed neighbours, and renders
// them. Nothing here fetches, and nothing here classifies — see
// lib/repository/interface.ts for both.
//
// ## The shape is the message
//
// The owner asked for this as a picture: "make the left and right sides of
// entries different shapes like puzzle pieces that connect to the corresponding
// pieces that fit before and after it… people can click on either end to get a
// preview of what it can take as input and what it can take as output."
//
// The reason that visual is worth building here rather than being decoration is
// that **a flat edge carries information a chip cannot.** 60 observables and 61
// prose records have no ports at all, and 120 circuits end in a measurement that
// nothing consumes. Drawn as a piece, each of those is immediately a piece with
// a straight edge — you can see there is nothing to join before you read a word.
// Drawn as a row of labels, all 283 look equally connectable.
//
// ## What the panel must never do
//
// Round `unknown` up. It is the verdict on 408 of the 822 ordered pairs that
// meet at all, it means "the shapes fit and something unstated might not", and
// roadmap §6 is explicit that it has to render as its own thing rather than as a
// warning-coloured near-miss. So the two lists are separate, they are labelled
// differently, and the unknown one says what is unverified about it.
import type { PublicLocale } from "../lib/public-locale";
import type {
  EntryInterface,
  InterfaceNeighbours,
  InterfacePartner,
  Hole,
  Port,
} from "../lib/repository/interface";
import { isOnGraph } from "../lib/repository/interface";

/** How many partners to name before the count carries the rest. */
const NAMED_PARTNERS = 6;

const COPY = {
  en: {
    takes: "Takes",
    returns: "Returns",
    nothing: "Nothing",
    /**
     * The reading for a declared hole, and it must not be "Nothing".
     *
     * "Nothing" is a statement about the block — it takes no input. A hole is a
     * statement about the *source*: this edge exists and the paper does not say
     * what is on it. Rendering both as the same word is the collapse §3.6 exists
     * to stop, one layer down from the field that stores it.
     *
     * The width is named because the record publishes it — the register is in
     * `visualization.wires` and `connects()` compares against it. What the gap
     * withholds is the rest: whether that edge carries qubits or classical bits,
     * and what a next stage would have to assume. Saying only "not stated" would
     * hide the one thing that is.
     */
    hole: (n: number) => `${n}-wire register, not stated in the source`,
    qubits: (n: number) => `${n} ${n === 1 ? "qubit" : "qubits"}`,
    bits: (n: number) => `${n} classical ${n === 1 ? "bit" : "bits"}`,
    assumed: "assumed |0…0⟩",
    fits: "Fits before this",
    fitsAfter: "Fits after this",
    unverifiedBefore: "Shapes fit before this, composition unverified",
    unverifiedAfter: "Shapes fit after this, composition unverified",
    more: (n: number) => `and ${n} more`,
    unknownNote:
      "The widths and types line up. What is not established is everything a width does not carry — the basis convention, the normalisation, the state each was written to start from — so this is not a claim that the two compose.",
    /**
     * The note for a list produced by a declared hole, and it exists because the
     * one above is FALSE there.
     *
     * "The widths and types line up" is a claim about two published ports. A
     * hole publishes a width and withholds the type — that is what the gap
     * declaration says — so reusing the sentence above would assert agreement on
     * exactly the field §3.6 recorded as missing. A guess in the hole, written
     * in the caption rather than in the field.
     */
    holeNote:
      "Only the register widths line up. This entry's source does not state what crosses this edge, so whether it carries qubits or classical bits is unknown — along with everything a width does not carry. These are the entries a filled-in gap could connect to, not entries that connect.",
    seeAll: (n: number) => `See all ${n} →`,
    stance: {
      source:
        "Prepares a state. Nothing goes in, and what comes out is a register another stage can take.",
      transform:
        "A unitary. The same register goes in and comes out, and this entry states no assumption about what is on it — which is what lets anything of the same width feed it.",
      transformAssumed:
        "The same register goes in and comes out, but this circuit was written to run from |0…0⟩. Putting another stage in front of it is defined and is no longer the thing this entry measured.",
      program:
        "A whole program rather than a stage: it begins on |0…0⟩ and ends by measuring every qubit, so what it returns is classical bits. Nothing in this catalogue takes classical bits, so nothing follows it.",
      observable:
        "Not a stage. You measure a state with this; you do not apply it and pass a register on. It has a width and deliberately no ports.",
      undeclared:
        "This record publishes no gate sequence and no register, so there is nothing here to read an interface off. Absent rather than empty.",
      "declared-hole":
        "This record publishes no gate sequence, and unlike a bare literature entry it says so on purpose: somebody read the source and recorded which part is missing and why, with a citation — the gap is listed further down this page. The register width above is what the record does publish. What it withholds is the rest of that edge, so the entries below are candidates whose widths line up and nothing more; a block may ship with a hole, but never with a guess in the hole.",
    },
  },
  ja: {
    takes: "入力",
    returns: "出力",
    nothing: "なし",
    hole: (n: number) => `${n} 本のレジスタ・出典に記載なし`,
    qubits: (n: number) => `${n} 量子ビット`,
    bits: (n: number) => `${n} 古典ビット`,
    assumed: "|0…0⟩ を前提",
    fits: "この前に接続できるもの",
    fitsAfter: "この後に接続できるもの",
    unverifiedBefore: "形状は一致しますが、合成は未検証（前段）",
    unverifiedAfter: "形状は一致しますが、合成は未検証（後段）",
    more: (n: number) => `ほか ${n} 件`,
    unknownNote:
      "幅と型は一致しています。一致が保証しないもの——基底の取り方、規格化、各エントリが前提とする初期状態——は未確認であり、これは両者が合成可能であるという主張ではありません。",
    holeNote:
      "一致しているのはレジスタ幅だけです。この端に何が流れるかは出典に記載がないため、量子ビットか古典ビットかも不明であり、幅が保証しないものも当然未確認です。これらは、欠落が埋められれば接続しうる候補であって、接続するエントリではありません。",
    seeAll: (n: number) => `同じ種類の${n}件を見る →`,
    stance: {
      source:
        "状態を準備します。入力はなく、出力は次段が受け取れるレジスタです。",
      transform:
        "ユニタリ演算です。同じレジスタが入出力となり、その内容について前提を置きません。だからこそ同じ幅のものであれば接続できます。",
      transformAssumed:
        "同じレジスタが入出力となりますが、この回路は |0…0⟩ から実行される前提で書かれています。前段を接続することは可能ですが、その場合このエントリが測定した対象とは別物になります。",
      program:
        "段ではなく完結したプログラムです。|0…0⟩ から始まり全量子ビットを測定して終わるため、出力は古典ビットです。このカタログに古典ビットを受け取るものはなく、後続はありません。",
      observable:
        "パイプラインの段ではありません。これを用いて状態を測定するものであり、適用してレジスタを次に渡すものではありません。幅は持ちますが、ポートは意図的に持ちません。",
      undeclared:
        "このレコードはゲート列もレジスタも公開していないため、インターフェースを読み取る対象がありません。空ではなく、不在です。",
      "declared-hole":
        "このレコードもゲート列を公開していませんが、単なる文献レコードとは異なり、その欠落が意図的に明示されています。出典を読んだ上で、どの部分が欠けているか、その理由は何かが出典付きで記録されており、該当箇所はこのページの下に列挙されています。上に示したレジスタ幅はレコードが公開している情報です。公開されていないのはその端の残りの部分であり、下に挙がるエントリは幅が一致するというだけの候補にすぎません。ブロックは穴を持ったまま公開してよく、穴を推測で埋めてはなりません。",
    },
  },
} as const;

/**
 * Either locale's copy, not `en`'s.
 *
 * `as const` gives every string a literal type, so an `en`-shaped parameter
 * rejects the `ja` object outright — and the two are only ever the same shape,
 * never the same type.
 */
type InterfaceCopy = (typeof COPY)[keyof typeof COPY];

/**
 * `hole` is passed separately rather than read off the port, because a hole is
 * precisely the case where there is no port to read it off — and the two blanks
 * it distinguishes ("takes nothing" vs "the source does not say") are the same
 * `null` here.
 */
function portLabel(port: Port | null, copy: InterfaceCopy, hole: Hole | null = null): string {
  if (port === null) return hole ? copy.hole(hole.width) : copy.nothing;
  return port.type === "bits" ? copy.bits(port.width) : copy.qubits(port.width);
}

function PartnerList({
  title,
  partners,
  titleOf,
  note,
  copy,
  tone,
}: {
  title: string;
  partners: InterfacePartner[];
  titleOf: (slug: string) => string;
  note?: string;
  copy: InterfaceCopy;
  tone: "ok" | "unknown";
}) {
  if (partners.length === 0) return null;
  const shown = partners.slice(0, NAMED_PARTNERS);
  const rest = partners.length - shown.length;
  return (
    <div className={`mj-iface-partners mj-iface-partners--${tone}`}>
      <span className="mj-iface-partners-title">
        {title} <strong>{partners.length}</strong>
      </span>
      <ul className="mj-iface-partner-list">
        {shown.map((partner) => (
          <li key={partner.slug}>
            <a href={`/repository/${encodeURIComponent(partner.slug)}`}>{titleOf(partner.slug)}</a>
          </li>
        ))}
        {rest > 0 ? <li className="mj-iface-partner-rest">{copy.more(rest)}</li> : null}
      </ul>
      {note ? <p className="mj-iface-partners-note">{note}</p> : null}
    </div>
  );
}

/**
 * Whether this panel has anything to put on a page.
 *
 * Always true, and that is deliberate — the answer for an entry with no ports at
 * all is a sentence saying so, not silence. It is the opposite call from
 * `hasVisibleProfile`, where an absent circuit is a literature record behaving
 * as intended and a panel explaining it would invent a doubt. Here the absence
 * *is* the finding: 121 of 283 records are not pipeline stages, and a reader
 * looking for something to compose needs to be told that rather than left to
 * infer it from a missing section.
 *
 * Exported anyway, so the call site reads the same as its two neighbours and a
 * later change here does not have to be discovered at the call site.
 */
export function hasVisibleInterface(entry: EntryInterface | null): boolean {
  return entry !== null;
}

export function RepositoryInterfacePanel({
  entry,
  neighbours,
  titleOf,
  stanceCount,
  locale,
}: {
  entry: EntryInterface;
  neighbours: InterfaceNeighbours;
  /**
   * How many entries in the corpus share this stance.
   *
   * Passed in rather than computed here: the caller already holds every
   * interface, and a component that counted for itself would be a second place
   * the number is produced — which is how two counts that must agree stop
   * agreeing.
   */
  stanceCount: number;
  /** Resolves a partner slug to its display title. */
  titleOf: (slug: string) => string;
  locale: PublicLocale;
}) {
  const copy = COPY[locale === "ja" ? "ja" : "en"];
  const stanceCopy =
    entry.stance === "transform" && entry.assumesZeroInput
      ? copy.stance.transformAssumed
      : copy.stance[entry.stance];

  const upstreamFits = neighbours.upstream.filter((partner) => partner.verdict === "compatible");
  const upstreamUnknown = neighbours.upstream.filter((partner) => partner.verdict === "unknown");
  const downstreamFits = neighbours.downstream.filter((partner) => partner.verdict === "compatible");
  const downstreamUnknown = neighbours.downstream.filter((partner) => partner.verdict === "unknown");

  return (
    <div className="mj-iface">
      {/* The piece. `aria-hidden` on the notches only: the two port readings are
          real text inside it, so a screen reader gets the interface without the
          shapes, and the shapes add nothing it would have to describe. */}
      <div className={`mj-iface-piece mj-iface-piece--${entry.stance}`}>
        {/* A declared hole draws the notch too — the edge is real, and only its
            shape is missing. Drawn dashed and hollow rather than omitted: a
            straight side means "nothing joins here", which is the opposite of
            what the record says. */}
        <span
          className={`mj-iface-edge mj-iface-edge--in${entry.input || entry.inputHole ? " is-open" : ""}${
            entry.assumesZeroInput && entry.input ? " is-caveated" : ""
          }${entry.inputHole ? " is-hole" : ""}`}
          aria-hidden="true"
        />
        <div className="mj-iface-port">
          <span className="mj-iface-port-label">{copy.takes}</span>
          <strong className="mj-iface-port-value">{portLabel(entry.input, copy, entry.inputHole)}</strong>
          {entry.input && entry.assumesZeroInput ? (
            <span className="mj-iface-port-caveat">{copy.assumed}</span>
          ) : null}
        </div>
        <div className="mj-iface-port mj-iface-port--out">
          <span className="mj-iface-port-label">{copy.returns}</span>
          <strong className="mj-iface-port-value">{portLabel(entry.output, copy, entry.outputHole)}</strong>
        </div>
        <span
          className={`mj-iface-edge mj-iface-edge--out${
            entry.output?.type === "qubits" || entry.outputHole ? " is-open" : ""
          }${entry.outputHole ? " is-hole" : ""}`}
          aria-hidden="true"
        />
      </div>

      <p className="mj-iface-stance">
        {stanceCopy}{" "}
        {/* The owner's "people can click on either end to get a preview".
            A link rather than an onClick, because this page does not hydrate:
            `/repository?fits=` is resolved server-side, so the browse list
            arrives already filtered whether or not React ever runs. */}
        <a className="mj-iface-stance-link" href={`/repository?fits=${encodeURIComponent(entry.stance)}`}>
          {copy.seeAll(stanceCount)}
        </a>
      </p>

      {isOnGraph(entry) ? (
        <div className="mj-iface-neighbours">
          <PartnerList
            title={copy.fits}
            partners={upstreamFits}
            titleOf={titleOf}
            copy={copy}
            tone="ok"
          />
          <PartnerList
            title={copy.fitsAfter}
            partners={downstreamFits}
            titleOf={titleOf}
            copy={copy}
            tone="ok"
          />
          {/* The note is keyed to the end the list was produced at, because the
              two ends can differ: a record may publish a real input port and
              declare a hole at its output, and one caption for both would be
              wrong about one of them. Shown once — on the second list only when
              the first is empty — so a page with both does not say it twice.

              A hole at THIS entry's end is what changes the sentence. A hole on
              the far side is the partner's disclosure and belongs on the
              partner's page; the subject's own edge is still fully published. */}
          <PartnerList
            title={copy.unverifiedBefore}
            partners={upstreamUnknown}
            titleOf={titleOf}
            note={entry.inputHole ? copy.holeNote : copy.unknownNote}
            copy={copy}
            tone="unknown"
          />
          <PartnerList
            title={copy.unverifiedAfter}
            partners={downstreamUnknown}
            titleOf={titleOf}
            note={
              upstreamUnknown.length > 0
                ? undefined
                : entry.outputHole
                  ? copy.holeNote
                  : copy.unknownNote
            }
            copy={copy}
            tone="unknown"
          />
        </div>
      ) : null}
    </div>
  );
}
