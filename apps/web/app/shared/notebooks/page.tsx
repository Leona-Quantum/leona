import type { Metadata } from "next";
import { SharedNotebookView } from "./shared-notebook-view";

/**
 * A static `metadata` export, not `generateMetadata`: this page reads no
 * per-request data at all (the share token lives in a URL fragment the server
 * never sees — `shared-notebook-view.tsx`'s docstring). `robots: {index:
 * false, follow: false}` because a link meant for one holder is never a search
 * result or a link-preview target, the same reasoning `app/embed/q/[slug]`
 * and `app/welcome` already apply to their own not-for-indexing pages.
 */
/**
 * Rendered per request, not prerendered. The page itself reads nothing per
 * visitor, but `scripts/check-static-routes.mjs` traces a per-visitor read
 * through this tree's root layout (`RootDocument`), and a prerendered copy
 * would be served from the CDN to every reader. The shell is cheap to render,
 * and a shared notebook is not a page worth caching at the edge anyway: a
 * revoked link should stop working everywhere at once.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Shared notebook",
  robots: { index: false, follow: false },
};

export default function SharedNotebookPage() {
  return <SharedNotebookView />;
}
