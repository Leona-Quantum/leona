"use client";

import type { ReactNode } from "react";
import { setStorageScope } from "../lib/user-storage";

/**
 * Points browser storage at the signed-in account and its active workspace, for
 * everything it wraps.
 *
 * Deliberately a wrapper rather than a sibling: React runs a parent's body
 * before any of its children's, so wrapping makes "the scope is set before the
 * first read" a structural guarantee instead of a rule about sibling order that
 * a later refactor can quietly break. Every consumer reads storage in a state
 * initializer or an effect, both of which run after this.
 *
 * The call is in render, not an effect, for the same reason — an effect runs
 * after its children's effects, which is exactly too late.
 */
export function StorageScope({
  scopeId,
  mayAdoptLegacyData = true,
  children,
}: {
  scopeId: string | null;
  /** False inside a shared workspace — see lib/storage-scope-id.ts. */
  mayAdoptLegacyData?: boolean;
  children: ReactNode;
}) {
  setStorageScope(scopeId, { mayAdoptLegacyData });
  return <>{children}</>;
}
