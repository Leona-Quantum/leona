"use client";

import { useMemo } from "react";
import { activeExampleNoteStepId } from "../../../lib/studio-example-notes";
import { stepsBeforeMoment } from "../../../lib/studio-playhead";
import { expectationValue, type WorkedExample } from "../../../lib/worked-examples";
import type { BuilderStep, CustomGateDefinition } from "../../../lib/studio-builder";
import type { PublicLocale } from "../../../lib/public-locale";
import type { WORKSPACE_COPY } from "../../../lib/workspace-locale";

type StudioCopy = (typeof WORKSPACE_COPY)[PublicLocale]["studio"];

/**
 * "Watch the circuit build": the loaded example's note for whatever step the
 * playhead has most recently passed, highlighted and advancing as the
 * playhead moves (it reads the SAME `steps`/`columns`/`moment` the diagram
 * and the probability panel already use — no separate position to keep in
 * sync), the readout once the playhead reaches the end, and ⟨H⟩ at the
 * current position for an example that carries an observable (VQE).
 *
 * `prefers-reduced-motion` fallback: the highlight is a CSS class toggle
 * (`.is-current`), not a JS-driven animation, so the reduced-motion rule in
 * ux-studio.css only has to drop the transition, not replace a keyframe
 * sequence with nothing.
 */
export function ExampleNotesPanel({
  example,
  steps,
  columns,
  qubitCount,
  customGates,
  moment,
  atEnd,
  locale,
  copy,
}: {
  example: WorkedExample;
  steps: BuilderStep[];
  columns: number[];
  qubitCount: number;
  customGates: CustomGateDefinition[];
  moment: number;
  atEnd: boolean;
  locale: PublicLocale;
  copy: StudioCopy;
}) {
  const activeStepId = activeExampleNoteStepId(steps, columns, moment);
  const expectation = useMemo(() => {
    if (!example.observable) return null;
    try {
      const prefix = stepsBeforeMoment(steps, columns, moment);
      return expectationValue(prefix, customGates, qubitCount, example.observable);
    } catch {
      return null;
    }
  }, [example.observable, steps, columns, moment, customGates, qubitCount]);

  return (
    <section className="mj-example-notes" aria-labelledby="studio-example-notes-title">
      <header>
        <h3 id="studio-example-notes-title">{locale === "ja" ? example.title.ja : example.title.en}</h3>
      </header>
      <ol className="mj-example-notes-list">
        {example.notes.map((entry) => (
          <li key={entry.stepId} className={entry.stepId === activeStepId ? "is-current" : undefined} aria-current={entry.stepId === activeStepId ? "step" : undefined}>
            {locale === "ja" ? entry.text.ja : entry.text.en}
          </li>
        ))}
      </ol>
      {expectation !== null ? (
        <p className="mj-mono-muted">{copy.expectationValue(expectation)}</p>
      ) : null}
      {atEnd ? <p className="mj-example-readout">{locale === "ja" ? example.readout.ja : example.readout.en}</p> : null}
    </section>
  );
}
