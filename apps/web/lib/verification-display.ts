export type VerificationDisplayState = "ready" | "loading" | "empty" | "legacy" | "error" | "stale";

export function studioVerificationDisplayState({
  hydration,
  hasArtifact,
  stale,
}: {
  hydration: "loading" | "ready" | "error";
  hasArtifact: boolean;
  stale: boolean;
}): VerificationDisplayState | undefined {
  if (stale) return "stale";
  if (hydration === "loading") return "loading";
  if (hydration === "error") return "error";
  return hasArtifact ? undefined : "empty";
}
