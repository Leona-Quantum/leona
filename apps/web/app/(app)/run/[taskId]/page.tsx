import { LiveRun } from "./live-run";
import { getPublicLocale } from "../../../../lib/public-locale-server";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ taskId: string }> }) {
  const { taskId } = await params;
  return { title: `Run ${taskId} — Leona Quantum` };
}

export default async function RunDetail({ params }: { params: Promise<{ taskId: string }> }) {
  const [{ taskId }, locale] = await Promise.all([params, getPublicLocale()]);
  return <LiveRun taskId={taskId} locale={locale} />;
}
