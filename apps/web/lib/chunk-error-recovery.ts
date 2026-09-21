/**
 * Recover a tab stuck on a stale build after a Cloud Run deploy shifts
 * traffic to a new revision — the gap documented in
 * docs/runbooks/web-cloud-run.md ("The gap this move opens and does not
 * close: stale chunks") and in next.config.ts's `deploymentId` comment.
 *
 * `deploymentId` fixes this for a client-side NAVIGATION: the router compares
 * deployment ids on every page-data fetch and falls back to a full reload on
 * a mismatch. It does not cover a chunk requested by a dynamic `import()`
 * outside a navigation — a lazily-loaded component, fetched by the browser's
 * own module loader rather than Next's router — which throws straight past
 * any React error boundary as a plain `error`/`unhandledrejection` event on
 * `window`. This module is the fallback for that case: reload the page once,
 * and only once per build, so a stale tab self-heals instead of sitting on a
 * broken chunk forever.
 *
 * Split from `components/chunk-error-recovery.tsx` so the decision logic —
 * which error messages count, and whether a reload is still owed — is
 * testable without a browser. Getting the loop guard wrong is worse than the
 * bug it fixes (no recovery vs. an infinite reload), so it is the one part of
 * this feature that is not just eyeballed in the client component.
 */

/**
 * The known phrasings a dynamic `import()` failure throws when the chunk it
 * asked for is gone — content-hashed, so a new deploy leaves the exact file
 * the old bundle wants 404ing rather than merely stale. Webpack's own
 * `ChunkLoadError` names itself in `error.name` AND its message; Turbopack
 * and every browser's native ESM loader instead throw a plain
 * `TypeError`/`Error` whose MESSAGE says so, and the wording differs by
 * engine — matched here rather than assumed, so a browser this was not
 * tested against still has a reasonable chance of matching the phrase most
 * engines' messages share ("dynamically imported module").
 */
const CHUNK_LOAD_FAILURE_PATTERN =
  /ChunkLoadError|Loading chunk [\w.-]+ failed|failed to fetch dynamically imported module|error loading dynamically imported module|importing a module script failed/i;

/** Whether an error/rejection's own message text names a chunk-load failure. */
export function isChunkLoadFailureMessage(message: string | null | undefined): boolean {
  return Boolean(message) && CHUNK_LOAD_FAILURE_PATTERN.test(message as string);
}

/**
 * `sessionStorage` key a build's one allowed reload is recorded under — one
 * tab, one build, at most one automatic reload. A new build (a fresh
 * `buildId`, from `deploymentId`/`publicReleaseSha()`) gets its own key, so
 * it gets its own fresh attempt rather than inheriting a previous build's
 * "already tried" flag.
 */
export function chunkReloadStorageKey(buildId: string): string {
  return `leona.chunk-reload.${buildId}`;
}

/**
 * Whether a caught error/rejection should trigger the one-time reload.
 * `alreadyReloaded` is whatever the caller's storage said (read under
 * `chunkReloadStorageKey(buildId)`) before this call. This is the loop
 * guard itself: without the `!alreadyReloaded` half, a build broken in a way
 * a reload cannot fix — the new revision genuinely lacks the chunk, forever —
 * would reload every single time the error re-fires.
 */
export function shouldReloadForChunkFailure(message: string | null | undefined, alreadyReloaded: boolean): boolean {
  return isChunkLoadFailureMessage(message) && !alreadyReloaded;
}
