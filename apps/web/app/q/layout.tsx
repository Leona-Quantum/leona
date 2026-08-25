import type { ReactNode } from "react";
import { RootDocument, rootMetadata } from "../../components/root-document";
import { getPublicLocale } from "../../lib/public-locale-server";

export const metadata = rootMetadata;

export default async function QappPublicLayout({ children }: { children: ReactNode }) {
  const locale = await getPublicLocale();
  return <RootDocument lang={locale}>{children}</RootDocument>;
}
