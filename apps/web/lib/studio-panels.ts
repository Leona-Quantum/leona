/**
 * The Studio tab set, in the order it is shown.
 *
 * Order is a product decision, not an implementation detail (Owner Inbox
 * 2026-07-31: Code first, Visual third). It lives here rather than inline in the
 * component so it can be asserted as a sequence — a set-membership test passes
 * happily while the tabs are in the wrong order, which is precisely the change
 * this is meant to catch.
 */
export const STUDIO_PANELS = ["code", "simulation", "visual", "summary"] as const;

export type StudioPanel = (typeof STUDIO_PANELS)[number];

/** The tab a surface opens on: you write code before you have anything to run. */
export const DEFAULT_STUDIO_PANEL: StudioPanel = "code";

/**
 * The Vault artifact detail's tabs.
 *
 * Deliberately the same four words in the same order as Studio's. They are two
 * views of one artifact and used to use two unrelated vocabularies — Studio said
 * Circuit/Code/Simulation/Versions, the Vault said
 * Overview/Code & Export/Runs/Verification/Notes — so moving between them meant
 * relearning where things were.
 */
export const ARTIFACT_PANELS = STUDIO_PANELS;
