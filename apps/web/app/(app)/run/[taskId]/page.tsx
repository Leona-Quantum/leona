// S3/S4 pipeline view — /run/[taskId]. Renders the StageRail + result panel purely from a
// replayed RunEvent log (07 §6). No run state lives here; the same log always renders the
// same DOM, and a mid-run refresh just replays a shorter prefix. Fixtures stand in for the
// persisted stream until the BFF glue lands. Spec: plans/roadmap/04-ui-specifications.md §2–3.
import { notFound } from "next/navigation";
import { RunView } from "@majorana/ui";
import { RUN_FIXTURES, RUN_FIXTURE_META } from "./fixtures";

export function generateStaticParams() {
  return Object.keys(RUN_FIXTURES).map((taskId) => ({ taskId }));
}

export async function generateMetadata({ params }: { params: Promise<{ taskId: string }> }) {
  const { taskId } = await params;
  return { title: `Run ${taskId} — Majorana` };
}

export default async function RunDetail({ params }: { params: Promise<{ taskId: string }> }) {
  const { taskId } = await params;
  const events = RUN_FIXTURES[taskId];
  if (!events) notFound();

  return (
    <section>
      <header className="mb-4">
        <h1 className="m-0 text-20 font-semibold">Run</h1>
        <p className="mt-1 mb-0 font-mono text-12 text-text-1">{taskId}</p>
      </header>

      <RunView events={events} emptyMessage="Waiting for the pipeline to start…" />

      {/* Fixture switcher — dev aid for taste-check screenshots (not product chrome). */}
      <nav
        aria-label="Demo runs"
        className="mt-8 flex flex-wrap gap-4 border-t border-border-0 pt-4"
      >
        {RUN_FIXTURE_META.map((f) => (
          <a
            key={f.id}
            href={`/run/${f.id}`}
            aria-current={f.id === taskId ? "page" : undefined}
            className={`text-12 no-underline ${
              f.id === taskId ? "text-text-0" : "text-text-1"
            }`}
          >
            {f.label}
          </a>
        ))}
      </nav>
    </section>
  );
}
