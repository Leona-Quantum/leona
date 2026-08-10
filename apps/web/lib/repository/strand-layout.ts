// One path helper the converge rail still uses.
//
// This module used to lay out the whole "muscle strand" picture the owner
// described in session-89 — a slot as a pinched oval, its methods as fibers
// branching off and converging back — and it drew `/repository/layers` under
// `?view=strands`. That surface, `repository-strand-view.tsx` and
// `repository-strands.tsx`, was retired this session along with the other two
// non-converge views: the page no longer reads `?view=` at all, and every
// drawing is `ConvergeCanvas` now.
//
// `ancestorPath` outlived the canvas it was written for. `repository-converge-
// view.tsx`'s rail — "where you are" — needs the same shortest-path-to-a-root
// climb the strand rail needed, and it is graph structure rather than strand
// geometry: nothing in it measures a shape or lays out a fiber. So it stayed,
// and everything that only the retired canvas needed — the metrics, the text
// measurement, the two-pass measure/place engine, `layoutFocus`,
// `layoutOverview`, `siblingCapabilities` — went with it. Checked by grep
// against every symbol this module exported, not assumed from the file's own
// history: `process-layout.ts` kept dead exports across one prior view
// retirement because nobody re-checked them against the surface that replaced
// it.
import { isCapability, layerNode, methodsRealizing, type LayerCapability, type LayerGraph } from "./layers.ts";

function capabilityById(graph: LayerGraph, id: string): LayerCapability | null {
  const node = layerNode(graph, id);
  return node && isCapability(node) ? node : null;
}

/**
 * The chain of capabilities from a root down to `id`, shortest first.
 *
 * Shortest rather than any path, for the reason `layerDepths` gives: a
 * capability reachable both as a direct step and as something four levels down
 * is *first* met at the shallower one, and the rail should say where the reader
 * most plausibly came from. Returns an empty array for an id that resolves to
 * nothing, never a partial path.
 */
export function ancestorPath(graph: LayerGraph, id: string): LayerCapability[] {
  const target = capabilityById(graph, id);
  if (!target) return [];

  const containers = new Map<string, string[]>();
  for (const node of graph.nodes) {
    if (!isCapability(node)) continue;
    for (const method of methodsRealizing(graph, node.id)) {
      for (const step of method.steps) {
        const list = containers.get(step) ?? [];
        list.push(node.id);
        containers.set(step, list);
      }
    }
  }

  // Breadth-first upward, so the first root reached is the nearest one.
  const seen = new Set<string>([id]);
  const queue: Array<{ id: string; path: string[] }> = [{ id, path: [id] }];
  for (let head = 0; head < queue.length; head += 1) {
    const item = queue[head]!;
    const parents = containers.get(item.id) ?? [];
    if (parents.length === 0) {
      return item.path
        .map((step) => capabilityById(graph, step))
        .filter((node): node is LayerCapability => node !== null);
    }
    for (const parent of parents) {
      if (seen.has(parent)) continue;
      seen.add(parent);
      queue.push({ id: parent, path: [parent, ...item.path] });
    }
  }
  return [target];
}
