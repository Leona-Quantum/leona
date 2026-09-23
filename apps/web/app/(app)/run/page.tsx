import { RunWorkspace } from "./run-workspace";
import { getPublicLocale } from "../../../lib/public-locale-server";
import { runPlanner } from "../../../lib/workflow-planner/run-planner.ts";

export const metadata = { title: "Run" };

export default async function RunHome() {
  const locale = await getPublicLocale();
  // The planner Nala plans with when a prompt reads as a known problem, built
  // on the server so the client receives the lean graph rather than the whole
  // layer graph.
  return <RunWorkspace locale={locale} planner={runPlanner(locale)} />;
}
