import { getPublicLocale } from "../../../lib/public-locale-server";
import { QappGallery, type QappGalleryView } from "./qapp-gallery";

export const metadata = { title: "Qapps" };

export default async function QappsPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const [params, locale] = await Promise.all([searchParams, getPublicLocale()]);
  const view: QappGalleryView = params.view === "public" ? "public" : "mine";
  return <QappGallery view={view} locale={locale} />;
}
