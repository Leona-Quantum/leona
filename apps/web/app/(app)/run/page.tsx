import { RunWorkspace } from "./run-workspace";
import { getPublicLocale } from "../../../lib/public-locale-server";

export const metadata = { title: "Run" };

export default async function RunHome() {
  const locale = await getPublicLocale();
  return <RunWorkspace locale={locale} />;
}
