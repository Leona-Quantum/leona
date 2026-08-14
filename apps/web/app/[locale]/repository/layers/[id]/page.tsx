// One address per thing a reader can name.
//
// `states.ts` §3 makes node ids and state ids share this route on purpose — one
// namespace, one page per named thing — and `validateLayerGraph` rejects a
// collision between them. That is only half a design until this file resolves
// both: until session 93 it looked up `LAYER_GRAPH` alone, so every state circle
// drawn on `/repository/layers` (and every "narrower kinds" link in the rail)
// was an `<a href>` to a 404. Nothing gated it, because a missing route is
// invisible to a build — the page renders, the link is real, and only following
// it says otherwise.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { canonicalMetadata } from "../../../../../lib/public-metadata";
import { PublicSite } from "../../../../../components/public-site";
import { LayerNodeView, LayerStateView } from "../../../../../components/repository-layers";
import { IDENTITY, formatViewport, parseViewport } from "../../../../../lib/repository/canvas-viewport";
import { resolveOpenIds } from "../../../../../lib/repository/converge-layout";
import { isPublicLocale, parsePublicLocale, PUBLIC_LOCALES } from "../../../../../lib/public-locale";
import { getRepositoryListEntries } from "../../../../../lib/repository-source";
import { LAYER_GRAPH } from "../../../../../lib/repository/layer-graph";
import { isCapability, layerCorpusEntry, layerNode, type LayerCorpusEntry } from "../../../../../lib/repository/layers";
import { STATE_VOCABULARY } from "../../../../../lib/repository/state-vocabulary";
import { layerState } from "../../../../../lib/repository/states";

/**
 * The site's most-read route, and the reason `[locale]` is above it.
 *
 * Around three quarters of all `/repository/layers*` traffic is a node page, so
 * this file is roughly 72% of everything the site serves. It is also dynamic and
 * has to stay that way: it resolves `?open=` and `?at=` on the server so a
 * shared link arrives already panned, scaled and expanded, with JavaScript off.
 * Next opts any page reading `searchParams` into request-time rendering, so
 * prerendering is off the table here regardless of what else is removed.
 *
 * It reaches the CDN the other way — `Vercel-CDN-Cache-Control` in
 * `next.config.ts` — and the locale had to come out of the cookie first, because
 * Vercel's cache key has the query string in it but not cookies. See the long
 * note in `../page.tsx`, which is where the measurements are written down.
 *
 * `dynamicParams = false` restricts BOTH segments: an unknown `[locale]` 404s
 * instead of rendering this page under a wrong language, and an unknown `[id]`
 * 404s at the routing layer rather than through `notFound()` below. The
 * `notFound()` call stays because it is still the honest answer for an id that
 * this list produced and the lookups then disagree about.
 */
export function generateStaticParams() {
  const ids = [
    ...LAYER_GRAPH.nodes.map((node) => node.id),
    ...STATE_VOCABULARY.states.map((state) => state.id),
  ];
  return PUBLIC_LOCALES.flatMap((locale) => ids.map((id) => ({ locale, id })));
}

export const dynamicParams = false;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}): Promise<Metadata> {
  const { id, locale: rawLocale } = await params;
  const locale = parsePublicLocale(rawLocale);
  const node = layerNode(LAYER_GRAPH, id);
  if (node) {
    return {
      title: locale === "ja" ? node.labelJa : node.label,
      description: locale === "ja" ? node.summaryJa : node.summary,
      ...canonicalMetadata(`/repository/layers/${id}`),
    };
  }
  const state = layerState(STATE_VOCABULARY, id);
  if (state) {
    return {
      title: locale === "ja" ? state.labelJa : state.label,
      description: locale === "ja" ? state.summaryJa : state.summary,
      ...canonicalMetadata(`/repository/layers/${id}`),
    };
  }
  // The surface's own name, for an id that names neither a node nor a state —
  // "Map" since ai-ops#78, matching `layers/page.tsx` and the breadcrumb this
  // page renders. The route is untouched.
  return { title: locale === "ja" ? "地図" : "Map" };
}

