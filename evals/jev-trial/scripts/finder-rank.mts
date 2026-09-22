// Runs the REAL production ranking function (`findMethods`,
// `apps/web/lib/repository/finder.ts`) against the REAL local Atlas corpus
// (`PUBLIC_REPOSITORY_ENTRIES`, `apps/web/lib/public-repository.ts`), for a
// batch of curated cases — no Next.js server, no database, no network call.
//
// This is the "current finder" half of the Jev offline trial
// (evals/jev-trial/). It is deliberately a thin bridge, not a reimplementation:
// re-deriving `findMethods`'s ranking logic in Python would risk silently
// drifting from what production actually ships, which is the exact failure
// mode this repo's corpus/finder code repeatedly calls out (see finder.ts's
// own module header). This script imports the production module directly.
//
// Usage: reads one JSON object from stdin —
//   {"cases": [{"id": "chem-phase-estimation", "domain": "chemistry"}, ...]}
// — and writes one JSON object to stdout:
//   {"corpus_size": N, "results": [{"id", "domain", "pool_size",
//     "ranked": [{"slug","title","algorithm_family","satisfied_count"}, ...]}]}
//
// `domain` must be one of the closed `TopicId`s carrying `facet: "domain"`
// (`apps/web/lib/repository/topics.ts`) — an unknown domain is a hard error,
// not a silently empty pool.
//
// Run with the sibling loader hook (needed because `public-repository.ts`'s
// own imports are extensionless — see that file's docstring for why):
//
//   node --experimental-strip-types \
//     --experimental-loader=./evals/jev-trial/scripts/ts-extensionless-loader.mjs \
//     evals/jev-trial/scripts/finder-rank.mts < cases.json > ranked.json
//
// Known, documented simplification: `buildFinderRecord` is called with
// `estimate: null` and `studioExampleId: null` for every record (this script
// never calls the fault-tolerant estimator or `resolveWorkedExamples`, both of
// which need a running server/DB — see finder.ts's own header on why estimate
// is "handed to it, never fetched"). Every curated case in this trial uses
// `hardwareEra: "any"` and sets no qubit/depth limit, so `satisfiedCount` is 0
// for every candidate and ranking within a domain pool is decided entirely by
// the tie-break (`studioExampleId` present, then title, then slug) — i.e. the
// tie-break used here is the WEAKEST form the tie-break can be in
// (`studioExampleId` always null), not a stronger one. This is called out
// explicitly in evals/jev-trial/README.md: it is the accurate reason the
// current finder is not expected to rank well on these cases, not a bug in
// this bridge.
import { PUBLIC_REPOSITORY_ENTRIES } from "../../../apps/web/lib/public-repository.ts";
import {
  buildFinderRecord,
  findMethods,
  DEFAULT_FINDER_LIMITS,
} from "../../../apps/web/lib/repository/finder.ts";
import { topicsInFacet } from "../../../apps/web/lib/repository/topics.ts";

const DOMAIN_TOPIC_IDS = new Set(topicsInFacet("domain").map((t) => t.id));

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

type CaseInput = { id: string; domain: string };

function fail(message: string): never {
  process.stderr.write(`finder-rank: ${message}\n`);
  process.exit(1);
}

async function main() {
  const raw = await readStdin();
  if (!raw.trim()) fail("no input on stdin — expected {\"cases\": [...]}");
  let parsed: { cases: CaseInput[] };
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    fail(`stdin was not valid JSON: ${(err as Error).message}`);
  }
  if (!Array.isArray(parsed!.cases)) fail("expected a top-level \"cases\" array");

  const records = PUBLIC_REPOSITORY_ENTRIES.map((entry) =>
    // Runtime-only: this repo runs this file through `--experimental-strip-types`,
    // which erases type annotations without checking them, so a structural gap
    // between `PublicRepositoryEntry` (full) and `PublicRepositoryListEntry`
    // (trimmed) cannot fail HERE — only at `tsc --noEmit` time, which this
    // script is not part of (see AGENTS.md: it is intentionally excluded from
    // apps/web's own `test`/`typecheck` script lists, being outside `apps/web`'s
    // own tree). `buildFinderRecord` reads a fixed, small field set (see its own
    // docstring); every field it reads is present on the full entry type too.
    buildFinderRecord(entry as any, null, null),
  );

  const results = parsed!.cases.map((c) => {
    if (!c.id || !c.domain) fail(`case missing "id" or "domain": ${JSON.stringify(c)}`);
    if (!DOMAIN_TOPIC_IDS.has(c.domain)) {
      fail(
        `case ${c.id}: "${c.domain}" is not a domain-facet TopicId. ` +
          `Known domain topics: ${[...DOMAIN_TOPIC_IDS].sort().join(", ")}`,
      );
    }
    const limits = { ...DEFAULT_FINDER_LIMITS, problem: c.domain as any };
    const outcome = findMethods(records, limits, false);
    return {
      id: c.id,
      domain: c.domain,
      pool_size: outcome.matches.length,
      ranked: outcome.matches.map((m) => ({
        slug: m.record.slug,
        title: m.record.title,
        algorithm_family: m.record.algorithmFamily,
        description: m.record.description,
        satisfied_count: m.satisfiedCount,
      })),
    };
  });

  process.stdout.write(JSON.stringify({ corpus_size: PUBLIC_REPOSITORY_ENTRIES.length, results }) + "\n");
}

main().catch((err) => fail(err instanceof Error ? (err.stack ?? err.message) : String(err)));
