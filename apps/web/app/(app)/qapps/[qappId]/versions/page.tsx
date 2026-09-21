import { getPublicLocale } from "../../../../../lib/public-locale-server";
import { QappVersions } from "../qapp-versions";

export const metadata = { title: "Qapp versions — Leona Quantum" };

export default async function QappVersionsPage({ params }: { params: Promise<{ qappId: string }> }) {
  const [{ qappId }, locale] = await Promise.all([params, getPublicLocale()]);
  return <QappVersions key={qappId} qappId={qappId} locale={locale} />;
}
