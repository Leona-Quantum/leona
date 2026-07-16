import type { PublicRepositoryEntry } from "./types";

// Populated by the catalog-expansion batches (2026-07-16 Owner Inbox: grow the
// public repository to 60+ records). Entries use makeReferenceEntry from
// ./factory; scripts/check-repository-data.mjs validates every record.
export const ALGORITHM_ENTRIES: PublicRepositoryEntry[] = [];
