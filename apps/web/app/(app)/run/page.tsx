import { RunWorkspace } from "./run-workspace";
import { getPublicLocale } from "../../../lib/public-locale-server";

export const metadata = { title: "Run — Leona Quantum" };

export default async function RunHome() {
  const locale = await getPublicLocale();
  return <RunWorkspace locale={locale} />;
}
