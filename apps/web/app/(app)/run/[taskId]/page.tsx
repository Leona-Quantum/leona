import { LiveRun } from "./live-run";
import { getPublicLocale } from "../../../../lib/public-locale-server";
import { runPlanner } from "../../../../lib/workflow-planner/run-planner.ts";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ taskId: string }> }) {
  const { taskId } = await params;
  return { title: `Run ${taskId}` };
}

export default async function RunDetail({ params }: { params: Promise<{ taskId: string }> }) {
  const [{ taskId }, locale] = await Promise.all([params, getPublicLocale()]);
  return <LiveRun taskId={taskId} locale={locale} planner={runPlanner(locale)} />;
}
