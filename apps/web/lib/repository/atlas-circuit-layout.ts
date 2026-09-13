/**
 * Geometry for the Atlas circuit figure — the large drawing at the top of a
 * record or method page, and the thumbnail on a browse card (UX pass 6, the
 * owner relaying readers: *"the circuit example should stand out more rather
 * than text information"*).
 *
 * Pure, so a test can hold it to the two rules that matter:
 *
 * 1. **One column per operation, in the record's own order.** Operations are
 *    not packed into shared moments. Packing would be a claim that two steps
 *    commute and can run side by side, and a record written as
 *    `prepare → measure → update` says nothing of the kind. The drawing shows
 *    the list the record holds, left to right.
 * 2. **Nothing is added.** An operation naming a wire the record does not draw
 *    keeps its column only for the wires that exist; one naming none of them is
 *    not drawn and is counted in `skipped`, so a caller can say so rather than
 *    draw a box on no wire. A thumbnail past its cap reports `hidden`.
 */

export type AtlasCircuitTone = "accent" | "ok" | "warn" | "neutral";

export interface AtlasCircuitOperation {
  readonly label: string;
  readonly qubits: readonly number[];
  readonly tone: AtlasCircuitTone;
}

export interface AtlasCircuitSource {
  readonly wires: readonly string[];
  readonly operations: readonly AtlasCircuitOperation[];
}

export type AtlasCircuitDensity = "hero" | "thumb";

export interface AtlasCircuitStep {
  /** Position in the record's own operation list, so a caption can name it. */
  readonly index: number;
  readonly label: string;
  readonly tone: AtlasCircuitTone;
  /** The wires it acts on that the record draws — unique, ascending. */
  readonly wires: readonly number[];
  /** True when those wires are adjacent, so one box can span them. */
  readonly contiguous: boolean;
  readonly x: number;
  readonly width: number;
  readonly center: number;
  readonly top: number;
  readonly bottom: number;
}

export interface AtlasCircuitLayout {
  readonly density: AtlasCircuitDensity;
  readonly width: number;
  readonly height: number;
  /** Space left of the first column for wire names (hero) or padding (thumb). */
  readonly labelWidth: number;
  readonly wireY: readonly number[];
  readonly steps: readonly AtlasCircuitStep[];
  /** Operations that name no drawn wire, and so have no column. */
  readonly skipped: number;
  /** Thumbnail only: drawable steps past the cap. Always 0 for a hero. */
  readonly hidden: number;
}

const HERO = {
  rowGap: 64,
  padY: 30,
  boxHalf: 20,
  labelCharWidth: 7.4,
  labelPad: 30,
  labelMin: 64,
  labelMax: 230,
  opCharWidth: 8.6,
  opPad: 26,
  opMin: 48,
  gap: 22,
  padRight: 28,
} as const;

const THUMB = {
  rowGap: 14,
  padY: 7,
  boxHalf: 4.5,
  opWidth: 12,
  gap: 6,
  padX: 8,
  cap: 18,
  ellipsis: 14,
} as const;

/** Characters as a reader counts them — `U²ʲ` is three, not four code units. */
function glyphs(text: string): number {
  return Array.from(text).length;
}

function drawableWires(qubits: readonly number[], wireCount: number): number[] {
  return [...new Set(qubits)]
    .filter((qubit) => Number.isInteger(qubit) && qubit >= 0 && qubit < wireCount)
    .sort((a, b) => a - b);
}

export function layoutAtlasCircuit(
  source: AtlasCircuitSource,
  density: AtlasCircuitDensity = "hero",
): AtlasCircuitLayout {
  const wireCount = source.wires.length;
  const hero = density === "hero";
  const rowGap = hero ? HERO.rowGap : THUMB.rowGap;
  const padY = hero ? HERO.padY : THUMB.padY;
  const boxHalf = hero ? HERO.boxHalf : THUMB.boxHalf;
  const gap = hero ? HERO.gap : THUMB.gap;
  const labelWidth = hero
    ? Math.min(
        HERO.labelMax,
        Math.max(HERO.labelMin, Math.max(0, ...source.wires.map(glyphs)) * HERO.labelCharWidth + HERO.labelPad),
      )
    : THUMB.padX;
  const wireY = source.wires.map((_, index) => padY + boxHalf + index * rowGap);

  const drawable = source.operations
    .map((operation, index) => ({ operation, index, wires: drawableWires(operation.qubits, wireCount) }))
    .filter((candidate) => candidate.wires.length > 0);
  const skipped = source.operations.length - drawable.length;
  const shown = hero ? drawable : drawable.slice(0, THUMB.cap);
  const hidden = drawable.length - shown.length;

  let cursor = labelWidth + (hero ? gap : 0);
  const steps: AtlasCircuitStep[] = shown.map(({ operation, index, wires }) => {
    const width = hero ? Math.max(HERO.opMin, glyphs(operation.label) * HERO.opCharWidth + HERO.opPad) : THUMB.opWidth;
    const x = cursor;
    cursor += width + gap;
    const first = wires[0];
    const last = wires[wires.length - 1];
    return {
      index,
      label: operation.label,
      tone: operation.tone,
      wires,
      contiguous: last - first === wires.length - 1,
      x,
      width,
      center: x + width / 2,
      top: wireY[first] - boxHalf,
      bottom: wireY[last] + boxHalf,
    };
  });

  const contentEnd = steps.length > 0 ? cursor - gap : cursor;
  const width = hero
    ? Math.max(contentEnd + HERO.padRight, labelWidth + 160)
    : contentEnd + THUMB.padX + (hidden > 0 ? THUMB.ellipsis : 0);
  const height = wireCount > 0 ? wireY[wireCount - 1] + boxHalf + padY : padY * 2 + boxHalf * 2;
  return { density, width, height, labelWidth, wireY, steps, skipped, hidden };
}

/** Whether a record's drawing has anything to draw at all. */
export function hasAtlasCircuit(source: AtlasCircuitSource | undefined | null): source is AtlasCircuitSource {
  if (!source || source.wires.length === 0) return false;
  return source.operations.some((operation) => drawableWires(operation.qubits, source.wires.length).length > 0);
}
