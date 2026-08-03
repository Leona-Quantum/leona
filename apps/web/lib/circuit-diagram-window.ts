export const CIRCUIT_COLUMN_WIDTH = 52;
export const CIRCUIT_LEFT_PAD = 74;
export const CIRCUIT_TOP_PAD = 34;
export const CIRCUIT_ROW_HEIGHT = 52;

export interface CircuitDiagramViewport {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface CircuitDiagramWindow {
  qubitStart: number;
  qubitEnd: number;
  stepStart: number;
  stepEnd: number;
}

/**
 * Return exclusive ranges for the wires and columns that intersect the scroll
 * viewport. The SVG keeps its full logical size; only these ranges become DOM
 * nodes. Overscan prevents gates flashing in at the viewport edge.
 */
export function circuitDiagramWindow(
  qubitCount: number,
  stepCount: number,
  viewport: CircuitDiagramViewport,
  overscan = 2,
): CircuitDiagramWindow {
  const qubitStart = clamp(
    Math.floor((viewport.top - CIRCUIT_TOP_PAD) / CIRCUIT_ROW_HEIGHT) - overscan,
    0,
    qubitCount,
  );
  const qubitEnd = clamp(
    Math.ceil((viewport.top + viewport.height - CIRCUIT_TOP_PAD) / CIRCUIT_ROW_HEIGHT) + overscan,
    qubitStart,
    qubitCount,
  );
  const stepStart = clamp(
    Math.floor((viewport.left - CIRCUIT_LEFT_PAD) / CIRCUIT_COLUMN_WIDTH) - overscan,
    0,
    stepCount,
  );
  const stepEnd = clamp(
    Math.ceil((viewport.left + viewport.width - CIRCUIT_LEFT_PAD) / CIRCUIT_COLUMN_WIDTH) + overscan,
    stepStart,
    stepCount,
  );
  return { qubitStart, qubitEnd, stepStart, stepEnd };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
