import { majoranaSignInPath } from "./sign-in.ts";

/**
 * Where "Add to Studio" on an Atlas record takes a reader.
 *
 * A signed-in reader's click posts the export and lands on the new artifact
 * (`importedArtifactHref`). A signed-out reader used to be sent through the
 * page's one shared sign-in link, whose returnTo is the page default `/run`,
 * so after signing in they landed on the run page with the record gone and
 * nothing added — the same defect PR 896 fixed for "Open in Studio". Now they
 * return to `/studio?atlas=<slug>`, and Studio performs the import itself on
 * arrival, so the click they made before signing in is honoured after it.
 *
 * `majoranaSignInPath` runs the return path through `safeReturnTo`, which keeps
 * a same-origin path's query string.
 */
export function atlasStudioImportHref(slug: string): string {
  return `/studio?atlas=${encodeURIComponent(slug)}`;
}

export function atlasStudioSignInHref(slug: string): string {
  return majoranaSignInPath(atlasStudioImportHref(slug));
}

/** The artifact a completed import opens. */
export function importedArtifactHref(artifactId: string): string {
  return `/studio?artifact=${encodeURIComponent(artifactId)}`;
}
