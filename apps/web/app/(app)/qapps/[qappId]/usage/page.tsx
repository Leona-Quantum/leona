import { getPublicLocale } from "../../../../../lib/public-locale-server";
import { QappUsage } from "../qapp-usage";

export const metadata = { title: "Qapp usage" };

export default async function QappUsagePage({ params }: { params: Promise<{ qappId: string }> }) {
  const [{ qappId }, locale] = await Promise.all([params, getPublicLocale()]);
  return <QappUsage key={qappId} qappId={qappId} locale={locale} />;
}
