import type { components } from "@majorana/contracts-gen";

type QappVersion = components["schemas"]["QappVersion"];
export type RangeSmoke = NonNullable<QappVersion["range_smoke"]>;

export type RangeSmokeNotice = { tone: "warn" | "ok"; text: string };

/**
 * What to tell the CREATOR about running their Qapp at the top of its own
 * declared input range.
 *
 * ai-ops 180 — numbered without a hash because `check-raw-hex` reads a
 * three-digit hash-number as a CSS colour. His ruling, quoted: *"Smoke at both
 * ends but only warn the creator, publish either way."* So nothing this function
 * returns ever disables anything. It produces a sentence that sits beside the
 * publish button, and the publish button stays live in every branch.
 *
 * ## Why this lives in `lib/` and not next to the component that renders it
 *
 * The component is a `.tsx` under `app/`, and `apps/web`'s **required** CI job
 * runs `node --experimental-strip-types --test`, which strips types and cannot
 * parse JSX. A rule that decides what a creator is warned about, tested only by
 * the optional `form-submission` job, is a rule one CI change away from being
 * unchecked. Here it is covered by the job that gates merges.
 *
 * ## The five inputs, and the one that is a trap
 *
 * - `failed` — it ran at the maxima and broke. The whole point. Phrased for a
 *   **free** visitor, because since ai-ops 181 a Qapp's sandbox is sized by
 *   whoever OPENS it and the top-end run is deliberately made at the free lane's
 *   2048 MB. A pass at a paid creator's 4096 would be true for them and false
 *   for most of the people who will open the page.
 * - `unreachable` — nothing ran, because nothing could: the schema's own maxima
 *   are rejected by its own input contract, or the provider was down. Its
 *   `detail` already says which, so it is passed through rather than wrapped.
 * - `passed` — a real fact, worth one quiet line.
 * - `not_applicable` — the schema declares no upper bound anywhere, so the top
 *   of its range IS the bottom and the publication run already proved it. Says
 *   nothing: this is the ordinary case and a permanent line about it is noise.
 * - **absent** — `range_smoke` is `null` on every version generated before this
 *   shipped, and none will be backfilled. It means *nobody ever asked*, which is
 *   a third thing from `not_applicable` and from `passed`. It returns `null`
 *   from its own branch rather than falling through to the positive one, so a
 *   version nobody measured can never render as a version that passed.
 */
export function rangeSmokeNotice(
  smoke: RangeSmoke | null | undefined,
): RangeSmokeNotice | null {
  if (!smoke) return null;
  switch (smoke.status) {
    case "failed":
      return {
        tone: "warn",
        text:
          "This Qapp works at its smallest inputs but not at its largest. A visitor who turns "
          + "every control up may see it fail — and a failed run still costs them an execution. "
          + smoke.detail,
      };
    case "unreachable":
      return { tone: "warn", text: smoke.detail };
    case "passed":
      return { tone: "ok", text: smoke.detail };
    default:
      return null;
  }
}