/** `?open=` as a list, tolerating the repeated-parameter form the canvas emits. */
function openValues(query: Record<string, string | string[] | undefined>): string[] {
  const raw = query.open;
  return Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : [];
}

/**
 * A viewport parameter the parser actually accepted, or null for the default.
 *
 * Null rather than `"0,0,1"` so a bare address stays bare instead of every link
 * on the page carrying an identity transform.
 */
function canonicalViewport(raw: string | string[] | undefined): string | null {
  const viewport = parseViewport(raw);
  return viewport.x === IDENTITY.x && viewport.y === IDENTITY.y && viewport.z === IDENTITY.z
    ? null
    : formatViewport(viewport);
}

export default async function RepositoryLayerNodePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id, locale: rawLocale }, query] = await Promise.all([params, searchParams]);
  // Before anything else, and not covered by `dynamicParams = false` — that
  // restricts params only on a route that prerenders, and this one reads
  // `searchParams` so it never does. Without this, `/zz/repository/layers/<id>`
  // served the English page with a 200. See `isPublicLocale`.
  if (!isPublicLocale(rawLocale)) notFound();
  const locale = parsePublicLocale(rawLocale);
  // Both lookups, unconditionally: the two namespaces are disjoint by validation,
  // so at most one can answer and there is no precedence question to get wrong.
  const node = layerNode(LAYER_GRAPH, id);
  const state = layerState(STATE_VOCABULARY, id);
  if (!node && !state) notFound();
  // **The catalogue is now fetched for both, and the note that used to stand
  // here was right until this session.** It read: "a state page names processes
  // and other states and never touches a record, so making it wait on the Atlas
  // would buy nothing". A state page is now one end of the record ↔ state join
  // (ai-ops#41 option B) — it lists the records that ARE the object — so the
  // dependency buys exactly what it costs. Nothing else about the reasoning
  // changed: the fetch can still be slow or short, and a state page with no
  // corpus renders every other section and omits that one.
  const entries = await getRepositoryListEntries();
  const corpus: LayerCorpusEntry[] = entries.map(layerCorpusEntry);

  // **Both halves of what the parser returns, because the count is the point.**
  // `resolveOpenIds` says of itself that "the count over the cap is reported
  // rather than dropped in silence" — and that was true on the overview and
  // false here, because this page took `.open` off the end of the call and let
  // `.dropped` fall on the floor. One function, two surfaces, one report: a
  // reader who follows a link past the cap is told so wherever they land.
  //
  // A METHOD's own figure opens itself, so one slot of the cap is spoken for
  // before the reader's ids are counted. A capability's does not, and reserving
  // there would drop one of the reader's ids for nothing.
  const openSet = node
    ? resolveOpenIds(
        openValues(query),
        (id) => layerNode(LAYER_GRAPH, id) !== null,
        isCapability(node) ? 0 : 1,
      )
    : { open: new Set<string>(), dropped: 0 };

  return (
    <PublicSite
      activePath="/repository"
      className="mj-repository-site mj-layers-site"
      locale={locale}
      // No per-visitor part in the chrome. `"full"` calls `getMajoranaAuth()` ->
      // `withAuth()`, which THROWS on a request that did not pass through
      // AuthKit's middleware — and this path deliberately no longer does,
      // because AuthKit sets a cookie on every request it sees and Vercel will
      // not store a response carrying `Set-Cookie`.
      chrome="static"
      showLanguageToggle
    >
      {node ? (
        <LayerNodeView
          graph={LAYER_GRAPH}
          node={node}
          corpus={corpus}
          locale={locale}
          viewport={parseViewport(query.at)}
          open={openSet.open}
          droppedOpen={openSet.dropped}
          // Canonical, not raw. `parseViewport` falls back to IDENTITY on a
          // malformed `?at=`, so handing the original back out would render one
          // viewport and link to a different one — and keep the bad value alive
          // across every click. The overview does this too; the node page did
          // not, which is the half of the rule that was missing.
          at={canonicalViewport(query.at)}
        />
      ) : state ? (
        <LayerStateView
          graph={LAYER_GRAPH}
          vocabulary={STATE_VOCABULARY}
          state={state}
          locale={locale}
          corpus={corpus}
        />
      ) : null}
    </PublicSite>
  );
}
