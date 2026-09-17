"use client";

/**
 * The Atlas worked-example figure (stage 2 of the Atlas worked-example lane).
 *
 * For a record whose first resolvable `worked-example-links.ts` link is
 * `"instance"`, this replaces the plain circuit hero (see
 * `repository-entry-view.tsx`). It draws one concrete, checked example —
 * `apps/web/lib/worked-examples.ts` — computed with the same statevector
 * kernel Studio's own bounded simulator uses
 * (`apps/web/lib/statevector-kernel.ts`), not a claim from the record's own
 * papers. The figure says so plainly.
 *
 * Server vs. client, deliberately split the way `AtlasCircuitFigure` already
 * is: the drawing, the title, the instance sentence, every step's note and
 * the readout are all synchronous JSX, so they render in the server HTML and
 * read without JavaScript. Only stepping (which step is "current") and the
 * probability/⟨H⟩ panel for that step need it — a visitor without JavaScript
 * sees the whole example laid out for step 1 and can still read every other
 * step's note below it.
 *
 * The stage's own SVG mirrors `AtlasCircuitFigure`'s markup and CSS classes
 * (`ux-atlas.css`) rather than reusing that component directly: this figure
 * needs the selected step to drive a note and a probability panel outside
 * the drawing too, which `AtlasCircuitFigure` has no way to report out. The
 * geometry itself — `layoutAtlasCircuit` — is the one part worth not
 * reimplementing, and is imported, not copied. Opening a block one level
 * uses `flattenBuilderSteps` (via `openedStepGates`) for the same reason.
 */
import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import type { PublicLocale } from "../lib/public-locale";
import type { WorkedExample } from "../lib/worked-examples";
import { layoutAtlasCircuit } from "../lib/repository/atlas-circuit-layout";
import {
  formatSignificant,
  observableLabel,
  openedStepGates,
  stepLabel,
  workedExampleDrawing,
  workedExampleReading,
  workedExampleSignInHref,
  workedExampleStudioHref,
} from "../lib/atlas-worked-example-steps";
import { openedStepEffects, stepEffect, type StepEffect } from "../lib/atlas-step-effect";
import { describeStepEffect, phasePanelCopy, phaseRow, shouldShowPhases } from "../lib/atlas-step-effect-copy";
import type { WorkedExampleSummary } from "../lib/atlas-worked-example-summary";
import { AtlasOutcomeBars } from "./atlas-circuit";
import { SignInLink } from "./sign-in-link";

const COPY = {
  en: {
    disclaimer: "A small worked example, computed in your browser. It is not a result from this record's papers.",
    figure: (title: string) => `${title}: worked-example circuit`,
    step: (n: number, total: number) => `Step ${n} of ${total}`,
    previous: "Previous step",
    next: "Next step",
    play: "Play",
    pause: "Pause",
    replay: "Play again",
    scrub: "Step through the example",
    expand: "Show the gates inside this block",
    collapse: "Hide the gates inside this block",
    onWires: "on",
    probabilityLabel: "Probability of each outcome after this step",
    otherStates: (n: number) => `${n} more ${n === 1 ? "outcome" : "outcomes"}`,
    expectationLabel: (symbol: string) => `⟨${symbol}⟩ after this step`,
    readoutLabel: "Readout",
    openInStudio: "Open in Studio",
    openingSignIn: "Opening sign in…",
    signInUnavailable: "Sign-in is not configured in this environment yet.",
    stepsHeading: "Steps",
  },
  ja: {
    disclaimer: "小さな具体例で、ブラウザ内で計算しています。この項目の論文による結果ではありません。",
    figure: (title: string) => `${title}：具体例の回路`,
    step: (n: number, total: number) => `ステップ ${n} / ${total}`,
    previous: "前のステップ",
    next: "次のステップ",
    play: "再生",
    pause: "一時停止",
    replay: "もう一度再生",
    scrub: "具体例をステップごとに見る",
    expand: "このブロックの中のゲートを表示",
    collapse: "このブロックの中のゲートを隠す",
    onWires: "対象：",
    probabilityLabel: "このステップ後の各結果の確率",
    otherStates: (n: number) => `他 ${n} 件`,
    expectationLabel: (symbol: string) => `このステップ後の ⟨${symbol}⟩`,
    readoutLabel: "読み出し結果",
    openInStudio: "Studioで開く",
    openingSignIn: "サインインを開いています…",
    signInUnavailable: "この環境ではサインインがまだ設定されていません。",
    stepsHeading: "ステップ",
  },
} as const;

