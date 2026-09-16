import { getPublicLocale } from "../../../../lib/public-locale-server";
import { QappWorkspace } from "./qapp-workspace";

export const metadata = { title: "Qapp — Leona Quantum" };

export default async function QappPage({ params }: { params: Promise<{ qappId: string }> }) {
  const [{ qappId }, locale] = await Promise.all([params, getPublicLocale()]);
  return <QappWorkspace key={qappId} qappId={qappId} locale={locale} />;
}
