"use client";

import { useEffect } from "react";
import {
  chunkReloadStorageKey,
  isChunkLoadFailureMessage,
  shouldReloadForChunkFailure,
} from "../lib/chunk-error-recovery";

/**
 * Reload a tab ONCE if it catches a dynamic `import()` failing to fetch its
 * chunk — the fallback `next.config.ts`'s `deploymentId` comment and
 * `lib/chunk-error-recovery.ts` both describe: a chunk failure outside a
 * client-side navigation throws straight past any React error boundary as a
 * plain `window` `error`/`unhandledrejection` event, which is what this
 * listens for.
 *
 * `buildId` (the resolved `deploymentId`, `"dev"` when unset) scopes the
 * `sessionStorage` guard so at most one automatic reload happens per tab per
 * build — see `lib/chunk-error-recovery.ts` for why getting that guard wrong
 * is worse than the bug it fixes.
 *
 * Rendered once, in `RootDocument`, the same place `ThemeController` is —
 * every root layout shares this document, so every route is covered.
 */
export function ChunkErrorRecovery({ buildId }: { buildId: string }) {
  useEffect(() => {
    const storageKey = chunkReloadStorageKey(buildId);

    function recover(message: string | null | undefined) {
      if (!isChunkLoadFailureMessage(message)) return;
      let alreadyReloaded: boolean;
      try {
        alreadyReloaded = sessionStorage.getItem(storageKey) === "1";
      } catch {
        // Storage blocked (private mode, an extension, cookies disabled) —
        // there is nowhere to record that a reload was already tried, and
        // reloading anyway risks looping forever with no memory of it. Leave
        // the reader with the ordinary broken-chunk error instead.
        return;
      }
      if (!shouldReloadForChunkFailure(message, alreadyReloaded)) return;
      try {
        sessionStorage.setItem(storageKey, "1");
      } catch {
        return;
      }
      window.location.reload();
    }

    function onError(event: ErrorEvent) {
      recover(event.message || event.error?.message);
    }
    function onRejection(event: PromiseRejectionEvent) {
      const reason: unknown = event.reason;
      recover(typeof reason === "string" ? reason : reason instanceof Error ? reason.message : null);
    }

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, [buildId]);

  return null;
}
