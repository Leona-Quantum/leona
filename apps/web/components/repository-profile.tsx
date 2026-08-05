// The circuit-structure panel on a /repository entry (R1).
//
// A server component: it takes an already-fetched profile and renders it. No
// state, no effects, nothing to hydrate — these numbers do not change at all,
// which is the difference from the cost panel beside it.
//
// **This is the first thing /repository shows that is derived, re-derivable
// structure rather than prose.** Everything above it on the page was authored;
// these five numbers are read off the entry's own published circuit by
// `majorana_openqasm.portable`, on every request, and a reader who disagrees can
// count the gate list themselves and check.
//
// The panel is deliberately smaller than the cost panel and says less. A cost
// needs its intermediates on the page because the total is a product of choices;
// a depth is a fact about a gate list. The one thing that does need saying is
// what "depth" counts — the terminal measurement layer is in it, and a reader
// counting gates by hand would otherwise be off by one.
import type { PublicLocale } from "../lib/public-locale";
import type { RepositoryProfile } from "../lib/repository/profile";

const COPY = {
  en: {
    title: "Circuit structure",
    blurb:
      "Derived from this entry's published gate sequence on every read, not authored alongside it. Depth is the longest serial run through the circuit, not the gate count: operations on disjoint qubits share a layer, and the terminal measurement is one layer of its own.",
    qubits: "Qubits",
    depth: "Depth",
    gates: "Gates",
    twoQubit: "Two-qubit gates",
    measurements: "Measurements",
    none: "None",
    twoQubitHint: "The entangling operations — the ones hardware charges most for.",
    measurementsHint: "Terminal, over every qubit.",
  },
  ja: {
    title: "回路の構造",
    blurb:
      "このエントリが公開しているゲート列から読み取るたびに導出した値であり、別途記述されたものではありません。深さはゲート数ではなく、回路を通る最長の直列経路です。互いに素な量子ビットへの操作は同じ層に入り、末尾の測定はそれ自体で1層を占めます。",
    qubits: "量子ビット",
    depth: "深さ",
    gates: "ゲート数",
    twoQubit: "2量子ビットゲート",
    measurements: "測定",
    none: "なし",
    twoQubitHint: "もつれを生む操作であり、ハードウェア上のコストが最も高い部分です。",
    measurementsHint: "末尾で全量子ビットを測定します。",
  },
} as const;

/**
 * Whether this profile has anything to put on a page.
 *
 * Exported and used by the call site *before* it builds a heading, for the
 * reason E4 found the hard way: a React element is truthy whatever it renders,
 * so a page that wraps the panel in a section and then tests the element gets an
 * empty collapsible "Circuit structure" on all 163 entries that carry no
 * circuit, and on every entry when the catalog API is off.
 *
 * An absent profile is NOT rendered as a refusal. Unlike a cost that this stack
 * declines to state — which is a finding — an entry with no gate sequence is a
 * literature record behaving exactly as intended, and a panel explaining its
 * absence would invent a doubt the data does not support.
 */
export function hasVisibleProfile(profile: RepositoryProfile | null): boolean {
  return profile !== null && profile.present;
}

function count(value: number, locale: PublicLocale): string {
  return value.toLocaleString(locale === "ja" ? "ja-JP" : "en-US");
}

function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "accent" | "muted";
}) {
  return (
    <div className={`mj-estimate-stat${tone ? ` mj-estimate-stat--${tone}` : ""}`}>
      <span className="mj-estimate-stat-label">{label}</span>
      <strong className="mj-estimate-stat-value">{value}</strong>
      {hint ? <span className="mj-estimate-stat-hint">{hint}</span> : null}
    </div>
  );
}

/**
 * The whole panel, or nothing.
 *
 * Returns null in exactly the cases `hasVisibleProfile` rejects. Belt-and-braces
 * rather than the guard: by the time this renders, the call site has already
 * decided there is a section to fill.
 */
export function RepositoryProfilePanel({
  profile,
  locale,
}: {
  profile: RepositoryProfile | null;
  locale: PublicLocale;
}) {
  if (!hasVisibleProfile(profile) || profile === null) return null;
  const copy = COPY[locale === "ja" ? "ja" : "en"];
  // The parser guarantees all five are present when `present` is true; the
  // guard is for the type checker and costs nothing.
  const { qubits, depth, gateCount, twoQubitGateCount, measurementCount } = profile;
  if (
    qubits === null ||
    depth === null ||
    gateCount === null ||
    twoQubitGateCount === null ||
    measurementCount === null
  ) {
    return null;
  }

  return (
    <div className="mj-estimate mj-estimate--exact">
      <p className="mj-estimate-blurb">{copy.blurb}</p>

      <div className="mj-estimate-headline">
        <Stat label={copy.qubits} value={count(qubits, locale)} tone="accent" />
        <Stat label={copy.depth} value={count(depth, locale)} />
        <Stat label={copy.gates} value={count(gateCount, locale)} />
      </div>

      <div className="mj-estimate-headline">
        <Stat
          label={copy.twoQubit}
          // Zero is a real, interesting measurement here — a circuit with no
          // entangling gates is a product state — so it renders as a number
          // rather than being muted into "None" the way an absent value is.
          value={count(twoQubitGateCount, locale)}
          hint={copy.twoQubitHint}
        />
        <Stat
          label={copy.measurements}
          value={measurementCount === 0 ? copy.none : count(measurementCount, locale)}
          hint={measurementCount === 0 ? undefined : copy.measurementsHint}
          tone={measurementCount === 0 ? "muted" : undefined}
        />
      </div>
    </div>
  );
}
