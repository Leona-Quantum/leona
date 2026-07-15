import { LiveRun } from "./live-run";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ taskId: string }> }) {
  const { taskId } = await params;
  return { title: `Run ${taskId} — Leona Quantum` };
}

export default async function RunDetail({ params }: { params: Promise<{ taskId: string }> }) {
  const { taskId } = await params;
  return <LiveRun taskId={taskId} />;
}
