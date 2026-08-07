// The strand canvas: the layer graph drawn, on the server, as links.
//
// Every shape on this canvas is an `<a href>` in the HTML that leaves the
// origin. That is the whole design constraint and it is not an accessibility
// afterthought — a diagram that lays itself out in an effect has no address for
// anything in it, is invisible to a crawler and to a reader with no JS, and
// cannot be checked with `curl`. D88.2 put `?open=` on the index for the same
// reason, and session 88 shipped a control that only worked after hydration and
// had to be re-done.
//
// So: no `"use client"`, no measurement API, no layout in the browser. The
// geometry arrives from `strand-layout.ts` already solved.
//
// ## What the shapes mean
//
// - A **pinched oval** is a capability — a slot. It has exactly one entry and one
//   exit because it has exactly one contract, and the pinch *is* the contract.
// - A **fiber** inside it is a method. Every method leaves the entry and rejoins
//   the exit, which is what makes them alternatives rather than stages.
// - A fiber drawn as a **chain of smaller ovals** is a method whose steps are
//   themselves slots. That is the recursion the owner asked for, and it goes six
//   deep off `nonlinear-ode-solve`.
// - A strand **arcing underneath** is a route that skips the slot entirely.
// - A **dashed outline** is a slot nothing recorded fills. A **double outline** is
//   a slot that is open but not drawn — the depth cap, not an absence. Those are
//   different claims and never share a shape.
import type {
  StrandDiagram,
  StrandFascicle,
  StrandFiber,
} from "../lib/repository/strand-layout";

/**
 * Named rather than inferred from the English block.
 *
 * `as const` on a two-locale record narrows every string to its own literal
 * type, so the Japanese half stops being assignable to the English half and the
 * locale lookup will not compile. Declaring the shape once is what makes the two
 * halves interchangeable — which is the whole point of having them.
 */
interface StrandCopy {
  methods: (n: number) => string;
  noMethod: string;
  skips: (n: number) => string;
  atomic: string;
  undecomposed: string;
}

const COPY: Record<"en" | "ja", StrandCopy> = {
  en: {
    methods: (n: number) => `${n} method${n === 1 ? "" : "s"}`,
    noMethod: "no method recorded",
    skips: (n: number) => `${n} route${n === 1 ? "" : "s"} skip this`,
    atomic: "primitive",
    undecomposed: "not taken apart yet",
  },
  ja: {
    methods: (n: number) => `手法 ${n} 件`,
    noMethod: "記録された手法なし",
    skips: (n: number) => `迂回経路 ${n} 件`,
    atomic: "基本要素",
    undecomposed: "未分解",
  },
};

/** Round to a tenth: full float coordinates make the HTML noticeably bigger for no gain. */
function n(value: number): string {
  return (Math.round(value * 10) / 10).toString();
}

/**
 * The pinched oval itself — two cubics meeting at a point on each side.
 *
 * The control radius is the layout's own taper length, not a fraction of the
 * width. That is what keeps the outline and the fibers agreeing: the fibers
 * flare out over `pinchRun`, so an outline that tapered over some other distance
 * would have them visibly leaving the shape that contains them.
 */
function lensPath(
  x: number,
  y: number,
  width: number,
  halfHeight: number,
  pinchRun: number,
): string {
  const right = x + width;
  const r = Math.min(pinchRun * 1.5, width * 0.45);
  return [
    `M ${n(x)} ${n(y)}`,
    `C ${n(x + r)} ${n(y - halfHeight)} ${n(right - r)} ${n(y - halfHeight)} ${n(right)} ${n(y)}`,
    `C ${n(right - r)} ${n(y + halfHeight)} ${n(x + r)} ${n(y + halfHeight)} ${n(x)} ${n(y)}`,
    "Z",
  ].join(" ");
}

/** A fiber: out of the entry pinch, along its lane, back into the exit pinch. */
function fiberPath(fiber: StrandFiber): string {
  const inK = Math.max(6, (fiber.laneX0 - fiber.entryX) * 0.62);
  const outK = Math.max(6, (fiber.exitX - fiber.laneX1) * 0.62);
  return [
    `M ${n(fiber.entryX)} ${n(fiber.pinchY)}`,
    `C ${n(fiber.entryX + inK)} ${n(fiber.pinchY)} ${n(fiber.laneX0 - inK)} ${n(fiber.laneY)} ${n(fiber.laneX0)} ${n(fiber.laneY)}`,
    `L ${n(fiber.laneX1)} ${n(fiber.laneY)}`,
    `C ${n(fiber.laneX1 + outK)} ${n(fiber.laneY)} ${n(fiber.exitX - outK)} ${n(fiber.pinchY)} ${n(fiber.exitX)} ${n(fiber.pinchY)}`,
  ].join(" ");
}

/** A route around the slot: leaves the entry pinch, rejoins the exit, never enters. */
function bypassPath(x: number, y: number, width: number, lift: number): string {
  const right = x + width;
  return [
    `M ${n(x)} ${n(y)}`,
    `C ${n(x + width * 0.24)} ${n(y + lift)} ${n(right - width * 0.24)} ${n(y + lift)} ${n(right)} ${n(y)}`,
  ].join(" ");
}