const STEP_MS = 1100;

/**
 * Copy for the component / used-in note. Kept apart from COPY above because
 * the note is a different piece of writing with a different job: COPY labels
 * the controls of a figure a reader has already decided to read, this argues
 * that a reader should read a DIFFERENT figure, and the two drifted apart the
 * moment the note stopped being one line.
 */
const COMPONENT_COPY = {
  en: {
    component: "A part this method uses, worked through",
    usedIn: "This record, used inside a worked example",
    because: "This page says ",
    becauseTail: " — here is a concrete, runnable instance of it.",
    outcomes: "Where it ends up",
    phaseStep: "One of its steps changes only phase: the outcome probabilities stay put while the state does not.",
    openPart: "Open this part in Studio",
    openUsing: "Open that example in Studio",
    figureAlt: (title: string, steps: number, qubits: number) =>
      `${title}: ${steps} ${steps === 1 ? "step" : "steps"} on ${qubits} ${qubits === 1 ? "qubit" : "qubits"}`,
  },
  ja: {
    component: "この手法が使う部分を、実例でたどる",
    usedIn: "この項目が、ある具体例の中で使われている例",
    // The evidence phrase is a verbatim substring of an ENGLISH field
    // (description / explanation / introduction), because that is what
    // check-worked-example-links.mjs validates it against. So the Japanese
    // page must not say "このページには…とあります" — this page, in Japanese,
    // does not say that; it says the Japanese equivalent. The phrase is
    // attributed to the English text instead, which is true and keeps the
    // grounding that made this note worth reading.
    because: "この項目の英語版の記述にある",
    becauseTail: "について、具体的で実行できる例がこちらです。",
    outcomes: "最終的な測定結果",
    phaseStep: "この例には、位相だけを変えるステップがあります。測定結果の確率は動きませんが、状態は変わっています。",
    openPart: "この部分をStudioで開く",
    openUsing: "その具体例をStudioで開く",
    figureAlt: (title: string, steps: number, qubits: number) => `${title}：${qubits}量子ビット、${steps}ステップ`,
  },
} as const;

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function AtlasWorkedExampleFigure({
  example,
  locale,
  isSignedIn,
  signInHref,
}: {
  example: WorkedExample;
  locale: PublicLocale;
  isSignedIn: boolean;
  signInHref: string | null;
}): React.ReactElement | null {
  const copy = COPY[locale];
  const total = example.steps.length;
  const drawing = useMemo(
    () => workedExampleDrawing(example.steps, example.customGates, example.qubitCount),
    [example],
  );
  const layout = useMemo(() => layoutAtlasCircuit(drawing, "hero"), [drawing]);
  const [currentStep, setCurrentStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [openedStep, setOpenedStep] = useState<number | null>(null);
  /**
   * What each step did to the state, read once for the whole example.
   *
   * Computed for every step rather than for the current one because the note
   * list below renders all of them at once — and because it has to be in the
   * server HTML: the sentences are the figure's explanation, and a reader
   * without JavaScript would otherwise get the step labels and nothing else.
   * The cost is `steps.length` prefix runs of a ≤ 12-qubit statevector, the
   * same kernel the probability bars already run once per scrub.
   */
  const effects = useMemo<StepEffect[]>(
    () =>
      example.steps.map((_, index) =>
        stepEffect({
          steps: example.steps,
          customGates: example.customGates,
          qubitCount: example.qubitCount,
          index,
        }),
      ),
    [example],
  );

  useEffect(() => {
    if (!playing) return;
    const timer = window.setTimeout(() => {
      if (currentStep < total - 1) {
        setCurrentStep((step) => step + 1);
      } else {
        setPlaying(false);
      }
    }, STEP_MS);
    return () => window.clearTimeout(timer);
  }, [playing, currentStep, total]);

  if (total === 0) return null;

  function go(next: number) {
    setPlaying(false);
    setCurrentStep(Math.max(0, Math.min(total - 1, next)));
  }

  function togglePlay() {
    if (playing) {
      setPlaying(false);
      return;
    }
    if (currentStep >= total - 1) setCurrentStep(0);
    setPlaying(true);
  }

  function onStageKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowRight") {
      event.preventDefault();
      go(currentStep + 1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      go(currentStep - 1);
    }
  }

  const noteByStepId = new Map(example.notes.map((entry) => [entry.stepId, entry.text]));
  const reading = workedExampleReading(example.steps, example.customGates, example.qubitCount, currentStep, example.observable);
  // Computed once from the observable itself, not per step: which symbol to
  // show (⟨Z₂⟩, ⟨H⟩...) does not depend on where the reader currently is.
  const label = example.observable && example.observable.length > 0 ? observableLabel(example.observable) : null;
  const atEnd = !playing && currentStep >= total - 1;
  const title = locale === "ja" ? example.title.ja : example.title.en;
  const currentEffect = effects[currentStep];
  const effectText = effects.map((effect) => describeStepEffect(effect, locale));
  const effectChange = effects.map((effect) => (effect.kind === "ok" ? effect.change : undefined));

  return (
    // No outer .mj-atlas-hero here — the caller (repository-entry-view.tsx)
    // wraps this in the same .mj-atlas-hero + AtlasGlance section every other
    // hero uses, so the resource/paper/source-report tiles keep showing
    // beside a worked example exactly as they do beside a plain circuit.
    <div className="mj-worked-example" role="group" aria-label={copy.figure(title)}>
      <p className="mj-worked-example-disclaimer">{copy.disclaimer}</p>
      <h2 className="mj-worked-example-title">{title}</h2>
      <p className="mj-worked-example-instance">{locale === "ja" ? example.instance.ja : example.instance.en}</p>

      <figure className="mj-atlas-figure">
        <div className="mj-atlas-figure-main">
          <div
            className="mj-atlas-stage"
            tabIndex={0}
            role="region"
            aria-label={copy.figure(title)}
            onKeyDown={onStageKeyDown}
          >
            <svg
              className="mj-atlas-svg"
              viewBox={`0 0 ${layout.width} ${layout.height}`}
              width={layout.width}
              height={layout.height}
              role="img"
              aria-label={copy.figure(title)}
            >
              {drawing.wires.map((wire, index) => (
                <g key={`${wire}-${index}`} className="mj-atlas-wire">
                  <line x1={layout.labelWidth - 8} x2={layout.width - 10} y1={layout.wireY[index]} y2={layout.wireY[index]} />
                  <text x={layout.labelWidth - 16} y={layout.wireY[index]} textAnchor="end" dominantBaseline="central">
                    {wire}
                  </text>
                </g>
              ))}
              {layout.steps.map((step, position) => {
                const state = position === currentStep ? "on" : position < currentStep ? "past" : "ahead";
                return (
                  <g
                    key={step.index}
                    className="mj-atlas-op"
                    data-tone={step.tone}
                    data-state={state}
                    onClick={() => go(position)}
                  >
                    <title>{`${copy.step(position + 1, total)} · ${step.label}`}</title>
                    <rect x={step.box.x} y={step.box.y} width={step.box.width} height={step.box.height} rx={9} />
                    {step.passes.map((wire) => (
                      <line
                        key={wire}
                        className="mj-atlas-op-pass"
                        x1={step.box.x}
                        x2={step.box.x + step.box.width}
                        y1={layout.wireY[wire]}
                        y2={layout.wireY[wire]}
                      />
                    ))}
                    <text x={step.center} y={step.labelY} textAnchor="middle" dominantBaseline="central">
                      {step.label}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>
          <div className="mj-atlas-controls">
            <button type="button" className="mj-atlas-control" onClick={() => go(currentStep - 1)} disabled={currentStep === 0} aria-label={copy.previous}>
              <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M10 3 5 8l5 5" /></svg>
            </button>
            <button type="button" className="mj-atlas-control mj-atlas-control--play" onClick={togglePlay} aria-pressed={playing}>
              <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                {playing ? <path d="M5 3v10M11 3v10" /> : <path d="M5 3.5v9l7.5-4.5z" />}
              </svg>
              {playing ? copy.pause : atEnd ? copy.replay : copy.play}
            </button>
            <button type="button" className="mj-atlas-control" onClick={() => go(currentStep + 1)} disabled={currentStep === total - 1} aria-label={copy.next}>
              <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="m6 3 5 5-5 5" /></svg>
            </button>
            <input
              className="mj-atlas-scrub"
              type="range"
              min={0}
              max={total - 1}
              step={1}
              value={currentStep}
              onChange={(event) => go(Number(event.target.value))}
              aria-label={copy.scrub}
              aria-valuetext={copy.step(currentStep + 1, total)}
            />
          </div>
          <p className="mj-atlas-live" aria-live="polite">
            {copy.step(currentStep + 1, total)} · {layout.steps[currentStep]?.label}
          </p>
        </div>

        <div className="mj-worked-example-reading mj-atlas-figure-aside">
          {reading.kind === "probabilities" && reading.reading.kind === "ok" ? (
            <AtlasOutcomeBars
              label={copy.probabilityLabel}
              outcomes={[
                ...reading.reading.bars.map((bar) => ({ label: bar.bitstring, probability: bar.probability })),
                ...(reading.reading.otherStates > 0
                  ? [{ label: copy.otherStates(reading.reading.otherStates), probability: reading.reading.otherProbability }]
                  : []),
              ]}
            />
          ) : null}
          {reading.kind === "expectation" && label ? (
            <p className="mj-worked-example-expectation">
              <span className="mj-atlas-outcomes-label">
                {copy.expectationLabel(label.kind === "term" ? label.symbol : "H")}
              </span>
              <strong>{formatSignificant(reading.value)}</strong>
            </p>
          ) : null}
          {currentEffect && shouldShowPhases(currentEffect) ? (
            <AtlasPhaseTable effect={currentEffect} locale={locale} />
          ) : null}
        </div>
      </figure>

      {label && label.kind === "hamiltonian" ? <p className="mj-worked-example-hamiltonian">{label.formula}</p> : null}

      <ol className="mj-worked-example-notes">
        {example.steps.map((step, index) => {
          const note = noteByStepId.get(step.id);
          const opened = openedStep === index;
          const gates = step.gate === "CUSTOM" ? openedStepGates(step, example.customGates) : [];
          const innerEffects = opened
            ? openedStepEffects({
                steps: example.steps,
                customGates: example.customGates,
                qubitCount: example.qubitCount,
                index,
              })
            : [];
          return (
            <li key={step.id} className="mj-worked-example-note" data-current={index === currentStep || undefined}>
              <button type="button" className="mj-worked-example-note-step" onClick={() => go(index)}>
                {copy.step(index + 1, total)} · <code>{stepLabel(step, example.customGates)}</code>
              </button>
              {note ? <p>{locale === "ja" ? note.ja : note.en}</p> : null}
              {/* The derived account of what this step did to the state. It
                  sits below the author's note, not instead of it: the note says
                  what the step is FOR, this says what it measurably did. Null
                  when the reading declined — a figure that cannot read the
                  state must print nothing rather than something a reader would
                  take for "nothing changed". */}
              {effectText[index] ? (
                <p className="mj-worked-example-effect" data-change={effectChange[index]}>
                  {effectText[index]}
                </p>
              ) : null}
              {step.gate === "CUSTOM" ? (
                <>
                  <button
                    type="button"
                    className="mj-worked-example-block-toggle"
                    aria-expanded={opened}
                    onClick={() => setOpenedStep(opened ? null : index)}
                  >
                    {opened ? copy.collapse : copy.expand}
                  </button>
                  {opened ? (
                    <ol className="mj-worked-example-block-gates">
                      {gates.map((gate, gateIndex) => {
                        // Computed only for the block a reader actually opened —
                        // one prefix run per inner gate, and a QFT block has
                        // enough of them that doing this for every block of
                        // every example up front would be work nobody asked for.
                        const innerText = describeStepEffect(
                          innerEffects[gateIndex] ?? { kind: "unavailable", reason: "angle" },
                          locale,
                        );
                        return (
                          <li key={`${gate.id}-${gateIndex}`}>
                            <code>{gate.label}</code> {copy.onWires} {gate.qubits.map((qubit) => drawing.wires[qubit]).join(", ")}
                            {innerText ? <p className="mj-worked-example-block-effect">{innerText}</p> : null}
                          </li>
                        );
                      })}
                    </ol>
                  ) : null}
                </>
              ) : null}
            </li>
          );
        })}
      </ol>

      <p className="mj-worked-example-readout">
        <span className="mj-atlas-outcomes-label">{copy.readoutLabel}</span>
        {" "}
        {locale === "ja" ? example.readout.ja : example.readout.en}
      </p>

      {/* `signInHref` is only the page's "sign-in is available" signal here. Its
          own returnTo is the page default (/run), so using it as the link sent a
          signed-out reader to the run page after sign-in instead of this example
          in Studio. Found on production 2026-09-15 by an anonymous fetch; the
          feature's screenshots had all been taken signed in. */}
      {isSignedIn ? (
        <a className="mj-primary-button mj-worked-example-studio" href={workedExampleStudioHref(example.id)}>
          {copy.openInStudio}
        </a>
      ) : signInHref ? (
        <SignInLink className="mj-primary-button mj-worked-example-studio" href={workedExampleSignInHref(example.id)} pendingLabel={copy.openingSignIn}>
          {copy.openInStudio}
        </SignInLink>
      ) : (
        <p className="mj-worked-example-signin-note">{copy.signInUnavailable}</p>
      )}
    </div>
  );
}

/**
 * One phase drawn as a point on the unit circle: the argument of that
 * amplitude, relative to the largest one.
 *
 * A dot on the rim rather than a rotating hand, because the hand version this
 * replaces was unreadable at the size the table needs — a 14px circle with a
 * hairline border disappears against the panel, and without a visible centre a
 * hand at 0 and a hand at π are the same horizontal line. A dot has a position
 * even when the circle around it is faint, and 0 (right) and π (left) are
 * never the same picture.
 *
 * Decorative: the printed value sits in the next cell and is what a screen
 * reader reads.
 */
function PhaseDial({ turns }: { turns: number }): React.ReactElement {
  // SVG y grows downward, so negating the sine draws the argument
  // counter-clockwise from the positive real axis, as the complex plane does.
  const radians = turns * 2 * Math.PI;
  const x = 8 + 5 * Math.cos(radians);
  const y = 8 - 5 * Math.sin(radians);
  return (
    <svg className="mj-worked-example-phase-dial" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <circle className="mj-worked-example-phase-rim" cx="8" cy="8" r="5" />
      <line className="mj-worked-example-phase-hand" x1="8" y1="8" x2={x} y2={y} />
      <circle className="mj-worked-example-phase-point" cx={x} cy={y} r="1.8" />
    </svg>
  );
}

/**
 * The amplitudes after the current step, with their phases — shown only where
 * the probability bars alone would mislead (`shouldShowPhases`).
 *
 * The phase is drawn as well as printed: a dial, because a phase is an angle
 * and a reader comparing eight rows takes in eight pointer directions faster
 * than eight strings of the form "3π/4". The dial is a rotated line inside a
 * circle, so it costs one transform and needs no font that can render the
 * character. The printed value stays beside it — the dial is the comparison,
 * the text is the number.
 */
function AtlasPhaseTable({
  effect,
  locale,
}: {
  effect: Extract<StepEffect, { kind: "ok" }>;
  locale: PublicLocale;
}): React.ReactElement {
  const copy = phasePanelCopy(locale);
  const rows = effect.phases.map((amplitude) => phaseRow(amplitude, locale));
  return (
    <div className="mj-worked-example-phases">
      <span className="mj-atlas-outcomes-label">{copy.heading}</span>
      <table className="mj-worked-example-phase-table">
        <thead>
          <tr>
            <th scope="col">{copy.stateColumn}</th>
            <th scope="col">{copy.probabilityColumn}</th>
            <th scope="col" colSpan={2}>
              {copy.phaseColumn}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.bitstring}>
              <th scope="row">{row.bitstring}</th>
              <td>{row.probability}</td>
              <td>
                <PhaseDial turns={row.phaseTurns} />
              </td>
              <td className="mj-worked-example-phase-value">{row.phase}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {effect.otherStates > 0 ? (
        <p className="mj-worked-example-phase-rest">
          {copy.other(effect.otherStates, `${(effect.otherProbability * 100).toFixed(1)}%`)}
        </p>
      ) : null}
      <p className="mj-worked-example-phase-note">{copy.note}</p>
    </div>
  );
}

/**
 * The small note block for a `"component"`- or `"used-in"`-relation link —
 * never the full figure. The two relations are opposite directions and get
 * different wording:
 *   - `"component"`: this record's own method uses the example as a
 *     subroutine — "Worked example of a part this method uses."
 *   - `"used-in"`: the reverse — the example's algorithm uses this record
 *     (an operator, a building block) — "See this in a worked example,"
 *     naming the example as the one doing the using.
 * Links straight to Studio (sign-in gated the same way the figure's own
 * "Open in Studio" is), not back to `/repository/<slug>?example=<id>` on the
 * current page: nothing reads that query param today, and a link that does
 * nothing is worse than one that opens the example somewhere it actually runs.
 */
export function AtlasWorkedExampleComponentNote({
  summary,
  locale,
  isSignedIn,
  signInHref,
}: {
  summary: WorkedExampleSummary;
  locale: PublicLocale;
  isSignedIn: boolean;
  signInHref: string | null;
}): React.ReactElement {
  const ja = locale === "ja";
  const copy = COMPONENT_COPY[locale];
  const title = ja ? summary.title.ja : summary.title.en;
  const label = summary.relation === "used-in" ? copy.usedIn : copy.component;
  const layout = layoutAtlasCircuit(summary.drawing, "thumb");
  const openLabel = summary.relation === "used-in" ? copy.openUsing : copy.openPart;

  return (
    <section className="mj-worked-example-component-note" aria-label={`${label}: ${title}`}>
      <p className="mj-worked-example-component-head">
        <span className="mj-atlas-outcomes-label">{label}</span>
      </p>
      {/* The record's OWN words, quoted. This is why the link exists, and it is
          checked against the live corpus by check-worked-example-links.mjs —
          so the note can say "this page says X" without that being a claim
          nobody verifies. */}
      <p className="mj-worked-example-component-because">
        {copy.because}
        <q>{summary.evidence}</q>
        {copy.becauseTail}
      </p>
      <h3 className="mj-worked-example-component-title">{title}</h3>
      <p className="mj-worked-example-component-instance">{ja ? summary.instance.ja : summary.instance.en}</p>

      <div className="mj-worked-example-component-figure">
        <svg
          className="mj-atlas-svg"
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          width={layout.width}
          height={layout.height}
          role="img"
          aria-label={copy.figureAlt(title, summary.stepCount, summary.qubitCount)}
        >
          {summary.drawing.wires.map((wire, index) => (
            <g key={`${wire}-${index}`} className="mj-atlas-wire">
              <line x1={layout.labelWidth - 6} x2={layout.width - 8} y1={layout.wireY[index]} y2={layout.wireY[index]} />
              <text x={layout.labelWidth - 12} y={layout.wireY[index]} textAnchor="end" dominantBaseline="central">
                {wire}
              </text>
            </g>
          ))}
          {layout.steps.map((step) => (
            <g key={step.index} className="mj-atlas-op" data-tone={step.tone} data-state="past">
              <rect x={step.box.x} y={step.box.y} width={step.box.width} height={step.box.height} rx={7} />
              {step.passes.map((wire) => (
                <line
                  key={wire}
                  className="mj-atlas-op-pass"
                  x1={step.box.x}
                  x2={step.box.x + step.box.width}
                  y1={layout.wireY[wire]}
                  y2={layout.wireY[wire]}
                />
              ))}
              <text x={step.center} y={step.labelY} textAnchor="middle" dominantBaseline="central">
                {step.label}
              </text>
            </g>
          ))}
        </svg>
        {summary.outcomes.length > 0 ? (
          <AtlasOutcomeBars
            label={copy.outcomes}
            outcomes={[
              ...summary.outcomes.map((outcome) => ({ label: outcome.bitstring, probability: outcome.probability })),
              ...(summary.otherOutcomes > 0
                ? [{ label: COPY[locale].otherStates(summary.otherOutcomes), probability: summary.otherProbability }]
                : []),
            ]}
          />
        ) : null}
      </div>

      <p className="mj-worked-example-component-readout">{ja ? summary.readout.ja : summary.readout.en}</p>
      {summary.hasPhaseStep ? <p className="mj-worked-example-component-phase">{copy.phaseStep}</p> : null}

      {isSignedIn ? (
        <a className="mj-worked-example-component-open" href={workedExampleStudioHref(summary.exampleId)}>
          {openLabel}
        </a>
      ) : signInHref ? (
        <SignInLink
          className="mj-worked-example-component-open"
          href={workedExampleSignInHref(summary.exampleId)}
          pendingLabel={COPY[locale].openingSignIn}
        >
          {openLabel}
        </SignInLink>
      ) : null}
    </section>
  );
}
