import type { ReactNode } from "react";
import { RootDocument, rootMetadata } from "../../components/root-document";

export const metadata = rootMetadata;

/**
 * Root layout for `/shared/*` (today: `/shared/notebooks`, the public
 * share-link view — ai-ops 349 option 2). Missing entirely until this fix:
 * `[locale]` sits beside this tree, not above it (`root-document.tsx`'s own
 * docstring on why there is no single `app/layout.tsx` any more), so a
 * top-level segment with no layout of its own has no `<html>`/`<body>` at
 * all — Next's "Missing `<html>` and `<body>` tags in the root layout" error,
 * caught while taking this PR's own screenshots rather than by a build.
 *
 * `lang="en"` for the same reason `app/embed/q/layout.tsx` is fixed rather
 * than reading `getPublicLocale()`: the public share view is deliberately
 * built to read no per-visitor server state at all — the token lives in a
 * URL fragment the server never sees (`shared-notebook-view.tsx`'s own
 * docstring) — so nothing here may call a Dynamic API like `cookies()`
 * either, or the same argument that keeps the token off the server would be
 * undermined by this layout reading a visitor-specific cookie instead. The
 * notebook's OWN language (English or Japanese content) is a data field on
 * `PublicNotebookView`, unrelated to the document's `lang` attribute, and is
 * handled inside the view component, not here.
 */
export default function SharedRootLayout({ children }: { children: ReactNode }) {
  return <RootDocument lang="en">{children}</RootDocument>;
}