function Fascicle({
  node,
  copy,
}: {
  node: StrandFascicle;
  copy: StrandCopy;
}) {
  const countLabel =
    node.state === "empty" ? copy.noMethod : copy.methods(node.methodCount);
  // The full name always reaches the reader even when the drawn one is cut —
  // the truncation is visible in the shape and recoverable on hover.
  const tooltip = `${node.fullLabel} · ${countLabel}${node.summary ? ` — ${node.summary}` : ""}`;

  return (
    <g className={`mj-strand-fascicle mj-strand-fascicle--${node.state}`}>
      {node.bypasses.map((bypass) => (
        <g className="mj-strand-bypass" key={`${node.id}-skip-${bypass.methodId}`}>
          <a href={bypass.href}>
            <title>{`${bypass.label} — ${copy.skips(node.bypasses.length)}`}</title>
            <path
              className="mj-strand-bypass-line"
              d={bypassPath(node.x, node.y, node.width, bypass.lift)}
            />
          </a>
        </g>
      ))}

      <path
        className="mj-strand-lens"
        d={lensPath(node.x, node.y, node.width, node.halfHeight, node.pinchRun)}
      />
      {node.state === "closed" ? (
        <path
          className="mj-strand-lens-inner"
          d={lensPath(node.x + 7, node.y, node.width - 14, node.halfHeight * 0.58, node.pinchRun)}
        />
      ) : null}

      {/* Both pinches drawn as real points — the contract each side of the slot. */}
      <circle className="mj-strand-pinch" cx={n(node.x)} cy={n(node.y)} r="2.6" />
      <circle className="mj-strand-pinch" cx={n(node.x + node.width)} cy={n(node.y)} r="2.6" />

      <a className="mj-strand-fascicle-link" href={node.href}>
        <title>{tooltip}</title>
        <text
          className="mj-strand-fascicle-label"
          x={n(node.x + 3)}
          y={n(node.y - node.halfHeight - 6)}
        >
          {node.label}
        </text>
        {/* An invisible band gives the label a click target the size of the
            shape's top edge. `opacity: 0` still takes the click; `visibility`
            would not, which is the trap. */}
        <rect
          className="mj-strand-hit"
          x={n(node.x)}
          y={n(node.y - node.halfHeight - 17)}
          width={n(node.width)}
          height="17"
        />
      </a>

      {node.state !== "open" ? (
        <text className="mj-strand-count" x={n(node.x + node.width / 2)} y={n(node.y + 4)}>
          {countLabel}
        </text>
      ) : null}

      {node.fibers.map((fiber) => (
        <Fiber key={fiber.id} fiber={fiber} copy={copy} />
      ))}
    </g>
  );
}

function Fiber({ fiber, copy }: { fiber: StrandFiber; copy: StrandCopy }) {
  const note =
    fiber.outlook === "atomic"
      ? copy.atomic
      : fiber.outlook === "undecomposed"
        ? copy.undecomposed
        : null;
  const tooltip = `${fiber.fullLabel}${note ? ` (${note})` : ""}${fiber.summary ? ` — ${fiber.summary}` : ""}`;
  const isLeaf = fiber.outlook !== "decomposed";

  return (
    <g className={`mj-strand-fiber mj-strand-fiber--${fiber.outlook}`}>
      <path className="mj-strand-fiber-line" d={fiberPath(fiber)} />
      <a className="mj-strand-fiber-link" href={fiber.href}>
        <title>{tooltip}</title>
        <text
          className="mj-strand-fiber-label"
          x={n(isLeaf ? (fiber.laneX0 + fiber.laneX1) / 2 : fiber.laneX0 + 2)}
          y={n(fiber.labelY)}
          textAnchor={isLeaf ? "middle" : "start"}
        >
          {fiber.label}
        </text>
        <rect
          className="mj-strand-hit"
          x={n(fiber.laneX0)}
          y={n(fiber.labelY - 11)}
          width={n(Math.max(24, fiber.laneX1 - fiber.laneX0))}
          height="15"
        />
      </a>
      {fiber.steps.map((step) => (
        <Fascicle key={step.id} node={step} copy={copy} />
      ))}
    </g>
  );
}

/**
 * The canvas.
 *
 * Deliberately **not** `role="img"`: the shapes are links, and an `img` role
 * would take every one of them out of the accessibility tree and leave a reader
 * on a screen reader with a single alt string where there are 76 destinations.
 * The list view beside it is the linear reading of the same data, which is the
 * text alternative that actually works.
 */
export function StrandCanvas({
  diagram,
  locale,
  title,
}: {
  diagram: StrandDiagram;
  locale: "en" | "ja";
  title: string;
}) {
  const copy = COPY[locale];
  return (
    <div className="mj-strand-scroll">
      <svg
        className="mj-strand-canvas"
        viewBox={`0 0 ${n(diagram.width)} ${n(diagram.height)}`}
        width={n(diagram.width)}
        height={n(diagram.height)}
        preserveAspectRatio="xMinYMin meet"
        // The stylesheet scales the canvas between these two, and only the
        // layout knows what they are. `width`/`height` stay on the element so a
        // reader with no CSS at all still gets the diagram at its true size.
        style={
          {
            "--strand-w": `${n(diagram.width)}px`,
            "--strand-min": `${n(diagram.width * 0.72)}px`,
          } as React.CSSProperties
        }
        xmlns="http://www.w3.org/2000/svg"
      >
        <title>{title}</title>
        {diagram.roots.map((root) => (
          <Fascicle key={root.id} node={root} copy={copy} />
        ))}
      </svg>
    </div>
  );
}
