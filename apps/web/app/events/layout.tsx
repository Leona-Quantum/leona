import type { ReactNode } from "react";
import { RootDocument, rootMetadata } from "../../components/root-document";

export const metadata = rootMetadata;

export default function EventsLayout({ children }: { children: ReactNode }) {
  return <RootDocument lang="ja" forcedTheme="light">{children}</RootDocument>;
}
