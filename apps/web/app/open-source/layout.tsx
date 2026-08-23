import type { ReactNode } from "react";
import { RootDocument, rootMetadata } from "../../components/root-document";

// A root layout, because there is no longer one above it — see
// `components/root-document.tsx` for why `app/layout.tsx` was removed
// (ai-ops issue 151, owner ruling "option 2").
//
// `lang="en"` is what this segment served before and what it serves now. It is
// not a `[locale]` route and it does not read the locale cookie, so there is no
// localised copy here for the attribute to be wrong about.
export const metadata = rootMetadata;

export default function OpenSourceRootLayout({ children }: { children: ReactNode }) {
  return <RootDocument lang="en">{children}</RootDocument>;
}
