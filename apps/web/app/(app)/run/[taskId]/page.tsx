import { LiveRun } from "./live-run";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ taskId: string }> }) {
  const { taskId } = await params;
  return { title: `Run ${taskId} — Majorana` };
}

export default async function RunDetail({ params }: { params: Promise<{ taskId: string }> }) {
  const { taskId } = await params;
  return (
    <section>
      <header className="mb-4">
        <h1 className="m-0 text-20 font-semibold">Run</h1>
        <p className="mt-1 mb-0 font-mono text-12 text-text-1">{taskId}</p>
      </header>
      <LiveRun taskId={taskId} />
    </section>
  );
}
